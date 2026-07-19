## Usage model — plan tiers, not dollar passthrough

Users get named model tiers (AMV Pulse/Core/Forge/Apex → real backend models) and a
Claude-style rolling usage window shown as "% remaining on your plan" — never a dollar
balance. The plan PRICE is decoupled from raw token cost: monthly token allowances are
sized to stay ~28-46%+ margin even if fully maxed (blended ~\$6/Mtok), and are typically
80%+ in practice since cheaper models handle most calls. A 45% cost backstop remains as an
invisible anti-abuse floor normal users never hit. Guarded by tests/worker/plan-margins.test.mjs.
Allowances live in the LIMITS table (amv-backend.js) and PLAN_TIERS (app.js) — keep them in sync.

# Deploying AMV

The app (`index.html`) is a single file — host it anywhere (Netlify, Vercel, S3, GitHub Pages).
But **three features only work once the Worker is deployed**, because they need a server:

| Feature | Needs the Worker |
|---|---|
| Background automations (run with the app closed) | **yes — plus the cron trigger** |
| Cloud sync (work follows you across devices) | yes |
| Deploy & host live apps | yes |
| Chat / images / code / Lab | no — these work client-side |

---

## One command to know it’s shippable: npm run check

```bash
npm run check
```

Runs the whole gauntlet in fail-fast order and gives ONE green/red answer:
(1) syntax on both source files, (2) the Worker loads as an ES module — not just
parses as a script (node --check passes on a Worker that would fail to deploy;
this catches that), (3) a fresh build that actually reflects current source (no
stale index.html), (4) every test suite, (5) the deploy preflight. Exit 0 = ship
it; exit 1 = the first failure is spelled out. The dev-time KV placeholder is
surfaced as a warning, not a failure, so the gate stays green during development.
Run this before every ship.

## Before you deploy: run the preflight

```bash
npm run preflight
```

This checks your whole deploy config WITHOUT needing any keys: the Worker parses
as a module, wrangler.toml is valid, the KV namespace has a real id (not the
placeholder), the AMV_COUNTER Durable Object is bound + migrated + exported (this
is what makes usage limits actually hold), the cron is set, every binding the
Worker reads is declared, and the build is fresh. It exits non-zero if anything
would break the deploy. It also runs automatically before `npm run deploy`, so a
broken config can’t ship.

## 1. Create a KV namespace

```bash
npx wrangler kv namespace create AMV_KV
```

Copy the `id` it prints into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

## 2. Set your secrets

```bash
npx wrangler secret put ANTHROPIC_API_KEY   # required — automations call the model with this
npx wrangler secret put JWT_SECRET          # required — any long random string
npx wrangler secret put ADMIN_TOKEN        # required to view the error dashboard
npx wrangler secret put EMAIL_API_KEY      # Resend key — WITHOUT THIS, PASSWORD RESET NEVER SENDS
# RESET_EMAIL_FROM is optional — see "Password reset" below
```

## 3. Deploy the Worker

```bash
npx wrangler deploy
```

This prints your Worker URL, e.g. `https://amv-backend.<you>.workers.dev`.

**The cron trigger is already in `wrangler.toml`** (`crons = ["*/5 * * * *"]`).
Without deploying, automations never run in the background — that is the single
step people miss.

Verify it registered:

```bash
npx wrangler deployments list
```

## 4. Connect the app to the Worker

Open AMV → **Settings → AMV engine** → paste the Worker URL from step 3.

That's it. Automations now run on Cloudflare's schedule (even with AMV closed),
work syncs across devices, and Deploy publishes to `<your-worker>/s/<slug>`.

---

## Checking it works

- **Automations:** create one, then run `npx wrangler tail` and watch for `[cron] automations` every 5 minutes.
- **Deploy:** build something in Dev → Deploy → open the URL in a private window.
- **Sync:** sign in on a second browser; your Recents and Dev projects should appear.

## Password reset

Set ONE secret and reset emails work:

```bash
npx wrangler secret put EMAIL_API_KEY      # a Resend API key (resend.com — free tier is fine)
npx wrangler deploy
```

That's it. AMV falls back to Resend's `onboarding@resend.dev` sender, which needs
no domain verification.

**One important limit:** that default sender only delivers to **the email address
that owns the Resend account**. That's enough to recover *your* login. Before real
users can reset their passwords, verify a domain in Resend and set your own sender:

```bash
npx wrangler secret put RESET_EMAIL_FROM   # "AMV <noreply@yourdomain.com>"
npx wrangler deploy
```

If the domain isn't verified in Resend, the mail will bounce.

### How reset works

