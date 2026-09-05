# AMV - Go Live Checklist

Everything in the app is already wired to run the moment it's connected to a
live backend. The AI key never touches the browser - it lives as a secret on
your Cloudflare Worker, so usage, billing, and limits can't be bypassed. This
is the exact, ordered list of what to set and where.

Run `node preflight.mjs` at any time - it checks all of this and tells you
precisely what's missing. Green = ready to deploy.

---

## YOUR LIST - the commands that stand between AMV and taking money

Everything below in this file explains WHY. This is the WHAT, in order, and it
is short. Run each from this folder.

**Before anybody can pay you** - four commands. Payments already show as "on"
with just `STRIPE_SECRET_KEY` set, and every plan still refuses at checkout
without these, because a price object is what Stripe actually charges against.
Create one recurring price per plan in the Stripe dashboard, then:

```bash
npx wrangler secret put STRIPE_PRICE_PRO      # the Pro monthly price id (price_...)
npx wrangler secret put STRIPE_PRICE_ELITE    # the Elite monthly price id
npx wrangler secret put STRIPE_PRICE_ULTRA    # the Ultra monthly price id
npx wrangler secret put STRIPE_WEBHOOK_SECRET # from Stripe -> Developers -> Webhooks
```

The webhook secret is the one that is BLOCKING once payments are on: nothing
else grants a plan when somebody pays, and nothing else revokes one when they
cancel, are refunded, or charge back.

**Before PayPal takes real money** - it defaults to SANDBOX, which means
checkouts complete against PayPal's test servers and no money arrives. Only do
this once `PAYPAL_WEBHOOK_ID` is set, or a subscription can start that nothing
can ever cancel:

```bash
npx wrangler secret put PAYPAL_MODE           # value: live
```

**Before you launch at all** - your API currently accepts browser calls from
any site on the internet, which is the right default for a deployment with no
front end and the wrong one for a launched product:

```bash
npx wrangler secret put ALLOWED_ORIGIN        # value: https://amv.homes
```

**Then redeploy so the new secrets are in effect:**

```bash
npx wrangler deploy
```

**How to check you got it right:** open AMV, go to **Settings -> Money ->
Plan & usage**, then **Settings -> Platform** and paste your `ADMIN_TOKEN`. The
readiness screen reads your live Worker and reports every one of these. It says
REQUIRED NOW next to anything that is half-configured in a way that can take a
customer's money and give them nothing.

---

## READ THIS BEFORE YOU LAUNCH

**Everything AMV can do is already built and wired.** Nothing below is a stub,
a mock or a screen with no code behind it. Each line is a capability that runs
the moment its key exists, and refuses honestly - by name, saying what is
missing - until then.

So the launch decision is not "what still needs building". It is **which of
these you want switched on, and what each one costs you**. Section 2.0 is that
list. Read it once, decide, and set only what you want.

Three of them can take money from a customer and give them nothing back if
they are only half configured. They are called out in their own tables and
each is marked **REQUIRED NOW** on the readiness screen the moment its other
half is set:

1. **Stripe with no price ids.** Payments reads as on and every plan refuses at
   checkout, because the price was never created.
2. **Stripe with no webhook secret.** Money arrives and no plan is granted;
   cancellations, refunds and chargebacks never revoke one.
3. **PayPal with no webhook id.** The same, on the PayPal side - and a
   subscription that can start and can never be cancelled.

**And two things that are correct defaults right up until you launch:**

- `PAYPAL_MODE` defaults to **sandbox**. PayPal checkouts complete against test
  servers and no real money arrives. Set it to `live` when you are ready.
- `ALLOWED_ORIGIN` defaults to `*`. Any site on the internet can call your API
  from a browser. Pin it to your own domain.

The go-live readiness screen (**Settings -> Platform**, needs your
`ADMIN_TOKEN`) reads all of this from the running Worker and reports every one
of these states. It is the same list as section 2.0, answered live for the
deployment you actually have rather than the one this file describes. A gate
stage fails if a secret the Worker reads is missing from that screen, so it
cannot fall behind the code.

