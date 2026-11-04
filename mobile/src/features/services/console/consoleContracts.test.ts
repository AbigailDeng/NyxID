import assert from "node:assert/strict";
import test from "node:test";
import {
  advancedConnectionDestinations,
  consoleDestinations,
  consoleWebUrl,
} from "./consoleDestinations";
import {
  checksFromDraft,
  displayedMonitoringStatus,
  draftFromConfiguration,
  safeMonitoringPath,
  type MonitoringCheckResult,
} from "./monitoringContracts";
import { consoleOrgSchema } from "./consoleTransport";

const now = Date.parse("2026-11-03T12:00:00Z");
export const check: MonitoringCheckResult = {
  status: "healthy",
  source: "owner",
  path: "healthz",
  reason: "",
  checked_at: new Date(now - 10_000).toISOString(),
  stale_at: new Date(now + 20_000).toISOString(),
  duration_ms: 3,
  status_code: 200,
  freshness: "fresh",
};

test("status expires locally; stale, invalid, missing and future evidence stay unknown", () => {
  assert.equal(displayedMonitoringStatus(check, now), "healthy");
  assert.equal(displayedMonitoringStatus(check, now + 20_000), "unknown");
  for (const patch of [
    { freshness: "stale" },
    { checked_at: null },
    { checked_at: "invalid" },
    { stale_at: null },
    { checked_at: new Date(now + 1).toISOString() },
    { reason: "no_health_path" },
    { stale_at: check.checked_at },
  ]) {
    assert.equal(
      displayedMonitoringStatus(
        { ...check, ...patch } as MonitoringCheckResult,
        now,
      ),
      "unknown",
    );
  }
});

test("missing readiness stays unknown; only explicit server evidence means not configured", () => {
  assert.equal(displayedMonitoringStatus(null, now), "unknown");
  assert.equal(
    displayedMonitoringStatus(
      {
        ...check,
        status: "unknown",
        checked_at: null,
        stale_at: null,
        freshness: "unknown",
      },
      now,
    ),
    "unknown",
  );
  assert.equal(
    displayedMonitoringStatus(
      {
        ...check,
        status: "not_configured",
        checked_at: null,
        stale_at: null,
        freshness: "unknown",
      },
      now,
    ),
    "not_configured",
  );
});

test("monitoring paths cannot become URLs, traversals or operations through encoding", () => {
  for (const path of [
    "/healthz",
    "https://service/health",
    "health?secret=x",
    "health#fragment",
    "../health",
    "v1/RUN",
    "v1/%65xecute",
    "%252e%252e/health",
    "%2Fhealth",
    "health%3Ftoken",
    "health%20x",
    "health%5Cx",
    "x%",
    "a".repeat(513),
  ])
    assert.equal(safeMonitoringPath(path), false, path);
  for (const path of ["healthz", "api/v1/ready", "ping-status"])
    assert.equal(safeMonitoringPath(path), true, path);
});

test("configuration enforces status cardinality and UTF-8 body limits; disabling clears overrides", () => {
  const draft = draftFromConfiguration({
    user_service_id: "s",
    revision: 5,
    owner_config: {
      health: { path: "healthz", expect_status: [200, 204] },
      readiness: null,
    },
  });
  assert.deepEqual(checksFromDraft(draft), {
    health: { path: "healthz", expect_status: [200, 204] },
    readiness: null,
  });
  for (const statuses of [
    "200,200",
    "99",
    "600",
    "200,",
    "200,201,202,203,204,205,206,207,208",
  ])
    assert.throws(() =>
      checksFromDraft({ ...draft, health: { ...draft.health, statuses } }),
    );
  assert.throws(() =>
    checksFromDraft({
      ...draft,
      health: { ...draft.health, body: "测".repeat(342) },
    }),
  );
  assert.equal(
    checksFromDraft({
      ...draft,
      health: { ...draft.health, body: "测".repeat(341) },
    }).health?.body_contains?.length,
    341,
  );
  assert.equal(
    checksFromDraft({
      ...draft,
      health: { ...draft.health, enabled: false, path: "bad?path" },
    }).health,
    null,
  );
});

