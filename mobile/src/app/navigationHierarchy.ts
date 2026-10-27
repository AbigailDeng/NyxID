import { CommonActions, StackActions } from "@react-navigation/routers";
import type { NavigationState, PartialState } from "@react-navigation/routers";
import type {
  WorkspaceParamList,
  WorkspaceSheetParamList,
} from "./navigationTypes";

export const workspaceRouterOptions = {
  initialRouteName: "Assistant",
  backBehavior: "none",
} as const;

export const workspacePanelRouterOptions = {
  initialRouteName: "Agents",
  backBehavior: "none",
} as const;

/** Present or reuse one drawer; nested details remain inside its own stack. */
export function openWorkspaceSheetAction<
  Name extends keyof WorkspaceSheetParamList,
>(name: Name, params?: WorkspaceSheetParamList[Name]) {
  return {
    type: "NAVIGATE" as const,
    target: undefined as string | undefined,
    payload: {
      name: "WorkspaceSheet",
      params: { screen: name, params, initial: false, merge: true, pop: true },
      merge: true,
    },
  };
}

export type WorkspaceSharedEntryName =
  | "DeviceLogin"
  | "AgentKeyLogin"
  | "TermsOfService"
  | "PrivacyPolicy";

/** Move a signed-in external entry into the existing drawer without losing edits. */
export function workspaceSharedEntryNavigationAction<
  Name extends WorkspaceSharedEntryName,
>(
  state: NavigationState | undefined,
  name: Name,
  params?: WorkspaceSheetParamList[Name],
) {
  if (!state?.routeNames.includes("WorkspaceSheet")) return null;
  const entry = state.routes[state.index];
  if (!entry || entry.name !== name) return null;
  const existing = state.routes.find(
    (route) => route.name === "WorkspaceSheet",
  );
  if (!existing) {
    return {
      ...StackActions.replace("WorkspaceSheet", {
        screen: name,
        params,
        initial: false,
      }),
      source: entry.key,
      target: state.key,
    };
  }

  const pending = existing.params as
    | {
        screen?: string;
        params?: object;
        state?: NavigationState | PartialState<NavigationState>;
      }
    | undefined;
  const previous = existing.state ?? pending?.state;
  const sheetRoutes =
    previous?.routes ??
    (pending?.screen === "Pages"
      ? [{ name: "Pages", params: pending.params }]
      : [
          { name: "Pages" },
          ...(pending?.screen
            ? [{ name: pending.screen, params: pending.params }]
            : []),
        ]);
  const sheet = {
    ...existing,
    // Existing nested navigation instructions have already been consumed.
    params: undefined,
    state: {
      ...previous,
      index: sheetRoutes.length,
      routes: [...sheetRoutes, { ...entry, name, params }],
    },
  };
  const routes = state.routes
    .filter((route) => route !== entry)
    .map((route) => (route === existing ? sheet : route));
  return {
    ...CommonActions.reset({
      ...state,
      index: routes.indexOf(sheet),
      routes,
    }),
    target: state.key,
  };
}

export function isWorkspaceChatRoute(route: { name: string }) {
  return (
    route.name === "Workspace" ||
    route.name === "AssistantContext" ||
    route.name === "GroupChat"
  );
}

/** Close the entire management drawer without changing the calling chat. */
export function dismissWorkspaceSheetAction(
  state: NavigationState | undefined,
) {
  if (!state?.routes.some((route) => route.name === "Workspace")) return null;
  const routes = state.routes
    .slice(0, state.index + 1)
    .filter(isWorkspaceChatRoute);
  if (routes.length === state.routes.length) return null;
  return {
    ...CommonActions.reset({ ...state, index: routes.length - 1, routes }),
    target: state.key,
  };
}

/** Drawer destinations overlay chat; Chats simply dismisses that overlay. */
export function workspaceNavigateAction<
  Name extends Exclude<keyof WorkspaceParamList, "Assistant">,
