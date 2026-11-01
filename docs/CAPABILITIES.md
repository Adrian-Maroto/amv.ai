# What AMV can do

<!-- Generated from docs/capabilities.json by tools/capabilities-doc.mjs on every build. Edit the registry, not this page. -->

80 capabilities are built. Each names the code that does it and the test that proves it; the gate fails if either is missing. 7 more are planned and listed at the end.

## Accounts

| What | Built in | Proved by |
|---|---|---|
| Sign in with a passkey - the device's fingerprint, face or PIN, no password and no emailed code | `src/worker/73-passkeys-and-mfa.js`, `src/security/security.js` | `worker/a-passkey-or-a-second-step-guards-the-account.test.mjs`, `e2e/sign-in-with-a-passkey.test.mjs` |
| An authenticator app as the second step, recovery codes, and proof before any sign-in change | `src/worker/73-passkeys-and-mfa.js` | `worker/a-passkey-or-a-second-step-guards-the-account.test.mjs`, `e2e/sign-in-with-a-passkey.test.mjs` |

## Actions on connected accounts

| What | Built in | Proved by |
|---|---|---|
| Every write on a connected account is read back before it is called done | `src/worker/09a-action-protocol.js` | `worker/a-write-is-read-back-before-it-is-done.test.mjs` |
| Undo of what AMV did, itself read back, refused if somebody changed it since | `src/worker/09a-action-protocol.js` | `worker/what-amv-did-can-be-taken-back.test.mjs`, `e2e/a-done-thing-can-be-undone-from-the-screen.test.mjs` |

## Agents

| What | Built in | Proved by |
|---|---|---|
| Persistent named agents, kept out of the way: a job that works can be kept as an agent with its own instructions, monthly budget the server enforces, and pause | `src/worker/77-agents.js`, `src/worker/13-schedules-and-approvals.js`, `src/crew/mission-control.js` | `worker/an-agent-works-within-what-it-was-given.test.mjs`, `e2e/an-agent-you-can-see-working.test.mjs` |
| An agent can keep the person's sign-in for up to ten listed sites - sealed, never banks or payments, 30 days from the last watched sign-in, and used unattended only to read the pages its job names | `src/worker/77a-agent-signins.js`, `src/crew/mission-control.js` | `worker/an-agent-keeps-a-sign-in-only-where-it-may.test.mjs` |

## AMV’s browser

| What | Built in | Proved by |
|---|---|---|
| A hosted browser run you watch step by step, with Stop | `src/worker/25-linked-accounts.js` | `worker/a-web-run-is-watched-and-paid-for.test.mjs`, `e2e/watch-amv-use-a-website.test.mjs` |
| Sign-ins kept between runs, sealed on the person's device | `src/worker/21-web-agent-secrets.js` | `worker/a-web-run-is-watched-and-paid-for.test.mjs`, `e2e/watch-amv-use-a-website.test.mjs` |
| Take over the hosted browser to sign in or solve a check yourself, then carry on | `src/worker/72-web-takeover.js`, `src/web/web-live.js` | `worker/you-can-take-over-amvs-browser.test.mjs`, `e2e/watch-amv-use-a-website.test.mjs` |

## Background work

| What | Built in | Proved by |
|---|---|---|
| A task in steps, each waiting for the one before, kept going without you | `src/worker/12-app-connectors.js`, `src/worker/13-schedules-and-approvals.js` | `worker/a-task-in-steps-keeps-going-without-you.test.mjs` |
| A step that waits for several steps running side by side, handed every result | `src/worker/13-schedules-and-approvals.js`, `src/worker/12-app-connectors.js` | `worker/a-task-in-steps-keeps-going-without-you.test.mjs` |
| A background job can have a monthly budget of its own | `src/worker/77-agents.js`, `src/worker/13-schedules-and-approvals.js` | `worker/an-agent-works-within-what-it-was-given.test.mjs` |
| A background job can be steered for its next run with a note that is used once | `src/worker/13-schedules-and-approvals.js`, `src/worker/15-run-context-and-execution.js`, `src/crew/mission-control.js` | `worker/a-job-can-be-steered-for-its-next-run.test.mjs` |
| A step of a Task can be the critic that checks the steps it waits for, and one question can become two researchers and a critic | `src/worker/12-app-connectors.js`, `src/worker/15-run-context-and-execution.js` | `worker/a-task-in-steps-keeps-going-without-you.test.mjs` |

