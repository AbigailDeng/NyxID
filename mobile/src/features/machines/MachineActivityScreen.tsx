import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { WorkspaceSheetParamList } from "../../app/navigationTypes";
import {
  ActionButton,
  Card,
  Label,
  Notice,
  WorkspacePage,
} from "../../components/workspace/WorkspaceUI";
import { WorkspaceSelectionField } from "../../components/workspace/WorkspaceSelectionField";
import { machinesApi } from "../../lib/api/machinesApi";
import { machineError, machineKeys, useMachineRuntime } from "./MachineUI";

export function MachineActivityScreen({
  route,
}: NativeStackScreenProps<WorkspaceSheetParamList, "MachineActivity">) {
  const runtime = useMachineRuntime();
  const [filter, setFilter] = useState("");
  const [before, setBefore] = useState<string>();
  const query = useQuery({
    queryKey: [
      ...machineKeys(runtime.epoch),
      "activity",
      route.params.machineId,
      filter,
      before,
    ],
    queryFn: ({ signal }) =>
      machinesApi.activity(
        route.params.machineId,
        route.params.ownerId,
        filter,
        before,
        signal,
      ),
    enabled: runtime.active,
    retry: false,
  });
  return (
    <WorkspacePage title="Machine activity" showHeading={false}>
      <Label muted>
        Metadata only; command contents, credentials and desktop frames are not
        included.
      </Label>
      <WorkspaceSelectionField
        label="Agent filter"
        value={[filter]}
        allowEmpty={false}
        options={[
          { value: "", label: "All agents" },
          { value: "unattributed", label: "Unattributed" },
          ...(query.data?.agents ?? []).map((agent) => ({
            value: agent.id,
            label: agent.display_name ?? agent.name,
          })),
        ]}
        onChange={(values) => {
          setFilter(values[0] ?? "");
          setBefore(undefined);
        }}
      />
      {query.isPending && <Label muted>Loading machine activity…</Label>}
      {query.error && (
        <Notice tone="error" message={machineError(query.error)} />
      )}
      <ActionButton
        label="Refresh activity"
        variant="secondary"
        disabled={!runtime.active || query.isFetching}
        onPress={() => void query.refetch()}
      />
      {!query.error &&
        query.data?.entries.map((entry) => (
          <Card key={entry.id}>
            <Label>
              {entry.action} · {entry.outcome}
            </Label>
            <Label muted>{entry.created_at}</Label>
            <Label muted>
              {query.data!.agents.find((agent) => agent.id === entry.agent_id)
                ?.display_name ??
                query.data!.agents.find((agent) => agent.id === entry.agent_id)
                  ?.name ??
                "Unattributed"}
            </Label>
            {entry.duration_ms != null && (
              <Label muted>Duration: {entry.duration_ms} ms</Label>
            )}
            {entry.exit_code != null && (
              <Label muted>Exit code: {entry.exit_code}</Label>
            )}
          </Card>
        ))}
      {query.data && !query.error && !query.data.entries.length && (
        <Label muted>No activity matches this filter.</Label>
      )}
      {query.data?.next_cursor && !query.error && (
        <ActionButton
          label="Older activity"
          variant="secondary"
          disabled={!runtime.active || query.isFetching}
          onPress={() => setBefore(query.data!.next_cursor!)}
        />
      )}
      {before && (
        <ActionButton
          label="Latest activity"
          variant="secondary"
          onPress={() => setBefore(undefined)}
        />
      )}
    </WorkspacePage>
  );
}
