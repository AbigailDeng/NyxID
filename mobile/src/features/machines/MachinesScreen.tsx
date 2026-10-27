import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceScreenProps } from "../../app/navigationTypes";
import { useWorkspaceBack } from "../../app/WorkspaceHeader";
import {
  ActionButton,
  Card,
  Label,
  Notice,
  WorkspacePage,
} from "../../components/workspace/WorkspaceUI";
import { SavedLogins } from "./SavedLogins";
import { machinesApi } from "../../lib/api/machinesApi";
import {
  machineWebPath,
  SINGLE_USER_SHELL_WARNING,
  type MachineNode,
  type MachineUpdate,
} from "./machineContracts";
import {
  machineError,
  machineKeys,
  openMachineWeb,
  useMachineRuntime,
} from "./MachineUI";

export function MachinesScreen({
  route,
  navigation,
}: WorkspaceScreenProps<"Machines">) {
  const runtime = useMachineRuntime();
  const [selected, setSelected] = useState(route.params?.machine);
  const [tab, setTab] = useState(route.params?.tab);
  const [handoffError, setHandoffError] = useState<string>();
  useEffect(() => {
    setSelected(route.params?.machine);
    setTab(route.params?.tab);
  }, [route.params]);
  const inventory = useQuery({
    queryKey: [...machineKeys(runtime.epoch), "inventory"],
    queryFn: ({ signal }) => machinesApi.inventory(signal),
    enabled: runtime.active,
    retry: false,
    refetchInterval: runtime.active ? 10_000 : false,
    refetchIntervalInBackground: false,
  });
  useWorkspaceBack({
    active: !!selected,
    onBack: () => setSelected(undefined),
  });
  const node = inventory.data?.nodes.find((row) => row.id === selected);
  const update = inventory.data?.updates.find(
    (row) => row.node_id === selected,
  );
  async function handoff(path: string) {
    try {
      await openMachineWeb(path);
    } catch (cause) {
      if (runtime.current()) setHandoffError(machineError(cause));
    }
  }
  return (
    <WorkspacePage title={node?.name ?? "Machines"} showHeading={false}>
      {handoffError && <Notice tone="error" message={handoffError} />}
      {inventory.isPending && <Label muted>Loading machines…</Label>}
      {inventory.error && (
        <Notice tone="error" message={machineError(inventory.error)} />
      )}
      <ActionButton
        label="Refresh machines"
        variant="secondary"
        disabled={inventory.isFetching || !runtime.active}
        onPress={() => void inventory.refetch()}
      />
      {!selected && (
        <>
          {tab === "logins" ? (
            <SavedLogins
              inventory={inventory.data}
              onWeb={(path) => void handoff(path)}
              onMachines={() => setTab(undefined)}
            />
          ) : (
            <>
              <ActionButton
                label="Saved logins"
                variant="secondary"
                onPress={() => setTab("logins")}
              />
              <Label muted>
                Personal machines and organization machines you administer.
                Connectivity does not mean a desktop is live.
              </Label>
              {inventory.data &&
                !inventory.error &&
                inventory.data.nodes.map((machine) => (
                  <Card key={machine.id}>
                    <Label>{machine.name}</Label>
                    <Label muted>
                      {machine.owner.display_name} ·{" "}
                      {machine.is_connected ? "Connected" : "Disconnected"} ·{" "}
                      {machine.status}
                    </Label>
                    <Label muted>
                      {machine.machine?.os} / {machine.machine?.arch}
                    </Label>
                    {machine.machine?.shell &&
                      machine.machine.commands_isolated !== true && (
                        <Notice
                          message={
                            machine.machine.commands_isolated === false
                              ? "Commands are not isolated"
                              : "Command isolation is unknown"
                          }
                        />
                      )}
                    <ActionButton
                      label={`Details for ${machine.name}`}
                      variant="secondary"
                      onPress={() => setSelected(machine.id)}
                    />
                  </Card>
                ))}
              {inventory.data &&
                !inventory.error &&
                !inventory.data.nodes.length && (
                  <Label muted>
                    No manageable machines. Pair a machine on the web to get
                    started.
                  </Label>
                )}
              <ActionButton
                label="Hosted machines and setup on web"
                variant="secondary"
                onPress={() => void handoff(machineWebPath())}
              />
            </>
          )}
        </>
      )}
      {selected && !inventory.isPending && !inventory.error && !node && (
        <>
          <Notice message="This machine is unavailable for native management. It may have been removed, transferred, hosted, or require organization Admin access." />
          <ActionButton
            label="Open this machine on web"
            variant="secondary"
            onPress={() => void handoff(machineWebPath(selected))}
          />
        </>
      )}
      {node && !inventory.error && (
        <MachineDetails
          node={node}
          update={update}
          onWeb={() => void handoff(machineWebPath(node.id))}
          onPolicy={() =>
            navigation.navigate("MachinePolicy", {
              machineId: node.id,
              ownerId: node.owner.id,
            })
          }
          onActivity={() =>
            navigation.navigate("MachineActivity", {
              machineId: node.id,
              ownerId: node.owner.id,
            })
          }
        />
      )}
    </WorkspacePage>
  );
}

