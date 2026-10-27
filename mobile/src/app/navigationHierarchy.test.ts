import { hydratedTestRouter } from "./routerTestHarness";
import assert from "node:assert/strict";
import test from "node:test";
import { getPathFromState, getStateFromPath } from "@react-navigation/core";
import {
  CommonActions,
  StackActions,
  StackRouter,
  TabRouter,
  type NavigationState,
  type PartialState,
} from "@react-navigation/routers";
import { navigationLinkingConfig } from "./navigationLinking";
import { desktopRouteParams } from "../features/machines/desktopEntry";
import {
  challengeNavigationAction,
  dismissWorkspaceSheetAction,
  openWorkspaceSheetAction,
  withWorkspaceFallback,
  workspaceNavigateAction,
  workspacePanelRouterOptions,
  workspaceRouterOptions,
  workspaceSharedEntryNavigationAction,
} from "./navigationHierarchy";

const rootRouter = hydratedTestRouter(
  StackRouter({ initialRouteName: "Workspace" }),
);
const rootOptions = {
  routeNames: Object.keys(navigationLinkingConfig.screens ?? {}),
  routeParamList: {},
  routeGetIdList: {},
};
const chatRouter = hydratedTestRouter(TabRouter(workspaceRouterOptions));
const chatOptions = {
  routeNames: ["Assistant"],
  routeParamList: {},
  routeGetIdList: {},
};
const panelRouter = hydratedTestRouter(TabRouter(workspacePanelRouterOptions));
const panelOptions = {
  routeNames: [
    "Agents",
    "Plugins",
    "Automations",
    "Services",
    "Machines",
    "Activity",
    "AccountSettings",
  ],
  routeParamList: {},
  routeGetIdList: {},
};
const sheetRouter = hydratedTestRouter(
  StackRouter({ initialRouteName: "Pages" }),
);
const sheetOptions = {
  routeNames: [
    "Pages",
    "AgentCreate",
    "AgentDetail",
    "GroupEditor",
    "ServiceSetup",
    "AgentSkills",
    "AgentMachines",
    "MachinePolicy",
    "MachineActivity",
    "ActivityDetail",
    "AutomationDetail",
    "AutomationEditor",
    "AutomationRuns",
    "AutomationPreferences",
    "AccountSecurity",
    "UsageCredits",
    "DeviceLogin",
    "AgentKeyLogin",
    "TermsOfService",
    "PrivacyPolicy",
  ],
  routeParamList: {},
  routeGetIdList: {},
};
type State = ReturnType<typeof rootRouter.getInitialState>;

test("desktop cold links stay outside the drawer and preserve every selector", () => {
  const state = withWorkspaceFallback(
    getStateFromPath(
      "assistant/machines/node/desktop?conversation_id=nyxa-thread&context_id=context&display=dev",
      navigationLinkingConfig,
    ),
  )!;
  assert.deepEqual(
    state.routes.map((route) => route.name),
    ["Workspace", "MachineDesktop"],
  );
  const route = state.routes.at(-1)!;
  assert.deepEqual(
    desktopRouteParams(
      route.params as Parameters<typeof desktopRouteParams>[0],
    ),
    {
      nodeId: "node",
      conversationId: "nyxa-thread",
      contextId: "context",
      display: "dev",
    },
  );
  assert.equal(
    state.routes.some((route) => route.name === "WorkspaceSheet"),
    false,
  );
});

