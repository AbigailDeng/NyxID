import type {
  CompositeNavigationProp,
  CompositeScreenProps,
  NavigatorScreenParams,
} from "@react-navigation/native";
import type {
  BottomTabNavigationProp,
  BottomTabScreenProps,
} from "@react-navigation/bottom-tabs";
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";

export type AssistantParams = {
  conversationId?: string;
  acknowledgementId?: string;
  agentId?: string;
  draft?: boolean;
  openLatest?: boolean;
};

/** Convenience union for existing workspace consumers; only Assistant is a chat. */
export type WorkspaceParamList = {
  Assistant: AssistantParams | undefined;
  Automations: { agentId?: string; setup?: string } | undefined;
  Machines: { machine?: string; tab?: "logins" } | undefined;
  Services: undefined;
  Plugins: { tab?: "connectors" | "skills"; agentId?: string } | undefined;
  Agents: { tab?: "agents" | "groups" } | undefined;
  Activity: { challengeId?: string } | undefined;
  AccountSettings: undefined;
};

export type WorkspaceChatParamList = Pick<WorkspaceParamList, "Assistant">;
export type WorkspacePanelParamList = Omit<WorkspaceParamList, "Assistant">;

type SharedEntryParamList = {
  TermsOfService: undefined;
  PrivacyPolicy: undefined;
  DeviceLogin: { user_code?: string; start_scanner?: boolean } | undefined;
  AgentKeyLogin:
    | { user_code?: string; flow?: "agent-key" | "device"; mint?: boolean }
    | undefined;
};

/** All management flows live inside one dismissible drawer above the chat. */
export type WorkspaceSheetParamList = SharedEntryParamList & {
  Pages: NavigatorScreenParams<WorkspacePanelParamList>;
  AgentCreate: undefined;
  AgentDetail: { agentId: string };
  GroupEditor: { groupId?: string } | undefined;
  ServiceSetup: { connectionId?: string; catalogSlug?: string };
  AgentSkills: { agentId: string };
  MachinePolicy: { machineId: string; ownerId: string };
  MachineActivity: { machineId: string; ownerId: string };
  AutomationDetail: { id: string };
  AutomationEditor:
    | { id?: string; agentId?: string; setup?: string }
    | undefined;
  AutomationRuns: { id: string };
  AutomationPreferences: undefined;
  ActivityDetail: { challengeId: string };
  AccountSecurity: undefined;
};

export type RootStackParamList = SharedEntryParamList & {
  Auth: undefined;
  Workspace: NavigatorScreenParams<WorkspaceChatParamList> | undefined;
  AssistantContext: AssistantParams | undefined;
  GroupChat: { groupId: string };
  WorkspaceSheet: NavigatorScreenParams<WorkspaceSheetParamList> | undefined;
};

export type SheetScreenProps<Name extends keyof WorkspaceSheetParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<WorkspaceSheetParamList, Name>,
    NativeStackScreenProps<RootStackParamList>
  >;

export type SheetNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<WorkspaceSheetParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

export type WorkspaceScreenProps<Name extends keyof WorkspaceParamList> =
  Name extends keyof WorkspacePanelParamList
    ? CompositeScreenProps<
        BottomTabScreenProps<WorkspacePanelParamList, Name>,
        SheetScreenProps<"Pages">
      >
    : CompositeScreenProps<
        BottomTabScreenProps<
          WorkspaceChatParamList,
          Extract<Name, "Assistant">
        >,
        NativeStackScreenProps<RootStackParamList>
      >;

/** Screens shared between chat and drawer may target either parent navigator. */
export type WorkspaceNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<WorkspaceParamList>,
  SheetNavigationProp
>;
