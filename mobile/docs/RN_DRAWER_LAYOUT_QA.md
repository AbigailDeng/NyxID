# RN drawer layout verification — 2026-10-14

The workspace drawer's title and close button overlapped the iOS status bar. Its native `SafeAreaView` was inside a React Native `Modal`, whose native root had no local `SafeAreaProvider`. The app-level provider was outside the modal's native ancestry.

The modal now supplies its own full-screen `SafeAreaProvider`, so the panel measures its top and bottom insets. The full-screen backdrop stays outside the inset panel content. The title uses the approved drawer artwork's 19 dp Manrope semibold and primary text color. The header and account footer do not shrink; the middle menu occupies the remaining scrollable space.

The local `drawer.svg` artwork imported into [NyxID · React Native · Web parity & user journeys](https://www.figma.com/design/1cxfGMnsqcwgxwxUWyTFrI) was inspected. Live Figma was not retrieved. This fix covers drawer spacing and branding; it does not complete every destination shown in the design.

## Actual native verification

Operated the existing signed-in iPhone 16e / iOS 26.3.1 Simulator in official Expo Go 55.0.34, using the current app session and API origin.

| Action                                        | Observed result                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Open the original drawer                      | Reproduced title and close-button overlap with the status bar.                                       |
| Inspect after the source update               | Title and close button appeared below the status bar; account footer had bottom safe-area clearance. |
| Close using the top button                    | Returned to the original empty NyxBot home.                                                          |
| Reopen the drawer repeatedly                  | Header and footer retained their corrected positions.                                                |
| Tap the dimmed backdrop                       | Drawer closed and returned to home.                                                                  |
| Choose Services, then use header Back         | Reached the real Connected services list and returned to home.                                       |
| Tap the account footer                        | Reached Account Settings.                                                                            |
| Preview Dark, return home and open the drawer | Corrected spacing and text/selection colors were visible in dark mode.                               |
| Restore Use system setting                    | Restored the original preference; the switch read enabled. Returned to home.                         |

No chat message, service mutation, scan approval, login-code mint, provider invocation or account-profile update was performed. The theme preview was restored. The blue floating gear in the screenshots belongs to Expo Go's developer controls.

Evidence is cropped to the status bar/header and menu; account data is excluded and PNG text/EXIF metadata removed:

- [Light drawer](qa/2026-10-14-drawer-layout/drawer-light.png)
- [Dark drawer](qa/2026-10-14-drawer-layout/drawer-dark.png)

Android, physical devices, short-screen scrolling, larger text, landscape layout and release builds were not operated in this batch. No claim is made about those configurations.

## Focused local verification

This task changes only `mobile/src/components/workspace/WorkspaceDrawer.tsx` among source files. No corresponding drawer component test runner exists. No test was added to mirror this reversible style change; actual native operation verifies the behavior. Unrelated dirty auth, planning and design files were excluded from task checks and staging.

Exact commands from the repository root:

```sh
python3 /Users/abigaildeng/.codex/skills/frontend-incremental-pr/scripts/frontend_change_scope.py --repo . --base 71b1a10e > /tmp/nyxid-drawer-layout-scope.json
frontend/node_modules/.bin/prettier --check mobile/src/components/workspace/WorkspaceDrawer.tsx mobile/docs/RN_DRAWER_LAYOUT_QA.md
git diff --check -- mobile/src/components/workspace/WorkspaceDrawer.tsx mobile/docs/RN_DRAWER_LAYOUT_QA.md
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const ts = require('./mobile/node_modules/typescript');
const file = 'mobile/src/components/workspace/WorkspaceDrawer.tsx';
const config = ts.readConfigFile('mobile/tsconfig.json', ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, path.resolve('mobile')).options;
const source = fs.readFileSync(file, 'utf8');
const result = ts.transpileModule(source, { fileName: file, compilerOptions: options, reportDiagnostics: true });
const errors = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
for (const imported of ts.preProcessFile(source).importedFiles) {
  if (!ts.resolveModuleName(imported.fileName, path.resolve(file), options, ts.sys).resolvedModule) {
    throw new Error('Unresolved import: ' + imported.fileName);
  }
}
if (errors.length) throw new Error(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
console.log(file + ': syntax and all imports passed; no semantic typecheck');
NODE
```

Changed-file formatting, syntax, all import resolution and whitespace checks passed. There is no repository-native affected semantic typecheck. Full frontend tests, semantic typechecking and production build are delegated to GitHub CI by the personal local-validation policy; none was run locally.
