import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceScreenProps } from "../../app/navigationTypes";
import { useWorkspaceBack } from "../../app/WorkspaceHeader";
import { SegmentControl } from "../../components/SegmentControl";
import { SectionBadge } from "../../components/SectionBadge";
import {
  ActionButton,
  Card,
  Label,
  Notice,
  WorkspacePage,
} from "../../components/workspace/WorkspaceUI";
import { SavedLogins } from "./SavedLogins";
import { MachineDesktopEntries } from "./MachineDesktopEntries";
import {
  MachineBadges,
  MachineActionRow,
  MachineCapability,
  MachineMetadata,
  MachineRowCard,
  machineIsolationLabel,
  machineStyles,
  machineTabs,
} from "./MachinePresentation";
import type { MachineDesktopParams } from "./desktop/desktopRoutes";
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
  const [refreshing, setRefreshing] = useState(false);
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
  const node = inventory.data?.nodes.find((row) => row.id === selected);
  const update = inventory.data?.updates.find(
    (row) => row.node_id === selected,
  );
  const headerOptions = useMemo(
    () => ({ title: node?.name ?? "Machines" }),
    [node?.name],
  );
  useWorkspaceBack({
    active: !!selected,
    onBack: () => setSelected(undefined),
    options: headerOptions,
  });
  function activity(machine: MachineNode) {
    navigation.navigate("MachineActivity", {
      machineId: machine.id,
      ownerId: machine.owner.id,
    });
  }
  async function handoff(path: string) {
    try {
      await openMachineWeb(path);
    } catch (cause) {
      if (runtime.current()) setHandoffError(machineError(cause));
    }
  }
  async function refresh() {
    if (!runtime.active || inventory.isFetching) return;
    setRefreshing(true);
    try {
      await inventory.refetch();
    } finally {
      setRefreshing(false);
    }
  }
  if (!selected && tab === "logins") {
    return (
      <SavedLogins
        inventory={inventory.data}
        handoffError={handoffError}
        onWeb={(path) => void handoff(path)}
        onMachines={() => setTab(undefined)}
      />
    );
  }
  return (
    <WorkspacePage
      title={node?.name ?? "Machines"}
      showHeading={false}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
    >
      {!selected && (
        <SegmentControl
          segments={machineTabs}
          activeIndex={0}
          onPress={(index) => {
            if (index === 1) setTab("logins");
          }}
        />
      )}
      {handoffError && <Notice tone="error" message={handoffError} />}
      {inventory.isPending && <Label muted>Loading machines…</Label>}
      {inventory.error && (
        <Notice tone="error" message={machineError(inventory.error)} />
      )}
      {!selected && (
        <>
          <Label muted style={machineStyles.metadata}>
            Personal machines and organization machines you administer.
            Connectivity does not mean a desktop is live.
          </Label>
          {inventory.data &&
            !inventory.error &&
            inventory.data.nodes.map((machine) => (
              <MachineRowCard
                key={machine.id}
                label={`Details for ${machine.name}, ${machine.is_connected ? "Online" : "Offline"}, ${machine.owner.display_name}`}
                summary={`${machineIsolationLabel(machine)}. ${machine.machine?.os}/${machine.machine?.arch}, version ${machine.metadata?.agent_version ?? "unknown"}`}
                onPress={() => setSelected(machine.id)}
                actions={
                  <>
                    {machine.is_connected &&
                      (machine.machine?.computer ||
                        machine.machine?.browser) && (
                        <ActionButton
                          compact
                          label="Desktop"
                          accessibilityLabel={`View desktop for ${machine.name}`}
                          variant="secondary"
                          onPress={() =>
                            navigation.navigate("MachineDesktop", {
                              nodeId: machine.id,
                            })
                          }
                        />
                      )}
                    <ActionButton
                      compact
                      label="Activity"
                      accessibilityLabel={`Activity for ${machine.name}`}
                      variant="secondary"
                      onPress={() => activity(machine)}
                    />
                  </>
                }
              >
                <View style={machineStyles.row}>
                  <Label numberOfLines={1} style={machineStyles.name}>
                    {machine.name}
                  </Label>
                  <MachineBadges node={machine} />
                </View>
                <MachineMetadata node={machine} />
              </MachineRowCard>
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
            compact
            label="Hosted machines and setup on web"
            variant="secondary"
            onPress={() => void handoff(machineWebPath())}
          />
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
          onActivity={() => activity(node)}
          onDesktop={(params) => navigation.navigate("MachineDesktop", params)}
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
  onDesktop,
}: {
  node: MachineNode;
  update?: MachineUpdate;
  onWeb: () => void;
  onPolicy: () => void;
  onActivity: () => void;
  onDesktop: (params: MachineDesktopParams) => void;
}) {
  const machine = node.machine!;
  return (
    <>
      <Card>
        <View style={machineStyles.badges}>
          <MachineBadges node={node} />
        </View>
        <MachineMetadata node={node} />
        <Label muted style={machineStyles.metadata}>
          {node.owner.kind === "org" ? "Organization Admin" : "Personal"} ·
          Workspace roots: {machine.roots.join(", ") || "None reported"}
        </Label>
      </Card>
      <Card>
        <Label style={machineStyles.heading}>Local capability ceiling</Label>
        <Label muted style={machineStyles.metadata}>
          Configured on the machine. Agent permissions can only narrow this
          ceiling.
        </Label>
        <View style={machineStyles.grid}>
          <MachineCapability label="Commands" available={machine.shell} />
          <MachineCapability label="Files" available={machine.files} />
          <MachineCapability
            label="Browser"
            available={machine.browser ?? machine.computer}
          />
          <MachineCapability label="Computer" available={machine.computer} />
        </View>
        <View style={machineStyles.badges}>
          <Label muted style={machineStyles.metadata}>
            Command isolation
          </Label>
          <SectionBadge
            label={
              machine.commands_isolated === true
                ? "Isolated"
                : machine.commands_isolated === false
                  ? "Not isolated"
                  : "Unknown; update to check"
            }
            tone={machine.commands_isolated === true ? "success" : "warning"}
          />
        </View>
        <View style={machineStyles.badges}>
          <Label muted style={machineStyles.metadata}>
            Browser isolation
          </Label>
          <SectionBadge
            label={machine.browser_isolated ? "Isolated" : "Not isolated"}
            tone={machine.browser_isolated ? "success" : "warning"}
          />
        </View>
        <View style={machineStyles.badges}>
          <Label muted style={machineStyles.metadata}>
            Computer display / permissions
          </Label>
          <SectionBadge
            label={machine.computer_ready ? "Ready" : "Unavailable"}
            tone={machine.computer_ready ? "success" : "warning"}
          />
        </View>
        {machine.shell && machine.commands_isolated === false && (
          <Notice message={SINGLE_USER_SHELL_WARNING} />
        )}
      </Card>
      <Card>
        <Label style={machineStyles.heading}>Version and updates</Label>
        <Label muted style={machineStyles.metadata}>
          {update
            ? `${update.current_version} → ${update.target_version} · ${update.phase}${update.code ? ` · ${update.code}` : ""}`
            : "Update metadata unavailable"}
        </Label>
        {update?.guidance && <Label muted>{update.guidance}</Label>}
        {update?.updater_guidance && (
          <Label muted>{update.updater_guidance}</Label>
        )}
        <MachineActionRow
          label="Owner policy and updates"
          chevron
          onPress={onPolicy}
        />
      </Card>
      <Card>
        <Label style={machineStyles.heading}>Desktop and activity</Label>
        <View style={machineStyles.actions}>
          <ActionButton
            compact
            label="Machine activity"
            variant="secondary"
            onPress={onActivity}
          />
          <ActionButton
            compact
            label="Open machine on web"
            variant="secondary"
            onPress={onWeb}
          />
        </View>
        <MachineDesktopEntries nodeId={node.id} onOpen={onDesktop} />
      </Card>
    </>
  );
}
