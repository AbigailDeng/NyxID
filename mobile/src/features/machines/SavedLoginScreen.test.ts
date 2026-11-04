import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { deferred, hookHarness } from "../assistant/assistantHookTestHarness";
import * as transport from "./savedLoginEditorTransport";
import type { SavedLogin } from "./machineContracts";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
type Element = { type: unknown; props: Record<string, any> };
function all(value: Element): Element[] {
  return [
    value,
    ...[value.props.header, value.props.children]
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
const toolbarNative = {
  View: "View",
  Pressable: "Pressable",
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
};
const toolbarModules = {
  "../../theme/ThemeContext": { useTheme: () => ({ colors: {} }) },
  "../../theme/designTokens": { radius: { md: 8 }, TOUCH_TARGET: 44 },
  "lucide-react-native": {
    MoreHorizontal: "MoreHorizontal",
    Plus: "Plus",
    RefreshCw: "RefreshCw",
  },
};
function editor(login?: SavedLogin) {
  const gate = deferred<void>();
  const busy: boolean[] = [];
  let userId = USER;
  const appListeners = new Set<(state: string) => void>();
  const navigation = { addListener: () => () => {} };
  const runtime = {
    epoch: 1,
    active: true,
    busy: false,
    uncertain: false,
    interactive: () => runtime.active,
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
      AppState: {
        addEventListener: (
          _event: string,
          listener: (state: string) => void,
        ) => {
          appListeners.add(listener);
          return { remove: () => appListeners.delete(listener) };
        },
      },
    },
    "@react-navigation/native": { useNavigation: () => navigation },
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
      userId,
      login,
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
  return {
    harness,
    gate,
    busy,
    runtime,
    find,
    change,
    appState: (state: string) => {
      runtime.active = state === "active";
      for (const listener of appListeners) listener(state);
    },
    account: (id: string) => {
      userId = id;
      runtime.epoch++;
      harness.render();
    },
  };
}
test("switching credential owner erases every credential field", async (t) => {
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
});
test("loss of interactivity pauses editing without deleting the draft", async (t) => {
  const screen = editor();
  t.after(screen.harness.unmount);
  await screen.harness.settle();
  screen.change("Username", "alice");
  screen.change("Password (optional)", "secret");
  screen.runtime.active = false;
  screen.harness.render();
  assert.equal(screen.find("Field", "Username").props.value, "alice");
  assert.equal(
    screen.find("Field", "Password (optional)").props.value,
    "secret",
  );
  assert.equal(
    screen.find("Field", "Password (optional)").props.editable,
    false,
  );
});
test("switching accounts clears credentials and selects the new personal owner", async (t) => {
  const screen = editor();
  t.after(screen.harness.unmount);
  await screen.harness.settle();
  screen.change("Username", "alice");
  screen.change("Password (optional)", "secret");
  screen.change("Authenticator secret or otpauth URL (optional)", "totp");
  screen.account(ORG);
  for (const label of [
    "Username",
    "Password (optional)",
    "Authenticator secret or otpauth URL (optional)",
  ])
    assert.equal(screen.find("Field", label).props.value, "", label);
  assert.ok(
    all(screen.harness.value()).some(
      (element) =>
        element.type === "Label" &&
        JSON.stringify(element.props.children).includes(
          "Your personal account",
        ),
    ),
  );
});
test("backgrounding a replacement requires renewed acknowledgement before blank secrets can replace stored values", async (t) => {
  const screen = editor({
    id: "login-1",
    owner_id: USER,
    label: "GitHub",
    allowed_origins: ["https://github.com"],
    has_password: true,
    has_totp: true,
    confirm_each_sign_in: true,
    created_at: "2026-11-04T00:00:00Z",
    updated_at: "2026-11-04T00:00:00Z",
  });
  t.after(screen.harness.unmount);
  await screen.harness.settle();
  screen.change("Username", "alice");
  screen.change("Password (optional)", "replacement-password");
  screen.change(
    "Authenticator secret or otpauth URL (optional)",
    "replacement-totp",
  );
  const acknowledgement = () =>
    all(screen.harness.value()).find(
      (element) =>
        element.type === "Switch" &&
        element.props.accessibilityLabel ===
          "Acknowledge full credential replacement",
    )!;
  acknowledgement().props.onValueChange(true);
  screen.harness.flush();
  assert.equal(
    screen.find("ActionButton", "Replace all saved-login values").props
      .disabled,
    false,
  );
  screen.appState("background");
  screen.appState("active");
  screen.harness.flush();
  assert.equal(screen.find("Field", "Username").props.value, "alice");
  assert.equal(screen.find("Field", "Password (optional)").props.value, "");
  assert.equal(
    screen.find("Field", "Authenticator secret or otpauth URL (optional)").props
      .value,
    "",
  );
  assert.equal(acknowledgement().props.value, false);
  assert.equal(
    screen.find("ActionButton", "Replace all saved-login values").props
      .disabled,
    true,
  );
  assert.ok(
    all(screen.harness.value()).some(
      (element) =>
        element.type === "Notice" &&
        element.props.message.includes("Re-enter any secrets you want to save"),
    ),
  );
  acknowledgement().props.onValueChange(true);
  screen.harness.flush();
  assert.equal(
    screen.find("ActionButton", "Replace all saved-login values").props
      .disabled,
    false,
  );
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
test("parent rejects stale Web callbacks and refresh during editing, then locks navigation while saving", () => {
  let back: any;
  let generation = 0;
  let refreshes = 0;
  const webPaths: string[] = [];
  const optionCallbacks: Array<() => void> = [];
  const runtime = {
    epoch: 1,
    active: true,
    busy: false,
    uncertain: false,
    current: () => true,
    reviewed() {},
    captureWriteGuard: () => {
      const admittedGeneration = generation;
      return () => admittedGeneration === generation;
    },
  };
  const harness = hookHarness<Element>({
    ...toolbarModules,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      ...toolbarNative,
      Alert: {
        alert: (_title: string, _message: unknown, options: any[]) => {
          optionCallbacks.push(
            options.find((option) => option.text === "Open on web").onPress,
          );
        },
      },
    },
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
      useQuery: () => ({
        data: [],
        isSuccess: true,
        refetch: async () => {
          refreshes++;
          return { isSuccess: true };
        },
      }),
    },
  });
  const module = harness.load(
    fileURLToPath(new URL("./SavedLogins.tsx", import.meta.url)),
  ) as { SavedLogins: (props: any) => Element };
  harness.mount(() =>
    module.SavedLogins({
      inventory: { userId: USER, nodes: [] },
      onWeb: (path: string) => webPaths.push(path),
      onMachines() {},
    }),
  );
  const openOptions = () =>
    all(harness.value())
      .find((item) => item.props.accessibilityLabel === "Saved login options")!
      .props.onPress();
  openOptions();
  optionCallbacks.shift()!();
  assert.deepEqual(webPaths, ["/assistant/machines?tab=logins"]);
  openOptions();
  // A native options callback may arrive after an interruption invalidates
  // its admitted action, even before React has rendered the new state.
  generation++;
  optionCallbacks.shift()!();
  assert.equal(webPaths.length, 1);
  openOptions();
  all(harness.value())
    .find((item) => item.props.accessibilityLabel === "Add saved login")!
    .props.onPress();
  harness.flush();
  optionCallbacks.shift()!();
  assert.equal(webPaths.length, 1);
  all(harness.value())
    .find((item) => item.type === "WorkspacePage")!
    .props.onRefresh();
  assert.equal(refreshes, 0, "pull refresh must preserve an unsaved editor");
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
      (item) => item.props.accessibilityLabel === "Saved login options",
    )!.props.disabled,
    true,
  );
  assert.equal(
    all(harness.value()).find(
      (item) =>
        item.props.accessibilityLabel === "Refresh saved login metadata",
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
  const blurListeners = new Set<() => void>();
  let focused = true;
  const native = {
    ...toolbarNative,
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
  const navigation = {
    addListener: (_event: string, listener: () => void) => {
      blurListeners.add(listener);
      return () => blurListeners.delete(listener);
    },
  };
  const machineUI: Record<string, unknown> = {};
  const harness = hookHarness<Element>({
    ...toolbarModules,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": native,
    "@react-navigation/native": {
      useIsFocused: () => focused,
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
      (item) =>
        item.type === type &&
        (item.props.label === label || item.props.accessibilityLabel === label),
    );
    assert.ok(element, label);
    return element;
  };
  find("Pressable", "Add saved login").props.onPress();
  await harness.settle();
  return {
    harness,
    gate,
    busy,
    find,
    saves: () => saves,
    back: () => back,
    appListeners,
    blur: () => {
      focused = false;
      for (const listener of blurListeners) listener();
    },
    focus: () => {
      focused = true;
    },
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
    "Saved login options",
    "Refresh saved login metadata",
    "Cancel and clear credentials",
  ])
    assert.equal(
      find(
        label === "Cancel and clear credentials" ? "ActionButton" : "Pressable",
        label,
      ).props.disabled,
      true,
      label,
    );
  gate.resolve();
  await harness.settle();
  assert.deepEqual(busy, [true, false]);
  assert.equal(screen.back().disabled, false);
  assert.equal(find("Pressable", "Saved login options").props.disabled, false);
});

test("a temporary native interruption preserves the draft while pausing submission", async (t) => {
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
  const queuedSubmit = screen.find(
    "ActionButton",
    "Save login for selected owner",
  ).props.onPress;
  screen.appState("inactive");
  // An already-queued callback must not erase the draft or dispatch a write.
  await queuedSubmit();
  screen.harness.flush();
  assert.equal(
    screen.find("ActionButton", "Save login for selected owner").props.disabled,
    true,
  );
  assert.equal(screen.find("Field", "Username").props.editable, false);
  screen.appState("active");
  screen.harness.flush();
  for (const [label, expected] of [
    ["Username", "alice"],
    ["Password (optional)", "test-password"],
    ["Authenticator secret or otpauth URL (optional)", "test-authenticator"],
  ] as const)
    assert.equal(screen.find("Field", label).props.value, expected, label);
  assert.equal(screen.find("Field", "Label").props.value, "GitHub");
  assert.equal(
    screen.find("Field", "Allowed HTTPS origins (one per line)").props.value,
    "https://github.com",
  );
  assert.equal(
    screen.find("ActionButton", "Save login for selected owner").props.disabled,
    false,
  );
  assert.equal(screen.saves(), 0);
  screen.harness.unmount();
  assert.equal(screen.appListeners.size, 0);
});

for (const transition of ["background", "navigation blur"] as const) {
  test(`${transition} clears the intended fields even without an intermediate render`, async (t) => {
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
    const queuedSubmit = screen.find(
      "ActionButton",
      "Save login for selected owner",
    ).props.onPress;
    if (transition === "background") {
      screen.appState("background");
      screen.appState("active");
    } else {
      screen.blur();
      screen.focus();
    }
    await queuedSubmit();
    screen.harness.flush();
    assert.equal(
      screen.find("Field", "Username").props.value,
      transition === "background" ? "alice" : "",
    );
    assert.equal(screen.find("Field", "Password (optional)").props.value, "");
    assert.equal(
      screen.find("Field", "Authenticator secret or otpauth URL (optional)")
        .props.value,
      "",
    );
    assert.equal(screen.find("Field", "Label").props.value, "GitHub");
    assert.equal(
      screen.find("Field", "Allowed HTTPS origins (one per line)").props.value,
      "https://github.com",
    );
    assert.equal(screen.saves(), 0);
  });
}
