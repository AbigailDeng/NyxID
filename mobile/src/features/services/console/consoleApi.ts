import { requestJson } from "../../../lib/api/http";
import { createConsoleApi } from "./consoleTransport";

export const consoleApi = createConsoleApi(requestJson);
