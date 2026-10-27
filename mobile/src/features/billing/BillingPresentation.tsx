import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ActionButton, Card, Label } from "../../components/workspace/WorkspaceUI";
import { useTheme } from "../../theme/ThemeContext";
import { radius, spacing, typeScale } from "../../theme/designTokens";
import { billingDate, expiryLabel, formatCredits, formatQuantity } from "./credits";
import type { BillingAllowance, BillingGrant, BillingWallet, serviceUsage } from "./billingContracts";

export function BillingBadge({ label }: { label: string }) {
  const { colors } = useTheme();
  return <View style={[styles.badge, { backgroundColor: colors.cardSoft, borderColor: colors.border }]}>
    <Label style={typeScale.badge}>{label}</Label>
  </View>;
}

export function BillingOwnerRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected }} onPress={onPress}
    style={({ pressed }) => [styles.owner, { borderColor: colors.controlBorder, backgroundColor: selected || pressed ? colors.navActive : colors.cardSoft }]}>
    <Label style={{ flex: 1 }}>{label}</Label>
    {selected && <BillingBadge label="Selected" />}
  </Pressable>;
}

export function BillingFigure({ label, value, unit = "credits" }: { label: string; value: string | null; unit?: string }) {
  const { colors } = useTheme();
  return <View accessible accessibilityLabel={`${label}: ${value === null ? "unavailable" : `${value} ${unit}`}`} style={styles.figure}>
    <Label muted style={styles.figureLabel}>{label}</Label>
    <Label mono style={[styles.amount, { color: value?.startsWith("-") ? colors.danger : colors.textPrimary }]}>
      {value ?? "Unavailable"}{value === null || !unit ? "" : ` ${unit}`}
    </Label>
  </View>;
}

function CreditFigure({ label, amount }: { label: string; amount: string | null }) {
  return <BillingFigure label={label} value={amount === null ? null : formatCredits(amount)} />;
}

export function BillingWalletCard({ wallet }: { wallet: BillingWallet | null }) {
  if (!wallet) return <Card><Label accessibilityRole="header">Personal wallet</Label><Label muted>No billing account yet.</Label></Card>;
  return <Card>
    <Label accessibilityRole="header">Personal wallet</Label>
    <BillingBadge label={wallet.suspended ? "Suspended" : wallet.collectionState === "past_due" ? "Past due" : "Active"} />
    <CreditFigure label="Available" amount={wallet.available} />
    <CreditFigure label="Balance" amount={wallet.balance} />
    <CreditFigure label="Reserved" amount={wallet.reserved} />
    <CreditFigure label="Pending debits" amount={wallet.pendingDebits} />
    <CreditFigure label="Pending expiry" amount={wallet.pendingExpiry} />
    <CreditFigure label="Overdraft limit" amount={wallet.overdraftCap} />
    <CreditFigure label="Available with overdraft" amount={wallet.availableWithOverdraft} />
    <Label muted>Updated {billingDate(wallet.syncedAt)} (UTC). Pending debits and expiry can change the available balance.</Label>
  </Card>;
}

export function BillingServiceCard({ service }: { service: ReturnType<typeof serviceUsage>[number] }) {
  const [limit, setLimit] = useState(5);
  return <Card>
    <Label accessibilityRole="header">{service.name}</Label>
    {service.meteringOnly && <BillingBadge label="Metering only" />}
    <CreditFigure label="Usage cost" amount={service.cost} />
    <CreditFigure label="From wallet" amount={service.wallet} />
    <CreditFigure label="From grants" amount={service.grants} />
    {service.rows.slice(0, limit).map((row, index) => <BillingFigure key={index}
      label={[row.metric.replaceAll("_", " "), row.model, row.layer].filter(Boolean).join(" · ")}
      value={formatQuantity(row.quantity)} unit="" />)}
    {service.rows.length > limit && <ActionButton label="Show more usage entries" accessibilityLabel={`Show more usage entries for ${service.name}`} variant="secondary" onPress={() => setLimit((current) => current + 10)} />}
  </Card>;
}

export function BillingGrantCard({ grant, now }: { grant: BillingGrant; now: number }) {
  const expired = !!grant.expires_at && Date.parse(grant.expires_at) <= now;
  return <Card>
    <Label accessibilityRole="header">{grant.reason?.trim() || "Credit grant"}</Label>
    <BillingBadge label={expired ? "Expired" : grant.activation_state === "pending_activation" ? "Pending activation" : grant.status[0]!.toUpperCase() + grant.status.slice(1)} />
    <Label muted>{expiryLabel(grant.expires_at, now)}</Label>
    <CreditFigure label="Remaining" amount={grant.remaining} />
    <CreditFigure label="Granted" amount={grant.amount} />
    <CreditFigure label="Reserved" amount={grant.reserved} />
    <Label muted>{grant.scope.all_services ? "All services" : `Services: ${grant.scope.service_slugs.join(", ") || "Selected services"}`}</Label>
    {grant.service_limits.map((limit) => <View key={limit.key} style={styles.limit}>
      <Label>{limit.label ?? (limit.service_slugs.join(", ") || "Service limit")}</Label>
      <CreditFigure label="Credit limit" amount={limit.limit} />
      <CreditFigure label="Consumed" amount={limit.consumed} />
      <CreditFigure label="Held" amount={limit.held ?? limit.reserved} />
    </View>)}
  </Card>;
}

export function BillingAllowanceCard({ balance, now }: { balance: BillingAllowance; now: number }) {
  const { allowance } = balance;
  const ended = !!balance.period_end && Date.parse(balance.period_end) <= now;
  return <Card>
    <Label accessibilityRole="header">{allowance.service_slug}</Label>
    <BillingBadge label={!allowance.is_active ? "Inactive" : ended ? "Period ended" : balance.remaining_quantity === 0 ? "Used up" : "Available"} />
    <Label muted>{allowance.metric.replaceAll("_", " ")} · {allowance.recurrence.replaceAll("_", " ")}</Label>
    <BillingFigure label="Remaining" value={formatQuantity(balance.remaining_quantity)} unit="units" />
    <BillingFigure label="Period limit" value={formatQuantity(allowance.quantity)} unit="units" />
    <BillingFigure label="Consumed" value={formatQuantity(balance.consumed_quantity)} unit="units" />
    <BillingFigure label="Reserved" value={formatQuantity(balance.reserved_quantity)} unit="units" />
    <Label muted>{billingDate(balance.period_start)}{balance.period_end ? ` – ${billingDate(balance.period_end)}` : " onwards"} (UTC)</Label>
  </Card>;
}

const styles = StyleSheet.create({
  owner: { minHeight: 48, padding: spacing.lg, borderWidth: 1, borderRadius: radius.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  badge: { alignSelf: "flex-start", borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  figure: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  figureLabel: { flex: 1 },
  amount: { flex: 1.4, textAlign: "right", fontVariant: ["tabular-nums"] },
  limit: { gap: spacing.sm, marginTop: spacing.sm },
});
