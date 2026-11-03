import assert from "node:assert/strict";
import test from "node:test";
import { deferred } from "../assistant/assistantHookTestHarness";
import {
  billingCheckoutSession,
  canReviewBilling,
  createBillingManagementApi,
  secureExternalUrl,
  type BillingManagementRequest,
} from "./billingManagementTransport";

const ORG = "20000000-0000-4000-8000-000000000001";
const input = { amount_credits: 100, idempotency_key: "request-1234" };
const checkout = {
  owner_id: "me",
  ...input,
  checkout_url: "https://checkout.example/payment",
  status: "checkout_created",
  reused: false,
};

test("billing reads use explicit safe routes; provisioning is an explicit guarded POST", async () => {
  const calls: Array<{
    path: string;
    options: Parameters<BillingManagementRequest>[1];
  }> = [];
  const api = createBillingManagementApi(async (path, options) => {
    calls.push({ path, options });
    if (path.includes("topups"))
      return { owner_id: "me", topups: [], page: 1, per_page: 10, total: 0 };
    if (path === "/billing/wallet") return {};
    return checkout;
  });
  await api.topups();
  assert.equal(calls[0]!.path, "/billing/topups?page=1&per_page=10&period=all");
  assert.equal(calls[0]!.options.method, "GET");
  await api.provision(() => true);
  assert.equal(calls[1]!.options.method, "POST");
  assert.deepEqual(calls[1]!.options.body, {});
  await assert.rejects(
    api.provision(() => false),
    /context changed/,
  );
  assert.equal(calls.length, 2);
});
test("checkout validates amount, HTTPS URL and echoed idempotency; checkout is not a paid result", async () => {
  let calls = 0;
  const api = createBillingManagementApi(async (_path, options) => {
    calls++;
    options.authorityGuard?.();
    return checkout;
  });
  assert.equal(
    (await api.checkout(input, () => true)).status,
    "checkout_created",
  );
  await assert.rejects(
    api.checkout({ ...input, amount_credits: 1.5 }, () => true),
  );
  await assert.rejects(api.checkout(input, () => false));
  assert.equal(calls, 1);
  await assert.rejects(
    createBillingManagementApi(async () => ({
      ...checkout,
      idempotency_key: "other",
    })).checkout(input, () => true),
    /did not match/,
  );
  for (const url of [
    "http://checkout.example",
    "javascript:alert(1)",
    "https://user:password@checkout.example",
  ])
    assert.throws(() => secureExternalUrl(url));
});
test("organization reads preserve owner context and reject another owner's response", async () => {
  let path = "";
  const api = createBillingManagementApi(async (value) => {
    path = value;
    return { owner_id: "other", invoices: [], page: 1, per_page: 10, total: 0 };
  });
  await assert.rejects(api.invoices(2, ORG), /different account/);
  assert.equal(path, `/billing/invoices?page=2&per_page=10&owner_id=${ORG}`);
  await assert.rejects(api.bill("not-an-owner"));
});
test("failed reads cannot unlock uncertain writes; checkout survives remount but is cleared on account change", () => {
  assert.equal(canReviewBilling([{ isSuccess: false, isError: true }]), false);
  assert.equal(
    canReviewBilling([
      { isSuccess: true, isError: false },
      { isSuccess: false, isError: true },
    ]),
    false,
  );
  assert.equal(canReviewBilling([]), false);
  assert.equal(canReviewBilling([{ isSuccess: true, isError: false }]), true);
  billingCheckoutSession(100).attempt = { input };
  assert.equal(
    billingCheckoutSession(100).attempt?.input.idempotency_key,
    input.idempotency_key,
  );
  assert.equal(billingCheckoutSession(101).attempt, undefined);
});

test("payment admission scans past a non-pending display page before declaring clear", async () => {
  const calls: string[] = [];
  const api = createBillingManagementApi(async (path, options) => {
    options.authorityGuard?.();
    calls.push(path);
    const page = Number(
      new URL(path, "https://api.example").searchParams.get("page"),
    );
    return {
      owner_id: "me",
      page,
      per_page: 50,
      total: 100,
      topups:
        page === 2
          ? [
              {
                id: "older-pending",
                created_at: "2026-11-03T00:00:00Z",
                amount_credits: 100,
                status: "pending",
                receipt_available: false,
              },
            ]
          : [],
    };
  });
  assert.deepEqual(await api.paymentReview(() => true), { status: "pending" });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((path) => path.includes("per_page=50&period=all")));
});

test("payment admission clears only complete history and leaves oversized history unknown", async () => {
  let total = 0;
  let calls = 0;
  const api = createBillingManagementApi(async (path) => {
    calls++;
    const page = Number(
      new URL(path, "https://api.example").searchParams.get("page"),
    );
    return { owner_id: "me", page, per_page: 50, total, topups: [] };
  });
  assert.deepEqual(await api.paymentReview(() => true), { status: "clear" });
  total = 501;
  calls = 0;
  assert.deepEqual(await api.paymentReview(() => true), { status: "unknown" });
  assert.equal(calls, 10);
});

test("payment scans stop on live authority loss, abort, failed read and mismatched metadata", async () => {
  for (const failure of [
    "authority",
    "abort",
    "network",
    "page",
    "owner",
  ] as const) {
    let current = true;
    let calls = 0;
    const controller = new AbortController();
    const api = createBillingManagementApi(async (path, options) => {
      options.authorityGuard?.();
      calls++;
      const page = Number(
        new URL(path, "https://api.example").searchParams.get("page"),
      );
      if (failure === "authority") current = false;
      if (failure === "abort") controller.abort();
      if (failure === "network" && page === 2) throw new Error("offline");
      return {
        owner_id: failure === "owner" && page === 2 ? "other" : "me",
        page: failure === "page" ? page + 1 : page,
        per_page: 50,
        total: 100,
        topups: [],
      };
    });
    await assert.rejects(api.paymentReview(() => current, controller.signal));
    assert.equal(
      calls,
      ["authority", "abort", "page"].includes(failure) ? 1 : 2,
    );
  }
});

test("receipt transport checks authority before dispatch and after signed URL arrives", async () => {
  let current = false;
  let calls = 0;
  const response = deferred<unknown>();
  const api = createBillingManagementApi(async (_path, options) => {
    options.authorityGuard?.();
    calls++;
    return response.promise;
  });
  await assert.rejects(
    api.receipt("invoice", ORG, () => current),
    /context changed/,
  );
  assert.equal(calls, 0);
  current = true;
  const request = api.receipt("invoice", ORG, () => current);
  current = false;
  response.resolve({ file_url: "https://receipt.example/document" });
  await assert.rejects(request, /context changed/);
  assert.equal(calls, 1);
});
