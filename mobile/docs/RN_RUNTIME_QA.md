# RN runtime QA — 2026-10-13

## Acceptance status

**Native acceptance is pending.** No iOS/Android screen or interaction has passed native runtime QA yet. PR #1866 remains draft. The evidence below establishes current-backend API compatibility and development bundle generation; it does not establish native rendering, keyboard handling, camera/push behavior, or provider handoffs.

Implementation under test: `8c5f4d9ca87de7b103f99eda5e5132d18f186438`, branch `codex/rn-web-parity`. Scope: [first core increment](RN_WEB_PARITY.md); Machines excluded.

## Environment and native launch blocker

- macOS host with Xcode 26.3 (`17C529`), Expo SDK 55, React Native 0.83.4.
- `xcodebuild -checkFirstLaunchStatus` exits 69. Simulator requires first-launch system components; no available iOS simulator runtime or booted device was found.
- The task-created `xcodebuild -runFirstLaunch` waited inside `AuthorizationCopyRights`, as confirmed by a process sample. The stalled CLI installer was stopped, then the official Xcode installer was opened with iOS 26.2 selected. It reached “Installing system components…” and launched macOS SecurityAgent. Administrator authorization requires the user on the host; the computer-use tool cannot operate SecurityAgent.
- Android SDK, `adb`, and an Android emulator are not installed. No Android device has been exercised.
- Official Expo Go 55.0.34 for the iOS simulator was downloaded and extracted. Metro started with explicit QA configuration. An iOS **development** bundle request completed successfully: 3,831 modules, 16,436,419 bytes. This was a bundle-generation check; it was never loaded in a native app.
- Metro reported that newer compatible Expo/RN patch releases exist. Dependencies were preserved; compatibility with the downloaded Expo Go binary remains to be established through launch.

The next native action is to finish the host's Xcode administrator authorization and iOS runtime installation, boot a simulator, install the official Expo Go app or a development build, and execute the matrix below. Expo Go alone cannot establish custom-scheme, Universal Link, production push, or physical-camera behavior.

## Real-backend API/schema acceptance

The existing local executable was obsolete (0.14.0), so the unchanged current backend was built with:

```sh
cargo build --locked -p nyxid --bin nyxid-server
```

The build passed. `/health` reported 0.69.0, commit `8c5f4d9ca87d-dirty`; backend and Cargo source paths remained clean. The dirty marker reflects the overall working tree. Testing used a fresh Mongo 8.0.28 replica set on loopback port 33018, a new `nyxid_rn_qa_20261013` database, generated disposable account/crypto material, and backend port 3301. The existing database and port-3001 server were untouched. The unchanged backend's public listener defaults to `0.0.0.0`; Mongo and the internal listener were loopback only. No executable interposer was used.

Only this fresh database's invitation gate was disabled through its admin API before ordinary registration. No real provider credential was stored, and no upstream service execution was requested. Raw responses, credentials, TOTP seeds, and recovery codes were retained only in mode-0600 temporary files, excluded from Git and tool output.

There were **44 expected API/state assertions with zero failures**, plus **16 real-response cases accepted by the actual mobile schemas/parsers**. [Sanitized evidence](qa/2026-10-13-backend-compatibility.json) records individual case names and results without response bodies or credentials.

| Flow                                | Observed behavior                                                                                                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary account registration/login | Two disposable accounts registered and logged in with 200; wrong passwords returned 401.                                                                                                        |
| Profile                             | Fetch, update, refetch, and restore returned 200; the changed display name persisted.                                                                                                           |
| Sessions                            | Lists identified the current session. Revoking a second session returned 204; its token then returned 401, while the original session remained usable.                                          |
| TOTP enrollment                     | Setup returned 200. Wrong confirmation returned 401 without invalidating the session. Valid confirmation returned 200 and ten recovery codes privately; the profile showed MFA enabled.         |
| TOTP login                          | Password without TOTP returned 403, `mfa_required`, code 2002. Wrong TOTP returned 401; correct TOTP returned 200. The RN `requiresTotp` parser recognized the real challenge response.         |
| TOTP disable                        | Wrong password returned 401 and preserved MFA/session state. Correct password returned 200; the profile showed MFA disabled.                                                                    |
| Service connection                  | An inert OpenAI connection was created/read/paused/resumed/replaced/deleted, with 200 responses and persisted state transitions. Its deleted detail returned 404 and disappeared from the list. |
| Catalog/approval lists              | Catalog and pending/history/grant lists returned 200. Approval lists were empty with pagination fields; decisions and card rendering were not exercised.                                        |
| Assistant enumeration               | Conversation/model lists returned 200 and passed the mobile schemas. No conversation turn or Agent-engine mutation was executed.                                                                |

