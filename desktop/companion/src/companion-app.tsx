import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";

import { ChatPanel, type CompanionChatMessage } from "./components/chat-panel";
import { IdleView } from "./components/idle-view";
import type { MascotState } from "./components/mascot";
import { OnboardingPanel } from "./components/onboarding-panel";
import { SettingsPanel } from "./components/settings-panel";
import { VoicePanel } from "./components/voice-panel";
import type { CompanionSnapshot } from "./domain";
import {
  createCompanionRuntime,
  isTauriHost,
  NyxIdChatSendError,
  nyxIdChatRecoveryDelayMs,
  type CompanionRuntime,
  type NyxIdChatEvent,
  type NyxIdChatHistory,
  type NyxIdChatRecovery,
  type NyxIdView,
  type Unlisten,
  type WindowDragEvent,
} from "./runtime";

type Screen = "idle" | "chat" | "voice" | "settings";

interface CompanionAppProps {
  readonly runtime?: CompanionRuntime;
}

type ChatListenerState =
  | { readonly status: "connecting" | "ready" }
  | { readonly status: "failed"; readonly message: string };

interface ActiveChatTurn {
  readonly requestId: string;
  readonly generation: number;
  conversationId?: string;
  recovery?: Promise<void>;
}

let sharedRuntime: CompanionRuntime | undefined;

const WINDOW_DRAG_HANDLE_SELECTOR = "[data-window-drag-handle]";
const WINDOW_DRAG_CONTROL_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "label",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='button']",
  "[role='checkbox']",
  "[role='link']",
  "[role='menuitem']",
  "[role='radio']",
  "[role='slider']",
  "[role='spinbutton']",
  "[role='switch']",
  "[role='tab']",
  "[role='textbox']",
  "[data-window-drag-exclude]",
].join(",");

function isWindowDragPointer(event: PointerEvent<HTMLDivElement>): boolean {
  if (event.button !== 0 || !event.isPrimary) return false;
  if (!(event.target instanceof Element)) return false;

  const handle = event.target.closest(WINDOW_DRAG_HANDLE_SELECTOR);
  if (!handle || !event.currentTarget.contains(handle)) return false;
  return !event.target.closest(WINDOW_DRAG_CONTROL_SELECTOR);
}

