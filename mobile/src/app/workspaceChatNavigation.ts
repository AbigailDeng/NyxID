import {
  CommonActions,
  type NavigationState,
  type PartialState,
} from "@react-navigation/routers";
import type { AssistantParams } from "./navigationTypes";
import { isWorkspaceChatRoute } from "./navigationHierarchy";

export type WorkspaceChatTarget =
  | { kind: "agent"; agentId?: string; conversationId?: string }
  | { kind: "group"; groupId: string };

type NavigationRoute = NavigationState["routes"][number];

/** Retain the mounted chat tab/key while selecting an explicit drawer target. */
function selectWorkspaceChat(
  workspace: NavigationRoute,
  params: AssistantParams,
): NavigationRoute {
  const previous = workspace.state;
  const index =
    previous?.routes.findIndex((route) => route.name === "Assistant") ?? -1;
  let nested: NavigationState | PartialState<NavigationState>;
  if (previous?.stale === false && index >= 0) {
    const selected = previous.routes[index]!;
    nested = {
      ...previous,
      index,
      routes: previous.routes.map((route, position) =>
        position === index ? { ...route, params } : route,
      ),
      ...(previous.type === "tab"
        ? { history: [{ type: "route", key: selected.key }] }
        : {}),
    };
  } else {
    nested = {
      stale: true,
      index: 0,
      routes: [{ name: "Assistant", params }],
    };
  }
  return { ...workspace, params: undefined, state: nested };
}

/** Drawer chat selection dismisses management without leaving it under chat. */
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
        routes: [selectWorkspaceChat(workspace, params)],
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
        workspace,
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

/** Open from a management flow without replacing the calling chat or its draft. */
export function workspaceContextChatNavigationAction(
  state: NavigationState | undefined,
  params: AssistantParams,
) {
  if (
    !state?.routes.some((route) => route.name === "Workspace") ||
    !state.routeNames.includes("AssistantContext")
  )
    return null;
  const chats = state.routes
    .slice(0, state.index + 1)
    .filter(isWorkspaceChatRoute);
  const existing =
    !params.draft && params.conversationId
      ? chats.findIndex((route) => {
          const previous = route.params as AssistantParams | undefined;
          return (
            route.name === "AssistantContext" &&
            previous?.conversationId === params.conversationId &&
            previous.agentId === params.agentId
          );
        })
      : -1;
  const routes =
    existing >= 0
      ? chats
          .slice(0, existing + 1)
          .map((route, index) =>
            index === existing ? { ...route, params } : route,
          )
      : [...chats, { name: "AssistantContext", params }];
  return {
    ...CommonActions.reset({ ...state, index: routes.length - 1, routes }),
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
