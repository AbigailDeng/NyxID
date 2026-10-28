import type {
  NyxIdVoiceOptions,
  NyxIdVoiceRequest,
  NyxIdVoiceStart,
  NyxIdVoiceStarted,
  NyxIdVoiceSession,
  NyxIdVoiceFrame,
  NyxIdVoiceEvent,
} from "./voice";
import {
  companionSettingsSchema,
  createDefaultCompanionSnapshot,
  parseCompanionSnapshot,
  type CompanionSettings,
  type CompanionSnapshot,
} from "../domain/companion";
import type {
  CompanionRuntime,
  Unlisten,
  WindowMode,
} from "./companion-runtime";
import {
  NyxIdChatSendError,
  type NyxIdChatCompletedEvent,
  type NyxIdChatEvent,
  type NyxIdChatHistory,
  type NyxIdChatRecovery,
  type NyxIdChatRequest,
} from "./chat";
import type { NyxIdView } from "./nyxid";
import type { WindowDragEvent } from "./window-drag";

// Keep the existing key so upgrading users retain their identity preferences.
export const BROWSER_SNAPSHOT_KEY = "nyxid.companion.snapshot.v1";
export const BROWSER_LAUNCH_AT_LOGIN_KEY = "nyxid.companion.launch-at-login.v1";
export const NYXID_ASSISTANT_URL = "https://nyx.chrono-ai.fun/assistant";

export interface RuntimeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface BrowserRuntimeOptions {
  storage?: RuntimeStorage;
}

function availableLocalStorage(): RuntimeStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function cloneSnapshot(snapshot: CompanionSnapshot): CompanionSnapshot {
  return parseCompanionSnapshot(snapshot);
}

export class BrowserCompanionRuntime implements CompanionRuntime {
  async nyxIdVoiceRequest(
    conversationId: string,
    requestId: string,
  ): Promise<NyxIdVoiceRequest> {
    void conversationId;
    void requestId;
    throw new Error("语音通话需要在桌面应用中连接 NyxID。");
  }
  async cancelNyxIdVoiceRequest(
    conversationId: string,
    requestId: string,
  ): Promise<void> {
    void conversationId;
    void requestId;
    throw new Error("语音通话需要在桌面应用中连接 NyxID。");
  }
  async nyxIdVoiceOptions(
    _conversationId?: string,
  ): Promise<NyxIdVoiceOptions> {
    void _conversationId;
    throw new Error("语音通话需要在桌面应用中连接 NyxID。");
  }
  async startNyxIdVoice(_request: NyxIdVoiceStart): Promise<NyxIdVoiceStarted> {
    void _request;
    throw new Error("语音通话需要在桌面应用中连接 NyxID。");
  }
  async controlNyxIdVoice(
    _sessionId: string,
    _action: "mute" | "unmute" | "end",
  ): Promise<NyxIdVoiceSession> {
    void _sessionId;
    void _action;
    throw new Error("语音通话需要在桌面应用中连接 NyxID。");
  }
  async sendNyxIdVoiceFrame(_frame: NyxIdVoiceFrame): Promise<void> {
    void _frame;
    throw new Error("语音通话需要在桌面应用中连接 NyxID。");
  }
  async onNyxIdVoiceEvent(
    _listener: (event: NyxIdVoiceEvent) => void,
  ): Promise<Unlisten> {
    void _listener;
    return () => {};
  }

  private state: CompanionSnapshot;
  private readonly storage: RuntimeStorage | undefined;
  private readonly stateListeners = new Set<
    (snapshot: CompanionSnapshot) => void
  >();

  constructor(options: BrowserRuntimeOptions = {}) {
    this.storage = options.storage ?? availableLocalStorage();
    this.state = this.readStoredSnapshot();
    this.persist();
  }

  private readStoredSnapshot(): CompanionSnapshot {
    try {
      const stored = this.storage?.getItem(BROWSER_SNAPSHOT_KEY);
      return stored
        ? parseCompanionSnapshot(JSON.parse(stored))
        : createDefaultCompanionSnapshot();
    } catch {
      return createDefaultCompanionSnapshot();
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(BROWSER_SNAPSHOT_KEY, JSON.stringify(this.state));
    } catch {
      // Browser privacy modes can reject localStorage writes. In-memory state
      // remains functional for the current development session.
    }
  }

  private commit(next: CompanionSnapshot): CompanionSnapshot {
    this.state = parseCompanionSnapshot(next);
    this.persist();
    const snapshot = cloneSnapshot(this.state);
    for (const listener of this.stateListeners) {
      listener(cloneSnapshot(snapshot));
    }
    return snapshot;
  }

  async snapshot(): Promise<CompanionSnapshot> {
    return cloneSnapshot(this.state);
  }

  async saveSettings(settings: CompanionSettings): Promise<CompanionSnapshot> {
    return this.commit({
      ...this.state,
      settings: companionSettingsSchema.parse(settings),
    });
  }

  async setWindowMode(mode: WindowMode): Promise<void> {
    void mode;
  }

  async startWindowDrag(): Promise<void> {}

  async openNyxidAssistant(): Promise<void> {
    if (typeof window !== "undefined") {
      window.open(NYXID_ASSISTANT_URL, "_blank", "noopener,noreferrer");
    }
  }

  async nyxidStatus(): Promise<NyxIdView> {
    return { state: "unavailable" };
  }

  async startNyxidLogin(): Promise<NyxIdView> {
    return { state: "unavailable" };
  }

  async cancelNyxidLogin(): Promise<NyxIdView> {
    return { state: "unavailable" };
  }

  async refreshNyxidCapabilities(): Promise<NyxIdView> {
    return { state: "unavailable" };
  }

  async logoutNyxid(): Promise<NyxIdView> {
    return { state: "unavailable" };
  }

  async sendNyxIdChat(
    request: NyxIdChatRequest,
  ): Promise<NyxIdChatCompletedEvent> {
    void request;
    throw new NyxIdChatSendError(
      "rejected",
      "请使用桌面版连接 NyxID 后再发送消息。",
    );
  }

  async nyxIdChatHistory(conversationId: string): Promise<NyxIdChatHistory> {
    void conversationId;
    throw new Error("NyxID 对话需要在桌面应用中使用");
  }

  async recoverNyxIdChat(): Promise<NyxIdChatRecovery | null> {
    return null;
  }

  async stopNyxIdChat(conversationId: string): Promise<void> {
    void conversationId;
    throw new Error("NyxID 对话需要在桌面应用中使用");
  }

  async getLaunchAtLogin(): Promise<boolean> {
    try {
      return this.storage?.getItem(BROWSER_LAUNCH_AT_LOGIN_KEY) === "true";
    } catch {
      return false;
    }
  }

  async setLaunchAtLogin(enabled: boolean): Promise<boolean> {
    try {
      this.storage?.setItem(BROWSER_LAUNCH_AT_LOGIN_KEY, String(enabled));
    } catch {
      return false;
    }
    return enabled;
  }

  async onStateChanged(
    listener: (snapshot: CompanionSnapshot) => void,
  ): Promise<Unlisten> {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  async onWindowDrag(
    listener: (event: WindowDragEvent) => void,
  ): Promise<Unlisten> {
    void listener;
    return () => undefined;
  }

  async onNyxidChanged(listener: (view: NyxIdView) => void): Promise<Unlisten> {
    void listener;
    return () => undefined;
  }

  async onNyxIdChatEvent(
    listener: (event: NyxIdChatEvent) => void,
  ): Promise<Unlisten> {
    void listener;
    return () => undefined;
  }

  dispose(): void {
    this.stateListeners.clear();
  }
}
