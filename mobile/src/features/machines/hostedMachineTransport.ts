import { z } from "zod";

// Metadata only: bootstrap credentials, command output and provider internals
// never enter the mobile cache. Unknown lifecycle values remain visible.
export const hostedMachineSchema = z.object({
  node_id: z.string().min(1),
  name: z.string().optional(),
  resource_state: z.string(),
  billing_state: z.string(),
  authorization_state: z.string(),
  cleanup_state: z.string(),
  active_operation_id: z.string().nullable(),
  updated_at: z.string(),
  free_slot: z.boolean().optional(),
  funded_until: z.string().nullish(),
});
const pageSchema = z.object({
  machines: z.array(hostedMachineSchema),
  next_cursor: z.string().nullable(),
});
export function createHostedMachinesApi(
  request: (
    path: string,
    options: { signal?: AbortSignal },
  ) => Promise<unknown>,
) {
  return {
    async inventory(signal?: AbortSignal) {
      const machines = new Map<string, z.infer<typeof hostedMachineSchema>>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({ limit: "100" });
        if (cursor) query.set("cursor", cursor);
        const result = pageSchema.parse(
          await request(`/remote-machines?${query}`, { signal }),
        );
        result.machines.forEach((machine) =>
          machines.set(machine.node_id, machine),
        );
        if (result.next_cursor === null) return [...machines.values()];
        if (!result.next_cursor || cursors.has(result.next_cursor))
          throw new Error(
            "Hosted inventory is incomplete. Refresh or review Machines on web.",
          );
        cursors.add(result.next_cursor);
        cursor = result.next_cursor;
      }
      throw new Error(
        "Hosted inventory exceeded its page limit. Review Machines on web.",
      );
    },
  };
}
