import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hookHarness, deferred } from "../assistant/assistantHookTestHarness";
import * as contracts from "./managementContracts";

type E = { type: any; props: any };
const nodes = (n: any): E[] =>
  n?.props ? [n, ...[n.props.children].flat(Infinity).flatMap(nodes)] : [];
const original = contracts.assistantSettingsSchema.parse({
  timezone: "UTC",
  max_live_subagents: 3,
  max_concurrent_subagent_turns: 2,
  max_live_subagents_limit: 8,
  max_concurrent_subagent_turns_limit: 4,
});
function setup() {
  let epoch = 1;
  const runtime = { active: true, online: true };
  let latest: () => Promise<contracts.AssistantSettings> = async () => original;
  const writes: any[] = [];
  let fail = false;
  let queryData = original;
  let appState: (state: string) => void = () => {};
  let beforeDispatch: (guard: () => void) => Promise<void> = async () => {};
  let response: () => Promise<void> = async () => {};
  const mocks: Record<string, unknown> = {
    "react/jsx-runtime": {
      jsx: (type: any, props: any) => ({ type, props }),
      jsxs: (type: any, props: any) => ({ type, props }),
      Fragment: "Fragment",
    },
    "react-native": {
      View: "View",
      Alert: { alert() {} },
      AppState: {
        addEventListener: (_: string, callback: typeof appState) => {
          appState = callback;
          return { remove() {} };
        },
      },
    },
    "@tanstack/react-query": {
      useQueryClient: () => ({
        invalidateQueries: async () => {},
        setQueryData: (_: any, value: any) => {
          queryData = value;
        },
      }),
      useQuery: ({ queryKey }: any) => ({
        data: queryKey.includes("channels")
          ? []
          : queryKey.includes("agents")
            ? { agents: [] }
            : queryData,
        isError: false,
        isFetching: false,
        refetch: async () => ({ data: queryData, isError: false }),
      }),
    },
    "../../components/workspace/WorkspaceUI": Object.fromEntries(
      ["ActionButton", "Card", "Field", "Label", "Notice", "WorkspacePage"].map(
        (name) => [name, name],
      ),
    ),
    "../../app/WorkspaceHeader": { useWorkspaceBack() {} },
    "../../lib/auth/authEpoch": { getAuthEpoch: () => epoch },
    "../../lib/api/agentsApi": { agentsApi: {} },
    "../../lib/api/assistantManagementApi": {
      assistantManagementApi: {
        settings: () => latest(),
        update: async (patch: any, guard: () => void) => {
          await beforeDispatch(guard);
          guard();
          writes.push(patch);
          await response();
          if (fail) throw new Error("Network response lost");
          return { ...original, ...patch };
        },
      },
    },
    "../automations/AutomationUI": {
      ChoiceField: "ChoiceField",
      automationError: (cause: any) => cause.message,
      automationStyles: {},
      useAutomationRuntime: () => runtime,
    },
    "../automations/automationTime": { deviceTimezone: () => "UTC" },
    "./ManagementHandoff": { ManagementHandoff: "ManagementHandoff" },
    "./managementContracts": contracts,
  };
  const h = hookHarness<E>(mocks);
  mocks["./useManagementWriteScope"] = h.load(
    fileURLToPath(new URL("./useManagementWriteScope.ts", import.meta.url)),
  );
  const Component = h.load(
    fileURLToPath(new URL("./AssistantManagementScreen.tsx", import.meta.url)),
  ).AssistantManagementScreen as any;
  h.mount(() => Component({ navigation: { goBack() {} } }));
  const control = (label: string) =>
    nodes(h.value()).find((n) => n.props.label === label)!;
  return {
    h,
    writes,
    runtime,
    control,
    backgroundReturn: () => {
      appState("background");
      appState("active");
    },
    blurReturn: () => {
      runtime.active = false;
      h.render();
      runtime.active = true;
      h.render();
    },
    beforeDispatch: (wait: typeof beforeDispatch) => {
      beforeDispatch = wait;
    },
    response: (wait: typeof response) => {
      response = wait;
    },
    edit: (label: string, value: string) => {
      control(label).props.onChangeText(value);
      h.flush();
    },
    latest: (read: typeof latest) => {
      latest = read;
    },
    switchAccount: () => {
      epoch++;
    },
    fail: () => {
      fail = true;
    },
  };
}

