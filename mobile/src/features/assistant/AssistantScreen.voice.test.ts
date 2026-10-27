import assert from "node:assert/strict";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";
import { deferred, hookHarness } from "./assistantHookTestHarness";
import type { AssistantUploadedMessage } from "./AssistantUploadSession";
import * as voiceSelection from "./voice/voiceSelection";
import {
  acknowledgementSchema,
  type AssistantAcknowledgement,
} from "./assistantTypes";

// Exercise the screen's real handlers and render conditions. Native UI, network,
// and existing assistant/upload hooks are boundaries, not reimplementations of
// the voice entry flow under test.
type Element = { type: unknown; props: Record<string, any>; key?: unknown };
const A = `nyxa-${"a".repeat(32)}`;
const B = `nyxa-${"b".repeat(32)}`;

function expand(element: Element): Element {
  if (typeof element.type === "function")
    return expand((element.type as (props: unknown) => Element)(element.props));
  return {
    ...element,
    props: {
      ...element.props,
      children: [element.props.children]
        .flat(Infinity)
        .map((child) =>
          child && typeof child === "object" && "props" in child
            ? expand(child)
            : child,
        ),
    },
  };
}
function elements(element: Element): Element[] {
  return [
    element,
    ...element.props.children
      .flat(Infinity)
      .flatMap((child: unknown) =>
        child && typeof child === "object" && "props" in child
          ? elements(child as Element)
          : [],
      ),
  ];
}

// The shared composer controls are exercised through their accessible button contract.
function composerButton(props: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}): Element {
  return {
    type: "Pressable",
    props: {
      accessibilityLabel: props.label,
      disabled: props.disabled,
      onPress: props.onPress,
      children: [],
    },
  };
}