## Code

| What | Built in | Proved by |
|---|---|---|
| A GitHub repository opened at one exact commit in the cloud workspace | `src/worker/10a-cloud-checkout.js` | `worker/a-repository-opens-in-the-cloud-workspace.test.mjs` |
| Cloud changes sent back as a new branch, on the commit they were made on | `src/app/36c-cloud-repo.js` | `e2e/a-repository-goes-back-as-a-branch.test.mjs` |

## Data

| What | Built in | Proved by |
|---|---|---|
| A database is used only when switched on after a migration, and a record over its row limit is refused | `src/worker/04-data-layer.js` | `worker/binding-a-database-empties-nobody.test.mjs` |
| The control-plane schema for Postgres: append-only money ledgers, once-only provider events, one team per person | `migrations/postgres/0001_control_plane.sql` | `worker/the-control-plane-schema-holds-money.test.mjs` |
| Accounts and plans are also written to Postgres when the binding exists, in the background; KV still decides; a failed write never fails a request and is listed for repair; erasure leaves a tombstone | `src/worker/04a-control-plane.js`, `src/worker/04-data-layer.js` | `worker/accounts-and-plans-are-written-to-postgres-too.test.mjs` |
| The Postgres backfill copies what was there before, then reads every account back | `src/worker/04b-pg-backfill.js` | `worker/what-was-there-before-is-copied-and-checked.test.mjs` |
| Shadow reads compare Postgres with KV in the background while KV answers | `src/worker/04c-pg-shadow.js` | `worker/what-was-there-before-is-copied-and-checked.test.mjs` |
| How long the first real answer took, measured once per account | `src/worker/56-admin.js` | `worker/funnel.test.mjs` |
| For a chosen cohort, Postgres answers accounts and plans - written there first, checked against KV after every answer, handed back to KV on any difference | `src/worker/04d-pg-read.js` | `worker/postgres-answers-only-where-it-proved-it-can.test.mjs` |
| Conversations are kept only as long as the person or their team chose, enforced by the server and followed by the app | `src/worker/34a-retention.js`, `src/app/02-state.js` | `worker/conversations-are-kept-only-as-long-as-chosen.test.mjs`, `e2e/a-device-keeps-only-what-the-account-keeps.test.mjs` |

## Developers

| What | Built in | Proved by |
|---|---|---|
| A JavaScript SDK: messages, streaming, batches, your own tools, an agent loop | `sdk/amv-sdk.mjs` | `worker/amv-from-your-own-code.test.mjs` |

## Files

| What | Built in | Proved by |
|---|---|---|
| The file library searched from chat, on this device and in the account, the way a project's files are | `src/project/project-search.js`, `src/app/11c-agentic-chat.js` | `e2e/ask-about-a-file-you-sent-before.test.mjs`, `worker/the-tools-reach-the-model.test.mjs` |
| Folders in the file library, kept in the account and read back | `src/worker/68-cloud-library.js` | `worker/your-files-are-in-your-account.test.mjs`, `e2e/your-files-can-go-in-folders.test.mjs` |
| A file kept in the account must be what it says it is | `src/worker/68-cloud-library.js` | `worker/your-files-are-in-your-account.test.mjs` |

## Health

| What | Built in | Proved by |
|---|---|---|
| An Apple Health export read on the device (not a live connection) | `src/health/health.js` | `e2e/your-health-export-is-read-on-your-device.test.mjs` |

## Marketplace

| What | Built in | Proved by |
|---|---|---|
| A plugin read for what it would make AMV do before it is listed | `src/worker/52-marketplace-trust.js` | `worker/a-plugin-is-read-for-what-it-would-make-amv-do.test.mjs` |

## Notifications

| What | Built in | Proved by |
|---|---|---|
| Notifications on a device that said yes when a background job has a result or waits for approval: browser push services only, encrypted for that device and signed as AMV, in the device's language, naming the job and never the result | `src/worker/81-web-push.js`, `src/settings/settings-panes.js` | `worker/a-device-is-told-only-what-a-lock-screen-may-show.test.mjs` |
| Waiting email is retried through the job queue, on time | `src/worker/61-owner-digest.js` | `worker/an-email-that-could-not-go-is-sent-later.test.mjs` |

## Office files

