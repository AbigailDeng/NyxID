import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hookHarness, deferred } from "../assistant/assistantHookTestHarness";
import * as contracts from "./managementContracts";
import { managementRefreshKeys } from "./managementRefresh";

type E = { type: any; props: any };
const nodes = (n: any): E[] =>
  n?.props ? [n, ...[n.props.children].flat(Infinity).flatMap(nodes)] : [];
function setup() {
  let epoch = 1;
  let focused = true;
  let resume: (state: string) => void = () => {};
  const browser = deferred<void>();
  const opened: string[] = [];
  const invalidated: unknown[] = [];
  const client = {
    invalidateQueries: async ({ queryKey }: any) => {
      invalidated.push([...queryKey]);
    },
  };
  const h = hookHarness<E>({
    "react/jsx-runtime": {
      jsx: (type: any, props: any) => ({ type, props }),
      jsxs: (type: any, props: any) => ({ type, props }),
      Fragment: "Fragment",
    },
    "react-native": {
      AppState: {
        addEventListener: (_: string, callback: any) => {
          resume = callback;
          return { remove() {} };
        },
      },
    },
    "@react-navigation/native": { useIsFocused: () => focused },
    "@tanstack/react-query": { useQueryClient: () => client },
    "expo-web-browser": {
      openBrowserAsync: (url: string) => {
        opened.push(url);
        return browser.promise;
      },
    },
    "../../lib/env": { NYXID_FRONTEND_URL: "https://nyx.example" },
    "../../lib/auth/authEpoch": { getAuthEpoch: () => epoch },
    "../../components/workspace/WorkspaceUI": {
      ActionButton: "Button",
      Label: "Label",
      Notice: "Notice",
    },
    "./managementContracts": contracts,
  });
  const Component = h.load(
    fileURLToPath(new URL("./ManagementHandoff.tsx", import.meta.url)),
  ).ManagementHandoff as any;
  h.mount(() =>
    Component({
      label: "Manage",
      target: { kind: "skills", agentId: "agent-a" },
    }),
  );
  return {
    h,
    browser,
    opened,
    invalidated,
    resume: () => resume("active"),
    switchAccount: () => {
      epoch++;
    },
    blur: () => {
      focused = false;
      h.render();
    },
    button: () => nodes(h.value()).find((n) => n.type === "Button")!,
  };
}

test("browser return reloads real skills, agents, automations and the actual drawer query keys", async () => {
  const x = setup();
  x.button().props.onPress();
  x.h.flush();
  assert.equal(
    x.opened[0],
    "https://nyx.example/assistant?agent=agent-a&details=skills",
  );
  x.browser.resolve();
  await x.h.settle();
  assert.deepEqual(
    x.invalidated,
    managementRefreshKeys.map((key) => [...key]),
  );
  x.invalidated.length = 0;
  x.resume();
  await x.h.settle();
  assert.equal(
    x.invalidated.length,
    managementRefreshKeys.length,
    "Android foreground also refreshes after browser launch returns early",
  );
  x.h.unmount();
});

test("late browser completion cannot refresh or announce success for a different account or hidden page", async () => {
  for (const change of ["account", "blur"] as const) {
    const x = setup();
    x.button().props.onPress();
    x.h.flush();
    if (change === "account") x.switchAccount();
    else x.blur();
    x.browser.resolve();
    await x.h.settle();
    x.resume();
    await x.h.settle();
    assert.equal(x.invalidated.length, 0);
    assert.ok(
      !nodes(x.h.value()).some(
        (n) =>
          typeof n.props.children === "string" &&
          n.props.children.startsWith("Back in"),
      ),
    );
    x.h.unmount();
  }
});
