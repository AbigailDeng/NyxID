import { WorkspaceChatList } from "../../components/workspace/WorkspaceChatList";
import { AgentAvatar } from "../../components/AgentAvatar";
import { useChatColumn } from "../display/ChatLayoutContext";
import { MachineToolCard } from "../machines/MachineToolCard";
import {
  ScrollEdgeFades,
  useScrollEdges,
} from "../../components/workspace/ScrollEdgeFades";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import * as WebBrowser from "expo-web-browser";
import Markdown, {
  MarkdownIt,
  type RenderRules,
} from "react-native-markdown-display";
import {
  ChevronDown,
  Check,
  MoreHorizontal,
  SquarePen,
  X,
} from "lucide-react-native";
import type {
  AssistantParams,
  WorkspaceNavigationProp,
} from "../../app/navigationTypes";
import {
  useWorkspaceBack,
  WorkspaceHeaderVisibility,
} from "../../app/WorkspaceHeader";
import {
  openWorkspaceSheetAction,
  workspaceNavigateAction,
} from "../../app/navigationHierarchy";
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
import { NyxBotHome } from "./NyxBotHome";
import { showNyxBotHome } from "./nyxBotHomeModel";
import { chatAgentLabel } from "./assistantAgentContext";
import { liveReplyText } from "./assistantStream";
import {
  ASSISTANT_SEND_PRESS_GRACE_MS,
  createAssistantComposerPressGuard,
} from "./assistantComposerPress";
import { submitAssistantDraft } from "./assistantComposerDraft";
import { AssistantActivityDisclosure } from "./AssistantActivityDisclosure";
import { AssistantAcknowledgements } from "./AssistantAcknowledgements";
import { AssistantWorkingContext } from "./AssistantWorkingContext";
import { AssistantReplyFeedback } from "./AssistantReplyFeedback";
import { AssistantCopyButton } from "./AssistantCopyButton";
import { assistantSelectableMarkdown } from "./assistantSelectableMarkdown";
import { AssistantAttachmentView } from "./AssistantAttachmentView";
import { AssistantPendingUploads } from "./AssistantPendingUploads";
import {
  ChatComposerFrame,
  ChatComposerRow,
  ComposerAttachButton,
  ComposerSubmitButton,
} from "./ChatComposer";
import { AssistantMentionInput } from "./AssistantMentionInput";
import { useAssistantUploads } from "./useAssistantUploads";
import { appendDictation, useComposerDictation } from "./useComposerDictation";
import {
  ComposerDictationButton,
  ComposerDictationReview,
} from "./ComposerDictation";
import { AssistantCmaOperation } from "./AssistantCmaOperation";
import { AssistantAcknowledgementCard } from "./AssistantAcknowledgementCard";
import { AssistantTurnStatus } from "./AssistantTurnStatus";
import {
  AssistantMessageNotices,
  QuietButton,
} from "./AssistantMessageNotices";
import { contextResetCopy, steeringNotice } from "./assistantTurnPresentation";
import { NativeAuthoredSkillReview } from "../plugins/NativeAuthoredSkillReview";
import { parseAutomationLink } from "../automations/automationLinks";
import { NYXID_FRONTEND_URL } from "../../lib/env";
import { useTranscriptScrollFollow } from "./useTranscriptScrollFollow";
import { AssistantVoiceConversation } from "./voice/AssistantVoiceConversation";
import {
  NATIVE_VOICE_ENTRY_ENABLED,
  showVoiceComposer,
} from "./voice/voiceSelection";
import { assistantVoiceFeatures } from "../../lib/api/assistantVoiceApi";
import { assistantUploadsApi } from "../../lib/api/assistantUploadsApi";
import { getAuthEpoch } from "../../lib/auth/authEpoch";
import {
  assistantMarkdownOptions,
  safeAssistantLinkUrl,
} from "./assistantMarkdown";
import { retryInput } from "./assistantState";
import type {
  AssistantAcknowledgement,
  AssistantMessage,
} from "./assistantTypes";

type AssistantScreenProps = {
  contextual?: boolean;
  route?: {
    params?: AssistantParams;
  };
};

// Both persisted and streamed replies share Web's automatic URL recognition.
const assistantMarkdown = MarkdownIt(assistantMarkdownOptions);
assistantMarkdown.validateLink = (url: string) =>
  safeAssistantLinkUrl(url) !== null;