function linkedState(path: string) {
  const state = withWorkspaceFallback(
    getStateFromPath(path, navigationLinkingConfig),
  );
  assert.ok(state, `Expected navigation state for ${path}`);
  return state;
}
function selected(state: NavigationState | PartialState<NavigationState>) {
  const route = state.routes[state.index ?? state.routes.length - 1];
  assert.ok(route);
  return route;
}
function focusedNames(state: NavigationState | PartialState<NavigationState>) {
  const names: string[] = [];
  let next: NavigationState | PartialState<NavigationState> | undefined = state;
  while (next) {
    const route = selected(next);
    names.push(route.name);
    next = route.state;
  }
  return names;
}
function fixture(): State {
  const root = rootRouter.getInitialState(rootOptions);
  let chat = chatRouter.getInitialState(chatOptions);
  const next = chatRouter.getStateForAction(
    chat,
    CommonActions.setParams({
      conversationId: "base-chat",
      agentId: "base-agent",
      draft: true,
    }),
    chatOptions,
  );
  assert.ok(next);
  chat = next;
  return {
    ...root,
    routes: root.routes.map((route) => ({ ...route, state: chat })),
  };
}
function apply(
  state: State,
  action:
    | ReturnType<typeof openWorkspaceSheetAction>
    | ReturnType<typeof dismissWorkspaceSheetAction>
    | ReturnType<typeof workspaceSharedEntryNavigationAction>,
) {
  assert.ok(action);
  const next = rootRouter.getStateForAction(state, action, rootOptions);
  assert.ok(next);
  return rootRouter.getRehydratedState(next, rootOptions);
}
function pushContext(
  state: State,
  name = "AssistantContext",
  params: object = {
    conversationId: "context-chat",
    acknowledgementId: "card-1",
  },
) {
  const next = rootRouter.getStateForAction(
    state,
    StackActions.push(name, params),
    rootOptions,
  );
  assert.ok(next);
  return next;
}

test("non-chat workspace links open one drawer with a chat underneath", () => {
  for (const [path, page] of [
    ["automations", "Automations"],
    ["agents", "Agents"],
    ["plugins", "Plugins"],
    ["services", "Services"],
    ["activity", "Activity"],
    ["account", "AccountSettings"],
  ]) {
    const state = linkedState(path!);
    assert.deepEqual(
      state.routes.map((route) => route.name),
      ["Workspace", "WorkspaceSheet"],
    );
    assert.deepEqual(focusedNames(state), ["WorkspaceSheet", "Pages", page]);
    assert.deepEqual(focusedNames(state.routes[0]!.state!), ["Assistant"]);
    assert.equal(getPathFromState(state, navigationLinkingConfig), `/${path}`);
    const root = rootRouter.getRehydratedState(state, rootOptions);
    const closed = apply(root, dismissWorkspaceSheetAction(root));
    assert.deepEqual(focusedNames(closed), ["Workspace", "Assistant"]);
  }
});

test("panel URLs retain encoded filters and selected group tabs", () => {
  for (const [path, name, params] of [
    [
      "automations?agentId=agent%20one&setup=watch-1",
      "Automations",
      { agentId: "agent one", setup: "watch-1" },
    ],
    [
      "plugins?tab=skills&agentId=agent%20one",
      "Plugins",
      { tab: "skills", agentId: "agent one" },
    ],
    [
      "activity?challengeId=challenge%2Fone",
      "Activity",
      { challengeId: "challenge/one" },
    ],
    ["agents?tab=groups", "Agents", { tab: "groups" }],
  ] as const) {
    const state = linkedState(path);
    assert.deepEqual(focusedNames(state), ["WorkspaceSheet", "Pages", name]);
    const panel = selected(selected(state).state!).state!;
    assert.deepEqual(selected(panel).params, params);
  }
});

