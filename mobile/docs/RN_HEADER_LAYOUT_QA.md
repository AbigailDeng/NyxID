# Contextual workspace header — 2026-10-14

The workspace header previously displayed Back and the navigation menu side by side whenever local or route history existed. The approved mobile source artwork uses one left control: Menu on Home and Back on chat/detail screens. This correction makes the shared header render one contextual button.

`WorkspaceHeader.tsx` now selects the icon, callback, accessibility label and disabled state from the same `canGoBack` value. Local details and route history show Back; a root screen without return history shows Menu. The 44 dp tap target and iOS shared-background suppression remain. The existing local-history ordering, busy guards, prevention of route removal, gestures and Android hardware-return subscription are unchanged.

The local `home` and `chat` SVG/PNG source artwork imported into [NyxID · React Native · Web parity & user journeys](https://www.figma.com/design/1cxfGMnsqcwgxwxUWyTFrI) was inspected. Live Figma was not retrieved. This correction is limited to the left header control; it does not establish complete chat-screen visual parity.

## Actual native observations

The existing signed-in app was operated in the dedicated iPhone 16e / iOS 26.3.1 Simulator, official Expo Go 55.0.34, using its existing session and configured production origin. No chat send, service mutation or provider invocation was performed by this verification.

| Action                                                        | Observed result                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Inspect the already open saved NyxBot thread after the update | Left header showed only Back, with accessibility label `Back to NyxBot`; no menu beside it.                   |
| Tap chat Back                                                 | Returned to the empty NyxBot draft/home; the same left position changed to Menu with label `Open navigation`. |
| Open the home navigation menu                                 | The drawer opened and exposed the existing workspace destinations.                                            |
| Navigate to Services                                          | Left header showed only Back.                                                                                 |
| Open a service connection                                     | The header remained a single Back labeled `Back to services`.                                                 |
| Tap connection header Back                                    | Returned to the Connected list, preserving local-before-route return ordering.                                |
| Tap Services list header Back                                 | Returned to the prior empty NyxBot home, which displayed Menu again.                                          |

Checked evidence is cropped to the header, excludes conversation/resource/account data, and has PNG text/EXIF metadata removed:

- [Saved chat: single Back](qa/2026-10-14-header-layout/chat-back.png)
- [Root home: single Menu](qa/2026-10-14-header-layout/home-menu.png)

Native accessibility state confirmed labels and roles. VoiceOver spoken output, disabled busy-return behavior, Android, physical devices, dark rendering and release builds were not operated in this batch. Earlier [chat/navigation verification](RN_CHAT_NAVIGATION_QA.md) establishes broader paths but its side-by-side header placement and screenshots precede this correction.

## Focused local verification

There is no corresponding header component/navigation unit-test runner in the mobile package. No new test was added to assert this reversible icon layout. This change modifies only `mobile/src/app/WorkspaceHeader.tsx`; unrelated dirty auth and local design/planning work were excluded.

Commands from the repository root:

```sh
python3 /Users/abigaildeng/.codex/skills/frontend-incremental-pr/scripts/frontend_change_scope.py --repo . --base 1125aa3f > /tmp/nyxid-header-layout-scope.json
frontend/node_modules/.bin/prettier --check mobile/src/app/WorkspaceHeader.tsx mobile/docs/RN_HEADER_LAYOUT_QA.md
git diff --check -- mobile/src/app/WorkspaceHeader.tsx mobile/docs/RN_HEADER_LAYOUT_QA.md
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const ts = require('./mobile/node_modules/typescript');
const file = 'mobile/src/app/WorkspaceHeader.tsx';
const config = ts.readConfigFile('mobile/tsconfig.json', ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, path.resolve('mobile')).options;
const source = fs.readFileSync(file, 'utf8');
const result = ts.transpileModule(source, { fileName: file, compilerOptions: options, reportDiagnostics: true });
const errors = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
for (const imported of ts.preProcessFile(source).importedFiles) {
  if (imported.fileName.startsWith('.') && !ts.resolveModuleName(imported.fileName, path.resolve(file), options, ts.sys).resolvedModule) {
    throw new Error('Unresolved relative import: ' + imported.fileName);
  }
}
if (errors.length) throw new Error(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
console.log(file + ': syntax and relative imports passed; no semantic typecheck');
NODE
```

Changed-file formatting, syntax, relative-import resolution and diff whitespace checks passed. There is no repository-native affected semantic typecheck. Full frontend suite, semantic typechecking and production build are delegated to GitHub CI by the personal local-validation policy; none was run locally.