function defaultRuntime(): CompanionRuntime {
  sharedRuntime ??= createCompanionRuntime();
  return sharedRuntime;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生了意外，请稍后再试";
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function messagesFromHistory(
  history: NyxIdChatHistory,
): CompanionChatMessage[] {
  return history.messages
    .filter(
      (message): message is typeof message & { role: "user" | "assistant" } =>
        message.role === "user" || message.role === "assistant",
    )
    .map((message) => {
      const cancelledAssistant =
        message.role === "assistant" && message.errorCode === "cancelled";
      const failedAssistant =
        message.role === "assistant" &&
        message.status === "failed" &&
        !cancelledAssistant;
      return {
        id: message.id,
        role: message.role,
        text:
          message.text ||
          (cancelledAssistant || failedAssistant
            ? ""
            : message.status === "failed"
              ? "这次处理没有完成"
              : "处理完成"),
        ...(cancelledAssistant
          ? {
              terminalStatus: "cancelled" as const,
              terminalMessage: "这次处理已经停止",
            }
          : failedAssistant
            ? {
                terminalStatus: "failed" as const,
                terminalMessage: "这次处理没有完成",
              }
            : {}),
      };
    });
}

function messagesFromActiveHistory(
  recovery: NyxIdChatRecovery,
): CompanionChatMessage[] {
  const messages = messagesFromHistory(recovery.history);
  const last = messages.at(-1);
  if (last?.role === "assistant" && !last.terminalStatus) {
    return messages.map((message, index) =>
      index === messages.length - 1 ? { ...message, pending: true } : message,
    );
  }
  return [
    ...messages,
    {
      id: recovery.requestId,
      role: "assistant",
      text: "",
      pending: true,
    },
  ];
}

function historyOutcome(history: NyxIdChatHistory): MascotState {
  const lastMessage = history.messages.at(-1);
  if (lastMessage?.errorCode === "cancelled") return "idle";
  return lastMessage?.status === "failed" ? "failed" : "review";
}

export function CompanionApp({ runtime: suppliedRuntime }: CompanionAppProps) {
  const runtime = useMemo(
    () => suppliedRuntime ?? defaultRuntime(),
    [suppliedRuntime],
  );
  const [snapshot, setSnapshot] = useState<CompanionSnapshot>();
  const [nyxIdView, setNyxIdView] = useState<NyxIdView>({
    state: "checking",
  });
  const [screen, setScreen] = useState<Screen>("idle");
  const [chatMessages, setChatMessages] = useState<CompanionChatMessage[]>([]);
  const [chatConversationId, setChatConversationId] = useState<string>();
  const [chatPending, setChatPending] = useState(false);
  const [voiceHistoryId, setVoiceHistoryId] = useState<string>();
  const [voiceRequestIds, setVoiceRequestIds] = useState<string[]>([]);
  const [voicePendingRequestIds, setVoicePendingRequestIds] = useState<
    string[]
  >([]);
  const [voiceWorkPending, setVoiceWorkPending] = useState(false);
  const [chatStopping, setChatStopping] = useState(false);
  const [chatRecovering, setChatRecovering] = useState(false);
  const [chatOutcome, setChatOutcome] = useState<MascotState>();
  const [chatListener, setChatListener] = useState<ChatListenerState>({
    status: "connecting",
  });
  const [chatListenerRevision, setChatListenerRevision] = useState(0);
  const [chatOwnerKey, setChatOwnerKey] = useState("signed-out");
  const [windowDragEvent, setWindowDragEvent] = useState<WindowDragEvent>();
  const [launchAtLogin, setLaunchAtLoginState] = useState(false);
  const [status, setStatus] = useState<string>();
  const [fatalError, setFatalError] = useState<string>();
  const chatGeneration = useRef(0);
  const activeChatTurn = useRef<ActiveChatTurn>();
  const chatConversationIdRef = useRef<string>();
  const chatOwnerId = useRef<string>();

  const resetChat = useCallback(() => {
    chatGeneration.current += 1;
    activeChatTurn.current = undefined;
    chatConversationIdRef.current = undefined;
    setChatConversationId(undefined);
    setChatMessages([]);
    setVoiceHistoryId(undefined);
    setVoiceRequestIds([]);
    setVoicePendingRequestIds([]);
    setVoiceWorkPending(false);
    setChatPending(false);
    setChatStopping(false);
    setChatRecovering(false);
    setChatOutcome(undefined);
  }, []);

  const applyNyxIdView = useCallback(
    (next: NyxIdView) => {
      if (next.state === "connected") {
        if (chatOwnerId.current !== next.user.id) {
          chatOwnerId.current = next.user.id;
          setChatOwnerKey(next.user.id);
          resetChat();
        }
      } else if (next.state !== "checking" && next.state !== "error") {
        if (chatOwnerId.current !== undefined) {
          chatOwnerId.current = undefined;
          setChatOwnerKey("signed-out");
          resetChat();
        }
      }
      setNyxIdView(next);
    },
    [resetChat],
  );

  const ownsChatTurn = useCallback((turn: ActiveChatTurn): boolean => {
    return (
      activeChatTurn.current === turn &&
      chatGeneration.current === turn.generation
    );
  }, []);

  const finishChatFromHistory = useCallback(
    (turn: ActiveChatTurn, history: NyxIdChatHistory): void => {
      if (history.conversation.activeTurn || !ownsChatTurn(turn)) return;
      chatConversationIdRef.current = history.conversation.id;
      setChatConversationId(history.conversation.id);
      setChatMessages(messagesFromHistory(history));
      setChatPending(false);
      setChatStopping(false);
      setChatRecovering(false);
      setChatOutcome(historyOutcome(history));
      activeChatTurn.current = undefined;
    },
    [ownsChatTurn],
  );

  const finishChatFromEvent = useCallback(
    (
      turn: ActiveChatTurn,
      event: Extract<NyxIdChatEvent, { kind: "completed" }>,
    ): void => {
      if (!ownsChatTurn(turn)) return;
      chatConversationIdRef.current = event.conversationId;
      setChatConversationId(event.conversationId);
      setChatPending(false);
      setChatStopping(false);
      setChatRecovering(false);
      setChatOutcome(
        event.status === "failed"
          ? "failed"
          : event.status === "cancelled"
            ? "idle"
            : "review",
      );
      setChatMessages((current) =>
        current.map((message) => {
          if (message.id !== event.requestId || message.role !== "assistant") {
            return message;
          }
          if (event.status === "failed") {
            return {
              ...message,
              pending: false,
              terminalStatus: "failed" as const,
              terminalMessage: event.error?.message || "这次处理没有完成",
            };
          }
          if (event.status === "cancelled") {
            return {
              ...message,
              pending: false,
              terminalStatus: "cancelled" as const,
              terminalMessage: "这次处理已经停止",
            };
          }
          return {
            ...message,
            pending: false,
            text: message.text || "处理完成",
          };
        }),
      );
      activeChatTurn.current = undefined;
    },
    [ownsChatTurn],
  );

  useEffect(() => {
    let alive = true;
    const unlisteners: Unlisten[] = [];

    async function boot() {
      let receivedLiveState = false;
      try {
        const stateUnlisten = await runtime.onStateChanged((next) => {
          if (!alive) return;
          receivedLiveState = true;
          setSnapshot(next);
        });
        if (!alive) {
          await stateUnlisten();
          return;
        }
        unlisteners.push(stateUnlisten);

        const initialSnapshot = await runtime.snapshot();
        let initialLaunchAtLogin = false;
        try {
          initialLaunchAtLogin = await runtime.getLaunchAtLogin();
        } catch {
          initialLaunchAtLogin = false;
        }
        if (!alive) return;
        setLaunchAtLoginState(initialLaunchAtLogin);
        if (!receivedLiveState) {
          setSnapshot(initialSnapshot);
        }
        setFatalError(undefined);
      } catch (error) {
        if (alive) setFatalError(errorMessage(error));
      }
    }

    void boot();
    return () => {
      alive = false;
      for (const unlisten of unlisteners) {
        void unlisten();
      }
    };
  }, [runtime]);

  useEffect(() => {
    let alive = true;
    let unlisten: Unlisten | undefined;
    setChatListener({ status: "connecting" });

    function applyChatEvent(event: NyxIdChatEvent) {
      const turn = activeChatTurn.current;
      if (!alive || !turn || event.requestId !== turn.requestId) return;
      if (event.kind === "started") {
        turn.conversationId = event.conversationId;
        chatConversationIdRef.current = event.conversationId;
        setChatConversationId(event.conversationId);
        return;
      }
      if (event.kind === "delta") {
        setChatMessages((current) =>
          current.map((message) =>
            message.id === event.requestId && message.role === "assistant"
              ? { ...message, text: message.text + event.text }
              : message,
          ),
        );
        return;
      }
      if (event.kind === "snapshot") {
        setChatMessages((current) =>
          current.map((message) =>
            message.id === event.requestId && message.role === "assistant"
              ? { ...message, text: event.text }
              : message,
          ),
        );
        return;
      }
      finishChatFromEvent(turn, event);
    }

    async function subscribe() {
      try {
        unlisten = await runtime.onNyxIdChatEvent(applyChatEvent);
        if (!alive) {
          await unlisten();
          return;
        }
        setChatListener({ status: "ready" });
      } catch (error) {
        if (alive) {
          setChatListener({
            status: "failed",
            message: errorMessage(error),
          });
        }
      }
    }

    void subscribe();
    return () => {
      alive = false;
      if (unlisten) void unlisten();
    };
  }, [chatListenerRevision, finishChatFromEvent, runtime]);

  useEffect(() => {
    let alive = true;
    let receivedLiveState = false;
    let unlisten: Unlisten | undefined;

    async function bootNyxId() {
      try {
        unlisten = await runtime.onNyxidChanged((next) => {
          if (!alive) return;
          receivedLiveState = true;
          applyNyxIdView(next);
        });
        if (!alive) {
          await unlisten();
          return;
        }

        const initial = await runtime.nyxidStatus();
        if (alive && !receivedLiveState) {
          applyNyxIdView(initial);
        }
      } catch (error) {
        if (alive) {
          applyNyxIdView({
            state: "error",
            error: {
              code: "status_unavailable",
              message: errorMessage(error),
              retryable: true,
              retryAction: "refresh",
            },
          });
        }
      }
    }

    void bootNyxId();
    return () => {
      alive = false;
      if (unlisten) void unlisten();
    };
  }, [applyNyxIdView, runtime]);

  useEffect(() => {
    let alive = true;
    let unlisten: Unlisten | undefined;

    void runtime
      .onWindowDrag((event) => {
        if (alive) setWindowDragEvent(event);
      })
      .then((cleanup) => {
        if (!alive) {
          void cleanup();
          return;
        }
        unlisten = cleanup;
      })
      .catch(() => undefined);

    return () => {
      alive = false;
      if (unlisten) void unlisten();
    };
  }, [runtime]);

  useEffect(
    () => () => {
      chatGeneration.current += 1;
      activeChatTurn.current = undefined;
    },
    [],
  );

  useEffect(() => {
    if (!snapshot) return;
    const expanded = !snapshot.settings.onboardingComplete || screen !== "idle";
    void runtime
      .setWindowMode(expanded ? "expanded" : "compact")
      .catch((error) => {
        setStatus(`窗口调整失败：${errorMessage(error)}`);
      });
  }, [runtime, screen, snapshot]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(undefined), 2_800);
    return () => window.clearTimeout(timer);
  }, [status]);

  const finishChatNotAdmitted = useCallback(
    (turn: ActiveChatTurn): void => {
      if (!ownsChatTurn(turn)) return;
      setChatMessages((current) =>
        current.map((message) =>
          message.id === turn.requestId && message.role === "assistant"
            ? {
                ...message,
                pending: false,
                terminalStatus: "failed" as const,
                terminalMessage: "NyxID 没有受理这条消息，请重新发送。",
              }
            : message,
        ),
      );
      setChatPending(false);
      setChatStopping(false);
      setChatRecovering(false);
      setChatOutcome("failed");
      activeChatTurn.current = undefined;
    },
    [ownsChatTurn],
  );

  const recoverAdmission = useCallback(
    async (turn: ActiveChatTurn): Promise<void> => {
      setChatRecovering(true);
      let recoveryAttempt = 0;

      while (ownsChatTurn(turn)) {
        try {
          const recovery = await runtime.recoverNyxIdChat();
          if (!ownsChatTurn(turn)) return;
          if (!recovery) {
            finishChatNotAdmitted(turn);
            return;
          }
          if (recovery.requestId !== turn.requestId) {
            throw new Error("NyxID 返回了其他消息的受理记录");
          }
          turn.conversationId = recovery.history.conversation.id;
          chatConversationIdRef.current = recovery.history.conversation.id;
          setChatConversationId(recovery.history.conversation.id);
          if (!recovery.history.conversation.activeTurn) {
            finishChatFromHistory(turn, recovery.history);
            return;
          }
          setChatMessages(messagesFromActiveHistory(recovery));
          setChatPending(true);
          setChatRecovering(true);
        } catch {
          if (!ownsChatTurn(turn)) return;
        }
        await wait(nyxIdChatRecoveryDelayMs(recoveryAttempt));
        recoveryAttempt += 1;
      }
    },
    [finishChatFromHistory, finishChatNotAdmitted, ownsChatTurn, runtime],
  );

  const ensureChatRecovery = useCallback(
    (turn: ActiveChatTurn): Promise<void> => {
      if (turn.recovery) return turn.recovery;
      const recovery = recoverAdmission(turn);
      turn.recovery = recovery;
      void recovery.finally(() => {
        if (turn.recovery === recovery) turn.recovery = undefined;
      });
      return recovery;
    },
    [recoverAdmission],
  );

  const connectedChatOwnerId =
    nyxIdView.state === "connected" ? nyxIdView.user.id : undefined;

  useEffect(() => {
    if (
      chatListener.status !== "ready" ||
      !connectedChatOwnerId ||
      activeChatTurn.current
    ) {
      return;
    }

    let alive = true;
    const ownerUserId = connectedChatOwnerId;
    const generation = chatGeneration.current + 1;
    chatGeneration.current = generation;
    setChatRecovering(true);

    function stillCurrent(): boolean {
      return (
        alive &&
        chatGeneration.current === generation &&
        chatOwnerId.current === ownerUserId
      );
    }

    async function restorePendingChat() {
      let recoveryAttempt = 0;
      while (stillCurrent() && !activeChatTurn.current) {
        try {
          const recovery = await runtime.recoverNyxIdChat();
          if (!stillCurrent() || activeChatTurn.current) return;
          if (!recovery) {
            setChatRecovering(false);
            return;
          }

          const turn: ActiveChatTurn = {
            requestId: recovery.requestId,
            generation,
            conversationId: recovery.history.conversation.id,
          };
          activeChatTurn.current = turn;
          chatConversationIdRef.current = recovery.history.conversation.id;
          setChatConversationId(recovery.history.conversation.id);
          setChatStopping(false);
          setChatOutcome(undefined);
          if (recovery.history.conversation.activeTurn) {
            setChatMessages(messagesFromActiveHistory(recovery));
            setChatPending(true);
            setChatRecovering(true);
            void ensureChatRecovery(turn);
          } else {
            finishChatFromHistory(turn, recovery.history);
          }
          return;
        } catch {
          if (!stillCurrent() || activeChatTurn.current) return;
        }
        await wait(nyxIdChatRecoveryDelayMs(recoveryAttempt));
        recoveryAttempt += 1;
      }
    }

    void restorePendingChat();
    return () => {
      alive = false;
    };
  }, [
    chatListener.status,
    chatOwnerKey,
    connectedChatOwnerId,
    ensureChatRecovery,
    finishChatFromHistory,
    runtime,
  ]);

  useEffect(() => {
    if (!voiceHistoryId || !connectedChatOwnerId) return;
    let alive = true;
    let timer: number | undefined;
    const id = voiceHistoryId;
    const owner = connectedChatOwnerId;
    const requests = new Set(voiceRequestIds);
    const settledRequests = new Set<string>();
    // The server may finalize a last utterance during media shutdown.
    let quietUntil = Date.now() + 6000;
    function discoverRequests(history: NyxIdChatHistory) {
      for (const entry of history.messages) {
        if (
          entry.requestId &&
          entry.executionPending &&
          !settledRequests.has(entry.requestId) &&
          !requests.has(entry.requestId)
        ) {
          requests.add(entry.requestId);
          quietUntil = Date.now() + 6000;
        }
      }
    }
    async function refreshVoiceHistory() {
      try {
        let history = await runtime.nyxIdChatHistory(id);
        if (!alive || chatOwnerId.current !== owner) return;
        discoverRequests(history);
        const states = await Promise.all(
          [...requests].map((requestId) =>
            runtime.nyxIdVoiceRequest(id, requestId),
          ),
        );
        if (!alive || chatOwnerId.current !== owner) return;
        const pending = states.filter(
          (request) =>
            request.state !== "completed" && request.state !== "cancelled",
        );
        const awaitingPublication = states.some(
          (request) =>
            request.state === "completed" &&
            !request.result_message_id &&
            !history.messages.some(
              (entry) =>
                entry.role === "assistant" && entry.turnId === request.turn_id,
            ),
        );
        if (
          pending.length === 0 &&
          !awaitingPublication &&
          Date.now() >= quietUntil
        ) {
          // Publication may have committed after the first history read. Read
          // once more before returning control to the composer.
          history = await runtime.nyxIdChatHistory(id);
          if (!alive || chatOwnerId.current !== owner) return;
          discoverRequests(history);
        }
        for (const request of states) {
          if (
            request.state === "cancelled" ||
            (request.state === "completed" &&
              (request.result_message_id ||
                history.messages.some(
                  (entry) =>
                    entry.role === "assistant" &&
                    entry.turnId === request.turn_id,
                )))
          ) {
            requests.delete(request.id);
            settledRequests.add(request.id);
          }
        }
        const pendingIds = [
          ...pending.map((request) => request.id),
          ...[...requests].filter(
            (requestId) => !states.some((request) => request.id === requestId),
          ),
        ];
        setChatMessages(messagesFromHistory(history));
        setVoicePendingRequestIds(pendingIds);
        setVoiceWorkPending(
          pendingIds.length > 0 ||
            awaitingPublication ||
            Date.now() < quietUntil,
        );
        if (
          pendingIds.length === 0 &&
          !awaitingPublication &&
          Date.now() >= quietUntil
        ) {
          setVoiceHistoryId(undefined);
          setChatOutcome(historyOutcome(history));
          return;
        }
      } catch {
        if (!alive) return;
      }
      if (alive)
        timer = window.setTimeout(() => void refreshVoiceHistory(), 2000);
    }
    void refreshVoiceHistory();
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [connectedChatOwnerId, runtime, voiceHistoryId, voiceRequestIds]);

  function adoptVoiceConversation(id: string) {
    chatConversationIdRef.current = id;
    setChatConversationId(id);
  }

  function returnFromVoice(id?: string, requestIds: string[] = []) {
    setScreen("chat");
    if (id && nyxIdView.state === "connected") {
      adoptVoiceConversation(id);
      setVoiceWorkPending(true);
      setVoiceRequestIds(requestIds);
      setVoicePendingRequestIds(requestIds);
      setVoiceHistoryId(id);
    }
  }

  async function sendChat(text: string): Promise<void> {
    if (
      activeChatTurn.current ||
      chatPending ||
      voiceWorkPending ||
      chatRecovering ||
      chatListener.status !== "ready" ||
      nyxIdView.state !== "connected"
    ) {
      return;
    }
    const requestId = crypto.randomUUID();
    const generation = chatGeneration.current + 1;
    chatGeneration.current = generation;
    const turn: ActiveChatTurn = {
      requestId,
      generation,
      ...(chatConversationIdRef.current
        ? { conversationId: chatConversationIdRef.current }
        : {}),
    };
    activeChatTurn.current = turn;
    setChatPending(true);
    setChatStopping(false);
    setChatRecovering(false);
    setChatOutcome(undefined);
    setChatMessages((current) => [
      ...current,
      { id: `${requestId}:user`, role: "user", text },
      { id: requestId, role: "assistant", text: "", pending: true },
    ]);
    try {
      const completed = await runtime.sendNyxIdChat({
        requestId,
        ...(turn.conversationId ? { conversationId: turn.conversationId } : {}),
        text,
      });
      if (!ownsChatTurn(turn)) return;
      finishChatFromEvent(turn, completed);
    } catch (error) {
      if (!ownsChatTurn(turn)) return;
      if (error instanceof NyxIdChatSendError && error.kind === "rejected") {
        setChatMessages((current) =>
          current.map((entry) =>
            entry.id === requestId
              ? {
                  ...entry,
                  pending: false,
                  terminalStatus: "failed" as const,
                  terminalMessage: error.message,
                }
              : entry,
          ),
        );
        setChatPending(false);
        setChatStopping(false);
        setChatRecovering(false);
        setChatOutcome("failed");
        activeChatTurn.current = undefined;
        return;
      }
      setChatRecovering(true);
      setChatMessages((current) =>
        current.map((entry) =>
          entry.id === requestId
            ? {
                ...entry,
                pending: true,
                text:
                  entry.text ||
                  (error instanceof NyxIdChatSendError
                    ? error.message
                    : `${errorMessage(error)} 执行状态无法确认，请不要重复发送。`),
              }
            : entry,
        ),
      );
      await ensureChatRecovery(turn);
    }
  }

  async function stopChat(): Promise<void> {
    if (voiceWorkPending && voiceHistoryId && !chatStopping) {
      setChatStopping(true);
      try {
        await Promise.all(
          voicePendingRequestIds.map((id) =>
            runtime.cancelNyxIdVoiceRequest(voiceHistoryId, id),
          ),
        );
      } catch (error) {
        setStatus(`停止失败：${errorMessage(error)}`);
      } finally {
        setChatStopping(false);
      }
      return;
    }
    const turn = activeChatTurn.current;
    const conversationId = turn?.conversationId;
    if (!chatPending || !turn || !conversationId || chatStopping) return;
    setChatStopping(true);
    try {
      await runtime.stopNyxIdChat(conversationId);
      if (!ownsChatTurn(turn)) return;
      await ensureChatRecovery(turn);
    } catch (error) {
      if (ownsChatTurn(turn)) {
        setStatus(`停止失败：${errorMessage(error)}`);
      }
    } finally {
      if (ownsChatTurn(turn)) setChatStopping(false);
    }
  }

  if (fatalError) {
    return (
      <main className="app-error" role="alert">
        <div>
          <strong>Nyx 暂时没有醒来</strong>
          <p>{fatalError}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => window.location.reload()}
          >
            再试一次
          </button>
        </div>
      </main>
    );
  }

  if (!snapshot) {
    return <main className="app-loading">Nyx 正在醒来…</main>;
  }

  let content;
  if (!snapshot.settings.onboardingComplete) {
    content = (
      <OnboardingPanel
        initialSettings={snapshot.settings}
        onComplete={async (settings) => {
          const next = await runtime.saveSettings(settings);
          setSnapshot(next);
          setScreen("idle");
        }}
      />
    );
  } else if (screen === "voice") {
    content = (
      <VoicePanel
        key={chatOwnerKey}
        companionName={snapshot.settings.companionName}
        bridge={runtime}
        nyxIdView={nyxIdView}
        conversationId={chatConversationId}
        onConversationReady={adoptVoiceConversation}
        onBack={returnFromVoice}
        onConnect={async () => {
          applyNyxIdView(await runtime.startNyxidLogin());
        }}
      />
    );
  } else if (screen === "chat") {
    content = (
      <ChatPanel
        key={chatOwnerKey}
        companionName={snapshot.settings.companionName}
        messages={chatMessages}
        nyxIdView={nyxIdView}
        pending={chatPending || voiceWorkPending}
        stopping={chatStopping}
        recovering={chatRecovering}
        listenerState={chatListener}
        canStop={
          (chatPending && Boolean(chatConversationId)) ||
          voicePendingRequestIds.length > 0
        }
        onBack={() => setScreen("idle")}
        onConnect={async () => {
          applyNyxIdView(await runtime.startNyxidLogin());
        }}
        onNewConversation={() => {
          if (!activeChatTurn.current && !voiceWorkPending) resetChat();
        }}
        onOpenSettings={() => setScreen("settings")}
        onVoice={() => setScreen("voice")}
        onRetryListener={() => {
          setChatListenerRevision((current) => current + 1);
        }}
        onSend={sendChat}
        onStop={stopChat}
      />
    );
  } else if (screen === "settings") {
    content = (
      <SettingsPanel
        settings={snapshot.settings}
        launchAtLogin={launchAtLogin}
        nyxIdView={nyxIdView}
        onClose={() => setScreen("idle")}
        onSave={async (settings) => {
          const next = await runtime.saveSettings(settings);
          setSnapshot(next);
          setStatus("设置已经记住了");
          return next.settings;
        }}
        onSetLaunchAtLogin={async (enabled) => {
          const actual = await runtime.setLaunchAtLogin(enabled);
          setLaunchAtLoginState(actual);
        }}
        onConnectNyxId={async () => {
          applyNyxIdView(await runtime.startNyxidLogin());
        }}
        onCancelNyxId={async () => {
          applyNyxIdView(await runtime.cancelNyxidLogin());
        }}
        onRefreshNyxId={async () => {
          applyNyxIdView(await runtime.refreshNyxidCapabilities());
        }}
        onLogoutNyxId={async () => {
          applyNyxIdView(await runtime.logoutNyxid());
        }}
        onOpenNyxIdAssistant={() => runtime.openNyxidAssistant()}
      />
    );
  } else {
    content = (
      <IdleView
        name={snapshot.settings.companionName}
        statusText={
          nyxIdView.state === "connected"
            ? "随时和 NyxID 说话"
            : "连接 NyxID，开始对话"
        }
        mascotState={chatPending ? "running" : chatOutcome}
        dragEvent={windowDragEvent}
        onOpen={() => {
          setChatOutcome(undefined);
          setScreen("chat");
        }}
        onSettings={() => setScreen("settings")}
        onVoice={() =>
          setScreen(
            chatPending || chatRecovering || voiceWorkPending
              ? "chat"
              : "voice",
          )
        }
        onStartDrag={() => runtime.startWindowDrag()}
      />
    );
  }

  const expanded = !snapshot.settings.onboardingComplete || screen !== "idle";
  return (
    <div
      className={`app-frame${expanded ? " app-frame--expanded" : ""}${isTauriHost() ? "" : " app-frame--browser"}`}
      onPointerDown={(event) => {
        if (!isWindowDragPointer(event)) return;
        void runtime.startWindowDrag().catch(() => undefined);
      }}
    >
      {content}
      {status ? (
        <div className="live-status" role="status">
          {status}
        </div>
      ) : null}
    </div>
  );
}