| What | Built in | Proved by |
|---|---|---|
| An attached Word, Excel or PowerPoint file handed back changed, in place | `src/office/office.js` | `e2e/a-file-you-attach-comes-back-changed.test.mjs` |

## Operations

| What | Built in | Proved by |
|---|---|---|
| The deploy check reads the config as deployed, and a launch profile says what must be on | `preflight.mjs` | `worker/a-comment-is-not-a-binding.test.mjs` |
| A readiness check that asks the stores, separate from liveness | `src/worker/60-readiness.js` | `worker/alive-is-not-ready.test.mjs` |
| Switch off one feature, engine, connector or kind of write from the owner console, without a deploy | `src/worker/80-switches.js`, `src/settings/settings-panes.js` | `worker/one-part-of-amv-can-be-switched-off.test.mjs`, `e2e/the-owner-can-switch-off-one-part.test.mjs` |
| An email the provider could not take is retried with one idempotency key, and mail that can arrive late waits in an outbox | `src/worker/61-owner-digest.js` | `worker/an-email-that-could-not-go-is-sent-later.test.mjs` |
| A chat turn the primary model endpoint refuses goes to the fallback before its first word, and a failing primary is skipped for thirty seconds | `src/worker/02-partner-engines.js` | `worker/model-transport.test.mjs` |
| A load probe that counts every storage operation per request and per account, with budgets that fail the build on a key everybody shares | `tools/load-probe.mjs`, `src/worker/07-atomic-counters.js` | `worker/no-key-is-shared-by-everybody.test.mjs` |
| Actions on people's accounts counted by what AMV confirmed - done, unconfirmed, failed, undone - on the owner dashboard | `src/worker/09a-action-protocol.js` | `worker/what-amv-did-can-be-taken-back.test.mjs` |
| A chaos suite: storage, counters and the model failing at random across thousands of real requests - no spend without a reservation, no shut door opened, no crash, no internal error shown | `src/worker/35-batches.js`, `src/worker/39-resumable-streams.js`, `src/worker/07-atomic-counters.js` | `worker/when-everything-breaks-nothing-opens.test.mjs` |
| Background work through a queue when one is bound: one message per due account, run in parallel with retries and a dead-letter queue; without the binding the tick runs every account itself, and a queue that refuses never costs a job | `src/worker/15a-job-queue.js`, `src/worker/15-run-context-and-execution.js` | `worker/background-work-goes-through-the-queue.test.mjs` |
| Every night backed up when the backups bucket is bound: a slice per tick, resumed where it stopped, complete only with its manifest, thirty nights kept, late nights paged, restorable through the same rules as any restore | `src/worker/27a-nightly-backup.js`, `src/worker/27-backup-restore.js` | `worker/every-night-is-backed-up.test.mjs` |
| Brownout: the heavy parts pause together while sign-in, payments and everyday chat keep working | `src/worker/80-switches.js` | `worker/one-part-of-amv-can-be-switched-off.test.mjs` |
| A restore drill reads a whole nightly backup through the restore path, checks every part's checksum and writes nothing; a restore needs a sound drill of that night first | `src/worker/27a-nightly-backup.js`, `backup.mjs` | `worker/every-night-is-backed-up.test.mjs` |
| A commit with a real-shaped credential in it fails the gate | `check.mjs` | `worker/check.test.mjs` |
| A server that sees the model provider failing tells the others | `src/worker/02-partner-engines.js` | `worker/model-transport.test.mjs` |
| The partner engines have a daily spending ceiling of their own | `src/worker/35-batches.js` | `worker/partner-engines-are-sold-as-amv.test.mjs` |
| An eval framework and a canary for engine and prompt changes | `tools/evals.mjs` | `worker/an-eval-grades-what-it-says.test.mjs` |
| A new backend version serves a tenth of requests and must answer ready before it serves everybody | `scripts/canary-deploy.mjs`, `.github/workflows/deploy.yml` | `worker/a-new-version-serves-a-few-before-everybody.test.mjs` |
| A deployed version that is not ready is rolled back without waiting for anybody | `.github/workflows/deploy.yml` | `worker/a-new-version-serves-a-few-before-everybody.test.mjs` |
| The cloud computer's image is scanned for known vulnerabilities and fails on any that a rebuild can fix | `.github/workflows/image-scan.yml` | `worker/the-cloud-image-is-scanned.test.mjs` |

## Projects

