# Native workspace route inventory

The root workspace retains its conversation while a single `WorkspaceSheet`
management stack is open. Module tabs are hidden and retained, with no native
bottom tab bar. The transient side menu closes before management navigation.
Canonical URLs, notification challenges and in-chat links use the same helpers
in `navigationHierarchy.ts` and `workspaceChatNavigation.ts`.

| Navigator / registered screen | Entry and nested behavior |
| --- | --- |
| ChatTabs / Assistant | Explicit Home or personal/specialist chat state; avatar/name/thread-info header. New chat with any agent, including NyxBot, is a normal empty chat with its intro and composer. |
| Root / AssistantContext | Contextual chat; full interaction surface, native Back. |
| Root / GroupChat | Crew conversation; actual name/ownership context/settings in one header, member details in the chip strip. |
| Tabs / Automations | Drawer module; AutomationDetail, Editor, Runs, Preferences. Agent-scoped entry preserves its filter. |
| Tabs / Agents | Agents & Crews drawer module; AgentCreate, AgentDetail, AgentSkills, GroupEditor. Choosing a chat dismisses the drawer. |
| Tabs / Plugins | Connectors and Skills; existing local overview/advanced/history/skill/version/draft/review subflows stay inside the drawer; ServiceSetup reuses connection setup. |
| Tabs / Services | Existing connections/catalog and local setup/detail/credential/removal states inside the drawer. |
| Tabs / Machines | Personal/org Admin inventory and read-only local ceiling/detail; `/assistant/machines?machine={id}` selects local detail; `?tab=logins` selects Saved logins. Cold entry retains Assistant underneath; local Back returns to inventory. Managed/hosted/setup routes hand off to Web. |
| Tabs / Activity | Activity: Incoming pending requests, then History grouped by local day; Active grants is a secondary page. Challenge notifications enter this module or its existing detail state through the shared guard/deferred-navigation path. |
| Tabs / AccountSettings | Settings, notifications, appearance, device-local Display, analytics, account actions and legal/security links. |
| SheetStack / Pages | Retains the seven module routes above. Initial module is Agents. |
| SheetStack / AgentCreate | Personal specialist form; dirty dismissal confirmation and pending-write guard. |
| SheetStack / AgentDetail | Specialist profile, permissions, model and related actions; creation/details use the same screen implementation. |
| SheetStack / GroupEditor | Create/edit crew, ownership and membership; dirty/pending guards. Cold edit fallback is Agents → Crews. |
| SheetStack / ServiceSetup | Connection setup/manage; cold nested Back returns to Plugins. |
| SheetStack / MachinePolicy | Owner confirmation/single-user login policy and separate automatic-update save; explicit update confirmation. Dirty/pending/uncertain-result guards. Cold fallback Machines. |
| SheetStack / MachineActivity | Metadata activity with Agent/unattributed filters and cursor pages; cold fallback Machines. |
| SheetStack / AgentSkills | Current specialist's exact-version skills and nested review/history. Cold fallback is Agents. |
| SheetStack / AgentMachines | Revisioned per-agent capability editor; read-only local ceiling and recovery states. Context selection requests an owner card and opens its exact conversation/acknowledgement. Cold fallback Agents. |
| Root / MachineDesktop | Full-screen modal outside the drawer. `/assistant/machines/{id}/desktop?conversation_id=&context_id=&display=secure\|dev` retains every selector. Native screen-capture and app-switcher protection must succeed before B's viewer mounts. Close returns to the calling drawer/chat; cold fallback is chat. |
| SheetStack / AutomationDetail | Existing automation details; cold fallback Automations. |
| SheetStack / AutomationEditor | Create/edit automation; cold fallback Automations. |
| SheetStack / AutomationRuns | Existing run history; cold fallback Automations. |
| SheetStack / AutomationPreferences | Existing preferences; cold fallback Automations. |
| SheetStack / ActivityDetail | Approval challenge details; cold fallback Activity. |
| SheetStack / UsageCredits | Read-only Usage & credits from Settings or the side-menu account area. `/assistant?panel=billing&panelPeriod=24h\|7d\|30d` opens this drawer screen; `/account/usage?period=&ownerId=` is the native route. Cold nested Back returns to Settings; Close restores the addressed chat/crew. |
| SheetStack / AccountSecurity | Existing security/MFA flows; cold fallback Settings. |
| SheetStack / DeviceLogin | Signed-in QR/device approval; scanner is local state. Verification stays above the keyboard; in-flight writes block dismissal. |
| SheetStack / AgentKeyLogin | Signed-in Agent Key/device/login-code flows; scoped selection and transient step-up. |
| SheetStack / TermsOfService | Signed-in legal document within the drawer. |
| SheetStack / PrivacyPolicy | Signed-in legal document within the drawer. |
| Root / Auth | Signed-out first-factor and in-memory MFA challenge; full interaction surface. |
| Root / DeviceLogin, AgentKeyLogin, TermsOfService, PrivacyPolicy | Shared canonical entry URLs. Signed-in wrappers replace the temporary root entry with one drawer; signed-out users keep the corresponding root flow. |

