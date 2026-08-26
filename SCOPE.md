# The 27 unreachable functions, one at a time

Verified with a scanner that counts raw occurrences across every source module
and the hand-written shell, with a negative control it must pass first. A
function listed here appears exactly once in the whole codebase: its own
definition. Nothing calls it, no `window.` export names it, no `data-dact`
string mentions it.

Two of them are a real capability gap. The rest are residue.

---

## Wire these two. They are half of a working feature.

**`_crewSyncLive`** and **`_handoffSyncLive`**.

This is the finding. Crew job state is **written** to the server on every
toggle - `AMV_API.toggleJob` fires from two places in `cwToggle` and
`_cwToggleReal`. It is **read back** by exactly one function, `_crewSyncLive`,
and nothing calls it.

So: switch a job on from your phone, and your laptop never finds out. The
server has the truth, the endpoint exists, the write half runs on every toggle,
and the read half is orphaned. `AMV_API.jobs()` appears once in the entire
client, inside the function nobody calls.

`_handoffSyncLive` is the same shape for handoffs: `AMV_API.listHandoff()`
appears once, inside it.

That is the third instance tonight of the same failure - correct at both ends,
not joined in the middle. It is also the only one on this list that costs a
user something today.

## Remove these. Each is superseded by something live.

| function | superseded by | evidence |
|---|---|---|
| `_buildModelStr` | `_sectionModel` | same job, live callers |
| `_modelPickerHTML` | `_sectionModelSelect` | the picker that renders |
| `_cehCard` | `_chip` | chat-home cards, replaced by the greeting |
| `_starterChip` | `_chip` | identical output, one line shorter |
| `_starterCard` | `_chip` | same |
| `_chomeRecentWork` | nothing, deliberately | you asked for the quiet home |
| `_planDetails` | the plans page | plan copy now lives there |
| `_planHighlights` | the plans page | same |
| `_pmLabel` | nothing | the comment beneath it says the payment-method card is gone and never rendered |
| `_cardBrand` | nothing | same card |
| `_payActivate` | `handlePaymentSuccess` | same card |
| `_mcAutonCard` | `_mcAutonSchedRow` | Mission Control rows |
| `_crewQueueHTML` | Mission Control sections | replaced wholesale |
| `closeTab` | nothing | the tab bar was removed |
| `_pageReset` | nothing | `_pageMore` and `_showMoreBtn` are live; only reset is unused |
| `connectGoogle` | `connectIntegration('google')` | the Connectors list is where people look |
| `quickGmail` | `crewRun('gmail')` | wired to the "Check Gmail" card |
| `quickCalendar` | the chat intent router | `calendar_list` / `calendar_create` are live tools |
| `quickDrive` | the chat intent router | `drive_list` is a live tool |
| `handleSheetFile` | chat file upload | the Excel card's button is "Open in chat", and chat accepts any file |
| `openDocEditor` | chat file upload | same |
| `filterTaskCat` | nothing | the task category filter UI is gone |
| `goToStripeSettings` | nothing | one line, never called |
| `showMsg` | `toast` | a wrapper around a toast |
| `_tryProtocol` | nothing | already a deliberate empty no-op; its comment explains why |

**27.9KB of source**, about 1.3% of the bundle. Worth removing for what it
stops rather than what it saves: a superseded twin beside a live original is
how two implementations drift, which is the hazard this codebase's own
one-definition checker exists to catch - and which caught me doing exactly that
last night.

## What I have not done - RESOLVED

Every one of these has been decided. Four were removed as residue of features
already gone, one was WIRED because it was a working feature with no door
(`handleSheetFile`, the spreadsheet editor), and four are declared as
deliberate non-doors with written reasons. See FIFTY.md for the breakdown.

The two sync functions are a different question: those I would wire, not
delete, and I would want to test them against two real browsers before
believing it works.
