# RN chat header — 2026-10-14

The chat header now separates current conversation identity, navigation and secondary details. It keeps the existing native NyxID Back/Menu bar, replaces the large heading/Agent/anonymous-toolbar stack with two compact rows, and removes the always-visible raw model ID.

- Current chat: single truncated title plus a labeled Details entry.
- Navigation: compact Agent selection, labeled History and highlighted New chat.
- History: the real selected conversation has a Current/check marker, tint/border and accessibility selected state. Existing dates, Working, pending requests and pagination remain; row accessibility labels include those actual states.
- Details: current Agent and actual model label, Agent details, existing saved-chat rename/delete confirmation, and model selection for a new draft. The fallback model label only strips the Web `nyxagent/` prefix; it does not invent Default/Auto/provider names. Saved-chat model changes remain outside this increment.

## Reference inspection

Reviewed actual source contracts/layouts rather than treating search snippets as verified product behavior:

- [Open WebUI sidebar](https://github.com/open-webui/open-webui/blob/main/src/lib/components/layout/Sidebar.svelte): mobile swipe sidebar, labeled New Chat and search, history kept in navigation.
- [Chatbot UI chat view](https://github.com/mckaywrigley/chatbot-ui/blob/main/components/chat/chat-ui.tsx): current conversation title stays in the chat area; [history items](https://github.com/mckaywrigley/chatbot-ui/blob/main/components/sidebar/items/chat/chat-item.tsx) highlight the selected chat and scope rename/delete to that item; [creation controls](https://github.com/mckaywrigley/chatbot-ui/blob/main/components/sidebar/sidebar-create-buttons.tsx) use a labeled New Chat action.
- Current signed-in NyxID Web and its [sidebar](../../frontend/src/components/assistant/assistant-sidebar.tsx) / [shell](../../frontend/src/components/assistant/assistant-shell.tsx): Agent-owned history and New chat in navigation, current chat rename at the title, Agent/model context separate from history.

These responsive Web projects inform the grouping. They were not operated as native iOS apps. The RN design deliberately retains a visible History entry because its workspace drawer currently has no conversation list.

## Actual native verification

Existing signed-in iPhone 16e/iOS 26.3.1 Simulator, official Expo Go 55.0.34, same production API account/origins. Reused the generated attachment QA conversation; no new turn or user document upload was needed. Only that generated conversation was temporarily renamed to Attachment QA for the native rename/current-state check, then restored to its original auto-generated title.

| Native path                          | Observed result                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New draft header                     | Compact Agent picker, labeled History/New chat/Details, no always-visible raw model ID.                                                                                                                       |
| History → generated QA conversation  | Actual saved attachment transcript opened. Its long original title truncated without hiding controls.                                                                                                         |
| Saved Details → rename               | Temporarily saved Attachment QA; the header updated, and History marked that exact conversation Current with accessibility selected state.                                                                    |
| Saved Details → Delete → Cancel      | Confirmation opened; Cancel returned to Details without deleting the conversation.                                                                                                                            |
| Rename restoration                   | Restored the generated conversation's original title, Проверка изображений и текстовых вложений, and observed it in the header.                                                                               |
| Header New chat                      | Returned to an empty new draft retaining NyxBot.                                                                                                                                                              |
| New draft Details → Choose model     | Native sheet transition completed; live choices channel/chat/research appeared. Selected research and observed it in Details, then restored chat and observed the restored value. No inference turn was sent. |
| Details → Agent details → Back twice | Opened real NyxBot details; the contextual native Back first returned to the Agent list, then to the original new-chat screen. No profile edits were submitted.                                               |

Reviewed evidence crops: [saved header](qa/2026-10-14-chat-header/header.png), [current history item](qa/2026-10-14-chat-header/current-chat.png), [saved Details](qa/2026-10-14-chat-header/details.png), [new draft header](qa/2026-10-14-chat-header/new-chat.png) and [actual model picker](qa/2026-10-14-chat-header/model-picker.png). Crops show only the generated QA conversation; other private history titles are excluded. Pointer/Expo developer overlays visible in some captures are not product controls.

Android, physical devices, release binaries, extreme Dynamic Type/narrow devices, history load-more beyond this account's current list and saved-thread model editing are not established by this batch. This batch establishes draft model selection and restoration, not inference with the alternative model. No backend code was changed.

## Focused checks

From mobile, 54/54 directly related navigation/composer/upload lifecycle tests passed:

```sh
./node_modules/.bin/tsx --test \
  src/features/assistant/assistantHistoryTarget.test.ts \
  src/features/assistant/assistantAgentContext.test.ts \
  src/features/assistant/assistantComposerDraft.test.ts \
  src/features/assistant/assistantComposerPress.test.ts \
  src/features/assistant/AssistantUploadSession.test.ts
```

Changed-file commands from repository root:

```sh
python3 /Users/abigaildeng/.codex/skills/frontend-incremental-pr/scripts/frontend_change_scope.py --repo . --base e7c286f0 > /tmp/nyxid-chat-header-scope.json
node mobile/docs/qa/2026-10-14-chat-header/check-source.cjs
python3 - <<'PY_CHECK'
import json, subprocess
from pathlib import Path
files = json.loads(Path("mobile/docs/qa/2026-10-14-chat-header/task-files.json").read_text())
files = [f for f in files if f.endswith((".tsx", ".md", ".cjs", ".json"))]
subprocess.run(["frontend/node_modules/.bin/prettier", "--check", *files], check=True)
PY_CHECK
git diff --check
git diff --cached --check
```

The task manifest excludes unrelated auth/design/skill work. Syntax/import resolution covers the one changed TypeScript file, not semantic typecheck. No repository-native affected semantic target exists; full frontend suite, semantic typecheck and build are delegated to GitHub CI under personal frontend policy.