Cold management links get a Workspace/Assistant beneath the sheet. Existing
chat routes, keys and parameters survive fallback and repeated selections.
`navigationHierarchy.test.ts` covers each sheet registration, module routing,
shared entries, challenges, nested Back/fallback, repeated open/close, and exact
chat restoration. `workspaceChatNavigation.test.ts` covers contextual/crew
handoff and race-safe retained identities. Native drawer guard tests cover
pending writes, dirty cancellation, hidden editors and forced sign-out.

Close, backdrop, handle drag and accessibility Escape preflight registered
`useWorkspaceBack` guards; Android Back preserves local/nested history before
root dismissal. Successful drag continues out; cancellation returns to rest.
Sign-out releases route guards and unmounts the account's editor stack.

For iOS simulator checks in an Expo development build, turn off **Tools button**
in Expo's development menu before testing Close. Its floating native window can
overlap the drawer's Close target, intercept the tap and leave the accessibility
snapshot showing only `gearshape.fill`. This does not establish that the app
entered dismissal. Exercise the actual Close control with the tool out of the
way, then verify that Keep editing preserves a responsive draft and Discard
returns to the same conversation and composer draft. The surface tests run the
real dirty guard through Close, backdrop, drag, Android Back and accessibility
Escape, including cancellation, repeated dismissal and the retained chat action.

Retained interaction content and custom native header descendants are hidden
from VoiceOver/TalkBack using explicit root drawer presence, including Android
when retained navigators still report focus; the conversation stays mounted.
Close receives focus once per drawer. Explicit dismissal resolves a mounted
active primary control after transitions; auth/context handoffs cancel restoration.

This inventory describes native iOS/Android. It adds no RN-web route support,
new API, native live desktop admission, or native transcript index.


Side-menu agent rows disclose threads in place without changing the active
route. The expanded header pins while its threads scroll; channel bot and
parent/topic disclosures narrow the same agent history. Selecting a thread
opens its exact conversation ID through the existing chat navigation; New chat
retains the selected agent. Crews remain a distinct section. All-items browsers
finish their native dismissal before selecting a chat. These disclosures add no
routes or deep-link variants.

NyxBot Home occupies the existing primary Assistant route with explicit
`home: true` state. The side-menu logo/Chats entry waits for actual menu
dismissal, then selects Home through the same dirty/pending guards. Bare
`/assistant` and app start without a restored thread select Home. New chat
uses `home: false` and a fresh local compose identity, including for NyxBot;
its normal empty chat never renders the dashboard. Roster Chat reuses the
existing latest-thread selection; away Review includes its exact conversation
and acknowledgement IDs, and finished-work Open uses the agent's home thread.
Crew Open pushes the existing GroupChat route, preserving the primary draft;
New agent and New crew open their existing guarded drawer editors.

The private chat header's Choose agent sheet shares the side-menu hierarchy;
expansion adds no route. Thread selection updates the existing Assistant or
contextual chat route with its exact agent/conversation ID. New chat sets draft
mode, without opening the latest saved chat. This thread links to the existing
local Details and History sheet states; Manage agents opens the existing drawer.
Current-thread reselect preserves unsent text. Switching threads or visiting
Home retains each thread's text, uploaded attachments and crew recipients in
account-scoped memory; it never moves them into another composer. Every New
chat starts empty and keeps the selected agent. The home composer sends to a
new NyxBot conversation. Crew headers have no private New chat control: they
continue the existing crew conversation with its current recipient semantics.

### Sidebar decisions (2026-10-28)

The base sidebar places Quick actions (Scan QR code, Terminal login code) above Workspace. Workspace contains Automations, Machines, Plugins, Activity with its live pending count, and Create new agent. Disabled coming-soon destinations are removed. Quick actions open the existing guarded account sheets over the expanded sidebar, preserving its offset and scroll position; Settings has account identity and Usage & credits without duplicate quick actions. Root swaps have no native fade or inner animation: the new opaque page lays out and paints before the slab closes once in300ms. The route-table topology above is being migrated to ContentStack as described in STREAM_A.
