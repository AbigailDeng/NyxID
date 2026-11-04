import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { deferred, hookHarness } from "../assistant/assistantHookTestHarness";
import * as presentation from "./automationPresentation";
import * as time from "./automationTime";
import { automationSchema } from "./automationContracts";
import { managementUrl } from "../assistant-management/managementContracts";

const id = "12345678-1234-4123-8123-123456789abc";
const at = "2026-10-27T01:00:00Z";
const run = {
  id,
  scheduled_at: at,
  started_at: at,
  finished_at: at,
  outcome: "completed",
  reason: null,
  thread_id: "nyxa-thread",
  duration_ms: 450,
};
const trigger = automationSchema.parse({
  id,
  user_id: "owner",
  label: "Morning release check",
  user_service_id: null,
  status: "active",
  source: "schedule",
  schedule: { kind: "cron", expression: "0 8 * * 1-5", timezone: "UTC" },
  verification: { mode: "schedule" },
  delivery: {
    type: "assistant",
    agent_id: "researcher",
    instruction: "Review the release checklist.",
    thread_policy: "dedicated",
    confirmation_policy: "destructive",
    deliver_to: { type: "thread" },
  },
  last_run: run,
  next_run_at: at,
  next_runs: [at],
  inbound_url: null,
  created_at: at,
  updated_at: at,
});
type Element = { type: any; props: Record<string, any> };
function elements(root: Element): Element[] {
  if (!root || typeof root !== "object" || !root.props) return [];
  return [root, ...[root.props.children].flat(Infinity).flatMap(elements)];
}
function setup(
  page: "AutomationsScreen" | "AutomationDetailScreen" | "AutomationRunsScreen",
  zone = "UTC",
  detailState: Record<string, any> = {},
) {
  const routes: any[] = [];
  const chats: any[] = [];
  const queries: any[] = [];
  const alerts: any[][] = [];
  const runtime = { active: true, online: true };
  const route = { params: { id } };
  const detail: Record<string, any> = {
    data: trigger,
    isPending: false,
    isFetching: false,
    error: null,
    refetch: async (_options?: unknown) => {},
    ...detailState,
  };
  let nextPages = 0;
  const cursor = { before: at, before_id: id };
  const response = (data: unknown) => ({
    data,
    isPending: false,
    isError: false,
    refetch: async () => {},
  });
  const harness = hookHarness<Element>({
    "react/jsx-runtime": {
      jsx: (type: any, props: any) => ({ type, props }),
      jsxs: (type: any, props: any) => ({ type, props }),
      Fragment: "Fragment",
    },
    "react-native": {
      Pressable: "Pressable",
      View: "View",
      Alert: { alert: (...args: any[]) => alerts.push(args) },
    },
    "../../components/AgentAvatar": { AgentAvatar: "AgentAvatar" },
    "lucide-react-native": { ChevronRight: "ChevronRight", Clock3: "Clock3" },
    "../../theme/ThemeContext": { useTheme: () => ({ colors: {} }) },
    "../../app/WorkspaceHeader": {
      useOpenWorkspaceChat: () => (params: any) => chats.push(params),
    },
    "../../components/workspace/WorkspaceUI": Object.fromEntries(
      ["ActionButton", "Card", "Field", "Label", "Notice", "WorkspacePage"].map(
        (name) => [name, name],
      ),
    ),
    "../../lib/api/agentsApi": { agentsApi: {} },
    "../../lib/api/automationsApi": { automationsApi: {} },
    "../assistant-management/ManagementHandoff": {
      ManagementHandoff: "ManagementHandoff",
    },
    "./automationPresentation": presentation,
    "./automationTime": time,
    "./AutomationUI": {
      AUTOMATIONS: ["workspace", "automations"],
      AUTOMATION_SETTINGS: ["workspace", "automations", "settings"],
      AutomationLoading: "AutomationLoading",
      AutomationStatus: "AutomationStatus",
      ChoiceField: "ChoiceField",
      automationError: (error: any) => String(error),
      automationStyles: {},
      useAutomationRuntime: () => runtime,
    },
    "@tanstack/react-query": {
      useQuery: (options: any) => {
        queries.push(options);
        if (options.queryKey.includes("detail")) return detail;
        return response(
          options.queryKey.includes("agents")
            ? {
                agents: [
                  {
                    id: "researcher",
                    name: "researcher",
                    display_name: "Researcher",
                  },
                ],
              }
            : options.queryKey.includes("list")
              ? {
                  triggers: [
                    trigger,
                    {
                      ...trigger,
                      id: "other",
                      label: "Webhook reminder",
                      status: "disabled",
                      delivery: { type: "notification" },
                    },
                  ],
                }
              : options.queryKey.includes("settings")
                ? { timezone: zone }
                : trigger,
        );
      },
      useInfiniteQuery: (options: any) => {
        queries.push(options);
        return {
          ...response({ pages: [{ runs: [run], next_cursor: cursor }] }),
          hasNextPage: true,
          isFetchingNextPage: false,
          fetchNextPage: async () => {
            nextPages++;
          },
        };
      },
    },
  });
  const source = harness.load(
    fileURLToPath(new URL("./AutomationsScreen.tsx", import.meta.url)),
  );
  harness.mount(() =>
    (source[page] as any)({
      route,
      navigation: {
        push: (name: any, params: any) => routes.push({ name, params }),
      },
    }),
  );
  const all = () => elements(harness.value());
  const control = (label: string) => {
    const item = all().find(
      (item) =>
        item.props.label === label || item.props.accessibilityLabel === label,
    );
    assert.ok(item, `Missing ${label}`);
    return item;
  };
  const text = () =>
    all()
      .filter((item) => item.type === "Label")
      .map((item) => [item.props.children].flat().join(""))
      .join("\n");
  return {
    harness,
    source,
    all,
    control,
    text,
    routes,
    chats,
    queries,
    alerts,
    runtime,
    route,
    detail,
    cursor,
    nextPages: () => nextPages,
  };
}

