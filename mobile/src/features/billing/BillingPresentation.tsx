import { Pressable, StyleSheet, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { Card, Label } from "../../components/workspace/WorkspaceUI";
import { useTheme } from "../../theme/ThemeContext";
import { radius, spacing, typeScale } from "../../theme/designTokens";
import { formatCredits } from "./credits";
import type { BillingAllowance, BillingGrant, BillingWallet, serviceUsage } from "./billingContracts";
import { balanceRows } from "./balanceSummary";

export function BillingBadge({ label }: { label: string }) {
  const { colors } = useTheme();
  return <View style={[styles.badge, { backgroundColor: colors.cardSoft, borderColor: colors.border }]}>
    <Label style={typeScale.badge}>{label}</Label>
  </View>;
}

export function BillingFigure({ label, value, unit = "credits" }: { label: string; value: string | null; unit?: string }) {
  const { colors } = useTheme();
  return <View accessible accessibilityLabel={`${label}: ${value === null ? "unavailable" : `${value}${unit ? ` ${unit}` : ""}`}`} style={styles.figure}>
    <Label muted style={styles.figureLabel}>{label}</Label>
    <Label mono style={[styles.amount, { color: value?.startsWith("-") ? colors.danger : colors.textPrimary }]}>
      {value ?? "Unavailable"}{value === null || !unit ? "" : ` ${unit}`}
    </Label>
  </View>;
}

export function BillingWalletCard({ wallet, grants, allowances, now }: { wallet: BillingWallet; grants: BillingGrant[]; allowances: BillingAllowance[]; now: number }) {
  const { colors } = useTheme();
  return <Card>
    <Label muted>Available credits</Label>
    <Label mono accessibilityLabel={`Available credits: ${formatCredits(wallet.available)}`}
      style={[styles.balance, { color: wallet.available?.startsWith("-") ? colors.danger : colors.textPrimary }]}>
      {formatCredits(wallet.available)}
    </Label>
    {wallet.suspended ? <BillingBadge label="Suspended" /> : wallet.collectionState === "past_due" ? <BillingBadge label="Past due" /> : null}
    {balanceRows(wallet, grants, allowances, now).map((row) => <BillingFigure key={row.key} label={row.label} value={row.value} unit={row.unit} />)}
  </Card>;
}

export function BillingServiceCard({ service }: { service: ReturnType<typeof serviceUsage>[number] }) {
  return <Card>
    <BillingFigure label={service.name} value={service.cost === null ? null : formatCredits(service.cost)} />
    {service.meteringOnly && <BillingBadge label="Metering only" />}
  </Card>;
}

export function BillingHistoryRow({ expanded, onPress }: { expanded: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return <Pressable accessibilityRole="button" accessibilityLabel="Usage history" accessibilityState={{ expanded }} onPress={onPress}
    style={({ pressed }) => [styles.history, { borderColor: colors.border, backgroundColor: pressed ? colors.cardSoft : colors.card }]}>
    <Label style={styles.figureLabel}>Usage history</Label>
    <Chevron size={18} color={colors.textMuted} accessible={false} />
  </Pressable>;
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  figure: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  figureLabel: { flex: 1 },
  amount: { flex: 1.4, textAlign: "right", fontVariant: ["tabular-nums"] },
  balance: { fontSize: 32, lineHeight: 40, textAlign: "right", fontVariant: ["tabular-nums"] },
  history: { minHeight: 48, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
