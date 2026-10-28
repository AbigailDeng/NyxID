import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NyxIdView } from "../runtime/nyxid";
import type {
  NyxIdVoiceBridge,
  NyxIdVoiceOptions,
  NyxIdVoiceSnapshot,
} from "../runtime/voice";
import { VoicePanel } from "./voice-panel";

type Callbacks = {
  onSnapshot(snapshot: NyxIdVoiceSnapshot): void;
  onError(message: string): void;
  onClosed(): void;
};
interface MockClient {
  callbacks: Callbacks;
  prepare: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  hold: ReturnType<typeof vi.fn>;
  mute: ReturnType<typeof vi.fn>;
  muteSpeaker: ReturnType<typeof vi.fn>;
  resumeAudio: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}
const { instances, prepareCall } = vi.hoisted(() => ({
  instances: [] as MockClient[],
  prepareCall: vi.fn(),
}));
vi.mock("../runtime/voice-client", () => ({
  NyxIdVoiceClient: class {
    prepare = vi.fn((id?: string) => prepareCall(id));
    start = vi.fn(async () => undefined);
    hold = vi.fn();
    mute = vi.fn(async () => undefined);
    muteSpeaker = vi.fn();
    resumeAudio = vi.fn(async () => undefined);
    end = vi.fn(async () => undefined);
    constructor(
      _bridge: NyxIdVoiceBridge,
      readonly callbacks: Callbacks,
    ) {
      void _bridge;
      instances.push(this);
    }
  },
}));

const conversationId = "nyxa-0123456789abcdef0123456789abcdef";
const prepared: NyxIdVoiceOptions = {
  conversationId,
  options: [
    {
      service_id: "123e4567-e89b-42d3-a456-426614174001",
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
      pricing: {
        metric: "voice_seconds",
        credits_per_unit: "0.25",
        sync_status: "synced",
        components: [
          {
            metric: "audio_input_tokens",
            credits_per_unit: "0.001",
            sync_status: "synced",
          },
        ],
      },
    },
    {
      service_id: "123e4567-e89b-42d3-a456-426614174002",
      connection_id: null,
      key_source: "own",
      model: "grok-voice",
      model_label: "Grok",
      default_model: false,
      voice: {
        protocol: "xai_realtime",
        voices: [
          { id: "ara", label: "Ara" },
          { id: "rex", label: "Rex" },
        ],
      },
      available: true,
      unavailable_reason: null,
      pricing: null,
    },
  ],
};
function connected(owner = "owner-1"): NyxIdView {
  return {
    state: "connected",
    user: { id: owner, email: `${owner}@example.com`, displayName: "小葵" },
    capabilities: {
      enabledCount: 0,
      disabledCount: 0,
      attentionCount: 0,
      checkedAt: "2026-10-28T00:00:00Z",
      services: [],
    },
  };
}
function snapshot(): NyxIdVoiceSnapshot {
  return {
    type: "snapshot",
    session: {
      id: "123e4567-e89b-42d3-a456-426614174000",
      generation: 1,
      state: "active",
      muted: false,
      input_muted: false,
      control_revision: 0,
      observed_seconds: 1,
      end_reason: null,
      idle_warning: false,
    },
    captions: [],
    tasks: [],
  };
}
function setup(view = connected()) {
  const bridge: NyxIdVoiceBridge = {
    nyxIdVoiceRequest: vi.fn(),
    cancelNyxIdVoiceRequest: vi.fn(),
    nyxIdVoiceOptions: vi.fn(),
    startNyxIdVoice: vi.fn(),
    controlNyxIdVoice: vi.fn(),
    sendNyxIdVoiceFrame: vi.fn(),
    onNyxIdVoiceEvent: vi.fn(),
  };
  const props = {
    companionName: "Nyx",
    bridge,
    nyxIdView: view,
    onConversationReady: vi.fn(),
    onBack: vi.fn(),
    onConnect: vi.fn(async () => undefined),
  };
  const rendered = render(<VoicePanel {...props} />);
  return { ...rendered, props };
}
async function activate() {
  const user = userEvent.setup();
  const rendered = setup();
  await user.click(await screen.findByRole("button", { name: "开始语音通话" }));
  const client = instances[0]!;
  act(() => client.callbacks.onSnapshot(snapshot()));
  return { ...rendered, user, client };
}

beforeEach(() => {
  instances.length = 0;
  vi.clearAllMocks();
  prepareCall.mockResolvedValue(prepared);
});

