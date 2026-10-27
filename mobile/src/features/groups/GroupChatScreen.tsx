import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { useChatColumn } from "../display/ChatLayoutContext";
import {
  ScrollEdgeFades,
  useScrollEdges,
  OverflowScrollView,
} from "../../components/workspace/ScrollEdgeFades";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import Markdown, {
  MarkdownIt,
  type RenderRules,
} from "react-native-markdown-display";
import * as WebBrowser from "expo-web-browser";
import {
  Check,
  Plus,
  Settings2,
  MessageSquare,
  ThumbsDown,
  ThumbsUp,
  Users,
  X,
} from "lucide-react-native";
import {
  ActionButton,
  Card,
  Label,
  Notice,
  WorkspacePage,
} from "../../components/workspace/WorkspaceUI";
import { accountApi } from "../../lib/api/accountApi";
import {
  useWorkspaceBack,
  WorkspaceHeaderVisibility,
} from "../../app/WorkspaceHeader";
import { agentsApi } from "../../lib/api/agentsApi";
import { groupsApi } from "../../lib/api/groupsApi";
import { getAuthEpoch } from "../../lib/auth/authEpoch";
import { useTheme } from "../../theme/ThemeContext";
import { fonts, radius } from "../../theme/designTokens";
import { AssistantPendingUploads } from "../assistant/AssistantPendingUploads";
import {
  AssistantMentionInput,
  type AssistantMentionOption,
} from "../assistant/AssistantMentionInput";
import {
  ChatComposerFrame,
  ChatComposerRow,
  ComposerAttachButton,
  ComposerSubmitButton,
} from "../assistant/ChatComposer";
import {
  resolveAttachmentMentions,
  stripAttachmentMention,
  type AttachmentMention,
} from "../assistant/assistantMentions";
import { AssistantAttachmentView } from "../assistant/AssistantAttachmentView";
import { AssistantActivityDisclosure } from "../assistant/AssistantActivityDisclosure";
import { AssistantCopyButton } from "../assistant/AssistantCopyButton";
import { assistantSelectableMarkdown } from "../assistant/assistantSelectableMarkdown";
import { useAssistantUploads } from "../assistant/useAssistantUploads";
import {
  appendDictation,
  useComposerDictation,
} from "../assistant/useComposerDictation";
import {
  ComposerDictationButton,
  ComposerDictationReview,
} from "../assistant/ComposerDictation";
import {
  safeAssistantLinkUrl,
  assistantMarkdownOptions,
} from "../assistant/assistantMarkdown";
import { useTranscriptScrollFollow } from "../assistant/useTranscriptScrollFollow";
import {
  NO_RECIPIENT_EDITS,
  groupCanDecide,
  groupPendingOwned,
  groupPendingReview,
  resolveRecipients,
  withAdded,
  withDraft,
  withRemoved,
  type RecipientSelection,
} from "./groupState";
import type { Group, GroupMessage, GroupPendingAction } from "./groupContracts";
import { submitGroupDraft } from "./groupComposerDraft";
import {
  groupKeys,
  useGroupAvailability,
  useGroupChat,
} from "./useGroupRuntime";

export type GroupConversationTarget = {
  conversationId: string;
  agentId?: string;
  acknowledgementId?: string;
};
export type GroupChatScreenProps = {
  groupId: string;
  onBack: () => void;
  onSettings: () => void;
  onOpenConversation?: (target: GroupConversationTarget) => void;
  onOpenAgent?: (id: string) => void;
};
const groupMarkdown = MarkdownIt(assistantMarkdownOptions);
groupMarkdown.validateLink = (url: string) =>
  safeAssistantLinkUrl(url) !== null;

export function GroupChatScreen(props: GroupChatScreenProps) {
  const { epoch } = useGroupAvailability();
  return <GroupChat key={`${epoch}:${props.groupId}`} {...props} />;
}

