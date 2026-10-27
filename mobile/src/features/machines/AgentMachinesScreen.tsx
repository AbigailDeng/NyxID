import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useOpenWorkspaceChat,
  useWorkspaceBack,
} from "../../app/WorkspaceHeader";
import {
  ActionButton,
  Card,
  Label,
  Notice,
  WorkspacePage,
} from "../../components/workspace/WorkspaceUI";
import { agentMachinesApi } from "../../lib/api/agentMachinesApi";
import { MachineSwitch } from "./MachinePolicyScreen";
import {
  confirmDiscard,
  machineError,
  machineKeys,
  useMachineRuntime,
  useMachineWrite,
} from "./MachineUI";
import {
  capabilityLabels,
  machineAccessState,
  selectionRequired,
  separationAvailable,
  setMachineCapability,
  SHARED_LEGACY_WARNING,
  type AgentMachine,
  type ContextMode,
  type MachineCapabilities,
} from "./agentMachineContracts";

export function AgentMachinesScreen({
  route,
}: {
  route: { params: { agentId: string } };
  navigation: { goBack(): void };
}) {
  const runtime = useMachineRuntime();
  const client = useQueryClient();
  const openChat = useOpenWorkspaceChat();
  const [selected, setSelected] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const refreshedAt = useRef(0);
  const queryKey = [
    ...machineKeys(runtime.epoch),
    "agent",
    route.params.agentId,
  ];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      agentMachinesApi.read(route.params.agentId, signal),
    enabled: runtime.active,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const machine = query.data?.machines.find((row) => row.node_id === selected);
  useWorkspaceBack({
    active: !!selected,
    defaultRole: "back",
    onBack: () => setSelected(undefined),
  });
  async function refresh() {
    if (Date.now() - refreshedAt.current < 1000)
      throw new Error("Wait a moment before refreshing again.");
    refreshedAt.current = Date.now();
    const result = await query.refetch();
    if (result.error) throw result.error;
    return result.data?.machines.find((row) => row.node_id === selected);
  }
  return (
    <WorkspacePage title="Agent machine access" showHeading={false}>
      {notice && <Notice message={notice} />}
      {query.isPending && <Label muted>Loading agent machine access…</Label>}
      {query.error && (
        <Notice tone="error" message={machineError(query.error)} />
      )}
      {!machine && (
        <ActionButton
          label="Refresh agent machine status"
          variant="secondary"
          disabled={!runtime.active || query.isFetching}
          onPress={() =>
            void refresh().catch((cause) => {
              if (runtime.current()) setNotice(machineError(cause));
            })
          }
        />
      )}
      {query.data && !selected && !query.error && (
        <>
          <Label>
            {query.data.agent.display_name ?? query.data.agent.name}
          </Label>
          <Label muted>
            Machine permissions only narrow the local capability ceiling. Saving
            cancels this agent's current work on that machine. External API-key
            and OAuth grants remain on the web.
          </Label>
          {!query.data.machines.length && (
            <Label muted>No machines are available to this agent.</Label>
          )}
          {query.data.machines.map((row) => (
            <Card key={row.node_id}>
              <Label>{row.name}</Label>
              <Label muted>
                {selectionRequired(row)
                  ? "Owner selection required"
                  : row.mode === "separated"
                    ? "Separate workspace and browser"
                    : "Shared legacy"}{" "}
                · Revision {row.revision}
              </Label>
              {machineAccessState(row).map((message) => (
                <Label muted key={message}>
                  {message}
                </Label>
              ))}
              <ActionButton
                label={`Review ${row.name} access`}
                variant="secondary"
                onPress={() => setSelected(row.node_id)}
              />
            </Card>
          ))}
        </>
      )}
      {selected && query.data && !machine && (
        <Notice message="This machine is no longer available to this agent. Return to the list and review current access." />
      )}
      {machine && query.data && (
        <AgentMachineEditor
          key={`${runtime.epoch}:${route.params.agentId}:${machine.node_id}:${machine.revision}`}
          machine={machine}
          agentId={route.params.agentId}
          ownerId={query.data.agent.owner_id}
          agentName={query.data.agent.display_name ?? query.data.agent.name}
          features={query.data.features}
          unavailable={!!query.error}
          onBack={() => setSelected(undefined)}
          onRefresh={refresh}
          onSaved={(machines) => {
            client.setQueryData(queryKey, { ...query.data, machines });
            setNotice(
              "Capabilities saved. Review cleanup and acknowledgement status before starting new work.",
            );
            void client.invalidateQueries({
              queryKey: ["workspace", "agents"],
            });
          }}
          onOpenApproval={(conversationId, acknowledgementId) =>
            openChat({ conversationId, acknowledgementId })
          }
        />
      )}
    </WorkspacePage>
  );
}

