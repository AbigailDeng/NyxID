import { z } from "zod";
import { creditsSchema } from "./billingContracts";

const owner = z.string().uuid();
const pageNumber = z.number().int().positive().max(100_000);
export function secureExternalUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error(
      "A secure browser address was not returned. Try again on NyxID web.",
    );
  return url.href;
}
const tax = z.object({
  name: z.string(),
  rate_percent: creditsSchema,
  amount: creditsSchema,
});
export const billSchema = z.object({
  owner_id: z.string(),
  currency: z.string(),
  from: z.string(),
  to: z.string(),
  charges: z.array(
    z.object({
      metric_code: z.string(),
      name: z.string(),
      units: z.string(),
      amount: creditsSchema,
    }),
  ),
  subtotal: creditsSchema,
  taxes: z.array(tax),
  tax_breakdown_available: z.boolean().default(false),
  tax_total: creditsSchema,
  rounding: creditsSchema,
  total: creditsSchema,
});
export const invoicesSchema = z.object({
  owner_id: z.string(),
  page: pageNumber,
  per_page: pageNumber,
  total: z.number().int().nonnegative(),
  invoices: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      issuing_date: z.string(),
      currency: z.string(),
      payment_status: z.string(),
      subtotal: creditsSchema,
      taxes: z.array(tax),
      tax_total: creditsSchema,
      total: creditsSchema,
      prepaid_credits_applied: creditsSchema,
      amount_due: creditsSchema,
    }),
  ),
});
export const topupsSchema = z.object({
  owner_id: z.string(),
  page: pageNumber.default(1),
  per_page: pageNumber.default(10),
  total: z.number().int().nonnegative().default(0),
  topups: z.array(
    z.object({
      id: z.string(),
      created_at: z.string(),
      amount_credits: z.number().int().safe(),
      status: z.enum(["paid", "pending", "expired", "failed", "voided"]),
      lago_invoice_id: z.string().nullish(),
      invoice_number: z.string().nullish(),
      receipt_available: z.boolean(),
      paid_at: z.string().nullish(),
      credits_expire_at: z.string().nullish(),
    }),
  ),
});
export const checkoutInputSchema = z
  .object({
    amount_credits: z.number().int().positive().max(10_000_000),
    idempotency_key: z.string().min(8).max(128),
  })
  .strict();
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;
export type CheckoutAttempt = {
  input: CheckoutInput;
  result?: { url: string; status: string };
};
// A collapsed panel or navigation remount must retry the same admission. This
// contains no card details, is never persisted, and is discarded on account epoch change.
let checkoutSession: { epoch: number; attempt?: CheckoutAttempt } | undefined;
export function billingCheckoutSession(epoch: number) {
  if (checkoutSession?.epoch !== epoch) checkoutSession = { epoch };
  return checkoutSession;
}
export function canReviewBilling(
  results: readonly { isSuccess: boolean; isError: boolean }[],
) {
  return (
    results.length > 0 &&
    results.every((result) => result.isSuccess && !result.isError)
  );
}
export const checkoutSchema = z.object({
  owner_id: z.string(),
  amount_credits: z.number().int().positive(),
  idempotency_key: z.string(),
  checkout_url: z.string().transform(secureExternalUrl),
  status: z.enum(["pending", "checkout_created", "failed"]),
  reused: z.boolean(),
});
export type BillingManagementRequest = (
  path: string,
  options: {
    method: "GET" | "POST";
    body?: unknown;
    signal?: AbortSignal;
    authorityGuard?: () => void;
  },
) => Promise<unknown>;

export function createBillingManagementApi(request: BillingManagementRequest) {
  const ownerQuery = (ownerId?: string) =>
    ownerId ? `owner_id=${encodeURIComponent(owner.parse(ownerId))}` : "";
  return {
    async provision(current: () => boolean) {
      const guard = () => {
        if (!current())
          throw new Error(
            "Account context changed. Refresh before opening a wallet.",
          );
      };
      guard();
      await request("/billing/wallet", {
        method: "POST",
        body: {},
        authorityGuard: guard,
      });
    },
    async checkout(input: CheckoutInput, current: () => boolean) {
      const body = checkoutInputSchema.parse(input);
      const guard = () => {
        if (!current())
          throw new Error(
            "Account context changed. Refresh before creating checkout.",
          );
      };
      guard();
      const result = checkoutSchema.parse(
        await request("/billing/topup", {
          method: "POST",
          body,
          authorityGuard: guard,
        }),
      );
      if (
        result.idempotency_key !== body.idempotency_key ||
        result.amount_credits !== body.amount_credits
      )
        throw new Error(
          "Checkout did not match this request. Refresh before continuing.",
        );
      return result;
    },
    async topups(page = 1, signal?: AbortSignal) {
      return topupsSchema.parse(
        await request(
          `/billing/topups?page=${pageNumber.parse(page)}&per_page=10&period=all`,
          { method: "GET", signal },
        ),
      );
    },
    async bill(ownerId?: string, signal?: AbortSignal) {
      const result = billSchema.parse(
        await request(
          `/billing/bill${ownerId ? `?${ownerQuery(ownerId)}` : ""}`,
          { method: "GET", signal },
        ),
      );
      if (ownerId && result.owner_id !== ownerId)
        throw new Error("The bill belongs to a different account.");
      return result;
    },
    async invoices(page = 1, ownerId?: string, signal?: AbortSignal) {
      const result = invoicesSchema.parse(
        await request(
          `/billing/invoices?page=${pageNumber.parse(page)}&per_page=10${ownerId ? `&${ownerQuery(ownerId)}` : ""}`,
          { method: "GET", signal },
        ),
      );
      if (ownerId && result.owner_id !== ownerId)
        throw new Error("The invoices belong to a different account.");
      return result;
    },
    async receipt(id: string, ownerId?: string) {
      const result = z
        .object({ file_url: z.string().transform(secureExternalUrl) })
        .parse(
          await request(
            `/billing/invoices/${encodeURIComponent(z.string().min(1).parse(id))}/download${ownerId ? `?${ownerQuery(ownerId)}` : ""}`,
            { method: "GET" },
          ),
        );
      return result.file_url;
    },
  };
}
