import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import * as WebBrowser from "expo-web-browser";
import Markdown, { type RenderRules } from "react-native-markdown-display";
import {
  History,
  Bot,
  ChevronDown,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Send,
  Square,
  X,
} from "lucide-react-native";
import type { RootStackParamList } from "../../app/AppNavigator";
import { useWorkspaceBack } from "../../app/WorkspaceHeader";
import {
  WorkspacePage,
  ActionButton,
  Card,
  Field,
  Label,
  Notice,
} from "../../components/workspace/WorkspaceUI";
import { useTheme } from "../../theme/ThemeContext";
import { fonts, radius } from "../../theme/designTokens";
import { useAssistant } from "./useAssistant";
import { chatAgentLabel } from "./assistantAgentContext";
import { liveReplyText } from "./assistantStream";
import {
  ASSISTANT_SEND_PRESS_GRACE_MS,
  createAssistantComposerPressGuard,
} from "./assistantComposerPress";
import { submitAssistantDraft } from "./assistantComposerDraft";
import { transcriptEndOffset } from "./assistantTranscriptScroll";
import {
  acknowledgementTitle,
  retryInput,
  storedAssistantError,
} from "./assistantState";
import type {
  AssistantAcknowledgement,
  AssistantMessage,
} from "./assistantTypes";

type AssistantScreenProps = {
  route?: {
    params?: {
      conversationId?: string;
      agentId?: string;
      draft?: boolean;
      openLatest?: boolean;
    };
  };
};

