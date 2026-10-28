import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  nyxIdVoiceEventSchema,
  nyxIdVoiceRequestSchema,
  nyxIdVoiceOptionsSchema,
  nyxIdVoiceSessionSchema,
  nyxIdVoiceStartedSchema,
  type NyxIdVoiceBridge,
} from "./voice";

export const nyxIdVoiceBridge: NyxIdVoiceBridge = {
  async nyxIdVoiceRequest(conversationId, requestId) {
    return nyxIdVoiceRequestSchema.parse(
      await invoke("nyxid_voice_request", { conversationId, requestId }),
    );
  },
  async cancelNyxIdVoiceRequest(conversationId, requestId) {
    await invoke("cancel_nyxid_voice_request", { conversationId, requestId });
  },
  async nyxIdVoiceOptions(conversationId) {
    return nyxIdVoiceOptionsSchema.parse(
      await invoke("nyxid_voice_options", { conversationId }),
    );
  },
  async startNyxIdVoice(request) {
    return nyxIdVoiceStartedSchema.parse(
      await invoke("start_nyxid_voice", { request }),
    );
  },
  async controlNyxIdVoice(sessionId, action) {
    return nyxIdVoiceSessionSchema.parse(
      await invoke("control_nyxid_voice", { sessionId, action }),
    );
  },
  async sendNyxIdVoiceFrame(frame) {
    await invoke("send_nyxid_voice_frame", { frame });
  },
  onNyxIdVoiceEvent(listener) {
    return listen<unknown>("companion://nyxid-voice", (event) => {
      const parsed = nyxIdVoiceEventSchema.safeParse(event.payload);
      if (parsed.success) listener(parsed.data);
    });
  },
};