1. **Log in → Forgot password?**
2. Enter your email → a **6-digit code** is emailed (valid 15 minutes)
3. Enter the code → set a new password → you're signed straight in

Hardened: codes are crypto-random and single-use, 5 wrong guesses destroys the
code, 5 requests per email per hour (so nobody can bomb an inbox), and unknown
emails still show the code screen so the endpoint can't be used to discover which
addresses are registered.

### Before the Worker is deployed

With no Worker, accounts live **only in the browser** (localStorage). In that
state Forgot password lets you set a new password on that device, since there is
no server to email. **Once the Worker is connected this is refused** — the server
becomes the only source of truth. A test enforces that.

Local-only accounts are fragile: clearing browsing data deletes them for good.
Deploying the Worker is what makes accounts real, portable, and recoverable.

### If you're locked out and email isn't working

You hold `ADMIN_TOKEN`, so you can always set your own password directly:

```bash
curl -X POST https://<your-worker>/auth/admin-reset \
  -H 'Content-Type: application/json' \
  -d '{"token":"<YOUR_ADMIN_TOKEN>","email":"you@example.com","password":"your-new-password"}'
```

## Usage limits (the thing that protects your bill)

Limits are enforced **on the server**, not in the browser. The plan comes from the
entitlement store keyed to the signed JWT — sending `plan: "ultra"` in a request
body does nothing. Enforced per user: model access by tier, tokens per day and per
month, requests per minute, and a spend backstop. There is also a **global daily
spend ceiling** across all users (`GLOBAL_DAILY_USD_CAP`, default $500) so one bad
day can't become a huge bill.

### You MUST bind the Durable Object

```toml
[[durable_objects.bindings]]
name = "AMV_COUNTER"
class_name = "AMVCounter"

[[migrations]]
tag = "v1"
new_classes = ["AMVCounter"]
```

This is already in `wrangler.toml`. Without it the Worker silently falls back to a
KV counter that is **not atomic**, and your limits become suggestions: a burst of
parallel requests all read the same usage total, all pass the check, and all bill
you. Measured on the free plan before this was fixed — 8 concurrent requests burned
160,000 tokens against a 50,000/day cap.

Quotas now **reserve** an upper bound (prompt size + `max_tokens`) atomically before
the model runs, then reconcile against actual usage afterwards — refunding the
difference, and refunding in full if the call fails.

## Video

Video is a real generation job against a real provider. Set three secrets:

```bash
npx wrangler secret put VIDEO_API_URL    # e.g. https://api.replicate.com/v1/predictions
npx wrangler secret put VIDEO_API_KEY    # your provider key
npx wrangler secret put VIDEO_MODEL      # the model/version id at that provider
npx wrangler deploy
```

Any provider with a create-job / poll-status shape works (Replicate, Luma, fal,
Runway). AMV creates the job, polls until the provider says it's done, and plays
the file it returns.

**Without these, the Video tab says so plainly and generates nothing.** It does not
fake a render — which is exactly what it used to do (a `setInterval` that ticked a
fake progress bar through invented stages and produced no video at all).

Video is metered per plan (`videosMonth`): free gets none, pro 30, elite 200,
ultra 1000. The reservation is taken atomically before the provider is called, and
**refunded if the render fails** — a failed video never counts against your users'
plan. Chat can also generate video itself via the `generate_video` tool.

## Admin user directory (owner-only)

The admin Users tab lists EVERY account with full detail (/admin/users, owner-gated):
name, email, plan, payment source, monthly AI cost, wallet balance, marketplace
purchases, join date, and abuse flags (chargeback/refund). Searchable, with a summary
count of total/paying/flagged. Covered by tests/worker/admin-users.test.mjs.

## Financial statement (admin-only)

The admin dashboard has a Finance tab showing REAL transactions from ALL payment methods (Stripe cards, PayPal, and marketplace fees) — Stripe pulled live, PayPal & marketplace from a unified ledger (txn:log)
(/v1/admin/finance, admin-token gated): every charge across all customers with date,
email, amount, refund, status, card last-4, and receipt link, plus totals (gross received,
refunded, net kept). Honest empty state with configured:false until STRIPE_SECRET_KEY is
set. Covered by tests/worker/finance.test.mjs.

## Owner analytics dashboard

The Admin (Command Center) view shows the numbers that tell you if the business is
working, pulled live from /v1/admin/stats (admin-only): MRR/ARR, paying vs total
users, plan mix, AI cost & gross margin, top spenders, and — new — growth over time.
Signups are recorded per day (grow:signup:DATE), unique daily-active users are counted
once per day, and the dashboard renders signups today, signups this week, week-over-week
growth %, free→paid conversion %, active today, ARPU, and a 30-day signup sparkline.
All growth counters are best-effort and never block signup/login. Needs the backend
deployed + ADMIN_TOKEN; degrades to local metrics otherwise.