export function AssistantScreen({ route }: AssistantScreenProps) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const adoptedId = useRef<string | undefined>(undefined);
  const assistant = useAssistant(
    route?.params?.conversationId,
    route?.params?.agentId,
    (id) => {
      if (route?.params?.conversationId === id) return;
      adoptedId.current = id;
      navigation.setParams({ conversationId: id, openLatest: false });
    },
  );
  const [draft, setDraft] = useState("");
  const draftRevision = useRef(0);
  function updateDraft(value: string) {
    draftRevision.current += 1;
    setDraft(value);
  }
  const [historyOpen, setHistoryOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [localError, setLocalError] = useState<string>();
  const composerPress = useRef(createAssistantComposerPressGuard());
  const [stopProtected, setStopProtected] = useState(false);
  const transcript = useRef<FlatList<AssistantMessage>>(null);
  const following = useRef(true);
  const transcriptMetrics = useRef({ height: 0, viewportHeight: 0 });
  const conversation = assistant.history?.conversation;
  const currentAgent = assistant.agent ?? conversation?.agent;
  const agentName = currentAgent
    ? chatAgentLabel(currentAgent)
    : assistant.agentId
      ? "Agent"
      : "NyxBot";
  const running = assistant.sending || !!conversation?.active_turn;
  const destroyed = conversation?.agent?.destroyed;
  const streamPersisted =
    assistant.live?.turnId &&
    assistant.history?.messages.some(
      (message) =>
        message.turn_id === assistant.live?.turnId &&
        message.role === "assistant",
    );
  const optimisticUserPersisted =
    assistant.live?.turnId &&
    assistant.history?.messages.some(
      (message) =>
        message.turn_id === assistant.live?.turnId && message.role === "user",
    );
  const messages = assistant.history?.messages ?? [];
  const stableTranscript =
    messages.length > 0 && !running && !assistant.inputText;
  const hasHistoryGap = messages.some(
    (item, index) =>
      index > 0 && item.seq > (messages[index - 1]?.seq ?? item.seq) + 1,
  );
  const canSend =
    !!draft.trim() &&
    [...draft].length <= 32768 &&
    !running &&
    !destroyed &&
    assistant.online &&
    !assistant.loading &&
    !assistant.loadingOlder &&
    !assistant.recoveryRequired &&
    !route?.params?.openLatest &&
    assistant.agent?.can_use !== false &&
    (!!assistant.conversationId ||
      (assistant.agent?.can_use === true &&
        assistant.agent.status !== "destroyed"));

  useEffect(() => {
    if (
      !route?.params?.openLatest ||
      route.params.conversationId ||
      !route.params.agentId ||
      assistant.indexedAgentId !== route.params.agentId
    )
      return;
    const id = assistant.conversations[0]?.id;
    navigation.setParams({ conversationId: id, openLatest: false });
    if (id) assistant.openConversation(id);
  }, [
    route?.params?.openLatest,
    route?.params?.conversationId,
    route?.params?.agentId,
    assistant.indexedAgentId,
    assistant.conversations,
    assistant.openConversation,
    navigation,
  ]);

  useLayoutEffect(() => {
    following.current = true;
    transcriptMetrics.current = { height: 0, viewportHeight: 0 };
    setLocalError(undefined);
  }, [assistant.conversationId]);
  useEffect(() => {
    // Persisting the first turn's identity is not a user switching chats.
    if (
      adoptedId.current &&
      route?.params?.conversationId === adoptedId.current
    ) {
      adoptedId.current = undefined;
      return;
    }
    draftRevision.current += 1;
    setDraft("");
  }, [route?.params?.agentId, route?.params?.conversationId]);
  useEffect(() => {
    if (!stopProtected) return;
    const timeout = setTimeout(
      () => setStopProtected(false),
      ASSISTANT_SEND_PRESS_GRACE_MS,
    );
    return () => clearTimeout(timeout);
  }, [stopProtected]);

  async function perform(operation: () => Promise<unknown>) {
    setLocalError(undefined);
    try {
      await operation();
    } catch (cause) {
      setLocalError(
        cause instanceof Error
          ? cause.message
          : "Could not complete this action.",
      );
    }
  }

  function newChat() {
    const agentId = assistant.agentId;
    assistant.openConversation();
    assistant.setModel(assistant.agent?.model ?? "nyxagent/chat");
    navigation.setParams({
      conversationId: undefined,
      agentId,
      draft: true,
      openLatest: false,
    });
    updateDraft("");
    setHistoryOpen(false);
  }

  useWorkspaceBack({
    active:
      !navigation.canGoBack() &&
      Boolean(assistant.conversationId || currentAgent?.kind === "specialist"),
    disabled:
      assistant.loading || (assistant.sending && !assistant.conversationId),
    label: assistant.conversationId ? `Back to ${agentName}` : "Back to NyxBot",
    onBack: () => {
      if (assistant.conversationId) newChat();
      else {
        assistant.openConversation();
        navigation.setParams({
          conversationId: undefined,
          agentId: undefined,
          draft: false,
          openLatest: false,
        });
        updateDraft("");
      }
    },
  });

  async function sendDraft() {
    if (!canSend || !composerPress.current("send")) return;
    setStopProtected(true);
    following.current = true;
    await perform(() =>
      submitAssistantDraft({
        draft,
        updateDraft,
        getRevision: () => draftRevision.current,
        send: assistant.send,
      }),
    );
  }

  const markdownStyle = {
    body: {
      color: colors.textPrimary,
      fontFamily: fonts.bodyRegular,
      fontSize: 14,
      lineHeight: 23,
    },
    paragraph: { marginTop: 0, marginBottom: 10 },
    heading1: {
      fontFamily: fonts.displaySemi,
      fontSize: 22,
      lineHeight: 29,
      color: colors.textPrimary,
    },
    heading2: {
      fontFamily: fonts.displaySemi,
      fontSize: 18,
      lineHeight: 25,
      color: colors.textPrimary,
    },
    link: { color: colors.primaryOnTint },
    code_inline: {
      fontFamily: fonts.mono,
      backgroundColor: colors.cardSoft,
      color: colors.textPrimary,
    },
    fence: {
      fontFamily: fonts.mono,
      fontSize: 12,
      backgroundColor: colors.cardSoft,
      color: colors.textPrimary,
      borderColor: colors.border,
      borderRadius: radius.md,
    },
    blockquote: {
      backgroundColor: colors.cardSoft,
      borderColor: colors.primary,
      color: colors.textSecondary,
    },
    table: { borderColor: colors.border },
    tr: { borderColor: colors.border },
  };
  const markdownRules: RenderRules = {
    // Match Web: model-provided remote images require an explicit link tap.
    image: (node) => (
      <Text
        key={node.key}
        style={{ color: colors.primaryOnTint }}
        onPress={() => {
          if (typeof node.attributes.src === "string")
            openSafeLink(node.attributes.src);
        }}
      >
        {typeof node.attributes.alt === "string" && node.attributes.alt.trim()
          ? node.attributes.alt
          : "Image"}
      </Text>
    ),
  };

  function renderMessage({
    item,
    index,
  }: {
    item: AssistantMessage;
    index: number;
  }) {
    const isUser = item.role === "user";
    const input = retryInput(assistant.history, item);
    return (
      <View
        style={[
          styles.message,
          isUser && styles.userMessage,
          isUser && {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        {index > 0 && item.seq > (messages[index - 1]?.seq ?? item.seq) + 1 ? (
          <Notice message="Messages between these pages haven't loaded yet. Load missing messages to restore them." />
        ) : null}
        <Label muted style={styles.messageLabel}>
          {isUser
            ? "You"
            : item.role === "assistant"
              ? (conversation?.agent?.display_name ??
                conversation?.agent?.name ??
                "NyxBot")
              : item.role === "orchestrator"
                ? "NyxBot · instruction"
                : "Update"}
          {item.via ? ` · ${item.via}` : ""}
          {item.steering ? " · guidance" : ""}
        </Label>
        {isUser ? (
          <Text
            selectable
            style={[styles.messageText, { color: colors.textPrimary }]}
          >
            {item.text}
          </Text>
        ) : (
          <Markdown
            style={markdownStyle}
            rules={markdownRules}
            onLinkPress={openSafeLink}
          >
            {item.text || (item.status === "failed" ? "" : "No text response.")}
          </Markdown>
        )}
        {item.activities.map((activity) => (
          <Label muted key={activity.id} style={styles.metadata}>
            {activity.status === "running"
              ? "◌"
              : activity.status === "completed"
                ? "✓"
                : "!"}{" "}
            {activity.label}
          </Label>
        ))}
        {item.attachments.map((attachment) => (
          <Label muted key={attachment.id} style={styles.metadata}>
            {attachment.label} ·{" "}
            {attachment.expired ? "Expired" : formatSize(attachment.size)}
            {attachment.image_input === "unavailable"
              ? " · Image input unavailable"
              : ""}
          </Label>
        ))}
        {item.status === "failed" ? (
          <Notice
            message={storedAssistantError(item.error_code)}
            tone={item.error_code === "cancelled" ? "info" : "error"}
          />
        ) : null}
        {input !== undefined ? (
          <ActionButton
            label="Retry unfinished work"
            variant="secondary"
            disabled={
              running ||
              !assistant.online ||
              assistant.recoveryRequired ||
              assistant.loadingOlder
            }
            onPress={() =>
              void perform(() => assistant.send(input, item.turn_id))
            }
          />
        ) : null}
        <Label muted mono style={styles.timestamp}>
          {formatDate(item.created_at)}
        </Label>
      </View>
    );
  }

  function renderAcknowledgement(row: AssistantAcknowledgement) {
    const pending = row.status === "pending";
    const expired = Date.parse(row.expires_at) <= Date.now();
    return (
      <Card key={row.id}>
        <Label style={styles.cardTitle}>{acknowledgementTitle(row)}</Label>
        <Label>{row.summary}</Label>
        {row.service_name || row.service_slug ? (
          <Label muted>
            Service: {row.service_name ?? row.service_slug}
            {row.service_name && row.service_slug
              ? ` (${row.service_slug})`
              : ""}
          </Label>
        ) : null}
        {row.tool_name ? (
          <Label muted mono>
            Tool: {row.tool_name}
          </Label>
        ) : null}
        <Label muted>
          {row.confirmation ? `${row.confirmation.risk} · ` : ""}
          {pending
            ? row.decider === "orchestrator"
              ? "Requested from NyxBot"
              : "Your confirmation is required"
            : row.status}
          {row.decided_by
            ? ` · ${row.decided_by === "user" ? "you" : "NyxBot"}`
            : ""}
        </Label>
        {row.reason ? <Label muted>{row.reason}</Label> : null}
        {row.confirmation ? (
          <Label muted>
            {row.confirmation.reason === "webhook"
              ? "A webhook requested this action."
              : row.confirmation.reason === "policy"
                ? "The resource's confirmation policy requires your approval."
                : `${row.confirmation.access_mode === "ask_every_time" ? "Ask Every Time" : row.confirmation.access_mode === "nyxmode" ? "NyxMode" : row.confirmation.access_mode === "autopilot" ? "Autopilot" : "Your access mode"} requires this confirmation.`}
          </Label>
        ) : null}
        {row.authored_skill && pending ? (
          <Notice message="Review this skill's draft and validation in NyxID Web before confirming publication." />
        ) : pending ? (
          <>
            <Label muted>
              {row.kind === "action"
                ? "This applies once, to this action only."
                : row.kind === "operations"
                  ? "This updates the specialist's operations across its threads."
                  : row.kind === "skills"
                    ? "NyxBot will resolve the exact version and ask separately before attaching it."
                    : "This grants the requested permission."}
            </Label>
            <Label muted mono>
              Expires {formatDate(row.expires_at)}
            </Label>
            <View style={styles.row}>
              <View style={styles.fill}>
                <ActionButton
                  label="Deny"
                  variant="secondary"
                  disabled={
                    !!assistant.deciding ||
                    expired ||
                    !assistant.online ||
                    assistant.loadingOlder
                  }
                  onPress={() =>
                    void perform(() => assistant.decide(row.id, "deny"))
                  }
                />
              </View>
              <View style={styles.fill}>
                <ActionButton
                  label="Allow"
                  loading={assistant.deciding === row.id}
                  disabled={
                    !!assistant.deciding ||
                    expired ||
                    !assistant.online ||
                    assistant.loadingOlder
                  }
                  onPress={() =>
                    void perform(() => assistant.decide(row.id, "allow"))
                  }
                />
              </View>
            </View>
          </>
        ) : null}
      </Card>
    );
  }

  return (
    <WorkspacePage
      title={conversation?.title ?? "Assistant"}
      titleNumberOfLines={1}
      scroll={false}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Chatting with ${agentName}. Choose agent`}
        onPress={() => setAgentsOpen(true)}
        style={styles.agentSelector}
      >
        <Bot size={20} color={colors.primaryOnTint} />
        <View style={styles.fill}>
          <Label>{agentName}</Label>
          <Label muted>
            {assistant.agent?.owner_kind === "org"
              ? (assistant.agent.owner_name ?? "Organization")
              : currentAgent?.kind === "specialist"
                ? "Personal specialist"
                : "Your personal assistant"}
          </Label>
        </View>
        <ChevronDown size={18} color={colors.textMuted} />
      </Pressable>
      <View style={styles.toolbar}>
        <View style={styles.row}>
          <IconButton label="Chat history" onPress={() => setHistoryOpen(true)}>
            <History size={19} color={colors.textSecondary} />
          </IconButton>
          <IconButton
            label="New chat"
            onPress={newChat}
            disabled={
              assistant.loading ||
              !assistant.agentId ||
              (assistant.sending && !assistant.conversationId)
            }
          >
            <Plus size={21} color={colors.textSecondary} />
          </IconButton>
          {assistant.conversationId ? (
            <IconButton
              label="Chat settings"
              onPress={() => {
                setTitle(conversation?.title ?? "");
                setSettingsOpen(true);
              }}
            >
              <MoreHorizontal size={21} color={colors.textSecondary} />
            </IconButton>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            assistant.conversationId
              ? "Current assistant model"
              : "Choose assistant model"
          }
          disabled={!!assistant.conversationId || assistant.sending}
          onPress={() => setModelOpen(true)}
          style={styles.modelPill}
        >
          <Label muted style={styles.modelLabel}>
            {conversation?.model ??
              assistant.models.find((item) => item.id === assistant.model)
                ?.label ??
              assistant.model}
          </Label>
        </Pressable>
      </View>
      {!assistant.online ? (
        <Notice message="You're offline. Reconnect to refresh this chat and send messages." />
      ) : null}
      {assistant.agentsError ? (
        <View style={styles.errorRow}>
          <Notice message={assistant.agentsError} tone="error" />
          <ActionButton
            label="Reload agents"
            variant="secondary"
            onPress={() => void assistant.reloadAgents()}
          />
        </View>
      ) : null}
      {assistant.error || localError ? (
        <View style={styles.errorRow}>
          <Notice message={localError ?? assistant.error ?? ""} tone="error" />
          <ActionButton
            label="Refresh history"
            variant="secondary"
            onPress={() => void assistant.recover()}
          />
        </View>
      ) : null}
      {destroyed ? (
        <Notice message="This agent was destroyed. This chat is read-only." />
      ) : null}
      {route?.params?.openLatest ? (
        <Notice message={`Opening ${agentName}'s latest chat…`} />
      ) : null}
      <FlatList
        key={assistant.conversationId ?? "new-chat"}
        ref={transcript}
        style={styles.fill}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        ItemSeparatorComponent={TranscriptSeparator}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.transcript}
        // Anchor persisted rows when paging history. A live reply footer
        // disappears into saved rows, so disable anchoring while it changes.
        maintainVisibleContentPosition={
          stableTranscript ? { minIndexForVisible: 0 } : undefined
        }
        onLayout={(event) => {
          const metrics = transcriptMetrics.current;
          metrics.viewportHeight = event.nativeEvent.layout.height;
          if (following.current)
            transcript.current?.scrollToOffset({
              offset: transcriptEndOffset(
                metrics.height,
                metrics.viewportHeight,
              ),
              animated: false,
            });
        }}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } =
            event.nativeEvent;
          following.current =
            contentSize.height - layoutMeasurement.height - contentOffset.y <
            100;
        }}
        onScrollBeginDrag={() => {
          following.current = false;
        }}
        scrollEventThrottle={100}
        onContentSizeChange={(_width, height) => {
          const metrics = transcriptMetrics.current;
          metrics.height = height;
          if (following.current) {
            transcript.current?.scrollToOffset({
              offset: transcriptEndOffset(height, metrics.viewportHeight),
              animated: false,
            });
          }
        }}
        ListHeaderComponent={
          assistant.history?.before_seq ? (
            <ActionButton
              label={
                hasHistoryGap
                  ? "Load missing messages"
                  : "Load earlier messages"
              }
              variant="secondary"
              loading={assistant.loadingOlder}
              // Page a stable transcript so dynamic footer changes cannot
              // interfere with the native reading anchor.
              disabled={
                running ||
                assistant.loading ||
                !assistant.online ||
                !!assistant.deciding ||
                assistant.mutating
              }
              onPress={() => {
                following.current = false;
                void assistant.loadOlder();
              }}
            />
          ) : null
        }
        ListHeaderComponentStyle={styles.transcriptHeader}
        ListEmptyComponent={
          assistant.loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : !assistant.sending ? (
            <View style={styles.welcome}>
              <View
                style={[
                  styles.welcomeIcon,
                  { backgroundColor: colors.primaryGlow },
                ]}
              >
                <MessageSquare color={colors.primary} size={30} />
              </View>
              <Text
                style={[styles.welcomeTitle, { color: colors.textPrimary }]}
              >
                What would you like to do?
              </Text>
              <Label muted>
                {currentAgent?.kind === "specialist"
                  ? `Start a conversation with ${agentName}.`
                  : `Ask ${agentName} to help with your connected services.`}
              </Label>
              {["Show my connected services", "Check my pending approvals"].map(
                (prompt) => (
                  <Pressable
                    key={prompt}
                    accessibilityRole="button"
                    onPress={() => updateDraft(prompt)}
                    style={[
                      styles.suggestion,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.card,
                      },
                    ]}
                  >
                    <Label>{prompt}</Label>
                  </Pressable>
                ),
              )}
            </View>
          ) : null
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {assistant.inputText && !optimisticUserPersisted ? (
              <View
                style={[
                  styles.message,
                  styles.userMessage,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Label muted style={styles.messageLabel}>
                  You · sending
                </Label>
                <Text
                  selectable
                  style={[styles.messageText, { color: colors.textPrimary }]}
                >
                  {assistant.inputText}
                </Text>
              </View>
            ) : null}
            {running && !streamPersisted ? (
              <View style={styles.message}>
                <Label muted style={styles.messageLabel}>
                  {conversation?.agent?.display_name ??
                    conversation?.agent?.name ??
                    "NyxBot"}{" "}
                  ·{" "}
                  {conversation?.active_turn?.stop_requested
                    ? "Stopping"
                    : "Working"}
                </Label>
                {assistant.live && liveReplyText(assistant.live) ? (
                  <Markdown
                    style={markdownStyle}
                    rules={markdownRules}
                    onLinkPress={openSafeLink}
                  >
                    {liveReplyText(assistant.live)}
                  </Markdown>
                ) : (
                  <ActivityIndicator
                    style={styles.thinking}
                    size="small"
                    color={colors.primary}
                  />
                )}
                {assistant.live?.notice ? (
                  <Label muted>{assistant.live.notice}</Label>
                ) : null}
                {conversation?.active_turn?.activities.map((activity) => (
                  <Label muted key={activity.id}>
                    {activity.status === "running"
                      ? "◌"
                      : activity.status === "completed"
                        ? "✓"
                        : "!"}{" "}
                    {activity.label}
                  </Label>
                ))}
              </View>
            ) : null}
            {assistant.history?.waiting.map((waiting, index) => (
              <Notice
                key={`${waiting.title}:${index}`}
                message={`${waiting.title}${waiting.detail ? ` · ${waiting.detail}` : ""}`}
              />
            ))}
            {assistant.history?.acknowledgements.map(renderAcknowledgement)}
            {assistant.history?.approvals.map((approval) => (
              <Card key={approval.id}>
                <Label style={styles.cardTitle}>
                  {approval.service_name} · Approval needed
                </Label>
                <Label>{approval.summary}</Label>
                <Label muted mono>
                  Expires {formatDate(approval.expires_at)}
                </Label>
                <ActionButton
                  label="Review request"
                  variant="secondary"
                  onPress={() =>
                    navigation.navigate("ActivityDetail", {
                      challengeId: approval.id,
                    })
                  }
                />
              </Card>
            ))}
          </View>
        }
      />
      <View
        style={[
          styles.composer,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <TextInput
          accessibilityLabel="Message to assistant"
          value={draft}
          onChangeText={updateDraft}
          multiline
          editable={
            !destroyed &&
            !assistant.recoveryRequired &&
            !route?.params?.openLatest
          }
          placeholder={`Message ${agentName}…`}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          style={[styles.composerInput, { color: colors.textPrimary }]}
        />
        <View style={styles.composerActions}>
          <Label muted style={styles.composerHint}>
            {running
              ? "You can leave this chat and return later."
              : assistant.recoveryRequired
                ? "Open the saved chat before continuing."
                : "Review requests before confirming."}
          </Label>
          {running && assistant.conversationId ? (
            <IconButton
              label="Stop assistant"
              disabled={
                stopProtected ||
                assistant.mutating ||
                conversation?.active_turn?.stop_requested
              }
              onPress={() => {
                if (composerPress.current("stop")) void assistant.stop();
              }}
            >
              <Square size={18} color={colors.danger} />
            </IconButton>
          ) : (
            <IconButton
              label="Send message"
              disabled={!canSend}
              onPress={() => void sendDraft()}
            >
              <Send
                size={20}
                color={canSend ? colors.primary : colors.textTertiary}
              />
            </IconButton>
          )}
        </View>
        {[...draft].length > 32768 ? (
          <Label style={{ color: colors.danger }}>
            Keep the message under 32,768 characters.
          </Label>
        ) : null}
      </View>

      <Sheet
        visible={agentsOpen}
        title="Choose agent"
        onClose={() => setAgentsOpen(false)}
      >
        {assistant.agentsLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : null}
        {assistant.agentsError ? (
          <Notice message={assistant.agentsError} tone="error" />
        ) : null}
        {assistant.agents
          .filter(
            (agent) => agent.status !== "destroyed" && agent.can_use === true,
          )
          .map((agent) => (
            <Pressable
              key={agent.id}
              accessibilityRole="button"
              accessibilityLabel={`Chat with ${chatAgentLabel(agent)}`}
              onPress={() => {
                assistant.openConversation();
                assistant.setModel(agent.model ?? "nyxagent/chat");
                navigation.setParams({
                  agentId: agent.id,
                  conversationId: undefined,
                  draft: false,
                  openLatest: true,
                });
                updateDraft("");
                setAgentsOpen(false);
              }}
            >
              <Card>
                <Label>
                  {chatAgentLabel(agent)}
                  {assistant.agentId === agent.id ? " · Selected" : ""}
                </Label>
                <Label muted>
                  {agent.owner_kind === "org"
                    ? (agent.owner_name ?? "Organization")
                    : "Personal"}{" "}
                  · @{agent.name}
                </Label>
              </Card>
            </Pressable>
          ))}
        <ActionButton
          label="Manage agents"
          variant="secondary"
          onPress={() => {
            setAgentsOpen(false);
            navigation.navigate("Agents");
          }}
        />
      </Sheet>

      <Sheet
        visible={historyOpen}
        title={`${agentName} · Chat history`}
        onClose={() => setHistoryOpen(false)}
      >
        <ActionButton
          label="New chat"
          onPress={newChat}
          disabled={
            assistant.loading ||
            !assistant.agentId ||
            (assistant.sending && !assistant.conversationId)
          }
        />
        {!assistant.conversations.length && !assistant.loadingIndex ? (
          <Label muted>Your saved chats will appear here.</Label>
        ) : null}
        {assistant.conversations.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={() => {
              assistant.openConversation(item.id);
              navigation.setParams({
                conversationId: item.id,
                agentId: item.agent?.id ?? assistant.agentId,
                openLatest: false,
              });
              updateDraft("");
              setHistoryOpen(false);
            }}
          >
            <Card>
              <Label style={styles.cardTitle}>{item.title}</Label>
              <Label muted>
                {item.agent?.display_name ?? item.agent?.name ?? "NyxBot"}
                {item.active_turn ? " · Working" : ""}
                {item.pending_acknowledgements
                  ? ` · ${item.pending_acknowledgements} requests`
                  : ""}
              </Label>
              <Label muted mono>
                {formatDate(item.last_message_at)}
              </Label>
            </Card>
          </Pressable>
        ))}
        {assistant.loadingIndex ? (
          <ActivityIndicator color={colors.primary} />
        ) : null}
        {assistant.hasMoreConversations ? (
          <ActionButton
            label="Load more chats"
            variant="secondary"
            loading={assistant.loadingIndex}
            onPress={() => void assistant.loadMoreConversations()}
          />
        ) : null}
      </Sheet>
      <Sheet
        visible={modelOpen}
        title="Choose a model"
        onClose={() => setModelOpen(false)}
      >
        {assistant.models.length ? (
          assistant.models.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              disabled={!item.available}
              onPress={() => {
                assistant.setModel(item.id);
                setModelOpen(false);
              }}
            >
              <Card>
                <Label
                  style={{
                    color:
                      item.id === assistant.model
                        ? colors.primaryOnTint
                        : colors.textPrimary,
                  }}
                >
                  {item.label}
                  {item.id === assistant.model ? " · Selected" : ""}
                </Label>
                {item.description ? (
                  <Label muted>{item.description}</Label>
                ) : null}
                {!item.available ? <Label muted>Unavailable</Label> : null}
              </Card>
            </Pressable>
          ))
        ) : (
          <Notice message="Model choices are unavailable. The default assistant model will be used." />
        )}
      </Sheet>
      <Sheet
        visible={settingsOpen}
        title="Chat settings"
        onClose={() => setSettingsOpen(false)}
      >
        <Field
          label="Chat title"
          value={title}
          onChangeText={setTitle}
          maxLength={200}
          autoCapitalize="sentences"
        />
        <ActionButton
          label="Save title"
          loading={assistant.mutating}
          disabled={!title.trim()}
          onPress={() =>
            void perform(async () => {
              if (await assistant.rename(title)) setSettingsOpen(false);
            })
          }
        />
        <ActionButton
          label="Delete chat"
          variant="danger"
          disabled={assistant.mutating}
          onPress={() =>
            Alert.alert(
              "Delete this chat?",
              "This deletes its saved messages and permissions. Active work will be stopped.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => {
                    setSettingsOpen(false);
                    void assistant.remove().then((removed) => {
                      if (removed)
                        navigation.setParams({ conversationId: undefined });
                      if (removed) updateDraft("");
                    });
                  },
                },
              ],
            )
          }
        />
      </Sheet>
    </WorkspacePage>
  );
}

