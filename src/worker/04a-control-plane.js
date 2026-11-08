
/* ══════════════════════════════════════════════════════════════════════════
   THE CONTROL PLANE IN POSTGRES: STEP 2, WRITE TO BOTH (owner decision #47,
   Oct 31; docs/DATA-TIER.md).

   With the Hyperdrive binding PG present, every write of an account or an
   entitlement through DB.put / DB.del is also written to its Postgres row.
   KV stays the source of truth: nothing reads these rows yet (that is step 4,
   shadow reads), and a Postgres write that fails never fails the request - it
   is put on the record and on a repair list (`pgrepair:<kind>:<id>`) the
   backfill (step 3) works through. A day of zero failures, or every one
   repaired, is the check before step 3 starts.

   The rules it keeps:
     - written after KV has the record, in the background of the same
       request, so a slow database never slows a sign-in;
     - one short-lived client per write: Hyperdrive pools the connections, and
       a client kept across requests is one the Workers runtime refuses;
     - an account is upserted by its email, an entitlement by its account's
       row; an entitlement that arrives before its account has a row is
       repaired later rather than invented;
     - erasing an account leaves only a tombstone: no name, no address, no
       password, no extras - the id other rows point at, and when.
   Without PG, none of this runs. */

const PG_MIRROR_KINDS = new Set(['acct', 'ent', 'apikeys', 'team']);
/* No expiry on a repair marker (Nov 1 audit DATA-006): an unresolved
   difference does not become fine because a month passed. The backfill's
   repair phase removes a marker when it has rewritten the row. */
const _pgInFlight = new Set();

function _pgOn(env){
  return !!(env && env.PG && typeof env.PG.connectionString === 'string' && env.PG.connectionString.length > 10);
}

async function _pgClient(env){
  const mod = await import('postgres');
  const postgres = mod.default || mod;
  return postgres(env.PG.connectionString, { max: 1, fetch_types: false, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} });
}

/* A MIRROR WRITE THAT CANNOT VANISH (Nov 1 audit DATA-007). The mirror runs
   in the background of the request, held open by whatever request context
   _bg last saw - and a background promise can die with its isolate, leaving
   Postgres a write behind with nothing anywhere saying so. So before the
   record is written, an intent is (`pgintent:<kind>:<id>:<token>`, awaited):
   the mirror deletes its own intent when Postgres has the row; a failure
   turns it into a repair entry at once; and one still there after
   PG_INTENT_STALE_MS - the background died - is turned into a repair entry
   by the cron (runPgIntentSweep), which the backfill's repair phase copies
   again from KV as it is then. Every mirrored write therefore ends either in
   Postgres or on the repair list; none ends nowhere. */
