# The session token is out of localStorage

`amv_api_token` was AMV's own session access token and it lived in
`localStorage` alongside `amv_api_refresh`. Anything that got a script running
on the page could read both. Both are now out of storage, in two stages, and
this file records what each stage actually bought - because the sentence "the
session token is no longer in localStorage" sounds like more than it is.

## Stage one: the refresh token (AMV-019)

    amv_api_token     the access token. 1 hour.
    amv_api_refresh   the refresh token. 30 days.

The refresh token was always the one worth protecting: it is valid for weeks
and mints access tokens on demand, so a copy of it is a copy of the account.
Somebody who reads it holds the account for thirty days; somebody who reads an
access token holds it for an hour.

It is an **HttpOnly cookie** set by the Worker. Script cannot read an HttpOnly
cookie at all, so the same injection that could previously walk off with a
month-long credential gets, at worst, one short-lived token. Scoped to `/auth`,
so it is not attached to every API call.

`SameSite=None` is required because the app and the API are different origins,
which in turn requires `Secure` and a concrete `Access-Control-Allow-Origin`.
So it only engages on a deployment that has set `ALLOWED_ORIGIN`. Without one
the browser would refuse the cookie and the session would silently stop
surviving a reload, so the token is still returned in the body and the response
says which mode is in force rather than leaving the client to guess.

## Stage two: the access token

In cookie mode the access token now lives in a module variable and never
touches storage. On a reload there is nothing in memory and nothing on disk;
the session comes back from the cookie the page cannot read.

**Be precise about what this buys.** It does NOT stop an injected script that is
running on the page right now: script that can read `localStorage` can read a
module variable just as easily. They are both in reach of code executing in the
page, and anything claiming otherwise is describing a different threat.

What it does stop is everything that reads storage **without executing here**:

  - an extension enumerating `localStorage`
  - a shared machine, or one somebody else picks up
  - a stolen disk image or a copied browser profile
  - and the plain fact that a token in storage outlives the tab, so a page
    closed on Friday leaves a working credential on that machine until it
    expires

A token in memory dies with the page. That is a real and bounded win, and it is
the same reasoning that took the Google token off disk.

**Only in cookie mode**, and that is not a hedge. Without the cookie there is
nothing to re-mint from, so a memory-only access token would mean signing in
again on every reload - the feature would be "more secure" by being broken. A
deployment with no configured origin keeps the old path and keeps working.

## The bug this found, which had been shipped

`amv_refresh_cookie` - the flag saying "the server holds the refresh token" -
was written through `saveStr`, which files keys under the signed-in account.
This one is not about a person. It is about the deployment, and it is the same
answer for everybody who opens the build.

Scoped, the sequence was fatal:

1. Signing up writes the flag while nobody is signed in yet, so it lands under
   the anonymous scope.
2. A moment later the account is created and the scope changes.
3. From then on `cookieAuth` reads a **different key**, finds nothing, and
   answers false.
4. So the client believed it was holding its own refresh token, looked in
   `localStorage` where nothing had been written, and restored no session.

On the deployment the cookie was built for, **pressing F5 signed you out.**

It was invisible because the two halves were tested apart. The Worker tests
proved the cookie is set with the right flags. The client tests read the source
of the setter. Neither one signed in and reloaded. Correct at both ends, not
joined in the middle - the sixth instance of that shape in this codebase.

`amv_refresh_cookie` is a global key now, classified as a device fact so it
survives a sign-out, and
`tests/e2e/the-session-survives-a-reload-without-a-token-on-disk` does the whole
round trip.

## What is still true, and what is left

CSRF did not become a live concern, because the cookie is scoped to `/auth` and
carries only the refresh: every other route still authenticates from an
`Authorization` header a script has to attach deliberately. The routes that do
take the cookie are the two that already require the request to have come from
the configured origin.

`amv_api_token` and `amv_api_refresh` are still listed in the key tables. A key
that has stopped being written is not a key that has stopped existing - a device
that ran an earlier build still has them, and both the sign-in path and sign-out
clear them on the way past.

The strict CSP, `escH` on every user-supplied string, and per-account key
namespacing all still stand in front of the page. None of them stopped being the
first line of defence; the point of this work is that they no longer have to
hold perfectly for a credential to stay out of somebody else's hands.
