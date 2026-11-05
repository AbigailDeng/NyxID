import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  hookHarness,
  deferred,
} from "../../assistant/assistantHookTestHarness";
import { advancedConnectionDestinations } from "./advancedConnectionDestinations";
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
    "../../../components/workspace/WorkspaceUI": Object.fromEntries(
      ["ActionButton", "Card", "Label", "Notice"].map((name) => [name, name]),
    ),
    "../../../lib/auth/authEpoch": { getAuthEpoch: () => epoch },
    "react-native": { AppState: app },
    "../../../lib/env": { NYXID_FRONTEND_URL: "https://nyxid.example" },
    "../../../lib/api/servicesApi": {
      servicesApi: {
        connection: async () => ({
          id: "connection",
          service_type: "http",
          is_active: true,
          can_edit_configuration: true,
        }),
      },
    },
    "../serviceContracts": { canEditConnection },
    "./consoleActivation": { createConsoleActivation },
    "expo-web-browser": {
      openBrowserAsync: async (url: string) => {
        browsers.push(url);
        await browser();
      },
    },
  });
  const { AdvancedConnectionLinks } = harness.load(
    fileURLToPath(new URL("./AdvancedConnectionLinks.tsx", import.meta.url)),
  ) as { AdvancedConnectionLinks: (props: unknown) => Element };
  const onReturned = async () => {
    returned++;
  };
  harness.mount(() =>
    AdvancedConnectionLinks({
      active,
      onReturned,
      editable: true,
      connection: { id: "connection", service_type: "http", is_active: true },
    }),
  );
  const button = (label: string) => {
    const node = elements(harness.value()).find(
      (node) => node.props.label === label,
    );
    assert(node, `Missing ${label}`);
    return node;
  };
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

test("advanced entry opens its single contextual destination and requests refresh on return", async () => {
  const x = setup();
  x.button("Edit advanced settings · Web").props.onPress();
  await x.harness.settle();
  assert.deepEqual(x.browsers, [
    "https://nyxid.example/keys/connection?tab=advanced",
  ]);
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
  x.harness.unmount();
});

test("advanced destinations keep SSH terminal as the only second action", () => {
  assert.equal(
    advancedConnectionDestinations(
      { id: "connection", service_type: "http", is_active: true },
      true,
    ).length,
    1,
  );
  assert.equal(
    advancedConnectionDestinations(
      {
        id: "connection",
        service_type: "ssh",
        catalog_service_id: "catalog",
        ssh_ca_public_key: "key",
        is_active: true,
      },
      true,
    ).length,
    2,
  );
});

test("browser background handoff refreshes exactly once after returning to the same account", async () => {
  const x = setup();
  const pending = deferred<void>();
  x.browser(() => pending.promise);
  x.button("Edit advanced settings · Web").props.onPress();
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
  x.button("Edit advanced settings · Web").props.onPress();
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
  x.button("Edit advanced settings · Web").props.onPress();
  await x.harness.settle();
  x.epoch();
  pending.resolve();
  await x.harness.settle();
  assert.equal(x.returned(), 0);
  x.harness.unmount();
});
