import { useContext } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { AuthHomeScreen } from "../features/auth/AuthHomeScreen";
import { DeviceLoginScreen } from "../features/auth/DeviceLoginScreen";
import { AgentKeyLoginScreen } from "../features/auth/AgentKeyLoginScreen";
import { useAuthSession } from "../features/auth/AuthSessionContext";
import { AccountSettingsScreen } from "../features/account/AccountSettingsScreen";
import { AccountSecurityScreen } from "../features/account/AccountSecurityScreen";
import { ActivityScreen } from "../features/activity/ActivityScreen";
import { ActivityDetailScreen } from "../features/activity/ActivityDetailScreen";
import { AssistantScreen } from "../features/assistant/AssistantScreen";
import { ServicesScreen } from "../features/services/ServicesScreen";
import { AgentsScreen } from "../features/agents/AgentsScreen";
import {
  PluginsScreen,
  AgentSkillsScreen,
} from "../features/plugins/PluginsScreen";
import { TermsOfServiceScreen } from "../features/legal/TermsOfServiceScreen";
import { PrivacyPolicyScreen } from "../features/legal/PrivacyPolicyScreen";
import { FullScreenLoading } from "../components/FullScreenLoading";
import { useTheme } from "../theme/ThemeContext";
import { fonts } from "../theme/designTokens";
import {
  WorkspaceMenuContext,
  WorkspaceNavigationGuardContext,
  type WorkspaceNavigationGuardChange,
  workspaceHeaderOptions,
} from "./WorkspaceHeader";
import { workspaceRouterOptions } from "./navigationHierarchy";
import type {
  RootStackParamList,
  WorkspaceParamList,
  WorkspaceScreenProps,
} from "./navigationTypes";

export type {
  RootStackParamList,
  WorkspaceParamList,
  WorkspaceScreenProps,
  WorkspaceNavigationProp,
} from "./navigationTypes";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<WorkspaceParamList>();
const hideTabBar = () => null;

function AgentsRoute({ navigation }: WorkspaceScreenProps<"Agents">) {
  return (
    <AgentsScreen
      onOpenChat={(params) => navigation.push("AssistantContext", params)}
      onOpenSkills={(agentId) => navigation.push("AgentSkills", { agentId })}
    />
  );
}

function AgentDetailRoute({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, "AgentDetail">) {
  return (
    <AgentsScreen
      agentId={route.params.agentId}
      onClose={() => navigation.goBack()}
      onOpenChat={(params) => navigation.push("AssistantContext", params)}
      onOpenSkills={(agentId) => navigation.push("AgentSkills", { agentId })}
    />
  );
}

function AssistantContextRoute({
  route,
}: NativeStackScreenProps<RootStackParamList, "AssistantContext">) {
  return <AssistantScreen contextual route={route} />;
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
}: NativeStackScreenProps<RootStackParamList, "ServiceSetup">) {
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
}: NativeStackScreenProps<RootStackParamList, "AgentSkills">) {
  return (
    <AgentSkillsScreen
      key={route.params.agentId}
      agentId={route.params.agentId}
    />
  );
}

/** The drawer selects siblings; the outer native stack owns detail history. */
function WorkspaceNavigator() {
  const onOpenMenu = useContext(WorkspaceMenuContext);
  const { colors } = useTheme();
  const header = workspaceHeaderOptions({ role: "menu", onOpenMenu });
  return (
    <Tabs.Navigator
      {...workspaceRouterOptions}
      tabBar={hideTabBar}
      screenOptions={{
        headerShown: true,
        headerLeft: () => header.headerLeft?.({ canGoBack: false }),
        headerLeftContainerStyle: { paddingLeft: 16 },
        headerRight: () => null,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontFamily: fonts.displaySemi, fontSize: 18 },
        headerTitleAlign: "center",
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.bg },
        // Mounted screens retain drafts, filters and scroll position on selection.
        lazy: true,
      }}
    >
      <Tabs.Screen
        name="Assistant"
        component={AssistantScreen}
        options={{ title: "NyxID" }}
      />
      <Tabs.Screen
        name="Agents"
        component={AgentsRoute}
        options={{ title: "Agents" }}
      />
      <Tabs.Screen
        name="Plugins"
        component={PluginsRoute}
        options={{
          title: "Plugins",
          headerTitleStyle: { fontFamily: fonts.bodySemi, fontSize: 19 },
        }}
      />
      <Tabs.Screen
        name="Services"
        component={ServicesScreen}
        options={{ title: "Services" }}
      />
      <Tabs.Screen
        name="Activity"
        component={ActivityScreen}
        options={{ title: "Approvals" }}
      />
      <Tabs.Screen
        name="AccountSettings"
        component={AccountSettingsScreen}
        options={{ title: "Settings" }}
      />
    </Tabs.Navigator>
  );
}

export function AppNavigator({
  onOpenMenu,
  onNavigationGuardChange,
}: {
  onOpenMenu: () => void;
  onNavigationGuardChange: WorkspaceNavigationGuardChange;
}) {
  const { isAuthenticated, isRestoring } = useAuthSession();
  const { colors } = useTheme();
  if (isRestoring)
    return (
      <FullScreenLoading
        title="Restoring session..."
        subtitle="Validating local secure session"
      />
    );
  return (
    <WorkspaceMenuContext.Provider value={onOpenMenu}>
      <WorkspaceNavigationGuardContext.Provider value={onNavigationGuardChange}>
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
                name="AgentDetail"
                component={AgentDetailRoute}
                options={({ navigation }) => ({
                  ...workspaceHeaderOptions({
                    role: "back",
                    onOpenMenu,
                    onBack: navigation.goBack,
                  }),
                  title: "Agent",
                })}
              />
              <Stack.Screen
                name="ServiceSetup"
                component={ServiceSetupRoute}
                options={({ navigation, route }) => ({
                  ...workspaceHeaderOptions({
                    role: "back",
                    onOpenMenu,
                    onBack: navigation.goBack,
                  }),
                  title: route.params.catalogSlug
                    ? "Connect service"
                    : "Manage connection",
                })}
              />
              <Stack.Screen
                name="AgentSkills"
                component={AgentSkillsRoute}
                options={({ navigation }) => ({
                  ...workspaceHeaderOptions({
                    role: "back",
                    onOpenMenu,
                    onBack: navigation.goBack,
                  }),
                  title: "Agent skills",
                })}
              />
              <Stack.Screen
                name="ActivityDetail"
                component={ActivityDetailScreen}
                options={{ title: "Approval detail", animation: "none" }}
              />
              <Stack.Screen
                name="AccountSecurity"
                component={AccountSecurityScreen}
                options={{ headerShown: true, title: "Account & security" }}
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
              component={TermsOfServiceScreen}
              options={{ title: "Terms of Service" }}
            />
            <Stack.Screen
              name="PrivacyPolicy"
              component={PrivacyPolicyScreen}
              options={{ title: "Privacy Policy" }}
            />
            <Stack.Screen
              name="DeviceLogin"
              component={DeviceLoginScreen}
              options={{ title: "Approve Device Login" }}
            />
            <Stack.Screen
              name="AgentKeyLogin"
              component={AgentKeyLoginScreen}
              options={{ title: "Agent Key Login" }}
            />
          </Stack.Group>
        </Stack.Navigator>
      </WorkspaceNavigationGuardContext.Provider>
    </WorkspaceMenuContext.Provider>
  );
}
