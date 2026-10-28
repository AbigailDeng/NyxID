# NyxID Companion

NyxID Companion is a small desktop spirit that connects to NyxID Assistant.
Talk to it with text or your microphone: NyxID owns the conversation, connected
services, permissions, task execution and billing.

## Current scope

- Transparent, always-on-top desktop spirit with petting, directional drag,
  persistent window placement, tray controls and launch at login.
- Native NyxID device authorization, session refresh/logout, and a live summary
  of the user's authorized services from `GET /api/v1/keys`.
- Embedded Assistant chat with streaming replies, Stop and durable recovery
  after an interrupted send or application restart.
- Realtime voice in the same NyxID conversation, using eligible OpenAI WebRTC
  or xAI PCM services returned by NyxID. Select a service and voice, then start
  explicitly. Hold the microphone button (or Space/Enter while focused) to
  talk; release to send. Microphone mute, speaker mute, audio resume, captions
  and end-call controls are available during calls.
- Accepted NyxID tasks continue after a call ends. Return to text chat to see
  their persisted progress/results or stop an active task. Approval cards and
  other rich task controls remain available in NyxID Assistant.

## Requirements for voice

Voice requires the native desktop app, a microphone, NyxID login, the account's
`assistant:voice` feature, and an available voice-enabled service/connection.
Provider availability, permissions, limits and pricing come from NyxID. Audio
and task execution may have separate charges. No provider API key or thread
Agent Key is passed to the webview.

The app requests microphone access only after **Start voice call**. macOS
bundles declare microphone usage and audio-input entitlement. If microphone
access was denied, enable NyxID Companion in System Settings → Privacy &
Security → Microphone. Browser development displays the product UI and reports
native account/voice functionality as unavailable.

## Development

```bash
cd desktop/companion
npm ci
npm run dev
```

Open <http://127.0.0.1:1420>. Reuse an existing development tab/server when
available. Browser mode stores names/onboarding in `localStorage` and simulates
launch-at-login; it does not simulate authenticated chat or voice results.

For native development, install the host's
[Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/) and run:

```bash
cd desktop/companion
npm run desktop:dev
```

On macOS, package the already compiled native development binary for local
microphone checks with explicit ad-hoc signing. Keep its Vite development
server running and run from this directory:

```bash
APPLE_SIGNING_IDENTITY=- pnpm exec tauri bundle \
  --debug --bundles app --ci --no-binary-patching
```

This debug package loads the development server. Ad-hoc signing applies the
audio-input entitlement and seals the bundle, but provides neither Apple
Developer ID distribution trust nor notarization. The macOS CI bundle also
uses ad-hoc signing and verifies the resulting signature and microphone
permissions; public distribution requires its own signing and notarization.

## Persistence and transport

`companion-snapshot.json` in the OS application-data directory for
`dev.nyxid.companion` stores only the spirit's name, the user's preferred name
and onboarding completion (`schemaVersion: 2`). Upgrading from the previous
version keeps these fields and rewrites the file without the retired routine,
preferences or history. The browser performs the same migration. Native window
placement is retained separately.

Access/refresh tokens and pending device-login recovery material stay in Rust
and the OS keychain. The chat outbox stores request identity only. Voice uses
bounded, authenticated native HTTP/WebSocket requests to NyxID; provider
credentials stay on the server. The webview handles ephemeral microphone audio
and playback. Ending a call, losing the session or logging out releases local
media. A lost end response is reported and NyxID's heartbeat expiry closes the
server session. Transcripts and task state follow NyxID's retention policies.

## Focused verification

Run dependency-related tests for the changed files, and explicitly run any
changed or new tests. For example, voice changes use:

```bash
pnpm exec vitest run src/components/voice-panel.test.tsx \
  src/runtime/voice-client.test.ts src/runtime/voice-bridge.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --lib nyxid::voice::tests
```

Run ESLint/Prettier only on changed frontend files selected by the scope
analyzer. There is no affected TypeScript target; GitHub Actions owns full
frontend typechecking, the complete test suite and production/native builds.
Transport unit tests use fixtures and do not establish successful paid
provider calls or microphone permission behavior on every host OS.

Actual macOS smoke-test observations and remaining manual checks are recorded
in [NATIVE_VOICE_ACCEPTANCE.md](NATIVE_VOICE_ACCEPTANCE.md).
