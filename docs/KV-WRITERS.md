# Every read-modify-write on a raw KV key, and what a stale read there costs

Written Nov 21 for Build 17 audit B17-010. The helper is `_withKV`
(`src/worker/53-marketplace-economy.js`): it takes the record lock (`_withRecord`,
a claim in the atomic object), reads the KV key, runs the change and writes it
back. The lock stops two writers interleaving. It does **not** make the read
current. Workers KV can answer from a copy up to about a minute old in another
region, so a writer there can read an older copy, change it and write it back
over a newer one.

So the question for each caller is what such a stale read costs, and whether
something other than this record is the authority.

| Kind (`name`) | Where | What it holds | Authority | Worst stale read | Class | Done / plan |
|---|---|---|---|---|---|---|
| `signincode` | 31-sign-in-codes.js | a sign-in code, its tries | **atomic object**: `_challengeTry` counts tries, `_challengeUse` spends it once | a message's "N tries left" is off | security, covered | covered since SEC-01/02 |
| `resetcode` | 28-password-reset.js | a reset code, its tries | **atomic object**, per issue of the code | same | security, covered | covered |
| `smsverify` | 43-sms-agent.js | a phone code, its tries | **atomic object** since Nov 21 (`_challengeTry`, per issue) | was: an older copy handed back guesses | security | **fixed Nov 21**, tested in `sms-security` |
| `wallet_tx` | 53-marketplace-economy.js | a seller's money history (display) | the wallet (`_withWallet`) and the Postgres ledger row (`_pgSellerRow`) | a history line missing from the list; the balance is not touched | money, display | the list is a view; the ledger is the record. Plan: read history from the ledger rows once Postgres is the read store (DATA-TIER step 5) |
| `purchases` | 53-marketplace-economy.js | a buyer's bought items (display) | `entitleitem:<email>:<id>` (written once per item) decides ownership | an item missing from "Bought" until the next write | money, display | ownership never reads this list. Plan: rebuild from `entitleitem:` on read when they differ |
| `payoutyear:<year>` | 54-payouts.js | paid per seller per year, for tax | `withdraw:` records are the source of truth (said in the alert) | one payout missing from a year total | money, reporting | settlement is one operator at a time, from one place, so two stale settlements need two regions within a minute. Plan: reconcile from `withdraw:` before any filing - the admin tax report already scans it |
| `wdopen` | 31-sign-in-codes.js | a seller's payouts in flight (index) | `withdraw:` records; `_payoutsInFlight` re-checks each | an index without one id: rebuilt by scan when it disagrees | money, index | covered by the re-check |
| `market` | 52, 53, 54, 55 | a listing's counters (installs, sales, rating) and hidden/disabled state | **atomic object** for a takedown (`mktdown:` / `mkthide:`), this record for the rest | was: a takedown written over by a counter bump from an older copy, so a scam went back on sale | listing | **fixed Nov 21**: every listing write goes through `_withListing`, which puts a takedown back; buying checks the object too. Tested in `a-compromised-publisher-is-switched-off`. Plan: counters to object tallies |
| `mktmine`, `mktinbox`, `mkreview`, `mkrate` | 53, 55, 54 | a seller's listings, inbox, reviews, ratings | these records | a review or rating lost to an older copy | user content | plan: rows in the accounts database (DATA-TIER) |
| `teamlog` | 33-team-roles.js | a team's admin log (display) | `audit()` is the record | a log line missing | display | covered by the audit stream |
| `mailcfg`, `telegram` | 62, 66 | a person's own mail / Telegram settings | these records | a settings change undone by an older copy | settings | written by the person from one device; low exposure |
| `stats:jobuse`, `duehour:*` | 12, 15 | counts and the due-work index | the index is a hint (`docs/DUE-WORK.md`); the sweep is the authority | a count one short; a booking found by the sweep instead | cache | disposable by design |

## What was fixed with this inventory

- **`smsverify`** counted guesses only on the KV record. That was the one
  security record here with no authority behind it. It now counts in the atomic
  object per issue of the code, the way sign-in and reset codes do.
- **`market`**: a takedown is monotonic - nothing un-hides a listing on
  purpose - so it is now also counted in the atomic object, and every write of
  a listing (installs, sales, ratings, refunds) puts it back if the copy it
  read had lost it. The buy path asks the object as well as the copy.

## What stays, and why

Nothing that decides access or moves money now reads its answer from one of
these lists alone. Each money list is a view of a record written once elsewhere
(`entitleitem:`, `withdraw:`, the wallet, the ledger rows). A stale read there
is a display that is briefly wrong, not money that is wrong.

Moving the remaining lists to transactional rows is the data-tier plan
(`docs/DATA-TIER.md`). That is a schema change, so it waits for the owner.

## How a new caller is judged

Before adding a `_withKV` caller: if the record decides access or money, it
needs an authority that is not a KV copy (the atomic object or a database row).
If it is a view, name the record it is a view of in this table.
