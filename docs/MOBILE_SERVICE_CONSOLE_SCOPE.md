# Mobile service and developer console scope

Tracking: [personal issue #12](https://github.com/AbigailDeng/NyxID/issues/12). Baseline: `dc46415065fac9e80200d0711b729db7f8c7d2c8`. This change provides native monitoring and deliberate resource-specific Web handoffs; it does not implement an entire mobile admin console.

Ordinary app entry: **Plugins → Connectors → Service & developer console → Show developer console**. This opens the existing Services root; no external deep link is required. Selected connection management remains available from the connector list.

## Delivery decisions

| Capability | Delivery and entry | Authority / behavior |
| --- | --- | --- |
| Health/readiness observations | Native: Services → an HTTP connection → Overview | Requires live `services:monitoring` on `/users/me`; restricted org connections have no card. Reads and Refresh only observe. Backend `monitoring_not_configured` hides the card. Failed/missing/stale/future/expired evidence never shows healthy. Null readiness is Unknown; only an explicit server result means Not configured. |
| Check now | Native, explicit action in the monitoring card | Re-reads identity, flag and exact-service `can_probe` immediately before execution. May invoke ordinary approvals or bill a priced service; the UI says so. No polling. |
| Monitoring configure/test/save/clear | Native, current `can_manage`; Test also requires `can_probe` | Safe relative GET paths, 1–8 unique HTTP status codes, 1,024-byte UTF-8 body expectations. Save/clear preserve reviewed revision and refuse drift; HTTP 409 requires reload/review. Clear removes owner overrides and allows built-in fallback. Draft tests never save. |
| Endpoint/OpenAPI; routing/credential Node; headers/User-Agent; WS injection; skills; ownership/permissions | Web: individual entries in the selected connection’s Advanced tab | Every link preserves connection ID. Ordinary read-only connections retain the read-only Web Advanced view; auto/platform-managed connections go to their valid Overview. Re-reads the connection before opening. SSH shows only applicable SSH/routing/ownership entries. |
| Organization/custom/special connection creation | Web: Services → Show developer console → Organization or custom connection | `/keys?tab=services&action=add-service`; Web chooses owner/type and enforces permissions. Existing native personal catalog creation/OAuth recovery is preserved. |
| Agent Keys | Web: Developer console → Agent Keys | `/keys?tab=nyxid` owns rename, scopes, rotation/revocation, service/operation/node/machine grants, limits and usage. Native login key selection/new key/one-time-code flows remain unchanged. |
| Service Pools | Web: Developer console → Service Pools | `/keys?tab=pools`; routing/weights/retries/health/reset stay in Web. |
| Tools directory and operations | Web: Developer console → Tools directory | `/tools`; discovery, operation method/path/risk/prices/limits and Use with my AIs remain in Web. Tools Manager appears only for admin or the live manager capability. |
| Credential Nodes | Web: Developer console → Credential Nodes | `/nodes`; registration/token/signing-secret rotation, ownership, credential push/queues/metrics remain in Web. Existing self-hosted machine policy/activity/Desktop remain in Machines. |
| SSH | Web: selected eligible SSH connection → Advanced → SSH terminal | Uses the catalog service ID, preserves return connection ID, requires known CA metadata and usable org access. SSH setup/connection validation remains a manual acceptance item linked below. App Terminal is CLI login-code creation, not an SSH terminal. |
| Personal Developer OAuth Apps | Web: Developer console → Developer OAuth Apps | `/developer/apps`; OAuth client configuration and client secrets stay in Web. |
| Organization Service Accounts / Developer Apps | Web: two entries for each current owner/admin organization | `/orgs/{orgId}?tab=service-accounts` and `?tab=developer-apps`; current organization role is re-read before opening. Null organization display names fall back to slug/ID. Member/viewer accounts get no management entry. |
| Catalog / Providers | Web: capability-gated Developer console entries | `/services`, `/providers`; admin or `manage_catalog`. Authoring is deliberately retained in Web. |
| Admin domains | Web: Admin console, Admin usage, Feature flags | Admin/Operator console access matches Web; individual usage/flag readers get only their authorized entry. Web controls fine-grained writes, credits/billing/integrity, audit, users/roles/groups/service accounts/OAuth clients/ownership/nodes/invites/platform credentials/retention. No native admin CRUD is promised. |
| Dashboard, Docs, Blog, MCP/CLI guides | Minimal Web entry in Developer console | `/dashboard`, `/docs`, `/blog`. Native workspace remains chat-first. Embedded content readers and duplicate metric/admin screens are deferred. |

## Lifecycle and safety

All monitoring queries are account/connection scoped and discarded when unobserved. The display clock expires badges locally without fetching or executing probes. Manual results are in-memory only and expire after at most 60 seconds.

Monitoring writes lock parent Back/tab/connection actions. Parent connection actions and monitoring use independent locks so one cannot release the other. Unsaved monitoring configuration requires an explicit discard decision before switching tabs. Backgrounding synchronously invalidates captured request authority; returning to foreground cannot revive a preflight from the previous activation. Unknown outcomes remain fenced in the query cache until an explicit successful observation refresh, including after unmount/remount. No automatic retries run a probe or write.

Web URLs come from fixed local routes plus encoded resource IDs under the configured HTTPS frontend origin. No mobile token or credential is handed to the browser. Before opening privileged entries the app re-reads account/org/connection authority. A normal browser handoff may background the app: return refresh is queued for the same mounted foreground account without reusing the old preflight generation. The UI accurately says a refresh was requested, and requires reviewing server state to confirm changes; closing the browser never proves success.

## Verification and remaining acceptance

Focused model/transport/screen tests cover status expiry, encoded unsafe paths, byte/status bounds, missing feature/backend setup, identity/service mismatches, permission revocation, revision drift, uncertain failures, duplicate actions, parent locks, synchronous AppState transitions, browser return refresh and account changes.

The [2026-11-04 review and acceptance record](MOBILE_SERVICE_CONSOLE_ACCEPTANCE.md) records the two repaired defects, 72 passing related tests, and the simulator walkthrough. Runtime evidence includes real monitoring reads, local invalid-path rejection, draft guards, ordinary console navigation, and opening the first-party Web sign-in page. Web return refresh is covered by component tests but was not confirmed in this simulator session because its browser dismissal control was unavailable to the UI automation tool.

Pending device/backend acceptance (not claimed complete):

- Flag off/on and a configured chrono-probe deployment; fresh/stale/missing observations on iPhone.
- Explicit Check now/Test draft with real approval/billing behavior; save/clear and a concurrent Web editor conflict.
- App backgrounding during preflight and after dispatched mutations; return/reload and draft discard UX.
- Native OAuth repair, personal catalog creation and resource-specific Web handoff with separate browser login.
- Ordinary org member/viewer versus org admin, platform connection, catalog/tool manager and Operator entries.
- Real SSH connection/principal and terminal authorization: [existing integration/device issue #1868](https://github.com/ChronoAIProject/NyxID/issues/1868).

No live configuration, secrets, keys, paid resources or real provider probes were changed for local verification. Full frontend/mobile suite, typecheck and build are delegated to GitHub CI by the personal delivery policy.
