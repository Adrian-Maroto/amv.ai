# Global Mail and Crew Access Requests

Date: 2026-08-15
Status: approved, building in gated increments

## The problem

Every integration AMV ships is US or Western: Google, Microsoft 365, Slack,
Discord, GitHub, VS Code, Linear, Notion, Canvas, SMS. A person in China,
Korea, Poland or Brazil opens the integrations page and finds nothing they use.
That is not a marketing gap, it is the product being unusable for most of the
world.

The second problem is smaller and sharper. Scheduled work discovers what it
needs only while it runs, and today it cannot ask. A Canvas job set up on
Monday may need Google Drive on Tuesday because Tuesday's assignment is an
essay rather than a quiz. When that happens the run has no way to say so, so it
half-finishes and the person finds out by looking.

## What is real, and what is not

The owner's standing rule is that an action must be legal, safe, technically
possible, and must not violate platform restrictions. That rule decides the
scope, so it is written down here rather than discovered later.

| Service | Reality |
| --- | --- |
| QQ Mail, NetEase 163/126, Naver, Daum, Yandex, Mail.ru, GMX, Web.de, Orange, Libero, Seznam, WP.pl, Onet, Rediffmail, Zoho, UOL, Sapo, Mynet, Telenet, KPN, Bluewin, UKR.net, Walla and others | Real. All expose IMAP and SMTP with an app or authorisation code. Fully automatable |
| WeChat, personal accounts | No API. Automating one gets it banned. WeCom and Official Accounts do have APIs and are a separate, later piece of work |
| Wallapop | No public API. Only scraping, which breaks their terms |
| LinkedIn auto-apply | Forbidden by their terms |

So this spec delivers mail, which is genuinely automatable everywhere, and does
not pretend to deliver the rest. Where a platform forbids automation the
product will say so in its own words rather than shipping something that looks
like it works.

## Feature 1: Global Mail

One connector, many providers. A person picks their provider, pastes the app
password their provider gives them, and AMV can read, summarise, draft and send
for them, including on the cron while they sleep, exactly as the Google path
does today.

### The provider registry

A table of providers, each carrying the IMAP host and port, the SMTP host and
port, the country, and the exact steps to obtain an app password. That last
field matters more than it looks: every provider words it differently and it is
the single largest source of "it does not work" for this kind of feature. QQ
Mail calls it an authorisation code and hides it behind an SMS verification;
163 calls it a client authorisation password; Naver requires IMAP to be
switched on first.

Coverage target is at least twenty countries. A `custom` entry accepts any
host, so a provider nobody listed still works, which is the honest answer to
"does it support my email".

### Transport

Cloudflare Workers reach TCP through `connect()` from `cloudflare:sockets`.
IMAP runs on 993 with implicit TLS, SMTP on 465 with implicit TLS. Both clients
are written against a small transport interface rather than against `connect()`
directly, so tests drive them with a scripted fake socket and the suite never
touches the network.

Scope of the IMAP client is deliberately small: log in, select INBOX, fetch the
headers of the most recent N messages, fetch one message body, log out. That is
everything "summarise my inbox and draft replies" needs. It handles tagged
responses and literal blocks (`{n}` followed by exactly n bytes), because
literals are where naive line-based parsers break.

The SMTP client covers EHLO, AUTH LOGIN, MAIL FROM, RCPT TO, DATA and QUIT.

### Credentials

An IMAP password is a credential to somebody's whole mailbox, so:

- encrypted at rest with AES-GCM under a key derived from `MAIL_CRED_KEY`
- never returned to the browser, in any response, ever
- never written to a log or an audit line
- with no `MAIL_CRED_KEY` configured, storing one is refused with an honest
  message rather than stored in the clear
- excluded from backups, like the other credential kinds
- included in erasure, unlike them

The host is checked against the same private-address guard the web agent uses,
so a custom provider cannot be pointed at an internal service.

### Failure

Wrong password, IMAP switched off at the provider, host unreachable and TLS
refused are four different problems with four different fixes, and the person
is told which one happened. A provider that is simply down does not read as
"your password is wrong".

## Feature 2: Crew access requests

Today `TASK_CAPABILITIES` and `analyzeTaskIntent` live in the browser, match
keywords against the instruction once, and check connection state in
localStorage. That cannot serve scheduled work, which runs on the cron with no
browser present, and cannot notice that today's run needs something yesterday's
did not.

The design moves the question to the server and makes it per run.

- A capability registry on the server: each capability names what it needs
  (an OAuth grant, a stored credential, a token, a school login), in a sentence
  a person can act on.
- Requirements are resolved for each individual run, from the instruction and
  from what the run discovers while executing. Tuesday's essay asks for Drive;
  Monday's quiz did not.
- A run that is missing something does not half-finish. It records
  `needs_access` with the exact list and stops at that point, keeping what it
  already did.
- The person sees it against that run, in its own words: "To finish today's
  Canvas work I need Google Drive, to make a copy of the worksheet, and your
  teacher's address, to submit it."
- It is driven by the registry, so a new integration inherits the behaviour
  without anybody wiring it up. Global Mail is the first to inherit it.

## Increments

Each is gated and pushed on its own.

1. Global Mail, server side: registry, IMAP client, SMTP client, encrypted
   credentials, routes, tests.
2. Global Mail, in the product: connect flow with per-provider instructions,
   and wiring into Crew so it runs unattended.
3. Crew access requests: server capability resolution, per-run requirements,
   and the surfacing described above.

## Testing

- The IMAP and SMTP clients are driven by a scripted fake socket, covering
  literals, multi-line responses, auth failure, and a server that hangs up.
- Credentials: a round trip through encrypt and decrypt, a proof that no route
  returns a stored password, and a proof that storage is refused when
  `MAIL_CRED_KEY` is unset.
- The registry: every entry has a host, a port and app-password instructions,
  and the country count is asserted so coverage cannot quietly shrink.
- Access requests: a run missing a capability stops with `needs_access` rather
  than reporting success, and two runs of the same job on different days can
  require different things.

## Out of scope

WeChat, Wallapop, LinkedIn auto-apply, and every other platform that forbids
automation. Global job boards and marketplaces, which come after mail.
