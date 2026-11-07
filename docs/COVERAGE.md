# Worker coverage

Measured by `node scripts/coverage.mjs` - V8's own block coverage over every
Worker suite (tests/worker), mapped back onto `src/worker/`. Generated on
2026-11-07 from 389 suites.

"Functions" is how many top-level functions any suite called at all. "Code" is the share of
code inside blocks that ran - an `if` whose branch never ran is a block that did not run, so
this is branch coverage in bytes. Browser suites (tests/e2e) are not counted here: they drive
the Worker too, so these numbers are a floor.

**Whole Worker:** functions 1166/1184 (98.5%), code 92.8%.

## The trust areas

Every function in these areas that no Worker suite ever calls, by name. This list is the work.

### Sign-in, passkeys, two-step, sessions

Functions 123/123 (100.0%), code 91.8%.


### Company sign-in and SCIM

Functions 30/30 (100.0%), code 81.7%.


### Teams and permissions

Functions 46/46 (100.0%), code 87.5%.


### Money: subscriptions, payments, credit, payouts, marketplace

Functions 71/71 (100.0%), code 93.9%.


### Spending limits and usage

Functions 48/48 (100.0%), code 92.4%.


### Action protocol (writes on connected accounts)

Functions 6/6 (100.0%), code 87.3%.


### Webhooks and event triggers

Functions 52/52 (100.0%), code 93.5%.


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
| `39-resumable-streams.js` | 17/17 | 95.2% |
| `40-widget.js` | 12/12 | 92.8% |
| `41-signed-tokens.js` | 29/29 | 94.9% |
| `42-deploy-routes.js` | 0/0 | 100.0% |
| `43-sms-agent.js` | 9/9 | 90.0% |
| `44-payments.js` | 2/2 | 99.3% |
| `45-abuse-and-activity.js` | 6/6 | 94.0% |
| `46-referrals.js` | 27/27 | 97.1% |
| `47-renewal-sweep.js` | 7/7 | 95.1% |
| `48-other-calendars.js` | 8/10 | 74.5% |
| `49-renewals-and-ledger.js` | 9/9 | 90.6% |
| `50-extra-usage.js` | 13/13 | 92.4% |
| `51-marketplace.js` | 3/3 | 94.3% |
| `52-marketplace-trust.js` | 12/12 | 93.9% |
| `53-marketplace-economy.js` | 35/35 | 95.7% |
| `54-payouts.js` | 10/10 | 92.0% |
| `55-listing-reports.js` | 11/11 | 90.1% |
| `56-admin.js` | 12/12 | 98.8% |
| `57-public-api.js` | 7/7 | 97.5% |
| `58-public-config-and-funnel.js` | 3/3 | 99.4% |
| `59-support.js` | 3/3 | 98.5% |
| `60-readiness.js` | 9/9 | 97.5% |
| `61-owner-digest.js` | 35/35 | 88.5% |
| `62-global-mail.js` | 22/26 | 89.4% |
| `63-run-needs.js` | 3/3 | 100.0% |
| `64-job-boards.js` | 1/3 | 98.2% |
| `65-country-capabilities.js` | 5/6 | 99.7% |
| `66-telegram.js` | 3/5 | 80.1% |
| `67-weekly-habits.js` | 2/2 | 100.0% |
| `68-cloud-library.js` | 15/15 | 90.0% |
| `69-speech.js` | 8/8 | 95.7% |
| `70-hooks.js` | 22/22 | 95.8% |
| `71-scim.js` | 15/15 | 84.3% |
| `72-web-takeover.js` | 10/10 | 81.0% |
| `73-passkeys-and-mfa.js` | 40/40 | 88.8% |
| `74-site-icons.js` | 6/6 | 95.5% |
| `75-source-previews.js` | 3/3 | 98.4% |
| `76-email-words.js` | 2/2 | 100.0% |
| `77-agents.js` | 21/21 | 90.2% |
| `77a-agent-signins.js` | 22/22 | 90.9% |
| `78-teach-replay.js` | 5/5 | 87.0% |
| `79-meaning.js` | 3/3 | 98.6% |
| `80-switches.js` | 10/10 | 95.1% |
| `81-web-push.js` | 15/15 | 96.1% |
| `82-tasks.js` | 3/4 | 79.1% |
| `83-support.js` | 4/4 | 89.9% |
