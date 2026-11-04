# Issue #10 acceptance record

Personal PR: https://github.com/AbigailDeng/NyxID/pull/16. Issue: https://github.com/AbigailDeng/NyxID/issues/10. Original implementation baseline: dc46415065fac9e80200d0711b729db7f8c7d2c8. Acceptance follow-up: 2026-11-04. This record does not close the issue or authorize merging.

## Scope and current evidence

| Capability                                                             | Scope decision                                                    | Current evidence                                                                                                                                                                                                                                                                          | Remaining live acceptance                                                                                                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Automations create/edit/pause/run/delete/delivery/overlap              | Web + Ask NyxBot; native list/detail/history remain GET-only      | Real simulator list, paused-task schedule/delivery/status and completed run history; existing Web manager, agent filter and setup continuation contracts                                                                                                              | Authenticated existing Web manager, manually select a test task, make a reversible change and verify refreshed native state |
| Channels connect/verify/rebind/reconnect/disconnect/readiness/activity | Web                                                               | Native management entry and actual empty-account channel response; exact actual channel_bot_id route contracts; browser return refresh                                                                                                                                                    | An account with connected bots; real ownership, role, credentials/readiness and reconnect/disconnect/activity                                                |
| Bot templates/personal binding/setup/revoke                            | Web                                                               | Bounded first-party destination contracts; personal-binding manager opens Web and returns to the same native form                                                                                                                                                                         | Simulator Web has no signed-in session; template/setup/binding/revoke lifecycle has not been accepted                                                        |
| Skills activation/preload                                              | Native                                                            | Real existing organization pins and exact versions; missing SKILL.md and parent-directory validation; valid draft enables Save; dirty state protects other actions; discard returns to unchanged list. Parent/child revision replacement regression covers activation and preload success | Live disable/re-enable and preload save/clear, missing-file/aggregate64KiB errors and version reset on a disposable test agent                               |
| Skill file editing and automatic learning                              | Ask NyxBot + exact agent Web Skills panel; native files read-only | Agent-scoped Web URL contracts, existing preview/version behavior and dirty guards                                                                                                                                                                                                        | Authenticated Web editor/learning consent/settings/runs/proposals and result after return                                                                    |
| NyxBot global limits and automation preferences                        | Native                                                            | Real server fields/ceilings; unchanged Save disabled, out-of-range value rejected, valid draft enables Save, Back/Keep editing/Discard and reopen unchanged server values observed. Dirty patch, fresh ceilings/conflict/auth/lifecycle/unknown-outcome checks automated                  | A reversible live save/reload, actual concurrent editor/server error and device/network interruption                                                         |
| Reply feedback; model/Thinking/Voice source/independent Voice settings | Retain historical native omission                                 | No scope expansion                                                                                                                                                                                                                                                                        | Not default blockers; real voice/dictation acceptance continues under team issue #1868                                                                       |

## Defects found during acceptance and repaired

1. Editing NyxBot limits and pressing Back in the nested Settings stack caused recursive `navigation.goBack` and a native-stack overflow. Native leaf route removal now passes through discard confirmation and replays the original action. The new real navigation-hook regression fails before the fix. Simulator verification after the fix confirms Keep editing retains the draft and Discard returns without writing it.
2. Successful Skill activation or preload can advance selection revision and replace its keyed editor while sibling queries are still refreshing. Previously the old editor skipped releasing the parent busy state after unmount. Parent busy ownership is now per operation, with mount/account fences. Real parent + child regressions reproduce both success paths and verify an old completion cannot unlock a newer operation/account.

The optional exact-task/create-form Web handoff feature and its Web tests were removed at the user's request on 2026-11-04. All four frontend files match the original PR baseline. Native now offers one existing Web manager entry, retaining only already-supported agent/setup context. It does not claim to open a specific task editor or a new form through added URL behavior. No matching Web deployment is required for this change.

## Actual runtime and limits

Reused the existing NyxID RN QA simulator (iPhone 16e, iOS26.3), installed development client build36, and PR16 JavaScript served from this worktree on Metro8087. No native/production build. A real iPhone has not been tested. Existing other Metro servers were preserved.