test("cold detail links have an appropriate module inside the same drawer", () => {
  for (const [path, name, panel] of [
    ["agents/agent%20one", "AgentDetail", "Agents"],
    ["groups/edit", "GroupEditor", "Agents"],
    ["groups/edit/group-1", "GroupEditor", "Agents"],
    ["automations/automation-1", "AutomationDetail", "Automations"],
    ["automations/edit", "AutomationEditor", "Automations"],
    ["automations/edit/automation-1", "AutomationEditor", "Automations"],
    ["automations/automation-1/runs", "AutomationRuns", "Automations"],
    ["automations/preferences", "AutomationPreferences", "Automations"],
    ["account/security", "AccountSecurity", "AccountSettings"],
    ["account/usage", "UsageCredits", "AccountSettings"],
  ]) {
    const state = linkedState(path!);
    assert.deepEqual(
      state.routes.map((route) => route.name),
      ["Workspace", "WorkspaceSheet"],
    );
    assert.deepEqual(focusedNames(state), ["WorkspaceSheet", name]);
    const sheet = selected(state).state!;
    const pages = sheet.routes.find((route) => route.name === "Pages");
    assert.ok(pages?.state);
    assert.equal(selected(pages.state).name, panel);
    if (name === "GroupEditor")
      assert.deepEqual(selected(pages.state).params, { tab: "groups" });
    const hydrated = sheetRouter.getRehydratedState(sheet, sheetOptions);
    const back = sheetRouter.getStateForAction(
      hydrated,
      CommonActions.goBack(),
      sheetOptions,
    );
    assert.ok(back);
    assert.deepEqual(focusedNames(back), ["Pages", panel]);
    const root = rootRouter.getRehydratedState(state, rootOptions);
    assert.deepEqual(
      focusedNames(apply(root, dismissWorkspaceSheetAction(root))),
      ["Workspace", "Assistant"],
    );
    assert.equal(getPathFromState(state, navigationLinkingConfig), `/${path}`);
  }
});

test("chat and group deep links remain full chat routes", () => {
  const base = linkedState("chat?agentId=agent-1&draft=true&openLatest=false");
  assert.deepEqual(focusedNames(base), ["Workspace", "Assistant"]);
  assert.deepEqual(selected(selected(base).state!).params, {
    agentId: "agent-1",
    draft: true,
    openLatest: false,
  });
  const context = linkedState(
    "chat/conversation-1?acknowledgementId=card-1&agentId=agent-1&draft=false&openLatest=true",
  );
  assert.deepEqual(focusedNames(context), ["AssistantContext"]);
  assert.deepEqual(selected(context).params, {
    conversationId: "conversation-1",
    acknowledgementId: "card-1",
    agentId: "agent-1",
    draft: false,
    openLatest: true,
  });
  const reopened = linkedState(
    getPathFromState(context, navigationLinkingConfig),
  );
  assert.deepEqual(selected(reopened).params, selected(context).params);
  const group = linkedState("groups/group-1");
  assert.deepEqual(focusedNames(group), ["GroupChat"]);
  assert.deepEqual(focusedNames(group.routes[0]!.state!), ["Assistant"]);
});

test("shared login/legal entry links keep their signed-out root destinations", () => {
  for (const [path, name, params] of [
    [
      "login/device?user_code=ABCD-EFGH",
      "DeviceLogin",
      { user_code: "ABCD-EFGH" },
    ],
    [
      "login/agent-key?user_code=IJKL-MNOP",
      "AgentKeyLogin",
      { user_code: "IJKL-MNOP" },
    ],
    ["terms", "TermsOfService", undefined],
    ["privacy", "PrivacyPolicy", undefined],
    ["auth", "Auth", undefined],
  ] as const) {
    assert.equal(selected(linkedState(path)).name, name);
    assert.deepEqual(selected(linkedState(path)).params, params);
  }
});

test("the existing Web automation alias opens the drawer and produces the canonical URL", () => {
  const state = linkedState("assistant/automations");
  assert.deepEqual(focusedNames(state), [
    "WorkspaceSheet",
    "Pages",
    "Automations",
  ]);
  assert.equal(
    getPathFromState(state, navigationLinkingConfig),
    "/automations",
  );
});

test("opening any management destination retains the exact contextual chat and base draft", () => {
  for (const page of [
    "AccountSettings",
    "Plugins",
    "Agents",
    "Automations",
    "Activity",
    "Services",
    "Machines",
  ] as const) {
    const root = pushContext(fixture());
    const opened = apply(root, workspaceNavigateAction(page));
    assert.deepEqual(
      opened.routes.map((route) => route.name),
      ["Workspace", "AssistantContext", "WorkspaceSheet"],
    );
    assert.equal(opened.routes[0], root.routes[0]);
    assert.equal(opened.routes[1], root.routes[1]);
    const closed = apply(opened, dismissWorkspaceSheetAction(opened));
    assert.deepEqual(closed.routes, root.routes);
    assert.equal(closed.index, root.index);
  }
});