// Exercise enabled and unavailable server/runtime admission separately.
function setup(conversationId?: string, enableVoiceForTest = true) {
  const draft = deferred<string>();
  const events: unknown[][] = [];
  const drafts: { agentId: string; signal: AbortSignal }[] = [];
  const featureQueries: { enabled: boolean }[] = [];
  let epoch = 7;
  let features: string[] | undefined = ["assistant:voice"];
  const agent = {
    id: "agent-a",
    name: "nyxbot",
    display_name: "NyxBot",
    can_use: true,
    kind: "nyxbot",
    status: "idle",
    model: "nyxagent/chat",
  };
  function history(id: string) {
    return {
      conversation: {
        id,
        title: "Saved chat",
        model: "nyxagent/chat",
        agent,
        active_turn: null,
      } as Record<string, any>,
      messages: [],
      waiting: [],
      acknowledgements: [] as AssistantAcknowledgement[],
      approvals: [],
    };
  }
  const assistant = {
    agent,
    agentId: agent.id,
    conversationId,
    history: conversationId ? history(conversationId) : undefined,
    models: [],
    model: "nyxagent/chat",
    agents: [agent],
    conversations: [],
    inputAttachments: [],
    online: true,
    sending: false,
    loading: false,
    loadingOlder: false,
    recoveryRequired: false,
    mutating: false,
    openConversation: (id?: string, ack?: string) => {
      events.push(["open", id, ack]);
      assistant.conversationId = id;
      assistant.history = id ? history(id) : undefined;
    },
    recover: async () => {
      events.push(["recover"]);
    },
    send: async (
      text: string,
      _options?: unknown,
      files?: AssistantUploadedMessage,
    ) => {
      events.push(["send", text, files]);
      return true;
    },
    stop: async () => {
      events.push(["stop"]);
    },
  };
  const uploads = {
    files: [] as any[],
    session: {
      sending: false,
      submit: async (
        submit: (
          payload: AssistantUploadedMessage | undefined,
        ) => Promise<unknown>,
      ) => submit(undefined),
    },
    blocked: false,
    picking: false,
    pick: async () => {},
    choose: () => events.push(["choose-attachment"]),
    remove: (key: string) => {
      uploads.files = uploads.files.filter((file) => file.key !== key);
    },
  };
  const props = {
    route: {
      params: { agentId: agent.id, conversationId },
    },
  };
  const harness = hookHarness<Element>({
    "../display/ChatLayoutContext": {
      useComposerHeight: () => 120,
      useChatColumn: () => ({
        width: "100%",
        maxWidth: 758,
        alignSelf: "center",
      }),
    },
    "../../components/workspace/ScrollEdgeFades": {
      ScrollEdgeFades: "ScrollEdgeFades",
      useScrollEdges: () => ({
        edges: { start: false, end: false },
        layout: (height: number) => events.push(["fade-layout", height]),
        content: (height: number) => events.push(["fade-content", height]),
        scroll: (offset: number) => events.push(["fade-scroll", offset]),
      }),
    },
    "react/jsx-runtime": {
      Fragment: "Fragment",
      jsx: (type: unknown, props: unknown, key?: unknown) => ({
        type,
        props,
        key,
      }),
      jsxs: (type: unknown, props: unknown, key?: unknown) => ({
        type,
        props,
        key,
      }),
    },
    "react-native": {
      ...Object.fromEntries(
        [
          "ActivityIndicator",
          "FlatList",
          "Modal",
          "Pressable",
          "ScrollView",
          "Text",
          "View",
        ].map((name) => [name, name]),
      ),
      Alert: { alert: () => {} },
      Keyboard: { dismiss: () => events.push(["dismissKeyboard"]) },
      StyleSheet: { create: (value: unknown) => value },
    },
    "@react-navigation/native": {
      useNavigation: () => ({
        setParams: (params: Record<string, unknown>) => {
          events.push(["params", { ...params }]);
        },
        dispatch: () => {},
        goBack: () => {},
      }),
    },
    "@tanstack/react-query": {
      useQuery: (options: { enabled: boolean }) => {
        featureQueries.push(options);
        return { data: features };
      },
    },
    "expo-web-browser": { openBrowserAsync: async () => {} },
    "react-native-markdown-display": {
      default: "Markdown",
      MarkdownIt: () => ({}),
      __esModule: true,
    },
    "lucide-react-native": Object.fromEntries(
      [
        "ChevronDown",
        "Check",
        "MoreHorizontal",
        "Paperclip",
        "SquarePen",
        "ArrowUp",
        "Square",
        "X",
        "Mic",
      ].map((name) => [name, name]),
    ),
    "../../app/WorkspaceHeader": {
      useWorkspaceBack: () => {},
      WorkspaceHeaderVisibility: "WorkspaceHeaderVisibility",
    },
    "../../app/navigationHierarchy": {},
    "../../components/workspace/WorkspaceUI": Object.fromEntries(
      ["WorkspacePage", "ActionButton", "Card", "Field", "Label", "Notice"].map(
        (name) => [name, name],
      ),
    ),
    "../../theme/ThemeContext": { useTheme: () => ({ colors: {} }) },
    "./useAssistant": { useAssistant: () => assistant },
    "./useAssistantUploads": { useAssistantUploads: () => uploads },
    "./useComposerDictation": {
      useComposerDictation: () => ({ active: false, phase: "idle" }),
      appendDictation: (draft: string, text: string) =>
        `${draft}${draft ? " " : ""}${text}`,
    },
    "./ComposerDictation": {
      ComposerDictationButton: () =>
        composerButton({ label: "Dictate message", onPress: () => {} }),
      ComposerDictationReview: "ComposerDictationReview",
    },
    "./useTranscriptScrollFollow": {
      useTranscriptScrollFollow: () => ({
        following: true,
        listProps: {
          onLayout: (event: any) =>
            events.push(["follow-layout", event.nativeEvent.layout.height]),
          onContentSizeChange: (_width: number, height: number) =>
            events.push(["follow-content", height]),
          onScroll: (event: any) =>
            events.push(["follow-scroll", event.nativeEvent.contentOffset.y]),
          onScrollBeginDrag: () => events.push(["follow-drag"]),
        },
        follow: () => {},
        pause: () => {},
      }),
    },
    "./AssistantActivityDisclosure": {
      AssistantActivityDisclosure: "AssistantActivityDisclosure",
    },
    "./AssistantAcknowledgements": {
      AssistantAcknowledgements: "AssistantAcknowledgements",
    },
    "./AssistantCopyButton": { AssistantCopyButton: "AssistantCopyButton" },
    "./AssistantAttachmentView": {
      AssistantAttachmentView: "AssistantAttachmentView",
    },
    "./AssistantPendingUploads": {
      AssistantPendingUploads: "AssistantPendingUploads",
    },
    "./AssistantMentionInput": {
      AssistantMentionInput: (props: {
        renderActions?: (mention: null) => unknown;
      }) => ({
        type: "AssistantMentionInput",
        props: { ...props, children: props.renderActions?.(null) },
      }),
    },
    "./ChatComposer": {
      ChatComposerFrame: ({ children }: { children: unknown }) => ({
        type: "ChatComposerFrame",
        props: { children },
      }),
      ChatComposerRow: ({ children }: { children: unknown }) => ({
        type: "ChatComposerRow",
        props: { children },
      }),
      ComposerAttachButton: composerButton,
      ComposerSubmitButton: composerButton,
    },
    "./assistantSelectableMarkdown": { assistantSelectableMarkdown: {} },
    "../plugins/NativeAuthoredSkillReview": {
      NativeAuthoredSkillReview: "NativeAuthoredSkillReview",
    },
    "../../lib/env": { NYXID_FRONTEND_URL: "https://nyx.example" },
    "./voice/AssistantVoiceConversation": {
      AssistantVoiceConversation: "AssistantVoiceConversation",
    },
    "./voice/voiceSelection": {
      ...voiceSelection,
      NATIVE_VOICE_ENTRY_ENABLED: enableVoiceForTest,
    },
    "../../lib/api/assistantVoiceApi": {
      assistantVoiceFeatures: async () => features,
    },
    "../../lib/api/assistantUploadsApi": {
      assistantUploadsApi: {
        createDraft: (agentId: string, signal: AbortSignal) => {
          drafts.push({ agentId, signal });
          return draft.promise;
        },
      },
    },
    "../../lib/auth/authEpoch": { getAuthEpoch: () => epoch },
  });
  const Screen = harness.load(
    fileURLToPath(new URL("./AssistantScreen.tsx", import.meta.url)),
  ).AssistantScreen as (input: typeof props) => Element;
  harness.mount(() => expand(Screen(props)));
  const all = () => elements(harness.value());
  const button = (name: string) =>
    all().find((element) => element.props.accessibilityLabel === name);
  const voice = () =>
    all().find((element) => element.type === "AssistantVoiceConversation");
  return {
    harness,
    assistant,
    uploads,
    props,
    events,
    drafts,
    featureQueries,
    draft,
    all,
    button,
    voice,
    input: () =>
      all().find((element) => element.type === "AssistantMentionInput")!,
    setEpoch: (value: number) => {
      epoch = value;
    },
    setFeatures: (value: string[] | undefined) => {
      features = value;
      harness.render();
    },
  };
}