---

## 2.0 What each capability costs, and what it unlocks

Ordered by whether AMV works without it. Nothing here needs to be set on day
one except the two in the first table.

### Cannot run without these

| Capability | Set | Costs |
|---|---|---|
| The AI itself | `AMV_MODEL_KEY` | Per token. This is the main running cost and the one the daily ceiling below protects. |
| Sign-in and sync | `JWT_SECRET` | Nothing. Any long random string you generate yourself. |
| Storage | Bind `AMV_KV` | Free tier: 100k reads and 1k writes a day. |

### Costs nothing but a few minutes

| Capability | Set | Costs |
|---|---|---|
| Operator dashboard, kill switch, digest | `ADMIN_TOKEN` | Nothing - a random string. |
| Owner notices and the weekly digest | `OWNER_EMAIL` | Nothing. |
| Correct links in every email and invite | `APP_URL` | Nothing. |
| Encrypted connected-account tokens | `CONNECT_KEY` | Nothing - a random 32+ char value. Without it AMV refuses to connect an account at all. |
| Encrypted mailbox / school / bot credentials | `MAIL_CRED_KEY` | Nothing - the same. Those three connectors refuse without it. |
| Race-free spend and usage limits | Bind `AMV_COUNTER` | A paid Workers plan (Durable Objects). Free until you take payments; **required** once you do. |
| Guaranteed sync writes | Bind `DB` (D1) | Free tier available. |
| API pinned to your own site | `ALLOWED_ORIGIN` | Nothing. Do this before launch. |

### Costs money to a third party

| Capability | Set | Costs |
|---|---|---|
| Email that reaches anyone | `EMAIL_API_KEY` **and** `RESET_EMAIL_FROM` | Resend has a free tier. **Both halves**: with only the key, the default sender delivers to the Resend account owner and NOBODY ELSE, so every other person's password reset goes nowhere. |
| Card payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the three `STRIPE_PRICE_*` | Stripe's per-transaction fee. No monthly fee. All five, or see the three traps above. |
| Team seats | `STRIPE_PRICE_TEAM_SEAT` | Same. Without it Teams still works on Elite and Ultra. |
| PayPal | `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_WEBHOOK_ID`, the three `PAYPAL_PLAN_*`, `PAYPAL_MODE=live` | PayPal's per-transaction fee. |
| Text messages | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Twilio: a number, monthly, plus per message. All three or nothing sends. |
| Bot protection on sign-up | `TURNSTILE_SITE_KEY` **and** `TURNSTILE_SECRET` | Free (Cloudflare). Both halves or neither. |
| Google sign-in and Gmail / Calendar / Drive | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Free to register. Google review is required before you can ask the public for sensitive scopes. |
| Microsoft: Outlook mail and calendar | `MS_CLIENT_ID` + `MS_CLIENT_SECRET` | Free to register. |
| GitHub: real repositories in a build | `GH_CLIENT_ID` + `GH_CLIENT_SECRET` | Free to register. |
| Bank balances and transactions | `FINANCE_CLIENT_ID` + `FINANCE_SECRET` | **Paid and application-reviewed.** A bank-data provider (Plaid or similar) is not a key you can self-serve in an afternoon. Leave it off until you want this. |
| Server-side PDFs and screenshots | Bind `BROWSER` | Cloudflare Browser Rendering, paid plan. Those two surfaces refuse honestly without it. |
| Being paged when something breaks | `ALERT_WEBHOOK` | Free - a Slack or Discord incoming webhook. **Set this one even if you set nothing else here.** |
| Errors reaching you with a stack | `SENTRY_DSN` | Sentry has a free tier. |
| Which features are actually used | `POSTHOG_KEY` | PostHog has a free tier. Nothing is collected until you set it. |
| An off-site copy of the audit trail | `AUDIT_WEBHOOK` | Depends where you point it. |
| A human to escalate to | `SUPPORT_EMAIL` | Nothing. |

