import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { WorkspaceChatTarget } from "../../app/workspaceChatNavigation";
import { agentSchema } from "../../features/agents/agentContracts";
import { conversationSchema } from "../../features/assistant/assistantTypes";
import { hookHarness } from "../../features/assistant/assistantHookTestHarness";
import { groupSchema } from "../../features/groups/groupContracts";
import * as listHelpers from "./workspaceChatList";

type Element = { type: unknown; props: Record<string, any> };
type QueryOptions = { queryKey: unknown[]; enabled: boolean };
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const conversationId = (value: number) =>
  `nyxa-${value.toString(16).padStart(32, "0")}`;

const agents = [
  agentSchema.parse({
    id: "nyxbot",
    name: "nyxbot",
    display_name: "NyxBot",
    kind: "nyxbot",
    description: "Personal assistant",
    status: "idle",
    can_use: true,
  }),
  ...Array.from({ length: 8 }, (_, index) =>
    agentSchema.parse({
      id: `agent-${index + 1}`,
      name: `helper-${index + 1}`,
      display_name: `Agent ${index + 1}`,
      kind: "specialist",
      description: "Assistant",
      status: "idle",
      can_use: index !== 7,
    }),
  ),
];
const groups = Array.from({ length: 8 }, (_, index) =>
  groupSchema.parse({
    id: `nyxg-${(index + 1).toString(16).padStart(32, "0")}`,
    name: `Group ${index + 1}`,
    members: [],
    lead_agent_id: "nyxbot",
    created_at: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
    message_count: index + 1,
  }),
);
function chatsFor(agentId: string) {
  const owner = agents.find((agent) => agent.id === agentId);
  assert.ok(owner);
  const agentIndex = agents.indexOf(owner);
  return Array.from({ length: 8 }, (_, index) =>
    conversationSchema.parse({
      id: conversationId(agentIndex * 100 + index + 1),
      title: `${owner.display_name} chat ${index + 1}`,
      model: "nyxagent/chat",
      message_count: 2,
      active_turn: null,
      created_at: "2026-10-01T00:00:00Z",
      last_message_at: `2026-10-${String(16 - index).padStart(2, "0")}T00:00:00Z`,
      agent: {
        id: owner.id,
        name: owner.name,
        display_name: owner.display_name,
        kind: owner.kind,
      },
    }),
  );
}

/** Render the component's stateless rows while leaving its modal as a boundary. */
function elements(root: Element): Element[] {
  if (typeof root.type === "function")
    return elements((root.type as (props: unknown) => Element)(root.props));
  return [
    root,
    ...[root.props.children]
      .flat(Infinity)
      .flatMap((child) =>
        child && typeof child === "object" && "props" in child
          ? elements(child)
          : [],
      ),
  ];
}
function content(root: Element): string {
  return [root.props.children]
    .flat(Infinity)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : child && typeof child === "object" && "props" in child
          ? content(child)
          : "",
    )
    .join("");
}