test("read-only list keeps agent/status/search filters and opens details with no authoring controls", () => {
  const env = setup("AutomationsScreen");
  try {
    assert.equal(
      env.all().filter((item) => item.type === "ManagementHandoff").length,
      1,
      "the list has one Web management entry",
    );
    assert.equal(
      managementUrl(
        "https://nyx.example",
        env.control("Manage automations on web").props.target,
      ),
      "https://nyx.example/assistant/automations",
    );
    env.control("Open Morning release check").props.onPress();
    assert.equal(env.routes[0].name, "AutomationDetail");
    env.control("Status").props.onChange("disabled");
    env.harness.flush();
    assert.ok(env.control("Open Webhook reminder"));
    assert.throws(() => env.control("Open Morning release check"));
    env.control("Status").props.onChange("all");
    env.control("Agent").props.onChange("researcher");
    env.harness.flush();
    assert.throws(() => env.control("Open Webhook reminder"));
    assert.equal(
      managementUrl(
        "https://nyx.example",
        env.control("Manage automations on web").props.target,
      ),
      "https://nyx.example/assistant/automations?agent=researcher",
    );
    env.control("Search automations").props.onChangeText("not found");
    env.harness.flush();
    assert.match(env.text(), /No matching automations/);
    for (const label of [
      "Create automation",
      "Automation preferences",
      "Run now",
    ])
      assert.throws(() => env.control(label));
  } finally {
    env.harness.unmount();
  }
});

