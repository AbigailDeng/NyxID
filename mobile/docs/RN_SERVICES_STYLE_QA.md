# Services visual correction — 2026-10-14

The Services search icon previously sat outside the input border because it was a sibling of the entire labeled `Field`. This also indented the label and field relative to the cards. The screen additionally repeated its native header as a large content heading, used two individually bordered tabs, and used larger card typography and icons than the approved mobile design.

This correction follows the editable artwork imported into [NyxID · React Native · Web parity & user journeys](https://www.figma.com/design/1cxfGMnsqcwgxwxUWyTFrI), `02 · Core mobile`, screen `plugins`. The local SVG and PNG import sources in `docs/design/rn-2026-10-13/` were inspected directly; live Figma was not retrieved in this verification batch. That local design directory is not included in this incremental commit.

## Changes and design scope

| Element      | Result                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page heading | Services uses its native header without the repeated large content heading. Other `WorkspacePage` consumers retain their heading by default.                                                                                    |
| Search       | Full-width label and plain input aligned to the 20 dp page inset; 48 dp minimum input height, 8 dp corner radius, 12 dp label and 13 dp input type. The detached search icon is removed as in the artwork.                      |
| Tabs         | One 48 dp shared bordered container with an inset neutral active segment, 40 dp visible segments and 44 dp touch regions.                                                                                                       |
| Cards        | 12 dp spacing, 13 dp corners, 16 dp padding, 34 dp neutral icon tiles, 14 dp Manrope semibold names, and smaller status/metadata. Minimum height follows the 114 dp reference while long names/descriptions can grow naturally. |
| Data         | Connection status, owner, slug, catalog availability and descriptions still come from the existing live contracts. Search, selection, connection forms and API routes are preserved.                                            |

This is a Services visual correction, not complete Plugins parity. The artwork organizes Plugins into Connectors / Skills and Added / Available sections. The implemented Services increment continues to organize its existing connections and catalog as Connected / Explore catalog. Skills migration and the rest of the RN visual migration are not established by this change. The main Figma artwork is dark; light rendering uses the existing RN theme palette.

## Actual native observations

The existing signed-in app was operated in the dedicated iPhone 16e / iOS 26.3.1 Simulator with official Expo Go 55.0.34 and the existing Metro server on port 8083. It used the configured production API and existing session. No origin/account switch, connection submission, authorization, chat send or provider execution was performed.

| Native action                                     | Observed result                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open Services                                     | One Services header, search aligned with the tabs/cards, shared tab border, compact live connection cards.                                        |
| Type `github` in Connected                        | The real matching connection remained; its long name wrapped naturally.                                                                           |
| Switch to Explore catalog with the same query     | Matching GitHub catalog entries appeared; the selected segment and section label changed. The long PAT description grew without clipping.         |
| Tap the native clear button                       | Query became empty and the live catalog returned, with search still at the top of the viewport.                                                   |
| Type `no-service-qa-match`                        | The no-results card appeared without disturbing search/tabs alignment.                                                                            |
| Focus with the iOS software keyboard visible      | Search and both tabs remained visible above the keyboard; the input exposed a native Search key and clear button.                                 |
| Tap the software keyboard Search key              | Keyboard disappeared and the empty-result state remained readable.                                                                                |
| Filter to `github oauth`, then open its card      | The existing connection form opened with its normal heading, name field and authorization action. Nothing was submitted.                          |
| Tap the header Back from that form                | Returned to the catalog with its query and selected tab preserved.                                                                                |
| Temporarily preview Dark, then return to Services | Search border, segmented selection, card surfaces, accent/status and text were checked against the dark artwork.                                  |
| Restore Use system setting                        | Original system preference was restored; Services returned to light. The temporary query was cleared and Connected was selected before finishing. |

Checked screenshot evidence is cropped to the simulator device viewport and has PNG text/EXIF metadata removed. Catalog screenshots contain public service metadata; the keyboard screenshot contains an empty result. The blue gear is Expo Go's developer overlay. It was not retouched out of the full screenshots.

- [Light controls](qa/2026-10-14-services-style/services-light-controls.png)
- [Light catalog card](qa/2026-10-14-services-style/services-light.png)
- [Dark catalog card](qa/2026-10-14-services-style/services-dark.png)
- [Native software keyboard](qa/2026-10-14-services-style/services-keyboard.png)

These observations establish this layout and input path on iOS. They do not establish Android rendering, physical-device rendering, Dynamic Type extremes, VoiceOver spoken output, or standalone release behavior. Native accessibility state was inspected for search, clear, selected tabs and form controls. There is no corresponding component/UI unit-test runner for `WorkspacePage` or Services in this project.

## Focused local verification

Scope analysis from the repository root:

```sh
python3 /Users/abigaildeng/.codex/skills/frontend-incremental-pr/scripts/frontend_change_scope.py --repo . --base 9ab578a5 > /tmp/nyxid-services-style-scope.json
```

Only this task's two source files were selected from the mobile package. Unrelated dirty auth sources, tests and local design/planning artifacts were excluded.

Related Services contract tests from `mobile/`:

```sh
./node_modules/.bin/tsx --test src/features/services/serviceContracts.test.ts
# 7 passed.
```

Explicit changed-file checks from the repository root:

```sh
frontend/node_modules/.bin/prettier --check mobile/src/features/services/ServicesScreen.tsx mobile/src/components/workspace/WorkspaceUI.tsx mobile/docs/RN_SERVICES_STYLE_QA.md
git diff --check -- mobile/src/features/services/ServicesScreen.tsx mobile/src/components/workspace/WorkspaceUI.tsx mobile/docs/RN_SERVICES_STYLE_QA.md
```

The following exact source check passed for both changed TSX files. It checks transpilation diagnostics and relative-import resolution, not semantic types:

```sh
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const ts = require('./mobile/node_modules/typescript');
const configPath = path.resolve('mobile/tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
const files = ['mobile/src/components/workspace/WorkspaceUI.tsx', 'mobile/src/features/services/ServicesScreen.tsx'];
let errors = 0;
for (const file of files) {
  const absolute = path.resolve(file);
  const source = fs.readFileSync(absolute, 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: parsed.options, fileName: absolute, reportDiagnostics: true });
  for (const diagnostic of result.diagnostics ?? []) {
    if (diagnostic.category === ts.DiagnosticCategory.Error) {
      console.error(file, ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      errors++;
    }
  }
  const ast = ts.createSourceFile(absolute, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    if (moduleName.startsWith('.') && !ts.resolveModuleName(moduleName, absolute, parsed.options, ts.sys).resolvedModule) {
      console.error(file, 'Unresolved relative import', moduleName);
      errors++;
    }
  }
  console.log(file + ': syntax and relative imports checked');
}
process.exitCode = errors ? 1 : 0;
NODE
```

There is no repository-native affected semantic typecheck. Full frontend tests, semantic typechecking and production build are delegated to GitHub CI under the personal local-validation policy. They were not run locally.
