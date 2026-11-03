# Issue 10: Assistant self-service management

Baseline dc46415065fac9e80200d0711b729db7f8c7d2c8. Personal branch codex/native-10-assistant-management. PR base codex/mobile-ios-integration.

## Scope decisions
| Capability | Decision | Delivery |
|---|---|---|
| Automations author/run/pause/delete | Precise Web + Ask NyxBot | Preserve GET-only native/history; contextual management handoff and return refresh |
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
- [ ] Commit, push, personal PR; no merge

## Constraints
No full local suite/lint/typecheck/build or CI edits. Only focused commands. Full verification belongs to GitHub CI. No team repository writes.
