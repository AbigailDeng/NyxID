import { z } from "zod";

export const machineProfileSchema = z.object({
  version: z.number(),
  shell: z.boolean(), files: z.boolean(), computer: z.boolean(),
  browser: z.boolean().nullish(),
  os: z.string(), arch: z.string(), roots: z.array(z.string()),
  commands_isolated: z.boolean().nullish(), browser_isolated: z.boolean(),
  computer_ready: z.boolean(), saved_login_ready: z.boolean(),
  installation: z.string().optional(),
});
export const machineNodeSchema = z.object({
  id: z.string().min(1), name: z.string(),
  owner: z.object({ id: z.string(), kind: z.enum(["user", "org"]), display_name: z.string() }),
  status: z.string(), is_connected: z.boolean(),
  machine: machineProfileSchema.nullish(),
  machine_confirm: z.enum(["none", "changes", "all"]).default("none"),
  allow_single_user_saved_logins: z.boolean().default(false),
  metadata: z.object({ agent_version: z.string().nullish(), provisioning_source: z.string().nullish() }).nullish(),
});
export const machineOrgSchema = z.object({ id: z.string(), your_role: z.string() });
export const machineUpdateSchema = z.object({
  node_id: z.string(), current_version: z.string(), target_version: z.string(),
  update_available: z.boolean(), updater_ready: z.boolean(), automatic: z.boolean(),
  installation: z.string(), phase: z.string(), code: z.string().nullish(),
  guidance: z.string().nullish(), updater_guidance: z.string().nullish(), settings_path: z.string(),
});
export type MachineNode = z.infer<typeof machineNodeSchema>;
export type MachineUpdate = z.infer<typeof machineUpdateSchema>;
export type MachineInventory = {
  nodes: MachineNode[];
  updates: MachineUpdate[];
  userId: string;
  features: string[];
};

export function manageableMachines(
  nodes: MachineNode[], orgs: z.infer<typeof machineOrgSchema>[],
  hostedIds: ReadonlySet<string>, userId: string,
) {
  const admins = new Set(orgs.filter((org) => org.your_role === "admin").map((org) => org.id));
  return nodes.filter((node) => node.machine &&
    node.metadata?.provisioning_source !== "remote_machine" && !hostedIds.has(node.id) &&
    ((node.owner.kind === "user" && node.owner.id === userId) ||
      (node.owner.kind === "org" && admins.has(node.owner.id))));
}

export function machineWebPath(machine?: string, tab?: "logins") {
  const query = new URLSearchParams();
  if (machine) query.set("machine", machine);
  if (tab) query.set("tab", tab);
  return `/assistant/machines${query.size ? `?${query}` : ""}`;
}

export const SINGLE_USER_SHELL_WARNING = "Not isolated: agent commands can read this node's stored credentials, signing secret and node token, including its config and local credential store. File-tool workspace limits do not constrain the shell. You may proceed; prefer the machine container or a VM set up with --separate-users.";
