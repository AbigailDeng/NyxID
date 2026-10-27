import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Plus,
  Users,
} from "lucide-react-native";
import type { WorkspaceChatTarget } from "../../app/workspaceChatNavigation";
import type { AssistantAgent } from "../../features/agents/agentContracts";
import type { AssistantConversation } from "../../features/assistant/assistantTypes";
import type { Group } from "../../features/groups/groupContracts";
import { chatAgentLabel } from "../../features/assistant/assistantAgentContext";
import { groupKeys } from "../../features/groups/groupLiveRefresh";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import { agentsApi } from "../../lib/api/agentsApi";
import { assistantApi } from "../../lib/api/assistantApi";
import { groupsApi } from "../../lib/api/groupsApi";
import { getAuthEpoch } from "../../lib/auth/authEpoch";
import { useTheme } from "../../theme/ThemeContext";
import { fonts } from "../../theme/designTokens";
import { WorkspaceChatBrowser } from "./WorkspaceChatBrowser";
import {
  boundedDrawerPreview,
  DRAWER_PREVIEW_LIMIT,
  drawerAgentConversations,
  orderedDrawerAgents,
} from "./workspaceChatListModel";

type Props = {
  visible: boolean;
  current?: WorkspaceChatTarget;
  onSelect: (target: WorkspaceChatTarget) => void;
  onCreateAgent: () => void;
  onCreateGroup: () => void;
};
type BrowseRow =
  | { id: string; agent: AssistantAgent }
  | { id: string; group: Group }
  | { id: string; chat: AssistantConversation };
type Browser =
  | { kind: "agents" | "groups" }
  | { kind: "chats"; fromAgents: boolean };

