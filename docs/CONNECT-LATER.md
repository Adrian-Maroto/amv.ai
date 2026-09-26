# Connecting the "Notify me" apps

The Integrations page lists the apps people use most (`src/app/13c-app-catalog.js`).
A row gets **Connect** only when a flow exists that ends in a working connection.
Every other row gets **Notify me**, which records one waitlist entry per person
per app (`waitlist:app-<slug>:<email>`). The owner dashboard shows the
most-requested apps under "Apps people asked for". That list sets the build
order. It is the promise the page makes, so this file is how it gets kept.

## Connects today

- **Google, through Connected accounts:** Gmail, Calendar, Drive, Docs,
  Sheets, Slides, Classroom.
- **Microsoft:** Outlook mail and calendar.
- **GitHub.**
- **About 60 mailboxes over IMAP:** Yahoo, iCloud, AOL, Zoho, Fastmail, GMX,
  Yandex, Naver, QQ and others.
- **Calendar links, read-only:** iCloud, Fastmail, Proton, Zoho, Nextcloud
  and others.
- **AMV's own flows:** Telegram, SMS, Canvas, bank link, Kalshi and
  Polymarket, job boards.

The OAuth rows stay dark until their client id and secret are set as Worker
secrets. On a deployment without them, the page says so.

## The three routes for everything else

### 1. A remote connector with its own sign-in (the biggest lever) - BUILT

Built with the owner's approval. `REMOTE_APPS` in `amv-backend.js` lists
eighteen apps:

- Notion, Linear, Canva, Jira and Confluence
- Sentry, Stripe, PayPal
- Webflow, Wix, Monday.com, Figma, Zapier
- Vercel, Airtable, GitLab, Supabase, Postman, Close

Each was read from the official MCP registry under the app's own verified
namespace (`com.notion`, `app.linear`...). Look-alike proxies run by third
parties are excluded.

**Storage:** sign-ins are sealed per person under `rmcp:`.
**Setup:** it needs only `CONNECT_KEY` and `APP_URL` - no per-app key.
**Use:** tools are offered in chat, and each call is asked for with its
arguments shown.
**Tests:** `tests/worker/an-app-you-sign-in-to-is-an-app-amv-can-use` and
`tests/e2e/an-app-connects-by-signing-in`.

**To add an app:** confirm its entry is published under its own domain in the
registry, add a row to `REMOTE_APPS`, and change its row in
`13c-app-catalog.js` from Notify me to `r:<slug>`.

**Added after a sweep of all 473 Notify me apps:** Todoist, Miro, Craft,
Zomato, Typeform, Jotform, Make, IFTTT, Amplitude, Cloudflare, Grafana,
UptimeRobot, VirusTotal, PandaDoc, Cypress Cloud, LambdaTest and New Relic.
That brings the total to 35 official connectors.

### 2. A provider row in `CONN_PROVIDERS` - BUILT

These twelve publish no official connector:

- Slack, Discord, Spotify, Dropbox
- HubSpot, Asana, Zoom, Box
- Strava, Reddit, Pinterest, Calendly

Each now connects through its own standard sign-in, and chat uses its API
through `/v1/connect/api`, one call at a time with the method, path and body
shown for consent.

OneDrive, YouTube and Google Tasks join through the Microsoft and Google
rows.

**What each needs:** an app registered with that provider (free) and its two
secrets. `GO-LIVE.md` lists them, and the readiness screen shows which are
set.

**Until then:** the row says it is not set up rather than opening a flow that
fails.

**Tests:** `tests/worker/an-app-with-a-public-api-connects-and-stays-in-its-lane`.

### 3. Still Notify me, and why

About 400 apps remain Notify me. They have no public API that can do what
somebody would connect them for:

- CapCut, Netflix, TikTok, Snapchat, iMessage, Apple Notes
- most games, shopping and delivery apps
- banks, which go through the bank link instead

A Connect button for any of these would be a lie. The waitlist counts on the
owner dashboard show which ones people want most. When one publishes an API or
an official connector, it moves to route 1 or 2.

The original plan follows.


Many large apps now publish an official remote MCP server. It uses OAuth with
dynamic client registration. The person signs in at the app, the app issues
the grant, and AMV needs no client secret registered per app. This is what
"connect to everything" means in practice, and it scales without a key per
provider.

**Likely first candidates:** Canva, Notion, Linear, Jira and Confluence,
Asana, Monday.com, HubSpot, Stripe, PayPal, Square, Intercom, Sentry,
Cloudflare, Vercel, Netlify, Zapier, Box, Webflow, Wix.

Confirm each endpoint and its terms before building. These change, and a
wrong one is a Connect button that fails.

**What building it needs:**
- a Worker-side MCP client over streamable HTTP;
- a sealed token per person per server;
- the existing per-call consent in chat.

Every connector tool already needs that consent, because AMV cannot classify
a third-party tool's risk.

### 2. A provider row in `CONN_PROVIDERS` (classic OAuth)

This route suits apps with a public OAuth API but no remote server:
- Spotify, Dropbox, OneDrive (a `Files.Read` scope on the Microsoft row),
  Slack, Discord, Zoom;
- Todoist, Trello, Strava, Fitbit, Garmin, YouTube, Pinterest, Reddit;
- QuickBooks, Xero, Mailchimp.

Adding one is a row of data, not new code. Each needs an app registered with
the provider, whose client id and secret become Worker secrets.

### 3. Through the person's own computer

Some apps have no public API that can do what people want: CapCut, Netflix,
iMessage, Apple Notes, most games and most shopping sites. For those, the
honest path is the bridge. That means a connector from the open registry, or
AMV working in the app's own files or pages on the person's machine, fenced
and with per-call consent. Where neither exists, the row stays Notify me and
says nothing more.

## What only the owner can decide

- **Storage.** Route 1 needs a new stored record: a sealed remote-connector
  token per person per server. That is a storage schema change, which waits
  for the owner's approval.
- **Accounts with each provider.** Route 2 means registering AMV with each
  provider, accepting their terms, and holding the secrets.
- **Order.** Which apps come first is set by the waitlist counts on the
  dashboard, not by guesswork.

## Left out on purpose

- **Password managers.** An agent that can read the vault can read every
  account in it.
- **Other AI products.**
- **Anything whose only use would be generating images or video.**
