import assert from "node:assert/strict";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";
import { ApiError } from "../../lib/api/ApiError";
import { deferred, hookHarness } from "../assistant/assistantHookTestHarness";
import * as contracts from "./billingContracts";
import * as credits from "./credits";
import { allowanceFixture, grantFixture, organizationsFixture, ORG_ADMIN, ORG_MEMBER, ORG_VIEWER, usageFixture, walletFixture } from "./billingFixtures";

type Element = { type: unknown; props: Record<string, any> };
type Query = { queryKey: unknown[]; enabled: boolean; queryFn: (context: { signal: AbortSignal }) => Promise<unknown> };
type State = { data?: unknown; isPending?: boolean; isError?: boolean; isFetching?: boolean; error?: unknown };
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function elements(root: Element): Element[] {
  return [root, ...[root.props.children].flat(Infinity).flatMap((child) => child && typeof child === "object" && "props" in child ? elements(child) : [])];
}
const text = (root: Element) => elements(root).flatMap((item) => [item.props.children, item.props.message].flat(Infinity)).filter((value) => typeof value === "string").join(" ");
const ready = (data: unknown) => ({ data: { kind: "ready", data } });

function setup({ params = {}, states = {} }: { params?: { period?: string; ownerId?: string }; states?: Record<string, State> } = {}) {
  let online = true;
  let authenticated = true;
  let focused = true;
  let epoch = 4;
  let recheck = async () => true;
  const reads: Array<{ method: string; args: unknown[] }> = [];
  const refreshed: string[] = [];
  const cancelled: unknown[][] = [];
  const queries = new Map<string, Query>();
  const listeners = new Set<(state: string) => void>();
  const appState = { currentState: "active", addEventListener: (_event: string, listener: (state: string) => void) => {
    listeners.add(listener);
    return { remove: () => { listeners.delete(listener); } };
  } };
  const queryClient = { cancelQueries: async ({ queryKey }: { queryKey: unknown[] }) => { cancelled.push(plain(queryKey)); } };
  const defaults: Record<string, State> = {
    wallet: ready(contracts.walletSchema.parse(walletFixture)),
    organizations: ready(contracts.billingOrganizationsSchema.parse(organizationsFixture)),
    usage: ready(contracts.usageSchema.parse(usageFixture)),
    grants: ready(contracts.grantsSchema.parse({ grants: [grantFixture] })),
    allowances: ready(contracts.allowancesSchema.parse({ allowances: [allowanceFixture] })),
  };
  const jsx = (type: unknown, props: Record<string, any>) => typeof type === "function" && type.name === "ReadState" ? type(props) : ({ type, props });
  const harness = hookHarness<Element>({
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { AppState: appState, View: "View", StyleSheet: { create: (styles: unknown) => styles } },
    "@react-navigation/native": { useIsFocused: () => focused },
    "@tanstack/react-query": {
      useQueryClient: () => queryClient,
      useQuery: (query: Query) => {
        const kind = String(query.queryKey[3]);
        queries.set(kind, query);
        const state = states[kind] ?? defaults[kind]!;
        return { isPending: false, isFetching: false, isError: false, ...state, refetch: async () => { refreshed.push(kind); } };
      },
    },
    "../../components/workspace/WorkspaceUI": Object.fromEntries(["ActionButton", "Card", "Label", "Notice", "WorkspacePage"].map((name) => [name, name])),
    "../../components/SegmentControl": { SegmentControl: "SegmentControl" },
    "../../hooks/useNetworkStatus": { useNetworkStatus: () => ({ isConnected: online, recheckConnection: () => recheck() }) },
    "../../lib/auth/authEpoch": { getAuthEpoch: () => epoch },
    "../auth/AuthSessionContext": { useAuthSession: () => ({ isAuthenticated: authenticated }) },
    "../../lib/api/ApiError": { ApiError },
    "../../lib/api/billingApi": { billingApi: Object.fromEntries(["wallet", "organizations", "usage", "grants", "allowances"].map((method) => [method, async (...args: unknown[]) => { reads.push({ method, args }); }])) },
    "./billingContracts": contracts,
    "./credits": credits,
    "./BillingPresentation": Object.fromEntries(["BillingFigure", "BillingGrantCard", "BillingAllowanceCard", "BillingOwnerRow", "BillingServiceCard", "BillingWalletCard"].map((name) => [name, name])),
  });
  const { UsageCreditsScreen } = harness.load(fileURLToPath(new URL("./UsageCreditsScreen.tsx", import.meta.url))) as { UsageCreditsScreen: (props: unknown) => Element };
  harness.mount(() => UsageCreditsScreen({ route: { params } }));
  const all = () => elements(harness.value());
  const find = (type: string, label?: string) => {
    const item = all().find((item) => item.type === type && (label === undefined || item.props.label === label));
    assert.ok(item, `Expected ${type} ${label ?? ""}`);
    return item;
  };
  return {
    harness, queries, reads, refreshed, cancelled, all, find,
    text: () => text(harness.value()),
    states,
    owner: (label: string) => { find("BillingOwnerRow", label).props.onPress(); harness.flush(); },
    refresh: async () => { find("ActionButton", "Refresh billing details").props.onPress(); await harness.settle(); },
    setOnline: (value: boolean) => { online = value; harness.render(); },
    setFocused: (value: boolean) => { focused = value; harness.render(); },
    setAuthenticated: (value: boolean) => { authenticated = value; harness.render(); },
    setEpoch: (value: number) => { epoch = value; harness.render(); },
    setRecheck: (value: () => Promise<boolean>) => { recheck = value; },
    appState: (value: string) => { appState.currentState = value; for (const listener of listeners) listener(value); harness.flush(); },
    readEnabled: async () => {
      const signal = new AbortController().signal;
      await Promise.all([...queries.values()].filter((query) => query.enabled).map((query) => query.queryFn({ signal })));
    },
  };
}

