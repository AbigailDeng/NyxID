import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";
import { ActionButton, Card, Label, Notice, WorkspacePage } from "../../components/workspace/WorkspaceUI";
import { SegmentControl } from "../../components/SegmentControl";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import { getAuthEpoch } from "../../lib/auth/authEpoch";
import { billingApi } from "../../lib/api/billingApi";
import { ApiError } from "../../lib/api/ApiError";
import { useAuthSession } from "../auth/AuthSessionContext";
import { billingPeriodSchema, serviceUsage, type BillingPeriod } from "./billingContracts";
import type { BillingRead } from "./billingTransport";
import { BillingAllowanceCard, BillingFigure, BillingGrantCard, BillingOwnerRow, BillingServiceCard, BillingWalletCard } from "./BillingPresentation";
import { formatCredits } from "./credits";

export type UsageCreditsRouteParams = { period?: BillingPeriod; ownerId?: string };
export type UsageCreditsScreenProps = { route?: { params?: UsageCreditsRouteParams } };
const periods = ["24h", "7d", "30d"] as const;

function message(error: unknown) {
  if (error instanceof z.ZodError) return "This server returned unsupported billing data. Please try again later.";
  if (error instanceof ApiError && error.statusCode === 403) return "You do not have access to these billing details. Review the selected account and try again.";
  return "Could not load billing details. Please try again.";
}

function ReadState<T>({ query, online, unsupported = "These billing details are not available on this server.", children }: { query: UseQueryResult<BillingRead<T>>; online: boolean; unsupported?: string; children: (value: T) => React.ReactNode }) {
  if (query.isError) return <Notice tone="error" message={message(query.error)} />;
  if (!query.data) return online ? <Label muted>Loading…</Label> : <Label muted>No saved data. Connect to load billing details.</Label>;
  if (query.data.kind === "disabled") return <Label muted>Billing is not enabled for this account.</Label>;
  if (query.data.kind === "unsupported") return <Label muted>{unsupported}</Label>;
  return <>{children(query.data.data)}</>;
}

