# Native billing and machine management

This increment implements personal issue [#11](https://github.com/AbigailDeng/NyxID/issues/11) against the mobile integration branch. Source implementation and focused checks are separate from device and payment acceptance.

## Product entry points

In **Usage & credits**, expand **Manage credits, bills & organizations**. The existing personal balance, grants/allowances and optional service history remain available. Model, metric, quantity, layer and funding details can now be expanded within history.

The billing manager provides an explicit **Open my billing wallet** action, credit amount entry, secure checkout creation, paginated server recharge history, current bill/tax lines, invoice history and receipt downloads. Provider checkout and signed receipt documents open in the system browser. NyxID refreshes billing data after returning. Only a server recharge row with `status=paid` is displayed as paid; cancelling or closing the browser never confirms payment. Pending, expired, failed and voided server states remain distinct.

Checkout admits only a positive integer amount and an idempotency key. A request survives panel collapse and navigation remount within the current account epoch. An unknown result keeps the same key for retries. Failed refreshes cannot unlock the retry control, and a pending server record blocks a fresh native checkout. Once a checkout exists, the Web entry opens payment review rather than automatically opening another payment dialog. A different payment can be initiated deliberately on Web after reviewing the records.

New-payment admission uses a separate read of recharge history, not the visible history page. It scans up to ten pages of fifty records and stops at a pending payment. Loading, failed or incomplete review keeps new native checkout disabled and opens ordinary Web review without automatically starting a top-up. The current history page still refreshes independently.

Organization selection uses current memberships and separate owner query keys. Current bills, tax lines, invoices/receipts and benefits are read with the selected `owner_id`; lookup failure or removed membership disables those reads and receipt actions. The backend's `/billing/wallet/view`, usage and recharge-history reads are personal-only, so this increment deliberately keeps those personal. It does not reinterpret a personal wallet/history as organization data.

Organization members can read benefits; bills and receipts require a current organization Admin. In-flight receipt actions are invalidated by owner changes, source refresh/failure, membership loss, hiding the panel or leaving the active view. Returning to the same selection does not revive an old action.

Manual organization billing refresh rereads grants, allowances and current membership, including for ordinary members. Either benefit-read failure clears the prior success notice and prevents the refresh from being reported as verified; member refresh does not request Admin-only bills or receipts.

In **Machines**, the existing personal/organization-admin self-hosted list and native Desktop stay intact. A separate hosted list now displays resource, billing, authorization and cleanup status. Hosted creation opens `/assistant/machines/new?where=hosted`, under the existing admission feature flag. Managing a listed hosted machine opens `/assistant/machines?machine=<id>`; the Web resource detail owns price/quota preflight, pause/resume/delete, cleanup/retry, job output/cancellation, confirmation requests, cost and event panels. Native management refreshes on return and foreground re-entry. No hosted create/lifecycle mutation runs automatically in this screen.

In **Machines → Saved logins**, **Add saved login** offers the personal account and currently administered organizations. **Replace credentials** keeps the existing owner and explicitly replaces all values; blank password/authenticator fields remove the stored value. Exact HTTPS origins match the current server contract. Credentials live only in ephemeral input state and a direct transport call, never Query mutation variables/cache or analytics. Owner changes, backgrounding and cancellation clear credential fields. Entry requires native screen-capture/app-switcher protection. While saving, Back, tabs, refresh and browser handoff are locked. Lost authority or foreground after dispatch preserves an account review marker, including across editor remount; only a successful metadata refresh clears it.

Each write captures its lifecycle generation. A background/foreground or blur/focus cycle permanently invalidates that attempt even if React batches the transition; it cannot continue a deferred credential write after returning. Duplicate queued submit handlers cannot release the navigation lock held by the first save.

## Simulator acceptance (2026-11-03)

The existing iOS 26.3 simulator loaded this PR's JavaScript through the installed development client, build 36. Live reads confirmed personal billing, current tax totals, invoice history, expanded usage details and an actual signed invoice document in the system browser. Browser close returned to native billing and refreshed records. Initial payment-review loading and a zero credit amount both disabled new checkout. An ordinary organization member saw benefits and the Admin-only bill/receipt explanation, without personal checkout controls.

Hosted inventory was empty. The hosted setup entry opened NyxID Web login, so authenticated pricing, quotas and resource lifecycle remain unverified. The saved-login editor initially refused credential entry because privacy initialization did not complete. That observation did not establish a missing native module; the follow-up below corrects the earlier attribution to build 36. No payment, paid machine or credential mutation was performed. Focused component/transport regressions cover lifecycle and submit races with mocked native/network boundaries; they do not replace those device and service checks.

## Simulator follow-up (2026-11-04)

Reused iPhone 16e / iOS 26.3 and development client build 36, with this branch's JavaScript served on Metro 8086. Runtime inspection confirmed the registered ExpoScreenCapture module exposes capture prevention and app-switcher protection methods. The editor then initialized protection successfully and enabled credential inputs. Synthetic, unsaved username/password and authenticator values could be entered; backgrounding and returning cleared all credential fields. Cancel returned to the empty metadata list without saving. The earlier initialization failure's cause remains unknown. This verifies initialization and field clearing in the simulator, not physical-device capture prevention or an actual credential create/replacement.

Live reads again confirmed personal bill/tax lines, invoice history, an empty recharge history, zero-amount checkout rejection, and ordinary organization-member benefits without personal payment or Admin receipt controls. The organization refresh action completed successfully after the missing grants/allowances refresh was fixed. Its independent success/failure regressions verify both reads and reject stale success after either fails. Nine related test files passed 82 tests; component/transport checks remain separate from live service acceptance.

## Acceptance still requiring a device or configured payment environment

- On iPhone, verify checkout success, cancellation, failure and delayed provider settlement; compare the server recharge row, wallet and receipt. No real payment was made for implementation tests.
- Test browser authentication for the configured NyxID frontend, returning to the correct native account, and explicit refresh while offline/after sign-out.
- Validate organization membership revocation and receipt access with real roles. Organization wallet and recharge history require a separate owner-aware read contract before native funding management expands.
- Verify hosted admission, pricing/quota review, lifecycle/cleanup, jobs, confirmations, costs/events in Web with the selected machine; no paid machine was created for these tests.
- On a physical iPhone, verify capture/app-switcher protection and keyboard behavior; complete authorized credential creation/replacement, organization owner selection and metadata refresh. The simulator demonstrated privacy initialization and background clearing, while local tests use mocked transport and native-module boundaries.
- Full mobile suite, semantic typecheck and native/production build belong to GitHub CI under the personal frontend validation policy.