## Bot protection on sign-in / sign-up

Two layers stop bots from hammering auth:
- Honeypot: a hidden form field real users never see. Bots fill it → rejected. Works
  with ZERO config, active now.
- Cloudflare Turnstile (free CAPTCHA): set TURNSTILE_SECRET (Worker secret) and
  window.__AMV_TURNSTILE_SITE_KEY__ (client, injected at deploy). When set, signup and
  password login require a valid token; the widget renders automatically. Until set, the
  box stays hidden and auth relies on the honeypot + the existing brute-force throttle
  (8 failed attempts / 15 min per email+IP). Get keys at Cloudflare dashboard → Turnstile.
Covered by tests/worker/captcha.test.mjs.

## Auth & sessions (hardened + tested)

Tokens are HMAC-signed JWTs with an access/refresh split (1h access, 30d refresh).
The system is tested against real attacks (tests/worker/auth.test.mjs, 28 assertions):
alg:none is rejected, wrong-secret is rejected, payload tampering breaks the
signature, a refresh token can’t be used as an access token, expired tokens are
rejected, and “sign out everywhere” bumps a per-user epoch that instantly kills all
existing tokens. On the client (tests/e2e/auth-client.test.mjs), a 401 triggers a
single silent refresh + retry, concurrent 401s share ONE refresh (single-flight, no
storm), an expired token is refreshed proactively on boot, and a dead refresh yields
a clean “sign in again” rather than a broken state.

Note: until the Worker is deployed, accounts live only in the browser — the app warns
the user of this during reset setup. Deploying makes accounts server-backed and
email-recoverable.

## Account deletion & data export (right to erasure/access)

The privacy policy promises users can export and delete their data — both are real:
- Export: Settings → Privacy → Export data downloads everything (chats, memory, projects,
  skills, settings) as JSON.
- Delete: Settings → Privacy → Delete everything opens a typed-confirmation modal
  (must type DELETE). When connected, it POSTs /auth/delete which PURGES the user’s
  account, subscription, synced chats, automations, wallet, and all per-user KV keys,
  and revokes their tokens (existing sessions die). A user can only ever delete
  THEMSELVES. The token-revocation marker (tokepoch) is intentionally retained so any
  circulating tokens stay dead. Then local browser data is cleared. Covered by
  tests/worker/account-delete.test.mjs (11) + regression checks on the client gate.

## Backup & restore (data-safety insurance)

Customer accounts, subscriptions, synced chats/projects, automations, teams, sites,
wallets and abuse flags live in KV. Without a backup, a bad migration or an accidental
namespace delete wipes it with no recovery. So:

- Admin-only endpoints (ADMIN_TOKEN): POST /admin/backup/export returns a JSON snapshot
  of all DURABLE data (ephemeral counters/rate-limits/presence are deliberately skipped);
  POST /admin/backup/import restores it.
- Local CLI: `node backup.mjs export` saves ./backups/amv-backup-<date>.json;
  `node backup.mjs restore <file>` restores it. Set AMV_API_URL + AMV_ADMIN_TOKEN.
  Run export on a schedule (cron/Task Scheduler) and keep the files safe.
- Restores are ADDITIVE and never delete. `--missing` mode only writes keys that are
  gone, so it never clobbers newer live data (e.g. a user who upgraded since the backup).
- A tampered snapshot cannot inject control keys — imports are restricted to known
  backup prefixes, so e.g. GLOBAL_KILL can never be written via a restore.
- Tested end-to-end (tests/worker/backup.test.mjs, 25 assertions) including full
  recovery from a total wipe.

## Error alerting (know when prod breaks)

Set ALERT_WEBHOOK (a Slack/Discord incoming webhook) and AMV will page you the moment
something important breaks — before customers complain:
- Any unhandled server exception (first occurrence of each distinct error; recurring
  ones re-alert at 25x and 250x, throttled so you are never spammed).
- Model API rejecting your key (401/403) — loud, because AI is then down for everyone;
  check ANTHROPIC_API_KEY / billing. Model 5xx errors alert too.
- Stripe checkout failing — customers can’t subscribe = lost revenue.
- Global daily spend cap hit (and an 80%-of-cap early warning).
Alerts are throttled per problem (short window for money/security, longer for noise) and
are a safe no-op if ALERT_WEBHOOK is unset. Covered by tests/worker/alerting.test.mjs.