export function UsageCreditsScreen({ route }: UsageCreditsScreenProps = {}) {
  const [period, setPeriod] = useState<BillingPeriod>(() => billingPeriodSchema.catch("30d").parse(route?.params?.period));
  const [ownerId, setOwnerId] = useState(route?.params?.ownerId);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [serviceLimit, setServiceLimit] = useState(10);
  const [grantLimit, setGrantLimit] = useState(10);
  const [allowanceLimit, setAllowanceLimit] = useState(10);
  const focused = useIsFocused();
  const { isConnected, recheckConnection } = useNetworkStatus();
  const { isAuthenticated } = useAuthSession();
  const epoch = getAuthEpoch();
  const active = focused && foreground && isConnected && isAuthenticated;
  const canRefresh = useRef(false);
  canRefresh.current = focused && foreground && isAuthenticated;
  const client = useQueryClient();
  const root = ["workspace", "billing", epoch] as const;
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => listener.remove();
  }, []);
  useEffect(() => () => { void client.cancelQueries({ queryKey: ["workspace", "billing", epoch] }); }, [active, epoch, client]);
  useEffect(() => () => { canRefresh.current = false; }, []);
  useEffect(() => {
    setPeriod(billingPeriodSchema.catch("30d").parse(route?.params?.period));
    setOwnerId(route?.params?.ownerId);
  }, [route?.params?.period, route?.params?.ownerId]);
  const organizations = useQuery({ queryKey: [...root, "organizations"], queryFn: ({ signal }) => billingApi.organizations(signal), enabled: active, retry: false, staleTime: 30_000 });
  const orgs = !organizations.isError && organizations.data?.kind === "ready" ? organizations.data.data : [];
  const owner = orgs.find((org) => org.id === ownerId);
  const benefitsAllowed = !ownerId || !!owner;
  const wallet = useQuery({ queryKey: [...root, "wallet"], queryFn: ({ signal }) => billingApi.wallet(signal), enabled: active, retry: false, staleTime: 30_000 });
  const usage = useQuery({ queryKey: [...root, "usage", period], queryFn: ({ signal }) => billingApi.usage(period, signal), enabled: active, retry: false, staleTime: 30_000 });
  const grants = useQuery({ queryKey: [...root, "grants", ownerId ?? "personal"], queryFn: ({ signal }) => billingApi.grants(ownerId, signal), enabled: active && benefitsAllowed, retry: false, staleTime: 30_000 });
  const allowances = useQuery({ queryKey: [...root, "allowances", ownerId ?? "personal"], queryFn: ({ signal }) => billingApi.allowances(ownerId, signal), enabled: active && benefitsAllowed, retry: false, staleTime: 30_000 });
  const services = useMemo(() => usage.data?.kind === "ready" ? serviceUsage(usage.data.data.rows) : [], [usage.data]);
  useEffect(() => { setServiceLimit(10); }, [period, epoch]);
  useEffect(() => { setGrantLimit(10); setAllowanceLimit(10); }, [ownerId, epoch]);
  const fetching = organizations.isFetching || wallet.isFetching || usage.isFetching || grants.isFetching || allowances.isFetching;
  async function refresh() {
    if (fetching || !focused || !foreground || !isAuthenticated) return;
    if (!isConnected && !await recheckConnection()) return;
    if (!canRefresh.current || getAuthEpoch() !== epoch) return;
    await Promise.allSettled([organizations.refetch(), wallet.refetch(), usage.refetch(), ...(benefitsAllowed ? [grants.refetch(), allowances.refetch()] : [])]);
  }
  if (!isAuthenticated) return <WorkspacePage title="Usage & credits"><Label>Sign in to review your usage and credits.</Label></WorkspacePage>;
  const now = Date.now();
  return <WorkspacePage title="Usage & credits" subtitle="Review your usage, balance and credit limits." refreshing={fetching} onRefresh={() => void refresh()}>
    {!isConnected && <Notice message="Offline. Showing previously loaded details where available. Connect to refresh." />}
    <Label muted>To add credits, use NyxID on the web.</Label>
    <ReadState query={wallet} online={isConnected} unsupported="Wallet balances are not available on this server.">{(data) => <BillingWalletCard wallet={data} />}</ReadState>
    <Label accessibilityRole="header">Personal usage</Label>
    <SegmentControl segments={[{ label: "24 hours" }, { label: "7 days" }, { label: "30 days" }]} activeIndex={periods.indexOf(period)} onPress={(index) => setPeriod(periods[index] ?? "30d")} />
    <ReadState query={usage} online={isConnected}>{(data) => <>
      {!data.billing.charging_enabled && <Notice message="Charging is disabled. Metered usage may still appear." />}
      <Card><Label accessibilityRole="header">Period total</Label>
        <BillingFigure label="Usage cost" value={data.totals.cost === null ? null : formatCredits(data.totals.cost)} />
        <BillingFigure label="From wallet" value={data.totals.wallet === null ? null : formatCredits(data.totals.wallet)} />
        <BillingFigure label="From grants" value={data.totals.grants === null ? null : formatCredits(data.totals.grants)} />
        {data.billing.rates_are_approximate && <Label muted>Usage costs are estimates. Some historical costs may be unavailable.</Label>}
      </Card>
      {data.rows.length === 0 && <Card><Label muted>No usage recorded for this period.</Label></Card>}
      {services.slice(0, serviceLimit).map((service) => <BillingServiceCard key={`${period}:${service.key}`} service={service} />)}
      {services.length > serviceLimit && <ActionButton label="Show more services" variant="secondary" onPress={() => setServiceLimit((limit) => limit + 10)} />}
    </>}</ReadState>
    <Label accessibilityRole="header">Credit grants & allowances</Label>
    <Label muted>The account selection below applies to grants and allowances. Wallet and usage above are personal.</Label>
    <View style={styles.owners} accessibilityRole="radiogroup" accessibilityLabel="Credit grants and allowances account">
      <BillingOwnerRow label="Personal account" selected={!ownerId} onPress={() => setOwnerId(undefined)} />
      {orgs.map((org) => <BillingOwnerRow key={org.id} label={org.display_name || org.slug} selected={ownerId === org.id} onPress={() => setOwnerId(org.id)} />)}
    </View>
    {organizations.isError && <Notice tone="error" message="Could not load organization access. Retry to review available accounts." />}
    {ownerId && !benefitsAllowed && <Notice tone="error" message={organizations.isPending ? "Checking organization access…" : "This organization is not available for billing. Choose another account."} />}
    {benefitsAllowed && <>
      <Label accessibilityRole="header">{owner ? `${owner.display_name || owner.slug} credit grants` : "Personal credit grants"}</Label>
      <ReadState query={grants} online={isConnected}>{({ grants: rows }) => <>
        {rows.length === 0 && <Card><Label muted>No active credit grants.</Label></Card>}
        {rows.slice(0, grantLimit).map((grant) => <BillingGrantCard key={grant.id} grant={grant} now={now} />)}
        {rows.length > grantLimit && <ActionButton label="Show more grants" variant="secondary" onPress={() => setGrantLimit((limit) => limit + 10)} />}
      </>}</ReadState>
      <Label accessibilityRole="header">{owner ? `${owner.display_name || owner.slug} allowances` : "Personal allowances"}</Label>
      <ReadState query={allowances} online={isConnected}>{({ allowances: rows }) => <>
        {rows.length === 0 && <Card><Label muted>No usage allowances.</Label></Card>}
        {rows.slice(0, allowanceLimit).map((balance) => <BillingAllowanceCard key={balance.allowance.id} balance={balance} now={now} />)}
        {rows.length > allowanceLimit && <ActionButton label="Show more allowances" variant="secondary" onPress={() => setAllowanceLimit((limit) => limit + 10)} />}
      </>}</ReadState>
    </>}
    <ActionButton label={fetching ? "Refreshing…" : "Refresh billing details"} variant="secondary" disabled={fetching} onPress={() => void refresh()} />
  </WorkspacePage>;
}

const styles = StyleSheet.create({ owners: { gap: 8 } });
