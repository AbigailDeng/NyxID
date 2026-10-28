import { z } from "zod";
import type { Unlisten } from "./companion-runtime";

const uuid = z.string().uuid();
const conversationId = z.string().regex(/^nyxa-[a-f0-9]{32}$/);
export const nyxIdVoiceSessionSchema = z.object({
  id: uuid,
  generation: z.number().int().nonnegative(),
  state: z.enum(["starting", "active", "closing", "closed", "failed"]),
  muted: z.boolean(),
  input_muted: z.boolean(),
  control_revision: z.number().int().nonnegative(),
  observed_seconds: z.number().nonnegative(),
  end_reason: z.string().nullable(),
  idle_warning: z.boolean(),
});
const voiceRateSchema = z.object({
  metric: z.string(),
  credits_per_unit: z.string(),
  sync_status: z.string(),
});
const voicePriceSchema = voiceRateSchema.extend({
  components: z.array(voiceRateSchema).default([]),
});
export const nyxIdVoiceOptionSchema = z.object({
  service_id: uuid,
  connection_id: uuid.nullable(),
  key_source: z.enum(["platform", "own"]),
  model: z.string().min(1).max(128),
  model_label: z.string(),
  default_model: z.boolean(),
  voice: z.object({
    protocol: z.enum(["openai_live", "xai_realtime"]),
    voices: z.array(z.object({ id: z.string(), label: z.string() })),
  }),
  available: z.boolean(),
  unavailable_reason: z.string().nullable(),
  pricing: voicePriceSchema.nullable(),
  reported_token_pricing: voicePriceSchema.nullable().optional(),
  billing_owner: z.string().optional(),
});
export const nyxIdVoiceOptionsSchema = z.object({
  conversationId,
  options: z.array(nyxIdVoiceOptionSchema),
});
export const nyxIdVoiceStartedSchema = z.object({
  session: nyxIdVoiceSessionSchema,
  sdp_answer: z.string(),
});
export const nyxIdVoiceSnapshotSchema = z.object({
  type: z.literal("snapshot"),
  session: nyxIdVoiceSessionSchema,
  captions: z.array(
    z.object({
      id: z.string(),
      speaker: z.enum(["user", "assistant"]),
      text: z.string(),
      sealed: z.boolean(),
      complete: z.boolean(),
    }),
  ),
  tasks: z.array(
    z.object({
      id: uuid,
      turn_id: z.string(),
      state: z.enum([
        "queued",
        "claimed",
        "awaiting_confirmation",
        "completed",
        "cancelled",
      ]),
      pending_acknowledgement_ids: z.array(z.string()),
      title: z.string().nullable().optional(),
      result_message_id: z.string().nullable().optional(),
    }),
  ),
});
export const nyxIdVoiceRequestSchema = z.object({
  id: uuid,
  state: z.enum([
    "queued",
    "claimed",
    "awaiting_confirmation",
    "completed",
    "cancelled",
  ]),
  turn_id: z.string(),
  pending_acknowledgement_ids: z.array(z.string()),
  result_message_id: z.string().nullable().optional(),
});
export type NyxIdVoiceRequest = z.infer<typeof nyxIdVoiceRequestSchema>;
export const nyxIdVoiceEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("snapshot"),
    sessionId: uuid,
    snapshot: nyxIdVoiceSnapshotSchema,
  }),
  z.object({
    kind: z.literal("audio"),
    sessionId: uuid,
    endMs: z.number().int().nonnegative(),
    pcm: z.array(z.number().int().min(0).max(255)).max(1920),
  }),
  z.object({ kind: z.literal("audio_flush"), sessionId: uuid }),
  z.object({ kind: z.literal("error"), sessionId: uuid, message: z.string() }),
  z.object({ kind: z.literal("closed"), sessionId: uuid }),
]);
export type NyxIdVoiceSession = z.infer<typeof nyxIdVoiceSessionSchema>;
export type NyxIdVoiceOption = z.infer<typeof nyxIdVoiceOptionSchema>;
export type NyxIdVoiceOptions = z.infer<typeof nyxIdVoiceOptionsSchema>;
export type NyxIdVoiceStarted = z.infer<typeof nyxIdVoiceStartedSchema>;
export type NyxIdVoiceSnapshot = z.infer<typeof nyxIdVoiceSnapshotSchema>;
export type NyxIdVoiceEvent = z.infer<typeof nyxIdVoiceEventSchema>;
export interface NyxIdVoiceStart {
  conversationId: string;
  clientRequestId: string;
  preferences: {
    service_id: string;
    connection_id: string | null;
    key_source: "platform" | "own";
    model: string;
    voice: string | null;
    input_mode: "push_to_talk" | "automatic";
    language: string | null;
    notify_on_completion: boolean;
  };
  sdpOffer: string;
}
export type NyxIdVoiceFrame =
  | { type: "ptt_begin" | "ptt_commit"; sessionId: string }
  | { type: "pcm"; sessionId: string; pcm: number[] }
  | {
      type: "heartbeat";
      sessionId: string;
      playbackMs: number;
      playbackAudible: boolean;
    };
export interface NyxIdVoiceBridge {
  nyxIdVoiceRequest(
    conversationId: string,
    requestId: string,
  ): Promise<NyxIdVoiceRequest>;
  cancelNyxIdVoiceRequest(
    conversationId: string,
    requestId: string,
  ): Promise<void>;
  nyxIdVoiceOptions(conversationId?: string): Promise<NyxIdVoiceOptions>;
  startNyxIdVoice(request: NyxIdVoiceStart): Promise<NyxIdVoiceStarted>;
  controlNyxIdVoice(
    sessionId: string,
    action: "mute" | "unmute" | "end",
  ): Promise<NyxIdVoiceSession>;
  sendNyxIdVoiceFrame(frame: NyxIdVoiceFrame): Promise<void>;
  onNyxIdVoiceEvent(
    listener: (event: NyxIdVoiceEvent) => void,
  ): Promise<Unlisten>;
}