The isolated catalog did not contain `llm-nyx`. A model enumeration response alone does not establish a working NyxAgent upstream. Real chat streaming, Agent execution/lifecycle effects, and external-provider authorization require an appropriately configured isolated integration environment.

The executed ad hoc harness commands were `python3 <private-qa-dir>/run-api-compat.py` and `node <private-qa-dir>/validate-mobile-schemas.cjs`. Their exact host paths are retained in the PR's local-verification record. The API/parser harness and raw private captures are temporary QA artifacts rather than checked-in automated tests.

## Native fixture preparation

A separate HTTP fixture is ready on loopback port 3303 for the actual RN app. It provides bootstrap/auth/account, Services/Agents, approvals/device/Agent Key/login-code routes, durable fixture histories, delayed SSE frames, and controlled failure/state transitions. Its smoke check observed four incrementally flushed deltas followed by two persisted messages; an accepted turn also settled after a pre-status transport disconnect.

These are **fixture-server smoke results**. The RN app has not consumed the fixture in a native runtime. Fixture-backed results will be labeled separately from real-backend acceptance and external-device/provider integration.

## Required native acceptance matrix

Every row is currently **pending**. Failures must be repaired and the affected path rerun before it is marked passed.

| Area                        | Required actual user paths and evidence                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Entry/navigation/layout     | Cold launch, login/logout, drawer and back navigation; safe areas; Unicode/multiline input; keyboard visibility and long-form scrolling.                                                                                       |
| Assistant streaming         | First turn and follow-up; visible partial reply before completion; one send request on double tap; server conversation adoption; persisted history without duplicates; pagination.                                             |
| Assistant recovery          | Stop; background/foreground; disconnect before/after adoption; conversation/Agent switching; no replayed effectful POST or implicit Stop; uncertain-delivery gate.                                                             |
| Assistant decisions/history | Allow/deny; server-owned continuation without duplicate turn; authored-skill Web review boundary; proxy approval route; rename/cancel/delete; retry eligibility; missing-history gap recovery; Markdown remote-image behavior. |
| Services                    | Sparse metadata, search, personal/org/platform ACLs; create and credential replacement; background clearing; enable/disable; cancel/confirm removal; 11500 explicit token-scope follow-up; errors without false success.       |
| Provider handoff            | Actual system-browser launch, cancel/return, pending state and authoritative completion readback. Genuine authorization additionally requires a disposable provider sandbox.                                                   |
| Agents                      | List/detail/status transitions; create; changed-field profile/model/mode updates; unavailable models; exact grants and concurrent-edit detection; memory; chat navigation; disposable destroy/delete.                          |
| Account                     | Native profile/session controls, current/other-session revocation; wrong/correct TOTP steps; authenticator/background return; masked recovery codes, copy/share and clearing; account-switch cache separation.                 |
| Retained device flows       | Approval decisions, trusted/untrusted QR handling, device/Agent Key/login-code preview/decision/status. Real camera scanning, push and link delivery require device/native configuration.                                      |

## Existing focused and CI checks

The implementation already passed 78 distinct dependency-related tests, syntax/relative-import checks for 46 changed files, and formatting checks for 34 explicit files. Those are pre-runtime checks. Mobile GitHub CI passed native-sync, tests, and semantic typecheck on `8c5f4d9` (run 38378346219, job 115232363190).

No full local frontend test/lint/typecheck or production build was run during this runtime-QA follow-up. Full frontend verification remains delegated to GitHub CI. GitHub Mobile CI does not establish actual native interactions or generate a verified native release artifact.