export function MachineDetails({
  node,
  update,
  onWeb,
  onPolicy,
  onActivity,
}: {
  node: MachineNode;
  update?: MachineUpdate;
  onWeb: () => void;
  onPolicy: () => void;
  onActivity: () => void;
}) {
  const machine = node.machine!;
  return (
    <>
      <Card>
        <Label>{node.name}</Label>
        <Label muted>
          {node.owner.display_name} ·{" "}
          {node.owner.kind === "org" ? "Organization Admin" : "Personal"}
        </Label>
        <Label muted>
          {node.is_connected ? "Connected" : "Disconnected"} · {node.status}
        </Label>
        <Label muted>
          {machine.os} / {machine.arch} · v
          {node.metadata?.agent_version ?? "unknown"}
        </Label>
        <Label muted>
          Workspace roots: {machine.roots.join(", ") || "None reported"}
        </Label>
      </Card>
      <Card>
        <Label>Local capability ceiling</Label>
        <Label muted>
          Configured on the machine. Agent permissions can only narrow this
          ceiling.
        </Label>
        <Label>
          Commands: {machine.shell ? "Available" : "Off"} · Files:{" "}
          {machine.files ? "Available" : "Off"}
        </Label>
        <Label>
          Browser: {(machine.browser ?? machine.computer) ? "Available" : "Off"}{" "}
          · Computer: {machine.computer ? "Available" : "Off"}
        </Label>
        <Label muted>
          Command isolation:{" "}
          {machine.commands_isolated === true
            ? "Isolated"
            : machine.commands_isolated === false
              ? "Not isolated"
              : "Unknown; update to check"}
        </Label>
        <Label muted>
          Browser isolation:{" "}
          {machine.browser_isolated ? "Isolated" : "Not isolated"}
        </Label>
        <Label muted>
          Computer display/permissions:{" "}
          {machine.computer_ready ? "Ready" : "Unavailable"}
        </Label>
        {machine.shell && machine.commands_isolated === false && (
          <Notice message={SINGLE_USER_SHELL_WARNING} />
        )}
      </Card>
      <Card>
        <Label>Version and updates</Label>
        <Label muted>
          {update
            ? `${update.current_version} → ${update.target_version} · ${update.phase}${update.code ? ` · ${update.code}` : ""}`
            : "Update metadata unavailable"}
        </Label>
        {update?.guidance && <Label muted>{update.guidance}</Label>}
        {update?.updater_guidance && (
          <Label muted>{update.updater_guidance}</Label>
        )}
      </Card>
      <ActionButton
        label="Owner policy and updates"
        variant="secondary"
        onPress={onPolicy}
      />
      <ActionButton
        label="Machine activity"
        variant="secondary"
        onPress={onActivity}
      />
      <ActionButton
        label="Live desktop — available on web"
        variant="secondary"
        disabled
        onPress={() => {}}
      />
      <ActionButton
        label="Open machine on web"
        variant="secondary"
        onPress={onWeb}
      />
    </>
  );
}