function TranscriptSeparator() {
  return <View style={styles.transcriptSeparator} />;
}

function IconButton({
  children,
  label,
  onPress,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        { opacity: disabled ? 0.4 : pressed ? 0.65 : 1 },
      ]}
    >
      {children}
    </Pressable>
  );
}

function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.sheet, { backgroundColor: colors.bg }]}>
        <View style={styles.sheetHeader}>
          <Text
            accessibilityRole="header"
            style={[styles.sheetTitle, { color: colors.textPrimary }]}
          >
            {title}
          </Text>
          <IconButton label={`Close ${title.toLowerCase()}`} onPress={onClose}>
            <X size={22} color={colors.textSecondary} />
          </IconButton>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.sheetContent}
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

function openSafeLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password) {
      void WebBrowser.openBrowserAsync(parsed.href).catch(() => undefined);
    }
  } catch {
    /* A malformed link remains plain text. */
  }
  return false;
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
function formatSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  agentSelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingVertical: 8,
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  modelPill: { flexShrink: 1, paddingVertical: 10, paddingHorizontal: 8 },
  modelLabel: { fontSize: 11 },
  transcript: { paddingVertical: 8, flexGrow: 1 },
  transcriptHeader: { marginBottom: 20 },
  transcriptSeparator: { height: 20 },
  message: { gap: 8, paddingVertical: 10 },
  userMessage: {
    padding: 14,
    borderWidth: 1,
    borderRadius: radius.lg,
    marginLeft: 26,
  },
  messageLabel: { fontSize: 11, fontFamily: fonts.bodySemi },
  messageText: { fontFamily: fonts.bodyRegular, fontSize: 14, lineHeight: 23 },
  metadata: { fontSize: 11 },
  timestamp: { fontSize: 10 },
  footer: { gap: 16, paddingTop: 20 },
  welcome: { alignItems: "center", gap: 16, paddingVertical: 36 },
  welcomeIcon: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  welcomeTitle: {
    fontFamily: fonts.displaySemi,
    fontSize: 24,
    lineHeight: 32,
    textAlign: "center",
  },
  suggestion: {
    width: "100%",
    padding: 14,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  thinking: { alignSelf: "flex-start", marginVertical: 10 },
  cardTitle: { fontFamily: fonts.bodySemi },
  composer: { borderWidth: 1, borderRadius: radius.lg, padding: 12, gap: 8 },
  composerInput: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    lineHeight: 22,
    minHeight: 44,
    maxHeight: 140,
    paddingVertical: 8,
    textAlignVertical: "top",
  },
  composerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  composerHint: { flex: 1, fontSize: 10, lineHeight: 15 },
  errorRow: { gap: 8 },
  sheet: { flex: 1, paddingTop: 20 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    gap: 16,
  },
  sheetTitle: { fontFamily: fonts.displaySemi, fontSize: 22, lineHeight: 30 },
  sheetContent: { padding: 20, paddingBottom: 40, gap: 14 },
});
