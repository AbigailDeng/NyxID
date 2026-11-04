import assert from "node:assert/strict";
import test from "node:test";
import { createHostedMachinesApi } from "./hostedMachineTransport";

const machine = {
  node_id: "hosted",
  name: "test-machine",
  resource_state: "paused",
  billing_state: "ready",
  authorization_state: "active",
  cleanup_state: "pending",
  active_operation_id: null,
  updated_at: "2026-11-03T00:00:00Z",
  bootstrap_token: "must-not-cache",
};
test("hosted inventory remains metadata-only and follows every page without hiding hosted machines", async () => {
  const paths: string[] = [];
  const result = await createHostedMachinesApi(async (path) => {
    paths.push(path);
    return paths.length === 1
      ? { machines: [machine], next_cursor: "next&page" }
      : { machines: [{ ...machine, node_id: "second" }], next_cursor: null };
  }).inventory();
  assert.deepEqual(
    result.map((row) => row.node_id),
    ["hosted", "second"],
  );
  assert.equal("bootstrap_token" in result[0]!, false);
  assert.match(paths[1]!, /cursor=next%26page/);
});
test("partial or repeated hosted pagination fails instead of declaring the inventory complete", async () => {
  await assert.rejects(
    createHostedMachinesApi(async () => ({
      machines: [machine],
      next_cursor: "loop",
    })).inventory(),
    /incomplete/,
  );
  await assert.rejects(
    createHostedMachinesApi(async () => ({ machines: [machine] })).inventory(),
  );
});
