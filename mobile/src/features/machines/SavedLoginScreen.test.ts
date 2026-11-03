import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { deferred, hookHarness } from "../assistant/assistantHookTestHarness";
import * as transport from "./savedLoginEditorTransport";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
type Element = { type: unknown; props: Record<string, any> };
function all(value: Element): Element[] {
  return [
    value,
    ...[value.props.children]
      .flat(Infinity)
      .flatMap((child) =>
        child && typeof child === "object" && "props" in child
          ? all(child)
          : [],
      ),
  ];
}
const jsx = (type: unknown, props: any): Element => ({ type, props });
const ui = Object.fromEntries(
  ["ActionButton", "Card", "Field", "Label", "Notice", "WorkspacePage"].map(
    (name) => [name, name],
  ),
);
function editor() {
  const gate = deferred<void>();
  const busy: boolean[] = [];
  const runtime = {
    epoch: 1,
    active: true,
    busy: false,
    uncertain: false,
    run: async (action: any) => {
      runtime.busy = true;
      try {
        await action(() => true);
      } finally {
        runtime.busy = false;
      }
    },
  };
  const harness = hookHarness<Element>({
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      Platform: { OS: "ios" },
      Switch: "Switch",
      AppState: { addEventListener: () => ({ remove() {} }) },
    },
    "expo-screen-capture": {
      preventScreenCaptureAsync: async () => {},
      allowScreenCaptureAsync: async () => {},
      enableAppSwitcherProtectionAsync: async () => {},
      disableAppSwitcherProtectionAsync: async () => {},
    },
    "./desktopPrivacy": { desktopPrivacyQueue: (action: any) => action() },
    "./MachineUI": {
      useMachineWrite: () => runtime,
      machineKeys: () => ["machines"],
    },
    "../../components/workspace/WorkspaceUI": ui,
    "../../lib/api/http": {},
    "./savedLoginEditorTransport": {
      ...transport,
      createSavedLoginEditorApi: () => ({
        owners: async () => [],
        save: async () => gate.promise,
      }),
    },
    "@tanstack/react-query": {
      useQuery: () => ({
        data: [{ id: ORG, slug: "team", display_name: "Team" }],
        isError: false,
      }),
    },
  });
  const module = harness.load(
    fileURLToPath(new URL("./SavedLoginEditor.tsx", import.meta.url)),
  ) as { SavedLoginEditor: (props: any) => Element };
  harness.mount(() =>
    module.SavedLoginEditor({
      userId: USER,
      onBusy: (value: boolean) => busy.push(value),
      onClose() {},
      onSaved() {},
      onUncertain() {},
    }),
  );
  function find(type: string, label: string) {
    const result = all(harness.value()).find(
      (item) => item.type === type && item.props.label === label,
    );
    assert.ok(result, label);
    return result;
  }
  const change = (label: string, value: string) => {
    find("Field", label).props.onChangeText(value);
    harness.flush();
  };
  return { harness, gate, busy, runtime, find, change };
}
test("switching credential owner and leaving foreground both erase credential fields", async (t) => {
  const screen = editor();
  t.after(screen.harness.unmount);
  await screen.harness.settle();
  screen.change("Username", "alice");
  screen.change("Password (optional)", "secret");
  screen.change("Authenticator secret or otpauth URL (optional)", "totp");
  screen.find("ActionButton", "Use Team").props.onPress();
  screen.harness.flush();
  assert.equal(screen.find("Field", "Username").props.value, "");
  assert.equal(screen.find("Field", "Password (optional)").props.value, "");
  assert.equal(
    screen.find("Field", "Authenticator secret or otpauth URL (optional)").props
      .value,
    "",
  );
  screen.change("Password (optional)", "new-secret");
  screen.runtime.active = false;
  screen.harness.render();
  assert.equal(screen.find("Field", "Password (optional)").props.value, "");
});
test("save synchronously locks parent navigation until request completion", async (t) => {
  const screen = editor();
  t.after(screen.harness.unmount);
  await screen.harness.settle();
  screen.change("Label", "GitHub");
  screen.change("Allowed HTTPS origins (one per line)", "https://github.com");
  screen.change("Username", "alice");
  screen.find("ActionButton", "Save login for selected owner").props.onPress();
  assert.deepEqual(screen.busy, [true]);
  await screen.harness.settle();
  assert.equal(
    screen.find("ActionButton", "Cancel and clear credentials").props.disabled,
    true,
  );
  screen.gate.resolve();
  await screen.harness.settle();
  assert.deepEqual(screen.busy, [true, false]);
});
test("parent locks Back, tabs, refresh and Web handoff while the editor saves", () => {
  let back: any;
  const runtime = { epoch: 1, active: true, busy: false, uncertain: false };
  const harness = hookHarness<Element>({
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { View: "View" },
    "../../app/WorkspaceHeader": {
      useWorkspaceBack: (options: any) => {
        back = options;
      },
    },
    "../../components/workspace/WorkspaceUI": ui,
    "../../components/SegmentControl": { SegmentControl: "SegmentControl" },
    "../../components/StatusBadge": { StatusBadge: "StatusBadge" },
    "../../components/SectionBadge": { SectionBadge: "SectionBadge" },
    "../../lib/api/machinesApi": { machinesApi: {} },
    "./machineContracts": {
      machineWebPath: () => "/assistant/machines?tab=logins",
    },
    "./MachineUI": {
      useMachineWrite: () => runtime,
      machineKeys: () => [],
      confirmDiscard: (_dirty: boolean, action: any) => action(),
    },
    "./MachinePresentation": { machineStyles: {}, machineTabs: [] },
    "./SavedLoginEditor": { SavedLoginEditor: "SavedLoginEditor" },
    "./savedLoginEditorTransport": transport,
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useQuery: () => ({ data: [], isSuccess: true }),
    },
  });
  const module = harness.load(
    fileURLToPath(new URL("./SavedLogins.tsx", import.meta.url)),
  ) as { SavedLogins: (props: any) => Element };
  harness.mount(() =>
    module.SavedLogins({
      inventory: { userId: USER, nodes: [] },
      onWeb() {},
      onMachines() {},
    }),
  );
  all(harness.value())
    .find((item) => item.props.label === "Add saved login")!
    .props.onPress();
  harness.flush();
  all(harness.value())
    .find((item) => item.type === "SavedLoginEditor")!
    .props.onBusy(true);
  harness.flush();
  assert.equal(back.disabled, true);
  assert.equal(
    all(harness.value()).find((item) => item.type === "SegmentControl")!.props
      .disabled,
    true,
  );
  assert.equal(
    all(harness.value()).find(
      (item) => item.props.label === "Saved logins on web",
    )!.props.disabled,
    true,
  );
  assert.equal(
    all(harness.value()).find(
      (item) => item.props.label === "Refresh saved login metadata",
    )!.props.disabled,
    true,
  );
  harness.unmount();
});