### Knobs with working defaults - change only if you mean to

| Knob | Default | What it changes |
|---|---|---|
| `GLOBAL_DAILY_USD_CAP` | `500` | The most AMV spends on model calls in a day, across every account, before it refuses. Your runaway-bill protection. |
| `NONESSENTIAL_WRITE_CAP` | `150` | The daily write budget telemetry and the waitlist share, so they cannot starve sign-ups. |
| `MODEL_API_URL` | built-in | Point at a proxy or a specific region. |
| `MODEL_API_FALLBACK_URL` | none | A second endpoint tried when the primary cannot answer. |
| `APP_ORIGIN` | none | Read only when `APP_URL` is unset. Set `APP_URL` and ignore this. |
| `POSTHOG_HOST` | US host | For the EU host or a self-hosted instance. |
| `FINANCE_API_URL` | production | Point at the provider's sandbox while testing. |
| `CONNECT_KEY_PREV` | none | Set to the old key during a rotation only; remove it when everyone has reconnected. |

---

## 0. One-time: a Cloudflare account, and a terminal that is logged into it

Everything below runs against your own Cloudflare account. This step was missing
from this list, which made step 1 fail for the only person it was written for -
somebody who has not done this before.

1. **Make the account.** Go to <https://dash.cloudflare.com/sign-up>, enter an
   email and a password, and confirm the email it sends. It is free, and none of
   what AMV needs costs anything to start: the Workers free plan covers 100,000
   requests a day, and KV covers 100,000 reads and 1,000 writes a day.
2. **You do not need to move your domain.** Cloudflare will offer to take over
   DNS for a site. Skip it. AMV's backend lives at a `workers.dev` address, and
   the front end stays where it is. Moving the domain is a separate decision and
   not one to make while getting the backend up.
3. **Check node is there.** In a terminal, in this folder:
   ```bash
   node --version
   ```
   If that errors, install Node 20 or newer from <https://nodejs.org> first.
   Everything here uses `npx`, which comes with it - there is nothing to
   install globally.
4. **Log the terminal in.**
   ```bash
   npx wrangler login
   ```
   A browser tab opens asking you to authorize Wrangler against the account you
   just made. Say yes. The terminal prints `Successfully logged in.`
5. **Confirm it took.**
   ```bash
   npx wrangler whoami
   ```
   It prints the email on the account and the account id. If it says you are not
   authenticated, run `npx wrangler login` again - the browser tab has to be the
   same browser you are signed into Cloudflare in.

> On a machine with no browser (a server over SSH), use
> `npx wrangler login --browser=false` and open the printed URL yourself.

Now step 1 will work.

---

## 1. One-time: create your data store (the only hard blocker)

The Worker needs a KV namespace to persist accounts, jobs, and approvals.

```bash
npx wrangler kv namespace create AMV_KV
```

Copy the printed `id` into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

> This is the one item the preflight flags as an ERROR until it's done - because
> nothing can persist without it.

## 2. Set your secrets (this is "putting the APIs")

Set each with `npx wrangler secret put NAME` (it prompts for the value).

### Required - the app won't fully run without these
| Secret | Unlocks |
|---|---|
| `AMV_MODEL_KEY` | The AI itself - chat, agents, Crew, research, everything |
| `JWT_SECRET` | Sign-up / login (any long random string, 32+ chars). Auth fails closed without it. |

### Strongly recommended
| Secret | Unlocks |
|---|---|
| `ADMIN_TOKEN` | Founder Dashboard + admin tools (any long random string) |
| `EMAIL_API_KEY` | Password-reset emails **and** delivery of autonomous task results by email (Resend key) |
| `MAIL_CRED_KEY` | Encrypts every credential AMV holds for somebody: a mailbox password, a Telegram bot token, a school access token. Without it those three connectors **refuse to store anything** rather than store it in the clear - honest, and the first person to find out is a customer. Any long random value, 24+ characters of real randomness (not a phrase). Changing it later makes every stored credential unreadable and everyone has to reconnect. |
| `GLOBAL_DAILY_USD_CAP` | Your daily spend ceiling across all users (defaults to $500) - your runaway-bill protection |

