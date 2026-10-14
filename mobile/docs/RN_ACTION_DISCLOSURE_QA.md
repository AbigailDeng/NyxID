# RN action disclosure verification — 2026-10-14

RN rendered every recorded tool call as a separate line under a reply. A nine-action reply therefore expanded its execution metadata by default. Both saved replies and the live footer now use one default-collapsed `N action(s)` control before the answer. Tapping it reveals the actual activity list; tapping again removes the detail rows. Empty lists render no control.

The comparison used the existing signed-in Web chat and GitHub upstream main [`f69a87185b8d3500729995c16eca796cf702c261`](https://github.com/ChronoAIProject/NyxID/commit/f69a87185b8d3500729995c16eca796cf702c261). The branch's older `chat-message.tsx` already had default collapse, but the current Web additionally has friendly captions from [PR #1870](https://github.com/ChronoAIProject/NyxID/pull/1870). RN ports that identifier-only `tool-activity-text.ts` helper and extracts the same provider labels without importing Web CSS or changing the API. Dictionary lookups are restricted to their own keys so unexpected labels such as `constructor` remain safe.

The native summary retains Web's running-before-error-before-completed status priority and adds `· N failed` when the server records errors. Expanded rows show a status icon, the Web caption and the original tool identifier on a wrapping second line. Each summary has a 44 dp minimum touch target and an accessible expanded state. Expansion belongs to a mounted reply/turn, does not automatically open on polling, and may reset when a live reply becomes a saved row or an offscreen cell unmounts. Toggling pauses automatic following so the newly expanded list does not push its control out of view.

Before live response text arrives, the spinner shows the latest running activity, or the most recent activity's caption between tools. It disappears when reply text arrives. This does not port Web's elapsed-seconds waiting timer. Approvals, acknowledgements and required confirmation cards remain outside the collapsed execution metadata.

Activities are real server metadata (`id`, `label`, `status`, timestamps), not tool results. RN does not invent arguments, results or counts. As documented in `docs/chat/08-nyxagent-engine.md`, `completed` means the call completed at the recorded boundary and does not by itself establish a successful tool result. The historic `nyxid__machine_capabilities` label remains history metadata; no Machines UI or backend work is added.

## Actual native verification

Operated the existing signed-in iPhone 16e / iOS 26.3.1 Simulator in official Expo Go 55.0.34, using the unchanged production API origin and account session. The app was in its existing light palette. No fixture transport, alternative account or API mutation harness was used.

| Action                                                                                   | Observed result                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open an existing real NyxBot conversation from native Chat history                       | Two activity-bearing replies showed `2 actions` and `9 actions`; individual tool rows were absent by default. A no-action reply had no control.                                                                                                   |
| Expand the nine-action summary                                                           | The native state exposed all nine actual identifiers with their server statuses. The screenshot showed the control remaining above the expanded list.                                                                                             |
| Expand after the friendly-caption adaptation                                             | Real `nyx__discover_services`, `nyx__search_tools` and `nyx__list_connected_services` entries displayed the same captions as current Web alongside their original identifiers.                                                                    |
| Collapse the summary                                                                     | All nine detail rows disappeared, the chevron closed, the accessibility hint returned to `Show action details`, and the answer remained directly below the summary.                                                                               |
| Open the two-action reply while the nine-action reply was open, then close it            | The replies' expanded states were independent; closing the two-action reply did not close the nine-action reply.                                                                                                                                  |
| Send one additional read-only prompt in the existing `UI QA response check` conversation | Observed Working/Stop and an empty input, followed by a saved reply containing one real `nyx__list_connected_services` activity. The new reply defaulted to `1 action` with hidden details. It answered `OK` after a short introductory sentence. |
| Expand the new one-action reply                                                          | It showed `Checked connected services` and `nyx__list_connected_services`, matching the actual stored activity. No service data was printed in the reply.                                                                                         |
| Close the QA activity, reopen the original conversation, expand and collapse again       | Both original summaries defaulted to closed on reopening. The app was left in the original conversation with nine actions collapsed and an empty input.                                                                                           |

The additional QA prompt requested only one existing read-only list operation, prohibited connection/authorization/modification, and did not change an original user conversation. It added one turn to the existing identifiable QA conversation. No permission or account setting was changed.

The read-only call finished between native observations: Working was observed, then the saved one-action reply. This batch therefore establishes real admission/completion and saved disclosure behavior, but does not visually establish the transient running-action icon, the between-tools label, a failure-count summary or a live activity updating while expanded. Caption behavior for running/error/unknown identifiers is covered by the focused tests; disclosure/status source paths were independently reviewed. Android, physical devices, dark palette, large text and release builds were not operated in this batch.

Cropped native evidence excludes private reply text, account details and resource IDs. PNG text/EXIF metadata was removed:

- [Nine actions collapsed](qa/2026-10-14-actions/collapsed-nine-actions.png)
- [Expanded list excerpt](qa/2026-10-14-actions/expanded-actions.png) — first five of the nine rows; all nine were verified in native accessibility state.
- [New real read-only activity expanded](qa/2026-10-14-actions/expanded-read-only-action.png)

## Focused local verification

Fifteen related tests passed: five Web-caption parity tests (adapted to the mobile Node runner, including safe unknown-label cases), eight existing async composer tests and two existing transcript-scroll tests. No corresponding RN component test renderer exists. No UI test was added that merely mirrors the disclosure markup.

Exact focused commands:

```sh
# Repository root; unrelated dirty auth, planning, design and skill files were excluded from task checks/staging.
python3 /Users/abigaildeng/.codex/skills/frontend-incremental-pr/scripts/frontend_change_scope.py --repo . --base 25ad9ec3 > /tmp/nyxid-actions-scope.json
frontend/node_modules/.bin/prettier --check mobile/src/features/assistant/AssistantScreen.tsx mobile/src/features/assistant/AssistantActivityDisclosure.tsx mobile/src/features/assistant/assistantActivityText.ts mobile/src/features/assistant/assistantActivityText.test.ts mobile/docs/RN_ACTION_DISCLOSURE_QA.md
git diff --check -- mobile/src/features/assistant/AssistantScreen.tsx mobile/src/features/assistant/AssistantActivityDisclosure.tsx mobile/src/features/assistant/assistantActivityText.ts mobile/src/features/assistant/assistantActivityText.test.ts mobile/docs/RN_ACTION_DISCLOSURE_QA.md

# mobile/
./node_modules/.bin/tsx --test src/features/assistant/assistantActivityText.test.ts src/features/assistant/assistantTranscriptScroll.test.ts src/features/assistant/assistantComposerDraft.test.ts
```

Exact changed-file syntax/import check from the repository root:

```sh
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { isBuiltin } = require('node:module');
const ts = require('./mobile/node_modules/typescript');
const config = ts.readConfigFile('mobile/tsconfig.json', ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, path.resolve('mobile')).options;
for (const file of [
  'mobile/src/features/assistant/AssistantScreen.tsx',
  'mobile/src/features/assistant/AssistantActivityDisclosure.tsx',
  'mobile/src/features/assistant/assistantActivityText.ts',
  'mobile/src/features/assistant/assistantActivityText.test.ts',
]) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, { fileName: file, compilerOptions: options, reportDiagnostics: true });
  const errors = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
  for (const imported of ts.preProcessFile(source).importedFiles) {
    if (!isBuiltin(imported.fileName) && !ts.resolveModuleName(imported.fileName, path.resolve(file), options, ts.sys).resolvedModule) {
      throw new Error(file + ': unresolved import: ' + imported.fileName);
    }
  }
  if (errors.length) throw new Error(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
  console.log(file + ': syntax and imports passed; no semantic typecheck');
}
NODE
```

Formatting, syntax/import resolution and diff whitespace checks passed. No repository-native affected semantic typecheck is available. Full frontend tests, semantic typechecking and production build are delegated to GitHub CI by the personal local-validation policy; none was run locally. Backend, dependency manifests and lockfiles are unchanged.
