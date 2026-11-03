import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionButton,
  Card,
  Field,
  Label,
  Notice,
} from "../../components/workspace/WorkspaceUI";
import { billingApi } from "../../lib/api/billingApi";
import { billingManagementApi as api } from "../../lib/api/billingManagementApi";
import { NYXID_FRONTEND_URL } from "../../lib/env";
import {
  machineError,
  useMachineRuntime,
  useMachineWrite,
} from "../machines/MachineUI";
import { billingDate, formatCredits } from "./credits";
import {
  billingCheckoutSession,
  canReviewBilling,
  secureExternalUrl,
} from "./billingManagementTransport";

/** Only explicit buttons write. Closing checkout never manufactures a paid state. */
export function BillingManagement({
  hasWallet,
  available,
  initialOwnerId,
  period = "30d",
}: {
  hasWallet: boolean;
  available: boolean;
  initialOwnerId?: string;
  period?: "24h" | "7d" | "30d";
}) {
  const runtime = useMachineRuntime();
  const [open, setOpen] = useState(!!initialOwnerId);
  return (
    <Card>
      <ActionButton
        label={
          open
            ? "Hide billing management"
            : "Manage credits, bills & organizations"
        }
        variant="secondary"
        onPress={() => setOpen(!open)}
      />
      <BillingManagementContents
        key={`${runtime.epoch}:${initialOwnerId ?? "personal"}`}
        initialOwnerId={initialOwnerId}
        period={period}
        visible={open}
        hasWallet={hasWallet}
        available={available}
      />
    </Card>
  );
}