### Make the alarms audible - the one people skip

| Secret | Unlocks |
|---|---|
| `ALERT_WEBHOOK` | **Where AMV shouts.** A Slack/Discord incoming-webhook URL. Without it `notify()` returns immediately and every alarm in the product is silent: the daily spend ceiling being hit, the spend counter going unreachable (which means the ceiling is not being enforced at all), a payout that needs your review, a reported listing, a bounded scan that stopped short, a failed session revocation after a password change. All of that logic exists and runs; with no webhook, none of it reaches you. |
| `OWNER_EMAIL` | Who the founder digest and owner-only notices go to |
| `SUPPORT_EMAIL` | The address shown to users, and where in-app support messages land |

> If you set nothing else in this table, set `ALERT_WEBHOOK`. Everything AMV
> knows about its own trouble goes through it, and the failure is silent by
> design - a missing webhook is not an error, it is just quiet.

### Tune the money limits (all optional, all have defaults)

| Secret | Default | What it changes |
|---|---|---|
| `GLOBAL_DAILY_USD_CAP` | `500` | The hard ceiling on model spend across all users, per day |
| `NONESSENTIAL_WRITE_CAP` | `150` | How many storage writes a day error telemetry and the waitlist may share. Free-tier KV allows 1000 a day for the whole account, so this keeps the least important writes from starving sign-ups and saves. Raise it on a paid plan. |

> Payout decisioning (the $100 auto-clear limit, the $600 identity threshold,
> the 10% / 120-day reserve) is set in `amv-backend.js` next to `_payoutRisk`,
> not by environment - they are policy, and policy belongs where the reasoning
> that justifies it is written down.

### Turn on paid plans + marketplace purchases (money)
| Secret | Unlocks |
|---|---|
| `STRIPE_SECRET_KEY` | Real checkout for plans **and** marketplace paid items |
| `STRIPE_WEBHOOK_SECRET` | Confirms payments so upgrades/purchases actually apply |
| `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ELITE`, `STRIPE_PRICE_ULTRA` | The price IDs for each plan |

> Without Stripe configured, paid items are correctly **blocked** (no free
> purchases) - the app degrades honestly.

#### And the webhook itself, which the secrets above do not create

A secret is not an endpoint. In **Stripe → Developers → Webhooks**, add:

```
https://<your-worker>.workers.dev/v1/stripe/webhook
```

Subscribe it to **all ten** of these. AMV handles every one, and each is money
moving in a direction somebody has to know about:

| Event | What AMV does with it |
|---|---|
| `checkout.session.completed` | A card paid - grant the plan |
| `checkout.session.async_payment_succeeded` | **A voucher or direct debit finally cleared.** Miss this one and a customer who paid by OXXO or SEPA pays you and is never granted anything |
| `checkout.session.async_payment_failed` | It did not clear - close it out, grant nothing |
| `customer.subscription.updated` | Seats, plan or state changed |
| `customer.subscription.deleted` | It ended |
| `invoice.paid` | A renewal went through |
| `invoice.payment_failed` | A renewal was declined - the account goes past due |
| `charge.refunded` | Money went back |
| `refund.created` | The same, newer event shape |
| `charge.dispute.created` | A chargeback was opened |

> **Why the delayed ones matter.** Checkout offers the methods available in the
> buyer's country, which is what lets somebody in Warsaw or Mexico City actually
> pay you. Two of them - OXXO (a voucher paid in cash at a shop counter, up to
> three days) and SEPA Direct Debit (up to fourteen) - complete the checkout
> BEFORE the money moves. AMV grants nothing until it has actually arrived, and
> the event that tells it so is `async_payment_succeeded`. If a payment never
> clears, nothing was granted and there is nothing to claw back.

