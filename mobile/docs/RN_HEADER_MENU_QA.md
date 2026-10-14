# Workspace header menu — 2026-10-14

The shared workspace header now keeps an explicit Menu control when a contextual or native Back control is present. A root page keeps one Menu on the left; a detail/saved-chat page has Back on the left and Menu on the right, leaving room for the centered title. Both controls retain 44-point targets and independent callbacks. The menu opens the existing Drawer without first navigating away.

Back selection, local history, usePreventRemove, gestures and Android hardware-Back logic are unchanged. The new Menu shares the existing critical navigation-disabled state during protected writes/first-send setup. The headerLeft/headerRight callbacks and iOS custom native left/right items use the same button factories and visibility conditions. This change applies to screens using workspaceHeaderOptions; auth/scanner/legal pages using other headers are outside this change.

## Actual native verification

Reused the existing signed-in iPhone 16e/iOS 26.3.1 Simulator and official Expo Go 55.0.34 against the unchanged production API. The final layout was verified in the existing generated attachment QA conversation. No new inference turn, profile save, permission change or service write was performed for these navigation checks.

| Native path                       | Result                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root/new chat                     | One left Menu, centered NyxID title, no duplicate right Menu.                                                                                                                                                      |
| Saved chat                        | Left Back and right Menu remain visible with the long current-chat title below. Tapping the right Menu opens the existing drawer directly.                                                                         |
| Drawer close with an unsent draft | Typed `Menu QA draft`, opened and closed Menu, and observed the same conversation and exact draft. Cleared the temporary draft afterward; the empty composer and disabled Send were observed. No message was sent. |
| Drawer → Plugins → Back           | Plugins loaded its actual connection/catalog screen, showing Back on the left and Menu on the right. Native Back returned to the same generated QA conversation with its empty composer.                           |
| Saved-chat local Back → root      | Left Back returned to the NyxBot new-chat root; only the left Menu remained.                                                                                                                                       |

Reviewed crops exclude account details and private chat bodies:

- [Saved-chat header](qa/2026-10-14-header-menu/chat-header.png)
- [Open workspace drawer](qa/2026-10-14-header-menu/drawer.png)
- [Root header](qa/2026-10-14-header-menu/root-header.png)

The root Menu was present in the native accessibility tree. The saved-chat native header controls were verified through screenshots and coordinate taps; that header was omitted from accessibility observations after some transitions. Independent VoiceOver traversal was not verified. Source labels and 44-point targets are not a substitute for that pass.

## Focused validation

Changed-file commands from repository root:

```sh
python3 /Users/abigaildeng/.codex/skills/frontend-incremental-pr/scripts/frontend_change_scope.py --repo . --base 8ace0ff4 > /tmp/nyxid-header-menu-scope.json
node mobile/docs/qa/2026-10-14-header-menu/check-source.cjs
python3 - <<'PY_CHECK'
import json, subprocess
from pathlib import Path
files = json.loads(Path("mobile/docs/qa/2026-10-14-header-menu/task-files.json").read_text())
files = [f for f in files if f.endswith((".tsx", ".md", ".cjs", ".json"))]
subprocess.run(["frontend/node_modules/.bin/prettier", "--check", *files], check=True)
PY_CHECK
git diff --check
git diff --cached --check
```

No directly corresponding header/navigation test exists in the installed mobile runner; this small layout/control change is verified natively rather than adding implementation-mirroring tests or rerunning unrelated suites. The source check covers one explicit TypeScript file's syntax/import resolution, not semantic typecheck. No repository-native affected semantic target exists. Full frontend suite, semantic typecheck and production build are delegated to GitHub CI under personal frontend policy. Android, physical devices, release binaries, extreme text sizes/narrow devices and busy-state navigation were not operated in this batch.
