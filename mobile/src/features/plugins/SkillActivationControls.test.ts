import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hookHarness, deferred } from "../assistant/assistantHookTestHarness";
import * as skillTypes from "./pluginSkillsTypes";

type E = { type: any; props: any };
const nodes = (n: any): E[] =>
  n?.props ? [n, ...[n.props.children].flat(Infinity).flatMap(nodes)] : [];
const current = skillTypes.agentSkillsSchema.parse({
  agent_id: "agent-a",
  revision: 7,
  skills: [
    {
      source: "ornn",
      skill_id: "skill-a",
      name: "A",
      version: "1.0",
      sha256: "sha",
      custom_activation: "preserve",
    },
    {
      source: "ornn",
      skill_id: "sibling",
      name: "Sibling",
      version: "2.0",
      sha256: "other",
      future: "preserve",
    },
  ],
  metadata: { "skill-a": { description: "", size_bytes: 100 } },
});
function setup() {
  let epoch = 1;
  let canMaintain = true;
  let latest: () => Promise<skillTypes.AgentSkills> = async () => current;
  const writes: any[] = [];
  let refreshed = 0;
  const h = hookHarness<E>({
    "react/jsx-runtime": {
      jsx: (type: any, props: any) => ({ type, props }),
      jsxs: (type: any, props: any) => ({ type, props }),
      Fragment: "Fragment",
    },
    "../../components/workspace/WorkspaceUI": Object.fromEntries(
      ["ActionButton", "Card", "Field", "Label", "Notice"].map((name) => [
        name,
        name,
      ]),
    ),
    "../../lib/auth/authEpoch": { getAuthEpoch: () => epoch },
    "../../lib/api/pluginSkillsApi": {
      pluginSkillsApi: {
        current: () => latest(),
        write: async (...args: any[]) => {
          args[2]();
          writes.push({ kind: "activation", args });
        },
        preload: async (...args: any[]) => {
          args[3]();
          writes.push({ kind: "preload", args });
        },
      },
    },
    "../../lib/api/agentsApi": {
      agentsApi: {
        detail: async () => ({
          agent: { status: "idle", can_maintain: canMaintain },
        }),
      },
    },
    "../automations/AutomationUI": {
      automationError: (cause: any) => cause.message,
      automationStyles: {},
      useAutomationRuntime: () => ({ active: true, online: true }),
    },
    "./pluginSkillsTypes": skillTypes,
  });
  const Component = h.load(
    fileURLToPath(new URL("./SkillActivationControls.tsx", import.meta.url)),
  ).SkillActivationControls as any;
  const onDirty = () => {};
  h.mount(() =>
    Component({
      agentId: "agent-a",
      pin: current.skills[0],
      current,
      disabled: false,
      onRefresh: async () => {
        refreshed++;
      },
      onBusy() {},
      onDirty,
    }),
  );
  const control = (label: string) =>
    nodes(h.value()).find((n) => n.props.label === label)!;
  return {
    h,
    writes,
    control,
    refreshed: () => refreshed,
    latest: (read: typeof latest) => {
      latest = read;
    },
    revoke: () => {
      canMaintain = false;
    },
    switchAccount: () => {
      epoch++;
    },
  };
}

test("native activation toggles just the selected pin and preserves sibling/exact package metadata", async () => {
  const x = setup();
  x.control("Disable skill").props.onPress();
  await x.h.settle();
  assert.equal(x.writes.length, 1);
  const body = x.writes[0].args[1];
  assert.equal(body.expected_revision, 7);
  assert.equal(body.skills[0].disabled, true);
  assert.equal(body.skills[0].custom_activation, "preserve");
  assert.deepEqual(body.skills[1], current.skills[1]);
  assert.equal(x.refreshed(), 1);
  x.h.unmount();
});

test("preload validates paths and sends revision-fenced selection; backend still enforces bytes/files", async () => {
  const x = setup();
  x.control("Preload file paths").props.onChangeText("references/a.md");
  x.h.flush();
  assert.equal(x.control("Save preload").props.disabled, true);
  x.control("Preload file paths").props.onChangeText(
    "SKILL.md\nreferences/a.md",
  );
  x.h.flush();
  x.control("Save preload").props.onPress();
  await x.h.settle();
  assert.equal(x.writes[0].kind, "preload");
  assert.deepEqual(JSON.parse(JSON.stringify(x.writes[0].args[2])), {
    expected_revision: 7,
    paths: ["SKILL.md", "references/a.md"],
  });
  for (const invalid of [
    "SKILL.md\n../secret.md",
    "SKILL.md\nSKILL.md",
    "SKILL.md\nfile.js",
  ])
    assert.throws(() => skillTypes.skillPreloadPaths(invalid));
  x.h.unmount();
});

test("revision drift, lost maintenance and late account change prevent activation writes", async () => {
  for (const reason of ["revision", "maintenance", "account"] as const) {
    const x = setup();
    const read = deferred<skillTypes.AgentSkills>();
    if (reason === "revision")
      x.latest(async () => ({ ...current, revision: 8 }));
    if (reason === "maintenance") x.revoke();
    if (reason === "account") x.latest(() => read.promise);
    x.control("Disable skill").props.onPress();
    if (reason === "account") {
      x.switchAccount();
      read.resolve(current);
    }
    await x.h.settle();
    assert.equal(x.writes.length, 0, reason);
    x.h.unmount();
  }
});
