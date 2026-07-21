# AMV — Go Live Checklist

Everything in the app is already wired to run the moment it's connected to a
live backend. The AI key never touches the browser — it lives as a secret on
your Cloudflare Worker, so usage, billing, and limits can't be bypassed. This
is the exact, ordered list of what to set and where.

Run `node preflight.mjs` at any time — it checks all of this and tells you
precisely what's missing. Green = ready to deploy.

---

## 1. One-time: create your data store (the only hard blocker)

The Worker needs a KV namespace to persist accounts, jobs, and approvals.

```bash
npx wrangler kv namespace create AMV_KV
```

Copy the printed `id` into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

> This is the one item the preflight flags as an ERROR until it's done — because
> nothing can persist without it.

## 2. Set your secrets (this is "putting the APIs")

Set each with `npx wrangler secret put NAME` (it prompts for the value).

### Required — the app won't fully run without these
| Secret | Unlocks |
|---|---|
| `ANTHROPIC_API_KEY` | The AI itself — chat, agents, Crew, research, everything |
| `JWT_SECRET` | Sign-up / login (any long random string, 32+ chars). Auth fails closed without it. |

### Strongly recommended
| Secret | Unlocks |
|---|---|
| `ADMIN_TOKEN` | Founder Dashboard + admin tools (any long random string) |
| `EMAIL_API_KEY` | Password-reset emails **and** delivery of autonomous task results by email (Resend key) |
| `GLOBAL_DAILY_USD_CAP` | Your daily spend ceiling across all users (defaults to $500) — your runaway-bill protection |

### Turn on paid plans + marketplace purchases (money)
| Secret | Unlocks |
|---|---|
| `STRIPE_SECRET_KEY` | Real checkout for plans **and** marketplace paid items |
| `STRIPE_WEBHOOK_SECRET` | Confirms payments so upgrades/purchases actually apply |
| `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ELITE`, `STRIPE_PRICE_ULTRA` | The price IDs for each plan |

> Without Stripe configured, paid items are correctly **blocked** (no free
> purchases) — the app degrades honestly.

### Turn on integrations + more generation (optional, add anytime)
| Secret | Unlocks |
|---|---|
| `GOOGLE_CLIENT_ID` | Google sign-in **and** the agent's real Gmail / Calendar / Drive actions |
| `VIDEO_API_URL`, `VIDEO_API_KEY`, `VIDEO_MODEL` | Real video generation |
| `IMAGE_API_URL`, `IMAGE_API_KEY`, `IMAGE_API_MODEL` | Higher-tier image generation |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | SMS / phone verification |
| `TURNSTILE_SECRET` | Cloudflare Turnstile bot protection on sign-up |
| `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_MODE`, `PAYPAL_PLAN_*`, `PAYPAL_WEBHOOK_ID` | PayPal as an alternative to Stripe |
| `APP_URL` | Your live domain — used for secure payment redirects |

## 3. Deploy the Worker

```bash
node preflight.mjs   # should now say "Ready to deploy"
npm run deploy       # wrangler deploy
```

Copy the deployed URL (e.g. `https://amv-backend.yourname.workers.dev`).

## 4. Point the app at your backend

In the app: **Settings → AI Connection** → paste your Worker URL → **Save &
connect** → **Test connection**. Then sign in with your account.

That single URL flips the whole app from local demo to live: chat, agents,
approvals, autonomous scheduling, marketplace, and payments all start using the
real backend. (Saved as `amv_api_base`; the app checks `AMV_API.live` everywhere.)

## 5. Verify

```bash
npm run check        # full health gate — should say SHIPPABLE
```

- Sign up a test account → confirm it persists across a refresh (real backend).
- Send a chat → confirm a real AI reply.
- Connect Google in Settings → Connectors, then type a task in Mission Control's
  command bar (e.g. "email me a summary of my unread emails") → it recognizes
  the intent and, once approved, performs the real action.

---

**What's already done for you:** every feature checks `AMV_API.live` and uses
the real endpoints when connected, falling back to honest local/demo behavior
when not. There is no code change needed to go live — only the config above.
