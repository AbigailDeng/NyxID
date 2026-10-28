import { GrokAudio } from "./voice-audio";
import type {
  NyxIdVoiceBridge,
  NyxIdVoiceEvent,
  NyxIdVoiceFrame,
  NyxIdVoiceOption,
  NyxIdVoiceSession,
  NyxIdVoiceSnapshot,
} from "./voice";
import type { Unlisten } from "./companion-runtime";

interface VoiceCallbacks {
  onSnapshot(snapshot: NyxIdVoiceSnapshot): void;
  onError(message: string): void;
  onClosed(): void;
}

/** Local ephemeral media; NyxID alone owns transcripts, work, and billing. */
export class NyxIdVoiceClient {
  private session?: NyxIdVoiceSession;
  private snapshot?: NyxIdVoiceSnapshot;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private conversationId?: string;
  private media?: MediaStream;
  private peer?: RTCPeerConnection;
  private audio?: HTMLAudioElement;
  private pcm?: GrokAudio;
  private unlisten?: Unlisten;
  private heartbeat?: ReturnType<typeof setInterval>;
  private closed = false;
  private notifiedClosed = false;
  private started = false;
  private controlsReady = false;
  private held = false;
  private speakerMuted = false;
  private pendingEvents: NyxIdVoiceEvent[] = [];
  private sendChain = Promise.resolve();
  private queuedFrames = 0;
  private abort = new AbortController();

  constructor(
    private bridge: NyxIdVoiceBridge,
    private callbacks: VoiceCallbacks,
  ) {}
  get isClosed() {
    return this.closed;
  }

  async prepare(conversationId?: string) {
    const result = await this.bridge.nyxIdVoiceOptions(conversationId);
    this.conversationId = result.conversationId;
    return result;
  }

