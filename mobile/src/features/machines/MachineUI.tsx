import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import * as WebBrowser from "expo-web-browser";
import { z } from "zod";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import { getAuthEpoch } from "../../lib/auth/authEpoch";
import { ApiError } from "../../lib/api/ApiError";
import { NYXID_FRONTEND_URL } from "../../lib/env";

export const machineKeys = (epoch: number) => ["workspace", "machines", epoch] as const;
export function machineError(cause: unknown) {
  if (cause instanceof ApiError) return `${cause.message} (code ${cause.errorCode}${cause.reason ? `, ${cause.reason}` : ""})`;
  if (cause instanceof z.ZodError) return "The server returned unsupported machine data. Refresh or open Machines on the web.";
  return cause instanceof Error ? cause.message : "Could not complete this machine action.";
}
export async function openMachineWeb(path: string) {
  await WebBrowser.openBrowserAsync(`${NYXID_FRONTEND_URL.replace(/\/$/, "")}${path}`);
}

export function useMachineRuntime() {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const { isConnected } = useNetworkStatus();
  const epoch = getAuthEpoch();
  const state = useRef({ mounted: true, focused, isConnected });
  state.current.focused = focused;
  state.current.isConnected = isConnected;
  useEffect(() => {
    state.current.mounted = true;
    const subscription = AppState.addEventListener("change", (value) => setForeground(value === "active"));
    return () => { state.current.mounted = false; subscription.remove(); };
  }, []);
  return {
    epoch, active: focused && foreground && isConnected, online: isConnected,
    current: () => state.current.mounted && getAuthEpoch() === epoch,
    interactive: () => state.current.mounted && getAuthEpoch() === epoch && state.current.focused && AppState.currentState === "active" && state.current.isConnected,
  };
}
