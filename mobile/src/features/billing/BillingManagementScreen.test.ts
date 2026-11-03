import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { deferred, hookHarness } from "../assistant/assistantHookTestHarness";
import * as management from "./billingManagementTransport";
import * as credits from "./credits";
import * as machineContracts from "../machines/machineContracts";

type Element = { type: unknown; props: Record<string, any> };
const all = (value: Element | null): Element[] =>
  value
    ? [
        value,
        ...[value.props.children]
          .flat(Infinity)
          .flatMap((child) =>
            child && typeof child === "object" && "props" in child
              ? all(child)
              : [],
          ),
      ]
    : [];
const ORG = "20000000-0000-4000-8000-000000000001";
let nextEpoch = 200;
function setup(initialOwnerId?: string, actualRuntime = false) {
  const epoch = ++nextEpoch;
  let visible = true;
  let membershipError = false;
  let refreshFails = false;
  let reviewed = 0;
  let checkoutSucceeds = false;
  let serverStatus: string | undefined;
  let paymentStatus: "clear" | "pending" | "unknown" = "clear";
  let membershipRole = "admin";
  let receiptGate: ReturnType<typeof deferred<string>> | undefined;
  let checkoutGate: ReturnType<typeof deferred<void>> | undefined;
  let paymentGate: ReturnType<typeof deferred<unknown>> | undefined;
  let focused = true;
  const appListeners = new Set<(state: string) => void>();
  const blurListeners = new Set<() => void>();
  const app = {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appListeners.add(listener);
      return { remove: () => appListeners.delete(listener) };
    },
  };
  const navigation = {
    addListener: (_event: string, listener: () => void) => {
      blurListeners.add(listener);
      return () => blurListeners.delete(listener);
    },
  };
  const checkouts: unknown[] = [];
  const receipts: unknown[] = [];
  const browsers: string[] = [];
  const scans: { current: () => boolean; signal?: AbortSignal }[] = [];
  const cancellations: unknown[][] = [];
  const refetches: string[] = [];
  const flags = new Map<
    string,
    { isError?: boolean; isFetching?: boolean; isSuccess?: boolean }
  >();
  const historyPages = new Map<number, any>();
  const queries = new Map<string, any>();
  let orgData = {
    kind: "ready",
    data: [
      {
        id: ORG,
        slug: "team",
        display_name: "Team",
        your_role: membershipRole,
      },
    ],
  };
  const invoiceData = {
    invoices: [
      {
        id: "receipt",
        number: "INV-1",
        payment_status: "paid",
        issuing_date: "today",
        total: "1",
        amount_due: "0",
        tax_total: "0",
        prepaid_credits_applied: "1",
        currency: "USD",
      },
    ],
  };
  let topupData = { topups: [] as any[], total: 0, per_page: 10 };
  const runtime = {
    epoch,
    active: true,
    current: () => true,
    interactive: () => true,
    captureWriteGuard: () => runtime.interactive,
    busy: false,
    uncertain: true,
    reviewed: () => reviewed++,
    run: async (action: any) => {
      try {
        await action(() => true);
      } catch {
        runtime.uncertain = true;
      }
    },
  };
  const api = {
    paymentReview: async (current: () => boolean, signal?: AbortSignal) => {
      scans.push({ current, signal });
      return { status: "clear" };
    },
    checkout: async (input: unknown, current: () => boolean) => {
      if (checkoutGate) await checkoutGate.promise;
      if (!current()) throw new Error("context changed");
      checkouts.push(input);
      if (checkoutSucceeds)
        return {
          checkout_url: "https://checkout.example/payment",
          status: "checkout_created",
        };
      throw new Error("connection lost");
    },
    receipt: async (
      id: string,
      ownerId: string | undefined,
      current: () => boolean,
    ) => {
      if (!current()) throw new Error("context changed");
      receipts.push({ id, ownerId });
      const url = receiptGate
        ? await receiptGate.promise
        : "https://receipt.example/file";
      if (!current()) throw new Error("context changed");
      return url;
    },
  };
  if (actualRuntime) {
    const transport = management.createBillingManagementApi(
      async (path, options) => {
        options.authorityGuard?.();
        if (path.includes("/download")) {
          receipts.push(path);
          return {
            file_url: receiptGate
              ? await receiptGate.promise
              : "https://receipt.example/file",
          };
        }
        if (path.startsWith("/billing/topups?")) {
          scans.push({
            current: () => {
              try {
                options.authorityGuard?.();
                return true;
              } catch {
                return false;
              }
            },
            signal: options.signal,
          });
          return paymentGate
            ? await paymentGate.promise
            : { owner_id: "me", page: 1, per_page: 50, total: 0, topups: [] };
        }
        throw new Error(`Unexpected billing read: ${path}`);
      },
    );
    api.receipt = transport.receipt;
    api.paymentReview = transport.paymentReview;
  }
  const jsx = (type: unknown, props: any): Element => ({ type, props });
  const mocks: Record<string, unknown> = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "../../components/workspace/WorkspaceUI": Object.fromEntries(
      ["ActionButton", "Card", "Field", "Label", "Notice"].map((name) => [
        name,
        name,
      ]),
    ),
    "expo-crypto": { randomUUID: () => "retained-payment-key" },
    "expo-web-browser": {
      openBrowserAsync: async (url: string) => {
        browsers.push(url);
        return { type: "cancel" };
      },
    },
    "../machines/MachineUI": {
      useMachineRuntime: () => runtime,
      useMachineWrite: () => runtime,
      machineError: () => "unavailable",
    },
    "../../lib/api/billingApi": { billingApi: {} },
    "../../lib/api/billingManagementApi": { billingManagementApi: api },
    "../../lib/env": { NYXID_FRONTEND_URL: "https://nyxid.example" },
    "./credits": credits,
    "./billingManagementTransport": management,
    "./machineContracts": machineContracts,
    "react-native": { AppState: app, Alert: { alert() {} } },
    "@react-navigation/native": {
      useIsFocused: () => focused,
      useNavigation: () => navigation,
    },
    "../../hooks/useNetworkStatus": {
      useNetworkStatus: () => ({ isConnected: true }),
    },
    "../../lib/auth/authEpoch": { getAuthEpoch: () => epoch },
    "@tanstack/react-query": {
      useQueryClient: () => ({
        invalidateQueries: async () => {},
        cancelQueries: async ({ queryKey }: { queryKey: unknown[] }) => {
          cancellations.push(queryKey);
        },
      }),
      useQuery: (options: any) => {
        const key = String(
          options.queryKey.find((entry: unknown) =>
            [
              "organizations",
              "bill",
              "invoices",
              "topups",
              "payment-review",
              "grants",
              "allowances",
            ].includes(String(entry)),
          ),
        );
        queries.set(key, options);
        const data =
          key === "organizations"
            ? orgData
            : key === "topups"
              ? (historyPages.get(options.queryKey.at(-1)) ?? topupData)
              : key === "payment-review"
                ? { status: paymentStatus }
                : key === "invoices"
                  ? invoiceData
                  : key === "grants"
                    ? { kind: "ready", data: { grants: [] } }
                    : key === "allowances"
                      ? { kind: "ready", data: { allowances: [] } }
                      : undefined;
        const queryFlags = flags.get(key) ?? {};
        return {
          data,
          isPending: false,
          isError:
            (key === "organizations" && membershipError) ||
            queryFlags.isError === true,
          isSuccess: queryFlags.isSuccess ?? true,
          isFetching: queryFlags.isFetching ?? false,
          refetch: async () => {
            refetches.push(key);
            return { data, isSuccess: !refreshFails, isError: refreshFails };
          },
        };
      },
    },
  };
  const harness = hookHarness<Element | null>(mocks);
  if (actualRuntime)
    mocks["../machines/MachineUI"] = harness.load(
      fileURLToPath(new URL("../machines/MachineUI.tsx", import.meta.url)),
    );
  const module = harness.load(
    fileURLToPath(new URL("./BillingManagement.tsx", import.meta.url)),
  ) as { BillingManagementContents: (props: any) => Element };
  harness.mount(() =>
    module.BillingManagementContents({
      hasWallet: true,
      available: true,
      visible,
      initialOwnerId,
    }),
  );
  const button = (label: string) => {
    const result = all(harness.value()).find(
      (item) => item.type === "ActionButton" && item.props.label === label,
    );
    assert.ok(result, label);
    return result;
  };
  return {
    harness,
    runtime,
    queries,
    button,
    reviewed: () => reviewed,
    checkouts,
    receipts,
    browsers,
    scans,
    cancellations,
    refetches,
    deferPaymentReview: () => {
      paymentGate = deferred<unknown>();
      return paymentGate;
    },
    appTransition: (state: string) => {
      app.currentState = state;
      for (const listener of appListeners) listener(state);
    },
    blurAndFocus: () => {
      focused = false;
      for (const listener of blurListeners) listener();
      focused = true;
      harness.render();
    },
    deferReceipt: () => {
      receiptGate = deferred<string>();
      return receiptGate;
    },
    deferCheckout: () => {
      checkoutGate = deferred<void>();
      return checkoutGate;
    },
    flags: (
      key: string,
      value: { isError?: boolean; isFetching?: boolean; isSuccess?: boolean },
    ) => {
      flags.set(key, value);
      harness.render();
    },
    paymentStatus: (value: "clear" | "pending" | "unknown") => {
      paymentStatus = value;
      harness.render();
    },
    historyPage: (page: number, data: unknown) => {
      historyPages.set(page, data);
      harness.render();
    },
    role: (role: string) => {
      membershipRole = role;
      orgData = {
        ...orgData,
        data: orgData.data.map((org) => ({ ...org, your_role: role })),
      };
      harness.render();
    },
    removeMembership: () => {
      orgData = { ...orgData, data: [] };
      harness.render();
    },
    checkoutSucceeds: () => {
      checkoutSucceeds = true;
    },
    serverStatus: (status: string) => {
      serverStatus = status;
      paymentStatus = status === "pending" ? "pending" : "clear";
      topupData = {
        ...topupData,
        topups: [
          {
            id: "server-recharge",
            status: serverStatus,
            created_at: "2026-11-03T00:00:00Z",
            amount_credits: 100,
            receipt_available: false,
          },
        ],
      };
      harness.render();
    },
    failure: (value: boolean) => {
      refreshFails = value;
    },
    membershipError: () => {
      membershipError = true;
      harness.render();
    },
    visible: (value: boolean) => {
      visible = value;
      harness.render();
    },
  };
}
test("failed server refresh keeps uncertain payment locked; only successful reads permit review", async (t) => {
  const screen = setup();
  t.after(screen.harness.unmount);
  screen.failure(true);
  screen.button("Refresh server billing status").props.onPress();
  await screen.harness.settle();
  assert.equal(screen.reviewed(), 0);
  screen.failure(false);
  screen.button("Refresh server billing status").props.onPress();
  await screen.harness.settle();
  assert.equal(screen.reviewed(), 1);
  assert.ok(screen.refetches.includes("topups"));
  assert.ok(screen.refetches.includes("payment-review"));
});
test("browser cancellation leaves recharge pending; only a later server paid row displays success", async (t) => {
  const screen = setup();
  t.after(screen.harness.unmount);
  screen.runtime.uncertain = false;
  screen.checkoutSucceeds();
  screen.harness.render();
  screen.button("Create secure checkout").props.onPress();
  await screen.harness.settle();
  screen.serverStatus("pending");
  screen.button("Continue this checkout in browser").props.onPress();
  await screen.harness.settle();
  const text = () =>
    all(screen.harness.value())
      .flatMap((item) => [item.props.children].flat(Infinity))
      .filter((item) => typeof item === "string")
      .join(" ");
  assert.doesNotMatch(text(), /Paid \(server confirmed\)/);
  screen.serverStatus("failed");
  assert.doesNotMatch(text(), /Paid \(server confirmed\)/);
  screen.serverStatus("paid");
  assert.match(text(), /Paid \(server confirmed\)/);
});
test("cached organization bills cannot expose receipts after membership lookup fails", (t) => {
  const screen = setup(ORG);
  t.after(screen.harness.unmount);
  assert.equal(screen.queries.get("bill").enabled, true);
  assert.ok(screen.button("Receipt for INV-1"));
  screen.membershipError();
  assert.equal(screen.queries.get("bill").enabled, false);
  assert.equal(
    all(screen.harness.value()).some(
      (item) => item.props.label === "Receipt for INV-1",
    ),
    false,
  );
});
test("collapsing and reopening preserves an unresolved checkout key", async (t) => {
  const screen = setup();
  t.after(screen.harness.unmount);
  screen.runtime.uncertain = false;
  screen.harness.render();
  screen.button("Create secure checkout").props.onPress();
  await screen.harness.settle();
  screen.visible(false);
  screen.visible(true);
  assert.ok(screen.button("Retry same checkout request"));
  assert.equal(
    (screen.checkouts[0] as any).idempotency_key,
    "retained-payment-key",
  );
});

