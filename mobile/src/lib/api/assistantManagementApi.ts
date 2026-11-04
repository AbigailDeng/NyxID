import { requestJson } from "./http";
import { createAssistantManagementApi } from "./assistantManagementTransport";

export const assistantManagementApi = createAssistantManagementApi(requestJson);
