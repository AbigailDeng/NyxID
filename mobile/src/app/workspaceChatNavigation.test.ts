import assert from "node:assert/strict";
import test from "node:test";
import {
  CommonActions,
  StackActions,
  StackRouter,
  TabRouter,
  type NavigationState,
} from "@react-navigation/routers";
import { workspaceRouterOptions } from "./navigationHierarchy";
import {
  activeWorkspaceChatTarget,
  workspaceChatNavigationAction,
  type WorkspaceChatTarget,
} from "./workspaceChatNavigation";

const workspaceRouter = TabRouter(workspaceRouterOptions);
const workspaceOptions = {
  routeNames: ["Assistant", "Agents", "Plugins", "Automations", "Activity"],
  routeParamList: {},
  routeGetIdList: {},
};
const rootRouter = StackRouter({ initialRouteName: "Workspace" });
const rootOptions = {
  routeNames: [
    "Auth",
    "Workspace",
    "AssistantContext",
    "GroupChat",
    "AgentDetail",
  ],
  routeParamList: {},
  routeGetIdList: {},
};
type RootState = ReturnType<typeof rootRouter.getInitialState>;

function fixture(): RootState {
  let workspace = workspaceRouter.getInitialState(workspaceOptions);
  for (const [name, params] of [
    [
      "Assistant",
      {
        agentId: "old-agent",
        conversationId: "old-chat",
        acknowledgementId: "old-card",
        draft: true,
        openLatest: true,
      },
    ],
    ["Plugins", { tab: "skills", agentId: "plugin-agent" }],
    ["Automations", { agentId: "automation-agent", setup: "saved-setup" }],
    ["Agents", { tab: "agents" }],
  ] as const) {
    const next = workspaceRouter.getStateForAction(
      workspace,
      CommonActions.navigate({ name, params }),
      workspaceOptions,
    );
    assert.ok(next);
    workspace = next;
  }
  const initial = rootRouter.getInitialState(rootOptions);
  return {
    ...initial,
    routes: initial.routes.map((route) => ({
      ...route,
      params: { screen: "Plugins", params: { tab: "skills" } },
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
  root = push(root, "AgentDetail", { agentId: "detail-agent" });
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
    agentId: "chosen-agent",
    conversationId: "chosen-chat",
    acknowledgementId: undefined,
    draft: false,
    openLatest: false,
  });
  for (const name of ["Plugins", "Automations", "Agents"]) {
    assert.equal(
      tabs.routes.find((route) => route.name === name),
      before.routes.find((route) => route.name === name),
    );
  }
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
    assert.deepEqual(route(tabs).params, {
      agentId,
      conversationId: undefined,
      acknowledgementId: undefined,
      draft: true,
      openLatest: false,
    });
  }
});

test("group selection reuses its existing route and native Back lands on the Groups tab", () => {
  let root = fixture();
  root = push(root, "GroupChat", { groupId: "chosen-group" });
  const groupKey = route(root).key;
  root = push(root, "AgentDetail", { agentId: "member-agent" });
  root = push(root, "GroupChat", { groupId: "other-group" });
  const before = child(root);
  const next = select(root, { kind: "group", groupId: "chosen-group" });
  assert.deepEqual(
    next.routes.map((route) => route.name),
    ["Workspace", "GroupChat"],
  );
  assert.equal(route(next, 0).key, route(root, 0).key);
  assert.equal(route(next, 1).key, groupKey);
  assert.deepEqual(route(next, 1).params, { groupId: "chosen-group" });
  const selectedAgain = select(next, {
    kind: "group",
    groupId: "chosen-group",
  });
  assert.equal(selectedAgain.routes.length, 2);
  assert.equal(route(selectedAgain, 1).key, groupKey);
  const back = rootRouter.getStateForAction(
    selectedAgain,
    CommonActions.goBack(),
    rootOptions,
  );
  assert.ok(back);
  const tabs = child(back);
  assert.equal(route(tabs).name, "Agents");
  assert.deepEqual(route(tabs).params, { tab: "groups" });
  for (const name of ["Assistant", "Plugins", "Automations"]) {
    assert.equal(
      tabs.routes.find((route) => route.name === name),
      before.routes.find((route) => route.name === name),
    );
  }
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
    const tabs = child(next);
    assert.equal(
      route(tabs).name,
      target.kind === "agent" ? "Assistant" : "Agents",
    );
    assert.equal(tabs.routes.length, workspaceOptions.routeNames.length);
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

test("active chat targets preserve exact identities and ignore non-chat routes", () => {
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
    assert.deepEqual(activeWorkspaceChatTarget({ name }), {
      kind: "agent",
      agentId: undefined,
      conversationId: undefined,
    });
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
