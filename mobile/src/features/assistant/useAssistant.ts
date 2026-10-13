import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import NetInfo from "@react-native-community/netinfo";
import { assistantApi, streamAssistantTurn } from "../../lib/api/assistantApi";
import { ApiError } from "../../lib/api/ApiError";
import {
  applyAssistantEvent,
  emptyLiveReply,
  type AssistantLiveReply,
} from "./assistantStream";
import {
  continuationText,
  mergeAssistantHistory,
  needsClientContinuation,
} from "./assistantState";
import type {
  AssistantAcknowledgement,
  AssistantConversation,
  AssistantHistory,
  AssistantModel,
} from "./assistantTypes";

export function useAssistant(initialId?: string, agentId?: string) {
  const focused = useIsFocused();
  const [conversationId, setConversationId] = useState(initialId);
  const [conversations, setConversations] = useState<AssistantConversation[]>(
    [],
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<AssistantHistory>();
  const [models, setModels] = useState<AssistantModel[]>([]);
  const [model, setModel] = useState("nyxagent/chat");
  const [live, setLive] = useState<AssistantLiveReply>();
  const [inputText, setInputText] = useState<string>();
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [deciding, setDeciding] = useState<string>();
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string>();
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [online, setOnline] = useState(true);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const selected = useRef(initialId);
  const latestHistory = useRef<AssistantHistory | undefined>(undefined);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const historySequence = useRef(0);
  const reopenSequence = useRef(0);
  const recoverSequence = useRef(0);
  const indexSequence = useRef(0);
  const streamController = useRef<AbortController | undefined>(undefined);
  const sendLock = useRef(false);
  const decisionLock = useRef(false);
  const lastDecision = useRef(0);
  const previousAgent = useRef(agentId);
  const continuations = useRef(new Map<string, AssistantAcknowledgement[]>());
  const active = focused && foreground && online;
  const activeRef = useRef(active);
  activeRef.current = active;

  const updateHistory = useCallback((value: AssistantHistory | undefined) => {
    latestHistory.current = value;
    setHistory(value);
  }, []);

  const refreshIndex = useCallback(
    async (cursor?: string) => {
      const sequence = ++indexSequence.current;
      if (mounted.current) setLoadingIndex(true);
      try {
        const page = await assistantApi.list(cursor, agentId);
        if (!mounted.current || sequence !== indexSequence.current) return;
        setConversations((previous) => {
          const merged = new Map(
            (cursor ? previous : []).map((row) => [row.id, row]),
          );
          for (const row of page.conversations) merged.set(row.id, row);
          return [...merged.values()].sort((a, b) =>
            b.last_message_at.localeCompare(a.last_message_at),
          );
        });
        setNextCursor(page.next_cursor);
      } finally {
        if (mounted.current && sequence === indexSequence.current)
          setLoadingIndex(false);
      }
    },
    [agentId],
  );

  const refreshHistory = useCallback(
    async (id: string, beforeSeq?: number) => {
      const sequence = ++historySequence.current;
      const page = await assistantApi.history(id, beforeSeq);
      if (
        !mounted.current ||
        id !== selected.current ||
        sequence !== historySequence.current
      )
        return undefined;
      const merged = mergeAssistantHistory(
        latestHistory.current,
        page,
        !!beforeSeq,
      );
      updateHistory(merged);
      setRecoveryRequired(false);
      return merged;
    },
    [updateHistory],
  );

  const openConversation = useCallback(
    (id?: string) => {
      const operation = ++reopenSequence.current;
      if (id && id === selected.current) {
        // React does not rerun the selected-id effect for the same saved chat.
        // Keep its rows and live subscription while explicitly refreshing it.
        const localEpoch = epoch.current;
        setError(undefined);
        setLoading(true);
        void refreshHistory(id)
          .catch((cause) => {
            if (
              mounted.current &&
              selected.current === id &&
              epoch.current === localEpoch &&
              reopenSequence.current === operation
            )
              setError(errorMessage(cause));
          })
          .finally(() => {
            if (
              mounted.current &&
              selected.current === id &&
              epoch.current === localEpoch &&
              reopenSequence.current === operation
            )
              setLoading(false);
          });
        return;
      }
      epoch.current += 1;
      historySequence.current += 1;
      streamController.current?.abort();
      selected.current = id;
      setConversationId(id);
      updateHistory(undefined);
      setLive(undefined);
      setInputText(undefined);
      setError(undefined);
      setRecoveryRequired(false);
      setLoading(!!id);
      setLoadingOlder(false);
    },
    [refreshHistory, updateHistory],
  );

  useEffect(() => {
    const agentChanged = previousAgent.current !== agentId;
    previousAgent.current = agentId;
    if (agentChanged || initialId !== selected.current)
      openConversation(initialId);
  }, [initialId, agentId, openConversation]);

  const recover = useCallback(async () => {
    const recovery = ++recoverSequence.current;
    setError(undefined);
    const id = selected.current;
    const localEpoch = epoch.current;
    const operation = reopenSequence.current;
    try {
      if (id) await refreshHistory(id);
      await refreshIndex();
    } catch (cause) {
      if (
        mounted.current &&
        selected.current === id &&
        epoch.current === localEpoch &&
        reopenSequence.current === operation &&
        recoverSequence.current === recovery
      )
        setError(errorMessage(cause));
    }
  }, [refreshHistory, refreshIndex]);

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    const unsubscribe = NetInfo.addEventListener((state) =>
      setOnline(
        state.isConnected !== false && state.isInternetReachable !== false,
      ),
    );
    return () => {
      mounted.current = false;
      epoch.current += 1;
      streamController.current?.abort();
      subscription.remove();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!active) {
      streamController.current?.abort();
      return;
    }
    let current = true;
    void recover();
    void assistantApi
      .models()
      .then((value) => {
        if (current && mounted.current) setModels(value);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [active, recover]);

  useEffect(() => {
    if (!conversationId || !active) return;
    let current = true;
    const operation = ++reopenSequence.current;
    const localEpoch = epoch.current;
    setLoading(true);
    void refreshHistory(conversationId)
      .catch((cause) => {
        if (
          current &&
          mounted.current &&
          selected.current === conversationId &&
          epoch.current === localEpoch &&
          reopenSequence.current === operation
        )
          setError(errorMessage(cause));
      })
      .finally(() => {
        if (
          current &&
          mounted.current &&
          selected.current === conversationId &&
          epoch.current === localEpoch &&
          reopenSequence.current === operation
        )
          setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [conversationId, active, refreshHistory]);

  const needsPolling =
    !!history?.conversation.active_turn ||
    !!history?.acknowledgements.some((row) => row.status === "pending") ||
    !!history?.approvals.length ||
    !!history?.waiting.length ||
    sending;
  useEffect(() => {
    if (!active || !conversationId || !needsPolling || loadingOlder) return;
    let polling = false;
    const interval = setInterval(() => {
      if (polling) return;
      polling = true;
      void refreshHistory(conversationId)
        .catch(() => undefined)
        .finally(() => {
          polling = false;
        });
    }, 2000);
    return () => clearInterval(interval);
  }, [active, conversationId, needsPolling, loadingOlder, refreshHistory]);

  const send = useCallback(
    async (text: string, retryOf?: string) => {
      if (sendLock.current) throw new Error("A message is already being sent.");
      if (!activeRef.current) throw new Error("Reconnect to send a message.");
      if (recoveryRequired)
        throw new Error("Refresh or open the saved chat before sending again.");
      if (selected.current && !latestHistory.current)
        throw new Error("Wait for this chat's saved history to load.");
      if (latestHistory.current?.conversation.active_turn)
        throw new Error(
          "The assistant is still working. Stop it or wait for completion.",
        );
      if (latestHistory.current?.conversation.agent?.destroyed)
        throw new Error(
          "This agent was destroyed. Its conversation is read-only.",
        );
      const localEpoch = epoch.current;
      const controller = new AbortController();
      streamController.current = controller;
      sendLock.current = true;
      setSending(true);
      setError(undefined);
      setInputText(text);
      let reply = emptyLiveReply();
      let id = selected.current;
      if (id) reply.conversationId = id;
      setLive(reply);
      let keepDraft = false;
      try {
        await streamAssistantTurn(
          { conversationId: id, agentId, model, text, retryOf },
          (event) => {
            if (!mounted.current || epoch.current !== localEpoch) return;
            reply = applyAssistantEvent(reply, event);
            if (event.event === "turn.status") {
              id = event.conversation_id;
              selected.current = id;
              setConversationId(id);
            } else if (!reply.conversationId) {
              throw new Error("Assistant did not identify the conversation.");
            }
            setLive(reply);
          },
          controller,
        );
      } catch (cause) {
        if (mounted.current && epoch.current === localEpoch) {
          // An explicit pre-admission client error can safely leave its text editable.
          const refused =
            cause instanceof ApiError &&
            cause.statusCode >= 400 &&
            cause.statusCode < 500;
          keepDraft = refused;
          setRecoveryRequired(!refused);
          setError(
            refused
              ? errorMessage(cause)
              : "Connection interrupted. The assistant may still be working. Refresh or open its history before sending again.",
          );
        }
      } finally {
        if (streamController.current === controller)
          streamController.current = undefined;
        sendLock.current = false;
        if (mounted.current && epoch.current === localEpoch) {
          if (id) await refreshHistory(id).catch(() => undefined);
          await refreshIndex().catch(() => undefined);
          if (mounted.current && epoch.current === localEpoch) {
            setSending(false);
            setLive(undefined);
            setInputText(undefined);
          }
        } else if (mounted.current) {
          setSending(false);
        }
      }
      return !keepDraft;
    },
    [agentId, model, recoveryRequired, refreshHistory, refreshIndex],
  );

  useEffect(() => {
    const id = conversationId;
    if (
      !active ||
      !id ||
      sending ||
      loadingOlder ||
      history?.conversation.active_turn ||
      !history
    )
      return;
    const queued = continuations.current.get(id);
    if (!queued?.length) return;
    continuations.current.delete(id);
    if (history.messages.at(-1)?.error_code === "cancelled") return;
    void send(queued.map(continuationText).join("\n")).catch((cause) =>
      setError(errorMessage(cause)),
    );
  }, [active, conversationId, history, sending, loadingOlder, send]);

  async function decide(acknowledgementId: string, choice: "allow" | "deny") {
    const id = selected.current;
    if (!id || decisionLock.current) return;
    if (Date.now() - lastDecision.current < 750)
      throw new Error("Please wait a moment before deciding again.");
    lastDecision.current = Date.now();
    decisionLock.current = true;
    setDeciding(acknowledgementId);
    setError(undefined);
    try {
      const row = await assistantApi.decide(id, acknowledgementId, choice);
      if (!mounted.current || selected.current !== id) return;
      historySequence.current += 1;
      if (choice === "allow" && needsClientContinuation(row)) {
        continuations.current.set(id, [
          ...(continuations.current.get(id) ?? []),
          row,
        ]);
      }
      await refreshHistory(id);
      await refreshIndex();
    } catch (cause) {
      if (mounted.current && selected.current === id)
        setError(errorMessage(cause));
    } finally {
      decisionLock.current = false;
      if (mounted.current) setDeciding(undefined);
    }
  }

  async function stop() {
    const id = selected.current;
    if (!id || mutating) return;
    continuations.current.delete(id);
    setMutating(true);
    try {
      await assistantApi.stop(id);
      if (mounted.current && selected.current === id) await refreshHistory(id);
    } catch (cause) {
      if (mounted.current && selected.current === id)
        setError(errorMessage(cause));
    } finally {
      if (mounted.current) setMutating(false);
    }
  }

  async function rename(title: string) {
    const id = selected.current;
    if (!id || mutating) return false;
    setMutating(true);
    setError(undefined);
    try {
      await assistantApi.rename(id, title);
      if (mounted.current && selected.current === id) {
        historySequence.current += 1;
        await refreshHistory(id);
        await refreshIndex();
      }
      return true;
    } catch (cause) {
      if (mounted.current && selected.current === id)
        setError(errorMessage(cause));
      return false;
    } finally {
      if (mounted.current) setMutating(false);
    }
  }

  async function remove() {
    const id = selected.current;
    if (!id || mutating) return;
    setMutating(true);
    setError(undefined);
    try {
      await assistantApi.delete(id);
      if (mounted.current && selected.current === id) {
        continuations.current.delete(id);
        openConversation();
        await refreshIndex();
      }
      return true;
    } catch (cause) {
      if (mounted.current && selected.current === id)
        setError(errorMessage(cause));
      return false;
    } finally {
      if (mounted.current) setMutating(false);
    }
  }

  async function loadOlder() {
    const id = selected.current;
    const before = latestHistory.current?.before_seq;
    if (!id || !before || loadingOlder) return;
    const localEpoch = epoch.current;
    const operation = reopenSequence.current;
    setLoadingOlder(true);
    try {
      await refreshHistory(id, before);
    } catch (cause) {
      if (
        mounted.current &&
        selected.current === id &&
        epoch.current === localEpoch &&
        reopenSequence.current === operation
      )
        setError(errorMessage(cause));
    } finally {
      if (
        mounted.current &&
        selected.current === id &&
        epoch.current === localEpoch
      )
        setLoadingOlder(false);
    }
  }

  return {
    conversationId,
    conversations,
    history,
    models,
    model,
    setModel,
    live,
    inputText,
    sending,
    loading,
    loadingOlder,
    loadingIndex,
    deciding,
    mutating,
    error,
    online,
    recoveryRequired,
    openConversation,
    recover,
    send,
    decide,
    stop,
    rename,
    remove,
    loadOlder,
    loadMoreConversations: () =>
      nextCursor
        ? refreshIndex(nextCursor).catch((cause) =>
            setError(errorMessage(cause)),
          )
        : Promise.resolve(),
    hasMoreConversations: !!nextCursor,
  };
}

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.errorKey === "turn_active")
    return "The assistant is already working on this chat. Refresh its history.";
  if (cause instanceof ApiError && cause.statusCode === 404)
    return "This chat is unavailable, or Assistant is not enabled for your account.";
  return cause instanceof Error
    ? cause.message
    : "Could not reach the assistant. Try again.";
}
