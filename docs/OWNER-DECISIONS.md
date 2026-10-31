# Owner decisions

On 2026-10-19 the owner delegated the open decisions: "for the ones I have to
decide, do it based on your recommendation, to become big and billions."
Each one below was decided by that rule: reason from the failure that ends the
company, count the blast radius in people, prefer what can be verified, and
take the comfortable middle off the table when it is the trap.

What still needs the owner's own hand is only what the repository cannot do:
paying for something, or signing up for an account in the owner's name. Those
are listed at the end, with exactly what to do.

## FIRST: the AI is off on production (read on 2026-10-31)

The live server's own readiness answer, read by the deploy on 2026-10-31,
says `"model": false` and `"payments": false`. With no `AMV_MODEL_KEY` on the
Worker, every chat turn and every AI feature is refused, for everybody, with
"AMV is not connected to a model on this deployment yet" - nothing is charged,
and nothing works. Every deploy before this one reported green anyway,
because "ready" meant the stores answered. The deploy run now shows a table
of what production can do, and an error annotation while the AI is off.

Only the owner can fix this - it is an account and a bill in the owner's name:

1. An API key from the model provider AMV is built on, on a plan with
   enough headroom for launch traffic.
2. `npx wrangler secret put AMV_MODEL_KEY` (paste the key), and if the
   provider's address is not the default, `npx wrangler secret put MODEL_API_URL`.
3. Before opening to the public: `GLOBAL_DAILY_USD_CAP` (the most AMV may
   spend on models in a day - decision 28) and `MODEL_API_FALLBACK_URL`
   (where chat goes when the provider fails - see the incident runbook).
4. Payments: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, and the price
   ids, so people can subscribe.
5. Email shows as configured (`EMAIL_API_KEY` is set). If messages still do
   not arrive, the sending domain is not verified with the email provider, or
   `RESET_EMAIL_FROM` is not an address on that domain. The readiness screen
   has a "send a test" button that says which.

After step 2, the next deploy's summary shows "Chat and every AI feature:
yes". Nothing else needs changing in the code.

## Decided

**1. SCIM provisioning, Users only - YES. Built** (`71-scim.js`, `a-company-directory-adds-and-removes-its-people`).
The failure that ends an enterprise business is an ex-employee who still has
the company's chats and files, and at scale that is not rare: it is every
company forgetting somebody every week. SCIM makes the company's own directory
remove them within minutes, and it is the first thing a security review asks.
Scope as in DECISION-ENTERPRISE-IDENTITY.md: `/scim/v2/Users`, a per-team token
shown once and stored only as a hash, deactivation that ends every session and
removes the person from the team, every call in the team's audit log,
rate-limited. Groups followed as #20, mapped to the roles AMV already has.

**2. SAML - OFF the table** until a paying customer names it as a requirement.
Company sign-in over OpenID Connect already reaches Okta, Entra ID and Google
Workspace. SAML's XML signature checking is the classic source of sign-in
bypasses, and doing it safely needs a dependency this codebase does not carry.

**3. New team roles - NOT YET.** Each role is a permission rule that must be
right on every route forever. The first one is added when a customer asks for
it (most likely "billing manager").

**4. Holding sign-ins on AMV's servers so a background run can use them while
the person's device is off - NO, and not "per site, opted in" either.**
That middle option is the trap. A store of live sessions to people's banks,
mail and shops is the single most valuable thing an attacker could take from
AMV, and an opt-in does not shrink it: it fills it with exactly the sites
people care most about. One breach would end the company, and LESSONS 537
already refused the password version of the same vault. What ships instead:
- the sign-ins stay sealed on the person's device, as now;
- the person can TAKE OVER the hosted browser to sign in or solve a check
  themselves - built (`72-web-takeover.js`);
- a background job that needs a signed-in site says so and waits for the
  device, rather than failing quietly.
Revisit only with hardware-backed per-user keys the server cannot use alone.