async function realEditor() {
  const gate = deferred<void>();
  const busy: boolean[] = [];
  let saves = 0;
  let back: any;
  const appListeners = new Set<(state: string) => void>();
  const native = {
    Platform: { OS: "ios" },
    Switch: "Switch",
    View: "View",
    Alert: { alert() {} },
    AppState: {
      currentState: "active",
      addEventListener: (_event: string, listener: (state: string) => void) => {
        appListeners.add(listener);
        return { remove: () => appListeners.delete(listener) };
      },
    },
  };
  const navigation = { addListener: () => () => {} };
  const machineUI: Record<string, unknown> = {};
  const harness = hookHarness<Element>({
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": native,
    "@react-navigation/native": {
      useIsFocused: () => true,
      useNavigation: () => navigation,
    },
    "../../hooks/useNetworkStatus": {
      useNetworkStatus: () => ({ isConnected: true }),
    },
    "../../lib/auth/authEpoch": { getAuthEpoch: () => 901 },
    "../../lib/env": { NYXID_FRONTEND_URL: "https://nyxid.example" },
    "expo-web-browser": { openBrowserAsync: async () => ({ type: "cancel" }) },
    "../../app/WorkspaceHeader": {
      useWorkspaceBack: (options: any) => {
        back = options;
      },
    },
    "expo-screen-capture": {
      preventScreenCaptureAsync: async () => {},
      allowScreenCaptureAsync: async () => {},
      enableAppSwitcherProtectionAsync: async () => {},
      disableAppSwitcherProtectionAsync: async () => {},
    },
    "./desktopPrivacy": { desktopPrivacyQueue: (action: any) => action() },
    "../../components/workspace/WorkspaceUI": ui,
    "../../components/SegmentControl": { SegmentControl: "SegmentControl" },
    "../../components/StatusBadge": { StatusBadge: "StatusBadge" },
    "../../components/SectionBadge": { SectionBadge: "SectionBadge" },
    "./MachineUI": machineUI,
    "./MachinePresentation": { machineStyles: {}, machineTabs: [] },
    "../../lib/api/http": {},
    "../../lib/api/machinesApi": { machinesApi: {} },
    "./SavedLoginEditor": { SavedLoginEditor: "SavedLoginEditor" },
    "./savedLoginEditorTransport": {
      ...transport,
      createSavedLoginEditorApi: () => ({
        owners: async () => [],
        save: async () => {
          saves++;
          await gate.promise;
        },
      }),
    },
    "@tanstack/react-query": {
      useQueryClient: () => ({ invalidateQueries: async () => {} }),
      useQuery: () => ({ data: [], isSuccess: true }),
    },
  });
  Object.assign(
    machineUI,
    harness.load(fileURLToPath(new URL("./MachineUI.tsx", import.meta.url))),
  );
  const { SavedLogins } = harness.load(
    fileURLToPath(new URL("./SavedLogins.tsx", import.meta.url)),
  ) as { SavedLogins: (props: any) => Element };
  const { SavedLoginEditor } = harness.load(
    fileURLToPath(new URL("./SavedLoginEditor.tsx", import.meta.url)),
  ) as { SavedLoginEditor: (props: any) => Element };
  harness.mount(() => {
    const parent = SavedLogins({
      inventory: { userId: USER, nodes: [] },
      onWeb() {},
      onMachines() {},
    });
    const child = all(parent).find((item) => item.type === "SavedLoginEditor");
    return jsx("Screen", {
      children: [
        parent,
        child &&
          SavedLoginEditor({
            ...child.props,
            onBusy: (value: boolean) => {
              busy.push(value);
              child.props.onBusy(value);
            },
          }),
      ],
    });
  });
  const find = (type: string, label: string) => {
    const element = all(harness.value()).find(
      (item) => item.type === type && item.props.label === label,
    );
    assert.ok(element, label);
    return element;
  };
  find("ActionButton", "Add saved login").props.onPress();
  await harness.settle();
  return {
    harness,
    gate,
    busy,
    find,
    saves: () => saves,
    back: () => back,
    appListeners,
    appState: (value: string) => {
      native.AppState.currentState = value;
      for (const listener of appListeners) listener(value);
    },
  };
}

