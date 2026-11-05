import assert from "node:assert/strict";
import test from "node:test";
import {
  createConsoleApi,
  type ConsoleIdentity,
  type ConsoleRequest,
} from "./consoleTransport";
import type { MonitoringResponse } from "./monitoringContracts";
import { createConsoleActivation } from "./consoleActivation";

const id = "service-id";
const check = {
  status: "unknown",
  source: "none",
  path: "",
  reason: "",
  checked_at: null,
  stale_at: null,
  duration_ms: null,
  status_code: null,
  freshness: "unknown",
} as const;
const response: MonitoringResponse = {
  service_id: id,
  can_manage: true,
  can_probe: true,
  configuration: {
    user_service_id: id,
    revision: 7,
    owner_config: { health: null, readiness: null },
  },
  status: { service: { id }, health: check, readiness: null },
};
function setup() {
  let user: ConsoleIdentity = {
    id: "person",
    is_admin: false,
    capabilities: { enabled_features: ["services:monitoring"] },
  };
  let data = structuredClone(response);
  let writeResult: unknown;
  const calls: Array<{
    path: string;
    options?: Parameters<ConsoleRequest>[1];
  }> = [];
  const api = createConsoleApi(async (path, options) => {
    options?.authorityGuard?.();
    calls.push({ path, options });
    if (path === "/users/me") return user;
    if (!options?.method || options.method === "GET") return data;
    return (
      writeResult ??
      (options.method === "PUT" || options.method === "DELETE"
        ? data.configuration
        : data.status)
    );
  });
  return {
    api,
    calls,
    user: (value: ConsoleIdentity) => {
      user = value;
    },
    data: (value: MonitoringResponse) => {
      data = value;
    },
    writeResult: (value: unknown) => {
      writeResult = value;
    },
  };
}

test("feature absent/off never calls a monitoring route; reads are observation-only", async () => {
  const x = setup();
  x.user({ id: "person", is_admin: true });
  assert.equal(await x.api.readMonitoring(id), null);
  assert.deepEqual(
    x.calls.map((x) => x.path),
    ["/users/me"],
  );
  const y = setup();
  await y.api.readMonitoring(id);
  assert.deepEqual(
    y.calls.map((x) => x.path),
    ["/users/me", `/keys/${id}/monitoring`],
  );
  assert(y.calls.every((x) => !x.options?.method));
});

test("check now and draft validation use their explicit execution endpoints", async () => {
  const x = setup();
  await x.api.operate(id, "person", { kind: "probe" });
  assert.equal(x.calls.at(-1)?.path, `/keys/${id}/monitoring/probe`);
  assert.equal(x.calls.at(-1)?.options?.method, "POST");
  assert.equal(x.calls.at(-1)?.options?.retryOnAuthFailure, false);
  const y = setup();
  const checks = {
    health: { path: "healthz", expect_status: [200] },
    readiness: null,
  };
  await y.api.operate(id, "person", { kind: "validate", checks });
  assert.equal(y.calls.at(-1)?.path, `/keys/${id}/monitoring/validate`);
  assert.deepEqual(y.calls.at(-1)?.options?.body, checks);
  assert.equal(y.calls.at(-1)?.options?.retryOnAuthFailure, false);
  assert(!y.calls.some((x) => x.options?.method === "PUT"));
});

test("each operation rechecks live flag, actor and permissions before effects", async () => {
  for (const mode of ["flag", "actor", "probe", "manage"] as const) {
    const x = setup();
    if (mode === "flag") x.user({ id: "person", is_admin: true });
    if (mode === "actor")
      x.user({
        id: "other",
        is_admin: true,
        capabilities: { enabled_features: ["services:monitoring"] },
      });
    if (mode === "probe") x.data({ ...response, can_probe: false });
    if (mode === "manage") x.data({ ...response, can_manage: false });
    await assert.rejects(
      x.api.operate(
        id,
        "person",
        mode === "manage"
          ? {
              kind: "save",
              revision: 7,
              checks: { health: null, readiness: null },
            }
          : { kind: "probe" },
      ),
    );
    assert(!x.calls.some((x) => x.options?.method));
  }
});

test("save and clear use the reviewed revision and refuse drift", async () => {
  const x = setup();
  const checks = { health: null, readiness: null };
  await x.api.operate(id, "person", { kind: "save", revision: 7, checks });
  assert.deepEqual(x.calls.at(-1)?.options?.body, { revision: 7, ...checks });
  assert.equal(x.calls.at(-1)?.options?.method, "PUT");
  assert.equal(x.calls.at(-1)?.options?.retryOnAuthFailure, false);
  const y = setup();
  await y.api.operate(id, "person", { kind: "clear", revision: 7 });
  assert.equal(y.calls.at(-1)?.path, `/keys/${id}/monitoring?revision=7`);
  assert.equal(y.calls.at(-1)?.options?.method, "DELETE");
  assert.equal(y.calls.at(-1)?.options?.retryOnAuthFailure, false);
  const z = setup();
  await assert.rejects(
    z.api.operate(id, "person", { kind: "save", revision: 6, checks }),
    /another editor/,
  );
  assert(!z.calls.some((x) => x.options?.method));
});

test("read and mutation results are pinned to exact connection IDs", async () => {
  const x = setup();
  x.data({ ...response, service_id: "sibling" });
  await assert.rejects(x.api.readMonitoring(id), /different connection/);
  const y = setup();
  y.writeResult({ ...response.status, service: { id: "sibling" } });
  await assert.rejects(
    y.api.operate(id, "person", { kind: "probe" }),
    /different connection/,
  );
  const z = setup();
  z.data({
    ...response,
    configuration: { ...response.configuration!, user_service_id: "sibling" },
  });
  await assert.rejects(z.api.readMonitoring(id), /different connection/);
});

test("view/session authority guard stops asynchronous continuation before mutation", async () => {
  let current = true;
  const calls: string[] = [];
  const api = createConsoleApi(async (path) => {
    calls.push(path);
    if (path === "/users/me")
      return {
        id: "person",
        is_admin: false,
        capabilities: { enabled_features: ["services:monitoring"] },
      };
    current = false;
    return response;
  });
  await assert.rejects(
    api.operate(id, "person", { kind: "probe" }, () => {
      if (!current) throw new Error("inactive");
    }),
    /inactive/,
  );
  assert.deepEqual(calls, ["/users/me", `/keys/${id}/monitoring`]);
});

test("a preflight permanently loses authority after background then foreground, even when the response arrives later", async () => {
  let resolve!: (data: unknown) => void;
  const pending = new Promise((yes) => {
    resolve = yes;
  });
  let beganRead!: () => void;
  const reading = new Promise<void>((yes) => {
    beganRead = yes;
  });
  const calls: string[] = [];
  const fence = createConsoleActivation(() => 4, true);
  const api = createConsoleApi(async (path) => {
    calls.push(path);
    if (path === "/users/me")
      return {
        id: "person",
        is_admin: false,
        capabilities: { enabled_features: ["services:monitoring"] },
      };
    beganRead();
    return pending;
  });
  const action = api.operate(
    id,
    "person",
    { kind: "save", revision: 7, checks: { health: null, readiness: null } },
    fence.capture(),
  );
  await reading;
  fence.update(false);
  fence.update(true);
  resolve(response);
  await assert.rejects(action, /view changed/);
  assert.deepEqual(calls, ["/users/me", `/keys/${id}/monitoring`]);
});
