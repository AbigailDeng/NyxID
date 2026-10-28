import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NyxIdVoiceClient } from "./voice-client";
import type {
  NyxIdVoiceBridge,
  NyxIdVoiceEvent,
  NyxIdVoiceOption,
  NyxIdVoiceSession,
} from "./voice";

const pcm = vi.hoisted(() => ({
  capture: vi.fn(),
  close: vi.fn(),
  enqueue: vi.fn(),
  flush: vi.fn(),
  output: undefined as undefined | ((bytes: ArrayBuffer) => void),
}));
vi.mock("./voice-audio", () => ({
  GrokAudio: class {
    constructor(
      _audio: HTMLAudioElement,
      output: (bytes: ArrayBuffer) => void,
    ) {
      pcm.output = output;
    }
    start = vi.fn(async () => {});
    capture = pcm.capture;
    close = pcm.close;
    enqueue = pcm.enqueue;
    flush = pcm.flush;
    resume = vi.fn(async () => {});
    watermark = () => 0;
  },
}));
const conversationId = "nyxa-0123456789abcdef0123456789abcdef";
const session: NyxIdVoiceSession = {
  id: "f985604b-1991-4aa2-969d-2325055ea813",
  generation: 1,
  state: "active",
  muted: false,
  input_muted: false,
  control_revision: 0,
  observed_seconds: 0,
  end_reason: null,
  idle_warning: false,
};
const option: NyxIdVoiceOption = {
  service_id: "c2701d64-3491-42b5-8a21-8c01d1903c6b",
  connection_id: null,
  key_source: "platform",
  model: "gpt-live-1",
  model_label: "GPT Live",
  default_model: true,
  voice: { protocol: "openai_live", voices: [{ id: "marin", label: "Marin" }] },
  available: true,
  unavailable_reason: null,
  pricing: null,
};
class Peer {
  static current: Peer;
  iceGatheringState = "complete";
  connectionState = "new";
  localDescription = { sdp: "v=0\r\nm=audio" };
  ontrack?: (e: unknown) => void;
  onconnectionstatechange?: () => void;
  channel = {
    onmessage: undefined as undefined | ((e: { data: string }) => void),
    send: vi.fn(),
  };
  close = vi.fn();
  addTrack = vi.fn();
  createOffer = vi.fn(async () => this.localDescription);
  setLocalDescription = vi.fn(async () => {});
  setRemoteDescription = vi.fn(async () => {});
  createDataChannel = vi.fn(() => this.channel);
  constructor() {
    Peer.current = this;
  }
}
let track: {
  enabled: boolean;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
};
let microphone: ReturnType<typeof vi.fn>;
let listener: (event: NyxIdVoiceEvent) => void;
let audio: HTMLAudioElement;
let bridge: NyxIdVoiceBridge;
let unlisten: ReturnType<typeof vi.fn>;
const callbacks = () => ({
  onSnapshot: vi.fn(),
  onError: vi.fn(),
  onClosed: vi.fn(),
});
function snapshot(overrides: Partial<NyxIdVoiceSession> = {}) {
  listener({
    kind: "snapshot",
    sessionId: session.id,
    snapshot: {
      type: "snapshot",
      session: { ...session, ...overrides },
      captions: [],
      tasks: [],
    },
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  pcm.capture.mockReset();
  pcm.close.mockReset();
  pcm.enqueue.mockReset();
  pcm.flush.mockReset();
  track = { enabled: true, stop: vi.fn(), onended: null };
  microphone = vi.fn().mockResolvedValue({
    getAudioTracks: () => [track],
    getTracks: () => [track],
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: microphone },
  });
  vi.stubGlobal("RTCPeerConnection", Peer);
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((name, options) => {
    const element = create(name, options);
    if (name === "audio") {
      audio = element as HTMLAudioElement;
      audio.play = vi.fn().mockResolvedValue(undefined);
      audio.pause = vi.fn();
    }
    return element;
  });
  unlisten = vi.fn();
  bridge = {
    nyxIdVoiceRequest: vi.fn(),
    cancelNyxIdVoiceRequest: vi.fn(),
    nyxIdVoiceOptions: vi
      .fn()
      .mockResolvedValue({ conversationId, options: [option] }),
    startNyxIdVoice: vi
      .fn()
      .mockResolvedValue({ session, sdp_answer: "answer" }),
    controlNyxIdVoice: vi.fn().mockResolvedValue({ ...session, muted: true }),
    sendNyxIdVoiceFrame: vi.fn().mockResolvedValue(undefined),
    onNyxIdVoiceEvent: vi.fn(async (next) => {
      listener = next;
      return unlisten;
    }),
  };
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("NyxID desktop realtime media", () => {
  it("gates microphone on server and provider readiness plus explicit hold, and keeps provider commands out of IPC", async () => {
    const handlers = callbacks();
    const client = new NyxIdVoiceClient(bridge, handlers);
    await client.prepare(conversationId);
    await client.start(option);
    client.hold(true);
    expect(track.enabled).toBe(false);
    snapshot();
    expect(handlers.onSnapshot).not.toHaveBeenCalled();
    client.hold(true);
    expect(track.enabled).toBe(false);
    Peer.current.channel.onmessage?.({
      data: JSON.stringify({ type: "session.started" }),
    });
    expect(track.enabled).toBe(true);
    client.hold(false);
    expect(track.enabled).toBe(false);
    client.muteSpeaker(true);
    expect(audio.muted).toBe(true);
    Peer.current.channel.onmessage?.({
      data: JSON.stringify({
        type: "response.function_call_arguments.done",
        name: "exec",
      }),
    });
    expect(bridge.sendNyxIdVoiceFrame).not.toHaveBeenCalled();
    expect(Peer.current.channel.send).not.toHaveBeenCalled();
    await client.end();
    expect(track.stop).toHaveBeenCalled();
    expect(Peer.current.close).toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalled();
    expect(bridge.controlNyxIdVoice).toHaveBeenCalledWith(session.id, "end");
    expect(handlers.onClosed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("releases a microphone permission request that resolves after End without creating a call", async () => {
    let resolve!: (value: unknown) => void;
    microphone.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const client = new NyxIdVoiceClient(bridge, callbacks());
    await client.prepare();
    const starting = client.start(option);
    await vi.waitFor(() => expect(microphone).toHaveBeenCalled());
    await client.end();
    resolve({ getAudioTracks: () => [track], getTracks: () => [track] });
    await starting;
    expect(track.stop).toHaveBeenCalled();
    expect(bridge.startNyxIdVoice).not.toHaveBeenCalled();
  });
  it("ends a native session whose creation resolves after local cancellation", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(bridge.startNyxIdVoice).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }) as ReturnType<NyxIdVoiceBridge["startNyxIdVoice"]>,
    );
    const client = new NyxIdVoiceClient(bridge, callbacks());
    await client.prepare();
    const starting = client.start(option);
    await vi.waitFor(() => expect(bridge.startNyxIdVoice).toHaveBeenCalled());
    await client.end();
    resolve({ session, sdp_answer: "answer" });
    await starting;
    expect(bridge.controlNyxIdVoice).toHaveBeenCalledWith(session.id, "end");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not leave a heartbeat when ending during SDP answer application", async () => {
    let resolve!: () => void;
    const client = new NyxIdVoiceClient(bridge, callbacks());
    await client.prepare();
    vi.mocked(bridge.startNyxIdVoice).mockImplementation(async () => {
      Peer.current.setRemoteDescription.mockImplementation(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      );
      return { session, sdp_answer: "answer" };
    });
    const starting = client.start(option);
    await vi.waitFor(() =>
      expect(Peer.current.setRemoteDescription).toHaveBeenCalled(),
    );
    await client.end();
    resolve();
    await starting;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves xAI begin/audio/commit ordering and only captures while held", async () => {
    const client = new NyxIdVoiceClient(bridge, callbacks());
    await client.prepare();
    await client.start({
      ...option,
      model: "grok-voice-think-fast-2.0",
      voice: { ...option.voice, protocol: "xai_realtime" },
    });
    snapshot();
    pcm.output?.(new Uint8Array([0, 0]).buffer);
    expect(bridge.sendNyxIdVoiceFrame).not.toHaveBeenCalled();
    client.hold(true);
    pcm.output?.(new Uint8Array([0, 0]).buffer);
    client.hold(false);
    await vi.waitFor(() =>
      expect(bridge.sendNyxIdVoiceFrame).toHaveBeenCalledTimes(3),
    );
    expect(
      vi
        .mocked(bridge.sendNyxIdVoiceFrame)
        .mock.calls.map(([frame]) => frame.type),
    ).toEqual(["ptt_begin", "pcm", "ptt_commit"]);
    expect(track.enabled).toBe(false);
    expect(pcm.capture).toHaveBeenLastCalledWith(false);
    await client.end();
    expect(pcm.close).toHaveBeenCalled();
  });
  it("cleans up and reports native admission failures", async () => {
    vi.mocked(bridge.startNyxIdVoice).mockRejectedValue(
      "当前账号尚未启用 NyxID 语音。",
    );
    const handlers = callbacks();
    const client = new NyxIdVoiceClient(bridge, handlers);
    await client.prepare();
    await client.start(option);
    expect(handlers.onError).toHaveBeenCalledWith(
      "当前账号尚未启用 NyxID 语音。",
    );
    expect(track.stop).toHaveBeenCalled();
    expect(client.isClosed).toBe(true);
    expect(unlisten).toHaveBeenCalled();
  });
  it("releases local capture immediately when native transport closes without waiting on another end request", async () => {
    const handlers = callbacks();
    const client = new NyxIdVoiceClient(bridge, handlers);
    await client.prepare();
    await client.start(option);
    snapshot();
    Peer.current.channel.onmessage?.({
      data: JSON.stringify({ type: "session.started" }),
    });
    client.hold(true);
    expect(track.enabled).toBe(true);
    listener({ kind: "closed", sessionId: session.id });
    expect(track.enabled).toBe(false);
    expect(track.stop).toHaveBeenCalled();
    expect(client.isClosed).toBe(true);
    expect(bridge.controlNyxIdVoice).not.toHaveBeenCalled();
    expect(handlers.onClosed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends a call when media readiness never arrives and frees startup timers", async () => {
    const handlers = callbacks();
    const client = new NyxIdVoiceClient(bridge, handlers);
    await client.prepare();
    await client.start(option);
    snapshot();
    await vi.advanceTimersByTimeAsync(20000);
    expect(client.isClosed).toBe(true);
    expect(track.stop).toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledWith(
      "语音连接超时，请结束后重新开始通话。",
    );
    expect(bridge.controlNyxIdVoice).toHaveBeenCalledWith(session.id, "end");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends the session and releases resources when microphone permission or the device is lost", async () => {
    const handlers = callbacks();
    const client = new NyxIdVoiceClient(bridge, handlers);
    await client.prepare();
    await client.start(option);
    snapshot();
    Peer.current.channel.onmessage?.({
      data: JSON.stringify({ type: "session.started" }),
    });
    client.hold(true);
    track.onended?.();
    expect(client.isClosed).toBe(true);
    expect(track.enabled).toBe(false);
    expect(track.stop).toHaveBeenCalled();
    expect(track.onended).toBeNull();
    expect(Peer.current.close).toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalled();
    expect(bridge.controlNyxIdVoice).toHaveBeenCalledWith(session.id, "end");
    expect(handlers.onError).toHaveBeenCalledWith(
      "麦克风已断开或访问权限已撤销，请检查系统设置后重新开始通话。",
    );
    expect(handlers.onClosed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
