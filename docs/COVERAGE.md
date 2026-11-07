# Worker coverage

Measured by `node scripts/coverage.mjs` - V8's own block coverage over every
Worker suite (tests/worker), mapped back onto `src/worker/`. Generated on
2026-11-07 from 395 suites.

"Functions" is how many top-level functions any suite called at all. "Code" is the share of
code inside blocks that ran - an `if` whose branch never ran is a block that did not run, so
this is branch coverage in bytes. Browser suites (tests/e2e) are not counted here: they drive
the Worker too, so these numbers are a floor.

**Whole Worker:** functions 1189/1195 (99.5%), code 92.8%.

## The trust areas

Every function in these areas that no Worker suite ever calls, by name. This list is the work.

### Sign-in, passkeys, two-step, sessions

Functions 126/126 (100.0%), code 91.3%.


### Company sign-in and SCIM

Functions 30/30 (100.0%), code 81.6%.


### Teams and permissions

Functions 46/46 (100.0%), code 88.3%.


### Money: subscriptions, payments, credit, payouts, marketplace

Functions 71/71 (100.0%), code 93.6%.


### Spending limits and usage

Functions 48/48 (100.0%), code 92.9%.


### Action protocol (writes on connected accounts)

Functions 6/6 (100.0%), code 87.3%.


### Webhooks and event triggers

Functions 52/52 (100.0%), code 93.3%.


## Every file

| File | Functions called | Code |
|---|---|---|
| `01-config.js` | 3/3 | 97.4% |
| `02-partner-engines.js` | 23/24 | 94.2% |
| `03-routing-and-cache.js` | 2/2 | 98.8% |
| `04-data-layer.js` | 23/23 | 95.5% |
| `04a-control-plane.js` | 16/16 | 90.2% |
| `04b-pg-backfill.js` | 17/17 | 91.0% |
| `04c-pg-shadow.js` | 6/6 | 90.3% |
| `04d-pg-read.js` | 16/16 | 92.5% |
| `05-audit-log.js` | 13/13 | 97.7% |
| `06-input-validation.js` | 2/2 | 90.3% |
| `07-atomic-counters.js` | 17/17 | 95.1% |
| `08-automations.js` | 7/7 | 97.8% |
| `09-connected-accounts.js` | 36/37 | 88.4% |
| `09a-action-protocol.js` | 6/6 | 87.3% |
| `10-cloud-computer.js` | 12/12 | 91.5% |
| `10a-cloud-checkout.js` | 4/4 | 77.1% |
| `11-company-sign-in.js` | 15/15 | 79.4% |
| `12-app-connectors.js` | 34/34 | 90.8% |
| `13-schedules-and-approvals.js` | 30/30 | 92.7% |
| `14-renewal-finder.js` | 25/25 | 98.4% |
| `15-run-context-and-execution.js` | 30/30 | 93.2% |
| `15a-job-queue.js` | 11/11 | 93.8% |
| `16-site-deploys.js` | 6/6 | 92.9% |
| `17-error-reporting.js` | 2/2 | 99.5% |
| `18-web-agent.js` | 11/11 | 97.9% |
| `19-outbound-requests.js` | 4/4 | 92.2% |
| `20-school.js` | 10/10 | 85.5% |
| `21-web-agent-secrets.js` | 13/13 | 98.2% |
| `22-subscribe.js` | 4/4 | 89.7% |
| `23-consent.js` | 1/1 | 95.7% |
| `24-bank-data.js` | 18/18 | 83.2% |
| `25-linked-accounts.js` | 22/22 | 77.0% |
| `26-crew-sync.js` | 7/7 | 87.6% |
| `27-backup-restore.js` | 9/10 | 95.9% |
| `27a-nightly-backup.js` | 16/16 | 85.2% |
| `28-password-reset.js` | 7/7 | 92.7% |
| `29-router.js` | 12/12 | 92.7% |
| `30-accounts-and-sync.js` | 20/20 | 97.0% |
| `31-sign-in-codes.js` | 30/30 | 89.7% |
| `32-teams.js` | 12/12 | 95.1% |
| `33-team-roles.js` | 34/34 | 86.7% |
| `34-chat-sync.js` | 16/16 | 96.8% |
| `34a-retention.js` | 8/8 | 97.1% |
| `35-batches.js` | 19/19 | 91.2% |
| `36-share-pages.js` | 12/12 | 93.6% |
| `37-connector-directory.js` | 2/2 | 93.3% |
| `38-connector-logos.js` | 10/10 | 86.6% |
| `39-resumable-streams.js` | 17/17 | 95.0% |
| `40-widget.js` | 12/12 | 93.1% |
| `41-signed-tokens.js` | 29/29 | 93.4% |
| `42-deploy-routes.js` | 0/0 | 100.0% |
| `43-sms-agent.js` | 9/9 | 90.6% |
| `44-payments.js` | 2/2 | 99.3% |
| `45-abuse-and-activity.js` | 6/6 | 92.8% |
| `46-referrals.js` | 27/27 | 96.2% |
| `47-renewal-sweep.js` | 7/7 | 93.9% |
| `48-other-calendars.js` | 10/10 | 79.8% |
| `49-renewals-and-ledger.js` | 9/9 | 89.6% |
| `50-extra-usage.js` | 13/13 | 92.1% |
| `51-marketplace.js` | 3/3 | 93.4% |
| `52-marketplace-trust.js` | 12/12 | 93.5% |
| `53-marketplace-economy.js` | 35/35 | 95.6% |
| `54-payouts.js` | 10/10 | 91.7% |
| `55-listing-reports.js` | 11/11 | 90.4% |
| `56-admin.js` | 15/15 | 98.3% |
| `57-public-api.js` | 7/7 | 97.7% |
| `58-public-config-and-funnel.js` | 3/3 | 99.1% |
| `59-support.js` | 3/3 | 97.9% |
| `60-readiness.js` | 9/9 | 96.9% |
| `61-owner-digest.js` | 35/35 | 87.6% |
| `62-global-mail.js` | 25/26 | 88.6% |
| `63-run-needs.js` | 3/3 | 99.4% |
| `64-job-boards.js` | 2/3 | 95.3% |
| `65-country-capabilities.js` | 6/6 | 99.9% |
| `66-telegram.js` | 5/5 | 76.5% |
| `67-weekly-habits.js` | 2/2 | 100.0% |
| `68-cloud-library.js` | 15/15 | 88.9% |
| `69-speech.js` | 8/8 | 93.8% |
| `70-hooks.js` | 22/22 | 94.7% |
| `71-scim.js` | 15/15 | 84.0% |
| `72-web-takeover.js` | 10/10 | 80.2% |
| `73-passkeys-and-mfa.js` | 40/40 | 87.4% |
| `74-site-icons.js` | 6/6 | 94.1% |
| `75-source-previews.js` | 3/3 | 97.7% |
| `76-email-words.js` | 2/2 | 99.8% |
| `77-agents.js` | 21/21 | 88.7% |
| `77a-agent-signins.js` | 22/22 | 88.7% |
| `78-teach-replay.js` | 5/5 | 86.8% |
| `79-meaning.js` | 3/3 | 97.7% |
| `80-switches.js` | 10/10 | 90.9% |
| `81-web-push.js` | 15/15 | 93.6% |
| `82-tasks.js` | 3/4 | 76.1% |
| `83-support.js` | 4/4 | 84.8% |
| `85-synthetics.js` | 5/5 | 86.4% |
