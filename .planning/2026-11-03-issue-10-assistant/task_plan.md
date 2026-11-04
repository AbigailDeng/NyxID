# Issue 10: Assistant self-service management

Baseline dc46415065fac9e80200d0711b729db7f8c7d2c8. Personal branch codex/native-10-assistant-management. PR base codex/mobile-ios-integration.

## Scope decisions
| Capability | Decision | Delivery |
|---|---|---|
| Automations author/run/pause/delete | Existing Web manager + Ask NyxBot | Preserve GET-only native/history; reuse existing agent/setup routes and return refresh |
| Channel setup/verify/rebind/reconnect/disconnect | Precise Web | Existing agent channel details + correct global/agent channel panel; refresh server state after return |
| Bot onboarding/templates/personal binding/setup/revoke | Precise Web | Dedicated lifecycle routes from native Assistant management |
| Skill enabled and preload | Native | Revision-fenced controls; preserve sibling pins; refresh after mutation |
| Skill draft file editing | Ask NyxBot + precise Web | Preserve read-only files; agent skills/learning panel handoff |
| Learning settings/org consent/run/proposals | Precise Web | Exact agent skills/learning panel, return refresh |
| NyxBot global limits/automation preferences | Native | Server limits, dirty patch only, reload real state |
| Reply feedback/model/Thinking/Voice settings | Deferred existing decision | Explicitly out of scope; device voice QA #1868 |

## Phases
- [x] Contracts, historical decisions and owner boundaries
- [x] Implement isolated native management entry and settings
- [x] Implement contextual handoffs/return refresh and preload/enable
- [x] Focused verification, diff review
- [x] Commit, push, personal PR; no merge

## Constraints
No full local suite/lint/typecheck/build or CI edits. Only focused commands. Full verification belongs to GitHub CI. No team repository writes.

## Follow-up: remove added Web automation support (2026-11-04)

User requested removing exact automation targeting and create-form intent. Restore all four frontend files to the original PR base, remove dependent Native route state/URLs/duplicate controls, and reuse the existing Web manager with agent/setup support.

- [x] Confirm scope and independent read-only review
- [x] Remove added support and update current documentation
- [x] Run focused tests/static checks and review the complete diff
- [x] Prepare scoped changes and personal PR16 description for delivery

Delivery target remains the existing personal PR16; final commit/push/PR update state is recorded in the chat. No merge.