test("screen loads server values, saves only dirty fields and renders the authoritative result", async () => {
  const x = setup();
  assert.equal(x.control("Save settings").props.disabled, true);
  x.edit("Live specialists", "5");
  assert.equal(x.control("Save settings").props.disabled, false);
  x.control("Save settings").props.onPress();
  await x.h.settle();
  assert.deepEqual(x.writes, [{ max_live_subagents: 5 }]);
  assert.equal(x.control("Live specialists").props.value, "5");
  assert.equal(x.control("Save settings").props.disabled, true);
  x.h.unmount();
});

test("a field edited elsewhere or a lowered ceiling requires reload before write", async () => {
  for (const latest of [
    { ...original, max_live_subagents: 4 },
    { ...original, max_live_subagents_limit: 4 },
  ]) {
    const x = setup();
    x.edit("Live specialists", "5");
    x.latest(async () => latest);
    x.control("Save settings").props.onPress();
    await x.h.settle();
    assert.equal(x.writes.length, 0);
    assert.ok(
      nodes(x.h.value()).some(
        (n) => n.type === "Notice" && /elsewhere|0 to 4/.test(n.props.message),
      ),
    );
    x.h.unmount();
  }
});

test("account switch during preflight prevents a write and uncertain network results cannot be repeated", async () => {
  const x = setup();
  const read = deferred<contracts.AssistantSettings>();
  x.edit("Live specialists", "5");
  x.latest(() => read.promise);
  x.control("Save settings").props.onPress();
  x.switchAccount();
  read.resolve(original);
  await x.h.settle();
  assert.equal(x.writes.length, 0);
  x.h.unmount();
  const y = setup();
  y.edit("Live specialists", "5");
  y.fail();
  y.control("Save settings").props.onPress();
  await y.h.settle();
  assert.equal(y.writes.length, 1);
  assert.equal(y.control("Save settings").props.disabled, true);
  y.control("Save settings").props.onPress();
  await y.h.settle();
  assert.equal(y.writes.length, 1);
  y.h.unmount();
});

test("an interrupted settings preflight stays invalid after foreground or focus returns and after unmount", async () => {
  for (const interruption of ["background", "blur", "unmount"] as const) {
    const x = setup();
    const read = deferred<contracts.AssistantSettings>();
    x.edit("Live specialists", "5");
    x.latest(() => read.promise);
    x.control("Save settings").props.onPress();
    if (interruption === "background") x.backgroundReturn();
    else if (interruption === "blur") x.blurReturn();
    else x.h.unmount();
    read.resolve(original);
    await x.h.settle();
    assert.equal(x.writes.length, 0, interruption);
    x.h.unmount();
  }
});

test("the settings dispatch guard cannot revive after auth wait and a dispatched interrupted write stays unconfirmed", async () => {
  const x = setup();
  const dispatch = deferred<void>();
  let callback: (() => void) | undefined;
  x.beforeDispatch(async (guard) => {
    callback = guard;
    await dispatch.promise;
  });
  x.edit("Live specialists", "5");
  x.control("Save settings").props.onPress();
  await x.h.settle();
  x.backgroundReturn();
  assert.throws(() => callback!(), /interrupted/);
  dispatch.resolve();
  await x.h.settle();
  assert.equal(x.writes.length, 0);
  assert.equal(x.control("Save settings").props.disabled, true);
  x.h.unmount();

  const y = setup();
  const response = deferred<void>();
  y.response(() => response.promise);
  y.edit("Live specialists", "5");
  y.control("Save settings").props.onPress();
  await y.h.settle();
  assert.equal(y.writes.length, 1);
  y.backgroundReturn();
  response.resolve();
  await y.h.settle();
  assert.equal(y.control("Save settings").props.disabled, true);
  assert.ok(
    nodes(y.h.value()).some(
      (n) => n.type === "Notice" && /unconfirmed/.test(n.props.message),
    ),
  );
  y.h.unmount();
});
