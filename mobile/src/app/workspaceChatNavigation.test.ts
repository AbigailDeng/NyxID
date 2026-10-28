import { hydratedTestRouter } from "./routerTestHarness";
import assert from "node:assert/strict";
import test from "node:test";
import {
  CommonActions,
  StackActions,
  StackRouter,
  TabRouter,
  type NavigationState,
} from "@react-navigation/routers";
import {
  openWorkspaceSheetAction,
  workspaceRouterOptions,
} from "./navigationHierarchy";
import {
  activeWorkspaceChatTarget,
  workspaceChatNavigationAction,
  workspaceContextChatNavigationAction,
  type WorkspaceChatTarget,
} from "./workspaceChatNavigation";

const workspaceRouter = hydratedTestRouter(TabRouter(workspaceRouterOptions));
const workspaceOptions = {
  routeNames: ["Assistant"],
  routeParamList: {},
  routeGetIdList: {},
};
const rootRouter = hydratedTestRouter(
  StackRouter({ initialRouteName: "Workspace" }),
);
const rootOptions = {
  routeNames: [
    "Auth",
    "Workspace",
    "AssistantContext",
    "GroupChat",
    "WorkspaceSheet",
  ],
  routeParamList: {},
  routeGetIdList: {},
};
type RootState = ReturnType<typeof rootRouter.getInitialState>;

function fixture(): RootState {
  let workspace = workspaceRouter.getInitialState(workspaceOptions);
  const next = workspaceRouter.getStateForAction(
    workspace,
    CommonActions.navigate({
      name: "Assistant",
      params: {
        agentId: "old-agent",
        conversationId: "old-chat",
        acknowledgementId: "old-card",
        draft: true,
        openLatest: true,
      },
    }),
    workspaceOptions,
  );
  assert.ok(next);
  workspace = next;
  const initial = rootRouter.getInitialState(rootOptions);
  return {
    ...initial,
    routes: initial.routes.map((route) => ({
      ...route,
      state: workspace,
    })),
  };
}

function select(state: RootState, target: WorkspaceChatTarget) {
  const action = workspaceChatNavigationAction(state, target);
  assert.ok(action);
  assert.equal(action.target, state.key);
  const next = rootRouter.getStateForAction(state, action, rootOptions);
  assert.ok(next);
  return rootRouter.getRehydratedState(next, rootOptions);
}

function child(state: NavigationState) {
  const workspace = state.routes.find((route) => route.name === "Workspace");
  assert.ok(workspace?.state);
  return workspaceRouter.getRehydratedState(workspace.state, workspaceOptions);
}

function push(state: RootState, name: string, params: object) {
  const next = rootRouter.getStateForAction(
    state,
    StackActions.push(name, params),
    rootOptions,
  );
  assert.ok(next);
  return next;
}

function route(state: NavigationState, index = state.index) {
  const selected = state.routes[index];
  assert.ok(selected);
  return selected;
}

test("a drawer chat replaces contextual detail history and clears stale assistant flags", () => {
  let root = fixture();
  root = push(root, "WorkspaceSheet", {
    screen: "AgentDetail",
    params: { agentId: "detail-agent" },
  });
  root = push(root, "AssistantContext", {
    agentId: "detail-agent",
    conversationId: "detail-chat",
    acknowledgementId: "detail-card",
  });
  const before = child(root);
  const workspaceKey = route(root, 0).key;
  const next = select(root, {
    kind: "agent",
    agentId: "chosen-agent",
    conversationId: "chosen-chat",
  });
  assert.equal(next.key, root.key);
  assert.equal(next.index, 0);
  assert.deepEqual(
    next.routes.map((route) => route.name),
    ["Workspace"],
  );
  assert.equal(route(next, 0).key, workspaceKey);
  assert.equal(route(next, 0).params, undefined);
  const tabs = child(next);
  assert.equal(tabs.key, before.key);
  assert.deepEqual(
    tabs.routes.map((route) => route.key),
    before.routes.map((route) => route.key),
  );
  assert.equal(route(tabs).name, "Assistant");
  assert.deepEqual(route(tabs).params, {
    home: false,
    agentId: "chosen-agent",
    conversationId: "chosen-chat",
    acknowledgementId: undefined,
    draft: false,
    openLatest: false,
  });
  assert.equal(
    workspaceRouter.getStateForAction(
      tabs,
      CommonActions.goBack(),
      workspaceOptions,
    ),
    null,
  );
});

