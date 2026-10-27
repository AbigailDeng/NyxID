import { WorkspaceInteractionSurface } from "../lib/accessibility/WorkspaceInteractionSurface";
import { workspaceFocus } from "../lib/accessibility/workspaceFocus";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { AuthHomeScreen } from "../features/auth/AuthHomeScreen";
import { DeviceLoginScreen } from "../features/auth/DeviceLoginScreen";
import { AgentKeyLoginScreen } from "../features/auth/AgentKeyLoginScreen";
import { useAuthSession } from "../features/auth/AuthSessionContext";
import {
  AccountSettingsScreen,
  AccountSettingsTitle,
} from "../features/account/AccountSettingsScreen";
import { AccountSecurityScreen } from "../features/account/AccountSecurityScreen";
import { MachinePolicyScreen } from "../features/machines/MachinePolicyScreen";
import { MachineActivityScreen } from "../features/machines/MachineActivityScreen";
import { AgentMachinesScreen } from "../features/machines/AgentMachinesScreen";
import { MachineDesktopRoute } from "../features/machines/MachineDesktopRoute";
import { MachinesScreen } from "../features/machines/MachinesScreen";
import { MachineDrawerHeader } from "../features/machines/MachinePresentation";
import { ActivityScreen } from "../features/activity/ActivityScreen";
import { ActivityDetailScreen } from "../features/activity/ActivityDetailScreen";
import { AssistantScreen } from "../features/assistant/AssistantScreen";
import { ServicesScreen } from "../features/services/ServicesScreen";
import { AgentsScreen } from "../features/agents/AgentsScreen";
import { AgentsGroupsScreen } from "../features/agents/AgentsGroupsScreen";
import { GroupChatScreen } from "../features/groups/GroupChatScreen";
import { GroupEditorScreen } from "../features/groups/GroupEditorScreen";
import {
  AutomationsScreen,
  AutomationDetailScreen,
  AutomationEditorScreen,
  AutomationRunsScreen,
  AutomationPreferencesScreen,
} from "../features/automations/AutomationsScreen";
import {
  PluginsScreen,
  AgentSkillsScreen,
} from "../features/plugins/PluginsScreen";
import { TermsOfServiceScreen } from "../features/legal/TermsOfServiceScreen";
import { PrivacyPolicyScreen } from "../features/legal/PrivacyPolicyScreen";
import { FullScreenLoading } from "../components/FullScreenLoading";
import { useReducedMotion } from "../lib/accessibility/useReducedMotion";
import {
  WorkspaceSheetSurface,
  type WorkspaceSheetHandle,
} from "../components/workspace/WorkspaceSheetSurface";
import { useTheme } from "../theme/ThemeContext";
import { darkSheetColors, lightSheetColors } from "../theme/mobileTheme";
import { fonts } from "../theme/designTokens";
import {
  WorkspaceSessionContext,
  WorkspaceMenuContext,
  WorkspaceSheetContext,
  useOpenWorkspaceChat,
  WorkspaceNavigationGuardContext,
  type WorkspaceNavigationGuardChange,
  workspaceHeaderOptions,
} from "./WorkspaceHeader";
import {
  workspaceRouterOptions,
  openWorkspaceSheetAction,
  dismissWorkspaceSheetAction,
  workspaceSharedEntryNavigationAction,
} from "./navigationHierarchy";
import {
  workspaceContextChatNavigationAction,
  workspaceChatNavigationAction,
} from "./workspaceChatNavigation";
import type {
  RootStackParamList,
  WorkspaceChatParamList,
  WorkspacePanelParamList,
  WorkspaceSheetParamList,
  WorkspaceScreenProps,
  AssistantParams,
} from "./navigationTypes";

export type {
  RootStackParamList,
  WorkspaceParamList,
  WorkspaceScreenProps,
  WorkspaceNavigationProp,
} from "./navigationTypes";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<WorkspacePanelParamList>();
const ChatTabs = createBottomTabNavigator<WorkspaceChatParamList>();
const SheetStack = createNativeStackNavigator<WorkspaceSheetParamList>();
const hideTabBar = () => null;

function AgentsRoute({ navigation, route }: WorkspaceScreenProps<"Agents">) {
  const sheet = useContext(WorkspaceSheetContext)!;
  const openChat = useOpenWorkspaceChat();
  return (
    <AgentsGroupsScreen
      tab={route.params?.tab === "groups" ? "groups" : "agents"}
      onTabChange={(tab) => navigation.setParams({ tab })}
      onOpenGroup={sheet.onOpenGroup}
      onCreateAgent={() => navigation.push("AgentCreate")}
      onCreateGroup={() => navigation.push("GroupEditor")}
      onOpenChat={openChat}
      onOpenSkills={(agentId) => navigation.push("AgentSkills", { agentId })}
      onOpenMachines={(agentId) =>
        navigation.push("AgentMachines", { agentId })
      }
      onOpenAutomations={(agentId) =>
        navigation.navigate({
          name: "Automations",
          params: { agentId, setup: undefined },
          merge: true,
        })
      }
    />
  );
}