test("eligible native composers expose distinct attachments, dictation and voice actions", () => {
  for (const id of [undefined, A]) {
    const x = setup(id, voiceSelection.NATIVE_VOICE_ENTRY_ENABLED);
    assert.ok(x.button("Open voice call"));
    assert.equal(x.voice(), undefined);
    assert.ok(x.button("Attach files or photos"));
    assert.ok(x.button("Dictate message"));
    assert.equal(x.featureQueries.at(-1)?.enabled, true);
    x.button("Attach files or photos")!.props.onPress();
    assert.deepEqual(x.events.at(-1), ["choose-attachment"]);
    assert.equal(x.drafts.length, 0);
    x.harness.unmount();
  }
});

test("the chat screen routes authoritative confirmations through compact history while retaining pending actions", () => {
  const x = setup(A, false);
  const row = acknowledgementSchema.parse({
    id: "d9428888-122b-41e1-85c5-61cd3cbb3210",
    kind: "action",
    status: "pending",
    summary: "Create Twitter assistant",
    service_name: null,
    service_slug: null,
    tool_name: "nyxid__spawn_subagent",
    created_at: "2026-10-16T00:00:00Z",
    expires_at: "2099-10-16T00:15:00Z",
  });
  x.assistant.history!.acknowledgements = [row];
  x.harness.render();
  const footer = () =>
    elements(
      expand(
        x.all().find((node) => node.type === "FlatList")!.props
          .ListFooterComponent,
      ),
    );
  let confirmations = footer().find(
    (node) => node.type === "AssistantAcknowledgements",
  )!;
  assert.equal(confirmations.key, A);
  assert.equal(confirmations.props.acknowledgements[0], row);
  const pending = elements(expand(confirmations.props.renderPending(row)));
  assert.ok(pending.find((node) => node.props.label === "Allow"));
  assert.ok(pending.find((node) => node.props.label === "Deny"));
  row.status = "used";
  x.harness.render();
  confirmations = footer().find(
    (node) => node.type === "AssistantAcknowledgements",
  )!;
  assert.equal(confirmations.props.acknowledgements[0].status, "used");
  assert.equal(confirmations.props.renderPending(row), null);
  assert.equal(
    footer().some((node) => node.type === "Card"),
    false,
  );
  x.harness.unmount();
});

