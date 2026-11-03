import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Switch, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionButton,
  Card,
  Field,
  Label,
  Notice,
} from "../../../components/workspace/WorkspaceUI";
import { ApiError } from "../../../lib/api/ApiError";
import { getAuthEpoch } from "../../../lib/auth/authEpoch";
import { consoleApi } from "./consoleApi";
import {
  checksFromDraft,
  displayedMonitoringStatus,
  draftFromConfiguration,
  type MonitoringCheckResult,
  type MonitoringDraft,
  type MonitoringResult,
} from "./monitoringContracts";
import type { MonitoringOperation } from "./consoleTransport";
import { createConsoleActivation } from "./consoleActivation";

const statusLabels = {
  healthy: "Healthy",
  unhealthy: "Unhealthy",
  ready: "Ready",
  not_ready: "Not ready",
  not_configured: "Not configured",
  unknown: "Unknown",
};

function CheckSummary({
  title,
  check,
  now,
}: {
  title: string;
  check: MonitoringCheckResult | null;
  now: number;
}) {
  const status = displayedMonitoringStatus(check, now);
  return (
    <View style={{ gap: 5 }}>
      <Label>
        {title}: {statusLabels[status]}
      </Label>
      {check?.checked_at && (
        <Label muted>
          Last checked:{" "}
          {Number.isFinite(Date.parse(check.checked_at))
            ? new Date(check.checked_at).toLocaleString()
            : "Unknown"}
        </Label>
      )}
      {check?.path && (
        <Label mono muted>
          {check.path} · {check.source}
        </Label>
      )}
      {status === "unknown" && (
        <Label muted>
          No current observation. Refresh reads status; Check now runs a new
          check.
        </Label>
      )}
    </View>
  );
}

