import assert from "node:assert/strict";
import test from "node:test";
import {
  assistantSettingsSchema,
  managementUrl,
  settingsForm,
  settingsPatch,
} from "./managementContracts";
import { createAssistantManagementApi } from "../../lib/api/assistantManagementTransport";
import { parseAutomationSearch } from "../../../../frontend/src/lib/automation-search";

const settings = assistantSettingsSchema.parse({
  max_live_subagents: 3,
  max_concurrent_subagent_turns: 2,
  max_live_subagents_limit: 8,
  max_concurrent_subagent_turns_limit: 4,
});

test("dirty settings patch preserves unrelated voice/access settings and respects fresh ceilings", () => {
  const baseline = settingsForm(settings, "UTC");
  assert.deepEqual(settingsPatch(baseline, baseline, settings), {});
  assert.deepEqual(
    settingsPatch(
      { ...baseline, max_live_subagents: "5", timezone: "Asia/Shanghai" },
      baseline,
      settings,
    ),
    { max_live_subagents: 5, timezone: "Asia/Shanghai" },
  );
  assert.throws(
    () =>
      settingsPatch({ ...baseline, max_live_subagents: "5" }, baseline, {
        ...settings,
        max_live_subagents_limit: 4,
      }),
    /0 to 4/,
  );
  for (const value of ["", "-1", "1.5", "Infinity", "99999999999999999999"])
    assert.throws(
      () =>
        settingsPatch(
          { ...baseline, trigger_runs_per_hour: value },
          baseline,
          settings,
        ),
      /whole number/,
    );
  assert.throws(
    () =>
      settingsPatch(
        { ...baseline, timezone: "wrong/zone" },
        baseline,
        settings,
      ),
    /IANA/,
  );
  assert.deepEqual(
    settingsPatch(
      { ...baseline, max_auto_continuations: "0", max_group_handoffs: "0" },
      baseline,
      settings,
    ),
    { max_auto_continuations: 0, max_group_handoffs: 0 },
  );
});

test("Web handoffs retain exact automation, setup, agent and real bot identity without secrets", () => {
  const id = "a91c328b-0acd-4d91-9c99-b45e7f328e8c";
  assert.equal(
    managementUrl("https://nyx.example/base?token=secret", {
      kind: "automations",
      agentId: "agent-a",
      automationId: id,
    }),
    `https://nyx.example/assistant/automations?agent=agent-a&automation=${id}`,
  );
  assert.equal(
    managementUrl("https://nyx.example", {
      kind: "automations",
      setupId: id,
      create: true,
    }),
    `https://nyx.example/assistant/automations?setup=${id}`,
  );
  assert.equal(
    managementUrl("https://nyx.example", {
      kind: "skills",
      agentId: "agent-a",
    }),
    "https://nyx.example/assistant?agent=agent-a&details=skills",
  );
  assert.equal(
    managementUrl("https://nyx.example", { kind: "bots", botId: "bot-id" }),
    "https://nyx.example/channel-bots/bot-id",
  );
  assert.equal(
    managementUrl("https://nyx.example", { kind: "personal-binding" }),
    "https://nyx.example/assistant?panel=nyxbot",
  );
  for (const base of [
    "http://nyx.example",
    "https://user:pass@nyx.example",
    "broken",
  ])
    assert.throws(() => managementUrl(base, { kind: "channels" }));
  assert.throws(() =>
    managementUrl("https://nyx.example", {
      kind: "automations",
      automationId: "wrong",
    }),
  );
});

test("native handoff round-trips through the actual Web route search parser", () => {
  const id = "a91c328b-0acd-4d91-9c99-b45e7f328e8c";
  const href = managementUrl("https://nyx.example", {
    kind: "automations",
    automationId: id,
    agentId: "agent-a",
  });
  assert.deepEqual(
    parseAutomationSearch(Object.fromEntries(new URL(href).searchParams)),
    { automation: id, agent: "agent-a" },
  );
  assert.deepEqual(
    parseAutomationSearch({
      create: "true",
      automation: "wrong",
      token: "secret",
    }),
    { create: true },
  );
});

test("settings transport uses guarded non-replayed PUT and distinguishes bot id from channel agent id", async () => {
  const calls: any[] = [];
  const api = createAssistantManagementApi(async (path, options) => {
    calls.push({ path, options });
    return path.endsWith("/channels")
      ? {
          channel_agents: [
            {
              id: "channel-agent-id",
              channel_bot_id: "actual-bot-id",
              platform: "telegram",
              bot_label: "Support",
              status: "active",
              owner_linked: false,
            },
          ],
        }
      : settings;
  });
  let guards = 0;
  const guard = () => {
    guards++;
  };
  await api.update({ max_live_subagents: 4 }, guard);
  assert.equal(guards, 1);
  assert.equal(calls[0].path, "/assistant/nyxagent/settings");
  assert.equal(calls[0].options.method, "PUT");
  assert.equal(calls[0].options.authorityGuard, guard);
  assert.equal(calls[0].options.retryOnAuthFailure, false);
  assert.deepEqual(calls[0].options.body, { max_live_subagents: 4 });
  const rows = await api.channels();
  assert.equal(rows[0].channel_bot_id, "actual-bot-id");
  assert.equal(rows[0].id, "channel-agent-id");
  assert.equal(calls[1].options.method, undefined);
});
