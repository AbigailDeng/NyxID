# Native workspace route inventory

The root workspace retains its conversation while a single `WorkspaceSheet`
management stack is open. Module tabs are hidden and retained, with no native
bottom tab bar. The transient side menu closes before management navigation.
Canonical URLs, notification challenges and in-chat links use the same helpers
in `navigationHierarchy.ts` and `workspaceChatNavigation.ts`.

| Navigator / registered screen | Entry and nested behavior |
| --- | --- |
| ChatTabs / Assistant | Main personal or specialist chat; compact identity/history/details/new-chat header. |
| Root / AssistantContext | Contextual chat; full interaction surface, native Back. |
| Root / GroupChat | Crew conversation; actual name/ownership context/settings in one header, member details in the chip strip. |
| Tabs / Automations | Drawer module; AutomationDetail, Editor, Runs, Preferences. Agent-scoped entry preserves its filter. |
| Tabs / Agents | Agents & Crews drawer module; AgentCreate, AgentDetail, AgentSkills, GroupEditor. Choosing a chat dismisses the drawer. |
| Tabs / Plugins | Connectors and Skills; existing local overview/advanced/history/skill/version/draft/review subflows stay inside the drawer; ServiceSetup reuses connection setup. |
| Tabs / Services | Existing connections/catalog and local setup/detail/credential/removal states inside the drawer. |
| Tabs / Machines | Personal/org Admin inventory and read-only local ceiling/detail; `/assistant/machines?machine={id}` selects local detail; `?tab=logins` selects Saved logins. Cold entry retains Assistant underneath; local Back returns to inventory. Managed/hosted/setup routes hand off to Web. |
| Tabs / Activity | Approvals/grants/history. Challenge notifications enter this module or its existing detail state through the shared guard/deferred-navigation path. |
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
| SheetStack / ActivityDetail | Approval challenge details; cold fallback Approvals. |
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

NyxBot Home occupies the existing primary Assistant route only when no
conversation is open. It adds no route or deep link. Roster Chat reuses the
existing latest-thread selection; away Review includes its exact conversation
and acknowledgement IDs, and finished-work Open uses the agent's home thread.
Crew Open pushes the existing GroupChat route, preserving the primary draft;
New agent and New crew open their existing guarded drawer editors.

The private chat header's Choose agent sheet shares the side-menu hierarchy;
expansion adds no route. Thread selection updates the existing Assistant or
contextual chat route with its exact agent/conversation ID. New chat sets draft
mode, without opening the latest saved chat. This thread links to the existing
local Details and History sheet states; Manage agents opens the existing drawer.
Current-thread reselect preserves unsent text, while a different thread follows
the existing draft-clearing rule.
