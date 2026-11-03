import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  hookHarness,
  deferred,
} from "../../assistant/assistantHookTestHarness";
import * as destinations from "./consoleDestinations";
import { createConsoleActivation } from "./consoleActivation";
import { canEditConnection } from "../serviceContracts";

type Element = { type: unknown; props: Record<string, any> };
const elements = (root: Element): Element[] => [
  root,
  ...[root.props.children]
    .flat(Infinity)
    .flatMap((child) =>
      child && typeof child === "object" && "props" in child
        ? elements(child)
        : [],
    ),
];
function setup() {
  let active = true;
  let epoch = 3;
  let user = { id: "person", is_admin: true };
  let identity = async () => user;
  const browsers: string[] = [];
  let browser = async () => {};
  const handlers = new Set<(state: string) => void>();
  const app = {
    currentState: "active",
    addEventListener: (_event: string, handler: (state: string) => void) => {
      handlers.add(handler);
      return { remove: () => handlers.delete(handler) };
    },
  };
  let returned = 0;
  const query = {
    isPending: false,
    isError: false,
    isFetching: false,
    data: { user, orgs: [] },
    refetch: async () => {},
  };
  const harness = hookHarness<Element>({
    "react/jsx-runtime": {
      jsx: (type: unknown, props: unknown) => ({ type, props }),
      jsxs: (type: unknown, props: unknown) => ({ type, props }),
    },
    "@tanstack/react-query": { useQuery: () => query },
    "../../../components/workspace/WorkspaceUI": Object.fromEntries(
      ["ActionButton", "Card", "Label", "Notice"].map((name) => [name, name]),
    ),
    "../../../lib/auth/authEpoch": { getAuthEpoch: () => epoch },
    "react-native": { AppState: app },
    "../../../lib/env": { NYXID_FRONTEND_URL: "https://nyxid.example" },
    "../../../lib/api/servicesApi": { servicesApi: {} },
    "../serviceContracts": { canEditConnection },
    "./consoleActivation": { createConsoleActivation },
    "./consoleDestinations": destinations,
    "./consoleApi": {
      consoleApi: { identity: () => identity(), organizations: async () => [] },
    },
    "expo-web-browser": {
      openBrowserAsync: async (url: string) => {
        browsers.push(url);
        await browser();
      },
    },
  });
  const { ConsoleManagement } = harness.load(
    fileURLToPath(new URL("./ConsoleManagement.tsx", import.meta.url)),
  ) as { ConsoleManagement: (props: unknown) => Element };
  const onReturned = async () => {
    returned++;
  };
  harness.mount(() => ConsoleManagement({ active, onReturned }));
  const button = (label: string) => {
    const node = elements(harness.value()).find(
      (node) => node.props.label === label,
    );
    assert(node, `Missing ${label}`);
    return node;
  };
  button("Show developer console").props.onPress();
  harness.flush();
  return {
    harness,
    browsers,
    returned: () => returned,
    button,
    user: (next: typeof user) => {
      user = next;
    },
    identity: (next: typeof identity) => {
      identity = next;
    },
    browser: (next: typeof browser) => {
      browser = next;
    },
    epoch: () => {
      epoch++;
    },
    appState: (state: string) => {
      app.currentState = state;
      handlers.forEach((handler) => handler(state));
    },
    active: (next: boolean) => {
      active = next;
      harness.render();
    },
    nodes: () => elements(harness.value()),
  };
}

test("console opens its exact destination and requests refresh on return without claiming success", async () => {
  const x = setup();
  x.button("Service Pools · Web").props.onPress();
  await x.harness.settle();
  assert.deepEqual(x.browsers, ["https://nyxid.example/keys?tab=pools"]);
  assert.equal(x.returned(), 1);
  assert(
    x
      .nodes()
      .some(
        (node) =>
          node.type === "Notice" &&
          node.props.message.includes("Refresh was requested"),
      ),
  );
  assert(
    !x.nodes().some((node) => node.props.message?.includes("changes saved")),
  );
  x.harness.unmount();
});

test("revoked console role stops a stale privileged destination before browser opens", async () => {
  const x = setup();
  x.user({ id: "person", is_admin: false });
  x.button("Catalog authoring · Web").props.onPress();
  await x.harness.settle();
  assert.equal(x.browsers.length, 0);
  assert.equal(x.returned(), 0);
  assert(
    x
      .nodes()
      .some((node) => node.type === "Notice" && node.props.tone === "error"),
  );
  x.harness.unmount();
});

test("leaving and returning during access preflight cannot open the stale browser action", async () => {
  const x = setup();
  const pending = deferred<{ id: string; is_admin: boolean }>();
  x.identity(() => pending.promise);
  x.button("Agent Keys · Web").props.onPress();
  x.active(false);
  x.active(true);
  pending.resolve({ id: "person", is_admin: true });
  await x.harness.settle();
  assert.equal(x.browsers.length, 0);
  x.harness.unmount();
});

test("browser background handoff refreshes exactly once after returning to the same account", async () => {
  const x = setup();
  const pending = deferred<void>();
  x.browser(() => pending.promise);
  x.button("Service Pools · Web").props.onPress();
  await x.harness.settle();
  assert.equal(x.browsers.length, 1);
  x.appState("background");
  x.active(false);
  pending.resolve();
  await x.harness.settle();
  assert.equal(x.returned(), 0);
  x.appState("active");
  x.active(true);
  await x.harness.settle();
  assert.equal(x.returned(), 1);
  assert(
    x
      .nodes()
      .some(
        (node) =>
          node.type === "Notice" &&
          node.props.message.includes("Refresh was requested"),
      ),
  );
  assert(
    !x
      .nodes()
      .some((node) => node.type === "Notice" && node.props.tone === "error"),
  );
  x.harness.unmount();
});

test("synchronous AppState transitions invalidate preflight even without an intervening render", async () => {
  const x = setup();
  const pending = deferred<{ id: string; is_admin: boolean }>();
  x.identity(() => pending.promise);
  x.button("Agent Keys · Web").props.onPress();
  x.appState("inactive");
  x.appState("active");
  pending.resolve({ id: "person", is_admin: true });
  await x.harness.settle();
  assert.equal(x.browsers.length, 0);
  x.harness.unmount();
});

test("browser return cannot refresh the replacement account", async () => {
  const x = setup();
  const pending = deferred<void>();
  x.browser(() => pending.promise);
  x.button("Agent Keys · Web").props.onPress();
  await x.harness.settle();
  x.epoch();
  pending.resolve();
  await x.harness.settle();
  assert.equal(x.returned(), 0);
  x.harness.unmount();
});