| What | Built in | Proved by |
|---|---|---|
| A project's files searched for each message, so the passage asked about is sent from any file | `src/project/project-search.js`, `src/app/07b-projects.js` | `e2e/a-project-finds-the-part-you-asked-about.test.mjs` |

## Research

| What | Built in | Proved by |
|---|---|---|
| A finished research answer shows the picture each cited page chose (og:image), fetched by AMV's server, never the person's browser | `src/worker/75-source-previews.js`, `src/app/05-ui-blocks.js` | `worker/a-source-picture-is-fetched-by-amv.test.mjs`, `e2e/a-source-says-what-kind-of-site-it-is.test.mjs` |

## Search

| What | Built in | Proved by |
|---|---|---|
| File and project searches also score passages by meaning with a multilingual model, blended with words, nothing stored (on when the deployment binds Workers AI) | `src/worker/79-meaning.js`, `src/project/project-search.js` | `worker/a-search-can-find-it-by-meaning.test.mjs`, `e2e/a-search-can-find-it-by-meaning.test.mjs` |
| Searches over files, past chats and a large project take other phrasings in the same call, and a large project can be searched again from chat | `src/project/project-search.js`, `src/app/11c-agentic-chat.js` | `e2e/a-search-finds-it-in-other-words.test.mjs` |

## Sign-in

| What | Built in | Proved by |
|---|---|---|
| Sign-up is passkey-first: the account and its passkey are made together; a password alone needs 15 characters | `src/worker/73-passkeys-and-mfa.js`, `src/app/03-sessions.js` | `worker/a-passkey-or-a-second-step-guards-the-account.test.mjs`, `e2e/sign-in-with-a-passkey.test.mjs` |
| Password hashes keyed with a secret the store never holds, upgraded at sign-in, rotatable, failing closed without the key | `src/worker/30-accounts-and-sync.js` | `worker/a-stolen-store-cannot-be-guessed-against.test.mjs` |

## Teaching

| What | Built in | Proved by |
|---|---|---|
| Teach AMV a task by doing it once in its browser, with checks; it becomes a skill you review, and Run it now replays the recorded steps exactly, stopping at the first one that fails | `src/worker/72-web-takeover.js`, `src/worker/78-teach-replay.js`, `src/web/web-live.js`, `src/skills/skills.js` | `worker/teach-amv-by-showing-it.test.mjs`, `worker/a-taught-task-replays-and-checks-itself.test.mjs`, `e2e/teach-amv-by-showing-it.test.mjs` |

## Teams

| What | Built in | Proved by |
|---|---|---|
| A read-only Viewer role on teams: reads shared work and projects, and the server refuses every change it tries | `src/worker/33-team-roles.js`, `src/team/team-projects.js` | `worker/a-viewer-reads-and-does-not-change.test.mjs` |
| Company sign-in over OpenID Connect, on a domain proved by DNS | `src/worker/11-company-sign-in.js` | `worker/a-company-signs-in-only-its-own-people.test.mjs` |
| People added and removed, and admins named, by the company's directory (SCIM 2.0 Users and Groups) | `src/worker/71-scim.js`, `src/team/team-sso.js` | `worker/a-company-directory-adds-and-removes-its-people.test.mjs`, `worker/a-company-directory-decides-who-is-admin.test.mjs`, `e2e/sign-in-with-your-company.test.mjs` |
| A team can refuse to send credentials and card numbers to AMV, enforced on the server | `src/worker/35-batches.js`, `src/worker/33-team-roles.js` | `worker/a-team-chooses-its-engines.test.mjs` |
| A team's whole activity, kept by day for 400 days, downloadable as NDJSON by an owner, an admin or their API key | `src/worker/33-team-roles.js`, `src/app/06-team-market.js` | `worker/a-team-can-take-its-whole-history-away.test.mjs` |

## The cloud computer

| What | Built in | Proved by |
|---|---|---|
| The cloud workspace outlives its container when the workspace bucket is bound: saved before an idle machine stops, restored before the next one answers, packages and caches left out, deleted with the account | `cloud/computer.mjs`, `bridge/amv-bridge.mjs`, `src/worker/10-cloud-computer.js` | `worker/the-cloud-workspace-outlives-its-container.test.mjs` |
| A saved cloud workspace carries its checksum, and a copy that does not match is never unpacked | `bridge/amv-bridge.mjs`, `cloud/computer.mjs` | `worker/the-cloud-workspace-outlives-its-container.test.mjs` |
| Every cloud workspace busy: connecting waits for one instead of failing | `src/app/36-bridge.js` | `e2e/no-computer-to-hand-amv-lends-you-one.test.mjs` |
| The cloud workspace keeps its five earlier saved copies, and any of them can be put back without losing the current one | `cloud/computer.mjs`, `src/worker/10-cloud-computer.js`, `src/app/36d-workspace-copies.js` | `worker/the-cloud-workspace-outlives-its-container.test.mjs` |

