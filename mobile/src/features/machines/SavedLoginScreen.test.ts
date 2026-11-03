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
    "react-native": { Platform: { OS: "ios" }, Switch: "Switch" },
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
