# Mobile service console review and acceptance record

Review date: 2026-11-05. Personal PR: [#17](https://github.com/AbigailDeng/NyxID/pull/17). Issue: [#12](https://github.com/AbigailDeng/NyxID/issues/12).

## Scope decision

The first implementation exposed a generic Developer console directory with many `· Web` buttons. That was a poor mobile design: it made several Web routes look like native functionality and put a long list of secondary admin destinations in the primary Plugins/Services flow. The directory and its Plugins entry were removed in this follow-up.

The native scope is now explicit:

- Services owns connections and monitoring.
- A selected connection has one contextual Advanced settings Web action.
- An eligible SSH connection has one separate SSH terminal Web action.
- Agent Keys, Service Pools, Tools, Credential Nodes, Developer Apps, organization management, catalog/provider authoring and admin domains remain Web gaps tracked for future native work. A Web URL does not count as implementation.

## Repairs retained from the prior review

- Missing readiness evidence renders `Unknown`; only explicit server `not_configured` evidence renders `Not configured`.
- Browser handoff keeps account/connection authority checks and queues a same-account refresh on return.

## Follow-up changes

- Removed the generic `Service & developer console` entry from Plugins.
- Removed the generic Developer console card from the Services root.
- Replaced the multi-button Advanced list with one contextual Advanced/details action plus the distinct SSH terminal action.
- Removed the generic destination list and organization preflight transport/schema. Monitoring transport remains account- and exact-service-scoped.
- Added regressions for the single Advanced action, platform overview route, SSH action eligibility, and the absence of the generic Plugins entry.

## Focused local verification

Run from `mobile/`:

```sh
pnpm exec tsx --test \
  src/features/plugins/PluginsScreen.test.ts \
  src/features/services/console/consoleContracts.test.ts \
  src/features/services/console/consoleTransport.test.ts \
  src/features/services/console/AdvancedConnectionLinks.test.ts \
  src/features/services/console/ServiceMonitoringCard.test.ts \
  src/features/services/ServicesScreen.test.ts \
  src/features/services/serviceContracts.test.ts \
  src/features/services/connectionPresentation.test.ts
```

Changed-file formatting and syntax checks are limited to the files changed by this follow-up. Full frontend/mobile suite, lint, semantic typecheck and build are delegated to GitHub CI by the personal local-validation policy.

## Runtime boundary

The prior simulator walkthrough confirmed real monitoring reads and local invalid-path rejection. This design follow-up does not claim a valid probe, save/clear, billing/approval, organization-role, SSH command or physical-iPhone acceptance. Those require a deliberately chosen test service and user/device environment.