test("empty chat creates exactly one real draft and adopts it before opening voice", async () => {
  const x = setup();
  const open = x.button("Open voice call")!;
  open.props.onPress();
  open.props.onPress();
  x.harness.flush();
  assert.equal(x.drafts.length, 1);
  assert.equal(x.drafts[0]!.agentId, "agent-a");
  assert.equal(x.drafts[0]!.signal.aborted, false);
  assert.equal(x.button("Open voice call")?.props.disabled, true);
  assert.equal(x.voice(), undefined);
  x.draft.resolve(A);
  await x.harness.settle();
  assert.equal(x.voice()?.props.thread, A);
  assert.deepEqual(
    x.events.filter(([name]) => name === "open"),
    [["open", A, undefined]],
  );
  assert.deepEqual(
    x.events.find(([name]) => name === "params"),
    [
      "params",
      { conversationId: A, acknowledgementId: undefined, openLatest: false },
    ],
  );
  assert.equal(
    x.events.some(([name]) => name === "send"),
    false,
  );
  x.harness.unmount();
});

test("saved chat opens voice directly without creating a new draft or replacing its identity", async () => {
  const x = setup(A);
  x.button("Open voice call")!.props.onPress();
  await x.harness.settle();
  assert.equal(x.drafts.length, 0);
  assert.equal(x.voice()?.props.thread, A);
  assert.equal(
    x.events.some(([name]) => name === "open"),
    false,
  );
  assert.equal(
    x.events.some(([name]) => name === "params"),
    false,
  );
  x.harness.unmount();
});

test("voice and transcript retain distinct sibling identities for both adopted drafts and saved chats", async () => {
  for (const initialId of [undefined, A]) {
    const x = setup(initialId);
    x.button("Open voice call")!.props.onPress();
    if (!initialId) x.draft.resolve(A);
    await x.harness.settle();
    const children = x.harness.value().props.children as Element[];
    const keyed = children.filter((child) => child?.key != null);
    assert.ok(keyed.some((child) => child.key === "transcript-column"));
    assert.ok(
      keyed.some((child) => child.type === "AssistantVoiceConversation"),
    );
    assert.equal(
      new Set(keyed.map((child) => child.key)).size,
      keyed.length,
      "a transcript and its voice surface share a conversation, but need unique sibling keys",
    );
    const transcript = x.all().find((element) => element.type === "FlatList")!;
    const originalTranscriptKey = transcript.key;
    x.voice()!.props.onClose();
    x.harness.flush();
    assert.equal(x.voice(), undefined);
    assert.equal(
      x.all().find((element) => element.type === "FlatList")!.key,
      originalTranscriptKey,
      "closing voice must preserve the existing transcript identity",
    );
    x.harness.unmount();
  }
});

test("voice entry yields to text, attachments, upload work and the active turn's Stop action", async () => {
  const x = setup(A);
  assert.ok(x.button("Open voice call"));
  x.input().props.onChangeText("Keep my draft");
  x.harness.flush();
  assert.equal(x.button("Open voice call"), undefined);
  assert.equal(x.button("Send message")?.props.disabled, false);
  x.input().props.onChangeText("");
  x.uploads.files = [
    { key: "file", handle: "file_1", kind: "file", file: { name: "note.txt" } },
  ];
  x.harness.render();
  assert.equal(x.button("Open voice call"), undefined);
  assert.equal(x.button("Send message")?.props.disabled, false);
  x.uploads.files = [];
  x.uploads.picking = true;
  x.harness.render();
  assert.equal(x.button("Open voice call"), undefined);
  assert.equal(x.button("Send message")?.props.disabled, true);
  x.uploads.picking = false;
  x.assistant.sending = true;
  x.harness.render();
  assert.equal(x.button("Open voice call"), undefined);
  assert.equal(x.button("Send message"), undefined);
  assert.equal(x.button("Stop assistant")?.props.disabled, undefined);
  x.button("Stop assistant")!.props.onPress();
  await x.harness.settle();
  assert.equal(x.events.filter(([name]) => name === "stop").length, 1);
  assert.equal(x.drafts.length, 0);
  x.harness.unmount();
});

