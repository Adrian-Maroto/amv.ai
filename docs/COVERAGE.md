# Worker coverage

Measured by `node scripts/coverage.mjs` - V8's own block coverage over every
Worker suite (tests/worker), mapped back onto `src/worker/`. Generated on
2026-11-07 from 389 suites (1 exited non-zero: erasure.test.mjs).

"Functions" is how many top-level functions any suite called at all. "Code" is the share of
code inside blocks that ran - an `if` whose branch never ran is a block that did not run, so
this is branch coverage in bytes. Browser suites (tests/e2e) are not counted here: they drive
the Worker too, so these numbers are a floor.

**Whole Worker:** functions 1166/1184 (98.5%), code 92.4%.

## The trust areas

Every function in these areas that no Worker suite ever calls, by name. This list is the work.

### Sign-in, passkeys, two-step, sessions

Functions 123/123 (100.0%), code 91.4%.


### Company sign-in and SCIM

Functions 30/30 (100.0%), code 81.5%.


### Teams and permissions

Functions 46/46 (100.0%), code 87.5%.


### Money: subscriptions, payments, credit, payouts, marketplace

Functions 71/71 (100.0%), code 93.3%.


### Spending limits and usage

Functions 48/48 (100.0%), code 92.4%.


### Action protocol (writes on connected accounts)

Functions 6/6 (100.0%), code 87.3%.


### Webhooks and event triggers

Functions 52/52 (100.0%), code 93.2%.


## Every file

| File | Functions called | Code |
|---|---|---|
| `01-config.js` | 3/3 | 97.4% |
| `02-partner-engines.js` | 23/24 | 94.2% |
| `03-routing-and-cache.js` | 2/2 | 98.8% |
| `04-data-layer.js` | 23/23 | 95.5% |
| `04a-control-plane.js` | 16/16 | 90.2% |
| `04b-pg-backfill.js` | 17/17 | 91.0% |
| `04c-pg-shadow.js` | 6/6 | 90.1% |
| `04d-pg-read.js` | 16/16 | 92.5% |
| `05-audit-log.js` | 13/13 | 97.7% |
| `06-input-validation.js` | 2/2 | 90.3% |
| `07-atomic-counters.js` | 17/17 | 95.0% |
| `08-automations.js` | 7/7 | 97.8% |
| `09-connected-accounts.js` | 36/37 | 88.4% |
| `09a-action-protocol.js` | 6/6 | 87.3% |
| `10-cloud-computer.js` | 12/12 | 90.7% |
| `10a-cloud-checkout.js` | 4/4 | 77.1% |
| `11-company-sign-in.js` | 15/15 | 79.2% |
| `12-app-connectors.js` | 33/34 | 88.9% |
| `13-schedules-and-approvals.js` | 30/30 | 92.6% |
| `14-renewal-finder.js` | 25/25 | 98.4% |
| `15-run-context-and-execution.js` | 30/30 | 93.2% |
| `15a-job-queue.js` | 11/11 | 93.8% |
| `16-site-deploys.js` | 6/6 | 92.4% |
| `17-error-reporting.js` | 2/2 | 99.5% |
| `18-web-agent.js` | 11/11 | 97.3% |
| `19-outbound-requests.js` | 4/4 | 92.2% |
| `20-school.js` | 10/10 | 84.6% |
| `21-web-agent-secrets.js` | 13/13 | 98.2% |
| `22-subscribe.js` | 4/4 | 89.0% |
| `23-consent.js` | 1/1 | 94.4% |
| `24-bank-data.js` | 18/18 | 82.2% |
| `25-linked-accounts.js` | 22/22 | 76.5% |
| `26-crew-sync.js` | 7/7 | 86.7% |
| `27-backup-restore.js` | 9/10 | 96.0% |
| `27a-nightly-backup.js` | 16/16 | 85.1% |
| `28-password-reset.js` | 7/7 | 92.7% |
| `29-router.js` | 12/12 | 88.2% |
| `30-accounts-and-sync.js` | 20/20 | 97.0% |
| `31-sign-in-codes.js` | 27/27 | 89.8% |
| `32-teams.js` | 12/12 | 94.8% |
| `33-team-roles.js` | 34/34 | 85.8% |
| `34-chat-sync.js` | 16/16 | 96.8% |
| `34a-retention.js` | 8/8 | 96.3% |
| `35-batches.js` | 19/19 | 90.8% |
| `36-share-pages.js` | 12/12 | 92.4% |
| `37-connector-directory.js` | 2/2 | 93.3% |
| `38-connector-logos.js` | 8/10 | 83.8% |
| `39-resumable-streams.js` | 17/17 | 94.9% |
| `40-widget.js` | 12/12 | 92.5% |
| `41-signed-tokens.js` | 29/29 | 93.4% |
| `42-deploy-routes.js` | 0/0 | 100.0% |
| `43-sms-agent.js` | 9/9 | 89.6% |
| `44-payments.js` | 2/2 | 99.3% |
| `45-abuse-and-activity.js` | 6/6 | 92.8% |
| `46-referrals.js` | 27/27 | 96.2% |
| `47-renewal-sweep.js` | 7/7 | 93.7% |
| `48-other-calendars.js` | 8/10 | 73.7% |
| `49-renewals-and-ledger.js` | 9/9 | 89.4% |
| `50-extra-usage.js` | 13/13 | 91.8% |
| `51-marketplace.js` | 3/3 | 93.4% |
| `52-marketplace-trust.js` | 12/12 | 93.5% |
| `53-marketplace-economy.js` | 35/35 | 95.2% |
| `54-payouts.js` | 10/10 | 91.5% |
| `55-listing-reports.js` | 11/11 | 90.0% |
| `56-admin.js` | 12/12 | 98.6% |
| `57-public-api.js` | 7/7 | 96.8% |
| `58-public-config-and-funnel.js` | 3/3 | 99.1% |
| `59-support.js` | 3/3 | 97.9% |
| `60-readiness.js` | 9/9 | 96.7% |
| `61-owner-digest.js` | 35/35 | 87.5% |
| `62-global-mail.js` | 22/26 | 87.2% |
| `63-run-needs.js` | 3/3 | 99.4% |
| `64-job-boards.js` | 1/3 | 94.6% |
| `65-country-capabilities.js` | 5/6 | 99.7% |
| `66-telegram.js` | 3/5 | 71.0% |
| `67-weekly-habits.js` | 2/2 | 100.0% |
| `68-cloud-library.js` | 15/15 | 88.6% |
| `69-speech.js` | 8/8 | 93.3% |
| `70-hooks.js` | 22/22 | 94.7% |
| `71-scim.js` | 15/15 | 84.0% |
| `72-web-takeover.js` | 10/10 | 79.9% |
| `73-passkeys-and-mfa.js` | 40/40 | 87.4% |
| `74-site-icons.js` | 6/6 | 94.0% |
| `75-source-previews.js` | 3/3 | 97.7% |
| `76-email-words.js` | 2/2 | 99.8% |
| `77-agents.js` | 21/21 | 88.4% |
| `77a-agent-signins.js` | 22/22 | 88.5% |
| `78-teach-replay.js` | 5/5 | 86.3% |
| `79-meaning.js` | 3/3 | 97.7% |
| `80-switches.js` | 10/10 | 90.8% |
| `81-web-push.js` | 15/15 | 92.9% |
| `82-tasks.js` | 3/4 | 74.6% |
| `83-support.js` | 4/4 | 84.0% |