**5. Speech-to-speech voice - NOT THIS CYCLE.** Voice works today: heard on
the server, spoken as it is written, stops when talked over. A realtime
speech model is a supplier contract, a second price per minute and a
WebSocket path through the Worker, for lower latency and tone of voice. Worth
it once voice is a measured share of use; the digest already reports usage.

**6. Unattended sending, buying or acting on accounts - stays OFF,
permanently.** Already decided (ROADMAP Milestone 6); restated so it is never
re-opened by accident. Every unattended run reads and writes text; a person
approves anything that leaves.

**7. A native JetBrains plugin - NO for now.** It is a second codebase on the
JVM and a Marketplace account, for a surface the External Tools file already
covers. Revisit when JetBrains users are a measured share.

**8. Fitbit and Oura - NO for now.** Live health data is a regulated,
high-liability category, and the Apple Health export (read on the device,
nothing kept) already serves the people who want it. Revisit with a privacy
review, not as an integration.

**9. Chrome Web Store - YES. Google Play (as an installed web app) - YES.
Apple App Store - LATER.** The Chrome extension holds no key and asks for
activeTab only, so review is routine and it removes the "Developer mode"
step that loses most people. Play can list the installed web app as it is.
The App Store needs a native shell and its own review cycle; it waits until
the web app's retention on iPhone is measured.

**10. Plugins that carry their own code - NO, not as a marketplace item.**
A marketplace where third parties ship code that runs for millions of people
is the classic supply-chain attack: one compromised or sold-on plugin reaches
every account that installed it, and "sandboxed, signed and scanned" narrows
that without closing it - a scanner passes what it does not recognise, and a
signature proves who shipped the code, not what it does. What people want
from plugins is already served without it:
- declarative plugins (Crew jobs, assistants, skills) - data, not code -
  install from the marketplace today;
- code that needs to run is a connector (MCP), run by the bridge on the
  person's own computer, every tool call asked first;
- a one-off program runs in the code sandbox, with no network and no reach
  into the account.
The comfortable middle option - "allow code plugins, but sandboxed" - is the
trap: it keeps the whole blast radius and adds a review queue. Revisit only
for code AMV itself reviews and ships, never third-party code by default.

**11. Documents, sheets and slides you and AMV edit together - YES, next,
in this order.** It is where the work people pay for lives. Step one, the one
that can be verified: AMV's change to a document is a set of tracked edits
the person accepts or rejects, read back from the saved file - the same
shape as the Office round-trip (only the changed text moves; nothing is
offered until it reopens). Step two: the same document open on two devices
stays in step, through the sync AMV already has. Live multi-cursor editing
between people comes last, and only on a Durable Object per document, because
that is the only way two writers cannot silently overwrite each other.
*Where it stands:* step one shipped (each change on the card is kept or left
out, and the file is rebuilt and reopened). Step two's first half shipped:
"Save to my files" keeps the edited file itself (kind `office` in the
library), and opening it from Your files on another device brings back the
file, so AMV can go on editing it there. That crosses devices only where
account files are switched on (the `AMV_FILES` storage binding); without it
the file is kept on the device that saved it, and the card says exactly
that. Two open copies following each other without a save is still to come.

**Decided 24 October, on the owner's standing instruction to answer each of
these the way a company out to beat ChatGPT and Claude at a billion users
would.** Each is built one at a time, tested and gated; where one needs an
account only the owner holds, everything up to that step is built and the step
is named below.

**12. Extra-usage credit never expires - YES, now.** It lapsed 400 days after
each counter's last write, and "bought" and "spent" lapsed separately, so a
pack used slowly vanished mid-use. Credit somebody paid for is kept with no
expiry; reading a balance rescues credit bought under the old timer. Shipped.

**13. The five-hour window starts at the person's first message - YES.** Fixed
five-hour blocks on the server's clock reopen at a time nobody can predict.
The window opens when somebody starts and reopens five hours later, at a time
the screen states exactly.

