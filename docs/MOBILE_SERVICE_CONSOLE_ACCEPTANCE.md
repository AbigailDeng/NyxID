# Review Summary

Overall:
PASS (source review and the limited simulator walkthrough below; complete device/backend acceptance is still outstanding).

## Problem and Expected Behavior

Personal [PR #17](https://github.com/AbigailDeng/NyxID/pull/17) addresses [issue #12](https://github.com/AbigailDeng/NyxID/issues/12): decide mobile/Web scope, implement native service monitoring, and provide discoverable, permission-consistent handoffs for retained Web workflows. It does not promise native admin parity. See [the delivery matrix](MOBILE_SERVICE_CONSOLE_SCOPE.md).

Review date: 2026-11-04. Reviewed starting head: `c5054e58c4ae4312d578987ceac5619992c740be`; base: personal `codex/mobile-ios-integration` at `dc46415065fac9e80200d0711b729db7f8c7d2c8`. Requirements came from issue #12, base service/navigation code, `SERVICE_MONITORING.md`, backend monitoring responses and existing Web monitoring tests. The PR description exposed implementation claims before the outline, so this was not a blind review. The independent outline was recorded before reading the implementation diff and new tests.

## Independent Implementation Outline

1. Reuse the first-party request client with exact service identity, separating observation GETs from explicit probe/validate and revision-fenced writes; prohibit automatic execution replay.
2. Gate monitoring by live feature/account/view authority. Keep missing, invalid and expired observations Unknown; explicit actions alone execute probes.
3. Validate bounded drafts, preserve reviewed revisions, protect dirty/busy connection navigation, and invalidate old authority permanently after lifecycle changes.
4. Reuse fixed HTTPS Web destinations with resource identity, current role checks and refresh-on-return; preserve native OAuth and login-code flows.
5. Verify production components and transport with related tests, then walk safe simulator flows without paid probes, live writes or real SSH execution.

## Comparison with the PR

The implementation follows the scoped native/Web split. Independent security, correctness, maintainability and test reviews found two confirmed defects, both repaired in this acceptance follow-up:

- **Absent readiness evidence looked unconfigured.** `displayedMonitoringStatus(null)` returned `not_configured`, although null cannot establish configuration absence, particularly for read-only users. It now returns `unknown`, while preserving explicit `not_configured` evidence. Contract and actual `CheckSummary` rendering regressions cover configured-but-unobserved and read-only cases. The two new regressions failed before the fix and passed afterward.
- **The general console had no ordinary navigation entry.** The existing sidebar leads to Plugins; individual connections open a selected Services detail, bypassing the root console card. Plugins Connectors now exposes a secondary `Service & developer console` entry that navigates to the existing Services root. It performs no probe, write or browser action. Production-component tests verify the exact route and absence from Skills/connection-selection subviews. Both new regressions failed before the fix and passed afterward; the entry was also exercised in the simulator.

The combined repairs received an independent final security/navigation review with no new verified finding. No Web source, backend source, CI routing or dependency manifest changed during acceptance.

## P0

None remaining after the repairs.

## P1

None remaining after the repairs.

## P2

None.

## Nit

None.

## Potential Concerns

No speculative code finding is being treated as a blocker. The following are unverified acceptance boundaries, not claims of a product defect:

- Real Check now/Test draft approval and billing; valid save/clear; concurrent Web revision conflict and recovery.
- Actual iPhone lifecycle behavior during preflight/dispatched operations, plus browser return refresh. The component harness covers these transitions but does not replace device evidence.
- Organization member/admin, catalog/tool manager and Operator accounts; real OAuth recovery and resource-specific Web editing; SSH principal/authorization on a real connection.
- The test harness verifies status-aging calculations, but stubs timers and therefore does not establish mounted real-time expiry behavior on a device.

## Merge Recommendation

Ready to Merge from the source-review perspective. This is not a claim that every device/backend acceptance scenario has passed. PR #17 remains open and issue #12 remains open for the acceptance boundaries above; this review did not merge or close either resource.

## Focused local verification

All eight directly related test files passed, **72 tests, 0 failed, 0 skipped**:

```sh
cd mobile
pnpm exec tsx --test src/features/plugins/PluginsScreen.test.ts src/features/services/console/consoleContracts.test.ts src/features/services/console/consoleTransport.test.ts src/features/services/console/ServiceMonitoringCard.test.ts src/features/services/console/ConsoleManagement.test.ts src/features/services/ServicesScreen.test.ts src/features/services/serviceContracts.test.ts src/features/services/connectionPresentation.test.ts
```

Scope analyzer:

```sh
python3 /Users/abigaildeng/.codex/skills/frontend-incremental-pr/scripts/frontend_change_scope.py --repo . --base dc46415065fac9e80200d0711b729db7f8c7d2c8
```

The original 14 PR TypeScript files passed the following changed-file formatting check after the readiness repair:

```sh
/Users/abigaildeng/Documents/work/NyxID/frontend/node_modules/.bin/prettier --check mobile/src/features/services/ServicesScreen.test.ts mobile/src/features/services/ServicesScreen.tsx mobile/src/features/services/console/ConsoleManagement.test.ts mobile/src/features/services/console/ConsoleManagement.tsx mobile/src/features/services/console/ServiceMonitoringCard.test.ts mobile/src/features/services/console/ServiceMonitoringCard.tsx mobile/src/features/services/console/consoleActivation.ts mobile/src/features/services/console/consoleApi.ts mobile/src/features/services/console/consoleContracts.test.ts mobile/src/features/services/console/consoleDestinations.ts mobile/src/features/services/console/consoleTransport.test.ts mobile/src/features/services/console/consoleTransport.ts mobile/src/features/services/console/monitoringContracts.ts mobile/src/features/services/serviceContracts.ts
```

The two additional Plugins files passed:

```sh
/Users/abigaildeng/Documents/work/NyxID/frontend/node_modules/.bin/prettier --check mobile/src/features/plugins/PluginsScreen.tsx mobile/src/features/plugins/PluginsScreen.test.ts
```

`node .planning/pr17-acceptance-20261104/check-changed-syntax.cjs` ran TypeScript `transpileModule` with diagnostics on the analyzer's 16 `staticCheckFiles`: **0 syntax errors**. This is a syntax check, not semantic typechecking. No reliable affected project typecheck is configured. `git diff --check` passed.

Full frontend/mobile test suite, lint, semantic typecheck and build are delegated to GitHub CI by the personal local-validation policy. No local full command or new native build was run; CI was not watched.

## Actual simulator evidence

Reused **NyxID RN QA**, iPhone 16e / iOS 26.3, existing development client build 36. PR #17 JavaScript was served from this worktree on Metro 8088; no new native binary was built.

| Flow | Observed result | Evidence boundary |
| --- | --- | --- |
| Plugins → GitHub OAuth connection → Overview | Real backend read returned a connected credential and monitoring card; Health and Readiness both showed Unknown. | One current personal account and connection; no probe executed. |
| Configure monitoring with health path `../private`, then Save | Safe-relative-GET validation error appeared locally. | Deliberately invalid draft; no valid configuration save. |
| Dirty draft → Advanced → Keep editing | Discard prompt appeared; existing invalid draft/error remained on Overview. | Local draft/navigation only. |
| Dirty draft → Back → Discard | Confirmation appeared and returned to Plugins. | Discarded local edits only; no server configuration changed. |
| Plugins → Service & developer console → Show developer console | Services root opened and exposed current-account Web entries. | Verified ordinary navigation without an external deep link. |
| Tools directory · Web | Opened the first-party `nyxid.ai` browser view, showing its independent sign-in page. | Tools content and signed-in Web editing were not validated. |
| Dismiss browser and refresh on return | Not completed in this UI session. The browser Done control was absent from the accessibility tree; coordinate input failed with `windowNotFoundAtPosition`. | Production-component tests cover return refresh; runtime success is not claimed. |

No credential/key/permission changes, paid probe, valid monitoring write or real SSH command was performed. No TestFlight or physical iPhone acceptance is claimed.