## Triggers

| What | Built in | Proved by |
|---|---|---|
| When matching mail arrives, a job runs | `src/worker/13-schedules-and-approvals.js`, `src/worker/15-run-context-and-execution.js` | `worker/when-it-arrives-amv-acts.test.mjs` |
| When a matching calendar event appears, a job runs | `src/worker/15-run-context-and-execution.js` | `worker/when-it-arrives-amv-acts.test.mjs` |
| When a watched word appears on or leaves a public page, a job runs | `src/worker/15-run-context-and-execution.js` | `worker/when-it-arrives-amv-acts.test.mjs` |
| When a pull request, issue, push or release appears on a GitHub repository, a job runs | `src/worker/13-schedules-and-approvals.js` | `worker/when-it-arrives-amv-acts.test.mjs`, `worker/a-run-asks-for-what-it-needs.test.mjs` |
| A job started by a request from another service, at an address of its own | `src/worker/70-hooks.js` | `worker/another-service-can-start-a-job.test.mjs` |
| A job that accepts only requests signed by GitHub, Stripe, Slack or AMV's standard, with a time window, no replay and a day's overlap when the secret changes | `src/worker/70-hooks.js`, `src/crew/mission-control.js` | `worker/a-signed-request-proves-its-sender.test.mjs`, `e2e/require-a-signed-request-to-start-a-job.test.mjs` |
| When a matching message is posted in Slack, a job runs - from the person's own Slack app, signed with its Signing Secret, bots ignored | `src/worker/70-hooks.js`, `src/worker/63-run-needs.js`, `src/crew/mission-control.js` | `worker/a-slack-message-starts-a-job.test.mjs`, `e2e/require-a-signed-request-to-start-a-job.test.mjs` |

## Voice

| What | Built in | Proved by |
|---|---|---|
| Speech heard on the server, with the time of every line | `src/worker/69-speech.js` | `worker/what-amv-hears-and-says-is-paid-for.test.mjs`, `e2e/a-recording-becomes-a-transcript.test.mjs` |
| Speech spoken by the server | `src/worker/69-speech.js` | `worker/what-amv-hears-and-says-is-paid-for.test.mjs` |
| Voice mode that speaks as it writes and stops when talked over | `src/voice/live-voice.js` | `e2e/talk-to-amv-and-interrupt-it.test.mjs` |

## Where AMV runs

| What | Built in | Proved by |
|---|---|---|
| Bring a page, a selection or a link from Chrome into a new chat | `chrome/background.js` | `worker/the-chrome-extension-holds-nothing-worth-stealing.test.mjs`, `e2e/a-page-from-chrome-lands-in-a-new-chat.test.mjs` |
| JetBrains IDEs, through External Tools running the command-line tool | `jetbrains/amv-jetbrains.xml` | `worker/amv-from-a-terminal.test.mjs` |

## Planned, not built

| What | Decided |
|---|---|
| Accounts, plans, money and keys read and written in Postgres | needs Choose the Postgres provider and create the Hyperdrive configuration (docs/DATA-TIER.md) |
| Signed-in sites used by a background run while the device is off | No: a server-side store of live sign-ins is refused, opt-in or not - docs/OWNER-DECISIONS.md #4. Takeover and waiting for the device instead. |
| One realtime model that hears and speaks | Not this cycle - docs/OWNER-DECISIONS.md #5 |
| Plugins that carry code, run sandboxed, signed and scanned | No: declarative plugins and MCP connectors instead - docs/OWNER-DECISIONS.md #10 |
| Documents, sheets and slides that you and AMV edit together, live | Yes, next: tracked edits first, then cross-device, then live co-editing - docs/OWNER-DECISIONS.md #11 |
| A native JetBrains plugin with a tool window and inline diffs | No for now - docs/OWNER-DECISIONS.md #7 |
| Health data read live from the phone, not from an export | needs a native app with HealthKit or Health Connect permission |