No live settings/skill PUT, credential entry, bot binding/revocation, automation execution or paid action was performed. Only local drafts were edited and discarded. Web opens through the configured first-party destination, redirects to nyxid.ai sign-in in this browser, and dismissal returns to the original native context with refresh status; dismissal is not reported as a successful mutation. Authenticated Web management is still unverified.

## Local verification

Scope reduction verification passes: 45/45 Native tests in seven selected files and 13/13 existing Web page tests. The earlier acceptance pass on b10a4f302 verified 104 targeted Native tests, including the unchanged Settings navigation and Skill revision/busy regressions; two tests solely for the removed URL behavior have now been deleted. All four frontend files match the original PR baseline. The existing Web page tests were rerun to check that restoration.

Focused commands for the scope reduction:

```sh
# mobile/
pnpm exec tsx --test src/features/assistant-management/managementContracts.test.ts src/features/assistant-management/ManagementHandoff.test.ts src/features/assistant-management/AssistantManagementScreen.test.ts src/features/automations/automationLinks.test.ts src/features/automations/AutomationsScreen.test.ts src/features/assistant/AssistantLinks.test.ts src/app/navigationHierarchy.test.ts

# frontend/ — existing page tests after restoring its baseline source
pnpm exec vitest run --config /tmp/nyxid-pr16-web-env/vitest.config.mts src/pages/automations.test.tsx
pnpm exec eslint src/lib/automation-search.ts src/pages/automations.tsx src/pages/automations.test.tsx
pnpm exec prettier --check ../mobile/src/features/assistant-management/managementContracts.ts ../mobile/src/features/assistant-management/managementContracts.test.ts ../mobile/src/features/automations/automationLinks.ts ../mobile/src/features/automations/automationLinks.test.ts ../mobile/src/features/automations/AutomationsScreen.tsx ../mobile/src/features/automations/AutomationsScreen.test.ts

# repository root
node .planning/2026-11-03-issue-10-assistant/check-changed-syntax.cjs
git diff dc46415065fac9e80200d0711b729db7f8c7d2c8 --exit-code -- frontend
git diff --check
```

The existing Web page tests use the same genuine motion14.0.0 dependency overlay under `/tmp/nyxid-pr16-web-env` from the earlier acceptance pass because the shared installation lacks `motion/react`. The temporary config imports the actual worktree Vite config, preserving application setup/happy-dom/plugins and adding only the missing package resolver alias. No repository manifest/lock/CI changes.

Changed-file Prettier and ESLint pass; changed-source syntax transpilation passes for 28 TS/TSX files (syntax only). The explicit frontend baseline comparison and `git diff --check` pass. Full frontend suite, lint, semantic typecheck and build are delegated to GitHub CI; no reliable affected semantic typecheck exists locally. Release plan success and skipped build checks are not frontend acceptance evidence.

## Remaining human walkthrough

Use a disposable test agent and a test automation; restore original values after successful writes.

1. Settings → NyxBot limits & management. Note the original Automatic task continuations value, change it by one within0–32, tap Save settings, reload and reopen to confirm persistence, then restore the original. Changing another unchanged setting must not be required. Edit again and exercise Back → Keep editing / Discard.
2. Plugins → Skills. Select the test agent, open an already attached skill, Disable then Enable, and verify Back/Choose exact version remain usable after each refresh. Save `SKILL.md` as preload, reload/reopen to confirm, then clear all paths and save. Verify an existing sibling pin is unchanged. Server missing-file/64KiB cases require suitable test packages.
3. On that Skill, open its Skills & learning on web. Sign into the same account, confirm the selected agent and permitted learning controls, then return. From Automations open a test task, select Manage automations on web, confirm the existing management list and selected agent filter where applicable, then manually select the test task. Make one reversible change and return; the real native result must refresh. Do not infer success from browser dismissal.
4. For channels/onboarding, use a designated test bot and verify ownership/readiness/setup/bindings and the relevant role restrictions. Binding, reconnecting or revoking changes live integrations; keep these separate from source/simulator read-only acceptance.