test("pending payment admission survives display pagination and stale handlers cannot create a payment", async (t) => {
  const screen = setup();
  t.after(screen.harness.unmount);
  screen.runtime.uncertain = false;
  screen.harness.render();
  const staleCreate = screen.button("Create secure checkout").props.onPress;
  const staleWeb = screen.button("Add credits on web").props.onPress;
  screen.historyPage(1, {
    total: 20,
    per_page: 10,
    topups: [
      {
        id: "pending-first-page",
        status: "pending",
        created_at: "2026-11-03T00:00:00Z",
        amount_credits: 100,
        receipt_available: false,
      },
    ],
  });
  screen.historyPage(2, { total: 20, per_page: 10, topups: [] });
  screen.paymentStatus("pending");
  screen.button("More recharges").props.onPress();
  screen.harness.flush();
  assert.equal(screen.button("Create secure checkout").props.disabled, true);
  staleCreate();
  staleWeb();
  await screen.harness.settle();
  assert.equal(screen.checkouts.length, 0);
  assert.deepEqual(screen.browsers, ["https://nyxid.example/billing"]);
});

test("loading, refreshing, failed and incomplete payment review all block a new checkout", async (t) => {
  const screen = setup();
  t.after(screen.harness.unmount);
  screen.runtime.uncertain = false;
  screen.harness.render();
  const staleCreate = screen.button("Create secure checkout").props.onPress;
  for (const flags of [
    { isSuccess: false, isFetching: true },
    { isSuccess: true, isFetching: true },
    { isSuccess: false, isError: true, isFetching: false },
  ]) {
    screen.flags("payment-review", flags);
    assert.equal(screen.button("Create secure checkout").props.disabled, true);
    staleCreate();
  }
  screen.flags("payment-review", { isSuccess: true, isFetching: false });
  screen.paymentStatus("unknown");
  staleCreate();
  await screen.harness.settle();
  assert.equal(screen.checkouts.length, 0);
  assert.ok(screen.button("Review payments on web"));
});