function setup(current?: WorkspaceChatTarget) {
  const selections: WorkspaceChatTarget[] = [];
  const historyQueries: QueryOptions[] = [];
  const props = {
    visible: true,
    current,
    onSelect: (target: WorkspaceChatTarget) => {
      selections.push(plain(target));
      props.current = target;
    },
  };
  const harness = hookHarness<Element>({
    "react/jsx-runtime": {
      jsx: (type: unknown, props: unknown) => ({ type, props }),
      jsxs: (type: unknown, props: unknown) => ({ type, props }),
      Fragment: "Fragment",
    },
    "react-native": {
      ...Object.fromEntries(
        ["ActivityIndicator", "Pressable", "Text", "View"].map((name) => [
          name,
          name,
        ]),
      ),
      AppState: {
        currentState: "active",
        addEventListener: () => ({ remove: () => {} }),
      },
      StyleSheet: { create: (styles: unknown) => styles },
    },
    "lucide-react-native": Object.fromEntries(
      ["Bot", "ChevronDown", "ChevronRight", "MessageSquare", "Users"].map(
        (name) => [name, name],
      ),
    ),
    "@tanstack/react-query": {
      useQuery: ({ queryKey }: QueryOptions) => ({
        data: queryKey.includes("agents") ? { agents } : groups,
        isSuccess: true,
        isPending: false,
        isError: false,
        refetch: async () => {},
      }),
      useInfiniteQuery: (options: QueryOptions) => {
        historyQueries.push(options);
        const agentId = options.queryKey.at(-1);
        return {
          data:
            typeof agentId === "string"
              ? {
                  pages: [
                    { conversations: chatsFor(agentId), next_cursor: null },
                  ],
                }
              : undefined,
          isSuccess: true,
          isPending: false,
          isError: false,
          hasNextPage: false,
          isFetchingNextPage: false,
          isFetchNextPageError: false,
          refetch: async () => {},
          fetchNextPage: async () => {},
        };
      },
    },
    "../../hooks/useNetworkStatus": {
      useNetworkStatus: () => ({ isConnected: true }),
    },
    "../../lib/api/agentsApi": { agentsApi: {} },
    "../../lib/api/assistantApi": { assistantApi: {} },
    "../../lib/api/groupsApi": { groupsApi: {} },
    "../../lib/auth/authEpoch": { getAuthEpoch: () => 17 },
    "../../theme/ThemeContext": { useTheme: () => ({ colors: {} }) },
    "../../theme/designTokens": { fonts: {} },
    "./WorkspaceChatBrowser": { WorkspaceChatBrowser: "WorkspaceChatBrowser" },
    "./workspaceChatList": listHelpers,
  });
  type Props = typeof props;
  const { WorkspaceChatList } = harness.load(
    fileURLToPath(new URL("./WorkspaceChatList.tsx", import.meta.url)),
  ) as { WorkspaceChatList: (props: Props) => Element };
  harness.mount(() => WorkspaceChatList(props));
  const all = () => elements(harness.flush());
  const one = (predicate: (element: Element) => boolean) => {
    const found = all().find(predicate);
    assert.ok(found, "Expected matching drawer control");
    return found;
  };
  const label = (name: string) =>
    one((row) => row.props.accessibilityLabel === name);
  const press = (name: string) => {
    label(name).props.onPress();
    harness.flush();
  };
  const more = (name: string) => {
    one(
      (row) => row.type === "Pressable" && content(row) === name,
    ).props.onPress();
    harness.flush();
  };
  const browser = () => one((row) => row.type === "WorkspaceChatBrowser").props;
  const agentRows = () =>
    all().filter((row) =>
      /^(Expand|Collapse) chats for /.test(row.props.accessibilityLabel ?? ""),
    );
  const chatRows = () =>
    all().filter((row) =>
      /^(Open chat |Open current chat$)/.test(
        row.props.accessibilityLabel ?? "",
      ),
    );
  const groupRows = () =>
    all().filter((row) =>
      /^Open group chat /.test(row.props.accessibilityLabel ?? ""),
    );
  const historyQuery = () => {
    const latest = historyQueries.at(-1);
    assert.ok(latest);
    return latest;
  };
  const pressBrowserItem = (id: string) => {
    const model = browser();
    const item = model.items.find((row: { id: string }) => row.id === id);
    assert.ok(item, `Expected modal item ${id}`);
    const control = elements(model.renderItem(item)).find(
      (row) => row.type === "Pressable",
    );
    assert.ok(control);
    control.props.onPress();
    harness.render();
  };
  return {
    harness,
    selections,
    all,
    label,
    press,
    more,
    browser,
    agentRows,
    chatRows,
    groupRows,
    historyQuery,
    pressBrowserItem,
  };
}

test("agent and group previews stay at five rows and their sections collapse independently", () => {
  const env = setup();
  assert.equal(env.agentRows().length, 5);
  assert.equal(
    env.agentRows().filter((row) => row.props.accessibilityState.expanded)
      .length,
    0,
  );
  assert.equal(env.historyQuery().enabled, false);
  assert.equal(env.groupRows().length, 0);
  env.press("Expand group chats");
  assert.equal(env.groupRows().length, 5);
  assert.equal(env.agentRows().length, 5);
  env.press("Collapse agent chats");
  assert.equal(env.agentRows().length, 0);
  assert.equal(env.chatRows().length, 0);
  assert.equal(env.groupRows().length, 5);
  env.press("Collapse group chats");
  assert.equal(env.groupRows().length, 0);
  env.press("Expand agent chats");
  assert.equal(env.agentRows().length, 5);
  env.harness.unmount();
});

test("opening another agent collapses the first and queries only the expanded history", () => {
  const env = setup();
  env.press("Expand chats for Agent 1");
  assert.equal(env.historyQuery().queryKey.at(-1), "agent-1");
  assert.equal(env.historyQuery().enabled, true);
  assert.equal(env.chatRows().length, 5);
  env.press("Expand chats for Agent 2");
  const expanded = env
    .agentRows()
    .filter((row) => row.props.accessibilityState.expanded);
  assert.equal(expanded.length, 1);
  assert.equal(
    expanded[0]?.props.accessibilityLabel,
    "Collapse chats for Agent 2",
  );
  assert.equal(env.historyQuery().queryKey.at(-1), "agent-2");
  assert.equal(env.chatRows().length, 5);
  assert.ok(
    env
      .chatRows()
      .every((row) => row.props.accessibilityLabel.endsWith("with Agent 2")),
  );
  env.press("Collapse agent chats");
  assert.equal(env.chatRows().length, 0);
  assert.equal(env.historyQuery().enabled, false);
  env.harness.unmount();
});

