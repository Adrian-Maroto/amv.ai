# AMV - Go Live Checklist

Everything in the app is already wired to run the moment it's connected to a
live backend. The AI key never touches the browser - it lives as a secret on
your Cloudflare Worker, so usage, billing, and limits can't be bypassed. This
is the exact, ordered list of what to set and where.

Run `node preflight.mjs` at any time - it checks all of this and tells you
precisely what's missing. Green = ready to deploy.

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
| `GLOBAL_DAILY_USD_CAP` | Your daily spend ceiling across all users (defaults to $500) - your runaway-bill protection |

### Turn on paid plans + marketplace purchases (money)
| Secret | Unlocks |
|---|---|
| `STRIPE_SECRET_KEY` | Real checkout for plans **and** marketplace paid items |
| `STRIPE_WEBHOOK_SECRET` | Confirms payments so upgrades/purchases actually apply |
| `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ELITE`, `STRIPE_PRICE_ULTRA` | The price IDs for each plan |

> Without Stripe configured, paid items are correctly **blocked** (no free
> purchases) - the app degrades honestly.

### Turn on integrations + more generation (optional, add anytime)
| Secret | Unlocks |
|---|---|
| `GOOGLE_CLIENT_ID` | Google sign-in **and** the agent's real Gmail / Calendar / Drive actions. Served to every visitor's browser automatically via `/v1/public-config` - you do not paste it anywhere in the app. |
| `VIDEO_API_URL`, `VIDEO_API_KEY`, `VIDEO_MODEL` | Real video generation |
| `IMAGE_API_URL`, `IMAGE_API_KEY`, `IMAGE_API_MODEL` | Higher-tier image generation |
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