export function AssistantScreen({
  route,
  contextual = false,
}: AssistantScreenProps) {
  const navigation = useNavigation<WorkspaceNavigationProp>();
  const { colors } = useTheme();
  const chatColumn = useChatColumn();
  const transcriptEdges = useScrollEdges();
  const adoptedId = useRef<string | undefined>(undefined);
  const assistant = useAssistant(
    route?.params?.conversationId,
    route?.params?.agentId,
    (id) => {
      if (route?.params?.conversationId === id) return;
      adoptedId.current = id;
      navigation.setParams({
        conversationId: id,
        acknowledgementId: undefined,
        openLatest: false,
      });
    },
    route?.params?.acknowledgementId,
  );
  const [draft, setDraft] = useState("");
  const [composerGeneration, setComposerGeneration] = useState(0);
  const draftRevision = useRef(0);
  function updateDraft(value: string) {
    draftRevision.current += 1;
    setDraft(value);
  }
  const [sheet, setSheet] = useState<
    "agents" | "history" | "model" | "details" | "context"
  >();
  const [title, setTitle] = useState("");
  const [localError, setLocalError] = useState<string>();
  const [voiceThread, setVoiceThread] = useState<string>();
  const [openingVoice, setOpeningVoice] = useState(false);
  const voiceOpening = useRef<AbortController | undefined>(undefined);
  const composerPress = useRef(createAssistantComposerPressGuard());
  const [stopProtected, setStopProtected] = useState(false);
  const transcript = useRef<FlatList<AssistantMessage>>(null);
  const transcriptScroll = useTranscriptScrollFollow(
    transcript,
    assistant.conversationId,
  );
  const conversation = assistant.history?.conversation;
  const currentAgent = assistant.agent ?? conversation?.agent;
  const agentName = currentAgent
    ? chatAgentLabel(currentAgent)
    : assistant.agentId
      ? "Agent"
      : "NyxBot";
  // Specialists share this screen, so only NyxBot introduces itself as NyxBot.
  const isNyxBotChat = currentAgent
    ? currentAgent.kind === "nyxbot"
    : !assistant.agentId;
  const homeVisible = showNyxBotHome({
    contextual,
    nyxbot: isNyxBotChat,
    conversationId: assistant.conversationId,
    routeConversationId: route?.params?.conversationId,
    openLatest: route?.params?.openLatest,
    sending: assistant.sending,
    loading: assistant.loading,
    inputText: assistant.inputText,
    inputAttachments: assistant.inputAttachments,
  });
  const chatTitle = assistant.conversationId
    ? (conversation?.title ?? "Loading chat…")
    : "New chat";
  const currentModelId = conversation?.model ?? assistant.model;
  const currentModelLabel =
    assistant.models.find((item) => item.id === currentModelId)?.label ??
    currentModelId.replace(/^nyxagent\//, "");
  const running = assistant.sending || !!conversation?.active_turn;
  const liveText = assistant.live
    ? liveReplyText(assistant.live) ||
      conversation?.active_turn?.reply?.text ||
      ""
    : (conversation?.active_turn?.reply?.text ?? "");
  const liveActivities = conversation?.active_turn?.activities ?? [];
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
    messages.length > 0 &&
    !running &&
    !assistant.inputText &&
    !assistant.inputAttachments.length;
  const hasHistoryGap = messages.some(
    (item, index) =>
      index > 0 && item.seq > (messages[index - 1]?.seq ?? item.seq) + 1,
  );
  const canCompose =
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
  const uploads = useAssistantUploads({
    conversationId: assistant.conversationId,
    agentId: assistant.agentId,
    model: assistant.model,
    generation: composerGeneration,
    enabled: canCompose,
    online: assistant.online,
  });
  const newChatDisabled =
    assistant.loading ||
    !assistant.agentId ||
    ((assistant.sending || uploads.session.sending) &&
      !assistant.conversationId);
  const modelLocked =
    !!assistant.conversationId || assistant.sending || uploads.session.sending;
  const headerDisabled =
    assistant.loading ||
    ((assistant.sending || uploads.session.sending) &&
      !assistant.conversationId);
  const dictation = useComposerDictation({
    scope: `${assistant.agentId}:${assistant.conversationId ?? "new"}:${composerGeneration}`,
    enabled:
      canCompose &&
      !uploads.picking &&
      !uploads.session.sending &&
      !openingVoice &&
      !voiceThread,
    onInsert: (text) => updateDraft(appendDictation(draft, text)),
  });
  const canSend =
    canCompose &&
    !dictation.active &&
    !uploads.session.sending &&
    !uploads.blocked &&
    !uploads.picking &&
    (!!draft.trim() || uploads.files.length > 0) &&
    [...draft].length <= 32768;

  const voiceFeatures = useQuery({
    queryKey: ["workspace", "voice-features", getAuthEpoch()],
    queryFn: ({ signal }) => assistantVoiceFeatures(signal),
    enabled: NATIVE_VOICE_ENTRY_ENABLED && assistant.online,
    retry: false,
    staleTime: 30000,
  });
  const voiceAvailable = showVoiceComposer({
    enabled:
      NATIVE_VOICE_ENTRY_ENABLED &&
      voiceFeatures.data?.includes("assistant:voice") === true,
    running,
    text: draft,
    attachmentCount: uploads.files.length,
    uploadBlocked:
      uploads.blocked ||
      uploads.picking ||
      uploads.session.sending ||
      dictation.active,
    channel: conversation?.channel,
    subagent: conversation?.role === "subagent",
    destroyed: !!destroyed,
  });
  const voiceContext = useRef({
    agentId: assistant.agentId,
    conversationId: assistant.conversationId,
    epoch: getAuthEpoch(),
    revision: draftRevision.current,
    voiceAllowed: canCompose && voiceAvailable,
  });
  voiceContext.current = {
    agentId: assistant.agentId,
    conversationId: assistant.conversationId,
    epoch: getAuthEpoch(),
    revision: draftRevision.current,
    voiceAllowed: canCompose && voiceAvailable,
  };
  useEffect(() => {
    setOpeningVoice(false);
    return () => {
      voiceOpening.current?.abort();
    };
  }, [route?.params?.agentId, route?.params?.conversationId]);
  useEffect(() => {
    if (voiceThread && voiceThread !== assistant.conversationId)
      setVoiceThread(undefined);
  }, [voiceThread, assistant.conversationId]);

  async function openVoice() {
    if (!canCompose || !voiceAvailable || voiceOpening.current) return;
    if (voiceThread === assistant.conversationId && voiceThread) return;
    Keyboard.dismiss();
    const scope = { ...voiceContext.current, revision: draftRevision.current };
    const controller = new AbortController();
    voiceOpening.current = controller;
    setOpeningVoice(true);
    const current = () =>
      !controller.signal.aborted &&
      voiceContext.current.agentId === scope.agentId &&
      voiceContext.current.conversationId === scope.conversationId &&
      voiceContext.current.voiceAllowed &&
      getAuthEpoch() === scope.epoch &&
      draftRevision.current === scope.revision;
    try {
      const id =
        scope.conversationId ??
        (await assistantUploadsApi.createDraft(
          scope.agentId,
          controller.signal,
        ));
      if (!current()) return;
      if (!scope.conversationId) {
        adoptedId.current = id;
        assistant.openConversation(id);
        navigation.setParams({
          conversationId: id,
          acknowledgementId: undefined,
          openLatest: false,
        });
      }
      setVoiceThread(id);
    } catch (cause) {
      if (current())
        setLocalError(
          cause instanceof Error
            ? cause.message
            : "Voice could not open. Try again.",
        );
    } finally {
      if (voiceOpening.current === controller) {
        voiceOpening.current = undefined;
        if (!controller.signal.aborted) setOpeningVoice(false);
      }
    }
  }

  function openSafeLink(url: string): boolean {
    const href = safeAssistantLinkUrl(url);
    if (!href) return false;
    const automation = parseAutomationLink(href, NYXID_FRONTEND_URL);
    if (automation?.kind === "invalid") {
      Alert.alert("Could not open automation", automation.message);
    } else if (automation?.kind === "automation") {
      if (automation.params.setup) {
        navigation.dispatch(
          openWorkspaceSheetAction("AutomationEditor", automation.params),
        );
      } else {
        navigation.dispatch(
          workspaceNavigateAction("Automations", {
            agentId: undefined,
            setup: undefined,
            ...automation.params,
          }),
        );
      }
    } else {
      void WebBrowser.openBrowserAsync(href).catch(() => undefined);
    }
    return false;
  }

  useEffect(() => {
    if (
      !route?.params?.openLatest ||
      route.params.conversationId ||
      !route.params.agentId ||
      assistant.indexedAgentId !== route.params.agentId
    )
      return;
    const id = assistant.conversations[0]?.id;
    navigation.setParams({
      conversationId: id,
      acknowledgementId: undefined,
      openLatest: false,
    });
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
    setComposerGeneration((value) => value + 1);
    const agentId = assistant.agentId;
    assistant.openConversation();
    assistant.setModel(assistant.agent?.model ?? "nyxagent/chat");
    navigation.setParams({
      conversationId: undefined,
      acknowledgementId: undefined,
      agentId,
      draft: true,
      openLatest: false,
    });
    updateDraft("");
    setSheet(undefined);
  }

  const headerHandlers = useRef({ newChat });
  headerHandlers.current = { newChat };
  const headerOptions = useMemo<NativeStackNavigationOptions>(() => {
    const actions = () => (
      <WorkspaceHeaderVisibility>
        <View style={styles.headerActions}>
          <IconButton
            label="New chat"
            disabled={newChatDisabled}
            onPress={() => headerHandlers.current.newChat()}
          >
            <SquarePen size={21} color={colors.textPrimary} />
          </IconButton>
          <IconButton
            label="Chat options"
            onPress={() => {
              setTitle(conversation?.title ?? "");
              setSheet("details");
            }}
          >
            <MoreHorizontal size={23} color={colors.textPrimary} />
          </IconButton>
        </View>
      </WorkspaceHeaderVisibility>
    );
    return {
      headerTitle: () => (
        <WorkspaceHeaderVisibility>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Chatting with ${agentName}. Choose agent`}
            accessibilityState={{ disabled: headerDisabled }}
            disabled={headerDisabled}
            onPress={() => setSheet("agents")}
            style={styles.headerIdentity}
          >
            {currentAgent ? (
              <AgentAvatar agent={currentAgent} size="lg" />
            ) : null}
            <View style={styles.fill}>
              <View style={styles.headerName}>
                <Text
                  numberOfLines={1}
                  style={[styles.agentName, { color: colors.textPrimary }]}
                >
                  {agentName}
                </Text>
                <ChevronDown size={14} color={colors.textSecondary} />
              </View>
              <Text
                numberOfLines={1}
                style={[styles.headerSubtitle, { color: colors.textSecondary }]}
              >
                {chatTitle}
              </Text>
            </View>
          </Pressable>
        </WorkspaceHeaderVisibility>
      ),
      headerRight: actions,
      unstable_headerRightItems: () => [
        { type: "custom", element: actions(), hidesSharedBackground: true },
      ],
    };
  }, [
    agentName,
    currentAgent,
    chatTitle,
    conversation?.title,
    colors.textPrimary,
    colors.textSecondary,
    headerDisabled,
    newChatDisabled,
  ]);

  useWorkspaceBack({
    // The primary Chats destination always keeps the drawer available. Only
    // contextual chats pushed from another screen have a native Back parent.
    active: false,
    defaultRole: contextual ? "back" : "menu",
    disabled: headerDisabled,
    options: headerOptions,
    onBack: () => navigation.goBack(),
  });

  async function sendDraft() {
    if (!canSend || !composerPress.current("send")) return;
    setStopProtected(true);
    transcriptScroll.follow();
    await perform(() =>
      submitAssistantDraft({
        draft,
        updateDraft,
        getRevision: () => draftRevision.current,
        send: (text) =>
          uploads.session.submit((payload) =>
            assistant.send(text, undefined, payload),
          ),
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
    link: {
      color: colors.primaryOnTint,
      textDecorationLine: "underline" as const,
    },
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
    ...assistantSelectableMarkdown,
    link: (node, children) => (
      <Text
        key={node.key}
        accessibilityRole="link"
        style={markdownStyle.link}
        onPress={() => openSafeLink(node.attributes.href)}
      >
        {children}
      </Text>
    ),
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
    const resetAt = Date.parse(conversation?.context_reset_at ?? "");
    const resetHere =
      Number.isFinite(resetAt) &&
      Date.parse(item.created_at) > resetAt &&
      (index === 0 || Date.parse(messages[index - 1]!.created_at) <= resetAt);
    if (item.continuation_of)
      return (
        <Label muted accessibilityLiveRegion="polite" style={styles.message}>
          Continuing after your decision
        </Label>
      );
    const input = retryInput(assistant.history, item);
    const attribution = [
      isUser
        ? ""
        : item.role === "assistant"
          ? (conversation?.agent?.display_name ??
            conversation?.agent?.name ??
            "NyxBot")
          : item.role === "orchestrator"
            ? "NyxBot · instruction"
            : "Update",
      item.via,
    ]
      .filter(Boolean)
      .join(" · ");
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
        {resetHere ? (
          <Label muted accessibilityLabel="Conversation context reset">
            {contextResetCopy(conversation?.context_reset_reason)}
          </Label>
        ) : null}
        {attribution ? (
          <Label muted style={styles.messageLabel}>
            {attribution}
          </Label>
        ) : null}
        <AssistantActivityDisclosure
          key={item.id}
          activities={item.activities}
          activityTotal={item.activity_total}
          turnLabel={
            item.error_code === "cancelled"
              ? "Stopped"
              : item.status === "failed"
                ? "Turn failed"
                : "Completed"
          }
          metadata={item.turn_metadata}
          decisions={(assistant.history?.acknowledgements ?? []).filter(
            (row) =>
              row.status !== "pending" &&
              !row.authored_skill &&
              row.creation_turn_id === item.turn_id,
          )}
          onToggle={() => {
            // Opening details is an explicit reading action. Keep the header
            // in view instead of following the newly expanded list to its end.
            transcriptScroll.pause();
          }}
        />
        {conversation?.id &&
          item.activities
            .filter((activity) => activity.machine)
            .map((activity) => (
              <MachineToolCard
                key={`machine:${activity.id}`}
                receipt={activity.machine!}
                conversationId={conversation.id}
                onOpenDesktop={(params) =>
                  navigation.navigate("MachineDesktop", params)
                }
              />
            ))}
        {!isUser &&
          assistant.history?.cma_operations
            ?.filter((operation) => operation.turn_id === item.turn_id)
            .map((operation) => (
              <AssistantCmaOperation key={operation.id} operation={operation} />
            ))}
        {isUser && item.steering ? (
          <Label muted>
            Steering ·{" "}
            {steeringNotice(item.steering.code, item.steering.outcome)}
          </Label>
        ) : null}
        {isUser ? (
          item.text ? (
            <Text
              selectable
              style={[styles.messageText, { color: colors.textPrimary }]}
            >
              {item.text}
            </Text>
          ) : null
        ) : (
          <Markdown
            markdownit={assistantMarkdown}
            style={markdownStyle}
            rules={markdownRules}
            onLinkPress={openSafeLink}
          >
            {item.text}
          </Markdown>
        )}
        {item.attachments.map((attachment) => (
          <AssistantAttachmentView
            key={attachment.id}
            attachment={attachment}
            conversationId={assistant.conversationId}
          />
        ))}
        {!isUser ? (
          <AssistantMessageNotices
            message={item}
            onOpenBilling={() =>
              navigation.dispatch(openWorkspaceSheetAction("UsageCredits"))
            }
          />
        ) : null}
        {input !== undefined ? (
          <ActionButton
            label="Retry"
            variant="secondary"
            disabled={
              running ||
              !assistant.online ||
              assistant.recoveryRequired ||
              assistant.loadingOlder
            }
            onPress={() => void perform(() => assistant.retry(item.id))}
          />
        ) : null}
        {item.status === "failed" && item.error_code !== "cancelled" ? (
          <QuietButton
            label="Check retry availability"
            disabled={running || !assistant.online || assistant.loadingOlder}
            onPress={() => void perform(() => assistant.checkRecovery(item.id))}
          />
        ) : null}
        <Label muted mono style={styles.timestamp}>
          {formatDate(item.created_at)}
        </Label>
        <AssistantCopyButton text={item.text} />
        {item.role === "assistant" &&
        item.status === "completed" &&
        !!item.text.trim() &&
        !item.error_code ? (
          <AssistantReplyFeedback
            key={`${assistant.conversationId}:${item.id}`}
            feedback={item.feedback}
            disabled={
              !assistant.online || assistant.loadingOlder || assistant.loading
            }
            onSave={(vote, comment) =>
              assistant.feedback(item.id, vote, comment)
            }
          />
        ) : null}
      </View>
    );
  }

  function renderAuthoredReview(row: AssistantAcknowledgement) {
    return (
      <NativeAuthoredSkillReview
        acknowledgement={row}
        initiallyOpen={row.id === route?.params?.acknowledgementId}
        disabled={Boolean(assistant.deciding) || assistant.loadingOlder}
        online={assistant.online}
        onDecision={(choice) => assistant.decide(row.id, choice)}
        onRefresh={() => {
          if (conversation?.id)
            return assistant.openConversation(conversation.id);
        }}
      />
    );
  }

  function renderAcknowledgement(row: AssistantAcknowledgement) {
    if (row.status !== "pending") return null;
    return (
      <AssistantAcknowledgementCard
        key={row.id}
        row={row}
        selected={row.id === route?.params?.acknowledgementId}
        disabled={
          !!assistant.deciding || !assistant.online || assistant.loadingOlder
        }
        deciding={assistant.deciding === row.id}
        onDecision={(choice) =>
          void perform(() => assistant.decide(row.id, choice))
        }
        authoredReview={
          row.authored_skill ? renderAuthoredReview(row) : undefined
        }
      />
    );
  }

  return (
    <WorkspacePage
      title={chatTitle}
      showHeading={false}
      scroll={false}
      contentStyle={styles.chatPage}
    >
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
      <View key="transcript-column" style={[styles.fill, chatColumn]}>
        {homeVisible ? (
          <NyxBotHome
            key={getAuthEpoch()}
            scrollProps={{
              style: styles.fill,
              scrollEventThrottle: 32,
              onLayout: (event) =>
                transcriptEdges.layout(event.nativeEvent.layout.height),
              onContentSizeChange: (_width, height) =>
                transcriptEdges.content(height),
              onScroll: (event) =>
                transcriptEdges.scroll(event.nativeEvent.contentOffset.y),
            }}
            onChat={(agentId, conversationId, acknowledgementId) => {
              if (newChatDisabled || running || uploads.session.sending) return;
              const agent = assistant.agents.find((row) => row.id === agentId);
              if (
                !agent ||
                agent.can_use === false ||
                agent.status === "destroyed"
              )
                return;
              setComposerGeneration((value) => value + 1);
              assistant.openConversation(conversationId, acknowledgementId);
              assistant.setModel(agent.model ?? "nyxagent/chat");
              navigation.setParams({
                agentId,
                conversationId,
                acknowledgementId,
                draft: false,
                openLatest: !conversationId,
              });
              updateDraft("");
            }}
            onOpenCrew={(groupId) =>
              navigation.navigate("GroupChat", { groupId })
            }
            onNewAgent={() =>
              navigation.dispatch(openWorkspaceSheetAction("AgentCreate"))
            }
            onNewCrew={() =>
              navigation.dispatch(openWorkspaceSheetAction("GroupEditor"))
            }
          />
        ) : (
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
            // Anchor stable history only while reading it. Native row anchoring
            // competes with keeping the newest live or newly saved reply visible.
            maintainVisibleContentPosition={
              stableTranscript && !transcriptScroll.following
                ? { minIndexForVisible: 0 }
                : undefined
            }
            {...transcriptScroll.listProps}
            onLayout={(event) => {
              transcriptScroll.listProps.onLayout(event);
              transcriptEdges.layout(event.nativeEvent.layout.height);
            }}
            onContentSizeChange={(width, height) => {
              transcriptScroll.listProps.onContentSizeChange(width, height);
              transcriptEdges.content(height);
            }}
            onScroll={(event) => {
              transcriptScroll.listProps.onScroll(event);
              transcriptEdges.scroll(event.nativeEvent.contentOffset.y);
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
                    transcriptScroll.pause();
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
                  <Text
                    style={[styles.welcomeTitle, { color: colors.textPrimary }]}
                  >
                    {isNyxBotChat ? "Hi, I'm NyxBot." : "How can I help?"}
                  </Text>
                  {isNyxBotChat ? (
                    <Text
                      style={[
                        styles.welcomeBody,
                        { color: colors.textSecondary },
                      ]}
                    >
                      I'm here to help you use NyxID, manage your NyxID services
                      and automate them.
                    </Text>
                  ) : null}
                </View>
              ) : null
            }
            ListFooterComponent={
              <View style={styles.footer}>
                {conversation?.context_reset_at &&
                (!messages.length ||
                  Date.parse(messages.at(-1)!.created_at) <=
                    Date.parse(conversation.context_reset_at)) ? (
                  <Label muted accessibilityLabel="Conversation context reset">
                    {contextResetCopy(conversation.context_reset_reason)}
                  </Label>
                ) : null}
                {(assistant.inputText ||
                  assistant.inputAttachments.length > 0) &&
                !optimisticUserPersisted ? (
                  <View
                    style={[
                      styles.message,
                      styles.userMessage,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Label muted style={styles.messageLabel}>
                      Sending…
                    </Label>
                    {assistant.inputText ? (
                      <Text
                        selectable
                        style={[
                          styles.messageText,
                          { color: colors.textPrimary },
                        ]}
                      >
                        {assistant.inputText}
                      </Text>
                    ) : null}
                    {assistant.inputAttachments.map((attachment) => (
                      <AssistantAttachmentView
                        key={attachment.id}
                        attachment={attachment}
                        conversationId={
                          assistant.conversationId ??
                          assistant.live?.conversationId
                        }
                      />
                    ))}
                  </View>
                ) : null}
                {running && !streamPersisted ? (
                  <View style={styles.message}>
                    <Label muted style={styles.messageLabel}>
                      {agentName}
                    </Label>
                    <AssistantActivityDisclosure
                      key={
                        conversation?.active_turn?.turn_id ??
                        assistant.live?.turnId ??
                        "pending-turn"
                      }
                      activities={liveActivities}
                      activityTotal={conversation?.active_turn?.activity_total}
                      turnLabel="Working…"
                      onToggle={() => {
                        transcriptScroll.pause();
                      }}
                    />
                    {conversation?.id &&
                      liveActivities
                        .filter((activity) => activity.machine)
                        .map((activity) => (
                          <MachineToolCard
                            key={`machine:${activity.id}`}
                            receipt={activity.machine!}
                            conversationId={conversation.id}
                            onOpenDesktop={(params) =>
                              navigation.navigate("MachineDesktop", params)
                            }
                          />
                        ))}
                    {liveText ? (
                      <Markdown
                        markdownit={assistantMarkdown}
                        style={markdownStyle}
                        rules={markdownRules}
                        onLinkPress={openSafeLink}
                      >
                        {liveText}
                      </Markdown>
                    ) : null}
                    <AssistantTurnStatus
                      turn={conversation?.active_turn}
                      live={assistant.live}
                      pendingApproval={
                        !!assistant.history?.approvals.length ||
                        !!assistant.history?.acknowledgements.some(
                          (row) => row.status === "pending",
                        )
                      }
                      interrupted={assistant.interrupted}
                    />
                    {assistant.history?.cma_operations
                      ?.filter(
                        (operation) =>
                          operation.turn_id ===
                          (conversation?.active_turn?.turn_id ??
                            assistant.live?.turnId),
                      )
                      .map((operation) => (
                        <AssistantCmaOperation
                          key={operation.id}
                          operation={operation}
                        />
                      ))}
                    <AssistantCopyButton text={liveText} partial />
                  </View>
                ) : null}
                {assistant.history?.waiting.map((waiting, index) => (
                  <Notice
                    key={`${waiting.title}:${index}`}
                    message={`${waiting.title}${waiting.detail ? ` · ${waiting.detail}` : ""}`}
                  />
                ))}
                <AssistantAcknowledgements
                  key={conversation?.id ?? "draft"}
                  acknowledgements={(
                    assistant.history?.acknowledgements ?? []
                  ).filter(
                    (row) =>
                      row.status === "pending" ||
                      row.authored_skill ||
                      row.id === route?.params?.acknowledgementId ||
                      !messages.some(
                        (message) =>
                          message.role === "assistant" &&
                          message.turn_id === row.creation_turn_id,
                      ),
                  )}
                  selectedId={route?.params?.acknowledgementId}
                  onOpenLink={openSafeLink}
                  renderPending={renderAcknowledgement}
                  renderAuthoredReview={renderAuthoredReview}
                  onToggle={() => transcriptScroll.pause()}
                />
                {assistant.history?.approvals.map((approval) => (
                  <Card key={approval.id}>
                    <Label style={styles.cardTitle}>
                      {approval.service_name} · Approval needed
                    </Label>
                    <Label>{approval.summary}</Label>
                    <Label muted>
                      Scope · {approval.service_slug ?? approval.service_name}
                      {approval.agent_key_prefix
                        ? ` · ${approval.agent_key_prefix}`
                        : ""}
                      {approval.approval_mode
                        ? ` · ${approval.approval_mode === "per_request" ? "per-request approval" : "grant"}`
                        : ""}
                    </Label>
                    <Label muted mono>
                      Expires {formatDate(approval.expires_at)}
                    </Label>
                    <ActionButton
                      label="Review request"
                      variant="secondary"
                      onPress={() =>
                        navigation.dispatch(
                          openWorkspaceSheetAction("ActivityDetail", {
                            challengeId: approval.id,
                          }),
                        )
                      }
                    />
                  </Card>
                ))}
              </View>
            }
          />
        )}
        <ScrollEdgeFades edges={transcriptEdges.edges} color={colors.bg} />
      </View>
      {voiceThread && voiceThread === assistant.conversationId ? (
        <AssistantVoiceConversation
          key={`voice:${voiceThread}`}
          thread={voiceThread}
          agentName={agentName}
          onClose={() => setVoiceThread(undefined)}
          onUpdate={() => void assistant.recover()}
          onReview={(acknowledgementId) => {
            assistant.openConversation(voiceThread, acknowledgementId);
            navigation.setParams({
              conversationId: voiceThread,
              acknowledgementId,
              openLatest: false,
            });
          }}
        />
      ) : null}
      <ChatComposerFrame style={[styles.composer, chatColumn]}>
        <ComposerDictationReview dictation={dictation} />
        <AssistantPendingUploads
          files={uploads.files}
          remove={uploads.remove}
          disabled={running || uploads.session.sending}
          showMentionHandles={false}
        />
        {uploads.error || uploads.notice ? (
          <Label
            style={{
              color: uploads.error ? colors.danger : colors.textSecondary,
            }}
          >
            {uploads.error ?? uploads.notice}
          </Label>
        ) : null}
        <AssistantMentionInput
          value={draft}
          onChangeText={updateDraft}
          generation={`${assistant.agentId}:${assistant.conversationId ?? "new"}:${composerGeneration}`}
          editable={
            !destroyed &&
            !assistant.recoveryRequired &&
            !route?.params?.openLatest
          }
          accessibilityLabel="Message to assistant"
          placeholder={`Message ${agentName}`}
          renderActions={(mentionAction) => (
            <ChatComposerRow>
              <ComposerAttachButton
                label="Attach files or photos"
                busy={uploads.picking}
                disabled={
                  !canCompose ||
                  dictation.active ||
                  uploads.picking ||
                  uploads.session.sending ||
                  uploads.files.length >= 10
                }
                onPress={uploads.choose}
              />
              {mentionAction}
              <View style={{ flex: 1 }} />
              <ComposerDictationButton
                dictation={dictation}
                disabled={
                  !canCompose ||
                  uploads.picking ||
                  uploads.session.sending ||
                  openingVoice ||
                  !!voiceThread
                }
              />
              {running && assistant.conversationId ? (
                <ComposerSubmitButton
                  kind="stop"
                  label="Stop assistant"
                  disabled={
                    stopProtected ||
                    assistant.mutating ||
                    conversation?.active_turn?.stop_requested
                  }
                  onPress={() => {
                    if (composerPress.current("stop")) void assistant.stop();
                  }}
                />
              ) : voiceAvailable &&
                (!voiceThread || voiceThread !== assistant.conversationId) ? (
                <ComposerSubmitButton
                  kind="voice"
                  label="Open voice call"
                  disabled={!canCompose || openingVoice}
                  busy={openingVoice}
                  onPress={() => void openVoice()}
                />
              ) : (
                <ComposerSubmitButton
                  kind="send"
                  label="Send message"
                  disabled={!canSend}
                  onPress={() => void sendDraft()}
                />
              )}
            </ChatComposerRow>
          )}
        />
        {assistant.recoveryRequired || uploads.blocked ? (
          <Label muted style={styles.composerHint}>
            {assistant.recoveryRequired
              ? "Open the saved chat before continuing."
              : "Wait for uploads or remove failed files."}
          </Label>
        ) : null}
        {[...draft].length > 32768 ? (
          <Label style={{ color: colors.danger }}>
            Keep the message under 32,768 characters.
          </Label>
        ) : null}
      </ChatComposerFrame>

      <Sheet
        visible={!!sheet}
        scroll={sheet !== "agents"}
        title={
          sheet === "agents"
            ? "Choose agent"
            : sheet === "history"
              ? `${agentName} · Chat history`
              : sheet === "model"
                ? "Choose a model"
                : sheet === "context"
                  ? "Working context"
                  : "Chat details"
        }
        onClose={() => setSheet(undefined)}
      >
        {sheet === "agents" ? (
          <WorkspaceChatList
            key={getAuthEpoch()}
            mode="picker"
            visible
            current={{
              kind: "agent",
              agentId: currentAgent?.id ?? assistant.agentId,
              conversationId: assistant.conversationId,
            }}
            onCreateAgent={() => {}}
            onCreateGroup={() => {}}
            scrollProps={{
              contentContainerStyle: styles.sheetContent,
              keyboardShouldPersistTaps: "handled",
            }}
            scrollHeader={
              <Card>
                <Label style={styles.sheetSection}>This thread</Label>
                <Label>{conversation?.title || chatTitle}</Label>
                <Label muted>
                  {agentName} · {currentModelLabel}
                </Label>
                {conversation ? (
                  <Label muted>
                    {formatDate(conversation.last_message_at)} ·{" "}
                    {conversation.message_count} messages
                  </Label>
                ) : null}
                <View style={styles.row}>
                  <ActionButton
                    compact
                    label="Details"
                    variant="secondary"
                    onPress={() => {
                      setTitle(conversation?.title ?? "");
                      setSheet("details");
                    }}
                  />
                  <ActionButton
                    compact
                    label="History"
                    variant="secondary"
                    onPress={() => setSheet("history")}
                  />
                </View>
              </Card>
            }
            scrollFooter={
              <ActionButton
                label="Manage agents"
                variant="secondary"
                onPress={() => {
                  setSheet(undefined);
                  navigation.dispatch(workspaceNavigateAction("Agents"));
                }}
              />
            }
            onSelect={(target) => {
              if (target.kind !== "agent" || newChatDisabled) return;
              const agent = assistant.agents.find(
                (row) => row.id === target.agentId,
              );
              if (
                !agent ||
                agent.can_use !== true ||
                agent.status === "destroyed"
              )
                return;
              const sameThread =
                !!target.conversationId &&
                target.conversationId === assistant.conversationId &&
                (target.agentId === currentAgent?.id ||
                  target.agentId === assistant.agentId);
              if (!sameThread) {
                setComposerGeneration((value) => value + 1);
                assistant.openConversation(target.conversationId);
                if (!target.conversationId)
                  assistant.setModel(agent.model ?? "nyxagent/chat");
                navigation.setParams({
                  agentId: agent.id,
                  conversationId: target.conversationId,
                  acknowledgementId: undefined,
                  draft: !target.conversationId,
                  openLatest: false,
                });
                updateDraft("");
              }
              setSheet(undefined);
            }}
          />
        ) : null}
        {sheet === "history" ? (
          <>
            <ActionButton
              label="New chat"
              onPress={newChat}
              disabled={newChatDisabled}
            />
            {!assistant.conversations.length && !assistant.loadingIndex ? (
              <Label muted>Your saved chats will appear here.</Label>
            ) : null}
            {assistant.conversations.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Open chat ${item.title}${item.active_turn ? ", Working" : ""}${item.pending_acknowledgements ? `, ${item.pending_acknowledgements} requests` : ""}, ${formatDate(item.last_message_at)}`}
                accessibilityState={{
                  selected: item.id === assistant.conversationId,
                }}
                onPress={() => {
                  assistant.openConversation(item.id);
                  if (item.id !== assistant.conversationId) {
                    navigation.setParams({
                      conversationId: item.id,
                      acknowledgementId: undefined,
                      agentId: item.agent?.id ?? assistant.agentId,
                      openLatest: false,
                    });
                    updateDraft("");
                  }
                  setSheet(undefined);
                }}
              >
                <Card
                  style={
                    item.id === assistant.conversationId
                      ? {
                          borderColor: colors.primary,
                          backgroundColor: colors.primaryGlow,
                        }
                      : undefined
                  }
                >
                  <View style={styles.row}>
                    <Label
                      numberOfLines={2}
                      style={[styles.cardTitle, styles.fill]}
                    >
                      {item.title}
                    </Label>
                    {item.id === assistant.conversationId ? (
                      <View style={styles.currentChatBadge}>
                        <Check size={16} color={colors.primaryOnTint} />
                        <Label
                          style={[
                            styles.actionLabel,
                            { color: colors.primaryOnTint },
                          ]}
                        >
                          Current
                        </Label>
                      </View>
                    ) : null}
                  </View>
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
          </>
        ) : null}
        {sheet === "model" ? (
          <>
            {assistant.models.length ? (
              assistant.models.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  disabled={!item.available || modelLocked}
                  onPress={() => {
                    if (modelLocked) return;
                    assistant.setModel(item.id);
                    setSheet(undefined);
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
          </>
        ) : null}
        {sheet === "context" && assistant.conversationId ? (
          <AssistantWorkingContext
            key={assistant.conversationId}
            conversationId={assistant.conversationId}
            active={assistant.active}
            onReset={() => void assistant.recover()}
            onManageMemory={(agentId) => {
              setSheet(undefined);
              navigation.dispatch(
                openWorkspaceSheetAction("AgentDetail", { agentId }),
              );
            }}
          />
        ) : null}
        {sheet === "details" ? (
          <>
            <ActionButton
              label="Chat history"
              variant="secondary"
              onPress={() => setSheet("history")}
            />
            {assistant.conversationId ? (
              <ActionButton
                label="Working context"
                variant="secondary"
                onPress={() => setSheet("context")}
              />
            ) : null}
            <Card>
              <Label style={styles.cardTitle}>Agent</Label>
              <Label>{agentName}</Label>
              <Label muted>
                {assistant.agent?.owner_kind === "org"
                  ? (assistant.agent.owner_name ?? "Organization")
                  : currentAgent?.kind === "specialist"
                    ? "Personal specialist"
                    : "Your personal assistant"}
              </Label>
            </Card>
            <Card>
              <Label style={styles.cardTitle}>Model</Label>
              <Label>{currentModelLabel}</Label>
              <Label muted>
                {assistant.conversationId
                  ? "The model used by this saved chat. Model selection is available when starting a new chat."
                  : "Choose the model for this new chat."}
              </Label>
              {!assistant.conversationId ? (
                <ActionButton
                  label="Choose model"
                  variant="secondary"
                  disabled={modelLocked}
                  onPress={() => {
                    setSheet("model");
                  }}
                />
              ) : null}
            </Card>
            {currentAgent?.id ? (
              <ActionButton
                label="Agent details"
                variant="secondary"
                onPress={() => {
                  setSheet(undefined);
                  navigation.dispatch(
                    openWorkspaceSheetAction("AgentDetail", {
                      agentId: currentAgent.id,
                    }),
                  );
                }}
              />
            ) : null}
            {assistant.conversationId ? (
              <View style={styles.detailActions}>
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
                      if (await assistant.rename(title)) setSheet(undefined);
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
                            setSheet(undefined);
                            void assistant.remove().then((removed) => {
                              if (removed)
                                navigation.setParams({
                                  conversationId: undefined,
                                  acknowledgementId: undefined,
                                });
                              if (removed) updateDraft("");
                            });
                          },
                        },
                      ],
                    )
                  }
                />
              </View>
            ) : null}
          </>
        ) : null}
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
  scroll = true,
}: {
  scroll?: boolean;
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
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.sheetContent}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={styles.fill}>{children}</View>
        )}
      </View>
    </Modal>
  );
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
const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerActions: { flexDirection: "row", alignItems: "center" },
  headerIdentity: {
    maxWidth: 210,
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  headerName: { flexDirection: "row", alignItems: "center", gap: 4 },
  agentName: { flexShrink: 1, fontSize: 16, fontFamily: fonts.bodySemi },
  headerSubtitle: {
    maxWidth: 170,
    fontSize: 10,
    fontFamily: fonts.bodyRegular,
  },
  actionLabel: { fontSize: 11, fontFamily: fonts.bodySemi },
  currentChatBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  detailActions: { gap: 14 },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  transcript: { paddingVertical: 8, flexGrow: 1 },
  transcriptHeader: { marginBottom: 20 },
  transcriptSeparator: { height: 20 },
  message: { gap: 8, paddingVertical: 10 },
  userMessage: {
    padding: 14,
    borderWidth: 1,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 3,
    borderBottomLeftRadius: 12,
    marginLeft: 38,
    alignSelf: "flex-end",
  },
  messageLabel: { fontSize: 11, fontFamily: fonts.bodySemi },
  messageText: { fontFamily: fonts.bodyRegular, fontSize: 14, lineHeight: 23 },
  metadata: { fontSize: 11 },
  runningActivity: { flexShrink: 1, fontSize: 11 },
  timestamp: { fontSize: 10 },
  footer: { gap: 16, paddingTop: 20 },
  welcome: { alignItems: "center", paddingVertical: 100 },
  welcomeTitle: {
    fontFamily: fonts.displaySemi,
    fontSize: 24,
    lineHeight: 32,
    textAlign: "center",
  },
  welcomeBody: {
    fontFamily: fonts.bodyRegular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 300,
    marginTop: 10,
  },
  thinking: { alignSelf: "flex-start", marginVertical: 10 },
  cardTitle: { fontFamily: fonts.bodySemi },
  chatPage: { paddingHorizontal: 12, paddingTop: 0, paddingBottom: 4, gap: 8 },
  composer: { marginBottom: 0 },
  composerHint: { fontSize: 11, lineHeight: 16, paddingHorizontal: 12 },
  errorRow: { gap: 8 },
  sheet: { flex: 1, paddingTop: 20 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    gap: 16,
  },
  sheetSection: { fontFamily: fonts.bodySemi, fontSize: 13 },
  sheetTitle: { fontFamily: fonts.displaySemi, fontSize: 22, lineHeight: 30 },
  sheetContent: { padding: 20, paddingBottom: 40, gap: 14 },
});