test("console links honor live roles, manager capabilities and exact organization administration", () => {
  const orgs = [
    { id: "a/b", display_name: "Admin Org", your_role: "admin" },
    { id: "member", display_name: "Member Org", your_role: "member" },
  ];
  const basic = consoleDestinations({ id: "u", is_admin: false }, orgs);
  assert(basic.some((x) => x.path === "/keys?tab=pools"));
  assert(basic.some((x) => x.path === "/orgs/a%2Fb?tab=service-accounts"));
  assert(!basic.some((x) => x.path.startsWith("/orgs/member")));
  assert(
    !basic.some((x) => x.path.startsWith("/admin") || x.path === "/providers"),
  );
  const manager = consoleDestinations(
    {
      id: "u",
      is_admin: false,
      capabilities: {
        manage_catalog: true,
        manage_tools: true,
        read_admin_usage: true,
      },
    },
    [],
  );
  assert(manager.some((x) => x.path === "/providers"));
  assert(manager.some((x) => x.path === "/admin/tools"));
  assert(manager.some((x) => x.path === "/admin/usage"));
  assert(!manager.some((x) => x.path === "/admin/users"));
  const operator = consoleDestinations(
    { id: "u", is_admin: false, is_operator: true },
    [],
  );
  assert(
    operator.some(
      (x) => x.path === "/admin/users" && x.description.includes("read-only"),
    ),
  );
  assert(!operator.some((x) => x.path === "/providers"));
  const unnamed = consoleOrgSchema.parse({
    id: "org",
    slug: "work-team",
    display_name: null,
    your_role: "admin",
  });
  assert(
    consoleDestinations({ id: "u", is_admin: false }, [unnamed]).some(
      (x) => x.label === "work-team · Service Accounts",
    ),
  );
});

test("advanced links retain exact connection ID, readonly view and SSH identity", () => {
  const connection = {
    id: "connection/id",
    service_type: "ssh",
    catalog_service_id: "catalog/id",
    ssh_ca_public_key: "public-key",
    is_active: true,
  } as Parameters<typeof advancedConnectionDestinations>[0];
  const editable = advancedConnectionDestinations(connection, true);
  assert(editable.some((x) => x.path === "/keys/connection%2Fid?tab=advanced"));
  assert(
    editable.some(
      (x) =>
        x.path === "/ssh/catalog%2Fid/terminal?returnKeyId=connection%2Fid",
    ),
  );
  assert(
    !editable.some((x) => /OpenAPI|Headers|WebSocket|skills/.test(x.label)),
  );
  const readonly = advancedConnectionDestinations(
    { ...connection, service_type: "http" },
    false,
  );
  assert(
    readonly.every((x) => x.path === "/keys/connection%2Fid?tab=advanced"),
  );
  const platform = advancedConnectionDestinations(
    { ...connection, credential_binding: "platform" },
    false,
  );
  assert(platform.some((x) => x.path === "/keys/connection%2Fid?tab=overview"));
  assert(
    !advancedConnectionDestinations(
      { ...connection, ssh_ca_public_key: null },
      true,
    ).some((x) => x.label === "SSH terminal"),
  );
  assert.equal(
    consoleWebUrl("https://nyxid.example/subpath", editable[0]!.path),
    "https://nyxid.example/keys/connection%2Fid?tab=advanced",
  );
  for (const [origin, path] of [
    ["http://nyxid.example", "/keys"],
    ["https://name:secret@nyxid.example", "/keys"],
    ["https://nyxid.example", "//evil.example/keys"],
    ["https://nyxid.example", "https://evil.example"],
  ])
    assert.throws(() => consoleWebUrl(origin!, path!));
});