test("agent targets without a conversation start a draft, including default NyxBot", () => {
  for (const agentId of ["selected-specialist", undefined]) {
    const next = select(fixture(), { kind: "agent", agentId });
    const tabs = child(next);
    const params = route(tabs).params as any;
    assert.equal(params.agentId, agentId);
    assert.equal(params.conversationId, undefined);
    assert.equal(params.home, false);
    assert.equal(params.draft, true);
    assert.match(params.draftId, /^draft-/);
    assert.equal(params.openLatest, false);
    const again = route(child(select(next, { kind: "agent", agentId })))
      .params as any;
    assert.notEqual(again.draftId, params.draftId);
  }
});

test("group selection dismisses its drawer and native Back lands on the unchanged base chat", () => {
  let root = fixture();
  const base = route(root);
  root = push(root, "GroupChat", { groupId: "chosen-group" });
  const groupKey = route(root).key;
  root = push(root, "WorkspaceSheet", {
    screen: "GroupEditor",
    params: { groupId: "chosen-group" },
  });
  const next = select(root, { kind: "group", groupId: "chosen-group" });
  assert.deepEqual(
    next.routes.map((route) => route.name),
    ["Workspace", "GroupChat"],
  );
  assert.equal(route(next, 0), base);
  assert.equal(route(next, 1).key, groupKey);
  const selectedAgain = select(next, {
    kind: "group",
    groupId: "chosen-group",
  });
  assert.equal(route(selectedAgain, 1).key, groupKey);
  const back = rootRouter.getStateForAction(
    selectedAgain,
    CommonActions.goBack(),
    rootOptions,
  );
  assert.ok(back);
  assert.equal(route(back), base);
  assert.equal(route(child(back)).name, "Assistant");
  assert.deepEqual(route(child(back)).params, route(child(fixture())).params);
});

test("a newly selected group replaces old group details without accumulating routes", () => {
  const initial = fixture();
  const first = select(initial, { kind: "group", groupId: "first-group" });
  const next = select(first, { kind: "group", groupId: "second-group" });
  assert.deepEqual(
    next.routes.map((route) => route.name),
    ["Workspace", "GroupChat"],
  );
  assert.notEqual(route(next, 1).key, route(first, 1).key);
  assert.equal(route(next, 0).key, route(initial, 0).key);
  assert.deepEqual(route(next, 1).params, { groupId: "second-group" });
});

test("an unmounted workspace child can be initialized by a drawer target", () => {
  const initial = rootRouter.getInitialState(rootOptions);
  for (const target of [
    { kind: "agent", agentId: "specialist", conversationId: "chat" },
    { kind: "group", groupId: "group" },
  ] as const) {
    const next = select(initial, target);
    if (target.kind === "agent") {
      assert.equal(route(child(next)).name, "Assistant");
    } else {
      assert.equal(route(next).name, "GroupChat");
    }
    assert.equal(route(next, 0).key, route(initial, 0).key);
  }
});

test("missing root or authenticated workspace produces no navigation action", () => {
  assert.equal(
    workspaceChatNavigationAction(undefined, { kind: "agent" }),
    null,
  );
  const auth = { ...fixture(), routes: [{ key: "auth", name: "Auth" }] };
  assert.equal(workspaceChatNavigationAction(auth, { kind: "agent" }), null);
  const withoutGroup = { ...fixture(), routeNames: ["Workspace", "Auth"] };
  assert.equal(
    workspaceChatNavigationAction(withoutGroup, {
      kind: "group",
      groupId: "group",
    }),
    null,
  );
});

function contextual(
  state: RootState,
  params: Parameters<typeof workspaceContextChatNavigationAction>[1],
) {
  const action = workspaceContextChatNavigationAction(state, params);
  assert.ok(action);
  assert.equal(action.target, state.key);
  const next = rootRouter.getStateForAction(state, action, rootOptions);
  assert.ok(next);
  return rootRouter.getRehydratedState(next, rootOptions);
}

test("opening an agent chat from a drawer preserves the calling transcript and base draft", () => {
  const caller = push(fixture(), "AssistantContext", {
    conversationId: "calling-chat",
    agentId: "calling-agent",
  });
  const opened = push(
    caller,
    "WorkspaceSheet",
    openWorkspaceSheetAction("AgentDetail", { agentId: "new-agent" }).payload
      .params,
  );
  const params = {
    agentId: "new-agent",
    conversationId: "new-chat",
    draft: false,
  };
  const next = contextual(opened, params);
  assert.deepEqual(
    next.routes.map((route) => route.name),
    ["Workspace", "AssistantContext", "AssistantContext"],
  );
  assert.equal(next.routes[0], caller.routes[0]);
  assert.equal(next.routes[1], caller.routes[1]);
  assert.deepEqual(route(next).params, params);
  const back = rootRouter.getStateForAction(
    next,
    CommonActions.goBack(),
    rootOptions,
  );
  assert.ok(back);
  assert.equal(route(back), route(caller));
});

