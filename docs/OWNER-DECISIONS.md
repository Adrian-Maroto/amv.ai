# Owner decisions

On 2026-10-19 the owner delegated the open decisions: "for the ones I have to
decide, do it based on your recommendation, to become big and billions."
Each one below was decided by that rule: reason from the failure that ends the
company, count the blast radius in people, prefer what can be verified, and
take the comfortable middle off the table when it is the trap.

What still needs the owner's own hand is only what the repository cannot do:
paying for something, or signing up for an account in the owner's name. Those
are listed at the end, with exactly what to do.

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

**23. Persistent named Agents - YES, built on background jobs, with a budget the server enforces.**
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
each run under its own agent's instructions, budget and pause. Built:
`77-agents.js`, the run path in `15-run-context-and-execution.js`, Agents in
Crew; `an-agent-works-within-what-it-was-given`, `an-agent-you-can-see-working`.

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

**26. Companion - YES, as an agent, not a separate system.**
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