test("agent and group creation drawers retain the exact calling chat", () => {
  for (const name of ["AgentCreate", "GroupEditor"] as const) {
    const root = pushContext(fixture());
    const opened = apply(root, openWorkspaceSheetAction(name));
    assert.equal(opened.routes[0], root.routes[0]);
    assert.equal(opened.routes[1], root.routes[1]);
    assert.equal(selected(opened).name, "WorkspaceSheet");
    assert.equal((selected(opened).params as { screen: string }).screen, name);
    assert.deepEqual(
      apply(opened, dismissWorkspaceSheetAction(opened)).routes,
      root.routes,
    );
  }
});

test("group chat stays directly beneath the management drawer", () => {
  const root = pushContext(fixture(), "GroupChat", { groupId: "group-1" });
  const opened = apply(
    root,
    openWorkspaceSheetAction("GroupEditor", { groupId: "group-1" }),
  );
  assert.equal(opened.routes[1], root.routes[1]);
  assert.deepEqual(
    apply(opened, dismissWorkspaceSheetAction(opened)).routes,
    root.routes,
  );
});

test("nested destinations and repeated selections reuse a single drawer route", () => {
  let root = apply(
    fixture(),
    openWorkspaceSheetAction("AutomationEditor", { agentId: "agent-1" }),
  );
  const key = selected(root).key;
  assert.deepEqual(selected(root).params, {
    screen: "AutomationEditor",
    params: { agentId: "agent-1" },
    initial: false,
    merge: true,
    pop: true,
  });
  for (const page of ["Plugins", "AccountSettings", "Activity"] as const) {
    root = apply(root, workspaceNavigateAction(page));
    assert.equal(root.routes.length, 2);
    assert.equal(selected(root).key, key);
    assert.deepEqual(selected(root).params, {
      screen: "Pages",
      params: { screen: page, params: undefined, initial: false, merge: true },
      initial: false,
      merge: true,
      pop: true,
    });
  }
});

test("Chats closes the whole drawer instead of changing the underlying chat", () => {
  const caller = pushContext(fixture());
  const opened = apply(
    caller,
    openWorkspaceSheetAction("AgentDetail", { agentId: "agent-1" }),
  );
  const action = workspaceNavigateAction("Assistant", undefined, opened);
  assert.ok(action);
  assert.equal(action.target, opened.key);
  assert.deepEqual(apply(opened, action).routes, caller.routes);
  assert.equal(workspaceNavigateAction("Assistant", undefined, caller), null);
  assert.equal(dismissWorkspaceSheetAction(undefined), null);
});

test("panel selections merge filters and preserve mounted module route keys", () => {
  let state = panelRouter.getInitialState(panelOptions);
  const keys = state.routes.map((route) => route.key);
  for (const [name, params] of [
    ["Automations", { setup: "watch-1" }],
    ["Plugins", { tab: "skills" }],
    ["Agents", { tab: "groups" }],
    ["Automations", { agentId: "researcher", setup: undefined }],
  ] as const) {
    const action = workspaceNavigateAction(name, params);
    assert.ok(action?.type === "NAVIGATE");
    const nested = action.payload.params.params;
    assert.ok(nested?.screen);
    const next = panelRouter.getStateForAction(
      state,
      CommonActions.navigate({
        name: nested.screen,
        params: nested.params,
        merge: nested.merge,
      }),
      panelOptions,
    );
    assert.ok(next);
    state = next;
  }
  assert.deepEqual(
    state.routes.map((route) => route.key),
    keys,
  );
  assert.deepEqual(selected(state).params, {
    agentId: "researcher",
    setup: undefined,
  });
  assert.deepEqual(
    state.routes.find((route) => route.name === "Agents")?.params,
    { tab: "groups" },
  );
  assert.equal(
    panelRouter.getStateForAction(state, CommonActions.goBack(), panelOptions),
    null,
  );
});

