# What was attacked, and what survived

A test suite tells you what somebody remembered to check. It does not tell you
what it would catch. The only way to learn the second is to break the code on
purpose and see whether anything notices.

This is the record of doing that to the four paths where a defect ends the
company rather than spoiling a demo. **Twenty-three mutations. Eight of them
went unnoticed by every suite in the repository.** All eight are now caught.

Re-run any of it by making the same edit by hand and running the suites named.

---

## Connectors — 8 attacked, 5 unnoticed

A connector is a program somebody else wrote, running on somebody's own
machine, on accounts AMV does not own. It is the largest blast radius in the
product and the one a marketplace would multiply.

| # | Attack | Was | Now caught by |
|---|--------|-----|---------------|
| 1 | Connector tools stop needing consent | caught | `a-connector-acts-on-your-real-accounts` |
| 2 | **Consent asked, answer discarded, connector runs anyway** | **unnoticed** | `a-connector-acts-on-your-real-accounts` |
| 3 | The dialog stops showing the arguments | caught | `a-connector-acts-on-your-real-accounts` |
| 4 | **The server admits any tool name** | **unnoticed** | `the-bounds-that-make-a-connector-safe-to-admit` |
| 5 | **The tool-count bound is gone** | **unnoticed** | same |
| 6 | **A description may be any length** | **unnoticed** | same |
| 7 | **A schema may be any size** | **unnoticed** | same |
| 8 | `isMcpTool` matches nothing | caught | `a-connector-acts-on-your-real-accounts` |

Attack 2 is the one that matters. `const allowed = true; await
_confirmModelTool(…)` leaves the dialog on screen, leaves the person's Deny
unheard, and runs the connector. The only test that looked at the dispatch read
the source for `if(!allowed)`, which that edit leaves exactly in place.

Attacks 4-7 are the three constants `_safeTools`'s own comment names as the
reason admitting third-party tool NAMES by shape is not a hole. The argument
was sound; nothing tested it.

## Money — 6 attacked, 1 unnoticed

| # | Attack | Was | Now caught by |
|---|--------|-----|---------------|
| 0 | The PayPal route ignores its verifier | unnoticed | `webhook-signature` |
| 1 | **A forged Stripe webhook is accepted** | **unnoticed** | `webhook-signature` |
| 2 | A lapsed subscription keeps its plan | caught | `a-widget-spends-its-owners-money` |
| 3 | A payout over the automatic limit is not flagged | caught | `payouts-decide-themselves`, `payouts` |
| 4 | A refused spend reservation is treated as allowed | caught | three suites |
| 5 | A missing ceiling means no counter at all | caught | three suites |

The money path is well tested. It had one hole and it was the front door:
anybody on the internet POSTing a `checkout.session.completed` and granting
themselves any plan. Same shape as the connector finding - the VERIFIER was
tested exhaustively and the ROUTE was checked by reading source text.

## Auth — 9 attacked, 2 unnoticed

| # | Attack | Was | Now caught by |
|---|--------|-----|---------------|
| 1 | A forged JWT signature is accepted | caught | `auth`, `what-a-token-does-not-say` |
| 2 | **The algorithm is no longer pinned (`alg:none`)** | **unnoticed** | `what-a-token-does-not-say` |
| 3 | **A token from another era still works** | **unnoticed** | same |
| 4 | `requireUser` hands back a user with no token | caught | three suites |
| 5 | The admin token is compared loosely | caught | `admin-security` |
| 6 | A wrong password is accepted at sign-in | caught | `auth`, `authbypass` |
| 7 | A wrong password confirms account deletion | caught | `erasing-everything-needs-more-than-a-token` |

Both survivors refuse a PERFECTLY VALID token, which is why neither had a test:
a suite grows around what users do, and these two only matter on the worst day
of the company's life. The version check is the lever that signs everybody out
after a breach - if it is not enforced, the lever moves and nothing happens.

## The bridge — 5 attacked, 0 unnoticed

| # | Attack | Result |
|---|--------|--------|
| 1 | A path outside the project folder is allowed | caught |
| 2 | Symlinks are no longer resolved, so a link escapes the root | caught |
| 3 | The destructive-command refusal list never matches | caught |
| 4 | The session token is compared loosely | caught |
| 5 | Any origin may drive the bridge | caught |

All five by `the-bridge-only-reaches-one-folder`, which was written after a real
finding (the daemon promised "that folder and nowhere else" while exec reached
anywhere). **This is the example to copy.** It drives the daemon rather than
reading it, and it covers confinement, symlinks, refusals, the token and the
origin in one place.

---

## The counter, and erasure - 9 attacked, 4 unnoticed

Added after the four paths above. Both were reported wrongly before they were
reported correctly; LESSONS 467 has the method failure in full.

| # | Attack | Was | Now caught by |
|---|--------|-----|---------------|
| 1 | **`reserve` stops enforcing the cap (unbounded overshoot)** | **unnoticed** | `the-ceiling-is-decided-inside-the-counter` |
| 2 | **`reserve` accepts a negative amount (free budget for everyone)** | **unnoticed** | same |
| 3 | **`incr` lets a refund drive the counter negative** | **unnoticed** | same |
| 4 | `release` deletes a lock it does not own | caught | `a-lock-that-expired-is-somebody-elses-lock` |
| 5 | A half-worked erasure answers `ok:true` | caught | three suites |
| 6 | The reauth answer is computed and discarded | caught | `erasing-everything-needs-more-than-a-token` |
| 7 | Unsettled payouts no longer block deletion | caught | same |
| 8 | A failed payout lookup reads as "nothing outstanding" | caught | same |
| 9 | **One erasure phase (team membership) fails silently** | **unnoticed** | `an-erasure-that-half-worked-has-to-say-so` |

1-3 are the guards on every dollar in the product, in the one class no suite
ever ran: eight money suites all drive a test double of it.

9 is the connector-consent shape once more. The phase audits AND pages an
operator, so the suite's silent-catch check correctly skips it, and its count
check passes with 26 reports where 15 are required. Nothing asserted the thing
the code's own comment claims - that the ROUTE stops answering "deleted". An
operator being paged is not the person being told, and erasure is an obligation
to the person.

## What this does NOT cover

Said plainly, because an audit that implies more than it measured is worse than
none.

- **Twenty-three mutations is not every mutation.** These were chosen as the
  ones with the worst consequence, not exhaustively.
- **Nothing here tests the live deployment.** It tests the code in this
  repository. Secrets, bindings and DNS are checked by the deploy preflight and
  by the CI health check, which are different claims.
- **Provenance is not covered at all.** Every connector finding above is about
  a connector the person chose to run. Who may publish one, what review a
  listing gets, and whether a package is pinned are open questions and the
  reason Milestone 9 is closed. See ROADMAP.md.
- **The model is not a security boundary and is not treated as one.** A
  connector's description goes into the model's context verbatim; the bound on
  its length is a cost control. What stops a tool call the person did not want
  is the consent dialog, which is why attack 2 above mattered so much.