test("new checkout rechecks pending status at actual dispatch", async (t) => {
  const screen = setup();
  t.after(screen.harness.unmount);
  screen.runtime.uncertain = false;
  screen.harness.render();
  const dispatch = screen.deferCheckout();
  screen.button("Create secure checkout").props.onPress();
  await screen.harness.settle();
  screen.paymentStatus("pending");
  dispatch.resolve();
  await screen.harness.settle();
  assert.equal(screen.checkouts.length, 0);
});

test("a valid checkout remains admitted while its own write is busy", async (t) => {
  const screen = setup();
  t.after(screen.harness.unmount);
  screen.runtime.uncertain = false;
  screen.checkoutSucceeds();
  screen.harness.render();
  const dispatch = screen.deferCheckout();
  screen.button("Create secure checkout").props.onPress();
  screen.runtime.busy = true;
  screen.harness.render();
  dispatch.resolve();
  await screen.harness.settle();
  assert.equal(screen.checkouts.length, 1);
});

for (const change of ["owner", "visibility", "foreground"] as const)
  test(`payment scan is permanently revoked after ${change} changes and returns`, async (t) => {
    const screen = setup();
    t.after(screen.harness.unmount);
    await screen.queries
      .get("payment-review")
      .queryFn({ signal: new AbortController().signal });
    const scan = screen.scans[0]!;
    assert.equal(scan.current(), true);
    if (change === "owner") {
      screen.button("Billing for Team").props.onPress();
      screen.harness.flush();
      screen.button("Personal billing").props.onPress();
      screen.harness.flush();
    }
    if (change === "visibility") {
      screen.visible(false);
      screen.visible(true);
    }
    if (change === "foreground") {
      screen.runtime.active = false;
      screen.harness.render();
      screen.runtime.active = true;
      screen.harness.render();
    }
    assert.equal(scan.current(), false);
    assert.ok(screen.cancellations.length > 0);
  });