export function AgentMachineEditor({
  machine,
  agentId,
  ownerId,
  agentName,
  features,
  unavailable,
  onBack,
  onRefresh,
  onSaved,
  onOpenApproval,
}: {
  machine: AgentMachine;
  agentId: string;
  ownerId?: string;
  agentName: string;
  features: string[];
  unavailable: boolean;
  onBack: () => void;
  onRefresh: () => Promise<AgentMachine | undefined>;
  onSaved: (machines: AgentMachine[]) => void;
  onOpenApproval: (conversationId: string, acknowledgementId: string) => void;
}) {
  const write = useMachineWrite();
  const [caps, setCaps] = useState(machine.capabilities);
  const [legacyAccepted, setLegacyAccepted] = useState(false);
  const [confirmMode, setConfirmMode] = useState<ContextMode>();
  const [approval, setApproval] = useState<{
    conversation_id: string;
    acknowledgement_id: string;
  }>();
  const [refreshError, setRefreshError] = useState<string>();
  const dirty = JSON.stringify(caps) !== JSON.stringify(machine.capabilities);
  const blocked = write.busy || write.uncertain || !write.active || unavailable;
  const editable =
    features.includes("assistant:machine-capabilities") &&
    machine.can_edit &&
    machine.protocol_v2 &&
    !selectionRequired(machine);
  useWorkspaceBack({
    active: true,
    defaultRole: "back",
    disabled: write.busy,
    onBack: () =>
      confirmMode ? setConfirmMode(undefined) : confirmDiscard(dirty, onBack),
    discardOnClose:
      dirty || confirmMode
        ? {
            title: "Discard machine access changes?",
            message:
              "Unsaved capability changes and context review will be closed.",
          }
        : undefined,
  });
  async function refresh() {
    try {
      const latest = await onRefresh();
      if (!write.current()) return;
      if (!latest)
        throw new Error("This machine is no longer available to this agent.");
      setCaps(latest.capabilities);
      setConfirmMode(undefined);
      setLegacyAccepted(false);
      write.reviewed();
      setRefreshError(undefined);
    } catch (cause) {
      if (write.current()) setRefreshError(machineError(cause));
    }
  }
  return (
    <>
      <Card>
        <Label>
          {agentName} on {machine.name}
        </Label>
        <Label muted>
          Revision {machine.revision} · {machine.mode ?? "Shared legacy"}
        </Label>
        {machine.execution_note && (
          <Label muted>{machine.execution_note}</Label>
        )}
        {machineAccessState(machine).map((message) => (
          <Notice key={message} message={message} />
        ))}
        {machine.separated_setup_note && (
          <Label muted>{machine.separated_setup_note}</Label>
        )}
        <Label muted>
          Separation:{" "}
          {separationAvailable(machine)
            ? `Available (Landlock ABI ${machine.separated?.landlock_abi ?? "unknown"})`
            : (machine.separated?.reason ?? "Unavailable")}
        </Label>
      </Card>
      {write.error && <Notice tone="error" message={write.error} />}
      {refreshError && <Notice tone="error" message={refreshError} />}
      <ActionButton
        label="Reload access and recovery status"
        variant="secondary"
        disabled={write.busy || !write.active}
        onPress={() => confirmDiscard(dirty, () => void refresh())}
      />
      <Card>
        {!editable && (
          <Notice
            message={
              !features.includes("assistant:machine-capabilities")
                ? "Capability editing is not enabled. Existing restrictions remain in effect."
                : !machine.can_edit
                  ? "Only the machine owner or an organization Admin can edit access."
                  : !machine.protocol_v2
                    ? "Update this machine before editing capabilities. Existing access continues."
                    : "Complete owner selection before editing capabilities."
            }
          />
        )}
        {(Object.keys(capabilityLabels) as (keyof MachineCapabilities)[]).map(
          (key) => (
            <MachineSwitch
              key={key}
              label={`${capabilityLabels[key]}${machine.ceiling[key] ? "" : " (off on machine)"}`}
              value={caps[key]}
              disabled={
                blocked ||
                !editable ||
                !machine.ceiling[key] ||
                ((key === "computer" || key === "developer_browser") &&
                  !caps.browser)
              }
              onChange={(value) =>
                setCaps((current) => setMachineCapability(current, key, value))
              }
            />
          ),
        )}
        <Label muted>
          Shell uses its OS user's full permissions even with File tools off.
          Computer control operates applications. Developer browser permits
          JavaScript in its separate browser; saved logins stay in Secure
          browser.
        </Label>
        <Label muted>
          Saved-login access is preserved:{" "}
          {machine.saved_login_ids === null
            ? "legacy selection"
            : `${machine.saved_login_ids.length} selected`}
          . Review saved-login grants on the web.
        </Label>
        <ActionButton
          label="Save agent machine capabilities"
          disabled={blocked || !editable || !dirty}
          loading={write.busy}
          onPress={() =>
            void write.run(async (current) => {
              const result = await agentMachinesApi.save(
                agentId,
                ownerId,
                machine,
                caps,
                current,
              );
              if (current()) onSaved(result);
            })
          }
        />
      </Card>
      {machine.can_edit && (
        <Card>
          <Label>Workspace and browser mode</Label>
          <Label muted>
            Mode changes require a separate owner action card in the Assistant.
            Requesting approval does not apply the change. Save or discard
            capability edits first.
          </Label>
          {features.includes("assistant:machine-contexts") &&
            machine.mode !== "separated" &&
            separationAvailable(machine) && (
              <ActionButton
                label="Review separate workspace request"
                variant="secondary"
                disabled={blocked || dirty || !!approval}
                onPress={() => setConfirmMode("separated")}
              />
            )}
          {machine.mode !== "shared_legacy" && (
            <>
              <Notice message={SHARED_LEGACY_WARNING} />
              <MachineSwitch
                label="I explicitly choose shared legacy access and acknowledge the risk"
                value={legacyAccepted}
                disabled={blocked || dirty || !!approval}
                onChange={setLegacyAccepted}
              />
              <ActionButton
                label="Review shared legacy request"
                variant="secondary"
                disabled={blocked || dirty || !legacyAccepted || !!approval}
                onPress={() => setConfirmMode("shared_legacy")}
              />
            </>
          )}
          {confirmMode && (
            <>
              <Notice
                message={`Request owner approval for ${agentName} on ${machine.name}: ${confirmMode === "separated" ? "separate workspace and browser" : "shared legacy access"}? Current capability and saved-login selections are preserved.`}
              />
              <ActionButton
                label="Request owner action card"
                disabled={
                  blocked ||
                  dirty ||
                  (confirmMode === "shared_legacy" && !legacyAccepted)
                }
                onPress={() =>
                  void write.run(async (current) => {
                    const result = await agentMachinesApi.requestContext(
                      agentId,
                      ownerId,
                      machine,
                      confirmMode,
                      current,
                    );
                    if (!current()) return;
                    setApproval(result);
                    setConfirmMode(undefined);
                  })
                }
              />
              <ActionButton
                label="Cancel context request"
                variant="secondary"
                disabled={write.busy}
                onPress={() => setConfirmMode(undefined)}
              />
            </>
          )}
          {approval && (
            <>
              <Notice message="Owner approval requested. Review the action card in its Assistant conversation. Access changes only after approval succeeds." />
              <ActionButton
                label="Review owner action card in Assistant"
                disabled={write.busy}
                onPress={() =>
                  onOpenApproval(
                    approval.conversation_id,
                    approval.acknowledgement_id,
                  )
                }
              />
            </>
          )}
        </Card>
      )}
    </>
  );
}
