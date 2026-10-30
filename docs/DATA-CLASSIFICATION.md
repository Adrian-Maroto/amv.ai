# What AMV holds, how sensitive it is, and what happens to it

Scale audit #68. Every kind of data AMV keeps belongs to one class, and the
class decides where it lives, whether it is in a backup, whether it is erased
with the account, and whether it may appear in a log. This page describes the
code as it is; where the code is the rule, the file is named, so the page can
be checked rather than trusted.

The two lists that are the actual rules:
- **What a backup never carries** - `BACKUP_NEVER`, `src/worker/27-backup-restore.js`.
- **What erasing an account deletes** - `PER_USER_KINDS` and the prefixes after
  it, `src/worker/31-sign-in-codes.js`.

`tests/worker/backup-covers-everything` and `erasure-covers-every-key` fail if
a new kind of record is added without a decision in both.

## The classes

| Class | Examples (record kinds) | Where | Backed up | Erased with the account | In logs |
|---|---|---|---|---|---|
| **Security** | password hash and salt (`acct`), passkeys, authenticator secret, recovery codes, sign-in challenges (`pkchal:`, `mfachal:`, `totpset:`), revocation (`auth:` object, `tokepoch:`) | KV and the counter objects | Hashes yes; challenges and half-set-up secrets **never** | Yes, except `tokepoch`, a bare number kept so tokens issued before deletion stay dead | Never the secret; the event and the account address |
| **Credentials for other services** | connected-account tokens (`conn:`), mail and Telegram credentials (`mailcfg:`, `telegram:`), the old Google grant (`goauth:`) | KV, **sealed with AES-GCM** under a Worker secret (`CONNECT_KEY`, `MAIL_CRED_KEY`) | **Never** | Yes | Never |
| **Financial** | plan and billing state (`ent`), credit and seller ledgers (`wallet`, `wallet_tx`), payment events, bank links (`fin:`, `finlink:`) | KV today; Postgres ledgers when the data tier moves (`docs/DATA-TIER.md`) | Plans and ledgers yes; bank links **never** | Yes, except records a payment provider or tax rule requires AMV to keep | Amounts and event ids; never card details (AMV never receives them) |
| **Private content** | chats and projects (`data`), files (`lib` and R2), memories, background jobs and their results (`auto`), drafts | KV, R2 | Yes | Yes | **Never** - no prompt, answer or file content is logged |
| **Account** | name, address, language, sessions and devices (`sess:`), settings | KV | Yes; sessions **never** (restoring one would revive a sign-in somebody ended) | Yes | The address, in audit lines (see below) |
| **Enterprise confidential** | a team's shared data, company sign-in settings, SCIM directory | KV | Yes | With the team | Team id and the acting account |
| **Health-sensitive** | an Apple Health export the person attaches | **Never leaves the device** - read in the browser (`health.js`) | No | Nothing to erase on the server | Never |
| **Operational** | usage counters, rate limits, spend shares, switches, the outbox | Counter objects, KV | Counters **never** (they rebuild); the outbox **never** (it would resend) | The outbox and per-account counters, yes | Counts only |
| **Public** | marketplace listings, the public catalogue, share pages the person published | KV | Yes | Withdrawn with the account | Listing ids |

## Logs

Audit lines (`audit()` in `src/worker/05-audit-log.js`) record **what
happened and to which account** - the account's email address, the event,
the route - because an investigation without the account is not an
investigation. They never carry a password, a token, a key, a code, a
prompt, an answer or a file. Observability keeps every request today
(`head_sampling_rate = 1`, owner decision 34); the address in audit lines is
the personal data in them, and it is why those logs are themselves
access-controlled to the owner.

## Encryption, said precisely

Data at rest is encrypted by the storage provider. On top of that, AMV seals
other services' credentials itself (AES-GCM, Worker-held keys), so a copy of
the store alone does not give them away. **AMV is not end-to-end encrypted**:
the server reads chats and files so the model can answer them, and nothing in
AMV's copy, settings or marketing may say otherwise (scale audit #69).

## When a new kind of record is added

Decide its class here first. Then the two tests above force the decision in
code: backed up or `BACKUP_NEVER`, erased or kept (with the reason written
beside it in the test).