test("stale personal Web payment action becomes review-only after selecting an organization", async (t) => {
  const screen = setup();
  t.after(screen.harness.unmount);
  screen.runtime.uncertain = false;
  screen.harness.render();
  const staleWeb = screen.button("Add credits on web").props.onPress;
  screen.button("Billing for Team").props.onPress();
  screen.harness.flush();
  staleWeb();
  await screen.harness.settle();
  assert.deepEqual(screen.browsers, ["https://nyxid.example/billing"]);
});

test("unchanged receipt context opens its signed document once", async (t) => {
  const screen = setup(ORG);
  t.after(screen.harness.unmount);
  screen.button("Receipt for INV-1").props.onPress();
  await screen.harness.settle();
  assert.equal(screen.receipts.length, 1);
  assert.deepEqual(screen.browsers, ["https://receipt.example/file"]);
});

for (const change of [
  "membership removed",
  "membership error",
  "membership refresh",
  "source error",
  "source refresh",
  "owner away and back",
  "panel hidden and reopened",
  "background and foreground",
] as const)
  test(`late receipt is discarded after ${change}`, async (t) => {
    const screen = setup(ORG);
    t.after(screen.harness.unmount);
    const request = screen.deferReceipt();
    screen.button("Receipt for INV-1").props.onPress();
    await screen.harness.settle();
    assert.equal(screen.receipts.length, 1);
    if (change === "membership removed") screen.removeMembership();
    if (change === "membership error") screen.membershipError();
    if (change === "membership refresh") {
      screen.flags("organizations", { isFetching: true });
      screen.flags("organizations", { isFetching: false });
    }
    if (change === "source error") screen.flags("invoices", { isError: true });
    if (change === "source refresh") {
      screen.flags("invoices", { isFetching: true });
      screen.flags("invoices", { isFetching: false });
    }
    if (change === "owner away and back") {
      screen.button("Personal billing").props.onPress();
      screen.harness.flush();
      screen.button("Billing for Team").props.onPress();
      screen.harness.flush();
    }
    if (change === "panel hidden and reopened") {
      screen.visible(false);
      screen.visible(true);
    }
    if (change === "background and foreground") {
      screen.runtime.active = false;
      screen.harness.render();
      screen.runtime.active = true;
      screen.harness.render();
    }
    request.resolve("https://receipt.example/late");
    await screen.harness.settle();
    assert.deepEqual(screen.browsers, []);
  });

