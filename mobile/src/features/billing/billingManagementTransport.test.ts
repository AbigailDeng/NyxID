import assert from "node:assert/strict";
import test from "node:test";
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
    if (path.includes("topups")) return { owner_id: "me", topups: [] };
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
