# Native billing and machine management

This increment implements personal issue [#11](https://github.com/AbigailDeng/NyxID/issues/11) against the mobile integration branch. Source implementation and focused checks are separate from device and payment acceptance.

## Product entry points

In **Usage & credits**, expand **Manage credits, bills & organizations**. The existing personal balance, grants/allowances and optional service history remain available. Model, metric, quantity, layer and funding details can now be expanded within history.

The billing manager provides an explicit **Open my billing wallet** action, credit amount entry, secure checkout creation, paginated server recharge history, current bill/tax lines, invoice history and receipt downloads. Provider checkout and signed receipt documents open in the system browser. NyxID refreshes billing data after returning. Only a server recharge row with `status=paid` is displayed as paid; cancelling or closing the browser never confirms payment. Pending, expired, failed and voided server states remain distinct.

Checkout admits only a positive integer amount and an idempotency key. A request survives panel collapse and navigation remount within the current account epoch. An unknown result keeps the same key for retries. Failed refreshes cannot unlock the retry control, and a pending server record blocks a fresh native checkout. Once a checkout exists, the Web entry opens payment review rather than automatically opening another payment dialog. A different payment can be initiated deliberately on Web after reviewing the records.

Organization selection uses current memberships and separate owner query keys. Current bills, tax lines, invoices/receipts and benefits are read with the selected `owner_id`; lookup failure or removed membership disables those reads and receipt actions. The backend's `/billing/wallet/view`, usage and recharge-history reads are personal-only, so this increment deliberately keeps those personal. It does not reinterpret a personal wallet/history as organization data.

In **Machines**, the existing personal/organization-admin self-hosted list and native Desktop stay intact. A separate hosted list now displays resource, billing, authorization and cleanup status. Hosted creation opens `/assistant/machines/new?where=hosted`, under the existing admission feature flag. Managing a listed hosted machine opens `/assistant/machines?machine=<id>`; the Web resource detail owns price/quota preflight, pause/resume/delete, cleanup/retry, job output/cancellation, confirmation requests, cost and event panels. Native management refreshes on return and foreground re-entry. No hosted create/lifecycle mutation runs automatically in this screen.

In **Machines → Saved logins**, **Add saved login** offers the personal account and currently administered organizations. **Replace credentials** keeps the existing owner and explicitly replaces all values; blank password/authenticator fields remove the stored value. Exact HTTPS origins match the current server contract. Credentials live only in ephemeral input state and a direct transport call, never Query mutation variables/cache or analytics. Owner changes, backgrounding and cancellation clear credential fields. Entry requires native screen-capture/app-switcher protection. While saving, Back, tabs, refresh and browser handoff are locked. Lost authority or foreground after dispatch preserves an account review marker, including across editor remount; only a successful metadata refresh clears it.

## Acceptance still requiring a device or configured payment environment

- On iPhone, verify checkout success, cancellation, failure and delayed provider settlement; compare the server recharge row, wallet and receipt. No real payment was made for implementation tests.
- Test browser authentication for the configured NyxID frontend, returning to the correct native account, and explicit refresh while offline/after sign-out.
- Validate organization membership revocation and receipt access with real roles. Organization wallet and recharge history require a separate owner-aware read contract before native funding management expands.
- Verify hosted admission, pricing/quota review, lifecycle/cleanup, jobs, confirmations, costs/events in Web with the selected machine; no paid machine was created for these tests.
- On the installed native build, verify credential privacy protection, background clearing, keyboard behavior, organization owner selection, replacement semantics and metadata refresh. Local tests use mocked transport and native-module boundaries; they do not attest to real iOS privacy behavior.
- Full mobile suite, semantic typecheck and native/production build belong to GitHub CI under the personal frontend validation policy.