> If the webhook is missing or misconfigured entirely, the cron reconciliation
> sweep asks Stripe directly and grants what was really paid, then alerts you
> that your webhooks are not arriving. That is a safety net, not a substitute -
> it runs every five minutes, not instantly.

### Turn on integrations (optional, add anytime)
| Secret | Unlocks |
|---|---|
| `GOOGLE_CLIENT_ID` | Google sign-in **and** the agent's real Gmail / Calendar / Drive actions. Served to every visitor's browser automatically via `/v1/public-config` - you do not paste it anywhere in the app. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | SMS / phone verification |
| `TURNSTILE_SITE_KEY` **and** `TURNSTILE_SECRET` | Cloudflare Turnstile bot protection on sign-up and sign-in. Set **both** or neither. The site key renders the widget (served to browsers via `/v1/public-config`); the secret checks its answer. With only the secret set, no browser can produce a token, so AMV skips the captcha rather than refusing every sign-up, and readiness reports it as **HALF SET UP**. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_MODE`, `PAYPAL_WEBHOOK_ID` | PayPal as an alternative to Stripe |
| `PAYPAL_PLAN_PRO`, `PAYPAL_PLAN_ELITE`, `PAYPAL_PLAN_ULTRA` | The PayPal plan id for each tier. Spelled out because this table used to say `PAYPAL_PLAN_*`, and a wildcard is not something you can type into `wrangler secret put`. Without them a PayPal subscriber's tier cannot be resolved. |
| `APP_URL` | Your live domain - used for secure payment redirects |

### Connected accounts - the secrets nothing else will tell you about

Connecting somebody's Google, Microsoft or GitHub account needs two things: a
key to seal what comes back, and an OAuth app per provider.

| Secret | Unlocks |
|---|---|
| `CONNECT_KEY` | **Connected accounts at all.** Every credential AMV stores for somebody is sealed with AES-GCM under this key. Without it, connecting is refused outright with a message naming the missing secret - it does not store a token in the clear and call that degraded. Any long random value, 32+ characters. |
| `CONNECT_KEY_PREV` | One retired key, kept readable so a rotation drains itself. Set it to the old `CONNECT_KEY` when you rotate; drop it once everyone has reconnected. |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Gmail, Calendar, Drive and read-only school work. Both halves, or the token exchange fails at the last step with everything up to the redirect working - the hardest misconfiguration to diagnose. |
| `MS_CLIENT_ID` + `MS_CLIENT_SECRET` | Microsoft: Outlook mail and calendar, OneDrive |
| `GH_CLIENT_ID` + `GH_CLIENT_SECRET` | GitHub |

> **These four Microsoft and GitHub names appeared in no document until now,**
> and `node preflight.mjs` could not warn about them either: it scanned the
> Worker for `env.NAME` and these are read off a provider table as
> `env[p.secretEnv]`, so they were invisible to the one tool whose job is to
> catch exactly this. Both integrations were built, tested and shipped, and
> could not be switched on by anybody following the instructions. Preflight
> reads indirect lookups now, and a suite fails if a secret the Worker reads is
> missing from this file.

### Advanced - you will usually not need these
| Secret | What it changes |
|---|---|
| `MODEL_API_URL` | Point AMV at a different model endpoint. Defaults to the built-in one. |
| `MODEL_API_FALLBACK_URL` | Tried when the primary cannot answer. Unset means no fallback, which is a fine choice - it just means one endpoint. |
| `ALLOWED_ORIGIN` | Lock the browser API to your own domain instead of `*`. Set this once your domain is final. |
| `APP_ORIGIN` | Fallback for `APP_URL` when building links. Set `APP_URL` and you can ignore this. |
| `AUDIT_WEBHOOK` | A second sink for the audit stream, for anomaly detection. Separate from `ALERT_WEBHOOK`, which is where alarms go. |
| `STRIPE_PRICE_TEAM_SEAT` | The Stripe price id for a team seat. Without it, team seat billing has no price to charge. |

## 3. Deploy the Worker

```bash
node preflight.mjs   # should now say "Ready to deploy"
npm run deploy       # wrangler deploy
```

Copy the deployed URL (e.g. `https://amv-backend.yourname.workers.dev`).

