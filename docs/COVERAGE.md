# Worker coverage

Measured by `node scripts/coverage.mjs` - V8's own block coverage over every
Worker suite (tests/worker), mapped back onto `src/worker/`. Generated on
2026-11-24 from 425 suites.

"Functions" is how many top-level functions any suite called at all. "Code" is the share of
code inside blocks that ran - an `if` whose branch never ran is a block that did not run, so
this is branch coverage in bytes. Browser suites (tests/e2e) are not counted here: they drive
the Worker too, so these numbers are a floor.

**Whole Worker:** functions 1309/1309 (100.0%), code 92.8%.

## The trust areas

Every function in these areas that no Worker suite ever calls, by name. This list is the work.

### Sign-in, passkeys, two-step, sessions

Functions 139/139 (100.0%), code 91.8%.


### Company sign-in and SCIM

Functions 30/30 (100.0%), code 81.7%.


### Teams and permissions

Functions 47/47 (100.0%), code 88.5%.


### Money: subscriptions, payments, credit, payouts, marketplace

Functions 77/77 (100.0%), code 93.9%.


### Spending limits and usage

Functions 50/50 (100.0%), code 93.2%.


### Action protocol (writes on connected accounts)

Functions 6/6 (100.0%), code 91.0%.


### Webhooks and event triggers

Functions 52/52 (100.0%), code 93.3%.


## Every file

