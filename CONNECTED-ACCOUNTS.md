# Connected accounts: the plan, and the fork you need to decide

Written against your explicit yes, scoped by the frame you named. Parts of that
frame are a "no", and those are listed too - an approval that approves
everything is not worth having.

## What exists today

Only Google, and it works. Worth knowing exactly how, because the shape of the
next provider is decided by it:

- `/v1/oauth/google/exchange` swaps the code for tokens. Rate limited per
  account (10/min, 60/day), audited, and the **refresh token is stored
  server-side** under `goauth:<email>`.
- `goauth:` is in `BACKUP_NEVER`. A downloadable backup file is the last place
  a long-lived Google credential belongs, and that is already correct.
- Disconnecting deletes the record, and the account list names Google as
  something you can also revoke from your Google account directly.

And one thing that is not correct:

- **The Google ACCESS token is kept in `localStorage` as `amv_gtoken`.** Any
  script that ends up running on the page can read it. This is the same class
  of problem that was fixed for AMV's own refresh token (AMV-019) and it was
  not fixed for the provider token beside it.

## The fork - this one is yours, not mine

The current design has the browser hold the provider token and call Gmail
directly. The server never sees your mail. That is a real privacy property and
it is why the Crew screen says, honestly, that mailbox jobs "run while AMV is
open".

What you asked for - AMV doing the overdue things at somebody's work while you
sleep - cannot be done that way. Unattended work needs the token on the server.

Neither answer is simply better:

| | Token in the browser (today) | Token on the server |
|---|---|---|
| Jobs run unattended | No. Tab must be open | Yes |
| AMV's servers can read the account | Never | Yes, whenever it wants |
| One breach of AMV exposes | Nothing of your mailbox | Every connected mailbox |
| Honest to say "AMV works while you sleep" | No | Yes |

**What I would do, and will do unless you say otherwise:** both, per
connection, never as a global switch.

- Foreground stays the default for personal data. Least privilege, and the
  server holds nothing.
- Server-side is opt-in **per connected account**, with the trade stated in
  the words above at the moment of connecting - not in a settings page nobody
  reads. "This lets AMV work while you are away. It also means AMV's servers
  hold a key to this account until you revoke it."
- Revoking calls the provider's revoke endpoint, not just deletes our row. A
  disconnect that leaves a live grant at Google is a lie.

## What gets built

One connector framework, not a pile of one-off integrations:

1. **Generic OAuth 2.0 + PKCE** with provider descriptors (auth URL, token URL,
   revoke URL, scopes, refresh style). Adding a provider becomes data, not code.
2. **State + PKCE verifier server-side**, single-use, short TTL. The current
   Google flow keeps `amv_oauth_state` in localStorage; a CSRF guard readable
   and writable by page script is not one.
3. **Tokens never in localStorage.** Foreground connections hold the access
   token in memory for the tab's life and re-mint from the server on reload.
4. **Scopes requested per job, incrementally** - connecting for a calendar
   digest must not ask for send-mail.
5. **A connections screen** that shows, per account: what it can do, when it
   was last used, by which job, and one button that really revokes.
6. **Honest degradation.** A provider with no client id configured says
   "not set up on this deployment" and cannot be clicked into a broken flow.

## What the frame rules out

- **No credential vault.** Already built and refused: passwords, card numbers,
  bank details and codes are rejected before they reach the device, on the way
  out of the client, and on the server for create and edit. Nothing changes.
- **No provider I cannot exercise end to end.** Shipping eight untested auth
  paths is the opposite of care. The framework lands with the descriptors
  written and each one dark until its credentials exist.
- **No "connect everything" button.** Least privilege means one account, one
  reason, one scope set.
- **No scraping or password-replay for services without OAuth.** If a provider
  has no OAuth, AMV prepares the work up to the sign-in and hands that step
  back. That is worth almost as much and cannot leak anything.

## What only you can do

Every provider needs an app registered with that provider, and the client id
and secret pasted in as Worker secrets. I cannot create those accounts, and I
would not want the credentials if I could. The build will be dark until you do
it, and will say so plainly rather than failing.

## Order of work

This lands **after** the current branch is green and merged. It changes
authentication, and starting it on top of an unmerged 26-commit branch that is
still failing a gate is how both pieces end up half-done.