test("notification taps wait for authentication and all critical-write guards", () => {
  assert.equal(challengeNavigationAction(undefined, "challenge-1"), null);
  const auth = {
    ...fixture(),
    routeNames: ["Auth", "DeviceLogin", "AgentKeyLogin"],
  };
  assert.equal(challengeNavigationAction(auth, "challenge-1"), null);
  const root = apply(
    pushContext(fixture()),
    openWorkspaceSheetAction("AutomationEditor", { id: "automation-1" }),
  );
  const guards = new Set([Symbol("saving"), Symbol("uploading")]);
  assert.equal(
    challengeNavigationAction(root, "challenge-1", guards.size > 0),
    null,
  );
  guards.delete([...guards][0]!);
  assert.equal(
    challengeNavigationAction(root, "challenge-1", guards.size > 0),
    null,
  );
  guards.clear();
  assert.ok(challengeNavigationAction(root, "challenge-1", guards.size > 0));
});

test("approval notifications reuse the drawer while preserving the exact active chat", () => {
  const caller = pushContext(fixture());
  const opened = apply(
    caller,
    openWorkspaceSheetAction("AgentDetail", { agentId: "agent-1" }),
  );
  const action = challengeNavigationAction(opened, "challenge-1");
  assert.ok(action);
  assert.equal(action.target, opened.key);
  const next = apply(opened, action);
  assert.equal(next.routes.length, 3);
  assert.equal(selected(next).key, selected(opened).key);
  assert.equal(next.routes[1], caller.routes[1]);
  assert.deepEqual(selected(next).params, {
    screen: "Pages",
    params: {
      screen: "Activity",
      params: { challengeId: "challenge-1" },
      initial: false,
      merge: true,
    },
    initial: false,
    merge: true,
    pop: true,
  });
  assert.deepEqual(
    apply(next, dismissWorkspaceSheetAction(next)).routes,
    caller.routes,
  );
});

test("notification restoration repairs a missing base without discarding a contextual chat", () => {
  const root = rootRouter.getRehydratedState(
    {
      routes: [
        {
          name: "AssistantContext",
          params: { conversationId: "restored-chat" },
        },
      ],
    },
    rootOptions,
  );
  const action = challengeNavigationAction(root, "challenge-1");
  assert.ok(action);
  const next = apply(root, action);
  assert.deepEqual(
    next.routes.map((route) => route.name),
    ["Workspace", "AssistantContext", "WorkspaceSheet"],
  );
  assert.equal(next.routes[1], root.routes[0]);
});

test("link fallback is idempotent and does not replace existing chat state", () => {
  assert.equal(withWorkspaceFallback(undefined), undefined);
  assert.equal(
    getStateFromPath("unrecognized/path", navigationLinkingConfig),
    undefined,
  );
  const state = linkedState("account");
  assert.equal(withWorkspaceFallback(state), state);
  const live = fixture();
  assert.equal(withWorkspaceFallback(live), live);
});

test("a signed-in shared entry replaces its temporary root route with one drawer", () => {
  for (const [name, params] of [
    ["DeviceLogin", { user_code: "ABCD-EFGH" }],
    ["AgentKeyLogin", { user_code: "IJKL-MNOP" }],
    ["TermsOfService", undefined],
    ["PrivacyPolicy", undefined],
  ] as const) {
    const caller = pushContext(fixture());
    const entry = pushContext(caller, name, params ?? {});
    const action = workspaceSharedEntryNavigationAction(entry, name, params);
    assert.ok(action);
    assert.equal(action.target, entry.key);
    assert.ok("source" in action);
    assert.equal(action.source, selected(entry).key);
    const next = apply(entry, action);
    assert.deepEqual(
      next.routes.map((route) => route.name),
      ["Workspace", "AssistantContext", "WorkspaceSheet"],
    );
    assert.equal(next.routes[0], caller.routes[0]);
    assert.equal(next.routes[1], caller.routes[1]);
    assert.deepEqual(selected(next).params, {
      screen: name,
      params,
      initial: false,
    });
    assert.deepEqual(
      apply(next, dismissWorkspaceSheetAction(next)).routes,
      caller.routes,
    );
  }
});

