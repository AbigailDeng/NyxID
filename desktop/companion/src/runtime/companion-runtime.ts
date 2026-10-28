import type { NyxIdVoiceBridge } from "./voice";
import type { CompanionSettings, CompanionSnapshot } from "../domain/companion";
import type { NyxIdView } from "./nyxid";
import type {
  NyxIdChatCompletedEvent,
  NyxIdChatEvent,
  NyxIdChatHistory,
  NyxIdChatRecovery,
  NyxIdChatRequest,
} from "./chat";
import type { WindowDragEvent } from "./window-drag";

export type WindowMode = "compact" | "expanded";
export type Unlisten = () => void | Promise<void>;

export interface CompanionRuntime extends NyxIdVoiceBridge {
  snapshot(): Promise<CompanionSnapshot>;
  saveSettings(settings: CompanionSettings): Promise<CompanionSnapshot>;
  setWindowMode(mode: WindowMode): Promise<void>;
  startWindowDrag(): Promise<void>;
  openNyxidAssistant(): Promise<void>;
  nyxidStatus(): Promise<NyxIdView>;
  startNyxidLogin(): Promise<NyxIdView>;
  cancelNyxidLogin(): Promise<NyxIdView>;
  refreshNyxidCapabilities(): Promise<NyxIdView>;
  logoutNyxid(): Promise<NyxIdView>;
  sendNyxIdChat(request: NyxIdChatRequest): Promise<NyxIdChatCompletedEvent>;
  recoverNyxIdChat(): Promise<NyxIdChatRecovery | null>;
  nyxIdChatHistory(conversationId: string): Promise<NyxIdChatHistory>;
  stopNyxIdChat(conversationId: string): Promise<void>;
  getLaunchAtLogin(): Promise<boolean>;
  setLaunchAtLogin(enabled: boolean): Promise<boolean>;
  onStateChanged(
    listener: (snapshot: CompanionSnapshot) => void,
  ): Promise<Unlisten>;
  onWindowDrag(listener: (event: WindowDragEvent) => void): Promise<Unlisten>;
  onNyxidChanged(listener: (view: NyxIdView) => void): Promise<Unlisten>;
  onNyxIdChatEvent(
    listener: (event: NyxIdChatEvent) => void,
  ): Promise<Unlisten>;
  dispose(): void | Promise<void>;
}