test("billing renders exact amounts and services, grants and allowances with neutral web guidance", (t) => {
  const screen = setup();
  t.after(screen.harness.unmount);
  assert.match(screen.text(), /To add credits, use NyxID on the web\./);
  assert.equal(screen.find("BillingFigure", "Usage cost").props.value, "9,007,199,254,740,993.000000000003");
  assert.equal(screen.find("BillingFigure", "From wallet").props.value, "0.000000000003");
  assert.equal(screen.find("BillingServiceCard").props.service.rows.length, 2);
  assert.equal(screen.find("BillingGrantCard").props.grant.remaining, "0.000000000001");
  assert.equal(screen.find("BillingAllowanceCard").props.balance.remaining_quantity, 690);
  assert.equal(screen.find("BillingWalletCard").props.wallet.balance, "-0.000000000001");
  assert.equal(screen.all().some((item) => item.props.accessibilityRole === "link" || item.props.href || item.props.url), false);
  assert.equal(screen.all().some((item) => item.type === "ActionButton" && /top.?up|buy|purchase|checkout|add credits/i.test(item.props.label)), false);
});

test("an unsupported wallet route never displays the absent-wallet state", (t) => {
  const screen = setup({ states: { wallet: { data: { kind: "unsupported" } } } });
  t.after(screen.harness.unmount);
  assert.match(screen.text(), /Wallet balances are not available on this server/);
  assert.equal(screen.all().some((item) => item.type === "BillingWalletCard"), false);
  screen.states.wallet = ready(null);
  screen.harness.render();
  assert.equal(screen.find("BillingWalletCard").props.wallet, null);
});

test("period controls change only personal usage, retaining the selected benefit account", async (t) => {
  const screen = setup({ params: { period: "7d", ownerId: ORG_ADMIN } });
  t.after(screen.harness.unmount);
  assert.deepEqual(plain(screen.queries.get("usage")!.queryKey), ["workspace", "billing", 4, "usage", "7d"]);
  screen.find("SegmentControl").props.onPress(0);
  screen.harness.flush();
  await screen.readEnabled();
  assert.equal(screen.reads.find((call) => call.method === "usage")!.args[0], "24h");
  for (const method of ["grants", "allowances"]) assert.equal(screen.reads.find((call) => call.method === method)!.args[0], ORG_ADMIN);
  assert.match(screen.text(), /Wallet and usage above are personal/);
});

test("only eligible organizations appear and personal selection removes the benefit owner", async (t) => {
  const screen = setup();
  t.after(screen.harness.unmount);
  assert.deepEqual(screen.all().filter((item) => item.type === "BillingOwnerRow").map((item) => item.props.label), ["Personal account", "Admin organization", "member-org"]);
  screen.owner("member-org");
  await screen.readEnabled();
  assert.equal(screen.reads.find((call) => call.method === "grants")!.args[0], ORG_MEMBER);
  screen.owner("Personal account");
  screen.reads.length = 0;
  await screen.readEnabled();
  assert.equal(screen.reads.find((call) => call.method === "grants")!.args[0], undefined);
});

for (const ownerId of [ORG_VIEWER, "malformed", "10000000-0000-4000-8000-000000000099"]) {
  test(`unauthorized route owner ${ownerId} does not dispatch benefit reads`, async (t) => {
    const screen = setup({ params: { ownerId } });
    t.after(screen.harness.unmount);
    await screen.readEnabled();
    assert.deepEqual(screen.reads.map((read) => read.method).sort(), ["organizations", "usage", "wallet"]);
    assert.match(screen.text(), /organization is not available/);
    screen.owner("Personal account");
    assert.equal(screen.queries.get("grants")!.enabled, true);
  });
}