function GroupChatRoute({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, "GroupChat">) {
  return (
    <WorkspaceInteractionSurface style={{ flex: 1 }}>
      <GroupChatScreen
        key={route.params.groupId}
        groupId={route.params.groupId}
        onBack={() => navigation.goBack()}
        onSettings={() =>
          navigation.dispatch(
            openWorkspaceSheetAction("GroupEditor", {
              groupId: route.params.groupId,
            }),
          )
        }
        onOpenConversation={(params) =>
          navigation.push("AssistantContext", params)
        }
        onOpenAgent={(agentId) =>
          navigation.dispatch(
            openWorkspaceSheetAction("AgentDetail", { agentId }),
          )
        }
      />
    </WorkspaceInteractionSurface>
  );
}

function GroupEditorRoute({
  navigation,
  route,
}: NativeStackScreenProps<WorkspaceSheetParamList, "GroupEditor">) {
  const sheet = useContext(WorkspaceSheetContext)!;
  return (
    <GroupEditorScreen
      key={route.params?.groupId ?? "new"}
      groupId={route.params?.groupId}
      onBack={() => navigation.goBack()}
      onSaved={(groupId) => {
        if (route.params?.groupId) navigation.goBack();
        else sheet.onOpenGroup(groupId);
      }}
      onRemoved={() =>
        navigation.popTo(
          "Pages",
          { screen: "Agents", params: { tab: "groups" } },
          { merge: true },
        )
      }
    />
  );
}

function AgentDetailRoute({
  navigation,
  route,
}: NativeStackScreenProps<WorkspaceSheetParamList, "AgentDetail">) {
  const openChat = useOpenWorkspaceChat();
  return (
    <AgentsScreen
      agentId={route.params.agentId}
      onClose={() => navigation.goBack()}
      onOpenChat={openChat}
      onOpenSkills={(agentId) => navigation.push("AgentSkills", { agentId })}
      onOpenMachines={(agentId) =>
        navigation.push("AgentMachines", { agentId })
      }
      onOpenAutomations={(agentId) =>
        navigation.popTo(
          "Pages",
          { screen: "Automations", params: { agentId, setup: undefined } },
          { merge: true },
        )
      }
    />
  );
}

function AgentCreateRoute({
  navigation,
}: NativeStackScreenProps<WorkspaceSheetParamList, "AgentCreate">) {
  return (
    <AgentsScreen
      initialCreate
      onClose={() => navigation.goBack()}
      onCreated={(agentId) => navigation.replace("AgentDetail", { agentId })}
    />
  );
}

function AssistantContextRoute({
  route,
}: NativeStackScreenProps<RootStackParamList, "AssistantContext">) {
  return (
    <WorkspaceInteractionSurface style={{ flex: 1 }}>
      <AssistantScreen contextual route={route} />
    </WorkspaceInteractionSurface>
  );
}

function PluginsRoute({ route }: WorkspaceScreenProps<"Plugins">) {
  return (
    <PluginsScreen
      initialTab={route.params?.tab}
      agentId={route.params?.agentId}
    />
  );
}

function ServiceSetupRoute({
  navigation,
  route,
}: NativeStackScreenProps<WorkspaceSheetParamList, "ServiceSetup">) {
  return (
    <ServicesScreen
      key={route.key}
      initialConnectionId={route.params.connectionId}
      initialCatalogSlug={route.params.catalogSlug}
      onClose={() => navigation.goBack()}
    />
  );
}

function AgentSkillsRoute({
  route,
}: NativeStackScreenProps<WorkspaceSheetParamList, "AgentSkills">) {
  return (
    <AgentSkillsScreen
      key={route.params.agentId}
      agentId={route.params.agentId}
    />
  );
}

/** The current conversation stays mounted below the workspace drawer. */
function WorkspaceNavigator() {
  const onOpenMenu = useContext(WorkspaceMenuContext);
  const { colors } = useTheme();
  const header = workspaceHeaderOptions({ role: "menu", onOpenMenu });
  return (
    <WorkspaceInteractionSurface style={{ flex: 1 }}>
      <ChatTabs.Navigator
        {...workspaceRouterOptions}
        tabBar={hideTabBar}
        screenOptions={{
          headerShown: true,
          headerLeft: () => header.headerLeft?.({ canGoBack: false }),
          headerLeftContainerStyle: { paddingLeft: 16 },
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontFamily: fonts.displaySemi, fontSize: 18 },
          headerTitleAlign: "center",
          headerShadowVisible: false,
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        <ChatTabs.Screen
          name="Assistant"
          component={AssistantScreen}
          options={{ title: "NyxID" }}
        />
      </ChatTabs.Navigator>
    </WorkspaceInteractionSurface>
  );
}

/** Sibling module state is retained while navigating within the same drawer. */
function WorkspacePages() {
  const onOpenMenu = useContext(WorkspaceMenuContext);
  const sheet = useContext(WorkspaceSheetContext)!;
  const { colors } = useTheme();
  const header = workspaceHeaderOptions({
    role: "menu",
    onOpenMenu,
    onClose: sheet.onClose,
  });
  return (
    <Tabs.Navigator
      initialRouteName="Agents"
      backBehavior="none"
      tabBar={hideTabBar}
      screenOptions={{
        headerShown: true,
        headerLeft: () => null,
        headerRight: () => header.headerRight?.({ canGoBack: false }),
        headerRightContainerStyle: { paddingRight: 12 },
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontFamily: fonts.displaySemi, fontSize: 18 },
        headerTitleAlign: "left",
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.bg },
        lazy: true,
      }}
    >
      <Tabs.Screen
        name="Automations"
        component={AutomationsScreen}
        options={{ title: "Automations" }}
      />
      <Tabs.Screen
        name="Agents"
        component={AgentsRoute}
        options={{ title: "Agents & Groups" }}
      />
      <Tabs.Screen
        name="Plugins"
        component={PluginsRoute}
        options={{ title: "Plugins" }}
      />
      <Tabs.Screen
        name="Services"
        component={ServicesScreen}
        options={{ title: "Services" }}
      />
      <Tabs.Screen
        name="Machines"
        component={MachinesScreen}
        options={{ title: "Machines" }}
      />
      <Tabs.Screen
        name="Activity"
        component={ActivityScreen}
        options={{ title: "Approvals" }}
      />
      <Tabs.Screen
        name="AccountSettings"
        component={AccountSettingsScreen}
        options={{
          title: "Settings",
          headerTitle: (props) => <AccountSettingsTitle {...props} />,
        }}
      />
    </Tabs.Navigator>
  );
}

