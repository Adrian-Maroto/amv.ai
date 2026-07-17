# AMV.AI — How to make EVERYTHING work (Go-Live guide)

The honest truth: **your app is built and the code works.** What turns each
feature from "not set up" to "live for users" is connecting an outside account.
No code can replace these — they're real services (a texting company, a payment
company, Google, etc.). Here's exactly what each one needs.

There's a live status board in the app: **Settings → Platform → Go-Live Status.**
It shows green when each piece is connected.

---

## 1. AI — makes 90% of the product work (chat, agents, Studio, Dev, documents)
**Needs:** an Anthropic API key (5 minutes).
1. Go to https://console.anthropic.com/settings/keys and create a key.
2. In AMV: Settings → AI Connection → paste it → "Test connection".
- For real users (so they don't use YOUR key directly), put the key in the
  **backend** instead (step 2 below). The backend keeps it secret.

## 2. Backend — multi-user, hides your key, enforces limits & profit caps
**Needs:** a free Cloudflare account (~20 minutes).
1. Install: `npm i -g wrangler`
2. `wrangler login`
3. Create a KV namespace, bind it as `AMV_KV` in wrangler.toml.
4. `wrangler secret put ANTHROPIC_API_KEY` (paste your key)
5. `wrangler secret put JWT_SECRET` (any long random string)
6. `wrangler deploy` (deploys amv-backend.js)
7. In AMV: Settings → Live / Backend → paste the worker URL.

## 3. Payments — collect real money
**Needs:** a free Stripe account (~15 minutes).
1. At https://stripe.com → Payments → Payment Links, create one link per plan.
2. Set each link's success URL to `yoursite.com/?paid=pro` (or `elite`).
3. In AMV: Settings → Platform → paste the links → Save.
- Apple Pay & Google Pay show up automatically inside Stripe checkout.
- Money goes straight to your Stripe balance.

## 4. Google sign-in + Gmail/Calendar autonomy
**Needs:** a Google OAuth Client ID (free, ~15 minutes) + HTTPS site.
1. https://console.cloud.google.com → APIs & Services → Credentials →
   Create OAuth Client ID (Web). Add your domain to authorized origins.
2. In AMV: Settings → Integrations → paste the Client ID.
- Until this is set, users sign up with email (works today). No fake prompts.

## 5. Text messages (run AMV from any phone) — the Poke-style feature
**Needs:** a Twilio account + phone number (~$1–15/mo, ~20 minutes).
1. https://twilio.com → buy a number with SMS.
2. Add 3 backend secrets:
   `wrangler secret put TWILIO_ACCOUNT_SID`
   `wrangler secret put TWILIO_AUTH_TOKEN`
   `wrangler secret put TWILIO_FROM_NUMBER`
3. In the Twilio number's settings, set "A message comes in" webhook to:
   `https://<your-worker>/sms/incoming`
4. Done. Users link their number in Settings → Integrations, AMV texts them a
   welcome message, and they can run agents by text.

## 6. Voice input
**Needs:** nothing but HTTPS. Deploy the site (step 7) and voice works —
browsers block the microphone on file:// but allow it on https://.

## 7. Deploy the website (so it's on the internet, on HTTPS)
**Needs:** a free Netlify or Vercel account (~10 minutes).
1. Drag `index.html` (or your `dist/` folder) onto https://app.netlify.com/drop
2. Add your custom domain in the site settings.
- This alone turns on voice and lets Google sign-in work.

---

## What genuinely CAN'T be "switched on" with code
- **Chrome extension, VS Code plugin, iOS app, Android app.** These are separate
  software products that must be built and approved by Apple / Google / Microsoft's
  stores. A website cannot become a phone app. That's why those show a real
  **"Notify me at launch"** waitlist (it collects emails to `/waitlist` so you have
  a launch list). When you eventually publish one, paste its store URL in settings
  and the button auto-switches to opening the store.

## Fastest path to paying users
1. Anthropic key in the backend (step 1+2) → the whole product works.
2. Deploy (step 7) → it's live on the internet, voice works.
3. Stripe links (step 3) → you can charge.
That's the minimum to have a real, working, money-making product. SMS, Google,
and the store apps can come after you have users.