export function WorkspaceChatList({
  visible,
  current,
  onSelect,
  onCreateAgent,
  onCreateGroup,
}: Props) {
  const { colors } = useTheme();
  const epoch = getAuthEpoch();
  const { isConnected } = useNetworkStatus();
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [sections, setSections] = useState({
    agents: current?.kind !== "group",
    groups: current?.kind === "group",
  });
  // A single disclosure bounds the height even when the account has many agents.
  const [expandedAgent, setExpandedAgent] = useState<string | null>();
  const [browser, setBrowser] = useState<Browser | null>(null);
  const [browserClosing, setBrowserClosing] = useState(0);
  const browserDismissalSequence = useRef(0);
  const browserClosingRef = useRef(false);
  const pendingBrowserSelection = useRef<(() => void) | undefined>(undefined);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const active = visible && foreground && isConnected;
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!visible) {
      pendingBrowserSelection.current = undefined;
      browserClosingRef.current = false;
      setBrowser(null);
      setBrowserClosing(0);
    }
  }, [visible]);
  const agents = useQuery({
    queryKey: ["workspace", "agents", "drawer", epoch],
    queryFn: ({ signal }) => agentsApi.list(signal),
    enabled: active,
    retry: false,
  });
  const groups = useQuery({
    queryKey: [...groupKeys(epoch), "list"],
    queryFn: ({ signal }) => groupsApi.list(signal),
    enabled: active,
    retry: false,
  });
  const allAgents = orderedDrawerAgents(agents.data?.agents ?? []);
  const allGroups = [...(groups.data ?? [])].sort((a, b) =>
    (b.last_message_at || b.created_at).localeCompare(
      a.last_message_at || a.created_at,
    ),
  );
  const currentAgentId =
    current?.kind === "agent" ? current.agentId : undefined;
  const openId = expandedAgent !== undefined ? expandedAgent : currentAgentId;
  const agent = allAgents.find((row) => row.id === openId);
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const canStartChat =
    !!agent && agent.status !== "destroyed" && agent.can_use !== false;
  const history = useInfiniteQuery({
    queryKey: ["workspace", "drawer-chats", epoch, agent?.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      assistantApi.list(pageParam, agent!.id, signal),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled:
      active &&
      !!agent &&
      agent.can_use !== false &&
      (sections.agents || browser?.kind === "chats"),
    retry: false,
  });
  const chats =
    agent && agent.can_use !== false
      ? drawerAgentConversations(history.data?.pages ?? [], agent)
      : [];
  const selectedChatId =
    current?.kind === "agent" &&
    (current.agentId === agent?.id ||
      (!current.agentId &&
        chats.some((row) => row.id === current.conversationId)))
      ? current.conversationId
      : undefined;
  const missingCurrent =
    !!selectedChatId && !chats.some((row) => row.id === selectedChatId);
  const previewChats = boundedDrawerPreview(
    chats,
    selectedChatId,
    DRAWER_PREVIEW_LIMIT - (missingCurrent ? 1 : 0),
  );
  const dismissBrowser = (selection?: () => void) => {
    if (browserClosingRef.current) return;
    pendingBrowserSelection.current = selection;
    browserClosingRef.current = true;
    setBrowserClosing(++browserDismissalSequence.current);
  };
  const finishBrowserDismissal = (dismissalId: number) => {
    if (
      !browserClosingRef.current ||
      dismissalId !== browserDismissalSequence.current
    )
      return;
    browserClosingRef.current = false;
    const select = pendingBrowserSelection.current;
    pendingBrowserSelection.current = undefined;
    setBrowser(null);
    setBrowserClosing(0);
    select?.();
  };
  const selectAfterBrowser = (select: () => void) => {
    if (browserClosingRef.current) return;
    if (browser) dismissBrowser(select);
    else select();
  };
  const openChat = (conversationId?: string) => {
    const selectedAgentId = agent?.id;
    const allowed = () => {
      const latest = agentRef.current;
      return (
        latest &&
        latest.id === selectedAgentId &&
        latest.can_use !== false &&
        (!!conversationId || latest.status !== "destroyed")
      );
    };
    if (!allowed()) return;
    selectAfterBrowser(() => {
      // Permissions may change while the native browser animates out.
      if (allowed())
        onSelectRef.current({
          kind: "agent",
          agentId: selectedAgentId,
          conversationId,
        });
    });
  };
  const openGroup = (group: Group) => {
    selectAfterBrowser(() =>
      onSelectRef.current({ kind: "group", groupId: group.id }),
    );
  };
  const agentDetail = (row: AssistantAgent) =>
    row.status === "destroyed"
      ? "Past agent · chat history"
      : row.can_use === false
        ? "View only"
        : row.owner_kind === "org"
          ? row.owner_name || "Shared agent"
          : row.kind === "nyxbot"
            ? "Your personal agent"
            : undefined;
  const chatRow = (row: AssistantConversation) => (
    <ChatRow
      key={row.id}
      label={row.title.trim() || "Untitled chat"}
      detail={
        row.active_turn
          ? "Working…"
          : row.pending_acknowledgements
            ? "Needs approval"
            : row.channel?.platform
      }
      selected={selectedChatId === row.id}
      onPress={() => openChat(row.id)}
      accessibilityLabel={`Open chat ${row.title.trim() || "Untitled chat"} with ${agent ? chatAgentLabel(agent) : "agent"}`}
    />
  );
  const groupRow = (row: Group) => (
    <GroupChatRow
      key={row.id}
      group={row}
      selected={current?.kind === "group" && current.groupId === row.id}
      onPress={() => openGroup(row)}
    />
  );
  const historyStatus = (
    <>
      {agent?.can_use === false ? (
        <DrawerMessage text="View only · chat access isn’t available for this agent." />
      ) : (
        <>
          {history.isPending ? (
            <DrawerMessage text="Loading chats…" loading={active} />
          ) : null}
          {history.isError ? (
            <DrawerMessage
              text={
                history.data
                  ? "Couldn’t refresh chats."
                  : "Couldn’t load chats."
              }
              retry={() => void history.refetch()}
              disabled={!active}
            />
          ) : null}
        </>
      )}
    </>
  );
  const startChat =
    canStartChat && agent ? (
      <ChatRow
        label="New chat"
        selected={
          current?.kind === "agent" &&
          current.agentId === agent.id &&
          !current.conversationId
        }
        onPress={() => openChat()}
        accessibilityLabel={`Start a chat with ${chatAgentLabel(agent)}`}
      />
    ) : null;
  const currentRow = missingCurrent ? (
    <ChatRow
      label="Current chat"
      selected
      onPress={() => openChat(selectedChatId)}
    />
  ) : null;
  return (
    <View style={styles.sections}>
      <SectionHeading
        label="Agent chats"
        count={allAgents.length}
        expanded={sections.agents}
        createLabel="New agent"
        onCreate={onCreateAgent}
        createDisabled={!active}
        onPress={() =>
          setSections((value) => ({ ...value, agents: !value.agents }))
        }
      />
      {sections.agents ? (
        <>
          {current?.kind === "agent" &&
          current.conversationId &&
          !current.agentId &&
          !chats.some((row) => row.id === current.conversationId) ? (
            <ChatRow
              label="Current chat"
              selected
              onPress={() => onSelect(current)}
            />
          ) : null}
          {!isConnected ? (
            <DrawerMessage text="Offline · showing saved chats" />
          ) : null}
          {agents.isPending ? (
            <DrawerMessage text="Loading agents…" loading={active} />
          ) : null}
          {agents.isError ? (
            <DrawerMessage
              text="Couldn’t load agents."
              retry={() => void agents.refetch()}
              disabled={!active}
            />
          ) : null}
          {agents.isSuccess && !allAgents.length ? (
            <DrawerMessage text="No agents yet." />
          ) : null}
          {boundedDrawerPreview(allAgents, openId || currentAgentId).map(
            (row) => (
              <View key={row.id}>
                <DisclosureRow
                  label={chatAgentLabel(row)}
                  detail={agentDetail(row)}
                  expanded={openId === row.id}
                  selected={
                    current?.kind === "agent" &&
                    (current.agentId === row.id ||
                      (!current.agentId &&
                        !current.conversationId &&
                        row.kind === "nyxbot"))
                  }
                  onPress={() =>
                    setExpandedAgent(openId === row.id ? null : row.id)
                  }
                  kind="agent"
                />
                {openId === row.id ? (
                  <View
                    style={[styles.children, { borderColor: colors.border }]}
                  >
                    {startChat}
                    {historyStatus}
                    {currentRow}
                    {previewChats.map(chatRow)}
                    {history.isSuccess &&
                    !chats.length &&
                    row.can_use !== false ? (
                      <DrawerMessage
                        text={
                          row.status === "destroyed"
                            ? "No saved chats for this deleted agent."
                            : "No chats yet."
                        }
                      />
                    ) : null}
                    {row.can_use !== false &&
                    (chats.length > previewChats.length ||
                      history.hasNextPage) ? (
                      <MoreButton
                        label="View all chats"
                        onPress={() =>
                          setBrowser({ kind: "chats", fromAgents: false })
                        }
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            ),
          )}
          {allAgents.length > DRAWER_PREVIEW_LIMIT ? (
            <MoreButton
              label={`View all agents (${allAgents.length})`}
              onPress={() => setBrowser({ kind: "agents" })}
            />
          ) : null}
        </>
      ) : null}
      <SectionHeading
        label="Crews"
        count={allGroups.length}
        expanded={sections.groups}
        createLabel="New crew"
        onCreate={onCreateGroup}
        createDisabled={!active}
        onPress={() =>
          setSections((value) => ({ ...value, groups: !value.groups }))
        }
      />
      {sections.groups ? (
        <>
          {groups.isPending ? (
            <DrawerMessage text="Loading crews..." loading={active} />
          ) : null}
          {groups.isError ? (
            <DrawerMessage
              text="Couldn’t load crews."
              retry={() => void groups.refetch()}
              disabled={!active}
            />
          ) : null}
          {groups.isSuccess && !allGroups.length ? (
            <DrawerMessage text="No crews yet." />
          ) : null}
          {boundedDrawerPreview(
            allGroups,
            current?.kind === "group" ? current.groupId : undefined,
          ).map(groupRow)}
          {allGroups.length > DRAWER_PREVIEW_LIMIT ? (
            <MoreButton
              label={`View all crews (${allGroups.length})`}
              onPress={() => setBrowser({ kind: "groups" })}
            />
          ) : null}
        </>
      ) : null}
      {browser ? (
        <WorkspaceChatBrowser<BrowseRow>
          title={
            browser.kind === "agents"
              ? "All agents"
              : browser.kind === "groups"
                ? "All crews"
                : agent
                  ? chatAgentLabel(agent)
                  : "Agent chats"
          }
          scopeKey={
            browser.kind === "chats" ? `chats:${agent?.id}` : browser.kind
          }
          description={
            browser.kind === "agents"
              ? "Choose an agent to browse its chats."
              : browser.kind === "groups"
                ? "Each crew has one shared conversation."
                : !agent
                  ? "This agent is no longer available. Choose another agent to start a chat."
                  : agent.can_use === false
                    ? "You don’t have permission to chat with this agent. Choose another agent to continue."
                    : agent.status === "destroyed"
                      ? "This agent was deleted. You can still view its saved chats, or choose another agent to start a new chat."
                      : history.hasNextPage
                        ? "Search loaded chats. Load older chats to search more history."
                        : "Start a new chat or return to a saved conversation."
          }
          items={
            browser.kind === "agents"
              ? allAgents.map((row) => ({ id: row.id, agent: row }))
              : browser.kind === "groups"
                ? allGroups.map((row) => ({ id: row.id, group: row }))
                : chats.map((row) => ({ id: row.id, chat: row }))
          }
          searchText={(row) =>
            "agent" in row
              ? `${chatAgentLabel(row.agent)} ${row.agent.name} ${row.agent.owner_name ?? ""}`
              : "group" in row
                ? `${row.group.name} ${row.group.owner?.name ?? ""}`
                : row.chat.title
          }
          renderItem={(row) =>
            "agent" in row ? (
              <DisclosureRow
                label={chatAgentLabel(row.agent)}
                detail={agentDetail(row.agent)}
                expanded={false}
                selected={currentAgentId === row.id}
                onPress={() => {
                  setExpandedAgent(row.id);
                  setBrowser({ kind: "chats", fromAgents: true });
                }}
                kind="agent"
              />
            ) : "group" in row ? (
              groupRow(row.group)
            ) : (
              chatRow(row.chat)
            )
          }
          visible={!browserClosing}
          onClose={() => dismissBrowser()}
          onDismiss={() => finishBrowserDismissal(browserClosing)}
          primaryAction={
            browser.kind === "chats"
              ? canStartChat && agent
                ? {
                    label: "New chat",
                    accessibilityLabel: `Start a chat with ${chatAgentLabel(agent)}`,
                    onPress: () => openChat(),
                  }
                : {
                    label: "Choose another agent",
                    accessibilityLabel: "Choose another agent",
                    onPress: () => setBrowser({ kind: "agents" }),
                  }
              : undefined
          }
          onBack={
            browser.kind === "chats" && browser.fromAgents
              ? () => setBrowser({ kind: "agents" })
              : undefined
          }
          emptyText={
            browser.kind === "agents"
              ? "No agents available."
              : browser.kind === "groups"
                ? "No crews yet."
                : !agent
                  ? "This agent is no longer available."
                  : agent.can_use === false
                    ? "Chat access isn’t available for this agent."
                    : history.isPending
                      ? "Loading chats…"
                      : history.isError && !history.data
                        ? "Couldn’t load chats. You can retry below."
                        : agent.status === "destroyed"
                          ? "No saved chats for this deleted agent."
                          : "No chats yet. Start your first conversation above."
          }
          footer={
            browser.kind === "chats" ? (
              <>
                {historyStatus}
                {currentRow}
                {history.hasNextPage ? (
                  <MoreButton
                    label={
                      history.isFetchingNextPage
                        ? "Loading older chats…"
                        : history.isFetchNextPageError
                          ? "Retry older chats"
                          : "Load older chats"
                    }
                    disabled={!active || history.isFetchingNextPage}
                    onPress={() => void history.fetchNextPage()}
                  />
                ) : null}
              </>
            ) : undefined
          }
        />
      ) : null}
    </View>
  );
}

function SectionHeading({
  label,
  count,
  expanded,
  onPress,
  createLabel,
  onCreate,
  createDisabled,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onPress: () => void;
  createLabel: string;
  onCreate: () => void;
  createDisabled: boolean;
}) {
  const { colors } = useTheme();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <View style={styles.sectionHeading}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${label.toLowerCase()}`}
        accessibilityState={{ expanded }}
        onPress={onPress}
        style={styles.sectionRow}
      >
        <Text style={[styles.section, { color: colors.textMuted }]}>
          {label.toUpperCase()}
        </Text>
        <Text style={[styles.sectionCount, { color: colors.textMuted }]}>
          {count}
        </Text>
        <Chevron size={16} color={colors.textMuted} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={createLabel}
        accessibilityState={{ disabled: createDisabled }}
        disabled={createDisabled}
        onPress={onCreate}
        style={[styles.createButton, { opacity: createDisabled ? 0.4 : 1 }]}
      >
        <Plus size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}
function MoreButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.more}
    >
      <Text
        style={[
          styles.moreText,
          { color: colors.primaryOnTint, opacity: disabled ? 0.5 : 1 },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
function GroupChatRow({
  group,
  selected,
  onPress,
}: {
  group: Group;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open crew ${group.name}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor:
            pressed || selected ? colors.navActive : "transparent",
        },
      ]}
    >
      <Users
        size={18}
        color={selected ? colors.primary : colors.textSecondary}
      />
      <View style={styles.label}>
        <Text
          numberOfLines={1}
          style={[styles.name, { color: colors.textPrimary }]}
        >
          {group.name}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.detail, { color: colors.textMuted }]}
        >
          {group.working_agent_ids.length
            ? "Agents working…"
            : `${group.message_count} messages`}{" "}
          · {group.members.length} agents
          {group.owner?.type === "org" ? ` · ${group.owner.name}` : ""}
        </Text>
      </View>
      <ChevronRight size={16} color={colors.textMuted} />
    </Pressable>
  );
}

function DisclosureRow({
  label,
  detail,
  expanded,
  selected,
  onPress,
  kind,
}: {
  label: string;
  detail?: string;
  expanded: boolean;
  selected: boolean;
  onPress: () => void;
  kind: "agent" | "group";
}) {
  const { colors } = useTheme();
  const Icon = kind === "agent" ? Bot : Users;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${expanded ? "Collapse" : "Expand"} chats for ${label}`}
      accessibilityState={{ expanded, selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor:
            pressed || selected ? colors.navActive : "transparent",
        },
      ]}
    >
      <Icon
        size={18}
        color={selected ? colors.primary : colors.textSecondary}
      />
      <View style={styles.label}>
        <Text
          numberOfLines={1}
          style={[styles.name, { color: colors.textPrimary }]}
        >
          {label}
        </Text>
        {detail ? (
          <Text
            numberOfLines={1}
            style={[styles.detail, { color: colors.textMuted }]}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      <Chevron size={16} color={colors.textMuted} />
    </Pressable>
  );
}

function ChatRow({
  label,
  detail,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || `Open ${label.toLowerCase()}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chat,
        {
          backgroundColor:
            pressed || selected ? colors.navActive : "transparent",
        },
      ]}
    >
      <MessageSquare
        size={14}
        color={selected ? colors.primary : colors.textMuted}
      />
      <View style={styles.label}>
        <Text
          numberOfLines={2}
          style={[
            styles.chatTitle,
            { color: selected ? colors.primaryOnTint : colors.textSecondary },
          ]}
        >
          {label}
        </Text>
        {detail ? (
          <Text
            numberOfLines={1}
            style={[styles.detail, { color: colors.textMuted }]}
          >
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function DrawerMessage({
  text,
  loading,
  retry,
  disabled,
}: {
  text: string;
  loading?: boolean;
  retry?: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.message}>
      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : null}
      <Text style={[styles.messageText, { color: colors.textMuted }]}>
        {text}
      </Text>
      {retry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Retry: ${text}`}
          disabled={disabled}
          onPress={retry}
          style={styles.retry}
        >
          <Text style={[styles.moreText, { color: colors.primaryOnTint }]}>
            Retry
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeading: { flexDirection: "row", alignItems: "center" },
  createButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  sections: { gap: 4, marginTop: 12 },
  sectionRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingRight: 10,
    gap: 8,
  },
  sectionCount: { fontFamily: fonts.bodyRegular, fontSize: 11 },
  section: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.5,
    padding: 10,
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  label: { flex: 1, gap: 3, minWidth: 0 },
  name: { fontFamily: fonts.bodySemi, fontSize: 13 },
  detail: { fontFamily: fonts.bodyRegular, fontSize: 10, lineHeight: 15 },
  children: {
    marginLeft: 21,
    paddingLeft: 8,
    borderLeftWidth: 1,
    marginBottom: 4,
  },
  chat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: 8,
  },
  chatTitle: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18 },
  message: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  messageText: {
    flex: 1,
    fontFamily: fonts.bodyRegular,
    fontSize: 11,
    lineHeight: 17,
  },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  more: { minHeight: 44, justifyContent: "center", paddingHorizontal: 10 },
  moreText: { fontFamily: fonts.bodySemi, fontSize: 11 },
});
