import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { hookHarness } from "../assistant/assistantHookTestHarness";
type E = { type: any; props: Record<string, any> };
const nodes = (n: any): E[] =>
  n?.props ? [n, ...[n.props.children].flat(Infinity).flatMap(nodes)] : [];

test("crew header shows member identity and narrows recipients through its picker without losing draft", () => {
  let options: any;
  const members = [
    { id: "bot", name: "nyxbot", display_name: "NyxBot", kind: "nyxbot" },
    {
      id: "research",
      name: "researcher",
      display_name: "Researcher",
      kind: "specialist",
    },
  ];
  const chat = {
    active: true,
    epoch: 1,
    online: true,
    sending: false,
    available: () => true,
    data: {
      group: {
        name: "Launch crew",
        members,
        lead_agent_id: "bot",
        default_recipient_ids: ["bot"],
        working_agent_ids: [] as string[],
      },
      messages: [],
      pending_actions: [] as any[],
    },
  };
  const h = hookHarness<E>({
    "react/jsx-runtime": {
      jsx: (type: unknown, props: unknown) => ({ type, props }),
      jsxs: (type: unknown, props: unknown) => ({ type, props }),
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
          "TextInput",
          "View",
        ].map((n) => [n, n]),
      ),
      StyleSheet: { create: (v: unknown) => v },
    },
    "lucide-react-native": {
      Check: "Check",
      Plus: "Plus",
      Settings2: "Settings",
      X: "X",
    },
    "../assistant/ChatIdentityHeader": {
      ChatHeaderFrame: "ChatHeaderFrame",
      ChatIdentity: "ChatIdentity",
    },
    "../../components/AgentAvatar": {
      AgentAvatar: "AgentAvatar",
      AgentAvatarStack: "Stack",
    },
    "../display/ChatLayoutContext": { useChatColumn: () => ({}) },
    "../../components/workspace/ScrollEdgeFades": {
      ScrollEdgeFades: "Fades",
      OverflowScrollView: "ScrollView",
      useScrollEdges: () => ({ edges: {} }),
    },
    "@tanstack/react-query": {
      useQuery: () => ({ data: { agents: members } }),
    },
    "../assistant/AssistantMarkdownBody": { AssistantMarkdownBody: "Markdown" },
    "react-native-markdown-display": {
      __esModule: true,
      default: "Markdown",
      MarkdownIt: () => ({}),
    },
    "expo-web-browser": {},
    "../../components/workspace/WorkspaceUI": Object.fromEntries(
      ["ActionButton", "Card", "Label", "Notice", "WorkspacePage"].map((n) => [
        n,
        n,
      ]),
    ),
    "../../lib/api/accountApi": {},
    "../../lib/api/agentsApi": {},
    "../../lib/api/groupsApi": {},
    "../../lib/auth/authEpoch": { getAuthEpoch: () => 1 },
    "../../app/WorkspaceHeader": {
      WorkspaceHeaderVisibility: "Visibility",
      useWorkspaceBack: (p: any) => {
        options = p.options;
      },
    },
    "../../theme/ThemeContext": { useTheme: () => ({ colors: {} }) },
    "../assistant/AssistantPendingUploads": {
      AssistantPendingUploads: "Uploads",
    },
    "../assistant/AssistantMentionInput": { AssistantMentionInput: "Input" },
    "../assistant/ChatComposer": Object.fromEntries(
      [
        "ChatComposerFrame",
        "ChatComposerRow",
        "ComposerAttachButton",
        "ComposerSubmitButton",
      ].map((n) => [n, n]),
    ),
    "../assistant/AssistantActivityDisclosure": {},
    "../assistant/AssistantBanner": {
      AssistantConnectionBanner: "Connection",
      AssistantErrorNotice: "Error",
      JumpToLatest: "Jump",
    },
    "./GroupPendingCard": {},
    "./GroupMachineReceipts": {},
    "../assistant/AssistantMessageFooter": {
      AssistantMessageFooter: "Footer",
      AssistantMessageTime: "Time",
    },
    "../assistant/assistantSelectableMarkdown": {},
    "../assistant/useAssistantUploads": {
      useAssistantUploads: () => ({ files: [], session: { sending: false } }),
    },
    "../assistant/useComposerDictation": {
      useComposerDictation: () => ({ active: false }),
    },
    "../assistant/ComposerDictation": {
      ComposerDictationButton: "Dictation",
      ComposerDictationReview: "DictationReview",
    },
    "../assistant/useTranscriptScrollFollow": {
      useTranscriptScrollFollow: () => ({ listProps: {} }),
    },
    "./useGroupRuntime": {
      useGroupAvailability: () => ({ epoch: 1 }),
      groupKeys: () => [],
      useGroupChat: () => chat,
    },
  });
  const Screen = h.load(
    fileURLToPath(new URL("./GroupChatScreen.tsx", import.meta.url)),
  ).GroupChatScreen as any;
  h.mount(() => {
    const outer = Screen({
      groupId: "crew",
      onBack: () => {},
      onSettings: () => {},
    });
    return outer.type(outer.props);
  });
  const identity = () =>
    nodes(options.headerTitle()).find((n) => n.type === "ChatIdentity")!;
  assert.equal(identity().props.name, "Launch crew");
  assert.equal(identity().props.detail, "NyxBot, Researcher");
  assert.equal(identity().props.members.length, 2);
  const input = () => nodes(h.value()).find((n) => n.type === "Input")!;
  input().props.onChangeText("Keep this crew draft");
  h.flush();
  identity().props.onPress();
  h.flush();
  assert.ok(
    nodes(h.value()).some((n) => n.type === "Modal" && n.props.visible),
  );
  const choice = nodes(h.value()).find(
    (n) => n.props.accessibilityLabel === "Message Researcher",
  )!;
  choice.props.onPress();
  h.flush();
  assert.equal(input().props.value, "Keep this crew draft");
  assert.ok(
    nodes(h.value()).some(
      (n) => n.props.accessibilityLabel === "Remove recipient Researcher",
    ),
  );
  assert.ok(
    !nodes(h.value()).some(
      (n) => n.props.accessibilityLabel === "Remove recipient NyxBot",
    ),
  );
  chat.data.group.working_agent_ids = ["research"];
  h.render();
  assert.equal(identity().props.status, "Running");
  chat.data.pending_actions = [
    { summary: "Needs confirmation", conversation_id: "chat" },
  ];
  h.render();
  assert.equal(identity().props.status, "Needs you");
  h.unmount();
});
