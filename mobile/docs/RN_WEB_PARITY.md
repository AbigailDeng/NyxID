# React Native Web migration — first core increment

This increment starts the mobile migration against the existing NyxID Web and backend contracts. It changes frontend code only; it does **not** deliver full Web parity. Machines are excluded from the migration. The visual reference remains the user-supplied `finalized.html` and the approved [RN Figma design](https://www.figma.com/design/1cxfGMnsqcwgxwxUWyTFrI?node-id=1-557).

## Implemented scope

| Area        | Current RN behavior                                                                                                                                                                                                                                                                                                                                                                                                                       | Source and contract                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace   | Chat-first entry, drawer navigation to Chats/Agents & Crews/Plugins/Automations/Approvals plus the account footer, native page stack, themed shared fields/cards/buttons, keyboard and safe-area handling. Existing scan/device/Agent Key/login-code entries remain available.                                                                                                                                                           | [AppNavigator](../src/app/AppNavigator.tsx), [WorkspaceDrawer](../src/components/workspace/WorkspaceDrawer.tsx), [WorkspaceUI](../src/components/workspace/WorkspaceUI.tsx), [existing authentication](../src/features/auth/)                                                                                                                                                                                                                 |
| Assistant   | Persisted conversations and paginated history, text/attachment-only turns with native SSE transport, native multi-file uploads, pending-file removal, authenticated image preview/document saving, Markdown and activity, Stop, explicit failed-work retry, acknowledgement decisions, proxy approval links, rename/delete, model selection for **new** chats. On foreground return it reads authoritative history and active-turn state. | [AssistantScreen](../src/features/assistant/AssistantScreen.tsx), [useAssistant](../src/features/assistant/useAssistant.ts), [assistantApi](../src/lib/api/assistantApi.ts); `/assistant/nyxagent/{conversations,turns,models}` and conversation `/stop` / `/acknowledgements/{id}`. Web reference: [NyxAgent schemas](../../frontend/src/schemas/assistant-nyxagent.ts).                                                                     |
| Services    | Live connection list and catalog, search, details, enabled state, eligible credential replacement, removal confirmation, API-key and declared token-exchange credential fields, platform-key binding, managed OAuth in the system browser with a connection-specific `key_id`. Success is verified by re-reading the connection.                                                                                                          | [ServicesScreen](../src/features/services/ServicesScreen.tsx), [servicesApi](../src/lib/api/servicesApi.ts); `/keys`, `/catalog`, `/providers/{id}/connect/oauth`. Web reference: [key hooks](../../frontend/src/hooks/use-keys.ts), [connection wizard](../../frontend/src/components/dashboard/add-key-dialog.tsx).                                                                                                                         |
| Plugins     | Native Connectors / Skills, grouped real connections and catalog, direct setup reuse, Overview / Advanced / History, current-agent pins, Ornn catalog/versions/package previews, revision-fenced attachment and removal, skill history, draft editor and exact-card owner review. Advanced/scope/specialized setup/Studio use explicit Web handoffs.                                                                                      | [PluginsScreen](../src/features/plugins/PluginsScreen.tsx), [PluginSkills](../src/features/plugins/PluginSkills.tsx); existing `/keys`, `/catalog`, `/assistant/nyxagent/agents/{id}/skills` and `/learning/proposals` contracts.                                                                                                                                                                                                             |
| Agents      | Live list/details; personal specialist creation; changed-field profile edits, model for new threads, confirmation-mode override; service and guest access, account-read grant, memory add/forget, thread navigation, destroy and permanent deletion of destroyed specialists. Existing organization agents use their actual maintenance permission and exact service IDs.                                                                 | [AgentsScreen](../src/features/agents/AgentsScreen.tsx), [agentsApi](../src/lib/api/agentsApi.ts); `/assistant/nyxagent/agents`, agent `/grants`, `/memory`, `/destroy`, and `/assistant/nyxagent/models`. Web reference: [Agent forms](../../frontend/src/components/assistant/nyxbot-agent-forms.tsx), [Agent details](../../frontend/src/components/assistant/nyxbot-agent-details.tsx).                                                   |
| Crews      | Real crew list, personal/organization creation, member and participant selection, crew transcripts with working status and older pages, explicit recipient chips and mentions, shared native uploads/attachment access, pending decisions and exact draft review, feedback, rename/membership/lead settings and Leave/Delete with role gates.                                                                                           | [GroupsList](../src/features/groups/GroupsList.tsx), [GroupChatScreen](../src/features/groups/GroupChatScreen.tsx), [GroupEditorScreen](../src/features/groups/GroupEditorScreen.tsx), [groupsApi](../src/lib/api/groupsApi.ts); `/assistant/nyxagent/groups`, crew messages/attachments/feedback, existing organization and approval contracts. Web reference: [Crew view](../../frontend/src/components/assistant/nyxbot-group-view.tsx). |
| Automations | Native list/search/Agent and status filters, source-aware four-step create/edit/review, cron/interval/once with server previews and IANA timezone, webhook verification, four delivery types, one-time secrets, pause/resume/run/delete, paginated run history and contextual thread links, scheduling preferences. Agent entries and trusted chat setup links reuse the same flow.                                                       | [AutomationsScreen](../src/features/automations/AutomationsScreen.tsx), [AutomationEditorScreen](../src/features/automations/AutomationEditorScreen.tsx), [automationsApi](../src/lib/api/automationsApi.ts); existing `/triggers` and `/assistant/nyxagent/settings`. Web reference: [Automations](../../frontend/src/pages/automations.tsx).                                                                                                |
| Account     | Display-name/avatar update, session list/revocation, TOTP enrollment/confirmation/disable, first-time recovery-code display and explicit copy/share. Existing appearance, notifications, logout, account deletion and legal pages remain.                                                                                                                                                                                                 | [AccountSecurityScreen](../src/features/account/AccountSecurityScreen.tsx), [accountApi](../src/lib/api/accountApi.ts), [AccountSettingsScreen](../src/features/account/AccountSettingsScreen.tsx); `/users/me`, `/sessions`, `/auth/mfa/{setup,confirm,disable}`.                                                                                                                                                                            |
| Approvals   | Existing Pending/Grants/History and decision flows retain organization context and decision idempotency. Evidence now uses server expiry, tool arguments, resource and destructive metadata; no fixed 24-hour expiry or fabricated location/risk from HTTP method alone.                                                                                                                                                                  | [ActivityScreen](../src/features/activity/ActivityScreen.tsx), [ApprovalEvidence](../src/features/activity/ApprovalEvidence.tsx), [approvalAdapter](../src/lib/api/approvalAdapter.ts); `/approvals/requests`, request `/decide`, `/approvals/grants`.                                                                                                                                                                                        |

## Contract boundaries

Chat ownership and navigation align one-to-one Agent selection with Web: saved thread owner first, explicit Agent second, NyxBot by default. History is Agent-scoped, New chat retains the current Agent, selecting an Agent opens its latest thread, and the drawer Chats entry restores the existing chat screen and draft. Workspace sibling selection retains mounted page state without adding native stack history; contextual Agent/Skill chats use separate detail routes and return to their exact caller. Workspace header returns preserve local detail/form history before route history. The Agents & Crews hub follows the approved paired tabs. UI copy calls shared agent conversations Crews; server contracts, identifiers and existing native links retain `groups`. Web still uses `/assistant?g={id}`, so no URL migration is needed. Crew chats and settings use dedicated native detail routes and retain their list tab and calling transcript.

The chat header separates the current title from labeled History/New chat actions, marks the selected history item Current, and replaces the anonymous menu with Details. Actual model context stays in Details with new-draft selection; saved-chat rename/delete retain their existing contracts. Workspace headers show exactly one navigation control on the left: Menu at a top-level destination, Back for local/native details, and Close inside temporary sheets. The header role follows page hierarchy rather than global stack history. Controls retain 44-point targets and critical navigation-disabled guards. Android Back consumes local detail state first, then native detail history; top-level sibling visits do not create Back history.

Backend contracts remain in [NyxAgent handlers](../../backend/src/handlers/assistant_nyxagent.rs), [Agent management handlers](../../backend/src/handlers/assistant_team.rs), [key handlers](../../backend/src/handlers/keys.rs), [catalog handlers](../../backend/src/handlers/catalog.rs), [provider authorization handlers](../../backend/src/handlers/user_tokens.rs), and [auth/MFA handlers](../../backend/src/handlers/auth.rs). No changes to these files are required or included.

- Crew membership is separate from message recipients. Native recipient edits and @mentions follow Web precedence, with server defaults when untouched; the server orchestrates the addressed agents. Organization creation is capability-gated, while access to existing crews follows live participation. An uncertain POST consumes the submitted draft and blocks further sends until an explicit authoritative refresh. Crew settings use refreshed authority and changed fields; backend APIs have no compare-and-swap revision, so a read-before-write conflict check cannot eliminate every concurrent edit.
- Active Crew lists and transcripts share the existing authenticated `/assistant/nyxagent/live` metadata stream. Crew/member changes invalidate authoritative reads using Web's 150 ms transcript and 2 s list batching; ready/reconnect/resync catch up the current account. Wanted polls slow to a 30 s backstop only after `ready`, and resume their existing intervals on disconnection or unsupported servers. Blur, background, offline and account changes release or fence the subscription. Crew answers remain complete persisted messages: this endpoint does not carry partial response text, and live refresh never unlocks an uncertain send automatically.
- Private and crew messages expose Copy for the exact message body, retaining Markdown, code and URLs. Rendered reply paragraphs and code blocks also support native long-press copying; selection is per native text block rather than across an entire Markdown reply. Copying a live private response captures only the text received so far. Empty or attachment-only bodies have no text-copy action; attachments retain their own Share/Save flow.
- Automations use personal first-party sessions and existing agent authority. Source and inbound verification remain immutable on edit. Run-now admission is displayed as queued/started, not completed. Runs poll only while the screen is focused and the app is active; history links open the exact conversation without replacing the primary chat. One-time creation/signing secrets remain transient and hidden while backgrounded. Actual provider/channel delivery still requires its configured connection; full Channel management and advanced Trigger rotation/replay remain Web handoffs.
- User management uses the user's first-party login session. A restricted Agent Key is not a substitute for full account management authorization. Existing SecureStore, single-flight refresh, push registration and QR validation are reused.
- The server owns state, permissions and supported models. Connection editing respects `can_edit_configuration`, ownership and platform-managed restrictions. Organization service grants retain exact IDs. Agent profile PATCH sends only changed fields; grants replace the selected service access. A fresh read detects conflicts before saving, but these endpoints do not expose a compare-and-swap revision contract, so the client cannot guarantee an atomic edit against concurrent writers.
- Typed credentials and MFA secrets are transient and cleared or masked when leaving the relevant screen/backgrounding. They are not persisted in navigation parameters or query caches. Missing optional catalog/key metadata follows the backend's omitted-field serialization.
- Disconnecting the mobile SSE subscription does not resend the POST. Existing NyxAgent durable execution may continue; recovery reads history before allowing further work. Uncertain sends are not automatically replayed. This is not a guarantee that mobile SSE/audio stays alive in the background.
- Shared OAuth grant removal is not silently cascaded. Error `11500` offers an explicit token-scope single-service removal path, subject to server support. Full sibling-grant cascade review is a follow-on UI.
- **Password change is unavailable without backend work.** [Web Settings](../../frontend/src/pages/settings.tsx) explicitly says `/auth/password/change` is not implemented; its existing form is ahead of backend integration. There is no working password-change path to port in this increment. Earlier feasibility wording that included password change was too broad.
- Real verification/reset email delivery and verification-email resend are incomplete. Main’s password/social MFA challenges accept authenticator or single-use recovery codes, and default-off `auth:mobile-mfa` gates signed-in authenticator/recovery step-up. Codes and pending retries are transient, account-fenced and cleared on background/dismissal; verification never resubmits the first-factor password. Bad-code 401s preserve the signed-in session. Recovery-code re-reading/regeneration is not presented as an included flow.
- OAuth/push/Universal Links/payment/voice still depend on their documented deployment and native configuration. Closing a browser alone is not proof of authorization or payment completion. Native voice admission compatibility is not established.

## Follow-on frontend work

The following existing Web capabilities are **not yet migrated** by this first increment:

- Chat steering submission, feedback, and switching an existing thread's model. Historical steering may be displayed, but those editing/input paths are not implemented. Conversation and crew attachment upload/download/preview are included; crew message feedback is also supported.
- Operation-level grants, native advanced Triggers rotation/delivery replay and full Channel management. Automations links to Web Triggers for secret rotation and delivery history/replay. Native exact-version Skills and Learning review/publication are implemented.
- Organization creation/membership/invites and organization resource creation beyond the crew journey, Billing and hosted checkout, full Studio resources including service pools/Agent Keys, Developer OAuth apps and role-gated Admin modules.
- Credential Nodes and SSH management/native terminal, specialized device-code/BYO OAuth/SSH connection setup, OAuth scope editing and full shared-grant cascade review. These currently require the corresponding Web setup.

Artifacts/Assistant Activity/folder placeholders are not treated as new durable backend resources. Machines management now includes the retained drawer destination, canonical inventory/detail/logins links, personal/org Admin filtering, hosted exclusion, local capability and isolation metadata, and web handoffs. Owner confirmation/single-user-login policy, automatic-update policy, confirmed update requests, metadata activity and saved-login list/removal use first-party-human APIs with live writer checks. Policy/update saves are independent; queued/manual/failed responses never imply completion. Login removal quarantines contexts and removes specialist login grants. Creation and verified manual update commands stay on Web. The owner-policy endpoints have no CAS contract: fresh-read conflict checks cannot eliminate a concurrent writer race. Native viewer integration and remaining release gates are described below. The password-change correction above takes precedence over the earlier design feasibility assessment.

## Native UI alignment after main integration

Agent details include a dedicated machine access drawer page. It uses revisioned agent-machine APIs with five capability switches, preserves saved-login scope and service grants, and requires browser access for computer/developer browser. Selection-required, shared legacy, separation refusal, revocation, delivery and quarantine remain visible. Context changes request an owner action card; requesting does not apply the change. The context-request endpoint snapshots the live assignment on the server rather than trusting the submitted selection; the client rereads revision/ownership before dispatch. External API-key/OAuth machine grants remain deferred.

The desktop viewer is registered as a full-screen root route outside the management drawer. Detail entries use live session/context metadata; chat machine receipts open only their linked conversation sessions and preserve context/display selectors. Native capture prevention and app-switcher protection are prerequisites to mounting the viewer; older development binaries fail closed for this route. Stream B owns desktop transport/rendering and backend admission. Native frame performance, app-switcher snapshots, Android and production proxy behavior remain release gates until device evidence is recorded.

The [native route inventory](NATIVE_WORKSPACE_ROUTES.md) enumerates every module,
management stack registration, shared auth/legal entry, cold fallback and
challenge path. One retained management drawer adopts safe-area-top +10pt,
24pt corners, a 36×4pt handle in a 44pt drag target, left-aligned 18pt title,
44pt circular Close, nested Back and a dedicated translucent scrim.
The scrim remains stationary and fades in/out independently of the sliding
panel; the native transparent route adds no second slide transition. Everything
inside the drawer uses an elevated drawer palette (surface, cards and quieter
text tones step up together) with a hairline top edge, so the drawer stays
distinct from the dimmed chat in dark mode, where the chat background alone
measured 1.02:1 against it. Async guards
remain authoritative for dirty/pending dismissal and notification deferral;
forced sign-out clears the account stack. Retained chat and custom header
accessibility descendants are hidden while management is open.

Private user bubbles and compact crew/private headers follow the native
reference while preserving real speaker attribution. Private, contextual and
crew chats share one ChatGPT-style composer: a filled pill with full-width text
above a toolbar containing "+" for attachments, optional mentions, dictation and a
trailing send/stop circle. "+" offers Photos (the system photo library) and Files
(the document browser). Unsupported photo formats such as HEIC are converted to
JPEG from selected cache copies, retaining the same upload validation and account
ownership fences. Crew recipient chips and pending files stay inside the pill
above the text. Chat pages use 12pt horizontal and 4pt bottom padding plus the
system safe area. The side-navigation footer combines its bottom padding with
the safe-area clearance instead of stacking both. iOS sizes
the multiline input to its text under the shared cap; Android applies the
measured height. Display
preferences use AsyncStorage on this device: default column maximum 758pt,
wide-window-only width controls and the existing 120pt native composer maximum,
clamped to keyboard/window space. Reset changes layout only. Shared conditional
fades cover side navigation and measured chat overflow/edges, with transcript
follow handlers called first.
Settings identity, label/value and control rows stack at narrow effective widths
while preserving system text scaling. Settings and Display labels refresh their
native text measurements when system text size changes, retaining page, scroll
and control state. Display uses fixed-size step icons in
labelled 44pt targets, with scalable labels/values and wrapping control rows.
The native semantic text palette now meets 4.5:1 on base/card/cardSoft surfaces.
Dictation uses the device speech recognizer with microphone/speech permission,
shows a review, and inserts editable text only after acceptance. It never sends a
message automatically and releases capture on background, chat/account change,
loss of access or drawer presentation. It requires an app build containing the
speech recognition module; older builds retain keyboard dictation and text entry.
Eligible private chats with the server's `assistant:voice` capability also expose
a waveform action in the trailing Send slot for the existing voice conversation surface. Crew
voice conversations are unsupported. Provider audio and microphone behavior
still require device verification; JavaScript exports do not establish acoustic
or provider compatibility. No iOS orientation/tablet support, RN-web, native rail
or live desktop capability was added.


The side menu expands one agent's saved threads directly beneath its row, newest
first, with a shallow guide line, relative times, Current, Needs you and Running
labels. Its header stays pinned while those threads scroll. Channel chats are
separate counted bot disclosures (opaque connection IDs), with parent/topic
labels when supplied; the current child stays visible and Show more expands the
loaded batch. New chat with the agent follows the thread rows. Crews retain a
separate section with the same current/status/time language. Existing bounded
previews and searchable all-items browsers keep long accounts navigable; older
cursor pages remain explicit. The shared authenticated metadata stream refreshes
agent, crew and thread reads, with foreground/offline/account fences and polling
fallback. No server contracts or URLs change.

An idle primary NyxBot draft now shows Home above the existing Message NyxBot
composer: the web's local-time greeting, While you were away (exact pending
request links, latest replies/current work and Show more), Your agents grouped
by Personal/organization owner ID, and Crews. These use the existing profile,
agent summaries and crew APIs; no activity rows are inferred from missing data.
The shared metadata stream and foreground polling refresh the reads. Loading,
failed and offline reads retain honest notices; older responses without the
optional summary fields have no away rows. Hi, I'm NyxBot remains the empty-team
copy. Saved conversations, specialists, contextual drafts and in-progress sends
retain the transcript. Home scrolls independently of transcript follow intent.
Memory previews from web Home are outside this requested increment.