export function BillingManagementContents({
  hasWallet,
  available,
  visible,
  initialOwnerId,
  period = "30d",
}: {
  hasWallet: boolean;
  available: boolean;
  visible: boolean;
  initialOwnerId?: string;
  period?: "24h" | "7d" | "30d";
}) {
  const write = useMachineWrite();
  const client = useQueryClient();
  const [ownerId, setOwnerId] = useState<string | undefined>(
    () => z.string().uuid().safeParse(initialOwnerId).data,
  );
  const currentOwner = useRef(ownerId);
  currentOwner.current = ownerId;
  const [page, setPage] = useState(1);
  const [topupPage, setTopupPage] = useState(1);
  const [amount, setAmount] = useState("100");
  const [notice, setNotice] = useState<string>();
  const [browserError, setBrowserError] = useState<string>();
  const session = billingCheckoutSession(write.epoch);
  const [attempt, setAttempt] = useState(session.attempt);
  const checkout = attempt?.result;
  const checkoutUncertain = !!attempt && !checkout;
  const browserLock = useRef(false);
  const [browserBusy, setBrowserBusy] = useState(false);
  const root = ["workspace", "billing-management", write.epoch] as const;
  const orgs = useQuery({
    queryKey: [...root, "organizations"],
    queryFn: ({ signal }) => billingApi.organizations(signal),
    enabled: write.active && visible,
    retry: false,
  });
  const selectedOrg =
    !orgs.isError && orgs.data?.kind === "ready"
      ? orgs.data.data.find((org) => org.id === ownerId)
      : undefined;
  // A removed membership cannot keep an old owner selection active.
  const authorized = !ownerId || !!selectedOrg;
  const enabled = write.active && visible && available && authorized;
  const bill = useQuery({
    queryKey: [...root, ownerId ?? "personal", "bill"],
    queryFn: ({ signal }) => api.bill(ownerId, signal),
    enabled,
    retry: false,
  });
  const invoices = useQuery({
    queryKey: [...root, ownerId ?? "personal", "invoices", page],
    queryFn: ({ signal }) => api.invoices(page, ownerId, signal),
    enabled,
    retry: false,
  });
  const topups = useQuery({
    queryKey: [...root, "personal", "topups", topupPage],
    queryFn: ({ signal }) => api.topups(topupPage, signal),
    enabled: enabled && !ownerId && hasWallet,
    retry: false,
  });
  const grants = useQuery({
    queryKey: [...root, ownerId, "grants"],
    queryFn: ({ signal }) => billingApi.grants(ownerId, signal),
    enabled: enabled && !!ownerId,
    retry: false,
  });
  const allowances = useQuery({
    queryKey: [...root, ownerId, "allowances"],
    queryFn: ({ signal }) => billingApi.allowances(ownerId, signal),
    enabled: enabled && !!ownerId,
    retry: false,
  });
  async function refresh() {
    await Promise.allSettled([
      client.invalidateQueries({
        queryKey: ["workspace", "billing", write.epoch],
      }),
      client.invalidateQueries({ queryKey: root }),
    ]);
  }
  async function review() {
    const [billResult, invoiceResult, orgResult, topupResult] =
      await Promise.all([
        bill.refetch(),
        invoices.refetch(),
        orgs.refetch(),
        !ownerId && hasWallet ? topups.refetch() : Promise.resolve(undefined),
      ]);
    if (!write.current()) return;
    if (
      canReviewBilling([
        billResult,
        invoiceResult,
        orgResult,
        ...(topupResult ? [topupResult] : []),
      ]) &&
      (!ownerId ||
        (orgResult.data?.kind === "ready" &&
          orgResult.data.data.some((org) => org.id === ownerId)))
    ) {
      write.reviewed();
      setBrowserError(undefined);
      setNotice(
        "Server billing records refreshed. Pending payments still require settlement; retrying checkout reuses the same payment request.",
      );
    } else
      setBrowserError(
        "Some billing records could not be verified. Refresh again before retrying a payment.",
      );
    await client.invalidateQueries({
      queryKey: ["workspace", "billing", write.epoch],
    });
  }
  useEffect(() => {
    if (write.active && visible) void refresh();
    else void client.cancelQueries({ queryKey: root });
  }, [write.active, write.epoch, visible]);
  async function browser(url: string, payment = false) {
    if (browserLock.current || !write.interactive()) return;
    browserLock.current = true;
    setBrowserBusy(true);
    setBrowserError(undefined);
    try {
      await WebBrowser.openBrowserAsync(secureExternalUrl(url));
      if (!write.current()) return;
      setNotice(
        payment
          ? "Returned from the browser. Payment is confirmed only when server history says Paid; pending payments may settle later. Refresh to check again."
          : "Returned from the browser. Refreshing server billing records.",
      );
      await refresh();
    } catch {
      if (write.current())
        setBrowserError(
          "Could not open the browser. Your checkout remains available; review history before trying again.",
        );
    } finally {
      browserLock.current = false;
      if (write.current()) setBrowserBusy(false);
    }
  }
  async function checkoutRequest() {
    if (!session.attempt)
      session.attempt = {
        input: {
          amount_credits: Number(amount),
          idempotency_key: Crypto.randomUUID(),
        },
      };
    const pending = session.attempt;
    setAttempt(pending);
    await write.run(async (current) => {
      const result = await api.checkout(pending.input, current);
      if (!current()) return;
      session.attempt = {
        ...pending,
        result: { url: result.checkout_url, status: result.status },
      };
      setAttempt(session.attempt);
      setNotice(
        result.status === "failed"
          ? "Checkout creation failed. Review history on web before starting another payment."
          : "Checkout created. Credits are not added until the server confirms payment.",
      );
      await refresh();
    });
  }
  async function receipt(id: string) {
    if (browserLock.current || !write.interactive()) return;
    const capturedOwner = ownerId;
    try {
      const url = await api.receipt(id, capturedOwner);
      if (write.interactive() && currentOwner.current === capturedOwner)
        await browser(url);
    } catch {
      if (write.current())
        setBrowserError(
          "The receipt is not available yet. Refresh and try again.",
        );
    }
  }
  const busy = write.busy || browserBusy;
  const pendingServerPayment =
    topups.data?.topups.some((row) => row.status === "pending") === true;
  const mayOpenNewWebPayment =
    !attempt &&
    !write.uncertain &&
    !pendingServerPayment &&
    topups.isSuccess &&
    !topups.isError;
  if (!visible) return null;
  return (
    <>
      <Label>
        Billing account:{" "}
        {ownerId
          ? (selectedOrg?.display_name ??
            selectedOrg?.slug ??
            "Membership no longer available")
          : "Your personal account"}
      </Label>
      <ActionButton
        compact
        label="Personal billing"
        variant="secondary"
        disabled={busy}
        onPress={() => {
          setOwnerId(undefined);
          setPage(1);
        }}
      />
      {!orgs.isError &&
        orgs.data?.kind === "ready" &&
        orgs.data.data.map((org) => (
          <ActionButton
            key={org.id}
            compact
            label={`Billing for ${org.display_name ?? org.slug}`}
            variant="secondary"
            disabled={busy}
            onPress={() => {
              setOwnerId(org.id);
              setPage(1);
            }}
          />
        ))}
      {orgs.isError && (
        <Notice message="Organizations could not be loaded. Retry refresh to check your current memberships." />
      )}
      {!available && (
        <Notice message="Billing is unavailable on this server. Try again when it is enabled." />
      )}
      {write.error && <Notice tone="error" message={write.error} />}
      {browserError && <Notice tone="error" message={browserError} />}
      {notice && <Notice message={notice} />}
      {!ownerId && available && (
        <>
          {!hasWallet ? (
            <ActionButton
              label="Open my billing wallet"
              disabled={busy || write.uncertain || !write.active}
              loading={write.busy}
              onPress={() =>
                void write.run(async (current) => {
                  await api.provision(current);
                  if (current()) {
                    setNotice("Wallet opened. Refreshing your balance.");
                    await refresh();
                  }
                })
              }
            />
          ) : (
            <>
              <Field
                label="Credits to add"
                keyboardType="number-pad"
                value={attempt ? String(attempt.input.amount_credits) : amount}
                editable={!busy && !attempt}
                onChangeText={setAmount}
              />
              <Label muted>
                Payment details are entered in the provider's secure browser
                checkout.
              </Label>
              {pendingServerPayment && !attempt && (
                <Notice message="A pending payment already exists. Review recent recharge history or continue on web before starting another payment." />
              )}
              {!checkout && (
                <ActionButton
                  label={
                    checkoutUncertain
                      ? "Retry same checkout request"
                      : "Create secure checkout"
                  }
                  disabled={
                    busy ||
                    write.uncertain ||
                    !write.active ||
                    topups.isError ||
                    !topups.isSuccess ||
                    topups.isFetching ||
                    (!attempt &&
                      topups.data.topups.some(
                        (row) => row.status === "pending",
                      )) ||
                    !Number.isSafeInteger(Number(amount)) ||
                    Number(amount) <= 0 ||
                    Number(amount) > 10_000_000
                  }
                  loading={write.busy}
                  onPress={() => void checkoutRequest()}
                />
              )}
              {checkout && checkout.status !== "failed" && (
                <ActionButton
                  label="Continue this checkout in browser"
                  disabled={busy || !write.active}
                  onPress={() => void browser(checkout.url, true)}
                />
              )}
              {(checkout || checkoutUncertain) && (
                <Label muted>
                  This payment request is retained while this screen is open. To
                  start a different payment, review the server history and use
                  Add credits on web.
                </Label>
              )}
              <ActionButton
                compact
                label={
                  mayOpenNewWebPayment
                    ? "Add credits on web"
                    : "Review payments on web"
                }
                variant="secondary"
                disabled={busy || !write.active}
                onPress={() =>
                  void browser(
                    `${NYXID_FRONTEND_URL.replace(/\/$/, "")}/billing${mayOpenNewWebPayment ? "?action=topup" : ""}`,
                    true,
                  )
                }
              />
            </>
          )}
        </>
      )}
      {ownerId && authorized && (
        <>
          <Label muted>
            Organization bills and benefits are shown below. Personal wallet
            balances and recharge history are never used for an organization.
          </Label>
          {grants.data?.kind === "ready" &&
            grants.data.data.grants.map((grant) => (
              <Label key={grant.id}>
                Included credits: {formatCredits(grant.remaining)} ·{" "}
                {grant.status}
                {grant.reason ? ` · ${grant.reason}` : ""}
              </Label>
            ))}
          {allowances.data?.kind === "ready" &&
            allowances.data.data.allowances.map((entry) => (
              <Label key={entry.allowance.id}>
                {entry.allowance.service_slug} · {entry.remaining_quantity}{" "}
                {entry.allowance.metric} remaining ·{" "}
                {entry.allowance.recurrence}
              </Label>
            ))}
          {(grants.isError ||
            allowances.isError ||
            (grants.data && grants.data.kind !== "ready") ||
            (allowances.data && allowances.data.kind !== "ready")) && (
            <Notice message="Organization benefits are unavailable. Your membership or this server's billing capability may have changed." />
          )}
        </>
      )}
      {!ownerId && (
        <ActionButton
          compact
          label="Usage analytics & agent request activity on web"
          variant="secondary"
          disabled={busy || !write.active}
          onPress={() =>
            void browser(
              `${NYXID_FRONTEND_URL.replace(/\/$/, "")}/billing?tab=usage&period=${period}`,
            )
          }
        />
      )}
      <ActionButton
        label="Refresh server billing status"
        variant="secondary"
        disabled={busy || !write.active}
        onPress={() => void review()}
      />
      {!ownerId && hasWallet && (
        <Card>
          <Label>Recharge history · server status</Label>
          {topups.isPending && <Label muted>Loading…</Label>}
          {topups.isError && (
            <Notice tone="error" message={machineError(topups.error)} />
          )}
          {topups.data?.topups.map((row) => (
            <Card key={row.id}>
              <Label>
                {row.amount_credits} credits ·{" "}
                {row.status === "paid" ? "Paid (server confirmed)" : row.status}
              </Label>
              <Label muted>
                {billingDate(row.created_at)}
                {row.invoice_number ? ` · ${row.invoice_number}` : ""}
                {row.paid_at ? ` · Paid ${billingDate(row.paid_at)}` : ""}
              </Label>
              {row.credits_expire_at && (
                <Label muted>
                  Credits expire {billingDate(row.credits_expire_at)}
                </Label>
              )}
              {row.receipt_available && row.lago_invoice_id && (
                <ActionButton
                  compact
                  label="Open recharge receipt"
                  variant="secondary"
                  disabled={
                    busy || topups.isError || topups.isFetching || !write.active
                  }
                  onPress={() => void receipt(row.lago_invoice_id!)}
                />
              )}
            </Card>
          ))}
          {topups.data && !topups.data.topups.length && (
            <Label muted>No recharge records.</Label>
          )}
          {topupPage > 1 && (
            <ActionButton
              compact
              label="Previous recharges"
              variant="secondary"
              onPress={() => setTopupPage(topupPage - 1)}
            />
          )}
          {topups.data &&
            topupPage * topups.data.per_page < topups.data.total && (
              <ActionButton
                compact
                label="More recharges"
                variant="secondary"
                onPress={() => setTopupPage(topupPage + 1)}
              />
            )}
        </Card>
      )}
      {authorized && available && (
        <>
          <Card>
            <Label>Current bill</Label>
            {bill.isPending && <Label muted>Loading…</Label>}
            {bill.isError && (
              <Notice tone="error" message={machineError(bill.error)} />
            )}
            {bill.data && (
              <>
                <Label muted>
                  {bill.data.from} – {bill.data.to}
                </Label>
                {bill.data.charges.map((charge, index) => (
                  <Label key={`${charge.metric_code}:${index}`}>
                    {charge.name} · {charge.units} units ·{" "}
                    {formatCredits(charge.amount)} {bill.data.currency}
                  </Label>
                ))}
                <Label>
                  Subtotal {formatCredits(bill.data.subtotal)} · Tax{" "}
                  {formatCredits(bill.data.tax_total)} · Total{" "}
                  {formatCredits(bill.data.total)} {bill.data.currency}
                </Label>
                {bill.data.taxes.map((tax, index) => (
                  <Label key={index}>
                    {tax.name} ({tax.rate_percent}%) ·{" "}
                    {formatCredits(tax.amount)} {bill.data.currency}
                  </Label>
                ))}
                {!bill.data.tax_breakdown_available && (
                  <Label muted>Tax breakdown unavailable.</Label>
                )}
              </>
            )}
          </Card>
          <Card>
            <Label>Bills & receipts</Label>
            {invoices.isPending && <Label muted>Loading…</Label>}
            {invoices.isError && (
              <Notice tone="error" message={machineError(invoices.error)} />
            )}
            {invoices.data?.invoices.map((row) => (
              <Card key={row.id}>
                <Label>
                  {row.number} · {row.payment_status} · {row.issuing_date}
                </Label>
                <Label>
                  Total {formatCredits(row.total)} · Due{" "}
                  {formatCredits(row.amount_due)} {row.currency}
                </Label>
                <Label muted>
                  Tax {formatCredits(row.tax_total)} · Prepaid applied{" "}
                  {formatCredits(row.prepaid_credits_applied)}
                </Label>
                <ActionButton
                  compact
                  label={`Receipt for ${row.number}`}
                  variant="secondary"
                  disabled={
                    busy ||
                    invoices.isError ||
                    invoices.isFetching ||
                    !write.active
                  }
                  onPress={() => void receipt(row.id)}
                />
              </Card>
            ))}
            {invoices.data && !invoices.data.invoices.length && (
              <Label muted>No invoices.</Label>
            )}
            {page > 1 && (
              <ActionButton
                compact
                label="Previous invoices"
                variant="secondary"
                onPress={() => setPage(page - 1)}
              />
            )}
            {invoices.data &&
              page * invoices.data.per_page < invoices.data.total && (
                <ActionButton
                  compact
                  label="More invoices"
                  variant="secondary"
                  onPress={() => setPage(page + 1)}
                />
              )}
          </Card>
        </>
      )}
    </>
  );
}