test("the all-agents browser reaches hidden agents and chats while both previews remain capped", () => {
  const env = setup();
  assert.equal(
    env
      .agentRows()
      .some((row) => row.props.accessibilityLabel.includes("Agent 7")),
    false,
  );
  env.more("View all agents (9)");
  assert.equal(env.browser().title, "All agents");
  assert.equal(env.browser().items.length, 9);
  env.pressBrowserItem("agent-7");
  assert.equal(env.browser().title, "Agent 7");
  assert.equal(env.browser().scopeKey, "chats:agent-7");
  assert.equal(env.browser().items.length, 8);
  assert.equal(env.agentRows().length, 5);
  assert.ok(
    env
      .agentRows()
      .some(
        (row) => row.props.accessibilityLabel === "Collapse chats for Agent 7",
      ),
  );
  assert.equal(env.chatRows().length, 5);
  const chosenChat = chatsFor("agent-7")[7]!;
  env.pressBrowserItem(chosenChat.id);
  assert.deepEqual(env.selections, [
    { kind: "agent", agentId: "agent-7", conversationId: chosenChat.id },
  ]);
  assert.equal(
    env.all().some((row) => row.type === "WorkspaceChatBrowser"),
    false,
  );
  assert.equal(env.agentRows().length, 5);
  assert.equal(env.chatRows().length, 5);
  const selected = env
    .chatRows()
    .filter((row) => row.props.accessibilityState.selected);
  assert.equal(selected.length, 1);
  assert.equal(
    selected[0]?.props.accessibilityLabel,
    "Open chat Agent 7 chat 8 with Agent 7",
  );
  env.harness.unmount();
});

test("a current group outside the first five is pinned and the all-groups browser exposes every group", () => {
  const chosen = groups[0]!;
  const env = setup({ kind: "group", groupId: chosen.id });
  assert.equal(env.groupRows().length, 5);
  assert.ok(
    env
      .groupRows()
      .some(
        (row) =>
          row.props.accessibilityLabel === "Open group chat Group 1" &&
          row.props.accessibilityState.selected,
      ),
  );
  env.more("View all groups (8)");
  assert.equal(env.browser().items.length, 8);
  const hidden = groups[1]!;
  env.pressBrowserItem(hidden.id);
  assert.deepEqual(env.selections, [{ kind: "group", groupId: hidden.id }]);
  assert.equal(env.groupRows().length, 5);
  assert.ok(
    env
      .groupRows()
      .some(
        (row) =>
          row.props.accessibilityLabel === "Open group chat Group 2" &&
          row.props.accessibilityState.selected,
      ),
  );
  env.harness.unmount();
});

test("a missing current chat consumes one of the five preview slots and retains its exact identity", () => {
  const missing = conversationId(9999);
  const env = setup({
    kind: "agent",
    agentId: "agent-1",
    conversationId: missing,
  });
  assert.equal(env.chatRows().length, 5);
  assert.equal(
    env
      .chatRows()
      .filter((row) => row.props.accessibilityLabel === "Open current chat")
      .length,
    1,
  );
  assert.equal(
    env
      .chatRows()
      .filter((row) => row.props.accessibilityLabel.startsWith("Open chat "))
      .length,
    4,
  );
  env.press("Open current chat");
  assert.deepEqual(env.selections, [
    { kind: "agent", agentId: "agent-1", conversationId: missing },
  ]);
  env.harness.unmount();
});

test("resolving an initially unnamed current chat does not render a duplicate standalone row", () => {
  const current = chatsFor("nyxbot")[0]!;
  const env = setup({ kind: "agent", conversationId: current.id });
  assert.equal(env.chatRows().length, 1);
  env.press("Expand chats for NyxBot");
  assert.equal(env.chatRows().length, 5);
  assert.equal(
    env
      .chatRows()
      .filter((row) => row.props.accessibilityLabel === "Open current chat")
      .length,
    0,
  );
  assert.equal(
    env.chatRows().filter((row) => row.props.accessibilityState.selected)
      .length,
    1,
  );
  env.harness.unmount();
});

test("a view-only agent keeps history querying disabled and offers no chat action", () => {
  const env = setup({ kind: "agent", agentId: "agent-8" });
  assert.equal(env.agentRows().length, 5);
  assert.equal(env.historyQuery().queryKey.at(-1), "agent-8");
  assert.equal(env.historyQuery().enabled, false);
  assert.equal(env.chatRows().length, 0);
  assert.ok(
    env
      .all()
      .some(
        (row) =>
          row.type === "Text" &&
          content(row).includes("chat access isn’t available"),
      ),
  );
  assert.equal(
    env
      .all()
      .some(
        (row) => row.props.accessibilityLabel === "Start a chat with Agent 8",
      ),
    false,
  );
  assert.deepEqual(env.selections, []);
  env.harness.unmount();
});