export function ServiceMonitoringCard({
  serviceId,
  active,
  parentBusy = false,
  onEditingChange,
  onBusyChange,
}: {
  serviceId: string;
  active: boolean;
  parentBusy?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const client = useQueryClient();
  const [epoch] = useState(getAuthEpoch);
  const live = useRef(active);
  live.current = active;
  const mounted = useRef(true);
  const activation = useRef(createConsoleActivation(getAuthEpoch, active));
  activation.current.update(active && AppState.currentState === "active");
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const uncertainKey = [
    "workspace",
    "services",
    "monitoring-uncertain",
    epoch,
    serviceId,
  ] as const;
  const [mustReload, setMustReload] = useState(
    () => client.getQueryData(uncertainKey) === true,
  );
  const [now, setNow] = useState(Date.now);
  const [draft, setDraft] = useState<{
    revision: number;
    values: MonitoringDraft;
  }>();
  const [clearing, setClearing] = useState<number>();
  const [manual, setManual] = useState<{
    kind: "probe" | "validate";
    result: MonitoringResult;
    expiresAt: number;
  }>();
  const key = [
    "workspace",
    "services",
    "monitoring",
    epoch,
    serviceId,
  ] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      consoleApi.readMonitoring(
        serviceId,
        signal,
        activation.current.capture(),
      ),
    enabled: active,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    mounted.current = true;
    activation.current.mount();
    const subscription = AppState.addEventListener("change", (state) =>
      activation.current.update(state === "active" && live.current),
    );
    return () => {
      subscription.remove();
      mounted.current = false;
      activation.current.dispose();
      onBusyChange?.(false);
    };
  }, []);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    onEditingChange?.(Boolean(draft));
    return () => onEditingChange?.(false);
  }, [Boolean(draft), onEditingChange]);
  useEffect(() => {
    if (!active) {
      setDraft(undefined);
      setManual(undefined);
      setClearing(undefined);
      if (lock.current) setMustReload(true);
      void client.cancelQueries({ queryKey: key, exact: true });
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, client, epoch, serviceId]);

  async function refresh() {
    if (lock.current || parentBusy || !live.current) return;
    setDraft(undefined);
    setManual(undefined);
    setClearing(undefined);
    setError(undefined);
    setNotice(undefined);
    const result = await query.refetch();
    if (mounted.current && live.current && !result.isError) {
      setMustReload(false);
      client.setQueryData(uncertainKey, false);
    }
  }
  async function execute(input: MonitoringOperation) {
    if (
      lock.current ||
      parentBusy ||
      mustReload ||
      client.getQueryData(uncertainKey) === true ||
      !query.data ||
      query.isFetching
    )
      return;
    const guard = activation.current.capture();
    lock.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    setManual(undefined);
    client.setQueryData(uncertainKey, true);
    onBusyChange?.(true);
    try {
      guard();
      const value = await consoleApi.operate(
        serviceId,
        query.data.user.id,
        input,
        guard,
      );
      guard();
      if (value.kind === "configuration") {
        setDraft(undefined);
        setClearing(undefined);
        const result = await query.refetch();
        guard();
        if (result.isError) {
          setMustReload(true);
          setError(
            "The change was saved, but its current status could not be read. Refresh before continuing.",
          );
        } else {
          client.setQueryData(uncertainKey, false);
          setNotice(
            input.kind === "clear"
              ? "Owner overrides cleared. Available built-in health checks can take over."
              : "Monitoring configuration saved.",
          );
        }
      } else {
        client.setQueryData(uncertainKey, false);
        const at = Date.now();
        setNow(at);
        setManual({
          kind: value.kind,
          result: value.result,
          expiresAt: at + 60_000,
        });
      }
    } catch (cause) {
      if (mounted.current) {
        setMustReload(true);
        setError(
          cause instanceof ApiError && cause.statusCode === 409
            ? "Configuration changed in another editor. Reload and review the latest values; your draft has not overwritten them."
            : `${cause instanceof Error ? cause.message : "Monitoring action failed."} Refresh and review the current state before trying again.`,
        );
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  }
  function submitDraft(kind: "save" | "validate") {
    if (!draft) return;
    try {
      const checks = checksFromDraft(draft.values);
      if (kind === "validate" && !checks.health && !checks.readiness)
        throw new Error("Enable at least one check to test a draft.");
      void execute(
        kind === "save"
          ? { kind, revision: draft.revision, checks }
          : { kind, checks },
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Review your check configuration.",
      );
    }
  }
  if (
    !active ||
    query.data === null ||
    (query.error instanceof ApiError &&
      query.error.errorKey === "monitoring_not_configured")
  )
    return null;
  const data =
    query.isError || query.isFetching ? undefined : query.data?.response;
  const blocked = busy || parentBusy || query.isFetching || mustReload;
  return (
    <Card>
      <Label accessibilityRole="header">Health and readiness</Label>
      <Label muted>
        Refresh reads existing observations. Check now and Test draft run
        requests and may require approval or incur service charges.
      </Label>
      {query.isPending && (
        <ActivityIndicator accessibilityLabel="Loading monitoring" />
      )}
      {query.isError && (
        <Notice
          tone="error"
          message="Monitoring is unavailable. Health and readiness are unknown. Refresh to try again."
        />
      )}
      {data && (
        <>
          <CheckSummary title="Health" check={data.status.health} now={now} />
          <CheckSummary
            title="Readiness"
            check={data.status.readiness}
            now={now}
          />
        </>
      )}
      {notice && <Notice tone="success" message={notice} />}
      {error && <Notice tone="error" message={error} />}
      <ActionButton
        label={
          mustReload
            ? "Reload and review latest monitoring"
            : "Refresh monitoring"
        }
        variant="secondary"
        disabled={busy || parentBusy || query.isFetching}
        onPress={() => void refresh()}
      />
      {data?.can_probe && (
        <ActionButton
          label="Check now"
          variant="secondary"
          disabled={blocked}
          loading={busy}
          onPress={() => void execute({ kind: "probe" })}
        />
      )}
      {manual && !query.isError && (
        <View style={{ gap: 10 }}>
          <Label>
            {manual.kind === "validate"
              ? "Draft test result (not saved)"
              : "Manual check result"}
          </Label>
          {now >= manual.expiresAt ? (
            <Label muted>
              Manual result expired. Run a new check for current status.
            </Label>
          ) : (
            <>
              <CheckSummary
                title="Checked health"
                check={manual.result.health}
                now={now}
              />
              <CheckSummary
                title="Checked readiness"
                check={manual.result.readiness}
                now={now}
              />
            </>
          )}
        </View>
      )}
      {data?.can_manage && data.configuration && !draft && (
        <>
          <ActionButton
            label="Configure monitoring"
            variant="secondary"
            disabled={blocked}
            onPress={() => {
              setError(undefined);
              setDraft({
                revision: data.configuration!.revision,
                values: draftFromConfiguration(data.configuration!),
              });
            }}
          />
          {(data.configuration.owner_config.health ||
            data.configuration.owner_config.readiness) && (
            <ActionButton
              label="Clear owner configuration"
              variant="secondary"
              disabled={blocked}
              onPress={() => setClearing(data.configuration!.revision)}
            />
          )}
        </>
      )}
      {clearing !== undefined && data?.can_manage && data.configuration && (
        <>
          <Notice message="Clear health and readiness overrides? This lets available built-in health checks take over; it does not disable monitoring." />
          <ActionButton
            label="Confirm clear configuration"
            variant="danger"
            disabled={blocked}
            onPress={() =>
              void execute({
                kind: "clear",
                revision: clearing,
              })
            }
          />
          <ActionButton
            label="Keep configuration"
            variant="secondary"
            disabled={busy}
            onPress={() => setClearing(undefined)}
          />
        </>
      )}
      {draft && (
        <View style={{ gap: 14 }}>
          <Label>Configure safe GET checks</Label>
          <Label muted>
            Use relative paths such as healthz. Turning an owner health check
            off allows built-in fallback; readiness is only checked when
            configured.
          </Label>
          {(["health", "readiness"] as const).map((kind) => {
            const value = draft.values[kind];
            const change = (patch: Partial<typeof value>) => {
              setManual(undefined);
              setDraft({
                ...draft,
                values: { ...draft.values, [kind]: { ...value, ...patch } },
              });
            };
            return (
              <View key={kind} style={{ gap: 10 }}>
                <Label>
                  {kind === "health" ? "Health override" : "Readiness check"}
                </Label>
                <Switch
                  accessibilityLabel={`Enable ${kind} check`}
                  value={value.enabled}
                  disabled={blocked}
                  onValueChange={(enabled) => change({ enabled })}
                />
                {value.enabled && (
                  <>
                    <Field
                      label={`${kind} GET path`}
                      value={value.path}
                      onChangeText={(path) => change({ path })}
                      autoCorrect={false}
                      editable={!blocked}
                    />
                    <Field
                      label={`${kind} expected status codes`}
                      value={value.statuses}
                      onChangeText={(statuses) => change({ statuses })}
                      autoCorrect={false}
                      editable={!blocked}
                    />
                    <Field
                      label={`${kind} body contains (optional)`}
                      value={value.body}
                      onChangeText={(body) => change({ body })}
                      autoCorrect={false}
                      editable={!blocked}
                    />
                  </>
                )}
              </View>
            );
          })}
          <ActionButton
            label="Test draft"
            variant="secondary"
            disabled={blocked || !data?.can_manage || !data?.can_probe}
            onPress={() => submitDraft("validate")}
          />
          <ActionButton
            label="Save monitoring"
            disabled={blocked || !data?.can_manage}
            onPress={() => submitDraft("save")}
          />
          <ActionButton
            label="Cancel monitoring changes"
            variant="secondary"
            disabled={busy}
            onPress={() => {
              setDraft(undefined);
              setManual(undefined);
              setError(undefined);
            }}
          />
        </View>
      )}
    </Card>
  );
}
