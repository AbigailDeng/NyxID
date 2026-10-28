import {
  ArrowLeft,
  LoaderCircle,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RefreshCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { NyxIdView } from "../runtime";
import type {
  NyxIdVoiceBridge,
  NyxIdVoiceOption,
  NyxIdVoiceSnapshot,
} from "../runtime/voice";
import { NyxIdVoiceClient } from "../runtime/voice-client";
import { Mascot } from "./mascot";

type Phase = "loading" | "ready" | "starting" | "active" | "ended" | "failed";

interface VoicePanelProps {
  readonly companionName: string;
  readonly bridge: NyxIdVoiceBridge;
  readonly nyxIdView: NyxIdView;
  readonly conversationId?: string;
  readonly onConversationReady: (id: string) => void;
  readonly onBack: (conversationId?: string, requestIds?: string[]) => void;
  readonly onConnect: () => Promise<void>;
}

function message(error: unknown): string {
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "语音连接失败，请稍后重试";
}

function priceCopy(option: NyxIdVoiceOption): string {
  const labels: Record<string, string> = {
    voice_seconds: "秒",
    input_tokens: "输入 token",
    output_tokens: "输出 token",
    audio_input_tokens: "音频输入 token",
    audio_output_tokens: "音频输出 token",
    cached_input_tokens: "缓存输入 token",
  };
  const prices = option.pricing
    ? [option.pricing, ...option.pricing.components]
    : [];
  if (option.reported_token_pricing) {
    prices.push(
      option.reported_token_pricing,
      ...option.reported_token_pricing.components,
    );
  }
  const rates = prices.map(
    (price) =>
      `${price.credits_per_unit} 积分 / ${labels[price.metric] ?? price.metric}`,
  );
  const payer =
    option.billing_owner === "organization"
      ? "由当前组织付费。"
      : "由你的 NyxID 账号付费。";
  const own = option.key_source === "own" ? "服务商费用按其规则另行结算。" : "";
  return `${rates.length ? rates.join("；") + "。" : "NyxID 不收取语音费用。"}${option.pricing ? "通话期间持续计费。" : ""}${payer}${own}执行任务可能产生额外费用。`;
}

export function VoicePanel({ ...props }: VoicePanelProps) {
  const [revision, setRevision] = useState(0);
  const owner =
    props.nyxIdView.state === "connected"
      ? props.nyxIdView.user.id
      : "signed-out";
  return (
    <VoiceSessionPanel
      key={`${owner}:${revision}`}
      {...props}
      onRetry={() => setRevision((value) => value + 1)}
    />
  );
}

function VoiceSessionPanel({
  companionName,
  bridge,
  nyxIdView,
  conversationId,
  onConversationReady,
  onBack,
  onConnect,
  onRetry,
}: VoicePanelProps & { readonly onRetry: () => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [options, setOptions] = useState<NyxIdVoiceOption[]>([]);
  const [selected, setSelected] = useState(0);
  const [voice, setVoice] = useState("");
  const [snapshot, setSnapshot] = useState<NyxIdVoiceSnapshot>();
  const [held, setHeld] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string>();
  const client = useRef<NyxIdVoiceClient | undefined>(undefined);
  const thread = useRef(conversationId);
  const readyCallback = useRef(onConversationReady);
  useEffect(() => {
    readyCallback.current = onConversationReady;
  }, [onConversationReady]);
  const connected = nyxIdView.state === "connected";
  const owner = connected ? nyxIdView.user.id : undefined;
  const option = options[selected];
  const active = phase === "active";

  useEffect(() => {
    if (!owner) return;
    let alive = true;
    const next = new NyxIdVoiceClient(bridge, {
      onSnapshot: (value) => {
        if (!alive) return;
        setSnapshot(value);
        setMuted(value.session.muted || value.session.input_muted);
        if (value.session.state === "active") setPhase("active");
        if (
          value.session.state === "closed" ||
          value.session.state === "failed"
        ) {
          setPhase(value.session.state === "failed" ? "failed" : "ended");
          setHeld(false);
        }
      },
      onError: (failure) => {
        if (alive) setError(message(failure));
      },
      onClosed: () => {
        if (alive) {
          setPhase("ended");
          setHeld(false);
        }
      },
    });
    client.current = next;
    void next
      .prepare(thread.current)
      .then((prepared) => {
        if (!alive) return;
        thread.current = prepared.conversationId;
        readyCallback.current(prepared.conversationId);
        setOptions(prepared.options);
        const index = Math.max(
          0,
          prepared.options.findIndex(
            (entry) => entry.available && entry.default_model,
          ),
        );
        const availableIndex = prepared.options[index]?.available
          ? index
          : Math.max(
              0,
              prepared.options.findIndex((entry) => entry.available),
            );
        setSelected(availableIndex);
        setVoice(prepared.options[availableIndex]?.voice.voices[0]?.id ?? "");
        setPhase("ready");
      })
      .catch((failure: unknown) => {
        if (alive) {
          setError(message(failure));
          setPhase("failed");
        }
      });
    return () => {
      alive = false;
      if (client.current === next) client.current = undefined;
      void next.end().catch(() => undefined);
    };
  }, [bridge, owner]);

  useEffect(() => {
    function release() {
      setHeld(false);
      void Promise.resolve(client.current?.hold(false)).catch(
        (failure: unknown) => setError(message(failure)),
      );
    }
    function onVisibility() {
      if (document.hidden) release();
    }
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  async function start() {
    if (!option?.available || phase !== "ready") return;
    const current = client.current;
    setPhase("starting");
    setError(undefined);
    try {
      await current?.start(option, voice || undefined);
    } catch (failure) {
      if (client.current === current) {
        setError(message(failure));
        setPhase("failed");
      }
    }
  }

  function hold(value: boolean) {
    if (!active || (value && muted)) return;
    setHeld(value);
    void Promise.resolve(client.current?.hold(value)).catch(
      (failure: unknown) => {
        setHeld(false);
        setError(message(failure));
      },
    );
  }

  function handleTalkKey(
    event: KeyboardEvent<HTMLButtonElement>,
    pressed: boolean,
  ) {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (!event.repeat) hold(pressed);
  }

  async function end(back = false) {
    if (ending) return;
    const current = client.current;
    setEnding(true);
    setHeld(false);
    try {
      await current?.end();
      if (client.current !== current) return;
      setPhase("ended");
      if (back)
        onBack(
          thread.current,
          snapshot?.tasks.map((task) => task.id),
        );
    } catch (failure) {
      if (client.current === current) setError(message(failure));
    } finally {
      if (client.current === current) setEnding(false);
    }
  }

  async function toggleMute() {
    const current = client.current;
    hold(false);
    try {
      await current?.mute(!muted);
      if (client.current === current) setMuted(!muted);
    } catch (failure) {
      if (client.current === current) setError(message(failure));
    }
  }

  const lastCaption = snapshot?.captions.at(-1);
  const speaking =
    active && lastCaption?.speaker === "assistant" && !lastCaption.complete;
  const status = held
    ? "正在听你说话…"
    : active
      ? muted
        ? "麦克风已静音"
        : speaking
          ? `${companionName} 正在说话`
          : "按住按钮，和 NyxID 说话"
      : phase === "starting"
        ? "正在连接语音…"
        : phase === "ended"
          ? "通话已结束"
          : phase === "loading" && connected
            ? "正在准备语音…"
            : "与 NyxID 语音通话";

  return (
    <main className="panel voice-panel" aria-labelledby="voice-title">
      <div className="panel-toolbar" data-window-drag-handle>
        <button
          type="button"
          className="bare-icon"
          aria-label="返回文字对话"
          disabled={ending}
          onClick={() => void end(true)}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <h1 id="voice-title">{companionName} · 语音</h1>
        <span
          className={`voice-connection-dot${active ? " is-active" : ""}`}
          aria-label={active ? "语音已连接" : "语音未连接"}
        />
      </div>
      <div className="voice-scroll">
        <div className={`voice-avatar${held ? " is-listening" : ""}`}>
          <Mascot
            state={
              held
                ? "listening"
                : speaking
                  ? "speaking"
                  : active
                    ? "happy"
                    : "idle"
            }
            size={154}
          />
        </div>
        <strong className="voice-status" role="status">
          {status}
        </strong>
        {!connected ? (
          <div className="voice-setup">
            <p>
              {nyxIdView.state === "unavailable"
                ? "请打开桌面版小精灵，连接 NyxID 后开始语音对话。"
                : "连接 NyxID 后，就能通过小精灵进行语音对话。"}
            </p>
            <button
              type="button"
              className="primary-button"
              disabled={
                nyxIdView.state === "checking" ||
                nyxIdView.state === "authorizing" ||
                nyxIdView.state === "unavailable"
              }
              onClick={() =>
                void onConnect().catch((failure: unknown) =>
                  setError(message(failure)),
                )
              }
            >
              {nyxIdView.state === "authorizing"
                ? "等待浏览器确认"
                : "连接 NyxID"}
            </button>
          </div>
        ) : null}
        {connected && phase === "loading" ? (
          <LoaderCircle
            className="voice-loading is-spinning"
            aria-hidden="true"
          />
        ) : null}
        {connected && phase === "ready" ? (
          <div className="voice-setup">
            {options.length ? (
              <>
                <label className="field">
                  <span>语音服务</span>
                  <select
                    value={selected}
                    onChange={(event) => {
                      const index = Number(event.target.value);
                      setSelected(index);
                      setVoice(options[index]?.voice.voices[0]?.id ?? "");
                    }}
                  >
                    {options.map((entry, index) => (
                      <option
                        key={`${entry.service_id}:${entry.connection_id}:${entry.model}:${entry.key_source}`}
                        value={index}
                        disabled={!entry.available}
                      >
                        {entry.model_label} ·{" "}
                        {entry.key_source === "own" ? "自己的连接" : "平台服务"}
                        {entry.available ? "" : "（暂不可用）"}
                      </option>
                    ))}
                  </select>
                </label>
                {option?.voice.voices.length ? (
                  <label className="field">
                    <span>声音</span>
                    <select
                      value={voice}
                      onChange={(event) => setVoice(event.target.value)}
                    >
                      {option.voice.voices.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <p className="voice-pricing">
                  {option ? priceCopy(option) : "请先选择可用的语音服务。"}
                </p>
                {!option?.available ? (
                  <p className="form-error">
                    {option?.unavailable_reason ?? "此语音服务暂不可用"}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="primary-button"
                  disabled={!option?.available}
                  onClick={() => void start()}
                >
                  <Phone aria-hidden="true" />
                  开始语音通话
                </button>
                <p className="voice-privacy">
                  开始后使用麦克风；按住说话，松开后发送。通话内容进入当前 NyxID
                  对话。
                </p>
              </>
            ) : (
              <p>
                当前账号没有可用的语音服务。请先在 NyxID
                中启用语音并连接支持语音的服务。
              </p>
            )}
          </div>
        ) : null}
        {error ? (
          <p className="form-error voice-error" role="alert">
            {error}
          </p>
        ) : null}
        {snapshot?.session.idle_warning ? (
          <p className="voice-notice">长时间没有说话，通话即将自动结束。</p>
        ) : null}
        {snapshot?.captions.length ? (
          <ol
            className="voice-captions"
            aria-label="语音字幕"
            aria-live="polite"
          >
            {snapshot.captions.slice(-8).map((caption) => (
              <li
                key={caption.id}
                className={`voice-caption--${caption.speaker}`}
              >
                <span>{caption.speaker === "user" ? "你" : companionName}</span>
                <p>{caption.text || "…"}</p>
              </li>
            ))}
          </ol>
        ) : null}
        {snapshot?.tasks.some((task) =>
          ["queued", "claimed", "awaiting_confirmation"].includes(task.state),
        ) ? (
          <div className="voice-notice">
            NyxID 正在处理你交代的事情。需要确认的操作请回到 NyxID
            查看；挂断后任务会继续。
          </div>
        ) : null}
        {phase === "failed" || phase === "ended" ? (
          <div className="voice-setup">
            <button
              type="button"
              className="secondary-button"
              onClick={onRetry}
            >
              <RefreshCw aria-hidden="true" />
              重新准备语音
            </button>
          </div>
        ) : null}
      </div>
      <div className="voice-controls">
        {active ? (
          <>
            <div className="voice-control-row">
              <button
                type="button"
                className="chat-settings-button"
                aria-label={muted ? "取消麦克风静音" : "静音麦克风"}
                onClick={() => void toggleMute()}
              >
                {muted ? (
                  <MicOff aria-hidden="true" />
                ) : (
                  <Mic aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className={`voice-talk-button${held ? " is-held" : ""}`}
                disabled={muted || ending}
                aria-label="按住说话"
                aria-pressed={held}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  hold(true);
                }}
                onPointerUp={() => hold(false)}
                onPointerCancel={() => hold(false)}
                onLostPointerCapture={() => hold(false)}
                onBlur={() => hold(false)}
                onKeyDown={(event) => handleTalkKey(event, true)}
                onKeyUp={(event) => handleTalkKey(event, false)}
              >
                <Mic aria-hidden="true" />
                {held ? "松开发送" : "按住说话"}
              </button>
              <button
                type="button"
                className="chat-settings-button"
                aria-label={speakerMuted ? "打开扬声器" : "静音扬声器"}
                onClick={() => {
                  const value = !speakerMuted;
                  void Promise.resolve(client.current?.muteSpeaker(value))
                    .then(() => setSpeakerMuted(value))
                    .catch((failure: unknown) => setError(message(failure)));
                }}
              >
                {speakerMuted ? (
                  <VolumeX aria-hidden="true" />
                ) : (
                  <Volume2 aria-hidden="true" />
                )}
              </button>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => void client.current?.resumeAudio()}
            >
              恢复声音
            </button>
            <button
              type="button"
              className="voice-end-button"
              disabled={ending}
              onClick={() => void end()}
            >
              <PhoneOff aria-hidden="true" />
              {ending ? "正在挂断" : "结束通话"}
            </button>
          </>
        ) : phase === "starting" ? (
          <button
            type="button"
            className="secondary-button"
            disabled={ending}
            onClick={() => void end()}
          >
            <PhoneOff aria-hidden="true" />
            取消连接
          </button>
        ) : (
          <button
            type="button"
            className="text-button"
            disabled={ending}
            onClick={() => void end(true)}
          >
            返回文字对话
          </button>
        )}
      </div>
    </main>
  );
}
