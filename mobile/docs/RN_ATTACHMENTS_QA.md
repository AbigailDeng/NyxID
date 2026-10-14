# RN Assistant attachments — 2026-10-14

This follow-up implements human-owner conversation uploads through the same existing API and lifecycle as Web. It adds the visible paperclip, native multi-file selection, bounded serial upload, progress/Ready/error cards, removal, attachment-only sends, and authenticated saved-file opening. It does not change the backend or add group chat.

## Actual native verification

Used the existing signed-in iPhone 16e / iOS 26.3.1 Simulator with official Expo Go 55.0.34 and the unchanged production API/frontend origins. No mock transport, new login or account switch was used. Native operations used the existing Simulator window. Generated harmless PNG, plain-text and unsupported ZIP fixtures; no user documents were selected.

| Path                                   | Observed result                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paperclip → Files → Cancel             | Returned to an empty composer with Attach enabled and Send disabled.                                                                                                                                          |
| Files multi-select PNG + text          | Both real uploads reached Ready; empty-text Send enabled. Local image preview opened and closed.                                                                                                              |
| Send two files with empty text         | Composer attachments and text cleared; optimistic message carried both files; server-saved user message retained both.                                                                                        |
| Real NyxBot execution                  | Described the uniform lavender PNG and read the exact harmless text/code word. This verifies actual file availability for this conversation; it does not prove all supported formats or provider/image modes. |
| Saved PNG → Preview → Close            | Authenticated server download rendered the correct image in a native Modal; Close returned to the conversation.                                                                                               |
| Saved text → Share → Save to Files     | System save completed with the safe original filename `rn-upload-qa.txt` and returned to the chat. Generated-file byte readback matched the source exactly (details below).                                   |
| Ready PNG → remove                     | Ready card disappeared immediately; the empty composer disabled Send.                                                                                                                                         |
| Ready PNG → New chat, retaining NyxBot | Pending card cleared and Send disabled even though Agent and unsaved route stayed the same. This is a UI pass; server pending-row cleanup is contract-tested rather than independently read back.             |
| Unsupported ZIP → remove               | Visible “Format not supported” card blocked Send; removal restored the empty composer.                                                                                                                        |

The generated saved text file contains 100 bytes, identical to the source fixture. SHA-256: `60d89d9d82645e929b9be837db48603b973444802bf17ddbd4743236bd10a87f`. Readback was limited to the generated test file in the Simulator file-provider storage. No private `nyx-attachment-*` download caches remained after system sharing completed.

Evidence: [Ready files](qa/2026-10-14-attachments/ready-files.png), [cleared composer](qa/2026-10-14-attachments/cleared-after-send.png), [live file reading](qa/2026-10-14-attachments/live-file-reading.png). Additional evidence: [image preview](qa/2026-10-14-attachments/image-preview.png), [unsupported file](qa/2026-10-14-attachments/unsupported-file.png), [native Save](qa/2026-10-14-attachments/save-to-files.png), [new-chat cleanup](qa/2026-10-14-attachments/new-chat-cleanup.png). Screenshots are cropped to generated test data. The immediate-after-send capture predates the metadata polish: final image cards omit zero page counts, PDFs show pages and extracted text documents show sections. Final Save was repeated after the cache-directory/filename polish.

## Focused checks

From `mobile`, 99 tests passed:

```sh
./node_modules/.bin/tsx --test \
  src/features/assistant/AssistantUploadSession.test.ts \
  src/features/assistant/assistantTurnRequest.test.ts \
  src/features/assistant/assistantUploads.test.ts \
  src/features/assistant/assistantAttachmentAccess.test.ts \
  src/features/assistant/assistantComposerDraft.test.ts \
  src/features/assistant/assistantComposerPress.test.ts \
  src/features/assistant/assistantState.test.ts \
  src/features/assistant/assistantAgentContext.test.ts \
  src/features/assistant/assistantStream.test.ts \
  src/features/assistant/assistantStreamReader.test.ts \
  src/lib/api/authenticatedTransport.test.ts \
  src/lib/api/readBoundedBytes.test.ts
```

These cover serial draft reuse, stat-before-read limits, ten-file capacity, cancellation/late results, definite-refusal restore versus accepted/uncertain consumption, model PATCH failure, binary transport/auth ownership and download overflow. They are separate from the real native observations.

Changed-file scope analyzer uses base `3d38d29c`. [Task manifest](qa/2026-10-14-attachments/task-files.json) excludes unrelated local auth/design/skill work. `node mobile/docs/qa/2026-10-14-attachments/check-source.cjs` passed for 22 source/test files (syntax/import resolution, not semantic typecheck). The exact selected-file formatting command is below. Selected files pass Prettier; pre-existing whole-file formatting in `app.config.ts` and `http.ts` is retained, with added lines reviewed and new HTTP functions formatted separately. `git diff --check` passed.

After the final viewer filename/cache adjustment, `./node_modules/.bin/tsx --test src/features/assistant/assistantAttachmentAccess.test.ts` was repeated from `mobile`: 6/6 passed. Syntax/import resolution was repeated after the final source edit. Independent contract/security review was completed. No repository-native affected semantic typecheck exists. Full semantic checks, suite and build are delegated to GitHub CI by personal frontend policy; CI is not claimed passed.

```sh
python3 - <<'PY_CHECK'
import json, subprocess
from pathlib import Path
files = json.loads(Path("mobile/docs/qa/2026-10-14-attachments/task-files.json").read_text())
files = [f for f in files if f.endswith((".ts", ".tsx", ".md", ".cjs", ".json")) and f not in ("mobile/src/lib/api/http.ts", "mobile/app.config.ts")]
subprocess.run(["frontend/node_modules/.bin/prettier", "--check", *files], check=True)
PY_CHECK
```

## Limits

Android, physical devices, standalone/release binaries, third-party cloud document providers, actual retention expiry, large-file extraction timing, native interrupted-network/account-switch races, PDF/DOCX/CSV/JSON ingestion and external document-reader apps remain unverified in this batch. Focused contract/race tests cover relevant client boundaries but do not establish native passes. Production QA leaves a generated test conversation and its saved attachments; it does not change service credentials or grants.