test("unresolved or failed organization access cannot read a preselected organization", async (t) => {
  const screen = setup({ params: { ownerId: ORG_ADMIN }, states: { organizations: { isPending: true } } });
  t.after(screen.harness.unmount);
  await screen.readEnabled();
  assert.match(screen.text(), /Checking organization access/);
  assert.equal(screen.reads.some((read) => read.method === "grants" || read.method === "allowances"), false);
  screen.states.organizations = { isError: true, error: new Error("network") };
  screen.harness.render();
  assert.match(screen.text(), /Could not load organization access/);
  assert.equal(screen.queries.get("allowances")!.enabled, false);
});

test("loading, offline without cache and empty responses stay distinct", async (t) => {
  const screen = setup({ states: { usage: { isPending: true }, grants: ready({ grants: [] }), allowances: ready({ allowances: [] }) } });
  t.after(screen.harness.unmount);
  assert.match(screen.text(), /Loading…/);
  assert.match(screen.text(), /No active credit grants/);
  assert.match(screen.text(), /No usage allowances/);
  screen.setOnline(false);
  assert.match(screen.text(), /Offline/);
  assert.match(screen.text(), /No saved data/);
  await screen.readEnabled();
  assert.equal(screen.reads.length, 0);
  screen.states.usage = ready(contracts.usageSchema.parse({ ...usageFixture, rows: [] }));
  screen.harness.render();
  assert.match(screen.text(), /No usage recorded/);
});

test("errors hide stale figures, retain retry and disabled billing still shows metering", async (t) => {
  const screen = setup({ states: { usage: { ...ready(contracts.usageSchema.parse(usageFixture)), isError: true, error: new Error("network") }, grants: { data: { kind: "disabled" } }, allowances: { data: { kind: "unsupported" } } } });
  t.after(screen.harness.unmount);
  assert.match(screen.text(), /Could not load billing details/);
  assert.equal(screen.all().some((item) => item.type === "BillingServiceCard"), false);
  assert.match(screen.text(), /Billing is not enabled/);
  assert.match(screen.text(), /not available on this server/);
  await screen.refresh();
  assert.deepEqual(screen.refreshed.sort(), ["allowances", "grants", "organizations", "usage", "wallet"]);
  screen.states.usage = ready(contracts.usageSchema.parse({ ...usageFixture, billing: { charging_enabled: false, rates_are_approximate: true } }));
  screen.harness.render();
  assert.match(screen.text(), /Charging is disabled/);
  assert.ok(screen.find("BillingServiceCard"));
});

test("ACL errors explain access without displaying a cached grant", (t) => {
  const error = new ApiError({ statusCode: 403, errorKey: "forbidden", errorCode: 1003, message: "Denied" });
  const screen = setup({ states: { grants: { ...ready(contracts.grantsSchema.parse({ grants: [grantFixture] })), isError: true, error } } });
  t.after(screen.harness.unmount);
  assert.match(screen.text(), /do not have access/);
  assert.equal(screen.all().some((item) => item.type === "BillingGrantCard"), false);
});

test("blur, background and signout disable queries; auth epochs separate cache keys", (t) => {
  const screen = setup();
  t.after(screen.harness.unmount);
  for (const transition of [() => screen.setFocused(false), () => screen.appState("background"), () => screen.setAuthenticated(false)]) {
    screen.setFocused(true);
    screen.appState("active");
    screen.setAuthenticated(true);
    transition();
    assert.equal([...screen.queries.values()].some((query) => query.enabled), false);
  }
  assert.match(screen.text(), /Sign in to review/);
  assert.equal(screen.all().some((item) => item.type === "BillingGrantCard"), false);
  screen.setEpoch(5);
  screen.setAuthenticated(true);
  assert.equal([...screen.queries.values()].every((query) => query.queryKey[2] === 5), true);
  assert.ok(screen.cancelled.some((key) => key[2] === 4));
});

for (const transition of ["background", "blur", "signout", "unmount"] as const) {
  test(`offline recheck finishing after ${transition} does not start billing reads`, async (t) => {
    const screen = setup();
    t.after(screen.harness.unmount);
    screen.setOnline(false);
    const pending = deferred<boolean>();
    screen.setRecheck(() => pending.promise);
    screen.find("ActionButton", "Refresh billing details").props.onPress();
    if (transition === "background") screen.appState("background");
    if (transition === "blur") screen.setFocused(false);
    if (transition === "signout") { screen.setEpoch(5); screen.setAuthenticated(false); }
    if (transition === "unmount") screen.harness.unmount();
    pending.resolve(true);
    await screen.harness.settle();
    assert.deepEqual(screen.refreshed, []);
  });
}

test("large benefit and service lists expand in place", (t) => {
  const grants = contracts.grantsSchema.parse({ grants: Array.from({ length: 11 }, (_, i) => ({ ...grantFixture, id: `grant-${i}` })) });
  const screen = setup({ states: { grants: ready(grants) } });
  t.after(screen.harness.unmount);
  assert.equal(screen.all().filter((item) => item.type === "BillingGrantCard").length, 10);
  screen.find("ActionButton", "Show more grants").props.onPress();
  screen.harness.flush();
  assert.equal(screen.all().filter((item) => item.type === "BillingGrantCard").length, 11);
});
