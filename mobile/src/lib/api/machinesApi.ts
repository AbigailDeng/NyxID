import { z } from "zod";
import { requestJson } from "./http";
import {
  machineNodeSchema, machineOrgSchema, machineUpdateSchema, manageableMachines,
  type MachineInventory,
} from "../../features/machines/machineContracts";

const hostedPage = z.object({
  machines: z.array(z.object({ node_id: z.string() })),
  next_cursor: z.string().nullable(),
});

export async function readHostedMachineIds(signal?: AbortSignal) {
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const result = hostedPage.parse(await requestJson(`/remote-machines?${query}`, { signal }));
    result.machines.forEach((row) => ids.add(row.node_id));
    if (result.next_cursor === null) return ids;
    if (!result.next_cursor || cursors.has(result.next_cursor))
      throw new Error("Hosted machine discovery is incomplete. Open Machines on the web.");
    cursors.add(result.next_cursor);
    cursor = result.next_cursor;
  }
  throw new Error("Hosted machine discovery exceeded its page limit. Open Machines on the web.");
}

export const machinesApi = {
  async inventory(signal?: AbortSignal): Promise<MachineInventory> {
    const [rawNodes, rawOrgs, rawUser, hostedIds, rawUpdates] = await Promise.all([
      requestJson("/nodes", { signal }), requestJson("/orgs", { signal }),
      requestJson("/users/me", { signal }), readHostedMachineIds(signal),
      requestJson("/machines/updates", { signal }),
    ]);
    const nodes = z.object({ nodes: machineNodeSchema.array() }).parse(rawNodes).nodes;
    const orgs = z.object({ orgs: machineOrgSchema.array() }).parse(rawOrgs).orgs;
    const user = z.object({ id: z.string(), capabilities: z.object({ enabled_features: z.string().array() }).optional() }).parse(rawUser);
    return {
      nodes: manageableMachines(nodes, orgs, hostedIds, user.id),
      updates: machineUpdateSchema.array().parse(rawUpdates), userId: user.id,
      features: user.capabilities?.enabled_features ?? [],
    };
  },
};
