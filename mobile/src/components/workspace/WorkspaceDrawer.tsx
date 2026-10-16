import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Bot,
  CalendarClock,
  ChevronRight,
  KeyRound,
  MessageSquare,
  Plug,
  ScanQrCode,
  ShieldCheck,
  X,
} from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUserProfileRequest } from "../../lib/api/http";
import { useTheme } from "../../theme/ThemeContext";
import { fonts } from "../../theme/designTokens";
import type { WorkspaceChatTarget } from "../../app/workspaceChatNavigation";
import { getAuthEpoch } from "../../lib/auth/authEpoch";
import { WorkspaceChatList } from "./WorkspaceChatList";
import { WorkspaceDrawerModal } from "./WorkspaceDrawerModal";

export type WorkspaceRoute =
  | "Assistant"
  | "Automations"
  | "Activity"
  | "Services"
  | "Plugins"
  | "Agents"
  | "AccountSettings";
const destinations = [
  { route: "Assistant", label: "Chats", Icon: MessageSquare },
  { route: "Agents", label: "Agents & Groups", Icon: Bot },
  { route: "Plugins", label: "Plugins", Icon: Plug },
  { route: "Automations", label: "Automations", Icon: CalendarClock },
  { route: "Activity", label: "Approvals", Icon: ShieldCheck },
] as const;

export function WorkspaceDrawer({
  visible,
  currentRoute,
  onClose,
  onNavigate,
  onScan,
  onLoginCode,
  currentChat,
  onOpenChat,
}: {
  visible: boolean;
  currentRoute?: string;
  onClose: () => void;
  onNavigate: (route: WorkspaceRoute) => void;
  onScan: () => void;
  onLoginCode: () => void;
  currentChat?: WorkspaceChatTarget;
  onOpenChat: (target: WorkspaceChatTarget) => void;
}) {
  const { colors } = useTheme();
  const profile = useQuery({
    queryKey: ["account", "profile"],
    queryFn: ({ signal }) => getCurrentUserProfileRequest(signal),
    enabled: visible,
  });
  const title =
    profile.data?.display_name || profile.data?.email || "Your account";
  return (
    <WorkspaceDrawerModal visible={visible} onClose={onClose}>
      <SafeAreaView
        style={[
          styles.panel,
          { backgroundColor: colors.cardSoft, borderColor: colors.border },
        ]}
      >
        <View style={styles.brandRow}>
          <Text style={[styles.brand, { color: colors.textPrimary }]}>
            NyxID
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close navigation"
            onPress={onClose}
            style={styles.iconButton}
          >
            <X color={colors.textSecondary} size={20} />
          </Pressable>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
          <Text style={[styles.section, { color: colors.textMuted }]}>
            QUICK ACTIONS
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onScan}
            style={styles.row}
          >
            <ScanQrCode color={colors.textSecondary} size={19} />
            <Text style={[styles.rowText, { color: colors.textPrimary }]}>
              Scan QR code
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onLoginCode}
            style={styles.row}
          >
            <KeyRound color={colors.textSecondary} size={19} />
            <Text style={[styles.rowText, { color: colors.textPrimary }]}>
              Terminal login code
            </Text>
          </Pressable>
          <Text style={[styles.section, { color: colors.textMuted }]}>
            YOUR WORKSPACE
          </Text>
          {destinations.map(({ route, label, Icon }) => (
            <Pressable
              key={route}
              accessibilityRole="button"
              accessibilityState={{ selected: currentRoute === route }}
              onPress={() => onNavigate(route)}
              style={[
                styles.row,
                {
                  backgroundColor:
                    currentRoute === route ? colors.navActive : "transparent",
                },
              ]}
            >
              <Icon
                color={
                  currentRoute === route ? colors.primary : colors.textSecondary
                }
                size={19}
              />
              <Text style={[styles.rowText, { color: colors.textPrimary }]}>
                {label}
              </Text>
            </Pressable>
          ))}
          <WorkspaceChatList
            key={getAuthEpoch()}
            visible={visible}
            current={currentChat}
            onSelect={onOpenChat}
          />
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open account settings"
          accessibilityHint="Manage your account, security and app preferences"
          accessibilityState={{
            selected: currentRoute === "AccountSettings",
          }}
          onPress={() => onNavigate("AccountSettings")}
          style={({ pressed }) => [
            styles.account,
            {
              borderColor: colors.border,
              backgroundColor:
                pressed || currentRoute === "AccountSettings"
                  ? colors.navActive
                  : "transparent",
            },
          ]}
        >
          <View
            style={[styles.avatar, { backgroundColor: colors.primaryGlow }]}
          >
            <Text style={[styles.initial, { color: colors.primaryOnTint }]}>
              {title.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.accountText}>
            <Text
              numberOfLines={1}
              style={[styles.rowText, { color: colors.textPrimary }]}
            >
              {title}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.email, { color: colors.textSecondary }]}
            >
              {profile.data?.email || "Account & security"}
            </Text>
          </View>
          <ChevronRight
            size={18}
            color={
              currentRoute === "AccountSettings"
                ? colors.primary
                : colors.textSecondary
            }
          />
        </Pressable>
      </SafeAreaView>
    </WorkspaceDrawerModal>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, borderRightWidth: 1 },
  brandRow: {
    flexShrink: 0,
    paddingLeft: 24,
    paddingRight: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  brand: { fontFamily: fonts.bodySemi, fontSize: 19 },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { flex: 1 },
  body: { padding: 16, gap: 6 },
  section: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.5,
    padding: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  rowText: { fontFamily: fonts.body, fontSize: 14 },
  account: {
    flexShrink: 0,
    marginHorizontal: 16,
    borderTopWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { fontFamily: fonts.displaySemi, fontSize: 17 },
  accountText: { flex: 1, gap: 4 },
  email: { fontFamily: fonts.bodyRegular, fontSize: 11 },
});
