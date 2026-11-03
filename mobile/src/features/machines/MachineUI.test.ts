import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { deferred, hookHarness } from "../assistant/assistantHookTestHarness";
import * as contracts from "./machineContracts";
import { ApiError } from "../../lib/api/ApiError";
import {
  createSavedLoginEditorApi,
  savedLoginReviewed,
  savedLoginReviewRequired,
} from "./savedLoginEditorTransport";

function setup() {
  let epoch = 1;
  let focused = true;
  let onAppState: ((value: string) => void) | undefined;
  let onBlur: (() => void) | undefined;
  const app = {
    currentState: "active",
    addEventListener: (_event: string, listener: (value: string) => void) => {
      onAppState = listener;
      return {
        remove: () => {
          onAppState = undefined;
        },
      };
    },
  };
  const navigation = {
    addListener: (_event: string, listener: () => void) => {
      onBlur = listener;
      return () => {
        onBlur = undefined;
      };
    },
  };
  const harness = hookHarness<any>({
    "./machineContracts": contracts,
    "react-native": { AppState: app, Alert: { alert() {} } },
    "@react-navigation/native": {
      useIsFocused: () => focused,
      useNavigation: () => navigation,
    },
    "expo-web-browser": {},
    zod: { z: { ZodError: class {} } },
    "../../hooks/useNetworkStatus": {
      useNetworkStatus: () => ({ isConnected: true }),
    },
    "../../lib/auth/authEpoch": { getAuthEpoch: () => epoch },
    "../../lib/api/ApiError": { ApiError },
    "../../lib/env": { NYXID_FRONTEND_URL: "https://example.test" },
  });
  const module = harness.load(
    fileURLToPath(new URL("./MachineUI.tsx", import.meta.url)),
  ) as { useMachineWrite: () => any };
  harness.mount(() => module.useMachineWrite());
  return {
    harness,
    app,
    setEpoch: (value: number) => {
      epoch = value;
    },
    blur: () => {
      focused = false;
      onBlur?.();
      harness.render();
    },
    transition: (value: string, render = true) => {
      app.currentState = value;
      onAppState?.(value);
      if (render) harness.flush();
    },
    blurAndRefocus: () => {
      onBlur?.();
      focused = true;
      harness.render();
    },
  };
}
test("machine writes synchronously lock double submission and fence account/background changes", async () => {
  const x = setup();
  const gate = deferred<void>();
  let calls = 0;
  let current!: () => boolean;
  const write = x.harness.value();
  const first = write.run(async (guard: () => boolean) => {
    calls++;
    current = guard;
    await gate.promise;
  });
  await write.run(async () => {
    calls++;
  });
  assert.equal(calls, 1);
  x.app.currentState = "background";
  assert.equal(current(), false);
  x.app.currentState = "active";
  x.setEpoch(2);
  assert.equal(current(), false);
  gate.resolve();
  await first;
  x.harness.unmount();
});
test("uncertain writes pause until explicit review and never retry automatically", async () => {
  const x = setup();
  let calls = 0;
  const oldCallback = x.harness.value().run;
  await oldCallback(async () => {
    calls++;
    throw new Error("Connection lost");
  });
  await oldCallback(async () => {
    calls++;
  });
  assert.equal(calls, 1);
  x.harness.flush();
  assert.equal(x.harness.value().uncertain, true);
  await x.harness.value().run(async () => {
    calls++;
  });
  assert.equal(calls, 1);
  x.harness.value().reviewed();
  x.harness.flush();
  assert.equal(x.harness.value().uncertain, false);
  x.harness.unmount();
});
test("structured forbidden machine errors preserve code without becoming uncertain or signing out", async () => {
  const x = setup();
  await x.harness.value().run(async () => {
    throw new ApiError({
      errorKey: "machine_permission_revoked",
      errorCode: 12420,
      statusCode: 403,
      message: "Permission revoked",
    });
  });
  x.harness.flush();
  assert.match(x.harness.value().error, /12420/);
  assert.equal(x.harness.value().uncertain, false);
  x.harness.unmount();
});