function WorkspaceSheetRoute({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, "WorkspaceSheet">) {
  // The route renders outside SheetThemeProvider, so header colors read the drawer palette directly.
  const { mode } = useTheme();
  const colors = mode === "light" ? lightSheetColors : darkSheetColors;
  const onOpenMenu = useContext(WorkspaceMenuContext);
  const controller = useRef<WorkspaceSheetHandle | null>(null);
  const guards = useRef(new Map<symbol, () => Promise<boolean>>());
  const [dismissAuthorized, setDismissAuthorized] = useState(false);
  const reducedMotion = useReducedMotion();
  useEffect(() => () => workspaceFocus.releaseDrawer(route.key), [route.key]);
  const registerDismissGuard = useCallback(
    (id: symbol, guard: () => Promise<boolean>) => {
      guards.current.set(id, guard);
      return () => {
        guards.current.delete(id);
      };
    },
    [],
  );
  const canClose = useCallback(async () => {
    for (const guard of [...guards.current.values()])
      if (!(await guard())) return false;
    setDismissAuthorized(true);
    return true;
  }, []);
  const onClose = useCallback(() => {
    controller.current?.dismiss();
  }, []);
  const [finishRequested, setFinishRequested] = useState(false);
  const finishClose = useCallback(() => setFinishRequested(true), []);
  useEffect(() => {
    if (!dismissAuthorized || !finishRequested) return;
    const action = dismissWorkspaceSheetAction(navigation.getState());
    if (action) navigation.dispatch(action);
  }, [navigation, dismissAuthorized, finishRequested]);
  const onOpenChat = useCallback(
    (params?: AssistantParams) => {
      const action = workspaceContextChatNavigationAction(
        navigation.getState(),
        params ?? {},
      );
      if (action) navigation.dispatch(action);
    },
    [navigation],
  );
  const onOpenGroup = useCallback(
    (groupId: string) => {
      const action = workspaceChatNavigationAction(navigation.getState(), {
        kind: "group",
        groupId,
      });
      if (action) navigation.dispatch(action);
    },
    [navigation],
  );
  const canHandleHardwareBack = useCallback(() => {
    const sheet = navigation
      .getState()
      .routes.find((item) => item.key === route.key);
    return (sheet?.state?.routes.length ?? 1) <= 1;
  }, [navigation, route.key]);
  const context = useMemo(
    () => ({
      registerDismissGuard,
      dismissAuthorized,
      rootKey: navigation.getState().key,
      sheetKey: route.key,
      onClose,
      onOpenChat,
      onOpenGroup,
    }),
    [
      navigation,
      route.key,
      onClose,
      onOpenChat,
      onOpenGroup,
      registerDismissGuard,
      dismissAuthorized,
    ],
  );
  return (
    <WorkspaceSheetContext.Provider value={context}>
      <WorkspaceSheetSurface
        onClose={finishClose}
        canClose={canClose}
        controller={controller}
        canHandleHardwareBack={canHandleHardwareBack}
      >
        <SheetStack.Navigator
          initialRouteName="Pages"
          screenOptions={({ navigation }) => ({
            ...workspaceHeaderOptions({
              role: "back",
              onBack: navigation.goBack,
              onOpenMenu,
              onClose,
            }),
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.textPrimary,
            headerTitleStyle: { fontFamily: fonts.displaySemi, fontSize: 18 },
            animation: reducedMotion ? "none" : "default",
            headerTitleAlign: "left",
            headerShadowVisible: false,
            headerBackButtonDisplayMode: "minimal",
            contentStyle: { backgroundColor: colors.bg },
          })}
        >
          <SheetStack.Screen
            name="Pages"
            component={WorkspacePages}
            options={{ headerShown: false }}
          />
          <SheetStack.Screen
            name="AgentCreate"
            component={AgentCreateRoute}
            options={{ title: "New agent" }}
          />
          <SheetStack.Screen
            name="AgentDetail"
            component={AgentDetailRoute}
            options={{ title: "Agent" }}
          />
          <SheetStack.Screen
            name="GroupEditor"
            component={GroupEditorRoute}
            options={({ route }) => ({
              title: route.params?.groupId ? "Group settings" : "Create group",
            })}
          />
          <SheetStack.Screen
            name="ServiceSetup"
            component={ServiceSetupRoute}
            options={({ route }) => ({
              title: route.params.catalogSlug
                ? "Connect service"
                : "Manage connection",
            })}
          />
          <SheetStack.Screen
            name="MachinePolicy"
            component={MachinePolicyScreen}
            options={{
              title: "Owner policy and updates",
              header: MachineDrawerHeader,
            }}
          />
          <SheetStack.Screen
            name="MachineActivity"
            component={MachineActivityScreen}
            options={{
              title: "Machine activity",
              header: MachineDrawerHeader,
            }}
          />
          <SheetStack.Screen
            name="AgentMachines"
            component={AgentMachinesScreen}
            options={{
              title: "Agent machine access",
              header: MachineDrawerHeader,
            }}
          />
          <SheetStack.Screen
            name="AgentSkills"
            component={AgentSkillsRoute}
            options={{ title: "Agent skills" }}
          />
          <SheetStack.Screen
            name="AutomationDetail"
            component={AutomationDetailScreen}
            options={{ title: "Automation" }}
          />
          <SheetStack.Screen
            name="AutomationEditor"
            component={AutomationEditorScreen}
            options={({ route }) => ({
              title: route.params?.id ? "Edit automation" : "Create automation",
            })}
          />
          <SheetStack.Screen
            name="AutomationRuns"
            component={AutomationRunsScreen}
            options={{ title: "Run history" }}
          />
          <SheetStack.Screen
            name="AutomationPreferences"
            component={AutomationPreferencesScreen}
            options={{ title: "Automation preferences" }}
          />
          <SheetStack.Screen
            name="ActivityDetail"
            component={ActivityDetailScreen}
            options={{ title: "Approval detail" }}
          />
          <SheetStack.Screen
            name="AccountSecurity"
            component={AccountSecurityScreen}
            options={{ title: "Account & security" }}
          />
          <SheetStack.Screen
            name="TermsOfService"
            component={TermsOfServiceScreen}
            options={{ title: "Terms of Service" }}
          />
          <SheetStack.Screen
            name="PrivacyPolicy"
            component={PrivacyPolicyScreen}
            options={{ title: "Privacy Policy" }}
          />
          <SheetStack.Screen
            name="DeviceLogin"
            component={DeviceLoginScreen}
            options={{ title: "Scan QR code" }}
          />
          <SheetStack.Screen
            name="AgentKeyLogin"
            component={AgentKeyLoginScreen}
            options={{ title: "Agent Key login" }}
          />
        </SheetStack.Navigator>
      </WorkspaceSheetSurface>
    </WorkspaceSheetContext.Provider>
  );
}

/** Canonical auth/legal URLs share the drawer after sign-in. */
function SheetEntryRoute({
  navigation,
  route,
}: NativeStackScreenProps<
  RootStackParamList,
  "DeviceLogin" | "AgentKeyLogin" | "TermsOfService" | "PrivacyPolicy"
>) {
  useLayoutEffect(() => {
    const action = workspaceSharedEntryNavigationAction(
      navigation.getState(),
      route.name,
      route.params,
    );
    if (action) navigation.dispatch(action);
  }, [navigation, route.name, route.params]);
  return null;
}

export function AppNavigator({
  onOpenMenu,
  onNavigationGuardChange,
}: {
  onOpenMenu: () => void;
  onNavigationGuardChange: WorkspaceNavigationGuardChange;
}) {
  const { isAuthenticated, isRestoring } = useAuthSession();
  const reducedMotion = useReducedMotion();
  const { colors } = useTheme();
  if (isRestoring)
    return (
      <FullScreenLoading
        title="Restoring session..."
        subtitle="Validating local secure session"
      />
    );
  return (
    <WorkspaceSessionContext.Provider value={isAuthenticated}>
      <WorkspaceMenuContext.Provider value={onOpenMenu}>
        <WorkspaceNavigationGuardContext.Provider
          value={onNavigationGuardChange}
        >
          <Stack.Navigator
            initialRouteName={isAuthenticated ? "Workspace" : "Auth"}
            screenOptions={{
              headerShown: false,
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.textPrimary,
              headerTitleStyle: { fontFamily: fonts.displaySemi, fontSize: 18 },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg },
              headerBackButtonDisplayMode: "minimal",
            }}
          >
            {isAuthenticated ? (
              <Stack.Group navigationKey="workspace">
                <Stack.Screen name="Workspace" component={WorkspaceNavigator} />
                <Stack.Screen
                  name="AssistantContext"
                  component={AssistantContextRoute}
                  options={({ navigation }) => ({
                    ...workspaceHeaderOptions({
                      role: "back",
                      onOpenMenu,
                      onBack: navigation.goBack,
                    }),
                    title: "NyxID",
                  })}
                />
                <Stack.Screen
                  name="GroupChat"
                  component={GroupChatRoute}
                  options={({ navigation }) => ({
                    ...workspaceHeaderOptions({
                      role: "back",
                      onOpenMenu,
                      onBack: navigation.goBack,
                    }),
                    title: "Group",
                  })}
                />
                <Stack.Screen
                  name="WorkspaceSheet"
                  component={WorkspaceSheetRoute}
                  options={{
                    presentation: "transparentModal",
                    // The surface animates its panel and stationary scrim independently.
                    animation: "none",
                    gestureEnabled: false,
                    headerShown: false,
                    contentStyle: { backgroundColor: "transparent" },
                  }}
                />
                <Stack.Screen
                  name="MachineDesktop"
                  component={MachineDesktopRoute}
                  options={{
                    presentation: "fullScreenModal",
                    animation: reducedMotion ? "none" : "fade",
                    headerShown: false,
                    gestureEnabled: false,
                  }}
                />
              </Stack.Group>
            ) : (
              <Stack.Screen
                name="Auth"
                navigationKey="auth"
                component={AuthHomeScreen}
                options={{ title: "NyxID Sign In" }}
              />
            )}
            <Stack.Group
              navigationKey={isAuthenticated ? "signed-in" : "signed-out"}
            >
              <Stack.Screen
                name="TermsOfService"
                component={
                  isAuthenticated ? SheetEntryRoute : TermsOfServiceScreen
                }
                options={{ title: "Terms of Service" }}
              />
              <Stack.Screen
                name="PrivacyPolicy"
                component={
                  isAuthenticated ? SheetEntryRoute : PrivacyPolicyScreen
                }
                options={{ title: "Privacy Policy" }}
              />
              <Stack.Screen
                name="DeviceLogin"
                component={
                  isAuthenticated ? SheetEntryRoute : DeviceLoginScreen
                }
                options={{ title: "Approve Device Login" }}
              />
              <Stack.Screen
                name="AgentKeyLogin"
                component={
                  isAuthenticated ? SheetEntryRoute : AgentKeyLoginScreen
                }
                options={{ title: "Agent Key Login" }}
              />
            </Stack.Group>
          </Stack.Navigator>
        </WorkspaceNavigationGuardContext.Provider>
      </WorkspaceMenuContext.Provider>
    </WorkspaceSessionContext.Provider>
  );
}
