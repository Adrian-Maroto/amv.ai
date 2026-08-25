# There are two Google systems, and one has lost its front door

Three things in this client are called something like "connect Google" and they
are not variants of each other. I went looking to tidy one away, found it was
load-bearing, and put it back. This is what is actually there.

## 1. Sign-in - `triggerGoogle`

Google Identity Services one-tap. Proves who you are so AMV can make you an
account. Grants **no** access to Gmail, Drive, Calendar or anything else.

Reachable from the sign-in button and, until tonight, from the Integrations
catalogue's Google row - which is the bug fixed in this batch: that row is
badged Autonomous and describes reading and drafting email, so Connect ran a
sign-in and the tick afterwards came from the sign-in token. Somebody could
grant nothing and be told they were connected.

## 2. The older grant - `connectGoogle`, and everything under it

    connectGoogle -> Google consent -> checkOAuthCallback
      -> /v1/oauth/google/exchange   the Worker stores a refresh token
      -> /v1/oauth/google/refresh    mints a short-lived token for the page
      -> the browser-side jobs: mailbox, calendar, classroom_due

Every arrow after the first still exists and still runs. **Nothing calls
`connectGoogle`.** An account that connected while it was still reachable keeps
working; nobody new can start one.

That is why the school reader fails. `classroom_due` calls
`classroom.googleapis.com` for real, and the only place the two read-only
Classroom scopes are ever requested is inside `connectGoogle`. The reader is
live, the scope request is unreachable, so Google answers 403 - correct at both
ends, not joined in the middle, which is the third instance of that shape in
this codebase.

I removed this function as dead code and two tests caught it within the hour.
It is restored and deliberately untidied.

## 3. Connected accounts - `connAdd` / `/v1/connect/start`

The newer system, and the better one. The server picks the verifier, keeps it
sealed, builds the authorisation URL, does the exchange with the client secret,
and seals the token under `CONNECT_KEY`. No provider token ever reaches the
page, so jobs run with the tab closed. The person chooses the scopes.

It offers `mail.read`, `mail.send`, `calendar.read`, `calendar.write`,
`drive.read`. **It does not offer Classroom**, so it is not yet a replacement
for (2).

## DECIDED: keep Connected accounts

Approved. The migration is in stages, because the older grant has six live
browser-side actions on it and moving them all at once is how a working feature
becomes a broken one.

**Stage 1 - done.** The two read-only Classroom scopes are on the server's
Google provider, there is a server-side reader, and the school job is joined to
it. That job now runs with the tab closed, which it never could before. Three
separate joins were missing and each was invisible on its own - see
`tests/worker/it-can-see-the-homework-and-not-hand-it-in.test.mjs`.

**Stage 2 - not started.** Five browser-side actions remain on the older grant:
`gmail_list_unread`, `gmail_send`, `calendar_list`, `calendar_create`,
`drive_list`. Two of them WRITE, so they need the approval flow carried across
with them, not bolted on afterwards.

**Stage 3 - not started.** Retire the older grant: `connectGoogle`,
`checkOAuthCallback`'s Google branch, `/v1/oauth/google/exchange`,
`/v1/oauth/google/refresh`, `refreshGToken` and the in-memory token. Last,
because until stage 2 lands it is the only thing holding those five up.

## What was decided

**Which system AMV keeps.** They overlap on mail, calendar and Drive, and
holding both means two grants, two revocation paths and two places a bug can
live. My recommendation is (3), because it is the one that can honour "runs
while the tab is closed", and because a token that never reaches the browser is
a token XSS cannot take.

If that is the answer, two things follow:

1. **Two scopes need your approval** before the school feature can work:
   `classroom.courses.readonly` and `classroom.coursework.me.readonly`, added to
   the server's `CONN_PROVIDERS.google.scopes`. Read-only is the entire safety
   argument - AMV can see what a student has been set and cannot turn anything
   in, because the scope that would let it (`classroom.coursework.me`, without
   `.readonly`) is never requested and Google refuses the call. A rule in a
   prompt can be argued with; a permission that was never granted cannot. This
   is a minor's school record, which is why I have not added them myself.

2. **`classroom_due` moves server-side** with the rest, and stops being a job
   that only runs while a tab is open.

If the answer is instead to keep (2), it needs an entry point on a screen, and
the implicit-flow fallback inside it should go now that every deployment worth
having has a backend.

Either way, doing nothing leaves a feature that 403s and two systems drifting.
