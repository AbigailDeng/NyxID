import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import {
  ActionButton,
  Label,
  Notice,
} from "../../components/workspace/WorkspaceUI";
import { NYXID_FRONTEND_URL } from "../../lib/env";
import { getAuthEpoch } from "../../lib/auth/authEpoch";
import { managementUrl, type ManagementTarget } from "./managementContracts";
import { managementRefreshKeys } from "./managementRefresh";

/** Both browser dismissal (iOS) and app foreground (Android) re-read true state. */
export function ManagementHandoff({
  label,
  target,
  disabled = false,
}: {
  label: string;
  target: ManagementTarget;
  disabled?: boolean;
}) {
  const client = useQueryClient();
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const opened = useRef<number | null>(null);
  const opening = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [returned, setReturned] = useState(false);
  const refresh = useCallback(async () => {
    if (
      !mounted.current ||
      opened.current === null ||
      opened.current !== getAuthEpoch() ||
      !focusedRef.current
    )
      return;
    await Promise.all(
      managementRefreshKeys.map((queryKey) =>
        client.invalidateQueries({ queryKey }),
      ),
    );
    if (mounted.current && opened.current === getAuthEpoch()) setReturned(true);
  }, [client]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);
  useEffect(() => {
    if (focused) void refresh();
  }, [focused, refresh]);
  async function open() {
    if (opening.current || disabled || !focusedRef.current) return;
    opening.current = true;
    setBusy(true);
    setReturned(false);
    setError(undefined);
    const epoch = getAuthEpoch();
    try {
      const href = managementUrl(NYXID_FRONTEND_URL, target);
      opened.current = epoch;
      await WebBrowser.openBrowserAsync(href);
      await refresh();
    } catch (cause) {
      if (mounted.current && epoch === getAuthEpoch())
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not open NyxID web. Try again.",
        );
    } finally {
      opening.current = false;
      if (mounted.current && epoch === getAuthEpoch()) setBusy(false);
    }
  }
  return (
    <>
      <ActionButton
        label={label}
        variant="secondary"
        loading={busy}
        disabled={disabled || !focused}
        onPress={() => void open()}
      />
      {error && <Notice tone="error" message={error} />}
      {returned && (
        <Label muted>
          Back in NyxID. Reloading the current account’s server state; refresh
          errors appear on the relevant page.
        </Label>
      )}
    </>
  );
}
