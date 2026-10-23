# Worker coverage

Measured by `node scripts/coverage.mjs` - V8's own block coverage over every
Worker suite (tests/worker), mapped back onto `src/worker/`. Generated on
2026-10-23 from 322 suites.

"Functions" is how many top-level functions any suite called at all. "Code" is the share of
code inside blocks that ran - an `if` whose branch never ran is a block that did not run, so
this is branch coverage in bytes. Browser suites (tests/e2e) are not counted here: they drive
the Worker too, so these numbers are a floor.

**Whole Worker:** functions 865/883 (98.0%), code 92.7%.

## The trust areas

Every function in these areas that no Worker suite ever calls, by name. This list is the work.

### Sign-in, passkeys, two-step, sessions

Functions 103/103 (100.0%), code 91.7%.


### Company sign-in and SCIM

Functions 25/25 (100.0%), code 82.3%.


### Teams and permissions

Functions 42/42 (100.0%), code 87.2%.


### Money: subscriptions, payments, credit, payouts, marketplace

Functions 66/66 (100.0%), code 94.1%.


### Spending limits and usage

Functions 31/31 (100.0%), code 91.0%.


### Action protocol (writes on connected accounts)

Functions 4/4 (100.0%), code 86.4%.


### Webhooks and event triggers

Functions 52/52 (100.0%), code 94.0%.


## Every file

| File | Functions called | Code |
|---|---|---|
| `01-config.js` | 3/3 | 97.4% |
| `02-partner-engines.js` | 17/18 | 92.8% |
| `03-routing-and-cache.js` | 2/2 | 98.8% |
| `04-data-layer.js` | 13/13 | 98.1% |
| `05-audit-log.js` | 9/9 | 96.3% |
| `06-input-validation.js` | 2/2 | 87.7% |
| `07-atomic-counters.js` | 5/5 | 97.0% |
| `08-automations.js` | 7/7 | 98.1% |
| `09-connected-accounts.js` | 36/37 | 87.5% |
| `09a-action-protocol.js` | 4/4 | 86.4% |
| `10-cloud-computer.js` | 8/8 | 91.4% |
| `10a-cloud-checkout.js` | 4/4 | 77.3% |
| `11-company-sign-in.js` | 15/15 | 79.7% |
| `12-app-connectors.js` | 33/34 | 88.7% |
| `13-schedules-and-approvals.js` | 30/30 | 93.7% |
| `14-renewal-finder.js` | 25/25 | 98.4% |
| `15-run-context-and-execution.js` | 26/26 | 94.2% |
| `16-site-deploys.js` | 6/6 | 92.5% |
| `17-error-reporting.js` | 2/2 | 99.5% |
| `18-web-agent.js` | 10/11 | 95.8% |
| `19-outbound-requests.js` | 4/4 | 92.2% |
| `20-school.js` | 10/10 | 84.6% |
| `21-web-agent-secrets.js` | 13/13 | 98.2% |
| `22-subscribe.js` | 4/4 | 89.0% |
| `23-consent.js` | 1/1 | 94.4% |
| `24-bank-data.js` | 18/18 | 82.2% |
| `25-linked-accounts.js` | 22/22 | 76.9% |
| `26-crew-sync.js` | 7/7 | 86.7% |
| `27-backup-restore.js` | 8/9 | 96.1% |
| `28-password-reset.js` | 7/7 | 93.7% |
| `29-router.js` | 8/8 | 89.3% |
| `30-accounts-and-sync.js` | 8/8 | 97.3% |
| `31-sign-in-codes.js` | 27/27 | 90.9% |
| `32-teams.js` | 12/12 | 94.8% |
| `33-team-roles.js` | 30/30 | 85.0% |
| `34-chat-sync.js` | 15/15 | 95.7% |
| `35-batches.js` | 14/14 | 88.3% |
| `36-share-pages.js` | 12/12 | 92.4% |
| `37-connector-directory.js` | 2/2 | 93.3% |
| `38-connector-logos.js` | 8/10 | 83.8% |
| `39-resumable-streams.js` | 9/9 | 93.4% |
| `40-widget.js` | 12/12 | 89.3% |
| `41-signed-tokens.js` | 22/22 | 96.6% |
| `42-deploy-routes.js` | 0/0 | 100.0% |
| `43-sms-agent.js` | 9/9 | 89.6% |
| `44-payments.js` | 2/2 | 99.3% |
| `45-abuse-and-activity.js` | 6/6 | 92.8% |
| `46-referrals.js` | 27/27 | 96.6% |
| `47-renewal-sweep.js` | 6/6 | 95.1% |
| `48-other-calendars.js` | 8/10 | 73.7% |
| `49-prediction-markets.js` | 9/9 | 90.9% |
| `50-extra-usage.js` | 10/10 | 91.6% |
| `51-marketplace.js` | 3/3 | 93.4% |
| `52-marketplace-trust.js` | 10/10 | 93.4% |
| `53-marketplace-economy.js` | 34/34 | 96.3% |
| `54-payouts.js` | 10/10 | 92.3% |
| `55-listing-reports.js` | 11/11 | 90.0% |
| `56-admin.js` | 8/8 | 98.5% |
| `57-public-api.js` | 7/7 | 97.0% |
| `58-public-config-and-funnel.js` | 3/3 | 99.1% |
| `59-support.js` | 3/3 | 97.9% |
| `60-readiness.js` | 6/6 | 96.9% |
| `61-owner-digest.js` | 30/30 | 87.1% |
| `62-global-mail.js` | 22/26 | 87.2% |
| `63-run-needs.js` | 3/3 | 99.4% |
| `64-job-boards.js` | 1/3 | 94.9% |
| `65-country-capabilities.js` | 5/6 | 99.7% |
| `66-telegram.js` | 3/5 | 71.0% |
| `67-weekly-habits.js` | 2/2 | 100.0% |
| `68-cloud-library.js` | 13/13 | 85.2% |
| `69-speech.js` | 8/8 | 93.3% |
| `70-hooks.js` | 22/22 | 94.7% |
| `71-scim.js` | 10/10 | 86.9% |
| `72-web-takeover.js` | 5/5 | 81.3% |
| `73-passkeys-and-mfa.js` | 39/39 | 85.2% |
