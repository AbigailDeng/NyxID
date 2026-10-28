# Native voice acceptance — 2026-10-28

## Environment and scope

- macOS 15.7.7 (24G720), Apple Silicon.
- Native Tauri `.app`, bundle ID `dev.nyxid.companion`, version 0.1.0.
- Real NyxID device login and the account's available GPT-Live 1 service with
  Marin voice; no mock authentication, provider session or captions.
- Debug application loading the existing Vite server at
  `http://127.0.0.1:1420/`. This is not a standalone release or notarized build.
- No full frontend test, typecheck or production build was run locally.

## Completed observations

| Check                       | Observed result                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Device login                | Existing browser Google session completed NyxID device approval; the native app loaded eligible voice services and real pricing. |
| Restart recovery            | The rebuilt and signed application restored the NyxID session without another login.                                             |
| Legacy product name         | The old built-in name migrated to Nyx; native UI displayed Nyx.                                                                  |
| Bundle microphone metadata  | Generated `Contents/Info.plist` contains the expected bundle ID and `NSMicrophoneUsageDescription`.                              |
| Effective audio entitlement | `codesign -d --entitlements -` reports `com.apple.security.device.audio-input=true`.                                             |
| Bundle signature            | `codesign --verify --deep --strict --verbose=2` exits 0; ad-hoc hardened-runtime signature is valid on disk.                     |
| Live provider connection    | Explicit Start completed microphone initialization and transitioned to “语音已连接”.                                             |
| Provider downstream events  | The live session delivered the caption “Quick heads up: this call will end in fifteen seconds unless you say something.”         |
| Idle close                  | The same session automatically transitioned to “通话已结束”.                                                                     |
| OS permission ownership     | System Settings → Privacy & Security → Microphone listed NyxID Companion with access enabled.                                    |

The first unsigned debug bundle retained a linker signature and had no effective
entitlements. Explicit ad-hoc signing through Tauri fixed the acceptance artifact;
no permanent signing identity was added to the source configuration.
The macOS CI build now explicitly uses ad-hoc signing and checks the generated
signature, microphone usage description and effective audio-input entitlement.
The exact CI check script passed locally against this debug artifact.

The live idle-close check also exposed a stale “call will end soon” notice after
the call had ended. The notice is now limited to active calls, with a regression
that closes a session while its last snapshot still has `idle_warning=true`.

## Incomplete checks

- First-request permission dialog: the initial call already had OS permission.
  Only this application's microphone approval was reset with
  `tccutil reset Microphone dev.nyxid.companion`; another Start now waits for
  system approval. Computer Use refuses access to
  `com.apple.UserNotificationCenter`, so a human must accept the system dialog.
- A spoken push-to-talk request and audible reply have not been confirmed.
  The available native automation API has no sustained pointer/key hold.
- In-call microphone/speaker mute, explicit hangup and OS capture-indicator
  disappearance still need live verification.
- xAI PCM, microphone denial/revocation/device loss, and standalone release
  origin/notarization are not covered by this session.

A connected state and provider caption establish a real session and downstream
events; they do not establish intelligible bidirectional audio or release-build
acceptance.

## Reproducing this debug artifact

Keep the existing Vite development server running. From the repository root:

```sh
cargo build --manifest-path desktop/companion/src-tauri/Cargo.toml --bin nyxid-companion
```

From `desktop/companion`:

```sh
pnpm exec tauri bundle --debug --bundles app --ci --no-binary-patching \
  --config '{"bundle":{"macOS":{"signingIdentity":"-"}}}'
```

`--no-binary-patching` preserves the development executable's URL. The temporary
signing identity makes the bundler apply the configured entitlement. The result
is `src-tauri/target/debug/bundle/macos/NyxID Companion.app`.

## Focused regression checks for the acceptance fix

From `desktop/companion`, all passed:

```sh
pnpm exec vitest related src/domain/companion.ts --run
pnpm exec vitest run src/domain/companion.test.ts
pnpm exec eslint src/domain/companion.ts src/domain/companion.test.ts
pnpm exec prettier --check src/domain/companion.ts src/domain/companion.test.ts
```

Related tests: 5 files, 78 tests. Explicit domain tests: 1 file, 9 tests.
From the repository root, all passed:

```sh
cargo test --manifest-path desktop/companion/src-tauri/Cargo.toml --lib persistence::tests
cargo test --manifest-path desktop/companion/src-tauri/Cargo.toml --lib model::tests
rustfmt --edition 2024 --check desktop/companion/src-tauri/src/persistence.rs
```

Persistence tests: 5 passed. Model filter: 6 passed. The migration replaces only
the exact retired built-in name across old and current snapshots, including an
explicitly chosen name equal to that one value; other names and identity
settings are preserved. Full frontend verification remains assigned to GitHub CI.

The idle-notice fix also passed these commands from `desktop/companion`:

```sh
pnpm exec vitest related src/components/voice-panel.tsx --run
pnpm exec vitest run src/components/voice-panel.test.tsx
pnpm exec eslint src/components/voice-panel.tsx src/components/voice-panel.test.tsx
pnpm exec prettier --check src/components/voice-panel.tsx src/components/voice-panel.test.tsx
```

Related tests: 2 files, 46 tests. Explicit voice-panel tests: 1 file, 9 tests.