## 4. Bake that URL into the app - THE STEP THAT LETS STRANGERS PAY YOU

```bash
AMV_API_BASE=https://amv-backend.yourname.workers.dev node build.mjs
git commit -am "point the build at the live backend" && git push
```

This writes the address into `index.html`, so every visitor's browser knows
where the backend is the moment the page loads.

> **Do not skip this.** Typing the URL into Settings configures ONLY the browser
> you typed it in. Your own machine will look perfectly live while every other
> visitor gets the local demo - no engine, no real account, and no way to pay.
> `node preflight.mjs` warns when the built artifact has no address in it.

You can still override it per device in **Settings → AI Connection** (useful for
pointing one browser at a staging Worker); clearing that field falls back to
whatever the build shipped with.

That address flips the whole app from local demo to live: chat, agents,
approvals, autonomous scheduling, marketplace, and payments all start using the
real backend. (Read from the `amv-api-base` meta tag, overridable via
`amv_api_base`; the app checks `AMV_API.live` everywhere.)

## 5. Verify

```bash
npm run check        # full health gate - should say SHIPPABLE
```

Nine stages, forty to fifty minutes. One of them, **"The Worker runs in workerd,
not just in a mock"**, boots the real Cloudflare runtime with a real KV and a
real Durable Object and drives twenty-seven checks against it - concurrency
ceilings, the signup race, token forgery, the operator boundary. If it prints
`SKIPPED` beside its tick, wrangler could not start on that machine and the real
runtime was **not** exercised; the verdict says so rather than claiming
otherwise.

You can run just that one at any time:

```bash
node smoke-real.mjs
```

### The five minutes after you first deploy

In order, because each one catches a different way the day goes wrong:

1. **Hit any auth route before setting secrets, on purpose.** It should answer
   `503 not_configured` and name the missing secret. If it answers `500`, you
   are running an old build - stop and redeploy, because that version created
   accounts nobody could ever sign into.
2. **Open the live site in a PRIVATE WINDOW.** This is the one place the "works
   on my machine" version fails: typing the backend URL into Settings configures
   only the browser you typed it in. Sign up, send a chat, open the upgrade
   sheet. Anything that degrades to demo behaviour means step 4 was missed.
3. **Open the browser console on the landing page.** AMV's script policy names
   the scripts it ships by hash and refuses everything else. If a third party
   (Stripe, Turnstile, sign-in with Google) is being blocked you will see
   `Refused to execute` or `Refused to load` there - and AMV reports it to your
   error dashboard too, so it cannot fail silently. A clean console means the
   payment and sign-in scripts really loaded.
4. **Put a card through in Stripe test mode**, then check the plan applied. Then
   check the **Webhooks** page in Stripe shows a `200` for the delivery. A `4xx`
   there means the signing secret does not match.
5. **Check your alarm channel got something.** Set `ALERT_WEBHOOK` first - a
   deployment with no alarm channel is one where the first person to notice a
   problem is a customer.

- Open the live site in a PRIVATE WINDOW - the one place the "works on my
  machine" version of this fails. Sign up, send a chat, and open the upgrade
  sheet. If any of those degrade to demo behaviour, step 4 was missed.
- Sign up a test account → confirm it persists across a refresh (real backend).
- Send a chat → confirm a real AI reply.
- Connect Google in Settings → Connectors, then type a task in Mission Control's
  command bar (e.g. "email me a summary of my unread emails") → it recognizes
  the intent and, once approved, performs the real action.

---

**What's already done for you:** every feature checks `AMV_API.live` and uses
the real endpoints when connected, falling back to honest local/demo behavior
when not. There is no code change needed to go live - only the config above.
