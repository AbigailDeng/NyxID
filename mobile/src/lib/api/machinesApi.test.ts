import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hookHarness } from "../../features/assistant/assistantHookTestHarness";
import * as contracts from "../../features/machines/machineContracts";

function setup(pages: unknown[]) {
  const paths: string[] = [];
  const harness = hookHarness({
    "./http": { requestJson: async (path: string) => { paths.push(path); return pages.shift(); } },
    "../../features/machines/machineContracts": contracts,
  });
  const api = harness.load(fileURLToPath(new URL("./machinesApi.ts", import.meta.url)));
  return { ...api, paths };
}
test("hosted discovery reads every cursor before returning excluded node IDs", async () => {
  const api = setup([{ machines: [{ node_id: "a" }], next_cursor: "next&cursor" }, { machines: [{ node_id: "b" }], next_cursor: null }]);
  assert.deepEqual(Array.from(await api.readHostedMachineIds()), ["a", "b"]);
  assert.ok(api.paths[1].includes("cursor=next%26cursor"));
});
test("partial or looping hosted discovery cannot expose management controls", async () => {
  for (const pages of [
    [{ machines: [], next_cursor: undefined }],
    [{ machines: [], next_cursor: "loop" }, { machines: [], next_cursor: "loop" }],
  ]) {
    await assert.rejects(setup(pages).readHostedMachineIds());
  }
});
