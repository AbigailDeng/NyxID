import { workspaceAccessibilityState } from "../lib/accessibility/workspaceAccessibility";
import { createWorkspaceFocusState } from "../lib/accessibility/workspaceFocusState";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import {
  StackRouter,
  TabRouter,
  type NavigationAction,
  type NavigationState,
} from "@react-navigation/routers";
import {
  openWorkspaceSheetAction,
  workspaceNavigateAction,
  workspaceRouterOptions,
} from "./navigationHierarchy";
import {
  activeWorkspaceChatTarget,
  workspaceChatNavigationAction,
  type WorkspaceChatTarget,
} from "./workspaceChatNavigation";

type Element = { type: unknown; props: Record<string, any> };
type Effect = {
  dependencies?: unknown[];
  cleanup?: () => void;
  run: () => void | (() => void);
};
const same = (a?: unknown[], b?: unknown[]) =>
  !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
function elements(root: Element): Element[] {
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

function fixture(): NavigationState {
  const root = StackRouter({ initialRouteName: "Workspace" }).getInitialState({
    routeNames: [
      "Workspace",
      "AssistantContext",
      "GroupChat",
      "WorkspaceSheet",
    ],
    routeParamList: {},
    routeGetIdList: {},
  });
  const workspace = TabRouter(workspaceRouterOptions).getInitialState({
    routeNames: ["Assistant"],
    routeParamList: {},
    routeGetIdList: {},
  });
  return {
    ...root,
    routes: root.routes.map((route) => ({ ...route, state: workspace })),
  };
}

/** Extract actual declarations so App's splash/network/push startup effects never execute. */
function shellSource() {
  const filename = fileURLToPath(new URL("./App.tsx", import.meta.url));
  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return (
    ["getActiveRouteName", "ThemedAppShell"]
      .map((name) => {
        const declaration = source.statements.find(
          (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
        );
        assert.ok(declaration, `Missing actual App declaration ${name}`);
        return declaration.getText(source);
      })
      .join("\n") + "\nexports.ThemedAppShell = ThemedAppShell;"
  );
}

function setup() {
  let rootState = fixture();
  let authenticated = true;
  let authEpoch = 0;
  let ready = true;
  let rootReads = 0;
  let cursor = 0;
  let dirty = false;
  let rendered!: Element;
  const slots: unknown[] = [];
  const effects = new Map<number, Effect>();
  let pendingEffects: number[] = [];
  const dispatched: NavigationAction[] = [];
  const focused: number[] = [];
  const scheduled: (() => void)[] = [];
  const scheduledWhileHidden: boolean[] = [];
  const nativeMenuOwner = Symbol("native menu host");
  const focus = createWorkspaceFocusState(
    (target) => focused.push(target),
    (callback) => {
      scheduledWhileHidden.push(background().props.accessibilityElementsHidden);
      scheduled.push(callback);
    },
    () => authEpoch,
  );
  const react = {
    useRef: <T>(initial: T) => {
      const i = cursor++;
      slots[i] ??= { current: initial };
      return slots[i] as { current: T };
    },
    useState: <T>(initial?: T | (() => T)) => {
      const i = cursor++;
      if (!(i in slots))
        slots[i] =
          typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        slots[i] as T,
        (next: T | ((previous: T) => T)) => {
          const value =
            typeof next === "function"
              ? (next as (previous: T) => T)(slots[i] as T)
              : next;
          if (!Object.is(value, slots[i])) {
            slots[i] = value;
            dirty = true;
          }
        },
      ] as const;
    },
    useCallback: <T>(callback: T, dependencies: unknown[]) => {
      const i = cursor++;
      const previous = slots[i] as
        | { callback: T; dependencies: unknown[] }
        | undefined;
      if (!previous || !same(previous.dependencies, dependencies))
        slots[i] = { callback, dependencies };
      return (slots[i] as { callback: T }).callback;
    },
    useEffect: (run: Effect["run"], dependencies?: unknown[]) => {
      const i = cursor++;
      const previous = effects.get(i);
      if (!previous || !same(previous.dependencies, dependencies)) {
        effects.set(i, { dependencies, run, cleanup: previous?.cleanup });
        pendingEffects.push(i);
      }
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({
    type,
    props,
  });
  const exports: { ThemedAppShell?: (props: object) => Element } = {};
  const output = ts.transpileModule(shellSource(), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  runInNewContext(output, {
    exports,
    require: (name: string) => {
      assert.equal(
        name,
        "react/jsx-runtime",
        "only extracted component declarations may load",
      );
      return { jsx, jsxs: jsx, Fragment: "Fragment" };
    },
    ...react,
    useTheme: () => ({ mode: "dark" }),
    useSafeAreaInsets: () => ({ top: 40 }),
    useAuthSession: () => ({ isAuthenticated: authenticated }),
    ...Object.fromEntries(
      [
        "NavigationContainer",
        "StatusBar",
        "AppNavigator",
        "View",
        "ToastOverlay",
        "WorkspaceDrawer",
      ].map((name) => [name, name]),
    ),
    WorkspaceAccessibilityContext: {
      Provider: "WorkspaceAccessibilityProvider",
    },
    workspaceAccessibilityState,
    workspaceFocus: focus,
    appLinking: {},
    pushToastStyles: { overlay: {} },
    appRootStyles: { fill: { flex: 1 } },
    workspaceNavigateAction,
    workspaceChatNavigationAction,
    openWorkspaceSheetAction,
    activeWorkspaceChatTarget,
  });
  const component = exports.ThemedAppShell;
  assert.ok(component);
  const navigationRef = {
    isReady: () => ready,
    getRootState: () => {
      rootReads++;
      return rootState;
    },
    getCurrentRoute: () => ({ name: "Assistant" }),
    dispatch: (action: NavigationAction) => dispatched.push(action),
  };
  function flush() {
    let iterations = 0;
    while (dirty || pendingEffects.length) {
      if (++iterations > 30) throw new Error("Shell did not settle");
      if (dirty) {
        dirty = false;
        cursor = 0;
        rendered = component!({
          navigationRef,
          currentRouteName: "Assistant",
          setCurrentRouteName: () => {},
          flushPendingChallengeTapNavigation: () => {},
          onNavigationGuardChange: () => {},
          pushToast: null,
        });
      }
      const pending = pendingEffects;
      pendingEffects = [];
      for (const i of pending) effects.get(i)?.cleanup?.();
      for (const i of pending) {
        const effect = effects.get(i)!;
        effect.cleanup = effect.run() || undefined;
      }
    }
  }
  const find = (name: string) => {
    const element = elements(rendered).find((item) => item.type === name);
    assert.ok(element, `Missing rendered ${name}`);
    return element;
  };
  const background = () =>
    elements(rendered).find(
      (item) =>
        item.type === "View" && "accessibilityElementsHidden" in item.props,
    )!;
  dirty = true;
  flush();
  return {
    dispatched,
    focus,
    focused,
    scheduledWhileHidden,
    flushFocus: () => {
      while (scheduled.length) scheduled.shift()!();
    },
    flush,
    drawer: (): Element => {
      const element = find("WorkspaceDrawer");
      return {
        ...element,
        props: {
          ...element.props,
          onDismiss: () => {
            // The actual native host releases ownership before this shell callback.
            focus.setModalActive(nativeMenuOwner, false);
            element.props.onDismiss();
          },
        },
      };
    },
    background,
    open: () => {
      find("AppNavigator").props.onOpenMenu();
      flush();
      focus.setModalActive(nativeMenuOwner, true);
    },
    readyNavigation: () => {
      find("NavigationContainer").props.onReady();
      flush();
    },
    changedNavigation: () => {
      find("NavigationContainer").props.onStateChange();
      flush();
    },
    setState: (state: NavigationState) => {
      rootState = state;
    },
    state: () => rootState,
    rootReads: () => rootReads,
    authenticate: (next: boolean) => {
      if (authenticated !== next) authEpoch++;
      authenticated = next;
      if (!next) focus.setModalActive(nativeMenuOwner, false);
      dirty = true;
      flush();
    },
    readiness: (next: boolean) => {
      ready = next;
    },
    hasDrawer: () =>
      elements(rendered).some((item) => item.type === "WorkspaceDrawer"),
  };
}

test("management, chat, scanner and login selections wait for actual menu dismissal", () => {
  const target: WorkspaceChatTarget = {
    kind: "agent",
    agentId: "researcher",
    conversationId: "chat-1",
  };
  for (const selection of [
    {
      choose: (drawer: Element) => drawer.props.onNavigate("Agents"),
      expected: () => workspaceNavigateAction("Agents"),
    },
    {
      choose: (drawer: Element) => drawer.props.onOpenChat(target),
      expected: (state: NavigationState) =>
        workspaceChatNavigationAction(state, target),
    },
    {
      choose: (drawer: Element) =>
        drawer.props.onOpenChat({ kind: "group", groupId: "group-1" }),
      expected: (state: NavigationState) =>
        workspaceChatNavigationAction(state, {
          kind: "group",
          groupId: "group-1",
        }),
    },
    {
      choose: (drawer: Element) => drawer.props.onCreateAgent(),
      expected: () => openWorkspaceSheetAction("AgentCreate"),
    },
    {
      choose: (drawer: Element) => drawer.props.onCreateGroup(),
      expected: () => openWorkspaceSheetAction("GroupEditor"),
    },
    {
      choose: (drawer: Element) => drawer.props.onScan(),
      expected: () =>
        openWorkspaceSheetAction("DeviceLogin", { start_scanner: true }),
    },
    {
      choose: (drawer: Element) => drawer.props.onUsageCredits(),
      expected: () => openWorkspaceSheetAction("UsageCredits"),
    },
    {
      choose: (drawer: Element) => drawer.props.onLoginCode(),
      expected: () => openWorkspaceSheetAction("AgentKeyLogin", { mint: true }),
    },
  ]) {
    const env = setup();
    env.open();
    assert.equal(env.drawer().props.visible, true);
    selection.choose(env.drawer());
    env.flush();
    assert.equal(env.drawer().props.visible, false);
    assert.deepEqual(env.dispatched, []);
    assert.equal(
      env.rootReads(),
      0,
      "navigation state is resolved after native dismissal",
    );
    env.drawer().props.onDismiss();
    // Scanner/login params are created inside the isolated component realm.
    assert.deepEqual(structuredClone(env.dispatched), [
      selection.expected(env.state()),
    ]);
    env.drawer().props.onDismiss();
    assert.equal(env.dispatched.length, 1);
  }
});

test("navigation accessibility stays excluded through menu exit and restores after host removal or auth change", () => {
  const env = setup();
  assert.equal(env.background().props.accessibilityElementsHidden, false);
  env.open();
  assert.equal(env.background().props.accessibilityElementsHidden, true);
  assert.equal(
    env.background().props.importantForAccessibility,
    "no-hide-descendants",
  );
  assert.equal(env.background().props.collapsable, false);
  env.drawer().props.onClose();
  env.flush();
  assert.equal(env.drawer().props.visible, false);
  assert.equal(
    env.background().props.accessibilityElementsHidden,
    true,
    "the native host remains during its exit animation",
  );
  env.drawer().props.onDismiss();
  env.flush();
  assert.equal(env.background().props.accessibilityElementsHidden, false);
  assert.equal(env.background().props.importantForAccessibility, "auto");
  env.open();
  env.authenticate(false);
  assert.equal(env.hasDrawer(), false);
  assert.equal(env.background().props.accessibilityElementsHidden, false);
});

test("plain menu Close restores a live primary owner only after the background visibility commit", () => {
  const env = setup();
  env.readyNavigation();
  const scope = env.state().routes[0]!.key;
  const original = Symbol("invoking header");
  let tag = 10;
  env.focus.register(original, () => tag, true, scope);
  env.focus.invoked(original);
  env.open();
  env.drawer().props.onClose();
  env.flush();
  env.flushFocus();
  assert.deepEqual(env.focused, [], "closing animation still owns focus");
  env.drawer().props.onDismiss();
  assert.equal(
    env.background().props.accessibilityElementsHidden,
    true,
    "the shell has not committed restored visibility yet",
  );
  env.flush();
  assert.equal(env.background().props.accessibilityElementsHidden, false);
  assert.ok(env.scheduledWhileHidden.length > 0);
  assert.ok(
    env.scheduledWhileHidden.every((hidden) => !hidden),
    "return focus is scheduled after the visible background commit",
  );
  env.focus.release(original);
  env.focus.register(Symbol("remounted header"), () => tag, true, scope);
  tag = 20;
  env.flushFocus();
  assert.deepEqual(
    env.focused,
    [20],
    "resolve the mounted active owner and its current native handle",
  );
});

test("menu return focus is skipped or cancelled for navigation, auth, scope replacement and reopening", () => {
  for (const cancel of [
    "navigation",
    "auth",
    "auth-before-dismiss",
    "scope",
    "reopen",
  ] as const) {
    const env = setup();
    env.readyNavigation();
    const scope = env.state().routes[0]!.key;
    const owner = Symbol("invoking header");
    env.focus.register(owner, () => 10, true, scope);
    env.focus.invoked(owner);
    env.open();
    if (cancel === "navigation") env.drawer().props.onNavigate("Agents");
    else env.drawer().props.onClose();
    env.flush();
    const dismiss = env.drawer().props.onDismiss;
    if (cancel === "auth-before-dismiss") env.authenticate(false);
    dismiss();
    env.flush();
    if (cancel === "auth") env.authenticate(false);
    if (cancel === "scope") {
      env.setState({
        ...env.state(),
        routes: [{ name: "GroupChat", key: "replacement-group" }],
        index: 0,
      });
      env.changedNavigation();
    }
    if (cancel === "reopen") env.open();
    env.flushFocus();
    assert.deepEqual(env.focused, [], cancel);
    if (cancel === "navigation") {
      assert.equal(env.dispatched.length, 1);
      assert.deepEqual(
        env.scheduledWhileHidden,
        [],
        "queued navigation never requests primary focus",
      );
    }
  }
});

test("management Chats resolves the latest root state when dismissal completes", () => {
  const env = setup();
  env.open();
  env.drawer().props.onNavigate("Assistant");
  env.flush();
  const previous = env.state();
  const latest = {
    ...previous,
    key: "root-after-selection",
    index: 2,
    routes: [
      previous.routes[0]!,
      {
        key: "context-latest",
        name: "AssistantContext",
        params: { conversationId: "latest-chat" },
      },
      { key: "sheet-latest", name: "WorkspaceSheet" },
    ],
  };
  env.setState(latest);
  env.drawer().props.onDismiss();
  const action = env.dispatched[0];
  assert.ok(action);
  assert.equal(action.target, latest.key);
  assert.deepEqual(
    action,
    workspaceNavigateAction("Assistant", undefined, latest),
  );
  assert.equal(env.rootReads(), 1);
});

test("chat selection preserves the latest mounted workspace rather than selection-time state", () => {
  const env = setup();
  env.open();
  const target: WorkspaceChatTarget = { kind: "group", groupId: "group-1" };
  env.drawer().props.onOpenChat(target);
  env.flush();
  const previous = env.state();
  const latestWorkspace = { ...previous.routes[0]!, key: "latest-workspace" };
  const latest = { ...previous, key: "latest-root", routes: [latestWorkspace] };
  env.setState(latest);
  env.drawer().props.onDismiss();
  const action = env.dispatched[0];
  assert.ok(action);
  assert.equal(action.target, latest.key);
  const payload = action.payload as { routes: unknown[] } | undefined;
  assert.equal(payload?.routes[0], latestWorkspace);
});

test("signing out clears every queued selection before a stale dismissal callback can run", () => {
  for (const choose of [
    (drawer: Element) => drawer.props.onNavigate("Services"),
    (drawer: Element) =>
      drawer.props.onOpenChat({ kind: "group", groupId: "group-1" }),
    (drawer: Element) => drawer.props.onScan(),
    (drawer: Element) => drawer.props.onCreateAgent(),
    (drawer: Element) => drawer.props.onCreateGroup(),
    (drawer: Element) => drawer.props.onLoginCode(),
    (drawer: Element) => drawer.props.onUsageCredits(),
  ]) {
    const env = setup();
    env.open();
    const stale = env.drawer();
    choose(stale);
    env.flush();
    env.authenticate(false);
    assert.equal(env.hasDrawer(), false);
    stale.props.onDismiss();
    assert.deepEqual(env.dispatched, []);
    env.authenticate(true);
    env.drawer().props.onDismiss();
    assert.deepEqual(env.dispatched, []);
    assert.equal(env.drawer().props.visible, false);
  }
});

test("manual Close dismisses the menu without scheduling navigation", () => {
  const env = setup();
  env.open();
  env.drawer().props.onClose();
  env.flush();
  assert.equal(env.drawer().props.visible, false);
  env.drawer().props.onDismiss();
  env.drawer().props.onDismiss();
  assert.deepEqual(env.dispatched, []);
  assert.equal(env.rootReads(), 0);
});

test("navigation readiness is checked at dismissal and unavailable actions are consumed once", () => {
  const env = setup();
  env.open();
  env.drawer().props.onScan();
  env.flush();
  env.readiness(false);
  env.drawer().props.onDismiss();
  assert.deepEqual(env.dispatched, []);
  env.readiness(true);
  env.drawer().props.onDismiss();
  assert.deepEqual(env.dispatched, []);
  env.open();
  env.readiness(false);
  env.drawer().props.onLoginCode();
  env.flush();
  env.readiness(true);
  env.drawer().props.onDismiss();
  assert.deepEqual(structuredClone(env.dispatched), [
    openWorkspaceSheetAction("AgentKeyLogin", { mint: true }),
  ]);
});

test("a second selection before dismissal replaces the queued destination", () => {
  const env = setup();
  env.open();
  const drawer = env.drawer();
  drawer.props.onNavigate("Agents");
  drawer.props.onNavigate("Automations");
  env.flush();
  assert.deepEqual(env.dispatched, []);
  env.drawer().props.onDismiss();
  assert.deepEqual(env.dispatched, [workspaceNavigateAction("Automations")]);
});
