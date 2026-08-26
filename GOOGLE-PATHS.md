# There were two Google systems. There is one now.

Three things in this client were called something like "connect Google" and they
were not variants of each other. I went looking to tidy one away, found it was
load-bearing, put it back, and then retired it properly. This is what is there
now and how it got there.

## 1. Sign-in - `triggerGoogle`

Google Identity Services one-tap. Proves who you are so AMV can make you an
account. Grants **no** access to Gmail, Drive, Calendar or anything else.

Still here, still the only Google thing on the sign-in screen. The Integrations
catalogue used to reach it too, from a row badged Autonomous that described
reading and drafting email - so somebody could grant nothing and be told they
were connected. That row leads to Connected accounts now.

Signing in is not granting access. Nothing in the product decides what AMV may
do by asking who somebody is any more, which was the single most repeated defect
in this whole area.

## 2. The older grant - `connectGoogle` - RETIRED

    connectGoogle -> Google consent -> checkOAuthCallback
      -> /v1/oauth/google/exchange   the Worker stored a refresh token
      -> /v1/oauth/google/refresh    minted a short-lived token for the page
      -> the browser-side jobs: mailbox, calendar, classroom_due

Every arrow is gone. The function, both routes, both handlers, the in-memory
token, the migration off disk, and the last implicit flow in the client.

Two things were wrong with it that no amount of care inside those functions
could fix. A provider token that reaches a page is a token anything on that page
can take. And it dies with the tab, so nothing built on it could run overnight
however it was described on screen.

It also asked for the FULL `drive` scope - everything a person owns - to do a
job that touches one document.

**I removed this once as dead code and two tests reversed me within the hour.**
It had no callers, which made it unreachable; it was not dead, because a whole
live subsystem hung off it. Deleting it would have made an existing gap
permanent and silent, and taken with it the only place the read-only Classroom
scopes were named - which is why the school reader was getting a 403 from
Google: correct at both ends, not joined in the middle. That is LESSONS 296.

It went this time because everything downstream had moved first, one stage at a
time, each stage verified before the next started.

## 3. Connected accounts - `connAdd` / `/v1/connect/start` - THE ONE THAT STAYED

The server picks the verifier, keeps it sealed, builds the authorisation URL,
does the exchange with the client secret, and seals the token under
`CONNECT_KEY`. No provider token ever reaches the page, so jobs run with the tab
closed. The person chooses the scopes, per capability, and can revoke each one.

It offers `mail.read`, `mail.send`, `calendar.read`, `calendar.write`,
`drive.read`, `school.read` and `drive.write`.

## How the migration went

**Stage 1 - done.** The two read-only Classroom scopes went on the server's
Google provider, with a server-side reader, and the school job was joined to it.
That job now runs with the tab closed, which it never could before. Three
separate joins were missing and each was invisible on its own - see
`tests/worker/it-can-see-the-homework-and-not-hand-it-in.test.mjs`.

**Stage 2 - done.** Every action that reached Google from the browser now asks
the server, through one route, `/v1/connect/act`. That is the mailbox, sending
mail, the calendar, adding an event, Drive, school work, both background checks
and the chat engine's own Gmail path.

The capability each action needs is declared beside it in a table rather than at
each call site, so an action added later cannot be written without one - which
is exactly how the old layer came to call Google with a token that had never
been granted the scope. Writes are rate-limited harder than reads: reading your
inbox forty times is a busy morning, sending forty mails is not.

**Stage 3 - done.** The older grant is retired, and the school Drive copy that
was the last thing depending on it moved with the rest.

The decision that unblocked it was whether AMV should be able to put a copy of a
school document into a student's Drive. The answer was yes, and it was built
with `https://www.googleapis.com/auth/drive.file` - the NARROW scope, which
reaches only files AMV itself created or ones the student explicitly opened with
it. It cannot read their Drive. The broad `drive` scope the old flow used is not
coming back.

Copying needs two capabilities at once, `drive.read` to read the teacher's
document and `drive.write` to create the copy, so `connUse` accepts a SET and
requires all of it on one connection. Satisfying half from one grant and half
from another would mean the refusal arrives from Google in the middle of the
operation, after the read and before the copy, which is the worst place for it.

`drive.copy` and `drive.share` are reachable only from the school pane's own
buttons. Neither is in the model's tool table, so nothing AMV writes can share a
document with an address of its choosing - the share is a person pressing a
button with the address in front of them.

## The one that nearly got away

`checkOAuthCallback` served both flows, and I deleted it with the older one.

It passed the syntax check, the build, and all 138 e2e suites - because not one
of them ever opened the URL a provider returns to, and the call site was
`try{ checkOAuthCallback(); }catch(e){}`. A bare catch. The ReferenceError went
into it and the page booted perfectly.

Anyone connecting an account would have approved real access at Google, come
back to a normal-looking AMV, and had the code silently thrown away. No tick, no
error, nothing in the console. The worst thing this feature can do, and
everything was green.

It is restored as the `c_`-only handler, the guard at the call site names it
instead of catching everything, and
`tests/e2e/coming-back-from-the-provider-finishes-the-job.test.mjs` now arrives
at the return URL for real. Deleting the handler again turns that suite red.

## What moved with the code, and where the tests went

Retiring a subsystem strands the tests that guarded it, and a stranded test goes
green about nothing. Each was repointed at whatever now holds the property
rather than deleted:

| the property | was asserted against | is asserted against |
|---|---|---|
| a grant renews before it expires | `ensureGToken`, in the browser | `connUse`, in the Worker - `the-grant-renews-itself-overnight` |
| a redirect cannot point elsewhere | `googleOAuthExchange` | `connStart` - `the-routes-nobody-tested` |
| the refresh token never reaches a browser | `googleOAuthExchange` | `connFinish`, and every response in the file |
| the implicit flow is only the fallback | `connectGoogle`, ordering | it is nowhere - asserted as absence |
| a row shows connected only on a real grant | a seeded sign-in token | `S.user` with a Google account and no grant |

`_sameOrigin` was left with no callers when the exchange went, while `connStart`
carried its own inline copy of the same comparison - two definitions of "same
origin", one of them live. `connStart` calls the shared one now.