test("private attachments send directly without mention aliases or rewriting the draft", async () => {
  const x = setup(A);
  const file = {
    key: "report",
    handle: "file-1",
    kind: "file",
    file: { name: "report.txt" },
  };
  const text = "Please check @file-1 in this report";
  const payload: AssistantUploadedMessage = {
    conversationId: A,
    attachmentIds: ["11111111-1111-4111-8111-111111111111"],
    attachments: [],
  };
  x.uploads.files = [file];
  x.input().props.onChangeText(text);
  x.harness.flush();
  assert.equal(x.input().props.mentions, undefined);
  const pending = x
    .all()
    .find((element) => element.type === "AssistantPendingUploads")!;
  assert.equal(pending.props.showMentionHandles, false);
  pending.props.remove(file.key);
  x.harness.render();
  assert.equal(
    x.input().props.value,
    text,
    "removing a file must preserve the user's text",
  );
  assert.equal(x.uploads.files.length, 0);
  x.uploads.files = [file];
  x.uploads.session.submit = async (submit) => submit(payload);
  x.harness.render();
  x.button("Send message")!.props.onPress();
  await x.harness.settle();
  assert.deepEqual(
    x.events.find(([name]) => name === "send"),
    ["send", text, payload],
  );
  assert.equal(x.input().props.value, "");
  x.harness.unmount();
});

test("the server feature flag and eligible chat context determine whether voice is shown", () => {
  const x = setup(A);
  x.setFeatures(undefined);
  assert.equal(x.button("Open voice call"), undefined);
  x.setFeatures([]);
  assert.equal(x.button("Open voice call"), undefined);
  x.setFeatures(["assistant:voice"]);
  assert.ok(x.button("Open voice call"));
  for (const context of [
    { channel: { platform: "telegram" } },
    { role: "subagent" },
    { agent: { ...x.assistant.agent, destroyed: true } },
  ]) {
    Object.assign(x.assistant.history!.conversation, context);
    x.harness.render();
    assert.equal(x.button("Open voice call"), undefined);
    delete x.assistant.history!.conversation.channel;
    delete x.assistant.history!.conversation.role;
    x.assistant.history!.conversation.agent = x.assistant.agent;
  }
  x.harness.unmount();
});

test("switching chat while draft creation is pending aborts it and ignores its late result", async () => {
  const x = setup();
  x.button("Open voice call")!.props.onPress();
  x.props.route.params.conversationId = B;
  x.assistant.openConversation(B);
  x.harness.render();
  assert.equal(x.drafts[0]!.signal.aborted, true);
  x.draft.resolve(A);
  await x.harness.settle();
  assert.equal(x.assistant.conversationId, B);
  assert.equal(x.voice(), undefined);
  assert.equal(
    x.events.some(([name]) => name === "params"),
    false,
  );
  assert.equal(
    x.events.some(([name, id]) => name === "open" && id === A),
    false,
  );
  x.harness.unmount();
});

test("switching account while draft creation is pending cannot adopt or open the old account's result", async () => {
  const x = setup();
  x.button("Open voice call")!.props.onPress();
  x.setEpoch(8);
  x.harness.render();
  x.draft.resolve(A);
  await x.harness.settle();
  assert.equal(x.assistant.conversationId, undefined);
  assert.equal(x.voice(), undefined);
  assert.equal(
    x.events.some(([name]) => name === "open" || name === "params"),
    false,
  );
  x.harness.unmount();
});

test("typing during pending draft creation preserves the text and invalidates the voice launch", async () => {
  const x = setup();
  x.button("Open voice call")!.props.onPress();
  x.input().props.onChangeText("Actually, send this instead");
  x.harness.flush();
  x.draft.resolve(A);
  await x.harness.settle();
  assert.equal(x.voice(), undefined);
  assert.equal(x.input().props.value, "Actually, send this instead");
  assert.equal(x.button("Send message")?.props.disabled, false);
  assert.equal(
    x.events.some(([name]) => name === "open" || name === "params"),
    false,
  );
  x.harness.unmount();
});

test("a pending voice draft cannot take over a composer that started uploading", async () => {
  const x = setup();
  x.button("Open voice call")!.props.onPress();
  x.uploads.picking = true;
  x.harness.render();
  assert.equal(x.button("Open voice call"), undefined);
  x.draft.resolve(A);
  await x.harness.settle();
  assert.equal(x.voice(), undefined);
  assert.equal(
    x.events.some(([name]) => name === "open" || name === "params"),
    false,
  );
  x.harness.unmount();
});

