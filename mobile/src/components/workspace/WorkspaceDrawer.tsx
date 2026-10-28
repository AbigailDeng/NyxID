import {
  WORKSPACE_CLOSE_ICON_SIZE,
  workspaceCloseControlStyle,
} from "./workspaceCloseControl";
import { NyxidLogo } from "../brand/NyxidLogo";
import type { Ref } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  Bot,
  CalendarClock,
  ChevronRight,
  KeyRound,
  MessageSquare,
  Monitor,
  Plug,
  ScanQrCode,
  ShieldCheck,
  X,
  WalletCards,
} from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUserProfileRequest } from "../../lib/api/http";
import { useTheme } from "../../theme/ThemeContext";
import { fonts } from "../../theme/designTokens";
import type { WorkspaceChatTarget } from "../../app/workspaceChatNavigation";
import { getAuthEpoch } from "../../lib/auth/authEpoch";
import { WorkspaceChatList } from "./WorkspaceChatList";
import { ScrollEdgeFades, useScrollEdges } from "./ScrollEdgeFades";

export type WorkspaceRoute =
  | "Assistant"
  | "Automations"
  | "Machines"
  | "Activity"
  | "Services"
  | "Plugins"
  | "Agents"
  | "AccountSettings";
const destinations = [
  { route: "Agents", label: "Agents & Crews", Icon: Bot },
  { route: "Plugins", label: "Plugins", Icon: Plug },
  { route: "Automations", label: "Automations", Icon: CalendarClock },
  { route: "Machines", label: "Machines", Icon: Monitor },
  { route: "Activity", label: "Approvals", Icon: ShieldCheck },
] as const;

export function WorkspaceDrawer({
  visible,
  currentRoute,
  onClose,
  initialFocusRef,
  onNavigate,
  onHome,
  onScan,
  onLoginCode,
  onUsageCredits,
  currentChat,
  onOpenChat,
  onCreateAgent,
  onCreateGroup,
}: {
  visible: boolean;
  currentRoute?: string;
  onClose: () => void;
  initialFocusRef?: Ref<View>;
  onNavigate: (route: WorkspaceRoute) => void;
  onHome: () => void;
  onScan: () => void;
  onLoginCode: () => void;
  onUsageCredits: () => void;
  currentChat?: WorkspaceChatTarget;
  onOpenChat: (target: WorkspaceChatTarget) => void;
  onCreateAgent: () => void;
  onCreateGroup: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const scroll = useScrollEdges();
  const profile = useQuery({
    queryKey: ["account", "profile"],
    queryFn: ({ signal }) => getCurrentUserProfileRequest(signal),
    enabled: visible,
  });
  const title =
    profile.data?.display_name || profile.data?.email || "Your account";
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[
        styles.panel,
        { backgroundColor: colors.sidebarBase, borderColor: colors.border },
      ]}
    >
      <View style={styles.brandRow}>
        <Pressable
          accessibilityRole="button"
          ref={initialFocusRef}
          accessibilityLabel="NyxID home"
          onPress={onHome}
          style={{ minHeight: 44, justifyContent: "center", flex: 1 }}
        >
          <NyxidLogo />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close navigation"
          onPress={onClose}
          style={workspaceCloseControlStyle(colors.navActive)}
        >
          <X color={colors.textPrimary} size={WORKSPACE_CLOSE_ICON_SIZE} />
        </Pressable>
      </View>
      <View style={styles.scroll}>
        <WorkspaceChatList
          key={getAuthEpoch()}
          visible={visible}
          current={currentChat}
          onSelect={onOpenChat}
          onCreateAgent={onCreateAgent}
          onCreateGroup={onCreateGroup}
          scrollProps={{
            style: styles.scroll,
            contentContainerStyle: styles.body,
            scrollEventThrottle: 32,
            onLayout: (event) => scroll.layout(event.nativeEvent.layout.height),
            onContentSizeChange: (_width, height) => scroll.content(height),
            onScroll: (event) =>
              scroll.scroll(event.nativeEvent.contentOffset.y),
          }}
          scrollHeader={
            <>
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
                  accessibilityLabel={label}
                  accessibilityState={{ selected: currentRoute === route }}
                  onPress={() => onNavigate(route)}
                  style={[
                    styles.row,
                    {
                      backgroundColor:
                        currentRoute === route
                          ? colors.navActive
                          : "transparent",
                    },
                  ]}
                >
                  <Icon
                    color={
                      currentRoute === route
                        ? colors.primary
                        : colors.textSecondary
                    }
                    size={19}
                  />
                  <Text style={[styles.rowText, { color: colors.textPrimary }]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </>
          }
        />
        <ScrollEdgeFades edges={scroll.edges} color={colors.sidebarBase} />
      </View>
      <View style={[styles.accountArea, { borderColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open usage and credits"
          accessibilityState={{ selected: currentRoute === "UsageCredits" }}
          onPress={onUsageCredits}
          style={({ pressed }) => [
            styles.row,
            styles.footerRow,
            {
              backgroundColor:
                pressed || currentRoute === "UsageCredits"
                  ? colors.navActive
                  : "transparent",
            },
          ]}
        >
          <WalletCards size={19} color={colors.textSecondary} />
          <Text
            numberOfLines={1}
            style={[
              styles.rowText,
              styles.footerLabel,
              { color: colors.textPrimary },
            ]}
          >
            Usage & credits
          </Text>
          <ChevronRight size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
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
            paddingBottom: Math.max(insets.bottom, 12),
            borderColor: colors.border,
            backgroundColor:
              pressed || currentRoute === "AccountSettings"
                ? colors.navActive
                : "transparent",
          },
        ]}
      >
        <View style={[styles.avatar, { backgroundColor: colors.primaryGlow }]}>
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
  );
}

const styles = StyleSheet.create({
  footerRow: { minHeight: 62 },
  footerLabel: { flex: 1, minWidth: 0 },
  accountArea: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 6 },
  panel: { flex: 1 },
  brandRow: {
    flexShrink: 0,
    paddingLeft: 24,
    paddingRight: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
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
    paddingTop: 12,
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
  accountText: { flex: 1, gap: 2 },
  email: { fontFamily: fonts.bodyRegular, fontSize: 11 },
});
