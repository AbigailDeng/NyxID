import { requestJson } from "./http";
import { createBillingManagementApi } from "../../features/billing/billingManagementTransport";

export const billingManagementApi = createBillingManagementApi(requestJson);