test("queued submissions keep the real parent and editor write locks until the admitted save settles", async (t) => {
  const screen = await realEditor();
  t.after(screen.harness.unmount);
  const { find, harness, busy, gate } = screen;
  for (const [label, value] of [
    ["Label", "GitHub"],
    ["Allowed HTTPS origins (one per line)", "https://github.com"],
    ["Username", "alice"],
    ["Password (optional)", "test-credential"],
  ] as const) {
    find("Field", label).props.onChangeText(value);
    harness.flush();
  }
  const submit = find("ActionButton", "Save login for selected owner").props
    .onPress;
  assert.equal(
    find("ActionButton", "Save login for selected owner").props.disabled,
    false,
  );
  // Both events retain the same pre-render closure. The second must not release
  // the parent's navigation lock while the first request remains unresolved.
  submit();
  submit();
  await harness.settle();
  assert.equal(screen.saves(), 1);
  assert.deepEqual(busy, [true]);
  assert.equal(screen.back().disabled, true);
  assert.equal(
    all(harness.value()).find((item) => item.type === "SegmentControl")!.props
      .disabled,
    true,
  );
  for (const label of [
    "Saved logins on web",
    "Refresh saved login metadata",
    "Cancel and clear credentials",
  ])
    assert.equal(find("ActionButton", label).props.disabled, true, label);
  gate.resolve();
  await harness.settle();
  assert.deepEqual(busy, [true, false]);
  assert.equal(screen.back().disabled, false);
  assert.equal(
    find("ActionButton", "Saved logins on web").props.disabled,
    false,
  );
});

test("a native inactive and active cycle clears every credential even when React never renders the inactive state", async (t) => {
  const screen = await realEditor();
  t.after(screen.harness.unmount);
  for (const [label, value] of [
    ["Label", "GitHub"],
    ["Allowed HTTPS origins (one per line)", "https://github.com"],
    ["Username", "alice"],
    ["Password (optional)", "test-password"],
    ["Authenticator secret or otpauth URL (optional)", "test-authenticator"],
  ] as const) {
    screen.find("Field", label).props.onChangeText(value);
    screen.harness.flush();
  }
  assert.equal(screen.find("Field", "Username").props.editable, true);
  screen.appState("inactive");
  screen.appState("active");
  screen.harness.flush();
  for (const label of [
    "Username",
    "Password (optional)",
    "Authenticator secret or otpauth URL (optional)",
  ])
    assert.equal(screen.find("Field", label).props.value, "", label);
  assert.equal(screen.find("Field", "Label").props.value, "GitHub");
  assert.equal(
    screen.find("Field", "Allowed HTTPS origins (one per line)").props.value,
    "https://github.com",
  );
  assert.equal(
    screen.find("ActionButton", "Save login for selected owner").props.disabled,
    true,
  );
  assert.equal(screen.saves(), 0);
  screen.harness.unmount();
  assert.equal(screen.appListeners.size, 0);
});