## Rate limits & spend protection

Every endpoint that spends money or writes data is bounded so no account can run up
your bill:

- Model calls (web chat): per-account RPM, day/month token quotas, and a COST BACKSTOP
  that hard-caps a user’s monthly spend at 45% of what they paid (>=55% margin even if
  they run 100% on the priciest model). Plus a global daily USD cap across all users.
- Automations / research watches: now metered against the SAME monthly cost cap. Free
  plans do not run paid automations; over-cap users are skipped; each run records its
  cost. (This closed a real leak — scheduled jobs previously spent uncapped.)
- SMS: per-number per-minute limit AND a daily cap (200/number) — SMS is real Twilio money.
- Image / video: per-day and per-month caps by plan.
- Write endpoints (handoff, marketplace publish/message, crew jobs, sync, widget): a
  reusable per-minute + per-day limiter (guardAction) returns 429 on floods.

Tuning: PLAN_LIMITS (tokens/rpm/images/videos per tier) and the backstop ratio live at the
top of amv-backend.js. GLOBAL_DAILY_USD_CAP is a secret (default $500). All limits are
enforced atomically via the AMVCounter Durable Object, so parallel requests can’t race
past them. Covered by tests/worker/ratelimit.test.mjs and the automation cost-cap tests.

## Anti-abuse / refund-fraud protection

AMV’s product is compute — model calls, video, deep research — which costs real
money the instant it’s delivered. So a chargeback or refund after heavy use is a
direct loss ("the DoorDash method"). Protections:

- Stripe **charge.dispute.created** (chargeback): access is revoked to free and the
  account is flagged immediately — a chargeback is treated as fraud.
- Stripe **charge.refunded**: the refunded entitlement is revoked. A single refund is
  fine (support does them); only a PATTERN (3+) flags the account.
- A **flagged account cannot start a new paid checkout** (403 account_flagged) — this
  closes the loop of “chargeback, then just subscribe again.” They keep a working free
  account.
- Usage refunds on failed video/model calls come from the PROVIDER’s real failure
  status, never a user claim, and terminal jobs are cached so a refund can’t be farmed
  by re-polling.
- Admin-only endpoints /admin/abuse/list and /admin/abuse/clear (ADMIN_TOKEN) let you
  review flags and clear a false positive. All abuse/chargeback/refund events are
  written to the audit log.

## Autonomous research watch

Users can set up a recurring, unattended research job from Tasks ("Set up a research
watch"): pick a subject, an interval (10 min / 30 min / hourly / daily / weekly), and
where findings go (in-app, or emailed each run). It runs on the existing Cloudflare
cron even when AMV is closed.

Research jobs get the web_search tool and a monitoring system prompt: they report what
is HAPPENING — facts, news, sentiment, price action — and are explicitly forbidden from
giving financial advice (no buy/sell/short/hold, no price predictions). This is enforced
in the prompt and asserted by tests. It never places trades; there is no brokerage
connection. Email delivery reuses the existing email system and only fires when
EMAIL_API_KEY is set. Interval has a floor (10 min) so nothing can run faster than the
cron. Without a deployed backend, the setup UI says to connect the engine — it does not
fake success.

## Research

The composer has a Research button with three depth tiers: Quick (~10-20 sources),
Deep (50+ sources), and Exhaustive (hundreds). It uses Anthropic's native
web_search tool, raising max_uses so the model genuinely searches many sources.
As it works, a live panel shows the REAL search count and the REAL sources found
(clickable chips), then freezes into a "Researched N sources across M searches"
summary with the answer.

max_uses is clamped server-side (ceiling 60) so a tampered client cannot request
thousands of searches to run up the bill. Research needs ANTHROPIC_API_KEY like
any other model call; with no key it degrades honestly.

## Mobile

The workbench tabs (Dev, Lab) stack their input and output panes on screens
≤760px and show one at a time via an Editor/Preview toggle — on a phone the
side-by-side split collapsed the code editor to ~29px tall. Tap targets are held
to a 40px minimum. Desktop is unchanged (a mobile.test.mjs run at 1280px enforces
that the split view still shows both panes and the toggle stays hidden).

## Seeing what breaks for your users

Errors are reported to the Worker and grouped by fingerprint. Open the app and
hit ⌘K → **Errors**, then paste your `ADMIN_TOKEN`. You will see each distinct
bug, how many times it fired, and how many users it hit.

Privacy: message contents, prompts and code are NEVER sent. Emails are hashed in
the browser before they leave it.

## Not implemented

- **Video generation.** There is no video engine. The Video tab says so plainly rather than faking it.
