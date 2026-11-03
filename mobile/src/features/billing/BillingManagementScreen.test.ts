import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { hookHarness } from "../assistant/assistantHookTestHarness";
import * as management from "./billingManagementTransport";
import * as credits from "./credits";

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
function setup(initialOwnerId?: string) {
  const epoch = ++nextEpoch;
  let visible = true;
  let membershipError = false;
  let refreshFails = false;
  let reviewed = 0;
  let checkoutSucceeds = false;
  let serverStatus: string | undefined;
  const checkouts: unknown[] = [];
  const queries = new Map<string, any>();
  const runtime = {
    epoch,
    active: true,
    current: () => true,
    interactive: () => true,
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
    checkout: async (input: unknown) => {
      checkouts.push(input);
      if (checkoutSucceeds)
        return {
          checkout_url: "https://checkout.example/payment",
          status: "checkout_created",
        };
      throw new Error("connection lost");
    },
  };
  const jsx = (type: unknown, props: any): Element => ({ type, props });
  const harness = hookHarness<Element | null>({
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "../../components/workspace/WorkspaceUI": Object.fromEntries(
      ["ActionButton", "Card", "Field", "Label", "Notice"].map((name) => [
        name,
        name,
      ]),
    ),
    "expo-crypto": { randomUUID: () => "retained-payment-key" },
    "expo-web-browser": { openBrowserAsync: async () => ({ type: "cancel" }) },
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
    "@tanstack/react-query": {
      useQueryClient: () => ({
        invalidateQueries: async () => {},
        cancelQueries: async () => {},
      }),
      useQuery: (options: any) => {
        const key = String(
          options.queryKey.find((entry: unknown) =>
            [
              "organizations",
              "bill",
              "invoices",
              "topups",
              "grants",
              "allowances",
            ].includes(String(entry)),
          ),
        );
        queries.set(key, options);
        const data =
          key === "organizations"
            ? {
                kind: "ready",
                data: [
                  {
                    id: ORG,
                    slug: "team",
                    display_name: "Team",
                    your_role: "admin",
                  },
                ],
              }
            : key === "topups"
              ? {
                  topups: serverStatus
                    ? [
                        {
                          id: "server-recharge",
                          status: serverStatus,
                          created_at: "2026-11-03T00:00:00Z",
                          amount_credits: 100,
                          receipt_available: false,
                        },
                      ]
                    : [],
                  total: 0,
                  per_page: 10,
                }
              : key === "invoices"
                ? {
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
                  }
                : undefined;
        return {
          data,
          isPending: false,
          isError: key === "organizations" && membershipError,
          isSuccess: true,
          isFetching: false,
          refetch: async () => ({
            data,
            isSuccess: !refreshFails,
            isError: refreshFails,
          }),
        };
      },
    },
  });
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
    checkoutSucceeds: () => {
      checkoutSucceeds = true;
    },
    serverStatus: (status: string) => {
      serverStatus = status;
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