test("read-only details show task, target and confirmation policy and retain history navigation", () => {
  const env = setup("AutomationDetailScreen");
  try {
    assert.equal(
      managementUrl(
        "https://nyx.example",
        env.control("Manage automations on web").props.target,
      ),
      "https://nyx.example/assistant/automations?agent=researcher",
      "details open the existing filtered manager rather than an exact-task editor",
    );
    const card = env
      .all()
      .find((item) => item.type.name === "AutomationDeliveryCard")!;
    const rendered = elements(card.type(card.props));
    const text = rendered
      .filter((item) => item.type === "Label")
      .map((item) => [item.props.children].flat().join(""))
      .join("\n");
    assert.match(text, /Review the release checklist/);
    assert.match(text, /Researcher/);
    assert.match(text, /Thread: dedicated/);
    assert.match(text, /Confirmation: Destructive actions/);
    env.control("View run history").props.onPress();
    assert.equal(env.routes[0].name, "AutomationRuns");
    for (const label of [
      "Edit automation",
      "Automation actions",
      "Run now",
      "Pause automation",
      "Delete automation",
    ])
      assert.throws(() => env.control(label));
  } finally {
    env.harness.unmount();
  }
});

test("detail loads once and background fetches retain content without pull animation or inserted errors", () => {
  const env = setup("AutomationDetailScreen", "UTC", {
    data: undefined,
    isPending: true,
    isFetching: true,
  });
  try {
    const page = () => env.harness.value();
    const loading = () =>
      env.all().some((item) => item.type === "AutomationLoading");
    assert.equal(page().props.refreshing, false);
    assert.equal(loading(), true);
    env.detail.data = trigger;
    env.detail.isPending = false;
    env.detail.isFetching = false;
    env.harness.render();
    assert.equal(loading(), false);
    assert.match(env.text(), /Morning release check/);

    for (let poll = 0; poll < 2; poll++) {
      env.detail.isFetching = true;
      env.harness.render();
      assert.equal(page().props.refreshing, false);
      assert.equal(loading(), false);
      assert.match(env.text(), /Morning release check/);
      env.detail.isFetching = false;
      env.harness.render();
    }
    env.detail.data = { ...trigger, label: "Updated release check" };
    env.harness.render();
    assert.match(env.text(), /Updated release check/);
    env.detail.error = new Error("Background network failure");
    env.harness.render();
    assert.match(env.text(), /Updated release check/);
    assert.equal(page().props.refreshing, false);
    assert.equal(loading(), false);
    assert.equal(
      env.all().some((item) => item.type === "Notice"),
      false,
    );
    assert.equal(env.alerts.length, 0);
  } finally {
    env.harness.unmount();
  }
});

test("a pull during an in-flight poll animates until completion and duplicate pulls join the same fetch", async () => {
  const pending = deferred<void>();
  const calls: unknown[] = [];
  const env = setup("AutomationDetailScreen", "UTC", {
    isFetching: true,
    refetch: (options: unknown) => {
      calls.push(options);
      return pending.promise;
    },
  });
  try {
    const page = () => env.harness.value();
    assert.equal(page().props.refreshing, false);
    const refresh = page().props.onRefresh();
    env.harness.flush();
    assert.equal(page().props.refreshing, true);
    assert.match(env.text(), /Morning release check/);
    void page().props.onRefresh();
    assert.equal(calls.length, 1);
    assert.equal((calls[0] as any).cancelRefetch, false);
    assert.equal((calls[0] as any).throwOnError, true);
    pending.resolve();
    await refresh;
    await env.harness.settle();
    assert.equal(page().props.refreshing, false);
    assert.equal(env.alerts.length, 0);
    assert.match(env.text(), /Morning release check/);
  } finally {
    env.harness.unmount();
  }
});

test("manual refresh failure stops animation, retains content and reports the failure without moving the page", async () => {
  const pending = deferred<void>();
  const env = setup("AutomationDetailScreen", "UTC", {
    refetch: () => pending.promise,
  });
  try {
    const refresh = env.harness.value().props.onRefresh();
    env.harness.flush();
    pending.reject(new Error("Could not reach the server"));
    await refresh;
    await env.harness.settle();
    assert.equal(env.harness.value().props.refreshing, false);
    assert.match(env.text(), /Morning release check/);
    assert.equal(env.alerts.length, 1);
    assert.match(env.alerts[0][1], /Could not reach the server/);
    assert.equal(
      env.all().some((item) => item.type === "Notice"),
      false,
    );
  } finally {
    env.harness.unmount();
  }
});

