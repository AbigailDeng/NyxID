# RN composer dispatch verification — 2026-10-14

RN left submitted text in the input while NyxBot was already answering. `sendDraft()` waited for `useAssistant.send()` to finish the entire SSE reply and history/index refresh before clearing. Web's `ChatComposer.submit()` clears at dispatch and restores only a message that was not admitted.

The native screen now uses `submitAssistantDraft()` to clear before calling the send hook. A definite pre-admission refusal (`false`) or a local pre-dispatch guard rejection restores the submitted text only when the draft revision is unchanged. Accepted or uncertain sends stay cleared. Completion no longer writes to the composer, preserving later edits; navigation and explicit draft clearing also fence an old restore.

This adapts Web's dispatch/restore behavior to RN's `TextInput` and existing send-result contract. The Web DOM composer is not imported into RN. The API/stream hook, backend and Send/Stop gesture protection are unchanged.

## Actual native verification

Operated the existing signed-in iPhone 16e / iOS 26.3.1 Simulator in official Expo Go 55.0.34 with the existing production API origin and account session. No fixture transport or alternate account was used.

| Action                                                               | Observed result                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Send `UI QA: reply OK only. Do not use tools.` from NyxBot Home      | User message was persisted in a new thread; while NyxBot showed Working and Stop, the input showed its empty placeholder.                                                                                                                                                        |
| Let the first live reply finish                                      | NyxBot replied `OK`.                                                                                                                                                                                                                                                             |
| Send `UI QA 2: reply OK only. Do not use tools.` in the saved thread | A second user message and Working state appeared.                                                                                                                                                                                                                                |
| Type a next draft immediately after the second Send                  | Native state showed the newly typed text while Stop and Working were still present.                                                                                                                                                                                              |
| Normalize the next test draft using the native setter                | The resulting observation showed the saved `OK` reply and the unsent test draft. Completion arrived between these observations, so this screenshot alone does not establish uninterrupted draft preservation across completion. The deferred tests below verify that transition. |
| Clear the temporary unsent test draft                                | Input returned to its placeholder and Send became disabled.                                                                                                                                                                                                                      |

Both actual replies were `OK`; no tool-action rows were observed. The new thread remains identifiable as `UI QA response check`. No original user thread was modified or deleted, and no permissions/settings were changed in this batch.

Cropped evidence excludes account identifiers, resource IDs and private conversations; PNG text/EXIF metadata was removed:

- [Working reply with an empty input](qa/2026-10-14-composer-clear/working-empty-input.png)
- [Completed reply with a newly edited test draft](qa/2026-10-14-composer-clear/completed-next-draft.png)

Definite refusal, local guard rejection, delayed navigation errors and uncertain sends were verified with controlled deferred tests, not forced against production. Android, physical devices, release builds and actual network failure were not operated in this batch.

## Focused local verification

Twenty related tests passed, including eight new async composer regressions and the existing ownership/Send-Stop guard tests. The new tests establish dispatch-time clearing before the reply settles, refusal/guard restoration, preservation of newer typing, typing then clearing, navigation fencing and absence of automatic replay.

Exact focused commands:

```sh
# Repository root
python3 /Users/abigaildeng/.codex/skills/frontend-incremental-pr/scripts/frontend_change_scope.py --repo . --base cefb8c2b > /tmp/nyxid-composer-clear-scope.json
frontend/node_modules/.bin/prettier --check mobile/src/features/assistant/AssistantScreen.tsx mobile/src/features/assistant/assistantComposerDraft.ts mobile/src/features/assistant/assistantComposerDraft.test.ts mobile/docs/RN_COMPOSER_CLEAR_QA.md
git diff --check -- mobile/src/features/assistant/AssistantScreen.tsx mobile/src/features/assistant/assistantComposerDraft.ts mobile/src/features/assistant/assistantComposerDraft.test.ts mobile/docs/RN_COMPOSER_CLEAR_QA.md

# mobile/
./node_modules/.bin/tsx --test src/features/assistant/assistantComposerDraft.test.ts src/features/assistant/assistantComposerPress.test.ts src/features/assistant/assistantAgentContext.test.ts
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
  'mobile/src/features/assistant/assistantComposerDraft.ts',
  'mobile/src/features/assistant/assistantComposerDraft.test.ts',
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

Formatting, syntax/import resolution and diff whitespace checks passed. An initial import-resolution check treated Node builtins as unresolved under the mobile compiler configuration; the checker now recognizes those builtins using `isBuiltin`, and the explicit final check passed. No corresponding RN component test runner or repository-native affected semantic typecheck exists. Full frontend tests, semantic typechecking and production build are delegated to GitHub CI by the personal local-validation policy; none was run locally. Unrelated auth, skill, planning and design work was excluded from task checks and staging.