Agent identity now shares the web's `AgentAvatar` and crew stack treatment across
Home, the side menu, chat headers, Agents & Crews, mention/selection controls and
machine agent access. The six tints, FNV-1a index, ASCII word initials and five
sizes are ported exactly; Home follows the source's `lg` (32pt) size. NyxBot uses
the vector product mark at 70% inside the purple circle. Decorative avatars stay
out of the accessibility tree; the containing row supplies the full name and
status. Crew stacks overlap and cap with +N.

The exact web tint table carries contrast exceptions. Across chat and drawer
cards, dark purple/blue initials reach minima of 3.46:1/3.36:1; light secondary
purple/green with white initials reach 4.29:1/3.77:1. Dark circle edges range
1.62–2.08:1 against their cards; light edges exceed 3:1. These decorative marks
retain source parity and do not carry an action, name or status alone. The full
adjacent name/status uses the tested accessible theme tokens. Fixed web vectors
and the explicit contrast exceptions are covered by `agentAvatarModel.test.ts`;
these measurements do not claim that every decorative initial meets text AA.

The header's Choose agent sheet reuses the side-menu hierarchy and live reads:
agent avatars, explicit Personal/organization owner, current checkmark, running
or Needs you status, recent threads and channel sub-thread groups. Tapping an
agent discloses its threads; New chat with the agent follows them. The sheet's
This thread card shows available title/agent/model/activity/message-count data
and opens the existing Details/History sheets. Manage agents remains available.
Selecting the current thread retains its unsent draft; changing thread follows
the existing History behavior and clears the old draft. A new chat starts a
fresh draft for the selected agent. The hierarchy owns one scroll host, retaining
pinned headers and the bounded previews/all-items browser.

Usage & credits is registered inside the management drawer, with entries in
Settings and the side-menu account area. The menu finishes native dismissal
before opening it. It uses Stream B's read-only screen and optional period/owner
parameters. The web account-panel URL `/assistant?panel=billing` is accepted by
the native link parser; `panelPeriod` selects 24h/7d/30d, and supported chat/crew
parameters retain the addressed conversation underneath. Cold nested Back opens
Settings, and Close returns to that chat. The native `/account/usage` route also
accepts period/ownerId; the screen verifies owner eligibility. Web purchase,
service and tab parameters are not forwarded as native actions. This navigation
adds no wallet/provisioning/checkout request. Wallet availability and API support
remain the read-only screen's responsibility.