test("reopening an existing contextual conversation reuses its route after dismissing the drawer", () => {
  const caller = push(fixture(), "AssistantContext", {
    conversationId: "current-chat",
    agentId: "agent-1",
  });
  const opened = push(caller, "WorkspaceSheet", {
    screen: "AgentDetail",
    params: { agentId: "agent-1" },
  });
  const params = {
    conversationId: "current-chat",
    agentId: "agent-1",
    acknowledgementId: "card-2",
  };
  const next = contextual(opened, params);
  assert.equal(next.routes.length, 2);
  assert.equal(route(next).key, route(caller).key);
  assert.deepEqual(route(next).params, params);
  assert.equal(next.routes[0], caller.routes[0]);
});

test("starting a contextual draft retains another unfinished draft route", () => {
  const caller = push(fixture(), "AssistantContext", {
    agentId: "agent-1",
    draft: true,
  });
  const opened = push(caller, "WorkspaceSheet", {
    screen: "AgentDetail",
    params: { agentId: "agent-1" },
  });
  const next = contextual(opened, { agentId: "agent-1", draft: true });
  assert.equal(next.routes.length, 3);
  assert.notEqual(route(next).key, route(caller).key);
  assert.equal(next.routes[1], caller.routes[1]);
});

test("opening a specialist chat from group settings preserves the actual group underneath", () => {
  const caller = push(fixture(), "GroupChat", { groupId: "group-1" });
  const opened = push(caller, "WorkspaceSheet", {
    screen: "GroupEditor",
    params: { groupId: "group-1" },
  });
  const next = contextual(opened, { agentId: "specialist", draft: true });
  assert.deepEqual(
    next.routes.map((route) => route.name),
    ["Workspace", "GroupChat", "AssistantContext"],
  );
  assert.equal(next.routes[1], caller.routes[1]);
});

test("contextual navigation waits for an authenticated chat navigator", () => {
  assert.equal(workspaceContextChatNavigationAction(undefined, {}), null);
  assert.equal(
    workspaceContextChatNavigationAction(
      { ...fixture(), routes: [{ key: "auth", name: "Auth" }] },
      {},
    ),
    null,
  );
  assert.equal(
    workspaceContextChatNavigationAction(
      { ...fixture(), routeNames: ["Workspace", "Auth"] },
      {},
    ),
    null,
  );
});

test("active chat targets preserve exact identities and ignore non-chat routes", () => {
  assert.deepEqual(
    activeWorkspaceChatTarget({ name: "Assistant", params: { home: true } }),
    { kind: "home" },
  );
  for (const params of [
    { home: true, agentId: "agent" },
    { home: true, conversationId: "chat" },
    { home: true, draft: true },
  ]) {
    assert.equal(
      activeWorkspaceChatTarget({ name: "Assistant", params })?.kind,
      "agent",
    );
  }
  for (const name of ["Assistant", "AssistantContext"]) {
    assert.deepEqual(
      activeWorkspaceChatTarget({
        name,
        params: {
          agentId: "agent",
          conversationId: "chat",
          acknowledgementId: "card",
        },
      }),
      { kind: "agent", agentId: "agent", conversationId: "chat" },
    );
    assert.deepEqual(
      activeWorkspaceChatTarget({ name }),
      name === "Assistant"
        ? { kind: "home" }
        : {
            kind: "agent",
            agentId: undefined,
            conversationId: undefined,
          },
    );
    assert.deepEqual(
      activeWorkspaceChatTarget({
        name,
        params: { agentId: 12, conversationId: "" },
      }),
      { kind: "agent", agentId: undefined, conversationId: undefined },
    );
  }
  assert.deepEqual(
    activeWorkspaceChatTarget({
      name: "GroupChat",
      params: { groupId: "group" },
    }),
    { kind: "group", groupId: "group" },
  );
  for (const route of [
    undefined,
    { name: "GroupChat" },
    { name: "Agents", params: { groupId: "group" } },
    { name: "AgentDetail", params: { agentId: "agent" } },
  ]) {
    assert.equal(activeWorkspaceChatTarget(route), undefined);
  }
});
