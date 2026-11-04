import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  hookHarness,
  deferred,
} from "../../assistant/assistantHookTestHarness";
import * as contracts from "./monitoringContracts";
import { ApiError } from "../../../lib/api/ApiError";
import { createConsoleActivation } from "./consoleActivation";

type Element = { type: unknown; props: Record<string, any> };
const elements = (root: Element | null): Element[] =>
  root
    ? [
        root,
        ...[root.props.children]
          .flat(Infinity)
          .flatMap((child) =>
            child && typeof child === "object" && "props" in child
              ? elements(child)
              : [],
          ),
      ]
    : [];
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
};
function setup() {
  let active = true;
  let epoch = 2;
  let operation = async () => ({
    kind: "probe",
    result: query.data.response.status,
  });
  const calls: unknown[] = [];
  const editing: boolean[] = [];
  const cancelled: unknown[] = [];
  const busyChanges: boolean[] = [];
  const cached = new Map<string, unknown>();
  const handlers = new Set<(state: string) => void>();
  const app = {
    currentState: "active",
    addEventListener: (_event: string, handler: (state: string) => void) => {
      handlers.add(handler);
      return { remove: () => handlers.delete(handler) };
    },
  };
  let refreshes = 0;
  const query: any = {
    isPending: false,
    isError: false,
    isFetching: false,
    data: {
      user: { id: "person" },
      response: {
        can_probe: true,
        can_manage: true,
        configuration: {
          revision: 7,
          user_service_id: "service",
          owner_config: {
            health: { path: "healthz", expect_status: [200] },
            readiness: null,
          },
        },
        status: { service: { id: "service" }, health: check, readiness: null },
      },
    },
    refetch: async () => {
      refreshes++;
      return { isError: false };
    },
  };
  const harness = hookHarness<Element | null>({
    "react/jsx-runtime": {
      jsx: (type: unknown, props: unknown) => ({ type, props }),
      jsxs: (type: unknown, props: unknown) => ({ type, props }),
    },
    "react-native": {
      AppState: app,
      ActivityIndicator: "ActivityIndicator",
      Switch: "Switch",
      View: "View",
    },
    "@tanstack/react-query": {
      useQuery: () => query,
      useQueryClient: () => client,
    },
    "../../../components/workspace/WorkspaceUI": Object.fromEntries(
      ["ActionButton", "Card", "Field", "Label", "Notice"].map((name) => [
        name,
        name,
      ]),
    ),
    "../../../lib/api/ApiError": { ApiError },
    "../../../lib/auth/authEpoch": { getAuthEpoch: () => epoch },
    "./consoleApi": {
      consoleApi: {
        readMonitoring: async () => query.data,
        operate: async (...args: unknown[]) => {
          calls.push(args);
          return operation();
        },
      },
    },
    "./monitoringContracts": contracts,
    "./consoleActivation": { createConsoleActivation },
  });
  const client = {
    cancelQueries: async (value: unknown) => {
      cancelled.push(value);
    },
    getQueryData: (key: unknown) => cached.get(JSON.stringify(key)),
    setQueryData: (key: unknown, value: unknown) =>
      cached.set(JSON.stringify(key), value),
  };
  const { ServiceMonitoringCard } = harness.load(
    fileURLToPath(new URL("./ServiceMonitoringCard.tsx", import.meta.url)),
  ) as { ServiceMonitoringCard: (props: unknown) => Element | null };
  const onEditingChange = (value: boolean) => {
    editing.push(value);
  };
  const onBusyChange = (value: boolean) => {
    busyChanges.push(value);
  };
  harness.mount(() =>
    ServiceMonitoringCard({
      serviceId: "service",
      active,
      onEditingChange,
      onBusyChange,
    }),
  );
  return {
    harness,
    query,
    calls,
    editing,
    cancelled,
    busyChanges,
    cached,
    refreshes: () => refreshes,
    appState: (state: string) => {
      app.currentState = state;
      handlers.forEach((handler) => handler(state));
    },
    active: (value: boolean) => {
      active = value;
      harness.render();
    },
    epoch: () => {
      epoch++;
    },
    operation: (value: typeof operation) => {
      operation = value;
    },
    nodes: () => elements(harness.value()),
    button: (label: string) => {
      const node = elements(harness.value()).find(
        (x) => x.type === "ActionButton" && x.props.label === label,
      );
      assert(node, `Missing ${label}`);
      return node;
    },
  };
}

test("feature off and missing backend configuration hide monitoring; read failure offers recovery without old badges", () => {
  const x = setup();
  x.query.data = null;
  x.harness.render();
  assert.equal(x.harness.value(), null);
  x.query.isError = true;
  x.query.error = new ApiError({
    statusCode: 404,
    errorCode: 13301,
    errorKey: "monitoring_not_configured",
    message: "unset",
  });
  x.harness.render();
  assert.equal(x.harness.value(), null);
  x.query.data = undefined;
  x.query.error = new Error("network");
  x.harness.render();
  assert(
    x
      .nodes()
      .some((x) => x.type === "Notice" && x.props.message.includes("unknown")),
  );
  assert(!x.nodes().some((x) => x.props.label === "Check now"));
  x.harness.unmount();
});

