# Issue #10 acceptance record

Baseline: dc46415065fac9e80200d0711b729db7f8c7d2c8. Related issue: https://github.com/AbigailDeng/NyxID/issues/10. This PR does not close the issue or merge itself.

| Capability | Decision | Implemented result | Automated evidence | Manual gap |
|---|---|---|---|---|
| Automations create/edit/pause/run/delete/delivery/overlap | Web + Ask NyxBot | Contextual create/setup/list/detail Web actions, exact agent and automation identity, reload on return; native GET-only list/detail/history remains | AutomationsScreen, links, ManagementHandoff and actual Web parser contracts | Browser create/edit/run/pause/delete and returned state on iPhone |
| Channels connect/verify/rebind/reconnect/disconnect/readiness/activity | Web | Readiness summary plus global manager and actual channel_bot_id detail destination; existing channel setup links preserved | Management contracts, handoff, AssistantLinks | Real third-party credentials, ownership and role restrictions, reconnect/disconnect/activity |
| Bot templates/personal binding/setup/revoke | Web | Templates, setup lifecycle and personal binding list/revoke manager links | Constructed exact URL contracts | Real onboarding and revoke, no secret leakage on phone |
| Skills activation/preload | Native | Toggle exact selected pin; bounded paths and clear; revision/maintenance/session checks; preserves siblings | SkillActivationControls + pluginSkillsTypes | iPhone controls, real missing file/64 KiB errors, clear and version reset |
| Skill draft file editing | Ask NyxBot + exact Web | Existing read-only native preview/Ask retained; exact agent Skills panel | PluginSkills retained behavior + link contracts | Browser editor, publication flow remains existing |
| Automatic learning settings/org consent/run/proposals | Web | Exact agent Skills/learning destination | Route and real component source verified | Real feature/role/organization gates and return state |
| NyxBot global resource limits/automation preferences | Native | Settings sheet entry; fresh ceiling validation; dirty patch; concurrent edit block; no auth replay; uncertain retry requires reload | AssistantManagementScreen + transport/patch tests | iPhone layout/text scaling/back/discard, real backend save and concurrent edit |
| Reply feedback | Retained omission | Existing Copy/time native footer untouched | Out of scope | Not a default blocker |
| Model/Thinking/Voice source/independent Voice settings | Retained omission | Existing server default/Permissions policy untouched | Out of scope | Voice/dictation device acceptance continues under team #1868 |

## Phone walkthrough to perform

1. Open Settings → NyxBot limits & management; change one limit, verify unchanged fields remain intact, cancel a dirty dismissal, then save/reload. Exercise offline, lowered server ceilings, account change, concurrent dirty-field edits and unconfirmed write recovery.
2. Open an attached Skill. Disable/enable it, save safe preload paths, clear them, check missing-file and aggregate-size server errors, and verify exact sibling pin state survives. Confirm dirty preload prevents accidental navigation/version/removal and Ask remains usable after discard.
3. From Automations list/detail and setup link, open the correct Web agent/task/setup; change one task and return. Confirm native data refreshes without treating dismissal as success. Native transport must still issue GET requests only.
4. Open each channel's Web manager and confirm the actual bot. Verify credentials/ownership/rebind/reconnect/disconnect, onboarding templates/setups, personal bindings/revoke and role restrictions. Return to channel badges/chat tree and reload real state.
5. From a Skill open exact agent Skills & learning. Confirm consent/settings/runs/proposals are present where allowed and return to the prior native context.

No device/manual evidence is claimed. Standard Web DOM tests are blocked by baseline missing `motion/react`; full suite/build/semantic typecheck belongs to GitHub CI.

Async review additionally verifies captured activation generations. A pending save cannot resume after background/foreground, blur/focus or unmount, including through a transport dispatch guard after authentication wait. A response received after dispatch interruption remains unconfirmed and requires reload. Both affected native component test files pass all 10 targeted tests.
