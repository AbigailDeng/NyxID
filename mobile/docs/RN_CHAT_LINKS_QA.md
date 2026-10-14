# RN chat hyperlinks — 2026-10-14

Bare HTTPS URLs in assistant replies now become tappable, theme-colored, underlined links. The stable parser is shared by saved messages and streamed replies, with a native accessibility link role. Existing Markdown labels and angle-bracket links still work. No backend or dependency changes are included.

## Cause and implementation

Web's [TextBlock](../../frontend/src/components/assistant/blocks/text-block.tsx) uses `remarkGfm` to recognize bare URLs. RN's installed `react-native-markdown-display` default parser had `typographer` enabled but left `linkify` disabled. The app now uses that renderer's exported `MarkdownIt`, with `linkify: true`, `typographer: true` and `html: false`, rather than rewriting whole messages with a URL regular expression.

Both parsing and opening use the existing HTTPS-only, no-username/password boundary. Unsupported destinations remain noninteractive; no new mailto/HTTP/custom-scheme support is claimed. Inline/fenced code stays code, and model-provided remote images still require an explicit tap. The existing opener returns false to prevent the Markdown library from also invoking its default `Linking` path.

## Actual native verification

Reused the signed-in iPhone 16e/iOS 26.3.1 Simulator and official Expo Go 55.0.34 against the existing production API. Opened the same existing conversation as the user's screenshot, without new messages or backend writes.

| Path                                                            | Observation                                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Saved reply containing an unformatted HTTPS URL on its own line | Original reply rendered with theme color and underline. Native accessibility exposed the complete URL, including its original query, as a link.                                            |
| Tap the original reply's link                                   | Opened the iOS browser sheet at the expected NyxID host. Its separate browser session reached the NyxID login screen. No login, pairing, permission change or machine setup was performed. |
| Close browser                                                   | Returned to the same saved conversation; the link remained visible and interactive.                                                                                                        |

Evidence: [hyperlink appearance](qa/2026-10-14-chat-links/hyperlink.png), cropped before the private setup query, and [opened browser](qa/2026-10-14-chat-links/browser.png). The original conversation already reports its setup links expired; opening the browser does not establish successful setup or make an expired URL valid. Machines remain excluded from the RN migration.

This batch verifies saved-message rendering and opening on iOS. Streamed replies receive the same parser/rule but no new live inference was sent for this increment. Android, physical devices, release binaries, VoiceOver traversal and all possible URL formats are not established. Installed parser rules still determine whitespace/Chinese-adjacent and full-width punctuation boundaries; this change does not claim complete GFM grammar equivalence.

## Focused checks

Eight regressions pass against the exact `markdown-it` version resolved from the native renderer: original standalone URL in a Chinese response, query/fragment and encoded values, outer English punctuation and balanced parentheses, multiple links, labeled/angle-bracket Markdown links, code exclusions, unsafe destinations, literal HTML tags and HTTPS normalization.

From `mobile`:

```sh
./node_modules/.bin/tsx --test src/features/assistant/assistantMarkdown.test.ts
```

Changed-file commands from repository root:

```sh
python3 /Users/abigaildeng/.codex/skills/frontend-incremental-pr/scripts/frontend_change_scope.py --repo . --base a95c8e50 > /tmp/nyxid-chat-links-scope.json
node mobile/docs/qa/2026-10-14-chat-links/check-source.cjs
python3 - <<'PY_CHECK'
import json, subprocess
from pathlib import Path
files = json.loads(Path("mobile/docs/qa/2026-10-14-chat-links/task-files.json").read_text())
files = [f for f in files if f.endswith((".ts", ".tsx", ".md", ".cjs", ".json"))]
subprocess.run(["frontend/node_modules/.bin/prettier", "--check", *files], check=True)
PY_CHECK
git diff --check
git diff --cached --check
```

The explicit task manifest excludes unrelated local auth/design/skill work. Syntax/import resolution checks three selected TypeScript files; it is not semantic typecheck. No native affected semantic target exists. Full frontend suite, semantic typecheck and production build are delegated to GitHub CI under personal frontend policy; no full local command was run.
