import {
  CommonActions,
  type NavigationState,
  type PartialState,
} from "@react-navigation/routers";
import type { AssistantParams } from "./navigationTypes";

export type WorkspaceChatTarget =
  | { kind: "agent"; agentId?: string; conversationId?: string }
  | { kind: "group"; groupId: string };

type NavigationRoute = NavigationState["routes"][number];

/** Select one workspace screen while retaining the other tabs and their keys. */
function selectWorkspaceScreen(
  workspace: NavigationRoute,
  name: "Assistant" | "Agents",
  params: object,
): NavigationRoute {
  const previous = workspace.state;
  const index =
    previous?.routes.findIndex((route) => route.name === name) ?? -1;
  let nested: NavigationState | PartialState<NavigationState>;
  if (previous?.stale === false && index >= 0) {
    const selected = previous.routes[index]!;
    nested = {
      ...previous,
      index,
      routes: previous.routes.map((route, position) =>
        position === index ? { ...route, params } : route,
      ),
      // Workspace tabs use backBehavior="none": old tab history must not
      // revive the chat the user just left after a native Back action.
      ...(previous.type === "tab"
        ? { history: [{ type: "route", key: selected.key }] }
        : {}),
    };
  } else {
    const routes = previous?.routes ?? [];
    nested = {
      ...previous,
      stale: true,
      index: index >= 0 ? index : routes.length,
      routes:
        index >= 0
          ? routes.map((route, position) =>
              position === index ? { ...route, params } : route,
            )
          : [...routes, { name, params }],
    };
  }
  // Nested screen/params from an earlier navigate action must not override
  // the explicitly selected child state when the navigator handles this reset.
  return { ...workspace, params: undefined, state: nested };
}

/** Drawer selection replaces detail history, preserving the workspace instance. */
export function workspaceChatNavigationAction(
  state: NavigationState | undefined,
  target: WorkspaceChatTarget,
) {
  const workspace = state?.routes.find((route) => route.name === "Workspace");
  if (!state || !workspace) return null;

  if (target.kind === "agent") {
    const params: AssistantParams = {
      agentId: target.agentId,
      conversationId: target.conversationId,
      acknowledgementId: undefined,
      draft: !target.conversationId,
      openLatest: false,
    };
    return {
      ...CommonActions.reset({
        ...state,
        index: 0,
        routes: [selectWorkspaceScreen(workspace, "Assistant", params)],
      }),
      target: state.key,
    };
  }

  if (!state.routeNames.includes("GroupChat")) return null;
  const previousGroup = [...state.routes]
    .reverse()
    .find(
      (route) =>
        route.name === "GroupChat" &&
        (route.params as { groupId?: unknown } | undefined)?.groupId ===
          target.groupId,
    );
  return {
    ...CommonActions.reset({
      ...state,
      index: 1,
      routes: [
        selectWorkspaceScreen(workspace, "Agents", { tab: "groups" }),
        {
          ...previousGroup,
          name: "GroupChat",
          params: { groupId: target.groupId },
        },
      ],
    }),
    target: state.key,
  };
}

/** Map the deepest active route to the matching drawer chat selection. */
export function activeWorkspaceChatTarget(
  route: { name: string; params?: object } | undefined,
): WorkspaceChatTarget | undefined {
  if (!route) return undefined;
  const params = route.params as Record<string, unknown> | undefined;
  const stringParam = (name: string) => {
    const value = params?.[name];
    return typeof value === "string" && value.length ? value : undefined;
  };
  if (route.name === "Assistant" || route.name === "AssistantContext") {
    return {
      kind: "agent",
      agentId: stringParam("agentId"),
      conversationId: stringParam("conversationId"),
    };
  }
  const groupId = stringParam("groupId");
  if (route.name === "GroupChat" && groupId) return { kind: "group", groupId };
  return undefined;
}
