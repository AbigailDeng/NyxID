# RN chat ownership and navigation verification — 2026-10-14

This follow-up corrects chat ownership and back navigation in the first RN increment on `codex/rn-web-parity`, PR #1866. It changes mobile frontend code only. It does not establish full Web parity.

## Web behavior and RN corrections

Web's Agents entry is the agent list in the Assistant sidebar and its agent details sheet, rather than a separate `/agents` page. RN exposes that management UI as an Agents screen. Both consume the live `/assistant/nyxagent/agents` contract; agent names are not production fixtures.

Every one-to-one NyxAgent thread belongs to an agent. Web selects the saved thread's agent first, the explicit URL agent second, and the user's NyxBot by default. `/assistant` with no selection is NyxBot Home. Selecting an agent opens its latest thread if one exists; New chat retains the current specialist, or returns to NyxBot Home. Web also supports multi-agent group chats and legacy assistant engines. RN has not migrated those paths.

RN now resolves that same ownership priority, filters history by the actual agent, displays the current agent and owner, and offers an agent picker. Selecting an agent opens its latest thread or its empty draft; New chat retains the selected agent and its configured model. The drawer's Chats destination explicitly returns to NyxBot. Pending latest-thread lookup prevents sending into a transient draft. Late index refreshes from the previous agent cannot invalidate the current index; stream identity adoption does not clear a newly edited composer draft.

Workspace headers show a route back button when a previous route exists, alongside the menu. Agents and Services have local detail/form history: their header and Android hardware back return to the list first. Busy mutations retain their return guard. The root chat also provides a return from an opened thread/specialist to its agent home and then NyxBot. Existing legal, account-security, device and approval-detail return controls remain in use. The iOS 26 shared circular menu background is suppressed. Agent limits are explicitly labeled as personal specialists because organization agents are excluded from that counter.

Source references:

- Web: [agent ownership](../../frontend/src/hooks/use-nyxbot-agents.ts), [chat page](../../frontend/src/components/assistant/assistant-chat-page.tsx), [sidebar](../../frontend/src/components/assistant/assistant-engine-sidebar.tsx).
- RN: [chat state](../src/features/assistant/useAssistant.ts), [chat UI](../src/features/assistant/AssistantScreen.tsx), [ownership regressions](../src/features/assistant/assistantAgentContext.test.ts), [workspace header](../src/app/WorkspaceHeader.tsx).

## Actual iOS observations

The existing signed-in RN app was operated through its native UI in the dedicated iPhone 16e / iOS 26.3.1 Simulator using official Expo Go 55.0.34 and Metro on port 8083. It used the existing `.env.local` production API origin, `https://nyx-api.chrono-ai.fun`, and the user's existing session. No origin/session switch, business mutation, chat send or provider invocation was performed for this follow-up.

The following results were observed after actual UI actions and checked against native accessibility state and/or screenshots. These observations are independent of unit tests and bundling success.

| Path                                                | Observed result                                                                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default Chats                                       | NyxBot identity, personal-assistant subtitle and Message NyxBot composer were visible. Menu was an icon without the former white circle.                       |
| Default chat history                                | History was titled NyxBot and contained only NyxBot rows.                                                                                                      |
| Agent picker                                        | The live personal NyxBot and organization specialist were available.                                                                                           |
| Select specialist without history                   | Specialist identity and organization label appeared, with its name in the composer and an empty draft. Its history was empty rather than showing NyxBot chats. |
| Specialist New chat                                 | Kept that specialist's identity and composer label.                                                                                                            |
| Specialist draft header Back                        | Returned to NyxBot Home, with the NyxBot composer restored.                                                                                                    |
| Agent details header Back                           | Returned to the Agents list rather than popping to another workspace route.                                                                                    |
| New agent form header Back                          | Returned to the Agents list without submitting a creation.                                                                                                     |
| Agents list header Back                             | Returned to the previous Chats screen.                                                                                                                         |
| Service connection details header Back              | Returned to the Connected list without changing the connection.                                                                                                |
| Account & security native Back                      | Returned to Settings.                                                                                                                                          |
| Settings header Back, then Services header Back     | Returned to the actual previous Services route, then Chats.                                                                                                    |
| Open saved NyxBot thread, then header Back          | Saved thread loaded with NyxBot identity and chat controls; Back returned to NyxBot Home.                                                                      |
| Specialist, then drawer Chats                       | Explicitly returned to NyxBot Home.                                                                                                                            |
| Select NyxBot in agent picker with existing history | Opened its latest saved thread; New chat returned to its empty draft.                                                                                          |
| Approvals header Back                               | Returned from the empty Pending screen to Chats.                                                                                                               |

Representative checked screenshots contain empty screens only; account/session data and saved conversation content are not included:

- [NyxBot Home](qa/2026-10-14-navigation/nyxbot-home.png)
- [Specialist draft and header return](qa/2026-10-14-navigation/specialist-draft.png)
- [Approvals header return](qa/2026-10-14-navigation/approvals-back.png)

The organization specialist had no saved conversations in this account. Its empty-history/New chat path was tested natively; opening an existing specialist thread and then creating its successor was not exercised in this batch. Ownership regression tests cover preservation of a saved specialist's agent over a conflicting route. No claim is made that this native batch exercised stream adoption draft preservation, a delayed previous-agent index race, busy-mutation back suppression, or a pending latest-thread send race. Android hardware back and native gestures have not been operated. Existing [runtime QA limits](RN_RUNTIME_QA.md), including Android, physical camera/push, release binaries and external integrations, still apply.

## Focused local checks

From `mobile/`, 39 dependency-related tests passed, including all 9 new ownership/label regressions:

```sh
./node_modules/.bin/tsx --test src/features/assistant/assistantAgentContext.test.ts src/features/assistant/assistantState.test.ts src/features/assistant/assistantStream.test.ts src/features/assistant/assistantComposerPress.test.ts src/features/assistant/assistantTranscriptScroll.test.ts src/features/agents/agentContracts.test.ts src/features/services/serviceContracts.test.ts
```

The scope analyzer used `--base 8331a2d2`. Nine explicit changed TS/TSX files passed `transpileModule` syntax and relative-import resolution checks using `mobile/tsconfig.json`; this was not a semantic typecheck. Explicit changed-file Prettier checks and `git diff --check` passed. `App.tsx` has existing whole-file formatting differences; only its drawer Chats branch was edited and checked, without reformatting unrelated code. No corresponding navigation UI test runner exists in this project. The PR records the exact focused commands.

There is no repository-native affected semantic typecheck. The full frontend suite, semantic verification and production build are delegated to GitHub CI by the personal local-validation policy. They were not run locally. The PR remains draft for the broader migration's acceptance limits.