test("a write attempt stays invalid after batched background and foreground while cleanup and fresh actions work", async (t) => {
  const x = setup();
  t.after(x.harness.unmount);
  const gate = deferred<void>();
  let current!: () => boolean;
  const running = x.harness.value().run(async (guard: () => boolean) => {
    current = guard;
    await gate.promise;
  });
  x.transition("inactive", false);
  x.transition("active", false);
  assert.equal(current(), false);
  assert.equal(x.harness.value().current(), true);
  gate.resolve();
  await running;
  x.harness.flush();
  assert.equal(x.harness.value().busy, false);
  let freshCalls = 0;
  await x.harness.value().run(async (guard: () => boolean) => {
    assert.equal(guard(), true);
    freshCalls++;
  });
  assert.equal(freshCalls, 1);
});

test("native blur invalidates an action even when blur and focus render as focused", async (t) => {
  const x = setup();
  t.after(x.harness.unmount);
  const gate = deferred<void>();
  let current!: () => boolean;
  const running = x.harness.value().run(async (guard: () => boolean) => {
    current = guard;
    await gate.promise;
  });
  x.blurAndRefocus();
  assert.equal(x.harness.value().interactive(), true);
  assert.equal(current(), false);
  gate.resolve();
  await running;
  x.harness.flush();
  assert.equal(x.harness.value().busy, false);
});

const USER = "10000000-0000-4000-8000-000000000091";
const ORG = "20000000-0000-4000-8000-000000000091";
const loginInput = () => ({
  label: "Test fixture",
  allowed_origins: ["https://example.test"],
  username: "fixture-user",
  password: "fixture-secret",
  totp_secret: "",
  confirm_each_sign_in: true,
});
const loginMetadata = {
  id: "fixture-login",
  owner_id: USER,
  label: "Test fixture",
  allowed_origins: ["https://example.test"],
  has_password: true,
  has_totp: false,
  confirm_each_sign_in: true,
  updated_at: "after",
  created_at: "after",
};

test("a background round trip during saved-login authority reads dispatches zero writes", async (t) => {
  const x = setup();
  t.after(x.harness.unmount);
  savedLoginReviewed(USER);
  const gate = deferred<unknown>();
  let writes = 0;
  const api = createSavedLoginEditorApi(async (_path, options) => {
    if (options.method === "GET") return gate.promise;
    writes++;
    return { ...loginMetadata, owner_id: ORG };
  });
  const values = loginInput();
  const running = x.harness.value().run(async (current: () => boolean) => {
    await api.save(values, ORG, USER, current);
  });
  x.transition("background", false);
  x.transition("active", false);
  gate.resolve({ orgs: [{ id: ORG, your_role: "admin", slug: "fixture" }] });
  await running;
  x.harness.flush();
  assert.equal(writes, 0);
  assert.equal(values.password, "");
  assert.equal(savedLoginReviewRequired(USER), false);
  assert.equal(x.harness.value().uncertain, false);
  assert.equal(x.harness.value().busy, false);
});

test("a background round trip after saved-login dispatch retains account review across hook remount", async (t) => {
  const x = setup();
  savedLoginReviewed(USER);
  t.after(() => savedLoginReviewed(USER));
  const gate = deferred<unknown>();
  let writes = 0;
  const api = createSavedLoginEditorApi(async (_path, options) => {
    assert.equal(options.method, "POST");
    writes++;
    return gate.promise;
  });
  const values = loginInput();
  const running = x.harness.value().run(async (current: () => boolean) => {
    await api.save(values, USER, USER, current);
  });
  assert.equal(writes, 1);
  x.transition("inactive", false);
  x.transition("active", false);
  gate.resolve(loginMetadata);
  await running;
  x.harness.flush();
  assert.equal(x.harness.value().uncertain, true);
  assert.equal(x.harness.value().busy, false);
  assert.equal(savedLoginReviewRequired(USER), true);
  assert.equal(values.password, "");
  x.harness.unmount();
  const remounted = setup();
  t.after(remounted.harness.unmount);
  assert.equal(savedLoginReviewRequired(USER), true);
  savedLoginReviewed(USER);
  assert.equal(savedLoginReviewRequired(USER), false);
});