  async start(option: NyxIdVoiceOption, voiceId?: string) {
    if (this.closed || this.media || !this.conversationId) return;
    if (!option.available)
      throw new Error(option.unavailable_reason ?? "当前语音服务不可用。");
    const conversationId = this.conversationId;
    try {
      this.unlisten = await this.bridge.onNyxIdVoiceEvent((event) => {
        if (this.closed) return;
        if (!this.session) {
          if (this.pendingEvents.length < 64) this.pendingEvents.push(event);
          return;
        }
        this.receive(event);
      });
      if (this.closed) {
        await this.unlisten();
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "当前桌面环境无法使用麦克风，请在系统设置中允许麦克风访问。",
        );
      }
      if (typeof RTCPeerConnection === "undefined") {
        throw new Error("当前桌面环境不支持实时语音，请更新应用后重试。");
      }
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (this.closed) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      this.media = media;
      media.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      this.audio = document.createElement("audio");
      this.audio.autoplay = true;
      this.audio.setAttribute("playsinline", "");
      let sdpOffer = "";
      if (option.voice.protocol === "xai_realtime") {
        this.pcm = new GrokAudio(
          this.audio,
          (bytes) => {
            if (this.held && this.session && this.controlsReady) {
              this.send({
                type: "pcm",
                sessionId: this.session.id,
                pcm: Array.from(new Uint8Array(bytes)),
              });
            }
          },
          () => this.fail("无法确认语音播放状态，请使用耳机并重新开始通话。"),
        );
        await this.pcm.start(media);
      } else {
        const peer = new RTCPeerConnection();
        this.peer = peer;
        media.getTracks().forEach((track) => peer.addTrack(track, media));
        peer.ontrack = ({ streams, track }) => {
          if (!this.audio || this.closed) return;
          this.audio.srcObject = streams[0] ?? new MediaStream([track]);
          void this.resumeAudio();
        };
        peer.onconnectionstatechange = () => {
          if (peer.connectionState === "failed")
            this.fail("语音连接已断开，请重新开始通话。");
        };
        const events = peer.createDataChannel("oai-events");
        events.onmessage = ({ data }) => {
          if (this.closed || typeof data !== "string" || data.length > 262144)
            return;
          try {
            const event: unknown = JSON.parse(data);
            if (
              typeof event === "object" &&
              event !== null &&
              "type" in event &&
              event.type === "session.started"
            ) {
              this.started = true;
              if (this.snapshot?.session.state === "active")
                this.callbacks.onSnapshot(this.snapshot);
              this.updateInput();
            }
          } catch {
            /* Provider data is presentation only and never forwarded. */
          }
        };
        await peer.setLocalDescription(await peer.createOffer());
        await this.waitForIce(peer);
        sdpOffer = peer.localDescription?.sdp ?? "";
        if (!sdpOffer) throw new Error("无法建立语音媒体连接。");
      }
      if (this.closed) return;
      const result = await this.bridge.startNyxIdVoice({
        conversationId,
        clientRequestId: crypto.randomUUID(),
        preferences: {
          service_id: option.service_id,
          connection_id: option.connection_id,
          key_source: option.key_source,
          model: option.model,
          voice: voiceId ?? option.voice.voices[0]?.id ?? null,
          input_mode: "push_to_talk",
          language: null,
          notify_on_completion: false,
        },
        sdpOffer,
      });
      this.session = result.session;
      if (this.closed) {
        await this.bridge
          .controlNyxIdVoice(result.session.id, "end")
          .catch(() => {});
        return;
      }
      this.startupTimer = setTimeout(
        () => this.fail("语音连接超时，请结束后重新开始通话。"),
        20000,
      );
      if (this.peer)
        await this.peer.setRemoteDescription({
          type: "answer",
          sdp: result.sdp_answer,
        });
      else this.started = true;
      if (this.closed) return;
      this.pendingEvents.splice(0).forEach((event) => this.receive(event));
      if (this.closed) return;
      this.heartbeat = setInterval(() => {
        if (!this.session || !this.controlsReady || this.closed) return;
        this.send({
          type: "heartbeat",
          sessionId: this.session.id,
          playbackMs:
            this.pcm?.watermark() ??
            Math.max(0, Math.floor((this.audio?.currentTime ?? 0) * 1000)),
          playbackAudible:
            !!this.audio &&
            !this.audio.paused &&
            !this.audio.muted &&
            this.audio.volume > 0,
        });
      }, 1000);
    } catch (error) {
      if (!this.closed) {
        const name = error instanceof Error ? error.name : "";
        this.callbacks.onError(
          name === "NotAllowedError" || name === "PermissionDeniedError"
            ? "请在系统设置中允许 NyxID Companion 使用麦克风，然后重新开始通话。"
            : name === "NotFoundError"
              ? "没有找到麦克风，请连接麦克风后重试。"
              : typeof error === "string"
                ? error
                : error instanceof Error
                  ? error.message
                  : "语音连接失败，请稍后重试。",
        );
      }
      await this.end();
    }
  }

  private receive(event: NyxIdVoiceEvent) {
    if (this.closed || event.sessionId !== this.session?.id) return;
    if (event.kind === "snapshot") {
      if (event.snapshot.session.generation !== this.session.generation) return;
      this.session = event.snapshot.session;
      this.controlsReady = true;
      this.snapshot = event.snapshot;
      if (this.started || this.session.state !== "active")
        this.callbacks.onSnapshot(event.snapshot);
      this.updateInput();
      if (this.session.state === "closed" || this.session.state === "failed") {
        if (this.session.state === "failed")
          this.callbacks.onError(
            "NyxID 语音通话已结束，请检查服务状态后重试。",
          );
        this.dispose();
      }
    } else if (event.kind === "audio") {
      this.pcm?.enqueue(new Uint8Array(event.pcm).buffer, event.endMs);
    } else if (event.kind === "audio_flush") {
      this.pcm?.flush();
    } else if (event.kind === "error") {
      this.callbacks.onError(event.message);
      this.dispose();
    } else {
      this.callbacks.onError(
        "语音连接已断开，请重新开始通话。已接受的任务会继续处理。",
      );
      this.dispose();
    }
  }

  private send(frame: NyxIdVoiceFrame) {
    if (this.closed) return;
    if (++this.queuedFrames > 16) {
      this.fail("语音连接过慢，请重新开始通话。");
      return;
    }
    // Preserve begin/audio/commit ordering across asynchronous IPC invocations.
    this.sendChain = this.sendChain
      .then(async () => {
        if (!this.closed) await this.bridge.sendNyxIdVoiceFrame(frame);
      })
      .catch(() => {
        this.fail("语音连接已断开，请重新开始通话。");
      })
      .finally(() => {
        --this.queuedFrames;
      });
  }
  private updateInput() {
    if (
      this.started &&
      this.controlsReady &&
      this.session?.state === "active" &&
      this.startupTimer
    ) {
      clearTimeout(this.startupTimer);
      this.startupTimer = undefined;
    }
    const enabled =
      !this.closed &&
      this.started &&
      this.controlsReady &&
      this.held &&
      this.session?.state === "active" &&
      !this.session.muted &&
      !this.session.input_muted;
    this.media?.getAudioTracks().forEach((track) => {
      track.enabled = !!enabled;
    });
    this.pcm?.capture(!!enabled);
  }
  hold(pressed: boolean) {
    if (this.closed || this.held === pressed) return;
    if (
      pressed &&
      (!this.controlsReady ||
        this.session?.state !== "active" ||
        this.session.muted ||
        this.session.input_muted)
    )
      return;
    this.held = pressed;
    if (this.pcm && this.session) {
      this.send({
        type: pressed ? "ptt_begin" : "ptt_commit",
        sessionId: this.session.id,
      });
      if (this.audio) this.audio.volume = pressed ? 0.25 : 1;
    }
    this.updateInput();
  }
  async mute(muted: boolean) {
    if (!this.session || this.closed) return;
    if (muted) {
      this.hold(false);
      this.media?.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      this.pcm?.capture(false);
    }
    try {
      this.session = await this.bridge.controlNyxIdVoice(
        this.session.id,
        muted ? "mute" : "unmute",
      );
      this.updateInput();
    } catch {
      this.fail("语音控制暂时无法同步，请重新开始通话。");
    }
  }
  muteSpeaker(muted: boolean) {
    this.speakerMuted = muted;
    if (this.audio) this.audio.muted = muted;
  }
  async resumeAudio() {
    if (!this.audio || this.closed) return;
    this.audio.muted = this.speakerMuted;
    try {
      await this.pcm?.resume();
      await this.audio.play();
    } catch {
      this.callbacks.onError("请点击「恢复声音」播放 NyxID 的回复。");
    }
  }
  async end() {
    if (this.closed) return;
    const session = this.session;
    this.dispose();
    if (session)
      await this.bridge.controlNyxIdVoice(session.id, "end").catch(() => {
        // Lost heartbeat also expires media; never retry session creation here.
        this.callbacks.onError(
          "结束请求暂未确认，NyxID 会在连接过期后关闭语音。",
        );
      });
  }
  private fail(message: string) {
    if (this.closed) return;
    this.callbacks.onError(message);
    void this.end();
  }
  private dispose() {
    this.closed = true;
    this.abort.abort();
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.media?.getTracks().forEach((track) => {
      track.enabled = false;
      track.stop();
    });
    this.pcm?.close();
    this.peer?.close();
    this.audio?.pause();
    if (this.audio) this.audio.srcObject = null;
    if (this.unlisten) void this.unlisten();
    this.pendingEvents = [];
    if (!this.notifiedClosed) {
      this.notifiedClosed = true;
      this.callbacks.onClosed();
    }
  }
  private waitForIce(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", changed);
        this.abort.signal.removeEventListener("abort", aborted);
        if (error) reject(error);
        else resolve();
      };
      const changed = () => {
        if (peer.iceGatheringState === "complete") finish();
      };
      const aborted = () => finish(new Error("通话已结束。"));
      const timer = setTimeout(
        () => finish(new Error("语音网络协商超时，请稍后重试。")),
        5000,
      );
      peer.addEventListener("icegatheringstatechange", changed);
      this.abort.signal.addEventListener("abort", aborted, { once: true });
      if (this.abort.signal.aborted) aborted();
      else changed();
    });
  }
}