test("an external shared entry reuses the existing drawer and retains the dirty editor underneath", () => {
  for (const [name, params] of [
    ["DeviceLogin", { user_code: "ABCD-EFGH" }],
    ["AgentKeyLogin", { mint: true }],
    ["TermsOfService", undefined],
    ["PrivacyPolicy", undefined],
  ] as const) {
    let sheet = sheetRouter.getInitialState(sheetOptions);
    const editing = sheetRouter.getStateForAction(
      sheet,
      StackActions.push("AutomationEditor", { id: "unsaved-automation" }),
      sheetOptions,
    );
    assert.ok(editing);
    sheet = editing;
    const editor = selected(sheet);
    const caller = pushContext(fixture());
    let root = apply(
      caller,
      openWorkspaceSheetAction("AutomationEditor", {
        id: "unsaved-automation",
      }),
    );
    root = {
      ...root,
      routes: root.routes.map((route) =>
        route.name === "WorkspaceSheet" ? { ...route, state: sheet } : route,
      ),
    };
    const previousDrawer = selected(root);
    const entry = pushContext(root, name, params ?? {});
    const entryKey = selected(entry).key;
    const action = workspaceSharedEntryNavigationAction(entry, name, params);
    assert.ok(action);
    assert.equal(action.target, entry.key);
    const next = apply(entry, action);
    assert.deepEqual(
      next.routes.map((route) => route.name),
      ["Workspace", "AssistantContext", "WorkspaceSheet"],
    );
    const drawer = selected(next);
    assert.equal(drawer.key, previousDrawer.key);
    assert.equal(drawer.params, undefined);
    assert.equal(next.routes[0], caller.routes[0]);
    assert.equal(next.routes[1], caller.routes[1]);
    assert.ok(drawer.state);
    const nested = sheetRouter.getRehydratedState(drawer.state, sheetOptions);
    assert.equal(nested.key, sheet.key);
    assert.equal(nested.routes.length, sheet.routes.length + 1);
    for (let i = 0; i < sheet.routes.length; i += 1)
      assert.equal(nested.routes[i], sheet.routes[i]);
    assert.equal(selected(nested).key, entryKey);
    assert.equal(selected(nested).name, name);
    assert.deepEqual(selected(nested).params, params);
    const backToEditor = sheetRouter.getStateForAction(
      nested,
      CommonActions.goBack(),
      sheetOptions,
    );
    assert.ok(backToEditor);
    assert.equal(selected(backToEditor), editor);
    assert.equal(backToEditor.key, sheet.key);
    assert.equal(
      workspaceSharedEntryNavigationAction(next, name, params),
      null,
    );
  }
});

test("shared entries preserve a linked drawer that has not mounted its nested navigator yet", () => {
  const caller = fixture();
  const opened = apply(
    caller,
    openWorkspaceSheetAction("Pages", { screen: "AccountSettings" }),
  );
  const previousDrawer = selected(opened);
  assert.equal(previousDrawer.state, undefined);
  const entry = pushContext(opened, "DeviceLogin", { user_code: "ABCD-EFGH" });
  const action = workspaceSharedEntryNavigationAction(entry, "DeviceLogin", {
    user_code: "ABCD-EFGH",
  });
  assert.ok(action);
  const next = apply(entry, action);
  assert.equal(selected(next).key, previousDrawer.key);
  const sheet = sheetRouter.getRehydratedState(
    selected(next).state!,
    sheetOptions,
  );
  assert.deepEqual(
    sheet.routes.map((route) => route.name),
    ["Pages", "DeviceLogin"],
  );
  assert.equal(selected(sheet).key, selected(entry).key);
  assert.deepEqual(sheet.routes[0]!.params, { screen: "AccountSettings" });
});

