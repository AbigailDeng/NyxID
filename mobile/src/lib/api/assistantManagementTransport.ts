import type { RequestOptions } from "./authenticatedTransport";
import {
  assistantSettingsSchema,
  managedChannelsSchema,
  type SettingsPatch,
} from "../../features/assistant-management/managementContracts";

export function createAssistantManagementApi(
  request: (path: string, options?: RequestOptions) => Promise<unknown>,
) {
  const path = "/assistant/nyxagent/settings";
  return {
    async settings(signal?: AbortSignal) {
      return assistantSettingsSchema.parse(await request(path, { signal }));
    },
    async update(body: SettingsPatch, authorityGuard: () => void) {
      authorityGuard();
      return assistantSettingsSchema.parse(
        await request(path, {
          method: "PUT",
          body,
          authorityGuard,
          retryOnAuthFailure: false,
        }),
      );
    },
    async channels(signal?: AbortSignal) {
      return managedChannelsSchema.parse(
        await request("/assistant/nyxagent/channels", { signal }),
      ).channel_agents;
    },
  };
}