>(
  name: Name,
  params?: WorkspaceParamList[Name],
  state?: NavigationState,
): ReturnType<typeof openWorkspaceSheetAction<"Pages">>;
export function workspaceNavigateAction(
  name: "Assistant",
  params?: WorkspaceParamList["Assistant"],
  state?: NavigationState,
): ReturnType<typeof dismissWorkspaceSheetAction>;
export function workspaceNavigateAction<Name extends keyof WorkspaceParamList>(
  name: Name,
  params?: WorkspaceParamList[Name],
  state?: NavigationState,
):
  | ReturnType<typeof openWorkspaceSheetAction<"Pages">>
  | ReturnType<typeof dismissWorkspaceSheetAction>;
export function workspaceNavigateAction<Name extends keyof WorkspaceParamList>(
  name: Name,
  params?: WorkspaceParamList[Name],
  state?: NavigationState,
) {
  if (name === "Assistant") return dismissWorkspaceSheetAction(state);
  return openWorkspaceSheetAction("Pages", {
    screen: name,
    params,
    initial: false,
    merge: true,
  } as WorkspaceSheetParamList["Pages"]);
}

/** Keep notification taps pending until auth and critical writes allow them. */
export function challengeNavigationAction(
  state: NavigationState | undefined,
  challengeId: string,
  blocked = false,
) {
  if (
    blocked ||
    !state?.routeNames.includes("Workspace") ||
    !state.routeNames.includes("WorkspaceSheet")
  )
    return null;
  const action = openWorkspaceSheetAction("Pages", {
    screen: "Activity",
    params: { challengeId },
    initial: false,
    merge: true,
  });
  if (!state.routes.some((route) => route.name === "Workspace")) {
    const routes = [
      { name: "Workspace" },
      ...state.routes.filter(isWorkspaceChatRoute),
    ];
    return {
      ...CommonActions.reset({
        ...state,
        index: routes.length,
        routes: [
          ...routes,
          { name: "WorkspaceSheet", params: action.payload.params },
        ],
      }),
      target: state.key,
    };
  }
  return { ...action, target: state.key };
}

/** Cold management links always have a chat beneath the dismissible drawer. */
export function withWorkspaceFallback(
  state: PartialState<NavigationState> | undefined,
): PartialState<NavigationState> | undefined;
export function withWorkspaceFallback(
  state: NavigationState,
): NavigationState | PartialState<NavigationState>;
export function withWorkspaceFallback(
  state: NavigationState | PartialState<NavigationState> | undefined,
) {
  if (!state) return state;
  let changed = false;
  const routes = state.routes.map((route) => {
    if (route.name === "Workspace" && !route.state) {
      changed = true;
      return { ...route, state: { routes: [{ name: "Assistant" }] } };
    }
    if (route.name !== "WorkspaceSheet" || !route.state) return route;
    const sheet = route.state;
    const detail = sheet.routes[sheet.index ?? sheet.routes.length - 1];
    if (!detail || detail.name === "Pages") return route;
    const panel = detail.name.startsWith("Machine")
      ? "Machines"
      : detail.name.startsWith("Automation")
        ? "Automations"
        : detail.name === "AccountSecurity" || detail.name === "UsageCredits"
          ? "AccountSettings"
          : detail.name === "ActivityDetail"
            ? "Activity"
            : detail.name === "ServiceSetup"
              ? "Plugins"
              : "Agents";
    const sheetRoutes = sheet.routes.map((page) => {
      if (page.name !== "Pages" || page.state) return page;
      changed = true;
      return {
        ...page,
        state: {
          routes: [
            {
              name: panel,
              ...(detail.name === "GroupEditor"
                ? { params: { tab: "groups" } }
                : {}),
            },
          ],
        },
      };
    });
    return { ...route, state: { ...sheet, routes: sheetRoutes } };
  });
  if (
    !routes.some((route) => route.name === "Workspace") &&
    routes.some(
      (route) =>
        route.name === "WorkspaceSheet" || route.name === "MachineDesktop",
    )
  ) {
    return {
      ...state,
      stale: true as const,
      index: (state.index ?? routes.length - 1) + 1,
      routes: [
        { name: "Workspace", state: { routes: [{ name: "Assistant" }] } },
        ...routes,
      ],
    };
  }
  return changed ? { ...state, routes } : state;
}