describe("NyxID voice panel", () => {
  it("prepares choices without starting media and waits for an active server snapshot", async () => {
    const user = userEvent.setup();
    const { props } = setup();
    const start = await screen.findByRole("button", { name: "开始语音通话" });
    const client = instances[0]!;
    expect(client.start).not.toHaveBeenCalled();
    expect(props.onConversationReady).toHaveBeenCalledWith(conversationId);
    expect(screen.getByText(/0.25 积分 \/ 秒/)).toBeInTheDocument();
    expect(
      screen.getByText(/0.001 积分 \/ 音频输入 token/),
    ).toBeInTheDocument();

    await user.click(start);
    expect(client.start).toHaveBeenCalledWith(prepared.options[0], "alloy");
    expect(screen.getByRole("status")).toHaveTextContent("正在连接语音");
    expect(
      screen.queryByRole("button", { name: "按住说话" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消连接" })).toBeEnabled();

    act(() => client.callbacks.onSnapshot(snapshot()));
    expect(screen.getByRole("button", { name: "按住说话" })).toBeEnabled();
    expect(screen.getByLabelText("语音已连接")).toBeInTheDocument();
  });

  it("uses the selected provider and voice with its applicable pricing message", async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "语音服务" }),
      "1",
    );
    expect(screen.getByRole("combobox", { name: "声音" })).toHaveValue("ara");
    expect(screen.getByText(/服务商费用按其规则另行结算/)).toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "声音" }),
      "rex",
    );
    await user.click(screen.getByRole("button", { name: "开始语音通话" }));
    expect(instances[0]!.start).toHaveBeenCalledWith(
      prepared.options[1],
      "rex",
    );
  });

  it("releases push-to-talk on pointer cancellation, keyboard release, and window blur", async () => {
    const { client } = await activate();
    const talk = screen.getByRole("button", { name: "按住说话" });
    fireEvent.pointerDown(talk, { button: 0, pointerId: 1 });
    expect(client.hold).toHaveBeenLastCalledWith(true);
    expect(talk).toHaveAttribute("aria-pressed", "true");
    fireEvent.pointerCancel(talk, { pointerId: 1 });
    expect(client.hold).toHaveBeenLastCalledWith(false);
    expect(talk).toHaveAttribute("aria-pressed", "false");

    fireEvent.keyDown(talk, { key: " " });
    expect(client.hold).toHaveBeenLastCalledWith(true);
    fireEvent.keyUp(talk, { key: " " });
    expect(client.hold).toHaveBeenLastCalledWith(false);
    fireEvent.keyDown(talk, { key: "Enter" });
    expect(client.hold).toHaveBeenLastCalledWith(true);
    fireEvent(window, new Event("blur"));
    expect(client.hold).toHaveBeenLastCalledWith(false);
    expect(talk).toHaveAttribute("aria-pressed", "false");
  });

  it("releases the microphone before muting and ends the call before returning to chat", async () => {
    const { user, client, props, unmount } = await activate();
    await user.click(screen.getByRole("button", { name: "静音麦克风" }));
    expect(client.hold).toHaveBeenLastCalledWith(false);
    expect(client.mute).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "按住说话" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "取消麦克风静音" }));
    expect(client.mute).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "按住说话" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "静音扬声器" }));
    expect(client.muteSpeaker).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole("button", { name: "返回文字对话" }));
    expect(client.end).toHaveBeenCalledOnce();
    expect(props.onBack).toHaveBeenCalledWith(conversationId, []);
    unmount();
    expect(client.end).toHaveBeenCalledTimes(2);
  });

  it("preserves actionable client errors and lets the user resume blocked playback", async () => {
    const { user, client } = await activate();
    act(() =>
      client.callbacks.onError("请点击「恢复声音」播放 NyxID 的回复。"),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "请点击「恢复声音」播放 NyxID 的回复。",
    );
    await user.click(screen.getByRole("button", { name: "恢复声音" }));
    expect(client.resumeAudio).toHaveBeenCalledOnce();
  });

  it("requires connection before preparing a voice session", async () => {
    const user = userEvent.setup();
    const { props } = setup({ state: "signed_out" });
    expect(instances).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "开始语音通话" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "连接 NyxID" }));
    expect(props.onConnect).toHaveBeenCalledOnce();
    expect(instances).toHaveLength(0);
  });

  it("ends the previous owner's client and ignores its late snapshots and errors", async () => {
    const { props, rerender, unmount } = setup();
    await screen.findByRole("button", { name: "开始语音通话" });
    const previous = instances[0]!;
    rerender(<VoicePanel {...props} nyxIdView={connected("owner-2")} />);
    await waitFor(() => expect(instances).toHaveLength(2));
    expect(previous.end).toHaveBeenCalledOnce();
    await screen.findByRole("button", { name: "开始语音通话" });

    act(() => {
      previous.callbacks.onSnapshot(snapshot());
      previous.callbacks.onError("旧账号的错误");
    });
    expect(
      screen.queryByRole("button", { name: "按住说话" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("旧账号的错误")).not.toBeInTheDocument();
    unmount();
    expect(instances[1]!.end).toHaveBeenCalledOnce();
  });

  it("ignores completion of an old owner's pending end after a new client starts", async () => {
    const { user, client: previous, props, rerender } = await activate();
    let finishEnd: (() => void) | undefined;
    previous.end.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishEnd = resolve;
      }),
    );
    await user.click(screen.getByRole("button", { name: "返回文字对话" }));
    rerender(<VoicePanel {...props} nyxIdView={connected("owner-2")} />);
    await user.click(
      await screen.findByRole("button", { name: "开始语音通话" }),
    );

    await act(async () => finishEnd?.());
    expect(props.onBack).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("正在连接语音");
    expect(screen.getByRole("button", { name: "取消连接" })).toBeEnabled();
  });
});
