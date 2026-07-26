# AMV Job Hunt - spec

An autonomous standing job (lives in the Co-Worker catalog alongside
`morning_brief`, `inbox_digest`, ...). It continuously finds jobs matched to
the user, tailors an application to each, and - depending on mode - either
queues it for approval or applies. It reports every morning.

## Honest capability boundary (READ THIS FIRST)
AMV acts through clean provider APIs (`INTEGRATION_ACTIONS`: gmail_send,
calendar_create, ...). It does NOT drive arbitrary web forms. So:

- **Email-apply jobs** (the posting accepts applications at an address): AMV can
  fully submit - tailor + send via `gmail_send`. Real, end-to-end.
- **Portal jobs** (LinkedIn / Workday / Greenhouse / company ATS web forms): no
  public apply API. AMV fills the ENTIRE application (answers, cover letter,
  resume choice) and produces a one-tap "ready to submit" packet with the direct
  link. It does NOT silently claim to have submitted what it cannot.
- **True "apply anywhere on its own"** needs one new capability: a server-side
  headless-browser action that logs in and submits forms. When that
  `INTEGRATION_ACTIONS` tool exists, portal jobs flip from "ready to submit" to
  "applied" with no other change - the engine already routes by channel.

Never fake a submission. `no fake features` (owner directive).

## The ask-or-apply rule (the core UX)
Before applying to a job, AMV checks the application's required fields against
the user's profile:
- If a required field is NOT covered (e.g. the posting asks "preferred hours",
  "desired start date", "salary expectation" and the user never specified) ->
  AMV ASKS the user (a question in the approval inbox) and does not apply yet.
- If the user provided everything AND mode is autonomous AND the channel is
  submittable -> AMV applies, writing any free-text answers from the profile.
- In ask-first mode, every application is queued for one-tap approval regardless.

## Config (`amv_jobhunt`)
- `mode`: 'ask' (approve each) | 'auto' (auto-apply where possible)
- `resumes`: [{id,name,text}] - at least one required
- `contact`: {name,email,phone,links}
- `targets`: {roles[], locations[], remote:'any'|'remote'|'onsite', salaryMin}
- `prefs`: answers to common gating questions {authorization,start,hours,relocation,...}
- `dailyCap`: max applications/day (anti-spam; job boards' ToS + quality > spray)

## Daily run (AI + Google connected)
1. Find + rank matches (web research) against targets + resume.
2. For each candidate up to `dailyCap`:
   a. `channelFor(job)` -> email | portal | unknown
   b. `missingInfo(job, profile)` -> questions to ask (if any)
   c. `applyOutcome(...)` -> applied_email | ready_portal | queued_approval | needs_info
   d. tailor cover letter + free-text answers from the profile
3. Email a morning report: found, applied, ready-to-submit, waiting on you (info),
   and any interview invites detected.
4. Interviews: on a reply offering/【asking times, propose slots + `calendar_create`.

## Degradation
- No AI key: the job is visible + configurable, but finding/drafting is off (says so).
- No Google: it drafts + queues, but cannot email-apply or book until connected.
- Everything the engine decides (channel, missing-info, apply-or-ask) is
  deterministic and works offline - only the finding/drafting/sending need keys.

## v1 in this build
The engine (`AMVJobs`: config, `channelFor`, `missingInfo`, `applyOutcome`,
`buildReport`), the standing-job registration, a setup surface, and honest
degradation. The AI-backed find/draft and the headless-browser submit are
staged behind the same interfaces so they drop in without reworking the engine.
