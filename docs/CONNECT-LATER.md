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

### 1. A remote connector with its own sign-in (the biggest lever)

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
