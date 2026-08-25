# The session token is in localStorage, and moving it needs your decision

`amv_api_token` is AMV's own session token and it lives in `localStorage`,
alongside `amv_api_refresh`. Anything that gets a script running on the page can
read both. This was on my list as something to fix, and it is not something I
should fix on my own, because every honest version of the fix changes
authentication - which is on your approval list.

## Why the obvious version makes it worse

The Google access token was moved off disk earlier this week: it now lives in a
module variable and only a "this account granted access" flag is stored, so a
reload asks Google again. That worked because Google will re-issue on request.

AMV's own tokens do not have that shape:

  amv_api_token     the access token. 1 hour.
  amv_api_refresh   the refresh token. 30 days.

Moving only the access token into memory looks like the same fix and is not.
On reload the app would exchange the refresh token for a new access token, so
the refresh token has to stay readable - and the refresh token is the MORE
valuable of the two. Somebody who reads it holds the account for thirty days;
somebody who reads an access token holds it for an hour. Halving the exposure
window on the cheap half while leaving the expensive half exactly where it is
would let me write "the session token is no longer in localStorage" in a commit
message and leave you less safe than the sentence sounds.

## What actually fixes it

The refresh token becomes an httpOnly cookie set by the Worker, so no script on
the page can read it at all, and the access token lives only in memory.

That is the right answer and it is a real change:

  - AMV's pages and the Worker are on different origins (`amv.homes` and the
    workers.dev address), so the cookie needs `SameSite=None; Secure` and every
    call needs `credentials: 'include'`
  - which means CORS stops being `*` and has to name the exact origin, with
    `Access-Control-Allow-Credentials`. That is a good change on its own and it
    is a change to who may call the API
  - CSRF becomes a live concern the moment a credential travels automatically.
    Today nothing is sent unless a script attaches it, which is precisely what
    makes it XSS-readable. Cookies invert that trade, so the write routes need a
    token check they do not currently need
  - sign-out, session revocation and the token-epoch machinery all move from
    "delete a localStorage key" to "the server clears the cookie"

None of that is exotic. All of it is authentication, and you asked to approve
changes to authentication before they happen.

## What I would do, if you want a recommendation

Do it, and do it before there are users - the migration is free now and is a
forced re-login for everybody later. It is a day of work with the CORS and CSRF
halves done properly, and it wants its own gate run and its own review rather
than being folded into a batch.

## What is true in the meantime

The exposure is real but it is not unguarded: the strict CSP is what stands in
front of it, every user-supplied string goes through `escH`, and the token is
namespaced per account. The gap is that all of that has to hold perfectly,
whereas an httpOnly cookie means a script that gets through still cannot read
the credential. Defence in depth is the point.