test("readiness renders Unknown for absent evidence and Not configured only for an explicit result", () => {
  const x = setup();
  const readinessText = () => {
    const summary = x.nodes().find((node) => node.props.title === "Readiness");
    assert(summary && typeof summary.type === "function");
    const rendered = (summary.type as (props: unknown) => Element)(
      summary.props,
    );
    return elements(rendered)
      .filter((node) => node.type === "Label")
      .map((node) => [node.props.children].flat(Infinity).join(""))
      .join(" ");
  };
  assert.match(readinessText(), /Readiness: Unknown/);
  assert.doesNotMatch(readinessText(), /Not configured/);
  x.query.data.response.configuration.owner_config.readiness = {
    path: "readyz",
    expect_status: [200],
  };
  x.harness.render();
  assert.match(readinessText(), /Readiness: Unknown/);
  x.query.data.response.can_manage = false;
  x.query.data.response.configuration = null;
  x.harness.render();
  assert.match(readinessText(), /Readiness: Unknown/);
  x.query.data.response.status.readiness = {
    ...check,
    status: "not_configured",
  };
  x.harness.render();
  assert.match(readinessText(), /Readiness: Not configured/);
  x.harness.unmount();
});

test("synchronous AppState loss fences a late result without relying on a render", async () => {
  const x = setup();
  const pending = deferred<any>();
  x.operation(() => pending.promise);
  x.button("Check now").props.onPress();
  x.appState("inactive");
  x.appState("active");
  pending.resolve({ kind: "probe", result: x.query.data.response.status });
  await x.harness.settle();
  assert(
    x
      .nodes()
      .some(
        (node) => node.props.label === "Reload and review latest monitoring",
      ),
  );
  assert.equal(x.button("Check now").props.disabled, true);
  assert([...x.cached.values()].includes(true));
  x.harness.unmount();
});

test("live can_probe/can_manage and pending refresh remove execution and configuration controls", () => {
  const x = setup();
  x.query.data.response.can_probe = false;
  x.query.data.response.can_manage = false;
  x.harness.render();
  assert(
    !x
      .nodes()
      .some((x) =>
        ["Check now", "Configure monitoring"].includes(x.props.label),
      ),
  );
  x.query.isFetching = true;
  x.harness.render();
  assert.equal(x.button("Refresh monitoring").props.disabled, true);
  x.harness.unmount();
});

test("test draft uses validation endpoint contract and preserves reviewed revision for save", async () => {
  const x = setup();
  x.button("Configure monitoring").props.onPress();
  x.harness.flush();
  assert(x.editing.includes(true));
  x.operation(async () => ({
    kind: "validate",
    result: x.query.data.response.status,
  }));
  x.button("Test draft").props.onPress();
  await x.harness.settle();
  assert.deepEqual(JSON.parse(JSON.stringify((x.calls[0] as any[])[2])), {
    kind: "validate",
    checks: {
      health: { path: "healthz", expect_status: [200] },
      readiness: null,
    },
  });
  x.operation(async () => ({
    kind: "configuration",
    result: x.query.data.response.configuration,
  }));
  x.button("Save monitoring").props.onPress();
  await x.harness.settle();
  assert.equal((x.calls[1] as any[])[2].revision, 7);
  assert.equal(x.refreshes(), 1);
  x.harness.unmount();
});

test("conflict preserves draft and prevents retry until explicit reload and review", async () => {
  const x = setup();
  x.button("Configure monitoring").props.onPress();
  x.harness.flush();
  x.operation(async () => {
    throw new ApiError({
      statusCode: 409,
      errorCode: 1,
      errorKey: "conflict",
      message: "conflict",
    });
  });
  x.button("Save monitoring").props.onPress();
  await x.harness.settle();
  assert.equal(x.button("Save monitoring").props.disabled, true);
  assert(
    x
      .nodes()
      .some(
        (x) =>
          x.type === "Notice" && x.props.message.includes("not overwritten"),
      ),
  );
  x.button("Reload and review latest monitoring").props.onPress();
  await x.harness.settle();
  assert(x.nodes().some((x) => x.props.label === "Configure monitoring"));
  assert.equal(x.calls.length, 1);
  x.harness.unmount();
});

test("clear confirmation preserves its reviewed revision when a newer observation arrives", async () => {
  const x = setup();
  x.button("Clear owner configuration").props.onPress();
  x.harness.flush();
  x.query.data.response.configuration.revision = 8;
  x.harness.render();
  x.operation(async () => ({
    kind: "configuration",
    result: x.query.data.response.configuration,
  }));
  x.button("Confirm clear configuration").props.onPress();
  await x.harness.settle();
  assert.equal((x.calls[0] as any[])[2].revision, 7);
  x.harness.unmount();
});

test("duplicate execution is locked; focus loss fences late results", async () => {
  const x = setup();
  const pending = deferred<any>();
  x.operation(() => pending.promise);
  const button = x.button("Check now");
  button.props.onPress();
  button.props.onPress();
  assert.equal(x.calls.length, 1);
  assert(x.busyChanges.includes(true));
  x.active(false);
  pending.resolve({ kind: "probe", result: x.query.data.response.status });
  await x.harness.settle();
  assert.equal(x.harness.value(), null);
  assert(x.cancelled.length > 0);
  x.active(true);
  assert(
    x
      .nodes()
      .some((x) => x.props.label === "Reload and review latest monitoring"),
  );
  x.harness.unmount();
});

test("invalid draft cannot execute and background discards draft content", async () => {
  const x = setup();
  x.button("Configure monitoring").props.onPress();
  x.harness.flush();
  const field = x
    .nodes()
    .find((x) => x.type === "Field" && x.props.label === "health GET path")!;
  field.props.onChangeText("https://unsafe.example/run");
  x.harness.flush();
  x.button("Test draft").props.onPress();
  await x.harness.settle();
  assert.equal(x.calls.length, 0);
  assert(
    x.nodes().some((x) => x.type === "Notice" && x.props.tone === "error"),
  );
  x.active(false);
  x.active(true);
  assert(!x.nodes().some((x) => x.type === "Field"));
  x.harness.unmount();
});
