import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const { invokeMock, listenMock, unlistenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  unlistenMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { nyxIdVoiceBridge } from "./voice-bridge";
import type { NyxIdVoiceStart } from "./voice";
import { TauriCompanionRuntime } from "./tauri-runtime";
import { BrowserCompanionRuntime } from "./browser-runtime";

const sessionId = "123e4567-e89b-42d3-a456-426614174000";
const conversationId = "nyxa-0123456789abcdef0123456789abcdef";
const session = {
  id: sessionId,
  generation: 1,
  state: "active",
  muted: false,
  input_muted: false,
  control_revision: 0,
  observed_seconds: 2,
  end_reason: null,
  idle_warning: false,
} as const;
const preferences = {
  service_id: "123e4567-e89b-42d3-a456-426614174001",
  connection_id: null,
  key_source: "platform",
  model: "gpt-realtime",
  voice: "alloy",
  input_mode: "push_to_talk",
  language: null,
  notify_on_completion: false,
} as const;

let eventHandler: ((event: { payload: unknown }) => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  eventHandler = undefined;
  listenMock.mockImplementation(
    async (_name: string, handler: (event: { payload: unknown }) => void) => {
      eventHandler = handler;
      return unlistenMock;
    },
  );
});

describe("NyxID voice native bridge", () => {
  it("reads and cancels persisted voice work through exact native commands", async () => {
    const request = {
      id: sessionId,
      state: "queued",
      turn_id: "turn-1",
      pending_acknowledgement_ids: [],
    };
    invokeMock
      .mockResolvedValueOnce({
        ...request,
        provider_credential: "must-not-cross-bridge",
      })
      .mockResolvedValueOnce(undefined);
    await expect(
      nyxIdVoiceBridge.nyxIdVoiceRequest(conversationId, sessionId),
    ).resolves.toEqual(request);
    await expect(
      nyxIdVoiceBridge.cancelNyxIdVoiceRequest(conversationId, sessionId),
    ).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenNthCalledWith(1, "nyxid_voice_request", {
      conversationId,
      requestId: sessionId,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "cancel_nyxid_voice_request",
      {
        conversationId,
        requestId: sessionId,
      },
    );
  });

  it("exposes the voice bridge through the desktop runtime", async () => {
    invokeMock.mockResolvedValueOnce({ conversationId, options: [] });
    const runtime = new TauriCompanionRuntime();

    await expect(runtime.nyxIdVoiceOptions()).resolves.toEqual({
      conversationId,
      options: [],
    });
    expect(invokeMock).toHaveBeenCalledWith("nyxid_voice_options", {
      conversationId: undefined,
    });
  });

  it("keeps voice unavailable in browser preview", async () => {
    const runtime = new BrowserCompanionRuntime({
      storage: { getItem: () => null, setItem: () => undefined },
    });
    await expect(runtime.nyxIdVoiceOptions()).rejects.toThrow(
      "语音通话需要在桌面应用中连接 NyxID。",
    );
    const listener = vi.fn();
    const unlisten = await runtime.onNyxIdVoiceEvent(listener);
    await unlisten();
    expect(listener).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("forwards typed start, control, and media requests through native commands", async () => {
    const request: NyxIdVoiceStart = {
      conversationId,
      clientRequestId: sessionId,
      preferences,
      sdpOffer: "local-offer",
    };
    const started = { session, sdp_answer: "remote-answer" };
    const frame = { type: "ptt_begin", sessionId } as const;
    invokeMock
      .mockResolvedValueOnce(started)
      .mockResolvedValueOnce({ ...session, muted: true })
      .mockResolvedValueOnce(undefined);

    await expect(nyxIdVoiceBridge.startNyxIdVoice(request)).resolves.toEqual(
      started,
    );
    await expect(
      nyxIdVoiceBridge.controlNyxIdVoice(sessionId, "mute"),
    ).resolves.toEqual({ ...session, muted: true });
    await expect(
      nyxIdVoiceBridge.sendNyxIdVoiceFrame(frame),
    ).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenNthCalledWith(1, "start_nyxid_voice", {
      request,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "control_nyxid_voice", {
      sessionId,
      action: "mute",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "send_nyxid_voice_frame", {
      frame,
    });
  });

  it("returns only projected provider choices for the requested conversation", async () => {
    const option = {
      service_id: preferences.service_id,
      connection_id: null,
      key_source: "platform",
      model: "gpt-realtime",
      model_label: "Realtime",
      default_model: true,
      voice: {
        protocol: "openai_live",
        voices: [{ id: "alloy", label: "Alloy" }],
      },
      available: true,
      unavailable_reason: null,
      pricing: null,
    };
    invokeMock.mockResolvedValueOnce({
      conversationId,
      options: [{ ...option, provider_credential: "must-not-cross-bridge" }],
      accessToken: "must-not-cross-bridge",
    });

    await expect(
      nyxIdVoiceBridge.nyxIdVoiceOptions(conversationId),
    ).resolves.toEqual({ conversationId, options: [option] });
    expect(invokeMock).toHaveBeenCalledWith("nyxid_voice_options", {
      conversationId,
    });
  });

  it("rejects malformed session results before exposing them to the UI", async () => {
    invokeMock.mockResolvedValueOnce({ ...session, state: "unknown" });
    await expect(
      nyxIdVoiceBridge.controlNyxIdVoice(sessionId, "end"),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("projects valid native events, suppresses malformed audio, and returns cleanup", async () => {
    const listener = vi.fn();
    const unlisten = await nyxIdVoiceBridge.onNyxIdVoiceEvent(listener);
    expect(listenMock).toHaveBeenCalledWith(
      "companion://nyxid-voice",
      expect.any(Function),
    );
    const snapshot = {
      type: "snapshot",
      session,
      captions: [],
      tasks: [],
    };
    eventHandler?.({
      payload: {
        kind: "snapshot",
        sessionId,
        snapshot: {
          ...snapshot,
          session: { ...session, provider_credential: "must-not-cross-bridge" },
        },
        accessToken: "must-not-cross-bridge",
      },
    });
    expect(listener).toHaveBeenCalledWith({
      kind: "snapshot",
      sessionId,
      snapshot,
    });
    eventHandler?.({
      payload: { kind: "audio", sessionId, endMs: 20, pcm: [0, 128, 255] },
    });
    expect(listener).toHaveBeenCalledTimes(2);
    eventHandler?.({
      payload: { kind: "audio", sessionId, endMs: 20, pcm: [256] },
    });
    eventHandler?.({
      payload: {
        kind: "audio",
        sessionId,
        endMs: 20,
        pcm: Array(1921).fill(0),
      },
    });
    eventHandler?.({
      payload: {
        kind: "audio",
        sessionId: "not-a-session",
        endMs: 20,
        pcm: [],
      },
    });
    expect(listener).toHaveBeenCalledTimes(2);

    await unlisten();
    expect(unlistenMock).toHaveBeenCalledOnce();
  });
});