for (const failure of ["membership", "source"] as const)
  test(`stale receipt callbacks cannot fetch after ${failure} failure`, async (t) => {
    const screen = setup(ORG);
    t.after(screen.harness.unmount);
    const stale = screen.button("Receipt for INV-1").props.onPress;
    if (failure === "membership") screen.membershipError();
    else screen.flags("invoices", { isError: true });
    stale();
    await screen.harness.settle();
    assert.equal(screen.receipts.length, 0);
    assert.deepEqual(screen.browsers, []);
  });

test("organization members retain benefits without requesting admin-only bills", (t) => {
  const screen = setup(ORG);
  t.after(screen.harness.unmount);
  screen.role("member");
  assert.equal(screen.queries.get("bill").enabled, false);
  assert.equal(screen.queries.get("invoices").enabled, false);
  assert.equal(screen.queries.get("grants").enabled, true);
  assert.equal(screen.queries.get("allowances").enabled, true);
  assert.equal(
    all(screen.harness.value()).some(
      (element) => element.props.label === "Receipt for INV-1",
    ),
    false,
  );
  const text = all(screen.harness.value())
    .flatMap((element) => [element.props.children].flat(Infinity))
    .filter((value) => typeof value === "string")
    .join(" ");
  assert.match(text, /bills and receipts require an organization admin/);
});

for (const lifecycle of [
  "inactive and active without render",
  "blur and focus without intermediate render",
] as const) {
  test(`actual machine runtime discards a receipt after ${lifecycle}`, async (t) => {
    const screen = setup(ORG, true);
    t.after(screen.harness.unmount);
    const response = screen.deferReceipt();
    screen.button("Receipt for INV-1").props.onPress();
    assert.equal(screen.receipts.length, 1);
    if (lifecycle === "inactive and active without render") {
      screen.appTransition("inactive");
      screen.appTransition("active");
    } else screen.blurAndFocus();
    response.resolve("https://receipt.example/late");
    await screen.harness.settle();
    assert.deepEqual(screen.browsers, []);
  });

  test(`actual machine runtime prevents an old payment scan returning clear after ${lifecycle}`, async (t) => {
    const screen = setup(undefined, true);
    t.after(screen.harness.unmount);
    const response = screen.deferPaymentReview();
    const running = screen.queries
      .get("payment-review")
      .queryFn({ signal: new AbortController().signal });
    assert.equal(screen.scans.length, 1);
    assert.equal(screen.scans[0]!.current(), true);
    if (lifecycle === "inactive and active without render") {
      screen.appTransition("inactive");
      screen.appTransition("active");
    } else screen.blurAndFocus();
    response.resolve({
      owner_id: "me",
      page: 1,
      per_page: 50,
      total: 0,
      topups: [],
    });
    await assert.rejects(running, /context changed/);
    assert.equal(screen.scans[0]!.current(), false);
  });
}