test("a late draft cannot open voice after the account loses voice availability", async () => {
  for (const reason of ["feature", "offline"] as const) {
    const x = setup();
    x.button("Open voice call")!.props.onPress();
    if (reason === "feature") x.setFeatures([]);
    else {
      x.assistant.online = false;
      x.harness.render();
    }
    x.draft.resolve(A);
    await x.harness.settle();
    assert.equal(x.voice(), undefined, reason);
    assert.equal(
      x.events.some(([name]) => name === "open" || name === "params"),
      false,
      reason,
    );
    x.harness.unmount();
  }
});

test("unmount aborts pending draft creation and late success cannot navigate", async () => {
  const x = setup();
  x.button("Open voice call")!.props.onPress();
  x.harness.unmount();
  assert.equal(x.drafts[0]!.signal.aborted, true);
  x.draft.resolve(A);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    x.events.some(([name]) => name === "open" || name === "params"),
    false,
  );
});

test("voice review returns to its exact saved chat and closing restores the entry button", async () => {
  const x = setup(A);
  x.button("Open voice call")!.props.onPress();
  await x.harness.settle();
  assert.equal(x.button("Open voice call"), undefined);
  x.voice()!.props.onUpdate();
  x.voice()!.props.onReview("ack-123");
  assert.deepEqual(
    x.events.find(([name]) => name === "open"),
    ["open", A, "ack-123"],
  );
  assert.deepEqual(
    x.events.find(([name]) => name === "params"),
    [
      "params",
      { conversationId: A, acknowledgementId: "ack-123", openLatest: false },
    ],
  );
  assert.equal(x.events.filter(([name]) => name === "recover").length, 1);
  x.voice()!.props.onClose();
  x.harness.flush();
  assert.equal(x.voice(), undefined);
  assert.ok(x.button("Open voice call"));
  x.harness.unmount();
});

test("changing the selected chat removes its previous voice surface", async () => {
  const x = setup(A);
  x.button("Open voice call")!.props.onPress();
  await x.harness.settle();
  assert.equal(x.voice()?.props.thread, A);
  x.props.route.params.conversationId = B;
  x.assistant.openConversation(B);
  x.harness.render();
  assert.equal(x.voice(), undefined);
  assert.ok(x.button("Open voice call"));
  x.harness.unmount();
});

test("edge measurements run after transcript follow handlers and preserve drag ownership", () => {
  const x = setup(A);
  const list = x.all().find((node) => node.type === "FlatList")!;
  list.props.onLayout({ nativeEvent: { layout: { height: 500 } } });
  list.props.onContentSizeChange(350, 900);
  list.props.onScroll({ nativeEvent: { contentOffset: { y: 100 } } });
  list.props.onScrollBeginDrag();
  assert.deepEqual(
    x.events.filter(
      ([name]) =>
        typeof name === "string" &&
        (name.startsWith("follow-") || name.startsWith("fade-")),
    ),
    [
      ["follow-layout", 500],
      ["fade-layout", 500],
      ["follow-content", 900],
      ["fade-content", 900],
      ["follow-scroll", 100],
      ["fade-scroll", 100],
      ["follow-drag"],
    ],
  );
  x.harness.unmount();
});

test("private user attribution joins only real via and steering context", () => {
  const x = setup(A, false);
  const render = x.all().find((node) => node.type === "FlatList")!.props
    .renderItem;
  const base = {
    id: "message",
    seq: 1,
    role: "user",
    text: "Continue",
    activities: [],
    attachments: [],
    created_at: "2026-10-27T00:00:00Z",
  };
  for (const [extra, expected] of [
    [{}, undefined],
    [{ steering: true }, "guidance"],
    [{ via: "Slack", steering: true }, "Slack · guidance"],
    [{ via: "Slack" }, "Slack"],
  ] as const) {
    const row = expand(render({ item: { ...base, ...extra }, index: 0 }));
    const labels = elements(row)
      .filter((node) => node.type === "Label" && !node.props.mono)
      .map((node) => node.props.children.join(""));
    assert.deepEqual(labels, expected ? [expected] : []);
  }
  x.harness.unmount();
});
