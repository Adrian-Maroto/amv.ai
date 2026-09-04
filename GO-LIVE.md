# AMV - Go Live Checklist

Everything in the app is already wired to run the moment it's connected to a
live backend. The AI key never touches the browser - it lives as a secret on
your Cloudflare Worker, so usage, billing, and limits can't be bypassed. This
is the exact, ordered list of what to set and where.

Run `node preflight.mjs` at any time - it checks all of this and tells you
precisely what's missing. Green = ready to deploy.

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
| `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_MODE`, `PAYPAL_PLAN_*`, `PAYPAL_WEBHOOK_ID` | PayPal as an alternative to Stripe |
| `APP_URL` | Your live domain - used for secure payment redirects |

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