**14. Lifetime usage - YES, as totals only.** Day, month and all-time totals by
engine and by feature, never what was asked. Neither ChatGPT nor Claude shows
a person their lifetime usage; storing totals only adds no privacy surface.

**15. Team limits are written down, not left to omission - YES.** Per person:
requests a minute and the five-hour window. Pooled for the team, sized by
seats: the month, the top-engine week and extra credit. Admins see each
member's share. *Shipped:* the limits are written out (they were left out,
so a team had no weekly top-engine count at all) and the five-hour window is
counted per person; owners and admins see the per-member breakdown (#18).

**16. A persistent cloud computer - YES: disposable compute, durable state.**
Files, browser sign-ins and task state are saved before the container sleeps
and restored when it wakes. Needs object storage bound (below).

**17. Long-running work as durable tasks - YES.** Checkpointed steps on the
Durable Objects AMV already runs, resumable after any restart, so the same
task can run for minutes or months.

**18. A team's owner and admins see each member's usage - YES, totals only.**
Tokens and messages per member this calendar month and last, and the
surfaces they went to - never a project and never what anybody asked. Only
what the TEAM paid for is counted, so a member on a better plan of their own
stays private. Members are told on their own Usage screen, and erasing an
account erases what any team counted for that person, including teams since
left. A per-member breakdown by project or by message is off the table: the
person paying for a seat does not thereby buy a view of the work.

**19. What extra usage does when the plan runs out - the person chooses.**
Keep going automatically (the default, which is what buying a pack has
always meant), ask first, or never use it. "Ask" spends nothing until the
person says yes in the app, and the yes covers only the messages they send -
never AMV's background work - until the limit comes back; an API key cannot
give it. Per person, so on a team each member decides for their own messages.
A default of "ask" is off the table: people who bought a pack to keep going
would be stopped mid-task by a question they already answered at checkout.
*Corrected (Oct 26 audit #15):* "they already answered at checkout" was not
true - the purchase screen showed the three choices with "keep going" already
ticked, so a quick buyer never answered. Now nothing is ticked until the
person has chosen once, and the packs stay shut until they do; after that
their choice is shown and kept. "Auto" remains what an account that has never
bought behaves as, because it holds no credit to spend.

**20. SCIM Groups - YES, mapped to the existing Admin role, no new roles.**
A company decides who administers its tools in its directory; making it
also do that by hand in AMV is how an ex-admin keeps admin rights. Groups are
pushed and kept (at most 50 per team); members of the group named "AMV Admins"
are admins and go back to member when they leave it. Only admins the
DIRECTORY made are ever demoted by it - an admin the owner appointed in AMV,
or whose role the owner has set since, stays one - and the owner is never
touched, the same bounds as Users. A member the directory names that the team
does not have is refused, a request with one bad operation changes nothing,
and every role change is in the team's audit log. New roles (#3) stay off.
Built: `71-scim.js`, `a-company-directory-decides-who-is-admin`.

**21. Pictures of cited sources - YES, fetched by AMV, cited sources only.**
A research answer shows the picture each cited page names for its link
previews (og:image), up to four, once the answer is finished. AMV's server
fetches it, never the person's browser, on the same terms as a site's icon:
https public hosts only, every redirect re-checked, JPEG/PNG/GIF/WEBP by their
bytes, at most 300KB, rate limited per IP, kept a week in a new CACHE kind
(`sprev:` + a digest of the address - no person's data). Off the table:
hotlinking the site's image from the page (it tells every site who read
about it), and pictures for sources the answer did not stand on (a search
result is not an endorsement, and a gallery of them is decoration).
Built: `75-source-previews.js`, `a-source-picture-is-fetched-by-amv`.

**22. Teach AMV by showing it - YES, in AMV's hosted browser, reviewed before saved.**
"Do it once and AMV learns it" (audit #34): from Skills, the person names a
site, AMV's browser opens there and is handed to them (the takeover of #4),
and each click and thing typed is listed as a step. The text typed into a
password, one-time-code or card field is never part of a step, anywhere. On
"Finish teaching" the browser is closed and the steps become a draft skill
the person reads, edits and saves - or discards; nothing is saved without
them. A taught skill runs through the browser tool with every check it has
(isolation, spending gates, approvals), so teaching grants nothing. The time
the browser is held is charged, as a handover is. Off the table: recording
on the person's own computer (a recorder there sees everything on screen),
and keeping recordings on AMV's servers (the steps live on the device and in
the skill). Built: `browserTeach` in `72-web-takeover.js`, `_webTeach` in
`web-live.js`, `teach-amv-by-showing-it` (worker and e2e).
Upgraded (Oct 26 audit): each step also records how to find its element again
(id, test id, name, label), the person can add checks ("the page shows Deal
won") which are kept only if true at the time, and Run it now replays the
recorded steps exactly in AMV's browser - no model choosing - finding each
element by what was recorded, stopping at the first step it cannot find or
the first check the page fails, never clicking "somewhere near". A secret step
asks for its value for that run only. `78-teach-replay.js`,
`a-taught-task-replays-and-checks-itself`.

**23. Persistent named Agents - WITHDRAWN by the owner (Oct 26): Crew stays one box. Kept as a record.**
The Oct 26 audit's first ask after storage. An agent is a name, a role,
instructions, a monthly budget and a pause switch, kept as one new stored
record per account (`agents`, erased with the account) - the one schema
change this needed, decided here under the standing delegation. Its work is
ordinary background jobs, so every limit those already have still applies
(the plan's job count, the account's monthly ceiling, the day's ceiling,
quiet hours, approval levels). What the agent adds is decided where the run
happens: its instructions are placed after AMV's rules and can never widen
what a run may do; a paused agent's jobs wait; its budget is reserved before
each run and settled against the cost, exactly like the account's; deleting
it stops its jobs and keeps their results. Pro and up, ten per account,
created and changed only from a signed-in session, never with an API key.
Off the table for now: a workspace or browser profile of its own (needs the
R2 bucket, the owner's step - an agent with a computer that forgets is worse
than none). Agents work together through the step graph rather than by
messaging each other: each step of a task in steps can be given to a
different agent, and a step builds on what the steps it waits for produced,
each run under its own agent's instructions, budget and pause. It was built
(`77-agents.js` and two suites) and then REMOVED at the owner's request: none
of it is in the repository or the product now, and docs/capabilities.json
does not list it. This entry records the design, not something that ships.

**24. A read-only Viewer role on teams - YES; seats unchanged.**
Teams had owner, admin and member. The role companies ask for next is the one
that can see and not touch: a client, an auditor, a manager who reads. A
viewer reads everything the team shares and its projects; every route that
adds to or changes shared work (sharing, creating or saving a shared project,
creating or updating a task) checks one permission, `contribute`, which a
viewer lacks, and refuses with a sentence saying why. Work cannot be assigned
to a viewer. Only the owner sets roles, and owner is never a role to give.
A viewer still takes a seat: pricing a cheaper seat is a billing decision,
which stays the owner's. Built: `TEAM_PERMS` in `33-team-roles.js`, the role
picker on the team page; `a-viewer-reads-and-does-not-change`.

**25. Searching by meaning - YES, stateless, behind one line in wrangler.toml.**
The Oct 26 audit asked for hybrid retrieval. Searches over files and projects
were by words plus the other phrasings the engine passes; words miss a
passage in another language or with no word in common. `/v1/meaning` scores
the passages the page is choosing between against the question with a
multilingual embedding model (bge-m3) on Workers AI, and keeps nothing - no
index of anybody's files, no vectors. The page blends the two rankings, so
the exact words still win when they are there, a passage found by meaning
alone must be close to count and is labelled as found by meaning, and a
failure falls back to words. Off the table: storing an index of people's
files (a second copy of everything they own, for a speed nobody has asked
for). Built: `79-meaning.js`, `_psMeaningScores` in project-search.js;
`a-search-can-find-it-by-meaning` (worker and e2e). Switched on by the
owner's step below.

**26. Companion - WITHDRAWN with Agents (Oct 26). Kept as a record.**
The audit's proactive assistant. Set up from Crew in one dialog, it is an
agent named Companion and one daily background job, so everything an agent
and a job already enforce applies to it. Three levels, each mapped onto the
job's approval and enforced on the server: Reactive makes no job at all (it
answers when asked); Helpful prepares a brief and drafted replies that wait
for approval; Proactive delivers the brief. Per-category control is which
reads it may use - email, calendar - and it uses only those, from accounts
the person connected. It never sends, books or buys: an unattended run
cannot, and every draft says it was not sent. Off the table: a Companion that
messages people on the person's behalf, which would need the Action Protocol
and the person's say-so on each send - the trust that makes it worth having.

**27. Sign-up sends no email; passwords need 8 characters - the owner's call (Oct 26).**
Creating an account signs the person straight in. The emailed code is for
signing in on a device that has not proved itself, and the first such code
now also confirms the address (so a confirmed account cannot be claimed by a
stranger signing up with it). One email stays at sign-up, on purpose: an
address that already has an account nobody confirmed gets a code, so whoever
signed up with somebody else's address first cannot keep it. Passwords need 8
characters for every account (it was 15 for a password-only one); the most
commonly guessed passwords are still refused whatever their length.

## The scale audit (Oct 26): what was fixed, and what only the owner can decide

The audit's question was the right one: if a million people tried AMV
tomorrow, what breaks first? Three of its findings were checked against the
code, found true, and fixed the same day, because they needed nobody's
permission and each was a lie the deployment could tell about itself:

- **A comment satisfied the deploy check.** preflight searched the raw
  wrangler.toml, so a commented-out `binding = "BROWSER"` read as declared and
  the answer was "Ready to deploy". It now reads the config the way wrangler
  does, names every optional capability ON or OFF, and takes a launch profile
  (`AMV_PROFILE=consumer_full`, `private_beta`, `team`, `enterprise`, `dev`): a
  capability the profile needs that is OFF is an error, not a warning.
  `--live=https://...` checks the deployed Worker the same way.
- **Binding a database would have emptied every account.** Reads moved to D1
  the moment `env.DB` existed. Now D1 is used only when `DATA_STORE = "d1"` is
  also set, after a migration; and a record over D1's 2 MB row limit is
  refused by name instead of failing inside the database.
- **"Alive" was the only health there was.** `/v1/health/ready` asks KV and
  the usage Durable Object (and D1 when in use), answers 503 when one fails
  and says which, and lists what is switched on as booleans. The deploy now
  waits for *ready*, not *alive*.

The rest are the owner's - money, permissions, auth, the data model or
infrastructure. Each is answered the way CLAUDE.md asks: one recommendation,
what is off the table, and what only the owner decides.

**28. The global daily spend ceiling - KEEP IT, SET IT ON PURPOSE.**
It is the switch that stops a runaway bill, and at $500 a day it is also the
switch that turns a good day into an outage for every paying person at once.
Recommendation: before launch, set `GLOBAL_DAILY_USD_CAP` to about three times
the busiest day you expect, and treat reaching it as an incident, not a
setting to raise. Off the table: launching on the default, and removing it.
The comfortable middle - raising it whenever it trips - is the trap: it
teaches everyone the ceiling is not real. *Owner decides the number.*

And how it is counted has a ceiling of its own. Every model call reserves
and then settles against ONE counter for the whole day (`spend:<day>`, a
single Durable Object), so every call in the world queues through one
actor twice. One actor does roughly a thousand simple operations a second,
which caps AMV near five hundred model calls a second however many servers
there are - below the audit's estimate for a million daily users at peak.
Recommendation: split the day's budget across 16 counters chosen by account,
each holding a sixteenth, with the remainder moved between them when one runs
dry; the per-account and per-plan ceilings, which are already per person,
stay as they are. *Needs a yes: it is how money is counted.* **YES (owner,
Oct 26) - DONE.** Built as one share per $20 of the ceiling, up to sixteen
(`spend:<day>:s0..s15`): an account books on its own share and spills to two
others before it is refused, settles and releases on the share it booked, and
the owner's total adds them all up with the old counter. A small ceiling
stays one share, so the largest single call (about $16) always fits. On the
day it ships, what was already booked on the old counter is not held against
the shares - that one day's ceiling can be passed by at most that much.
`tests/worker/the-days-ceiling-is-counted-in-sixteen-places.test.mjs`, against
the real counter class.

**29. Revoked must mean revoked - MOVE REVOCATION OUT OF KV. YES (owner, Oct 26) - DONE.**
Built: one Durable Object per account holds the epoch and the sign-ins ended one by one; every check reads it and KV together and takes the higher, so neither a stale KV read nor an object that was down can bring a revoked session back. If the object cannot be reached, sign-in stays up on the KV epoch (the old minute) and the operator is alerted - an outage of one object never signs everybody out. `tests/worker/revoked-means-revoked-everywhere.test.mjs`, against the real class.

The decision as it was put:
"Sign out everywhere" and revoking an API key write to KV, which can take a
minute or more to be seen by every location; for that minute a revoked token
still works somewhere. Recommendation: hold the revocation epoch and revoked
keys in the Durable Object that already holds every usage ceiling (strongly
consistent, already deployed), read on each authenticated request, with KV
kept only as a cache of "not revoked". Off the table: shortening token life
alone - it narrows the minute, it does not close it. *Owner says yes; it is
an auth change.*

**30. The data tier - ONE TRANSACTIONAL DATABASE FOR WHAT MUST BE TRUE. Postgres (owner, Oct 26) - SCHEMA BUILT, VENDOR TO CHOOSE.**
The schema, its money guarantees run against a real Postgres, and the step-by-step migration are in `docs/DATA-TIER.md`. What remains is the owner's: pick the provider and create the Hyperdrive configuration; the Worker's reads and writes are built against it then, not before.

The decision as it was put:
KV is a cache that has been used as a database. Accounts, entitlements, the
credit ledger, API keys, teams and memberships need transactions.
Recommendation: managed Postgres reached through Cloudflare Hyperdrive for
that control plane; R2 for files; Durable Objects for hot counters; KV as a
cache only. Off the table: one JSON record per person in D1 (the 2 MB row
limit is below what a person's sync record may reach, and one database caps
at 10 GB). The middle option - turning on the generic D1 table that exists
today - is the trap: it is KV with SQL, and it moves the problem instead of
solving it. The migration is copy, verify, shadow-read, switch per account,
never a flip. *Owner decides the vendor and its monthly cost, and gives the
go-ahead (it changes the storage schema).*

**31. Queues and durable workflows - YES, IN THIS ORDER.** Email first (it is
broken today, and a queue is where a failed send waits and is retried rather
than lost), then file ingestion, then background jobs off the every-minute
cron. Every message carries its own idempotency key, because a queue may
deliver twice. *Needs Workers Paid (item 1 below).*

**32. The cloud computer keeps its work - YES, ONCE R2 IS ON.** A container's
disk is new after every sleep, so today nothing survives five idle minutes.
The workspace is checkpointed to R2 and restored on wake; the container stays
disposable. 50 machines is a beta number: the real one comes from what the
owner will pay, and every plan needs its own limit and a queue in front of it.
*Owner decides the capacity budget.*

**33. Files go straight to R2 - YES, ONCE R2 IS ON.** The browser uploads to a
signed, short-lived address instead of through the Worker as base64 (a third
larger, and the Worker's memory). Scanned before it is usable.

**34. Logs - KEEP EVERY ONE FOR NOW.** At this size a sampled log is the log
that is missing when it is needed. When requests pass about a million a day,
keep every error, security, billing and action failure, and sample ordinary
successes. *Owner decides when the bill says so.*

**35. Passwords - THE OWNER CHOSE 8 TODAY, AND IT STANDS. One correction.**
The audit asks for 15 (NIST's figure for a password that is the only factor).
AMV's password is not the only factor: a sign-in on a new device needs the
emailed code. Except in one case, which is the correction: when the email
provider refuses AMV's sender, sign-in carries on WITHOUT a code so nobody is
locked out - and right now emails are not arriving. Until the sending domain
is verified, an 8-character password may be standing alone. The fix is the
email setup, not the length. Hashing: 100,000 rounds is the most the Worker
runtime allows for this algorithm; a stronger one (Argon2id) means running it
outside the Worker. *Owner decides whether to revisit either.*

**36. Image generation - OFF, BY THE OWNER'S STANDING RULE. The audit asks for
it back.** It is the owner's call alone. If it returns, it is metered as its
own credits and never inside a subscription allowance: COSTS.md measured
images at eight times a plan's price at full use, which is why it went.

**37. Named agents and Companion - WITHDRAWN TODAY BY THE OWNER, AND THE AUDIT
ASKS FOR THEM.** Not rebuilt against an instruction given the same day.
Everything they stood on - jobs with budgets, approvals, steps that wait on
each other - is still there, so they can return as a layer if the owner
wants them.

**38. Cross-site request checks on cookie routes - YES (owner, Oct 26) - DONE.**
Built: a request to /auth/* that carries AMV's cookies from any page but AMV's own (Origin, or Sec-Fetch-Site when there is no Origin) has the cookies removed and goes on as if it had none - it can still sign in with a password and cannot use somebody's standing sign-in. Not a browser (neither header): unaffected. `tests/worker/a-strangers-page-cannot-use-your-sign-in.test.mjs`.

The decision as it was put:
The sign-in renewal cookie is sent automatically; the routes that take it
should also check that the request came from AMV's own page (exact Origin and
Sec-Fetch-Site), because CORS stops a page reading an answer, not sending a
request. No attack has been shown; this is hardening.

**39. Outside review of sign-in - YES, before a public launch.** The passkey,
authenticator-app and recovery-code code is hand-written and well tested, and
tested by the people who wrote it. An outside security firm, with fuzzing of
the passkey parser, is the owner's to commission.

**40. Staging and gradual rollout - YES. Needs the owner's infrastructure.**
Today a passing build goes to everybody at once. A staging Worker on its own
address, then a share of traffic before all of it, needs a second Cloudflare
environment and domain. *Owner provisions them.*

**41. Security scanning on GitHub - TWO SWITCHES IN THE REPOSITORY'S SETTINGS.**
Dependabot is configured in the repository now (`.github/dependabot.yml`): a
short weekly list of dependency and pinned-Action updates, each tested before
it can merge. Two more are settings, not files, and only the owner can turn
them on: *Settings > Code security > CodeQL analysis > Set up > Default* (it
scans every push for security mistakes in the code), and *Secret scanning*
with *Push protection* (it refuses a push that contains a key). Both are free
for this repository and change nothing else.

**42. Sign-in: the password signs you in; the emailed code only after a run of
wrong passwords (owner, Oct 31) - DONE.** The owner asked for sign-in "like
every normal other website": an automatic check, the password, "wrong" when it
is wrong with Forgot password beside it, and no email unless something looks
like an attack. Built: the code is now asked for only after SIGNIN_CODE_AFTER_FAILS
(6) wrong passwords on the account in the last hour, counted across every
network in the account's counter object; the verification widget is invisible
unless Cloudflare needs a click, and the page waits for it instead of sending
without a token. Said plainly, as the trade it is: a new device with the right
password is no longer asked for the inbox, so a password leaked from another
site now opens the account on the first try. What still stands between a
leaked password and the account is the person's own authenticator app or
passkey (Settings > Security), which AMV keeps asking for wherever one is on -
the strongest thing to offer everybody, and the first thing a security review
will ask about.

**43. Sign-up is passkey-first; a password with nothing else needs 15
characters (owner, Oct 31, on the production audit).** Reverses #35's 8 for
anybody with no second step. A passkey is the first thing sign-up offers; a
person who chooses a password instead sets 15 or more characters, unless an
authenticator app is on the account. Existing accounts keep their password
until they next change it.

**44. Persistent named Agents - YES, kept out of the way (owner, Oct 31).**
Reverses the Oct 26 withdrawal of #23, in the form the owner chose: Crew
stays one box, and after a task works AMV offers "Keep this as an agent?".
An agent then has a name, its own memory, a monthly budget and a pause
switch, listed under Crew. Nobody sees agents until they keep one.

**45. Image generation and editing - STAYS REMOVED (owner, Oct 31).** The
audit recommended bringing back editing and diagrams through an outside
provider. Revisit after launch with real usage; until then the standing rule
in CLAUDE.md holds.

**46. Saved sign-ins in AMV's own browser - BUILD NOW (owner, Oct 31),
against the recommendation to wait for an outside review.** Reverses the
earlier permanent refusal. Built as: opt-in per agent, one encrypted browser
profile per agent sealed under a key the Worker holds, a list of the sites it
may keep, banks and payment sites excluded, every saved sign-in expiring on
its own and revocable from Settings > Security, nothing of it ever shown to
the model, every use in the account's activity. The outside security review
(#39) is still owed before this is offered to the public - recorded here so
it is not forgotten when the switch is on.

## What needs the owner's own hand

Only payments and accounts in the owner's name. Nothing here can be done from
the repository.

1. **Cloudflare Workers Paid ($5 a month)**, then tell AMV it is on. It turns
   on the hosted browser (Browser Rendering: $0.09 per browser hour after 10
   included). The binding stays commented out until then, because switching it
   on without the plan breaks every deploy.
2. **Chrome Web Store developer account** (a one-time $5 fee). Upload
   `amv-chrome.zip` from Settings > API keys.
3. **Google Play developer account** (a one-time $25 fee), for the installed
   web app.
4. **A speech supplier key**, when voice is worth the per-minute price -
   pasted into the deployment's settings; nothing else changes.
5. **Searching by meaning**: uncomment the two `[ai]` lines in wrangler.toml
   (Workers AI is on every Cloudflare account; about $0.012 per million
   tokens). Searches find passages in other words and other languages.
6. **Files in the account (Cloudflare R2)**: run
   `npx wrangler r2 bucket create amv-files` once, then uncomment the three
   `[[r2_buckets]]` lines in wrangler.toml. The file library then follows the
   person to every device, and agents and the cloud workspace can keep work
   between runs (about 1.5 US cents per GB a month).
7. **Background work through a queue (Cloudflare Queues)**: run
   `npx wrangler queues create amv-jobs` and
   `npx wrangler queues create amv-jobs-dead` once, then uncomment the queues
   block in wrangler.toml. Each account with work due then runs on its own,
   in parallel, retried, with a dead-letter queue for what keeps failing -
   instead of every account in turn inside one 25-second tick, which starts
   running late past a few thousand busy accounts. Needs Workers Paid (item
   1); about 40 US cents per million operations. Until then nothing changes.
8. **The cloud workspace keeps its files when it sleeps (Cloudflare R2)**: in
   `cloud/`, run `npx wrangler r2 bucket create amv-workspaces`, uncomment the
   `WORKSPACES` lines at the end of `cloud/wrangler.toml`, and deploy `cloud/`
   again. Each person's workspace is then saved before their machine stops
   and restored when it starts (packages and caches left out, 512 MB at most).
   Until then the workspace lasts only as long as the machine is awake.
9. **Nightly backups (Cloudflare R2)**: run
   `npx wrangler r2 bucket create amv-backups`, then uncomment the
   `AMV_BACKUPS` lines in wrangler.toml. Every night the accounts, plans,
   chats, projects and jobs are then copied into that bucket, thirty nights
   kept, with an alert when a night does not finish; the runbook (section 3)
   says how to restore one. Until then the only backup is the file an
   operator downloads from the console by hand.
