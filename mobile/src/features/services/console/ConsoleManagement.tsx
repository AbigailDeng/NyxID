import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import {
  ActionButton,
  Card,
  Label,
  Notice,
} from "../../../components/workspace/WorkspaceUI";
import { getAuthEpoch } from "../../../lib/auth/authEpoch";
import { NYXID_FRONTEND_URL } from "../../../lib/env";
import { servicesApi } from "../../../lib/api/servicesApi";
import { canEditConnection, type ServiceConnection } from "../serviceContracts";
import { consoleApi } from "./consoleApi";
import {
  advancedConnectionDestinations,
  consoleDestinations,
  consoleWebUrl,
  type ConsoleDestination,
} from "./consoleDestinations";
import { createConsoleActivation } from "./consoleActivation";

function useConsoleAction(active: boolean, onReturned: () => Promise<void>) {
  const [epoch] = useState(getAuthEpoch);
  const live = useRef(active);
  live.current = active;
  const activation = useRef(createConsoleActivation(getAuthEpoch, active));
  activation.current.update(active && AppState.currentState === "active");
  const mounted = useRef(true);
  const pendingReturn = useRef<
    { epoch: number; refresh: () => Promise<void> } | undefined
  >(undefined);
  const returnHandler = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    mounted.current = true;
    activation.current.mount();
    const subscription = AppState.addEventListener("change", (state) => {
      activation.current.update(state === "active" && live.current);
      if (state === "active") void returnHandler.current();
    });
    return () => {
      subscription.remove();
      mounted.current = false;
      activation.current.dispose();
      pendingReturn.current = undefined;
    };
  }, []);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [failed, setFailed] = useState(false);
  async function completeReturn() {
    const pending = pendingReturn.current;
    if (!pending) return;
    if (!mounted.current || getAuthEpoch() !== pending.epoch) {
      pendingReturn.current = undefined;
      return;
    }
    if (!live.current || AppState.currentState !== "active") return;
    pendingReturn.current = undefined;
    try {
      await pending.refresh();
      if (mounted.current && live.current && getAuthEpoch() === pending.epoch)
        setMessage(
          "Returned from Web. Refresh was requested. Review the connection’s current server status to confirm your changes.",
        );
    } catch {
      if (mounted.current && live.current && getAuthEpoch() === pending.epoch) {
        setFailed(true);
        setMessage(
          "Returned from Web. Refresh could not complete; refresh this screen to check your changes.",
        );
      }
    }
  }
  returnHandler.current = completeReturn;
  useEffect(() => {
    if (active) void returnHandler.current();
  }, [active]);
  const guard = activation.current.capture();
  async function open(
    destination: ConsoleDestination,
    authorize: (guard: () => void) => Promise<void>,
  ) {
    if (lock.current || pendingReturn.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(undefined);
    setFailed(false);
    try {
      guard();
      await authorize(guard);
      guard();
      await WebBrowser.openBrowserAsync(
        consoleWebUrl(NYXID_FRONTEND_URL, destination.path),
      );
      // Browser handoff may background this app. Only preflight uses the old
      // activation generation; returning uses the same account and current view.
      if (!mounted.current || getAuthEpoch() !== epoch) return;
      pendingReturn.current = { epoch, refresh: onReturned };
      await completeReturn();
    } catch (cause) {
      if (mounted.current && live.current) {
        setFailed(true);
        setMessage(
          cause instanceof Error
            ? cause.message
            : "Could not open NyxID Web. Try again.",
        );
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { open, guard, epoch, busy, message, failed };
}

export function ConsoleManagement({
  active,
  onReturned,
}: {
  active: boolean;
  onReturned: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const action = useConsoleAction(active, onReturned);
  const query = useQuery({
    queryKey: ["workspace", "services", "console-access", action.epoch],
    enabled: active && expanded,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const user = await consoleApi.identity(signal, action.guard);
      const orgs = await consoleApi.organizations(signal, action.guard);
      return { user, orgs };
    },
  });
  const destinations =
    !query.isError && !query.isFetching && query.data
      ? consoleDestinations(query.data.user, query.data.orgs)
      : [];
  return (
    <Card>
      <Label accessibilityRole="header">Developer console</Label>
      <Label muted>
        Manage keys, pools, credential Nodes and developer integrations in NyxID
        Web. Your Web session applies its own current permissions.
      </Label>
      <ActionButton
        label={expanded ? "Hide developer console" : "Show developer console"}
        variant="secondary"
        disabled={action.busy}
        onPress={() => setExpanded((value) => !value)}
      />
      {expanded && (
        <>
          <Label muted>
            Terminal in the app creates CLI login codes. For SSH, open an SSH
            connection’s Advanced tab and choose SSH terminal.
          </Label>
          {query.isPending && <Label muted>Loading your console access…</Label>}
          {query.isError && (
            <Notice
              tone="error"
              message="Could not verify console access. Refresh to try again."
            />
          )}
          <ActionButton
            label="Refresh console access"
            variant="secondary"
            disabled={action.busy || query.isFetching || !active}
            onPress={() => void query.refetch()}
          />
          {destinations.map((destination) => (
            <ActionButton
              key={destination.path}
              label={`${destination.label} · Web`}
              accessibilityHint={destination.description}
              variant="secondary"
              disabled={action.busy || !active}
              onPress={() =>
                void action.open(destination, async (guard) => {
                  const user = await consoleApi.identity(undefined, guard);
                  const orgs = await consoleApi.organizations(undefined, guard);
                  if (
                    user.id !== query.data?.user.id ||
                    !consoleDestinations(user, orgs).some(
                      (item) => item.path === destination.path,
                    )
                  )
                    throw new Error(
                      "Your access changed. Refresh console access before continuing.",
                    );
                })
              }
            />
          ))}
        </>
      )}
      {action.message && (
        <Notice
          tone={action.failed ? "error" : undefined}
          message={action.message}
        />
      )}
    </Card>
  );
}

export function AdvancedConnectionLinks({
  connection,
  editable,
  active,
  onReturned,
}: {
  connection: ServiceConnection;
  editable: boolean;
  active: boolean;
  onReturned: () => Promise<void>;
}) {
  const action = useConsoleAction(active, onReturned);
  return (
    <Card>
      <Label accessibilityRole="header">Advanced connection settings</Label>
      <Label muted>
        {editable
          ? "Edit these settings for this connection in Web. The app refreshes when you return."
          : "Your role can review this connection. Configuration changes require its owner or an authorized organization admin."}
      </Label>
      {advancedConnectionDestinations(connection, editable).map(
        (destination) => (
          <ActionButton
            key={destination.label}
            label={`${destination.label} · Web`}
            accessibilityHint={destination.description}
            variant="secondary"
            disabled={action.busy || !active}
            onPress={() =>
              void action.open(destination, async (guard) => {
                guard();
                const latest = await servicesApi.connection(connection.id);
                guard();
                if (
                  !advancedConnectionDestinations(
                    latest,
                    canEditConnection(latest),
                  ).some(
                    (item) =>
                      item.label === destination.label &&
                      item.path === destination.path,
                  )
                )
                  throw new Error(
                    "Connection permissions changed. Refresh the connection before continuing.",
                  );
              })
            }
          />
        ),
      )}
      {action.message && (
        <Notice
          tone={action.failed ? "error" : undefined}
          message={action.message}
        />
      )}
    </Card>
  );
}
