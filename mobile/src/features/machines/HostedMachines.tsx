import { useQuery } from "@tanstack/react-query";
import {
  ActionButton,
  Card,
  Label,
  Notice,
} from "../../components/workspace/WorkspaceUI";
import { requestJson } from "../../lib/api/http";
import { machineWebPath } from "./machineContracts";
import { machineError, machineKeys, useMachineRuntime } from "./MachineUI";
import { createHostedMachinesApi } from "./hostedMachineTransport";

const api = createHostedMachinesApi(requestJson);
export function HostedMachines({
  canCreate,
  onWeb,
}: {
  canCreate: boolean;
  onWeb: (path: string) => void;
}) {
  const runtime = useMachineRuntime();
  const query = useQuery({
    queryKey: [...machineKeys(runtime.epoch), "hosted"],
    queryFn: ({ signal }) => api.inventory(signal),
    enabled: runtime.active,
    retry: false,
    refetchInterval: runtime.active ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  return (
    <Card>
      <Label>Hosted remote machines · personal account</Label>
      <Label muted>
        Lifecycle changes, price and quota checks, jobs, confirmations, costs
        and events open the selected machine on web. Returning reloads server
        status.
      </Label>
      {query.isPending && <Label muted>Loading hosted machines…</Label>}
      {query.error && (
        <Notice tone="error" message={machineError(query.error)} />
      )}
      {query.data?.map((machine) => (
        <Card key={machine.node_id}>
          <Label>
            {machine.name ?? "Hosted machine"} · {machine.resource_state}
          </Label>
          <Label muted>
            Billing: {machine.billing_state}
            {machine.free_slot === true ? " · Free slot" : ""} · Access:{" "}
            {machine.authorization_state}
          </Label>
          <Label muted>
            Cleanup: {machine.cleanup_state}
            {machine.funded_until
              ? ` · Funded until ${machine.funded_until}`
              : ""}
          </Label>
          <ActionButton
            compact
            label={`Manage ${machine.name ?? "hosted machine"}: lifecycle, jobs & billing`}
            variant="secondary"
            disabled={!runtime.active}
            onPress={() => onWeb(machineWebPath(machine.node_id))}
          />
        </Card>
      ))}
      {query.data?.length === 0 && <Label muted>No hosted machines.</Label>}
      <ActionButton
        compact
        label="Refresh hosted machines"
        variant="secondary"
        disabled={!runtime.active || query.isFetching}
        onPress={() => void query.refetch()}
      />
      {canCreate && (
        <ActionButton
          label="Create hosted machine: review price & quota"
          variant="secondary"
          disabled={!runtime.active}
          onPress={() => onWeb("/assistant/machines/new?where=hosted")}
        />
      )}
    </Card>
  );
}
