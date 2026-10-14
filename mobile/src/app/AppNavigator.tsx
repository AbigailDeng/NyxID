import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { Pressable, StyleSheet } from "react-native";
import { Menu } from "lucide-react-native";
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
import { TermsOfServiceScreen } from "../features/legal/TermsOfServiceScreen";
import { PrivacyPolicyScreen } from "../features/legal/PrivacyPolicyScreen";
import { FullScreenLoading } from "../components/FullScreenLoading";
import { useTheme } from "../theme/ThemeContext";
import { fonts } from "../theme/designTokens";

export type RootStackParamList = {
  Auth: undefined;
  Assistant: { conversationId?: string; agentId?: string } | undefined;
  Services: undefined;
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
    />
  );
}

export function AppNavigator({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { isAuthenticated, isRestoring } = useAuthSession();
  const { colors } = useTheme();
  const menuButton = () => (
    <Pressable
      onPress={onOpenMenu}
      accessibilityRole="button"
      accessibilityLabel="Open navigation"
      style={styles.menu}
    >
      <Menu color={colors.textPrimary} size={22} />
    </Pressable>
  );
  const drawerHeader = {
    headerShown: true,
    headerLeft: menuButton,
    unstable_headerLeftItems: () => [
      {
        type: "custom" as const,
        element: menuButton(),
        hidesSharedBackground: true,
      },
    ],
  };
  if (isRestoring)
    return (
      <FullScreenLoading
        title="Restoring session..."
        subtitle="Validating local secure session"
      />
    );
  return (
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
            options={{ ...drawerHeader, title: "NyxID" }}
          />
          <Stack.Screen
            name="Services"
            component={ServicesScreen}
            options={{ ...drawerHeader, title: "Services" }}
          />
          <Stack.Screen
            name="Agents"
            component={AgentsRoute}
            options={{ ...drawerHeader, title: "Agents" }}
          />
          <Stack.Screen
            name="Activity"
            component={ActivityScreen}
            options={{ ...drawerHeader, title: "Approvals" }}
          />
          <Stack.Screen
            name="ActivityDetail"
            component={ActivityDetailScreen}
            options={{ title: "Approval detail", animation: "none" }}
          />
          <Stack.Screen
            name="AccountSettings"
            component={AccountSettingsScreen}
            options={{ ...drawerHeader, title: "Settings" }}
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
      <Stack.Group navigationKey={isAuthenticated ? "signed-in" : "signed-out"}>
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
  );
}

const styles = StyleSheet.create({
  menu: { minWidth: 44, height: 44, marginLeft: -8, justifyContent: "center" },
});