const PG_INTENT_STALE_MS = 5 * 60 * 1000;
async function _pgIntent(env, kind, id){
  if (!PG_MIRROR_KINDS.has(kind) || !_pgOn(env)) return null;
  const tok = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
  const k = 'pgintent:' + kind + ':' + String(id || '').toLowerCase() + ':' + tok;
  /* The time rides as metadata too, so readiness can read every intent from
     the listing alone (DATA-038), not one fetch each. */
  const at = Date.now();
  try { await env.AMV_KV.put(k, JSON.stringify({ at }), { expirationTtl: 7 * 86400, metadata: { at } }); return k; }
  catch (e) {
    /* No intent: put it straight on the repair list instead, so the write
       still cannot be lost. If that fails too, THE WRITE DOES NOT HAPPEN
       (Nov 3 audit DATA-021): it used to go ahead with nothing anywhere
       saying Postgres would miss it. This runs before the record is
       written, so refusing here changes nothing. */
    try { await env.AMV_KV.put('pgrepair:' + kind + ':' + String(id || '').toLowerCase(), JSON.stringify({ at: Date.now(), why: 'intent not recorded' })); }
    catch (_) {
      try { audit(env, 'pg_intent_failed', { kind, id }); } catch(__) { /* logging: it never decides anything */ }
      throw new Error('pg_write_unrecorded');
    }
    return null;
  }
}
async function _pgIntentDone(env, ik){ if (ik) { try { await env.AMV_KV.delete(ik); } catch (e) { /* cleanup of a record already spent or fenced; it expires or is retried on its own */ } } }
/* The cron's half: intents the background never finished become repairs. */
async function runPgIntentSweep(env, atMs){
  if (!_pgOn(env)) return { on: false };
  const now = atMs || Date.now();
  let cursor, moved = 0, open = 0;
  do {
    const page = await env.AMV_KV.list({ prefix: 'pgintent:', cursor, limit: 500 });
    for (const k of (page.keys || [])) {
      const parts = k.name.split(':');
      if (parts.length < 4) { try { await env.AMV_KV.delete(k.name); } catch (e) { /* cleanup of a record already spent or fenced; it expires or is retried on its own */ } continue; }
      const kind = parts[1], id = parts.slice(2, -1).join(':');
      let at = 0; try { at = +(JSON.parse((await env.AMV_KV.get(k.name)) || '{}').at) || 0; } catch (e) { at = 0; }
      if (at && now - at < PG_INTENT_STALE_MS) { open++; continue; }
      try {
        await env.AMV_KV.put('pgrepair:' + kind + ':' + id, JSON.stringify({ at: now, why: 'the background mirror did not finish' }));
        await env.AMV_KV.delete(k.name);
        moved++;
      } catch (e) { /* tried again at the next run */ }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  if (moved) { try { audit(env, 'pg_intent_unfinished', { moved }); } catch(e) { /* logging: it never decides anything */ } }
  return { on: true, moved, open };
}

/* Called by DB.put / DB.del after KV has the write. Never throws, never
   blocks the caller: it runs in the background of the request. `ik` is the
   intent written before it (_pgIntent), cleared here when Postgres has it. */
/* IN THE ORDER THEY WERE WRITTEN. Each write mirrors the whole record as it
   was at that moment, and a mirror of a list (API keys, a team) removes the
   rows the list no longer has. Two writes a moment apart sent two mirrors
   that finished in either order - and when the older finished last it took
   the newer one's key or member back out of Postgres (found by a suite that
   failed only under load). Mirrors of one record now run one after another,
   in write order; different records still run at once. */
const _pgChains = new Map();
function _pgAfter(env, kind, id, obj, ik){
  if (!PG_MIRROR_KINDS.has(kind) || !_pgOn(env)) return;
  const chainKey = kind + ':' + String(id || '').toLowerCase();
  const before = _pgChains.get(chainKey) || Promise.resolve();
  /* AND IN THE ORDER THEY WERE WRITTEN EVERYWHERE (Nov 8 audit DATA-040).
     The chain above orders one isolate's mirrors; two isolates' mirrors of
     the same record could still land in either order. Each write now takes
     the record's next revision from the strongly consistent object at the
     moment it is made (asked now, before anything else waits), and Postgres
     keeps the newest one that landed: an older mirror finishing later
     changes nothing. Not obtainable means unordered, as before - the proof
     still keeps Postgres from answering for a row nobody compared. */
  const revP = _pgRevNext(env, kind, chainKey);
  const run = before.catch(() => {}).then(async () => _pgMirror(env, kind, String(id || '').toLowerCase(), obj, null, await revP));
  _pgChains.set(chainKey, run);
  run.catch(() => {}).finally(() => { if (_pgChains.get(chainKey) === run) _pgChains.delete(chainKey); });
  const p = run
    .then(() => _pgIntentDone(env, ik))
    .catch(async (e) => {
      const why = String((e && e.message) || e).slice(0, 160);
      try { audit(env, 'pg_mirror_failed', { kind, id, error: why }); } catch(_) { /* logging: it never decides anything */ }
      try { await env.AMV_KV.put('pgrepair:' + kind + ':' + String(id || '').toLowerCase(), JSON.stringify({ at: Date.now(), why })); await _pgIntentDone(env, ik); } catch(_) { /* the intent stays and the cron turns it into a repair */ }
      try { await alertOnce(env, 'pg_mirror_failed',
        'Writes to the Postgres control plane are failing (' + kind + ': ' + why + '). Nothing has gone wrong for anybody - KV is still the record - '
        + 'and each one is listed for the backfill to repair. The migration must not move past step 2 until this is zero.', 60); } catch (_) { /* logging: it never decides anything */ }
    })
    .finally(() => _pgInFlight.delete(p));
  _pgInFlight.add(p);
  try { _bg(p); } catch (e) { /* nothing to hold it open: delivery is best effort, said in _bg */ }
}
let _pgRevLocal = 0;
async function _pgRevNext(env, kind, chainKey){
  /* No object at all: one instance, so the clock (kept rising) orders it. */
  if (!env.AMV_COUNTER) { _pgRevLocal = Math.max(_pgRevLocal + 1, Date.now() * 1000); return _pgRevLocal; }
  /* strict: an allocator that cannot be asked gives no revision - never the
     KV fallback's own count, which starts again at one (Nov 8 verified audit
     R11) and would lose to every revision already in Postgres, or win over
     newer ones. */
  try { const r = await counter(env, 'pgrev:' + chainKey, { op: 'incr', amount: 1, keep: true, strict: true }); const v = +((r && r.value) || 0); return v > 0 ? v : null; }
  catch (e) { return null; }
}
/* The mirror's rows and its revision, one transaction: applied only when
   this revision is newer than the newest that landed (or when there is no
   revision, from the backfill, which copies what KV holds now). Answers
   false when it was older and nothing was written. */
/* NO REVISION, NO WRITE (Nov 8 verified audit R12). A mirror with no
   revision skipped the guard and wrote whatever it held - over a newer row,
   when its allocator had failed. Every mirror now needs one: a live write,
   the write-through, the repair and the backfill all take the record's next
   revision BEFORE they read what to copy, so anything they copy is at least
   as new as every revision below theirs, and a newer write wins over them.
   Without one, nothing is written and the mirror fails onto the repair list. */
async function _pgGuarded(sql, kind, id, rev, fn){
  if (!(Number(rev) > 0)) throw new Error('mirror_revision_unavailable');
  return sql.begin(async (tx) => {
    const won = await tx`
        INSERT INTO mirror_revisions (kind, record_id, rev) VALUES (${kind}, ${id}, ${rev})
        ON CONFLICT (kind, record_id) DO UPDATE SET rev = EXCLUDED.rev, at = now()
          WHERE mirror_revisions.rev < EXCLUDED.rev
        RETURNING rev`;
    if (!won.length) return false;
    await fn(tx);
    return true;
  });
}
/* For tests and for the backfill: wait for every mirror write in flight. */
async function _pgSettle(){ while (_pgInFlight.size) await Promise.allSettled([..._pgInFlight]); }

const _pgTime = (ms) => (Number(ms) > 0 ? new Date(Number(ms)) : null);

/* `sqlIn`: the backfill passes the client it already holds, so a page of
   accounts is one connection, not three per account; it closes that itself. */
async function _pgMirror(env, kind, email, obj, sqlIn, rev){
  if (!email) return;
  const sql = sqlIn || await _pgClient(env);
  /* EVERY STATEMENT OF ONE MIRROR, OR NONE (Nov 8 audit DATA-041): an
     erasure is four statements and an account two; a failure between them
     left half of one in Postgres. Each mirror is one transaction now. */
  try {
    if (kind === 'acct') {
      return await _pgGuarded(sql, kind, email, rev, async (tx) => {
        if (!obj) {
          /* Erased: what hangs off the account goes first - whichever order the
             erasure deletes its records in, nothing is left pointing at a
             person - then a tombstone with nothing personal left on it. */
          await tx`DELETE FROM api_keys WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
          await tx`DELETE FROM memberships WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
          await tx`DELETE FROM entitlements WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
          await tx`UPDATE accounts SET email = 'erased-' || id || '@erased.invalid', name = '', pw_hash = NULL, pw_salt = NULL,
                     pw_algo = NULL, pw_iter = NULL, extra = '{}'::jsonb, deleted_at = now(), updated_at = now()
                    WHERE email = ${email}`;
          await tx`DELETE FROM migration_accounts WHERE email = ${email}`;
          return;
        }
        const { name, provider, pwHash, salt, pwIter, pwAlgo, createdAt, emailVerifiedAt, email: _e, ...extra } = obj;
        const rows = await tx`
          INSERT INTO accounts (email, name, provider, pw_hash, pw_salt, pw_algo, pw_iter, email_verified_at, created_at, extra, updated_at)
          VALUES (${email}, ${String(name || '')}, ${String(provider || 'email')}, ${pwHash || null}, ${salt || null},
                  ${pwHash ? String(pwAlgo || 'pbkdf2-sha256') : null}, ${pwIter ? Number(pwIter) : null},
                  ${_pgTime(emailVerifiedAt)}, ${_pgTime(createdAt) || new Date()}, ${tx.json(extra)}, now())
          ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, provider = EXCLUDED.provider, pw_hash = EXCLUDED.pw_hash,
            pw_salt = EXCLUDED.pw_salt, pw_algo = EXCLUDED.pw_algo, pw_iter = EXCLUDED.pw_iter,
            email_verified_at = EXCLUDED.email_verified_at, extra = EXCLUDED.extra, updated_at = now()
          RETURNING id`;
        const accountId = rows[0].id;
        await tx`INSERT INTO migration_accounts (email, account_id) VALUES (${email}, ${accountId})
                  ON CONFLICT (email) DO UPDATE SET account_id = EXCLUDED.account_id`;
      });
    }
    if (kind === 'team') {
      /* A member with no account row fails the whole transaction (Nov 8
         verified audit R13): it used to commit the team without them and
         report it afterwards, so Postgres held a membership list nobody
         wrote - a permission source missing a person. Nothing lands; the
         repair copies it once the account row exists. */
      await _pgGuarded(sql, kind, email, rev, async (tx) => {
        if (await _pgMirrorTeam(tx, email, obj)) throw new Error('member_without_account_row');
      });
      return;
    }
    if (kind === 'ent' || kind === 'apikeys') {
      const acct = await sql`SELECT id FROM accounts WHERE email = ${email}`;
      /* Deleting what an account no longer has a row for is already done. */
      if (!acct.length) { if (!obj) return; throw new Error('no_account_row'); }
      const accountId = acct[0].id;
      return await _pgGuarded(sql, kind, email, rev, async (tx) => {
        if (kind === 'apikeys') return _pgMirrorKeys(tx, accountId, obj);
        if (!obj) { await tx`DELETE FROM entitlements WHERE account_id = ${accountId}`; return; }
        const { plan, source, renewedAt, periodEnd, lapsedAt, blocked, blockedReason, customCfg, seats, updatedAt, ...extra } = obj;
        await tx`
          INSERT INTO entitlements (account_id, plan, seats, source, period_start, period_end, lapsed_at, blocked, blocked_reason, custom_cfg, extra, updated_at)
          VALUES (${accountId}, ${String(plan || 'free')}, ${seats ? Number(seats) : null}, ${String(source || 'none')},
                  ${_pgTime(renewedAt)}, ${_pgTime(periodEnd)}, ${_pgTime(lapsedAt)}, ${!!blocked}, ${blockedReason ? String(blockedReason) : null},
                  ${customCfg ? tx.json(customCfg) : null}, ${tx.json(extra)}, ${_pgTime(updatedAt) || new Date()})
          ON CONFLICT (account_id) WHERE account_id IS NOT NULL DO UPDATE SET plan = EXCLUDED.plan, seats = EXCLUDED.seats,
            source = EXCLUDED.source, period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
            lapsed_at = EXCLUDED.lapsed_at, blocked = EXCLUDED.blocked, blocked_reason = EXCLUDED.blocked_reason,
            custom_cfg = EXCLUDED.custom_cfg, extra = EXCLUDED.extra, updated_at = EXCLUDED.updated_at`;
      });
    }
  } finally {
    if (!sqlIn) { try { await sql.end({ timeout: 5 }); } catch(e) { /* cleanup: nothing depends on it */ } }
  }
}

/* A text[] as Postgres's own literal, every element quoted and escaped:
   the client runs without its type lookup (Hyperdrive), so arrays are sent
   as text and cast, never as a typed parameter it cannot resolve. */
function _pgTextArray(list){
  const xs = Array.isArray(list) ? list.map(v => String(v)) : [];
  return '{' + xs.map(v => '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + '}';
}
/* An account's API keys: one row per key, the hash only (the key itself is
   never stored anywhere). A revoked key keeps its row with when; a key gone
   from the record is gone from the table. */
async function _pgMirrorKeys(tx, accountId, obj){
  const items = (obj && Array.isArray(obj.items)) ? obj.items.filter(k => k && k.id && k.hash) : [];
  const ids = items.map(k => String(k.id));
  {
    if (ids.length) await tx`DELETE FROM api_keys WHERE account_id = ${accountId} AND id NOT IN ${tx(ids)}`;
    else await tx`DELETE FROM api_keys WHERE account_id = ${accountId}`;
    for (const k of items) {
      await tx`
        INSERT INTO api_keys (id, account_id, key_hash, name, scopes, created_at, last_used_at, revoked_at)
        VALUES (${String(k.id)}, ${accountId}, ${String(k.hash)}, ${String(k.name || 'API key')}, ${_pgTextArray(k.scopes)}::text[],
                ${_pgTime(k.created) || new Date()}, ${_pgTime(k.lastUsed)}, ${_pgTime(k.revoked)})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, scopes = EXCLUDED.scopes,
          last_used_at = EXCLUDED.last_used_at, revoked_at = EXCLUDED.revoked_at
          WHERE api_keys.account_id = EXCLUDED.account_id`;
    }
  }
}

/* A team: an organization of kind company, found by its KV id while both
   are written, and one membership per member. A member whose account has no
   row yet is not dropped: the whole team goes on the repair list, so the
   backfill writes it again once that account's row exists. */
async function _pgMirrorTeam(sql, teamId, obj){
  if (!obj) { await sql`DELETE FROM organizations WHERE legacy_id = ${teamId}`; return false; }
  const { id: _id, name, ownerEmail, members, createdAt, policy, ...extra } = obj;
  const owner = await sql`SELECT id FROM accounts WHERE email = ${String(ownerEmail || '').toLowerCase()}`;
  if (!owner.length) throw new Error('no_account_row');
  const list = Array.isArray(members) ? members.filter(m => m && m.email) : [];
  const emails = list.map(m => String(m.email).toLowerCase());
  const known = emails.length ? await sql`SELECT id, email FROM accounts WHERE email IN ${sql(emails)}` : [];
  const idOf = new Map(known.map(r => [r.email, r.id]));
  const ROLES = new Set(['owner', 'admin', 'member', 'viewer']);
  /* Run inside the mirror's own transaction (_pgGuarded). */
  const tx = sql;
  {
    const org = await tx`
      INSERT INTO organizations (name, kind, created_by, created_at, policy, legacy_id, extra)
      VALUES (${String(name || 'Team')}, 'company', ${owner[0].id}, ${_pgTime(createdAt) || new Date()},
              ${tx.json(policy && typeof policy === 'object' ? policy : {})}, ${teamId}, ${tx.json(extra)})
      ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name, policy = EXCLUDED.policy, extra = EXCLUDED.extra
      RETURNING id`;
    const orgId = org[0].id;
    const ids = list.map(m => idOf.get(String(m.email).toLowerCase())).filter(Boolean);
    if (ids.length) await tx`DELETE FROM memberships WHERE org_id = ${orgId} AND account_id NOT IN ${tx(ids)}`;
    else await tx`DELETE FROM memberships WHERE org_id = ${orgId}`;
    for (const m of list) {
      const aid = idOf.get(String(m.email).toLowerCase());
      if (!aid) continue;
      const role = ROLES.has(m.role) ? m.role : 'member';
      await tx`
        INSERT INTO memberships (org_id, account_id, role, source, monthly_cap, joined_at)
        VALUES (${orgId}, ${aid}, ${role}, ${String(m.source || 'invite')}, ${m.monthlyCap != null ? Number(m.monthlyCap) : null}, ${_pgTime(m.joinedAt) || new Date()})
        ON CONFLICT (org_id, account_id) DO UPDATE SET role = EXCLUDED.role, monthly_cap = EXCLUDED.monthly_cap`;
    }
  }
  /* Committed as far as it can go; the caller then lists it for repair. */
  return emails.some(e => !idOf.has(e));
}

/* ── MONEY: one row per event, never a number that is overwritten ─────────
   A pack bought, and each part of one taken back by a refund or a dispute,
   is appended to credit_ledger under a key made from the payment's own id,
   so the same event delivered twice is one row (the UNIQUE key), not two.
   A row that could not be written is kept whole on the repair list, so the
   backfill writes exactly that row - never one recomputed later. */
/* WRITTEN DOWN BEFORE IT IS SENT (Nov 8 audit DATA-032). The row went
   straight to a background insert, so an isolate that ended first left it
   nowhere - not in Postgres and not on the repair list. The exact row is
   now kept on the repair list first, awaited by the caller, and taken off
   once Postgres has it; a row the backfill finds there and Postgres already
   holds is the same key and the same money, so writing it again is a no-op. */
async function _pgLedger(env, row){
  if (!_pgOn(env) || !row || !row.key || !row.email || !(Math.abs(+row.amount) > 0)) return;
  const rk = 'pgrepair:ledger:' + row.key;
  try { await env.AMV_KV.put(rk, JSON.stringify({ at: Date.now(), why: 'pending', row })); }
  catch (e) {
    try { audit(env, 'pg_ledger_unrecorded', { id: row.key }); } catch(_) { /* logging: it never decides anything */ }
    try { await alertOnce(env, 'pg_ledger_unrecorded', 'A money row could not be put on the Postgres repair list before it was sent. KV and the counters are still the record; run the backfill before money reads move to Postgres.', 60); } catch(_) { /* logging */ }
  }
  const p = (async () => {
    const sql = await _pgClient(env);
    try { await _pgLedgerInsert(sql, row); }
    finally { try { await sql.end({ timeout: 5 }); } catch(e) { /* cleanup: nothing depends on it */ } }
    try { await env.AMV_KV.delete(rk); } catch(e) { /* the backfill finds the row already there: the same key, a no-op */ }
  })().catch(async (e) => {
    const why = String((e && e.message) || e).slice(0, 160);
    try { audit(env, 'pg_mirror_failed', { kind: 'ledger', id: row.key, error: why }); } catch(_) { /* logging: it never decides anything */ }
    try { await env.AMV_KV.put('pgrepair:ledger:' + row.key, JSON.stringify({ at: Date.now(), why, row })); } catch(_) { /* the intent stays and the cron turns it into a repair */ }
    try { await alertOnce(env, 'pg_mirror_failed', 'A money row could not be written to the Postgres ledger (' + why + '). KV and the counters are still the record; the exact row is kept for the backfill.', 60); } catch (_) { /* logging: it never decides anything */ }
  }).finally(() => _pgInFlight.delete(p));
  _pgInFlight.add(p);
  try { _bg(p); } catch (e) { /* nothing to hold it open: delivery is best effort, said in _bg */ }
}

/* The one INSERT for a ledger row, live and in the backfill alike: a row
   whose key is already there is the same event, and is left as it was. */
/* What a money row must be before it is sent (Nov 3 audit DATA-017): a
   finite, bounded amount in a three-letter currency, written as an exact
   decimal string - never a float the database would have to round. Seller
   money is whole cents. The database refuses the same things on its own
   (migrations/postgres/0002_money_constraints.sql). */
function _pgMoneyAmount(row){
  const a = Number(row.amount);
  if (!Number.isFinite(a) || Math.abs(a) >= 1e9) throw new Error('money_amount_invalid');
  const cur = String(row.currency || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) throw new Error('money_currency_invalid');
  /* Seller money is whole minor units OF ITS CURRENCY (Nov 7 audit DATA-033):
     cents for dollars, whole yen, thousandths of a dinar - not always cents. */
  if (row.table === 'seller') {
    const d = _minorDigits(cur), f = Math.pow(10, d);
    const units = Math.round(a * f);
    if (Math.abs(units / f - a) > 1e-9) throw new Error('money_not_whole_cents');
    return { currency: cur, amount: (units / f).toFixed(d) };
  }
  return { currency: cur, amount: a.toFixed(6) };
}
/* THE SAME KEY HAS TO BE THE SAME MONEY (Nov 7 audit DATA-034, FIN-024).
   A row whose key was already there was taken as "already written" without
   looking - so a second event that reused a key for a different amount,
   account or currency was silently dropped, and the ledger disagreed with
   what happened. A key already present is now read back and compared on
   what makes the row money; a different payload under the same key is a
   conflict that is refused (and so repaired or reported), never absorbed. */
async function _pgLedgerInsert(sql, row){
  const money = _pgMoneyAmount(row);
  const acct = await sql`SELECT id FROM accounts WHERE email = ${String(row.email).toLowerCase()}`;
  if (!acct.length) throw new Error('no_account_row');
  let made;
  if (row.table === 'seller') {
    made = await sql`
      INSERT INTO seller_ledger (account_id, currency, amount, reason, idempotency_key, hold_until, at)
      VALUES (${acct[0].id}, ${money.currency}, ${money.amount},
              ${row.reason}, ${row.key}, ${_pgTime(row.holdUntil)}, ${_pgTime(row.at) || new Date()})
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING idempotency_key`;
  } else {
    made = await sql`
      INSERT INTO credit_ledger (account_id, currency, amount, reason, idempotency_key, source_event, at, note)
      VALUES (${acct[0].id}, ${money.currency}, ${money.amount},
              ${row.reason}, ${row.key}, ${row.source || null}, ${_pgTime(row.at) || new Date()}, ${row.note || null})
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING idempotency_key`;
  }
  if (made && made.length) return;
  /* Every field that makes it this money (Nov 8 audit DATA-042): the event
     it came from for a credit, and when it may be paid for a seller - not
     only account, currency, amount and reason. */
  const was = row.table === 'seller'
    ? await sql`SELECT account_id, currency, amount::text AS amount, reason, hold_until FROM seller_ledger WHERE idempotency_key = ${row.key}`
    : await sql`SELECT account_id, currency, amount::text AS amount, reason, source_event FROM credit_ledger WHERE idempotency_key = ${row.key}`;
  const w = was && was[0];
  const tms = (v) => (v == null ? null : +new Date(v));
  const same = !!w && String(w.account_id) === String(acct[0].id) && w.currency === money.currency
    && Number(w.amount) === Number(money.amount) && String(w.reason) === String(row.reason)
    && (row.table === 'seller'
      ? tms(w.hold_until) === tms(_pgTime(row.holdUntil))
      : String(w.source_event == null ? '' : w.source_event) === String(row.source || ''));
  if (!same) throw new Error('ledger_key_conflict');
}

/* A seller's money line (_pushWalletTx), as a seller_ledger row. Only lines
   that move money: a payout marked paid moves none (the money left when it
   was requested). The key is what makes the line unique - the sale's
   reference and item, or the withdrawal's id - so a retry is one row. */
const PG_SELLER_REASON = { sale: 'sale', sale_reversed: 'reversal', withdrawal: 'payout', withdrawal_returned: 'correction' };
/* The row a line becomes, or null for a line that moves no money; a line
   that moves money but has no identity is `{ unkeyed: true }`, because a row
   without a key could not be written once and only once. */
function _pgSellerLedgerRow(email, tx){
  if (!tx || !PG_SELLER_REASON[tx.type] || !(Math.abs(+tx.amount) > 0)) return null;
  const id = tx.ref ? tx.ref + ':' + (tx.item || '') : (tx.id || '');
  if (!id) return { unkeyed: true };
  return { table: 'seller', email, currency: tx.currency || 'USD', amount: +tx.amount, reason: PG_SELLER_REASON[tx.type],
    key: 'seller:' + tx.type + ':' + id, at: tx.ts, holdUntil: tx.holdUntil };
}
async function _pgSellerRow(env, email, tx){
  const row = _pgSellerLedgerRow(email, tx);
  if (!row) return;
  if (row.unkeyed) { try { audit(env, 'pg_mirror_failed', { kind: 'seller', id: email, error: 'line_without_identity:' + tx.type }); } catch(e) { /* logging: it never decides anything */ } return; }
  await _pgLedger(env, row);
}
