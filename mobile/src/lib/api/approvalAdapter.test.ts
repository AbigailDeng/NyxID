import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mapBackendRequestToChallenge,
  type BackendApprovalRequestItem,
} from "./approvalAdapter";
import { getChallengeActionState } from "../../features/activity/challengeUiState";

const fixture: BackendApprovalRequestItem = {
  id: "req",
  service_name: "GitHub",
  service_slug: "api-github",
  requester_type: "agent_key",
  requester_label: "Research agent",
  operation_summary: "POST /repos/read",
  http_method: "POST",
  resource: "repository:NyxID",
  verb: "read",
  approval_mode: "per_request",
  status: "pending",
  created_at: "2026-10-13T00:00:00Z",
  expires_at: "2026-10-13T00:02:00Z",
};

test("actual two-minute expiration is preserved and disables a stale pending decision", () => {
  const detail = mapBackendRequestToChallenge(fixture);
  assert.equal(detail.expires_at, fixture.expires_at);
  assert.equal(
    getChallengeActionState({
      ...detail,
      expires_at: new Date(Date.now() - 1).toISOString(),
    }).canDecide,
    false,
  );
});
test("tool metadata has priority over HTTP method and read POST is not marked write", () => {
  const detail = mapBackendRequestToChallenge({
    ...fixture,
    tool_name: "search_repositories",
    tool_arguments: '{"query":"nyxid"}',
  });
  assert.equal(detail.action, "search_repositories");
  assert.equal(detail.risk_level, "low");
  assert.equal(detail.resource, "repository:NyxID");
  assert.equal(detail.tool_arguments, '{"query":"nyxid"}');
  assert.equal(detail.request_context.requester, "Research agent");
  assert.equal("location" in detail.request_context, false);
});
test("explicit destructive tool is high risk even when carried by GET", () => {
  const detail = mapBackendRequestToChallenge({
    ...fixture,
    http_method: "GET",
    is_destructive: true,
  });
  assert.equal(detail.risk_level, "high");
});
test("missing expiry fails closed and missing semantic metadata stays unknown", () => {
  const detail = mapBackendRequestToChallenge({
    ...fixture,
    expires_at: undefined,
    verb: undefined,
  });
  assert.equal(detail.expires_at, "");
  assert.equal(detail.risk_level, "unknown");
  assert.equal(getChallengeActionState(detail).canDecide, false);
});
test("only authoritative org policy flag exposes org context", () => {
  assert.equal(
    mapBackendRequestToChallenge({ ...fixture, org_id: "org" }).org_id,
    undefined,
  );
  assert.equal(
    mapBackendRequestToChallenge({
      ...fixture,
      from_org_policy: true,
      org_id: "org",
    }).org_id,
    "org",
  );
});