test("shared-entry redirection ignores signed-out or already-consumed root entries", () => {
  assert.equal(
    workspaceSharedEntryNavigationAction(undefined, "DeviceLogin", {}),
    null,
  );
  assert.equal(
    workspaceSharedEntryNavigationAction(fixture(), "DeviceLogin", {}),
    null,
  );
  const entry = pushContext(fixture(), "DeviceLogin", {});
  const signedOut = { ...entry, routeNames: ["Auth", "DeviceLogin"] };
  assert.equal(
    workspaceSharedEntryNavigationAction(signedOut, "DeviceLogin", {}),
    null,
  );
});

test("every registered management screen opens one drawer above the exact retained chat", () => {
  const caller = fixture();
  const entries = [
    ["AgentCreate", undefined],
    ["AgentDetail", { agentId: "specialist" }],
    ["GroupEditor", { groupId: "group" }],
    ["ServiceSetup", { catalogSlug: "docs" }],
    ["AgentSkills", { agentId: "specialist" }],
    ["AgentMachines", { agentId: "specialist" }],
    ["AutomationDetail", { id: "watch" }],
    ["AutomationEditor", { agentId: "specialist" }],
    ["AutomationRuns", { id: "watch" }],
    ["AutomationPreferences", undefined],
    ["ActivityDetail", { challengeId: "challenge" }],
    ["AccountSecurity", undefined],
    ["DeviceLogin", { user_code: "ABCD-EFGH" }],
    ["AgentKeyLogin", { user_code: "ABCD-EFGH" }],
    ["TermsOfService", undefined],
    ["PrivacyPolicy", undefined],
  ] as const;
  for (const [name, params] of entries) {
    const opened = apply(caller, openWorkspaceSheetAction(name, params));
    assert.equal(
      opened.routes.filter((route) => route.name === "WorkspaceSheet").length,
      1,
    );
    assert.equal(opened.routes[0], caller.routes[0]);
    assert.deepEqual(
      apply(opened, dismissWorkspaceSheetAction(opened)).routes,
      caller.routes,
    );
  }
});
test("a cold ServiceSetup drawer returns to Plugins with the retained chat underneath", () => {
  const partial = withWorkspaceFallback({
    routes: [
      {
        name: "WorkspaceSheet",
        state: {
          routes: [
            { name: "Pages" },
            { name: "ServiceSetup", params: { catalogSlug: "docs" } },
          ],
        },
      },
    ],
  });
  assert.ok(partial);
  const sheet = partial.routes.find((route) => route.name === "WorkspaceSheet");
  assert.equal(sheet?.state?.routes[0]?.state?.routes[0]?.name, "Plugins");
  assert.equal(partial.routes[0]?.name, "Workspace");
});

test("canonical machine links keep chat underneath and select detail or logins", () => {
  for (const [path, params] of [
    ["assistant/machines", undefined],
    ["assistant/machines?machine=machine-one", { machine: "machine-one" }],
    ["assistant/machines?tab=logins", { tab: "logins" }],
  ] as const) {
    const state = linkedState(path);
    assert.deepEqual(focusedNames(state), [
      "WorkspaceSheet",
      "Pages",
      "Machines",
    ]);
    assert.equal(state.routes[0]?.name, "Workspace");
    const panel = selected(selected(state).state!);
    assert.deepEqual(selected(panel.state!).params, params);
  }
});

test("cold machine management details fall back to Machines in the same drawer", () => {
  for (const name of ["MachinePolicy", "MachineActivity"]) {
    const state = withWorkspaceFallback({
      stale: true as const,
      routes: [
        {
          name: "WorkspaceSheet",
          state: {
            stale: true as const,
            routes: [
              { name: "Pages" },
              { name, params: { machineId: "machine", ownerId: "owner" } },
            ],
          },
        },
      ],
    });
    const sheet = selected(state!).state!;
    const pages = sheet.routes[0]!;
    assert.equal(selected(pages.state!).name, "Machines");
    assert.equal(state!.routes[0]!.name, "Workspace");
  }
});