| File | Functions called | Code |
|---|---|---|
| `01-config.js` | 3/3 | 97.4% |
| `02-partner-engines.js` | 27/27 | 95.2% |
| `03-routing-and-cache.js` | 2/2 | 98.8% |
| `04-data-layer.js` | 33/33 | 95.5% |
| `04a-control-plane.js` | 18/18 | 92.3% |
| `04b-pg-backfill.js` | 18/18 | 90.7% |
| `04c-pg-shadow.js` | 6/6 | 90.3% |
| `04d-pg-read.js` | 17/17 | 92.5% |
| `05-audit-log.js` | 13/13 | 97.9% |
| `06-input-validation.js` | 2/2 | 90.7% |
| `07-atomic-counters.js` | 19/19 | 94.6% |
| `08-automations.js` | 7/7 | 97.8% |
| `09-connected-accounts.js` | 36/36 | 88.7% |
| `09a-action-protocol.js` | 6/6 | 91.0% |
| `10-cloud-computer.js` | 12/12 | 91.5% |
| `10a-cloud-checkout.js` | 4/4 | 77.6% |
| `11-company-sign-in.js` | 15/15 | 79.8% |
| `12-app-connectors.js` | 34/34 | 90.6% |
| `13-schedules-and-approvals.js` | 30/30 | 92.7% |
| `14-renewal-finder.js` | 25/25 | 98.4% |
| `15-run-context-and-execution.js` | 36/36 | 93.3% |
| `15a-job-queue.js` | 12/12 | 92.8% |
| `16-site-deploys.js` | 6/6 | 92.9% |
| `17-error-reporting.js` | 2/2 | 99.5% |
| `18-web-agent.js` | 11/11 | 96.2% |
| `19-outbound-requests.js` | 5/5 | 92.1% |
| `20-school.js` | 10/10 | 85.6% |
| `21-web-agent-secrets.js` | 13/13 | 98.3% |
| `22-subscribe.js` | 4/4 | 89.7% |
| `23-consent.js` | 1/1 | 95.7% |
| `24-bank-data.js` | 18/18 | 83.2% |
| `25-linked-accounts.js` | 22/22 | 76.5% |
| `26-crew-sync.js` | 7/7 | 87.6% |
| `27-backup-restore.js` | 14/14 | 94.7% |
| `27a-nightly-backup.js` | 23/23 | 86.4% |
| `28-password-reset.js` | 7/7 | 92.6% |
| `29-router.js` | 14/14 | 92.9% |
| `30-accounts-and-sync.js` | 20/20 | 96.9% |
| `31-sign-in-codes.js` | 38/38 | 90.3% |
| `32-teams.js` | 13/13 | 95.3% |
| `33-team-roles.js` | 34/34 | 86.8% |
| `34-chat-sync.js` | 16/16 | 95.8% |
| `34a-retention.js` | 8/8 | 97.1% |
| `35-batches.js` | 19/19 | 92.0% |
| `36-share-pages.js` | 12/12 | 93.6% |
| `37-connector-directory.js` | 3/3 | 97.7% |
| `38-connector-logos.js` | 10/10 | 87.0% |
| `39-resumable-streams.js` | 17/17 | 94.6% |
| `40-widget.js` | 12/12 | 93.1% |
| `41-signed-tokens.js` | 31/31 | 93.4% |
| `42-deploy-routes.js` | 0/0 | 100.0% |
| `43-sms-agent.js` | 9/9 | 90.0% |
| `44-payments.js` | 2/2 | 99.3% |
| `45-abuse-and-activity.js` | 6/6 | 96.7% |
| `46-referrals.js` | 27/27 | 96.2% |
| `47-renewal-sweep.js` | 7/7 | 94.2% |
| `48-other-calendars.js` | 10/10 | 80.1% |
| `49-renewals-and-ledger.js` | 15/15 | 92.5% |
| `50-extra-usage.js` | 13/13 | 92.6% |
| `51-marketplace.js` | 3/3 | 93.4% |
| `52-marketplace-trust.js` | 11/11 | 92.9% |
| `53-marketplace-economy.js` | 43/43 | 94.8% |
| `54-payouts.js` | 8/8 | 93.7% |
| `55-listing-reports.js` | 11/11 | 89.8% |
| `56-admin.js` | 21/21 | 97.4% |
| `57-public-api.js` | 7/7 | 94.9% |
| `58-public-config-and-funnel.js` | 3/3 | 99.1% |
| `59-support.js` | 3/3 | 97.9% |
| `60-readiness.js` | 9/9 | 96.6% |
| `61-owner-digest.js` | 35/35 | 87.8% |
| `62-global-mail.js` | 28/28 | 89.8% |
| `63-run-needs.js` | 3/3 | 99.4% |
| `64-job-boards.js` | 2/2 | 95.6% |
| `65-country-capabilities.js` | 6/6 | 99.9% |
| `66-telegram.js` | 5/5 | 75.7% |
| `67-weekly-habits.js` | 2/2 | 100.0% |
| `68-cloud-library.js` | 22/22 | 90.5% |
| `68-refunds.js` | 10/10 | 86.8% |
| `69-buying.js` | 8/8 | 92.9% |
| `69-speech.js` | 8/8 | 93.8% |
| `70-hooks.js` | 22/22 | 94.7% |
| `71-scim.js` | 15/15 | 84.0% |
| `72-web-takeover.js` | 10/10 | 80.3% |
| `73-passkeys-and-mfa.js` | 43/43 | 89.5% |
| `74-site-icons.js` | 6/6 | 94.1% |
| `75-source-previews.js` | 3/3 | 97.7% |
| `76-email-words.js` | 2/2 | 99.8% |
| `77-agents.js` | 21/21 | 89.4% |
| `77a-agent-signins.js` | 25/25 | 88.2% |
| `78-teach-replay.js` | 5/5 | 87.0% |
| `79-meaning.js` | 3/3 | 98.1% |
| `80-switches.js` | 10/10 | 90.9% |
| `81-web-push.js` | 15/15 | 94.7% |
| `82-tasks.js` | 4/4 | 94.4% |
| `83-support.js` | 4/4 | 84.6% |
| `85-synthetics.js` | 5/5 | 84.4% |
| `86-invite-beta.js` | 6/6 | 93.2% |
| `87-file-index.js` | 8/8 | 93.1% |

## Never called, outside the trust areas

None.
