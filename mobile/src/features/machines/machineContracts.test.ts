import assert from "node:assert/strict";
import test from "node:test";
import { machineNodeSchema, manageableMachines, machineWebPath } from "./machineContracts";

const node = (id: string, kind = "user", owner = "me", source?: string) => machineNodeSchema.parse({
  id, name: id, owner: { kind, id: owner, display_name: owner }, status: "active", is_connected: true,
  metadata: { provisioning_source: source },
  machine: { version: 2, shell: true, files: true, computer: false, os: "linux", arch: "arm64", roots: ["/workspace"], browser_isolated: true, computer_ready: false, saved_login_ready: false },
});
test("inventory includes personal and org Admin only and excludes hosted by either marker", () => {
  const nodes = [node("personal"), node("other", "user", "other"), node("admin", "org", "oa"), node("member", "org", "om"), node("viewer", "org", "ov"), node("managed", "user", "me", "remote_machine"), node("hosted"), node("no-machine")];
  nodes.at(-1)!.machine = null;
  const orgs = [{ id: "oa", your_role: "admin" }, { id: "om", your_role: "member" }, { id: "ov", your_role: "viewer" }];
  assert.deepEqual(manageableMachines(nodes, orgs, new Set(["hosted"]), "me").map((row) => row.id), ["personal", "admin"]);
  assert.deepEqual(manageableMachines(nodes.slice(2, 3), [], new Set(), "me"), [], "removed membership");
  assert.deepEqual(manageableMachines(nodes.slice(0, 1), [], new Set(), "other"), [], "transferred machine");
});
test("canonical machine handoffs encode IDs and select saved logins", () => {
  assert.equal(machineWebPath(), "/assistant/machines");
  assert.equal(machineWebPath("a&tab=logins"), "/assistant/machines?machine=a%26tab%3Dlogins");
  assert.equal(machineWebPath(undefined, "logins"), "/assistant/machines?tab=logins");
});