function GroupChat({
  groupId,
  onBack,
  onSettings,
  onOpenConversation,
  onOpenAgent,
}: GroupChatScreenProps) {
  const { colors } = useTheme();
  const chatColumn = useChatColumn();
  const transcriptEdges = useScrollEdges();
  const chat = useGroupChat(groupId);
  const [draft, setDraft] = useState("");
  const [composerGeneration, setComposerGeneration] = useState(0);
  const currentComposer = useRef(0);
  const revision = useRef(0);
  const [selection, setSelection] =
    useState<RecipientSelection>(NO_RECIPIENT_EDITS);
  const [pickingRecipients, setPickingRecipients] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const [feedbackDraft, setFeedbackDraft] = useState<{
    messageId: string;
    vote?: "up" | "down";
    comment: string;
  }>();
  const group = chat.isError ? undefined : chat.data?.group;
  const names = useQuery({
    queryKey: ["workspace", "agents", "group-labels", chat.epoch],
    queryFn: ({ signal }) => agentsApi.list(signal),
    enabled: chat.active,
    retry: false,
    staleTime: 60_000,
  });
  const identity = useQuery({
    queryKey: [...groupKeys(chat.epoch), "identity"],
    queryFn: ({ signal }) => accountApi.getProfile(signal),
    enabled: chat.active && !!chat.data?.pending_actions.length,
    retry: false,
    staleTime: 60_000,
  });
  function title(id: string, fallback: string) {
    const agent = names.data?.agents.find((row) => row.id === id);
    return agent?.display_name ?? fallback;
  }
  const liveMembers =
    group?.members.filter((member) => !member.destroyed) ?? [];
  const defaults =
    group?.default_recipient_ids ??
    [
      group?.lead_agent_id ??
        liveMembers.find((member) => member.kind === "nyxbot")?.id ??
        liveMembers[0]?.id,
    ].filter((id): id is string => !!id);
  const canParticipate =
    !!group &&
    (group.owner?.type !== "org" ||
      ["creator", "admin", "participant"].includes(group.your_role ?? ""));
  const uploads = useAssistantUploads({
    groupId,
    model: "",
    generation: 0,
    enabled:
      canParticipate &&
      !chat.isError &&
      !chat.recoveryRequired &&
      liveMembers.length > 0,
    online: chat.online,
    reservedMentionHandles: liveMembers.map((member) => member.name),
  });
  const attachmentMentions: AttachmentMention[] = uploads.files.map((row) => ({
    handle: row.handle,
    label: row.item?.label ?? row.file.name,
    kind: row.kind,
  }));
  const mentions: AssistantMentionOption[] = [
    ...liveMembers
      // A roster update cannot change an existing attachment's stable handle.
      // The same-name agent remains selectable through the recipient pills.
      .filter(
        (member) =>
          !attachmentMentions.some(
            (attachment) =>
              attachment.handle.toLowerCase() === member.name.toLowerCase(),
          ),
      )
      .map((member) => ({
        id: `agent:${member.id}`,
        handle: member.name,
        label: title(member.id, member.name),
        kind: "agent" as const,
      })),
    ...uploads.files.map((row) => ({
      id: `attachment:${row.key}`,
      handle: row.handle,
      label: row.item?.label ?? row.file.name,
      kind: row.kind,
      detail: row.error ?? (row.item ? "Ready" : "Uploading…"),
    })),
  ];
  const resolvedDraft = resolveAttachmentMentions(draft, attachmentMentions);
  const recipients = resolveRecipients(
    // Route from the text that will reach the server. Recompute on roster
    // changes so an existing @file-1 cannot become a new agent's mention.
    withDraft(selection, resolvedDraft, group?.members ?? []),
    defaults,
    group?.members ?? [],
  );
  const list = useRef<FlatList<GroupMessage>>(null);
  const transcriptScroll = useTranscriptScrollFollow(list, groupId);
  const sendLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const groupHeaderOptions = useMemo<NativeStackNavigationOptions>(() => {
    const settings = () => (
      <WorkspaceHeaderVisibility>
        <Icon
          label="Crew settings"
          onPress={onSettings}
          disabled={!group || chat.sending || uploads.session.sending}
        >
          <Settings2 size={20} color={colors.textSecondary} />
        </Icon>
      </WorkspaceHeaderVisibility>
    );
    return {
      headerTitle: () => (
        <WorkspaceHeaderVisibility>
          <View style={styles.headerIdentity}>
            <Text
              numberOfLines={1}
              style={[styles.headerTitle, { color: colors.textPrimary }]}
            >
              {group?.name ?? "Crew"}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.headerSubtitle, { color: colors.textSecondary }]}
            >
              {group?.owner?.name ?? "Personal"} · Crew
            </Text>
          </View>
        </WorkspaceHeaderVisibility>
      ),
      headerRight: settings,
      unstable_headerRightItems: () => [
        { type: "custom", element: settings(), hidesSharedBackground: true },
      ],
    };
  }, [
    group?.name,
    group?.owner?.name,
    Boolean(group),
    chat.sending,
    uploads.session.sending,
    onSettings,
    colors,
  ]);
  useWorkspaceBack({
    options: groupHeaderOptions,
    active: chat.sending || uploads.session.sending,
    disabled: chat.sending || uploads.session.sending,
    defaultRole: "back",
    onBack,
    label: "Back to chat",
  });
  useEffect(() => {
    if (!chat.active) {
      setPickingRecipients(false);
      setFeedbackDraft(undefined);
    }
  }, [chat.active]);
  const blocked =
    chat.sending ||
    uploads.session.sending ||
    chat.recoveryRequired ||
    chat.loadingOlder ||
    !chat.active ||
    !canParticipate ||
    chat.isError;
  const dictation = useComposerDictation({
    scope: `${groupId}:${composerGeneration}`,
    enabled: !blocked && !uploads.picking && !!liveMembers.length,
    onInsert: (text) => edit(appendDictation(draft, text)),
  });
  const canSend =
    !blocked &&
    !dictation.active &&
    !uploads.blocked &&
    !uploads.session.sending &&
    !!recipients.ids.length &&
    liveMembers.length > 0 &&
    (!!draft.trim() || uploads.files.length > 0) &&
    [...resolvedDraft].length <= 32768;

  function edit(value: string) {
    revision.current += 1;
    setDraft(value);
    setSelection((old) =>
      withDraft(
        old,
        resolveAttachmentMentions(value, attachmentMentions),
        group?.members ?? [],
      ),
    );
  }
  function editRecipients(
    update: (old: RecipientSelection) => RecipientSelection,
  ) {
    revision.current += 1;
    setSelection(update);
  }
  function removeAttachment(key: string) {
    if (chat.sending || uploads.session.sending) return;
    const row = uploads.files.find((file) => file.key === key);
    if (!row) return;
    const next = stripAttachmentMention(draft, row.handle);
    if (next !== draft) edit(next);
    uploads.remove(key);
  }
  async function send() {
    if (!canSend || sendLock.current || !chat.available()) return;
    sendLock.current = true;
    setLocalError(undefined);
    const target = recipients;
    transcriptScroll.follow();
    try {
      await submitGroupDraft({
        draft,
        selection,
        updateComposer: (text, nextSelection) => {
          revision.current += 1;
          // Discard native marked text and late IME events from the sent draft.
          currentComposer.current += 1;
          setComposerGeneration(currentComposer.current);
          setDraft(text);
          setSelection(nextSelection);
        },
        getRevision: () =>
          mounted.current && chat.epoch === getAuthEpoch()
            ? revision.current
            : Number.NaN,
        send: (text) =>
          uploads.session.submit((files) =>
            chat.post({
              text: resolveAttachmentMentions(text, attachmentMentions),
              ...(files?.attachmentIds.length
                ? { attachment_ids: files.attachmentIds }
                : {}),
              // Freeze the visible recipients while resolving local file
              // aliases, including a member joining between edit and POST.
              ...(target.edited || files?.attachmentIds.length
                ? { recipient_agent_ids: target.ids }
                : {}),
            }),
          ),
      });
    } catch (cause) {
      if (mounted.current && chat.available())
        setLocalError(
          cause instanceof Error
            ? cause.message
            : "The message was not delivered. Refresh the crew before trying again.",
        );
    } finally {
      sendLock.current = false;
    }
  }
  async function decide(action: GroupPendingAction, choice: "allow" | "deny") {
    if (
      blocked ||
      !chat.available() ||
      !groupCanDecide(action, identity.data?.id, group?.owner?.type === "org")
    )
      return;
    try {
      await chat.perform(async () => {
        await groupsApi.decide(action, choice);
        if (chat.available()) await chat.refetch();
      });
    } catch {
      /* useGroupChat owns the visible action error */
    }
  }
  async function answer(action: GroupPendingAction, yes: boolean) {
    if (
      blocked ||
      !chat.available() ||
      group?.owner?.type === "org" ||
      !groupPendingOwned(action, identity.data?.id, false) ||
      !action.confirm_phrase ||
      Date.parse(action.expires_at) <= Date.now()
    )
      return;
    try {
      await chat.post({
        text: yes
          ? action.confirm_phrase
          : action.confirm_phrase.replace(/^yes /, "no "),
      });
    } catch {
      /* no implicit retry */
    }
  }
  const feedbackEnabled =
    chat.active &&
    !!group &&
    !chat.isError &&
    !chat.sending &&
    !uploads.session.sending;
  async function feedback(
    messageId: string,
    vote?: "up" | "down",
    comment?: string,
  ) {
    const message = chat.data?.messages.find((row) => row.id === messageId);
    if (
      !feedbackEnabled ||
      !chat.available() ||
      message?.role !== "agent" ||
      !message.text.trim()
    )
      return false;
    try {
      return await chat.feedback(
        messageId,
        vote ? { vote, comment } : undefined,
      );
    } catch {
      // The runtime retains the confirmed vote and exposes the action error.
      return false;
    }
  }
  const working =
    group?.members.filter((member) =>
      group.working_agent_ids.includes(member.id),
    ) ?? [];
  const stableTranscript =
    !!chat.data?.messages.length && !chat.sending && !working.length;

  return (
    <WorkspacePage
      title={group?.name ?? "Crew"}
      showHeading={false}
      scroll={false}
      contentStyle={styles.chatPage}
    >
      {!chat.online && (
        <Notice message="You're offline. Reconnect to read new messages and send." />
      )}
      {(chat.recoveryRequired ||
        chat.error ||
        chat.actionError ||
        localError) && (
        <View style={styles.error}>
          <Notice
            tone="error"
            message={
              chat.recoveryRequired
                ? "This message may have been delivered. Refresh the crew and check its history before sending again."
                : (localError ??
                  chat.actionError ??
                  (chat.error instanceof Error
                    ? chat.error.message
                    : "Could not load this crew."))
            }
          />
          <ActionButton
            label="Refresh crew"
            variant="secondary"
            disabled={
              !chat.active ||
              chat.isFetching ||
              chat.sending ||
              uploads.session.sending
            }
            onPress={() => {
              setLocalError(undefined);
              void chat.recoverDelivery();
            }}
          />
        </View>
      )}
      {group && (
        <OverflowScrollView
          fadeColor={colors.bg}
          horizontal
          style={styles.horizontalStrip}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.members}
        >
          {group.members.map((member) => (
            <Pressable
              key={member.id}
              accessibilityRole="button"
              accessibilityLabel={`${title(member.id, member.name)}${member.destroyed ? ", destroyed" : ""}, agent details`}
              disabled={!onOpenAgent || chat.sending || uploads.session.sending}
              onPress={() => onOpenAgent?.(member.id)}
              style={[
                styles.member,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  opacity: member.destroyed ? 0.45 : 1,
                },
              ]}
            >
              <Users
                size={14}
                color={member.working ? colors.success : colors.primaryOnTint}
              />
              <Label style={styles.small}>
                {title(member.id, member.name)}
              </Label>
            </Pressable>
          ))}
        </OverflowScrollView>
      )}
      <View style={[styles.fill, chatColumn]}>
        <FlatList
          ref={list}
          style={styles.fill}
          data={group ? (chat.data?.messages ?? []) : []}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={GroupSeparator}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          maintainVisibleContentPosition={
            stableTranscript && !transcriptScroll.following
              ? { minIndexForVisible: 0 }
              : undefined
          }
          contentContainerStyle={styles.transcript}
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
            chat.data?.before_seq ? (
              <ActionButton
                label="Load earlier messages"
                variant="secondary"
                loading={chat.loadingOlder}
                disabled={blocked}
                onPress={() => {
                  transcriptScroll.pause();
                  void chat.loadOlder();
                }}
              />
            ) : null
          }
          ListHeaderComponentStyle={styles.historyHeader}
          ListEmptyComponent={
            chat.isPending ? (
              <ActivityIndicator
                accessibilityLabel="Loading crew"
                color={colors.primary}
              />
            ) : group ? (
              <View style={styles.empty}>
                <Users size={32} color={colors.primaryOnTint} />
                <Label style={styles.heading}>Work together</Label>
                <Label muted>
                  Say hello. @mention an agent to ask it directly.
                </Label>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <GroupMessage
              group={group}
              message={item}
              title={title}
              onOpenAgent={
                chat.sending || uploads.session.sending
                  ? undefined
                  : onOpenAgent
              }
              feedbackEnabled={feedbackEnabled}
              onFeedback={(vote) => void feedback(item.id, vote)}
              onComment={() => {
                if (!feedbackEnabled || !chat.available()) return;
                transcriptScroll.pause();
                setFeedbackDraft({
                  messageId: item.id,
                  vote: item.feedback?.vote,
                  comment: item.feedback?.comment ?? "",
                });
              }}
              onDisclosure={() => {
                transcriptScroll.pause();
              }}
            />
          )}
          ListFooterComponent={
            working.length ? (
              <View style={styles.working}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Label muted>
                  {working
                    .map((member) => title(member.id, member.name))
                    .join(", ")}{" "}
                  working…
                </Label>
              </View>
            ) : null
          }
        />
        <ScrollEdgeFades edges={transcriptEdges.edges} color={colors.bg} />
      </View>
      {!!group && !!chat.data?.pending_actions.length && (
        <ScrollView
          style={styles.pending}
          contentContainerStyle={{ gap: 8 }}
          keyboardShouldPersistTaps="handled"
        >
          {chat.data.pending_actions.map((action, index) => {
            const member = group?.members.find(
              (row) => row.id === action.agent_id,
            );
            const expired = Date.parse(action.expires_at) <= Date.now();
            const review = groupPendingReview(
              action,
              identity.data?.id,
              group?.owner?.type === "org",
            );
            const canDecide = groupCanDecide(
              action,
              identity.data?.id,
              group?.owner?.type === "org",
            );
            return (
              <Card
                key={
                  action.acknowledgement_id ??
                  action.approval_request_id ??
                  `${action.conversation_id}:${index}`
                }
                style={styles.pendingCard}
              >
                <Label numberOfLines={3}>
                  {member ? title(member.id, member.name) : "An agent"} wants
                  to: {action.summary}
                </Label>
                {expired ? (
                  <Label muted>
                    This request expired. Refresh the crew for its latest
                    state.
                  </Label>
                ) : action.authored_skill ? (
                  review && onOpenConversation ? (
                    <ActionButton
                      label="Review draft"
                      variant="secondary"
                      disabled={blocked}
                      onPress={() => {
                        if (blocked || !chat.available()) return;
                        const currentReview = groupPendingReview(
                          action,
                          identity.data?.id,
                          group?.owner?.type === "org",
                        );
                        if (!currentReview) return;
                        onOpenConversation({
                          conversationId: currentReview.conversationId,
                          agentId: action.agent_id ?? undefined,
                          acknowledgementId: currentReview.acknowledgementId,
                        });
                      }}
                    />
                  ) : (
                    <Label muted>
                      Awaiting{" "}
                      {action.triggering_person?.display_name ?? "owner"} review
                    </Label>
                  )
                ) : action.triggering_person ? (
                  <>
                    <Label muted>
                      Awaiting {action.triggering_person.display_name}
                    </Label>
                    {canDecide && (
                      <View style={styles.actions}>
                        <View style={styles.fill}>
                          <ActionButton
                            label="Deny"
                            variant="secondary"
                            disabled={blocked}
                            onPress={() => void decide(action, "deny")}
                          />
                        </View>
                        <View style={styles.fill}>
                          <ActionButton
                            label="Allow"
                            disabled={blocked}
                            onPress={() => void decide(action, "allow")}
                          />
                        </View>
                      </View>
                    )}
                  </>
                ) : action.confirm_phrase && group?.owner?.type !== "org" ? (
                  <View style={styles.actions}>
                    <View style={styles.fill}>
                      <ActionButton
                        label="Cancel action"
                        variant="secondary"
                        disabled={blocked}
                        onPress={() => void answer(action, false)}
                      />
                    </View>
                    <View style={styles.fill}>
                      <ActionButton
                        label="Confirm action"
                        disabled={blocked}
                        onPress={() => void answer(action, true)}
                      />
                    </View>
                  </View>
                ) : (
                  <Label muted>
                    Awaiting the owner in the agent's conversation.
                  </Label>
                )}
              </Card>
            );
          })}
        </ScrollView>
      )}
      {group && (
        <View style={[styles.composerArea, chatColumn]}>
          {!recipients.ids.length && (
            <Label style={[styles.small, { color: colors.danger }]}>
              Choose at least one recipient.
            </Label>
          )}
          {!liveMembers.length && (
            <Label muted>
              All agents have been removed or destroyed. This crew is
              read-only.
            </Label>
          )}
          {!canParticipate && (
            <Label muted>
              This crew is read-only for your current organization role.
            </Label>
          )}
          {(uploads.error || uploads.notice) && (
            <Label muted>{uploads.error ?? uploads.notice}</Label>
          )}
          <ChatComposerFrame>
            <ComposerDictationReview dictation={dictation} />
            <OverflowScrollView
              fadeColor={colors.composerBg}
              horizontal
              style={styles.horizontalStrip}
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.recipients}
            >
              <Label muted style={styles.small}>
                To
              </Label>
              {recipients.ids.map((id) => {
                const member = liveMembers.find((row) => row.id === id);
                return member ? (
                  <Pressable
                    key={id}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove recipient ${title(id, member.name)}`}
                    disabled={blocked}
                    onPress={() =>
                      editRecipients((old) => withRemoved(old, id))
                    }
                    style={[
                      styles.recipient,
                      {
                        backgroundColor: colors.navActive,
                        borderColor: colors.composerBorder,
                      },
                    ]}
                  >
                    <Label style={styles.small}>{title(id, member.name)}</Label>
                    <X size={12} color={colors.textSecondary} />
                  </Pressable>
                ) : null;
              })}
              {liveMembers.some(
                (member) => !recipients.ids.includes(member.id),
              ) && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add recipient"
                  disabled={blocked}
                  onPress={() => setPickingRecipients(true)}
                  style={styles.addRecipient}
                >
                  <Plus size={14} color={colors.primaryOnTint} />
                  <Label
                    style={[styles.small, { color: colors.primaryOnTint }]}
                  >
                    Add
                  </Label>
                </Pressable>
              )}
            </OverflowScrollView>
            <AssistantPendingUploads
              files={uploads.files}
              remove={removeAttachment}
              disabled={chat.sending || uploads.session.sending}
            />
            <AssistantMentionInput
              generation={composerGeneration}
              accessibilityLabel="Message the crew"
              placeholder="Message the crew"
              value={draft}
              mentions={mentions}
              onChangeText={(value) => {
                if (currentComposer.current === composerGeneration) edit(value);
              }}
              editable={!blocked && !!liveMembers.length}
              style={[styles.input, { color: colors.textPrimary }]}
              renderActions={(mentionAction) => (
                <ChatComposerRow>
                  <ComposerAttachButton
                    label="Attach files or photos to crew"
                    busy={uploads.picking}
                    disabled={
                      blocked ||
                      dictation.active ||
                      !liveMembers.length ||
                      uploads.picking ||
                      uploads.session.sending
                    }
                    onPress={uploads.choose}
                  />
                  {mentionAction}
                  <View style={{ flex: 1 }} />
                  <ComposerDictationButton
                    dictation={dictation}
                    disabled={blocked || uploads.picking || !liveMembers.length}
                  />
                  <ComposerSubmitButton
                    kind="send"
                    label="Send crew message"
                    busy={chat.sending}
                    disabled={!canSend}
                    onPress={() => void send()}
                  />
                </ChatComposerRow>
              )}
            />
          </ChatComposerFrame>
          {[...resolvedDraft].length > 32768 && (
            <Label style={[styles.small, { color: colors.danger }]}>
              Keep the message within 32,768 characters, including attachment
              references.
            </Label>
          )}
        </View>
      )}
      <Modal
        visible={!!feedbackDraft}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!chat.sending) setFeedbackDraft(undefined);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.picker,
              { backgroundColor: colors.bg, borderColor: colors.border },
            ]}
          >
            <View style={styles.header}>
              <Label style={[styles.heading, styles.fill]}>
                Message feedback
              </Label>
              <Icon
                label="Close feedback"
                disabled={chat.sending}
                onPress={() => setFeedbackDraft(undefined)}
              >
                <X size={22} color={colors.textPrimary} />
              </Icon>
            </View>
            <View style={styles.actions}>
              {(["up", "down"] as const).map((vote) => (
                <View key={vote} style={styles.fill}>
                  <ActionButton
                    label={vote === "up" ? "Helpful" : "Not helpful"}
                    variant={
                      feedbackDraft?.vote === vote ? "primary" : "secondary"
                    }
                    disabled={chat.sending}
                    onPress={() =>
                      setFeedbackDraft((old) => old && { ...old, vote })
                    }
                  />
                </View>
              ))}
            </View>
            <TextInput
              accessibilityLabel="Optional feedback comment"
              placeholder="Optional comment"
              placeholderTextColor={colors.textMuted}
              value={feedbackDraft?.comment ?? ""}
              multiline
              editable={!chat.sending}
              onChangeText={(comment) =>
                setFeedbackDraft((old) => old && { ...old, comment })
              }
              style={[
                styles.feedbackInput,
                {
                  color: colors.textPrimary,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                },
              ]}
            />
            <Label muted style={styles.small}>
              {[...(feedbackDraft?.comment ?? "")].length} / 1000
            </Label>
            {chat.actionError && (
              <Notice tone="error" message={chat.actionError} />
            )}
            <ActionButton
              label="Save feedback"
              loading={chat.sending}
              disabled={
                !feedbackEnabled ||
                !feedbackDraft?.vote ||
                [...(feedbackDraft?.comment ?? "")].length > 1000
              }
              onPress={() => {
                const current = feedbackDraft;
                if (!current?.vote) return;
                void feedback(
                  current.messageId,
                  current.vote,
                  current.comment,
                ).then((saved) => {
                  if (saved && mounted.current && chat.available())
                    setFeedbackDraft(undefined);
                });
              }}
            />
          </View>
        </View>
      </Modal>
      <Modal
        visible={pickingRecipients}
        transparent
        animationType="slide"
        onRequestClose={() => setPickingRecipients(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.picker,
              { backgroundColor: colors.bg, borderColor: colors.border },
            ]}
          >
            <View style={styles.header}>
              <Label style={styles.heading}>Add recipient</Label>
              <Icon
                label="Close recipients"
                onPress={() => setPickingRecipients(false)}
              >
                <X size={22} color={colors.textPrimary} />
              </Icon>
            </View>
            <ScrollView>
              {liveMembers
                .filter((member) => !recipients.ids.includes(member.id))
                .map((member) => (
                  <Pressable
                    key={member.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Add recipient ${title(member.id, member.name)}`}
                    style={styles.pickerRow}
                    onPress={() => {
                      if (blocked || !chat.available()) return;
                      editRecipients((old) => withAdded(old, member.id));
                      setPickingRecipients(false);
                    }}
                  >
                    <Label>{title(member.id, member.name)}</Label>
                    <Check size={18} color={colors.primaryOnTint} />
                  </Pressable>
                ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </WorkspacePage>
  );
}

function GroupMessage({
  group,
  message,
  title,
  onOpenAgent,
  onDisclosure,
  feedbackEnabled,
  onFeedback,
  onComment,
}: {
  group?: Group;
  message: GroupMessage;
  title: (id: string, fallback: string) => string;
  onOpenAgent?: (id: string) => void;
  onDisclosure: () => void;
  feedbackEnabled: boolean;
  onFeedback: (vote?: "up" | "down") => void;
  onComment: () => void;
}) {
  const { colors } = useTheme();
  const user = message.role === "user";
  if (message.role === "notice")
    return (
      <Label muted selectable style={styles.notice}>
        {message.text}
      </Label>
    );
  const link = (url: string) => {
    const safe = safeAssistantLinkUrl(url);
    if (safe) void WebBrowser.openBrowserAsync(safe).catch(() => undefined);
    return false;
  };
  const rules: RenderRules = {
    ...assistantSelectableMarkdown,
    image: (node) => (
      <Text
        key={node.key}
        style={{ color: colors.primaryOnTint }}
        onPress={() => {
          if (typeof node.attributes.src === "string")
            link(node.attributes.src);
        }}
      >
        {typeof node.attributes.alt === "string" && node.attributes.alt.trim()
          ? node.attributes.alt
          : "Image"}
      </Text>
    ),
  };
  return (
    <View
      style={[
        styles.message,
        user && {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          borderBottomRightRadius: 3,
          borderBottomLeftRadius: 12,
          marginLeft: 38,
          alignSelf: "flex-end",
        },
      ]}
    >
      <Pressable
        accessibilityRole={message.agent && onOpenAgent ? "button" : "text"}
        disabled={!message.agent || !onOpenAgent}
        onPress={() => {
          if (message.agent) onOpenAgent?.(message.agent.id);
        }}
      >
        <Label muted style={styles.small}>
          {user
            ? (message.author?.display_name ?? "You")
            : message.agent
              ? title(message.agent.id, message.agent.name)
              : "Agent"}{" "}
          · {clock(message.created_at)}
        </Label>
      </Pressable>
      {user && !!message.recipient_agent_ids?.length && (
        <Label muted style={styles.small}>
          to{" "}
          {message.recipient_agent_ids
            .map((id) => {
              const member = group?.members.find((row) => row.id === id);
              return member ? title(id, member.name) : "a removed agent";
            })
            .join(", ")}
        </Label>
      )}
      {user ? (
        <Label selectable>{message.text}</Label>
      ) : (
        <Markdown
          markdownit={groupMarkdown}
          mergeStyle
          style={{
            body: {
              color: colors.textPrimary,
              fontSize: 14,
              lineHeight: 23,
              fontFamily: fonts.bodyRegular,
            },
            paragraph: { marginTop: 0, marginBottom: 8 },
            link: { color: colors.primaryOnTint },
            fence: {
              backgroundColor: colors.cardSoft,
              color: colors.textPrimary,
              borderColor: colors.border,
              fontFamily: fonts.mono,
            },
            code_inline: {
              backgroundColor: colors.cardSoft,
              color: colors.textPrimary,
            },
            heading1: { fontSize: 22, color: colors.textPrimary },
            heading2: { fontSize: 18, color: colors.textPrimary },
          }}
          rules={rules}
          onLinkPress={link}
        >
          {message.text}
        </Markdown>
      )}
      {!!message.activities?.length && (
        <AssistantActivityDisclosure
          activities={message.activities}
          onToggle={onDisclosure}
        />
      )}
      {message.attachments?.map((attachment) => (
        <AssistantAttachmentView
          key={attachment.id}
          attachment={attachment}
          groupId={group?.id}
        />
      ))}
      {message.role === "agent" && !!message.text.trim() && (
        <View style={styles.feedbackActions}>
          <AssistantCopyButton text={message.text} />
          {(["up", "down"] as const).map((vote) => (
            <Pressable
              key={vote}
              accessibilityRole="button"
              accessibilityLabel={vote === "up" ? "Helpful" : "Not helpful"}
              accessibilityState={{
                selected: message.feedback?.vote === vote,
                disabled: !feedbackEnabled,
              }}
              disabled={!feedbackEnabled}
              style={[styles.icon, { opacity: feedbackEnabled ? 1 : 0.4 }]}
              onPress={() =>
                onFeedback(message.feedback?.vote === vote ? undefined : vote)
              }
            >
              {vote === "up" ? (
                <ThumbsUp
                  size={17}
                  color={
                    message.feedback?.vote === vote
                      ? colors.primaryOnTint
                      : colors.textMuted
                  }
                />
              ) : (
                <ThumbsDown
                  size={17}
                  color={
                    message.feedback?.vote === vote
                      ? colors.primaryOnTint
                      : colors.textMuted
                  }
                />
              )}
            </Pressable>
          ))}
          <Icon
            label="Add feedback comment"
            disabled={!feedbackEnabled}
            onPress={onComment}
          >
            <MessageSquare size={17} color={colors.textMuted} />
          </Icon>
        </View>
      )}
      {user && <AssistantCopyButton text={message.text} />}
    </View>
  );
}
function clock(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
}
function GroupSeparator() {
  return <View style={{ height: 16 }} />;
}
function Icon({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.icon, { opacity: disabled ? 0.4 : 1 }]}
    >
      {children}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  horizontalStrip: { flexGrow: 0 },
  feedbackActions: { flexDirection: "row", alignItems: "center" },
  feedbackInput: {
    minHeight: 96,
    maxHeight: 180,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontFamily: fonts.bodyRegular,
    textAlignVertical: "top",
  },
  fill: { flex: 1, minWidth: 0 },
  headerIdentity: {
    maxWidth: 220,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { fontFamily: fonts.bodySemi, fontSize: 16 },
  headerSubtitle: { fontFamily: fonts.bodyRegular, fontSize: 10 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  heading: { fontFamily: fonts.displaySemi, fontSize: 18 },
  small: { fontSize: 11, lineHeight: 17 },
  icon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  members: { alignItems: "center", gap: 6 },
  member: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  transcript: { paddingVertical: 8, flexGrow: 1 },
  historyHeader: { marginBottom: 16 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  message: { gap: 6, padding: 12, maxWidth: "100%" },
  notice: { textAlign: "center", fontSize: 11 },
  working: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
  },
  error: { gap: 6 },
  pending: { maxHeight: 180 },
  pendingCard: { padding: 12, gap: 8 },
  actions: { flexDirection: "row", gap: 8 },
  chatPage: { paddingHorizontal: 12, paddingTop: 0, paddingBottom: 4, gap: 8 },
  composerArea: { gap: 6, paddingTop: 4 },
  recipients: { gap: 6, alignItems: "center", paddingHorizontal: 10 },
  recipient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    minHeight: 36,
  },
  addRecipient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 8,
  },
  input: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    minHeight: 44,
    paddingTop: 12,
    paddingBottom: 10,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "#0008",
    justifyContent: "flex-end",
  },
  picker: {
    maxHeight: "60%",
    borderWidth: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    gap: 12,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
  },
});
