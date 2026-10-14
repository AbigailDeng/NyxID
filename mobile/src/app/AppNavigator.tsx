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
  workspaceHeaderOptions,
} from "./WorkspaceHeader";

export type RootStackParamList = {
  Auth: undefined;
  Assistant:
    | {
        conversationId?: string;
        acknowledgementId?: string;
        agentId?: string;
        draft?: boolean;
        openLatest?: boolean;
      }
    | undefined;
  Services: undefined;
  Plugins: { tab?: "connectors" | "skills"; agentId?: string } | undefined;
  ServiceSetup: { connectionId?: string; catalogSlug?: string };
  AgentSkills: { agentId: string };
  Agents: { agentId?: string } | undefined;
  Activity: { challengeId?: string } | undefined;
  ActivityDetail: { challengeId: string };
  AccountSettings: undefined;
  AccountSecurity: undefined;
  TermsOfService: undefined;
  PrivacyPolicy: undefined;
  DeviceLogin: { user_code?: string; start_scanner?: boolean } | undefined;
  AgentKeyLogin:
    | { user_code?: string; flow?: "agent-key" | "device"; mint?: boolean }
    | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function AgentsRoute({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, "Agents">) {
  return (
    <AgentsScreen
      agentId={route.params?.agentId}
      onOpenChat={(params) => navigation.navigate("Assistant", params)}
      onOpenSkills={(agentId) => navigation.push("AgentSkills", { agentId })}
    />
  );
}

function PluginsRoute({
  route,
}: NativeStackScreenProps<RootStackParamList, "Plugins">) {
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

export function AppNavigator({ onOpenMenu }: { onOpenMenu: () => void }) {
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
      <Stack.Navigator
        initialRouteName={isAuthenticated ? "Assistant" : "Auth"}
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
            <Stack.Screen
              name="Assistant"
              component={AssistantScreen}
              options={({ navigation }) => ({
                ...workspaceHeaderOptions({
                  onOpenMenu,
                  onBack: navigation.goBack,
                }),
                title: "NyxID",
              })}
            />
            <Stack.Screen
              name="Plugins"
              component={PluginsRoute}
              options={({ navigation }) => ({
                ...workspaceHeaderOptions({
                  onOpenMenu,
                  onBack: navigation.goBack,
                }),
                title: "Plugins",
                headerTitleStyle: { fontFamily: fonts.bodySemi, fontSize: 19 },
              })}
            />
            <Stack.Screen
              name="ServiceSetup"
              component={ServiceSetupRoute}
              options={({ navigation, route }) => ({
                ...workspaceHeaderOptions({
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
                  onOpenMenu,
                  onBack: navigation.goBack,
                }),
                title: "Agent skills",
              })}
            />
            <Stack.Screen
              name="Services"
              component={ServicesScreen}
              options={({ navigation }) => ({
                ...workspaceHeaderOptions({
                  onOpenMenu,
                  onBack: navigation.goBack,
                }),
                title: "Services",
              })}
            />
            <Stack.Screen
              name="Agents"
              component={AgentsRoute}
              options={({ navigation }) => ({
                ...workspaceHeaderOptions({
                  onOpenMenu,
                  onBack: navigation.goBack,
                }),
                title: "Agents",
              })}
            />
            <Stack.Screen
              name="Activity"
              component={ActivityScreen}
              options={({ navigation }) => ({
                ...workspaceHeaderOptions({
                  onOpenMenu,
                  onBack: navigation.goBack,
                }),
                title: "Approvals",
              })}
            />
            <Stack.Screen
              name="ActivityDetail"
              component={ActivityDetailScreen}
              options={{ title: "Approval detail", animation: "none" }}
            />
            <Stack.Screen
              name="AccountSettings"
              component={AccountSettingsScreen}
              options={({ navigation }) => ({
                ...workspaceHeaderOptions({
                  onOpenMenu,
                  onBack: navigation.goBack,
                }),
                title: "Settings",
              })}
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
    </WorkspaceMenuContext.Provider>
  );
}
