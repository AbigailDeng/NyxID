/** Existing query owners: AutomationsScreen, AgentsScreen/drawer,
 * PluginSkills, AssistantManagementScreen and WorkspaceChatList/Recents. */
export const managementRefreshKeys = [
  ["workspace", "automations"],
  ["workspace", "agents"],
  ["workspace", "plugins", "skills"],
  ["workspace", "assistant-management"],
  ["workspace", "drawer-chats"],
] as const;