test("first-load errors retain Retry while inactive/offline or obsolete pull requests cannot change the current page", async () => {
  const first = deferred<void>();
  const second = deferred<void>();
  let calls = 0;
  const env = setup("AutomationDetailScreen", "UTC", {
    data: undefined,
    error: new Error("Initial request failed"),
    refetch: () => (++calls === 1 ? first.promise : second.promise),
  });
  try {
    assert.ok(env.control("Retry automation"));
    env.detail.data = trigger;
    env.detail.error = null;
    env.harness.render();
    const oldRefresh = env.harness.value().props.onRefresh();
    env.harness.flush();
    env.route.params.id = "87654321-1234-4123-8123-123456789abc";
    env.harness.render();
    assert.equal(env.harness.value().props.refreshing, false);
    const newRefresh = env.harness.value().props.onRefresh();
    env.harness.flush();
    first.resolve();
    await oldRefresh;
    await env.harness.settle();
    assert.equal(env.harness.value().props.refreshing, true);
    env.runtime.active = false;
    env.harness.render();
    assert.equal(env.harness.value().props.refreshing, false);
    await env.harness.value().props.onRefresh();
    assert.equal(calls, 2);
    env.runtime.active = true;
    env.runtime.online = false;
    env.harness.render();
    await env.harness.value().props.onRefresh();
    assert.equal(calls, 2);
    env.harness.unmount();
    second.reject(new Error("Stale request failed after leaving"));
    await newRefresh;
    assert.equal(env.alerts.length, 0);
  } finally {
    env.harness.unmount();
  }
});

test("automation next, latest and history times use the owner timezone with one display-zone label", () => {
  const zone = "Asia/Singapore";
  for (const page of [
    "AutomationsScreen",
    "AutomationDetailScreen",
    "AutomationRunsScreen",
  ] as const) {
    const env = setup(page, zone);
    const text = env.text();
    assert.equal(text.split(`Times shown in ${zone}`).length - 1, 1);
    assert.ok(text.includes(time.formatAutomationTime(at, zone)));
    if (page === "AutomationsScreen")
      assert.ok(text.includes(`Next: ${time.formatAutomationTime(at, zone)}`));
    if (page !== "AutomationRunsScreen")
      assert.match(text, /Weekdays at 8:00 AM \(UTC\)/);
    env.harness.unmount();
  }
});

test("NyxBot guidance starts an empty normal NyxBot chat with a fresh draft identity", () => {
  const env = setup("AutomationsScreen");
  try {
    const guidance = env
      .all()
      .find((item) => item.type.name === "AutomationGuidance")!;
    const rows = elements(guidance.type(guidance.props));
    assert.ok(
      rows.some(
        (item) =>
          item.props.children ===
          "To create, run or change automations, ask NyxBot.",
      ),
    );
    const ask = rows.find((item) => item.props.label === "Ask NyxBot")!;
    ask.props.onPress();
    ask.props.onPress();
    for (const chat of env.chats) {
      assert.equal(chat.home, false);
      assert.equal(chat.draft, true);
      assert.equal(chat.agentId, undefined);
      assert.equal(chat.conversationId, undefined);
      assert.equal(chat.openLatest, false);
      assert.equal(chat.message, undefined);
    }
    assert.notEqual(env.chats[0].draftId, env.chats[1].draftId);
  } finally {
    env.harness.unmount();
  }
});

test("run history preserves cursor paging, status/time and exact thread navigation", () => {
  const env = setup("AutomationRunsScreen");
  try {
    assert.match(env.text(), /Scheduled:/);
    assert.match(env.text(), /0.5 seconds/);
    env.control("Open thread").props.onPress();
    assert.equal(env.chats[0].conversationId, "nyxa-thread");
    const query = env.queries.find((item) => item.getNextPageParam);
    assert.deepEqual(
      query.getNextPageParam({ next_cursor: env.cursor }),
      env.cursor,
    );
    env.control("Load older runs").props.onPress();
    assert.equal(env.nextPages(), 1);
  } finally {
    env.harness.unmount();
  }
});
