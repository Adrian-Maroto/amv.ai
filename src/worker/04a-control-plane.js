
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
  try { await env.AMV_KV.put(k, JSON.stringify({ at: Date.now() }), { expirationTtl: 7 * 86400 }); return k; }
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
function _pgAfter(env, kind, id, obj, ik){
  if (!PG_MIRROR_KINDS.has(kind) || !_pgOn(env)) return;
  const p = _pgMirror(env, kind, String(id || '').toLowerCase(), obj)
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
/* For tests and for the backfill: wait for every mirror write in flight. */
async function _pgSettle(){ while (_pgInFlight.size) await Promise.allSettled([..._pgInFlight]); }

const _pgTime = (ms) => (Number(ms) > 0 ? new Date(Number(ms)) : null);

/* `sqlIn`: the backfill passes the client it already holds, so a page of
   accounts is one connection, not three per account; it closes that itself. */
async function _pgMirror(env, kind, email, obj, sqlIn){
  if (!email) return;
  const sql = sqlIn || await _pgClient(env);
  try {
    if (kind === 'acct') {
      if (!obj) {
        /* Erased: what hangs off the account goes first - whichever order the
           erasure deletes its records in, nothing is left pointing at a
           person - then a tombstone with nothing personal left on it. */
        await sql`DELETE FROM api_keys WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
        await sql`DELETE FROM memberships WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
        await sql`DELETE FROM entitlements WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
        await sql`UPDATE accounts SET email = 'erased-' || id || '@erased.invalid', name = '', pw_hash = NULL, pw_salt = NULL,
                   pw_algo = NULL, pw_iter = NULL, extra = '{}'::jsonb, deleted_at = now(), updated_at = now()
                  WHERE email = ${email}`;
        await sql`DELETE FROM migration_accounts WHERE email = ${email}`;
        return;
      }
      const { name, provider, pwHash, salt, pwIter, pwAlgo, createdAt, emailVerifiedAt, email: _e, ...extra } = obj;
      const rows = await sql`
        INSERT INTO accounts (email, name, provider, pw_hash, pw_salt, pw_algo, pw_iter, email_verified_at, created_at, extra, updated_at)
        VALUES (${email}, ${String(name || '')}, ${String(provider || 'email')}, ${pwHash || null}, ${salt || null},
                ${pwHash ? String(pwAlgo || 'pbkdf2-sha256') : null}, ${pwIter ? Number(pwIter) : null},
                ${_pgTime(emailVerifiedAt)}, ${_pgTime(createdAt) || new Date()}, ${sql.json(extra)}, now())
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, provider = EXCLUDED.provider, pw_hash = EXCLUDED.pw_hash,
          pw_salt = EXCLUDED.pw_salt, pw_algo = EXCLUDED.pw_algo, pw_iter = EXCLUDED.pw_iter,
          email_verified_at = EXCLUDED.email_verified_at, extra = EXCLUDED.extra, updated_at = now()
        RETURNING id`;
      const accountId = rows[0].id;
      await sql`INSERT INTO migration_accounts (email, account_id) VALUES (${email}, ${accountId})
                ON CONFLICT (email) DO UPDATE SET account_id = EXCLUDED.account_id`;
      return;
    }
    if (kind === 'team') return await _pgMirrorTeam(sql, email, obj);
    if (kind === 'ent' || kind === 'apikeys') {
      const acct = await sql`SELECT id FROM accounts WHERE email = ${email}`;
      /* Deleting what an account no longer has a row for is already done. */
      if (!acct.length) { if (!obj) return; throw new Error('no_account_row'); }
      const accountId = acct[0].id;
      if (kind === 'apikeys') return await _pgMirrorKeys(sql, accountId, obj);  // awaited: the finally below closes the client
      if (!obj) { await sql`DELETE FROM entitlements WHERE account_id = ${accountId}`; return; }
      const { plan, source, renewedAt, periodEnd, lapsedAt, blocked, blockedReason, customCfg, seats, updatedAt, ...extra } = obj;
      await sql`
        INSERT INTO entitlements (account_id, plan, seats, source, period_start, period_end, lapsed_at, blocked, blocked_reason, custom_cfg, extra, updated_at)
        VALUES (${accountId}, ${String(plan || 'free')}, ${seats ? Number(seats) : null}, ${String(source || 'none')},
                ${_pgTime(renewedAt)}, ${_pgTime(periodEnd)}, ${_pgTime(lapsedAt)}, ${!!blocked}, ${blockedReason ? String(blockedReason) : null},
                ${customCfg ? sql.json(customCfg) : null}, ${sql.json(extra)}, ${_pgTime(updatedAt) || new Date()})
        ON CONFLICT (account_id) WHERE account_id IS NOT NULL DO UPDATE SET plan = EXCLUDED.plan, seats = EXCLUDED.seats,
          source = EXCLUDED.source, period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
          lapsed_at = EXCLUDED.lapsed_at, blocked = EXCLUDED.blocked, blocked_reason = EXCLUDED.blocked_reason,
          custom_cfg = EXCLUDED.custom_cfg, extra = EXCLUDED.extra, updated_at = EXCLUDED.updated_at`;
      return;
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
async function _pgMirrorKeys(sql, accountId, obj){
  const items = (obj && Array.isArray(obj.items)) ? obj.items.filter(k => k && k.id && k.hash) : [];
  const ids = items.map(k => String(k.id));
  await sql.begin(async (tx) => {
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
  });
}

/* A team: an organization of kind company, found by its KV id while both
   are written, and one membership per member. A member whose account has no
   row yet is not dropped: the whole team goes on the repair list, so the
   backfill writes it again once that account's row exists. */
async function _pgMirrorTeam(sql, teamId, obj){
  if (!obj) { await sql`DELETE FROM organizations WHERE legacy_id = ${teamId}`; return; }
  const { id: _id, name, ownerEmail, members, createdAt, policy, ...extra } = obj;
  const owner = await sql`SELECT id FROM accounts WHERE email = ${String(ownerEmail || '').toLowerCase()}`;
  if (!owner.length) throw new Error('no_account_row');
  const list = Array.isArray(members) ? members.filter(m => m && m.email) : [];
  const emails = list.map(m => String(m.email).toLowerCase());
  const known = emails.length ? await sql`SELECT id, email FROM accounts WHERE email IN ${sql(emails)}` : [];
  const idOf = new Map(known.map(r => [r.email, r.id]));
  const ROLES = new Set(['owner', 'admin', 'member', 'viewer']);
  await sql.begin(async (tx) => {
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
  });
  if (emails.some(e => !idOf.has(e))) throw new Error('member_without_account_row');
}

/* ── MONEY: one row per event, never a number that is overwritten ─────────
   A pack bought, and each part of one taken back by a refund or a dispute,
   is appended to credit_ledger under a key made from the payment's own id,
   so the same event delivered twice is one row (the UNIQUE key), not two.
   A row that could not be written is kept whole on the repair list, so the
   backfill writes exactly that row - never one recomputed later. */
function _pgLedger(env, row){
  if (!_pgOn(env) || !row || !row.key || !row.email || !(Math.abs(+row.amount) > 0)) return;
  const p = (async () => {
    const sql = await _pgClient(env);
    try { return await _pgLedgerInsert(sql, row); }
    finally { try { await sql.end({ timeout: 5 }); } catch(e) { /* cleanup: nothing depends on it */ } }
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
  if (row.table === 'seller') {
    const cents = Math.round(a * 100);
    if (Math.abs(cents / 100 - a) > 1e-9) throw new Error('money_not_whole_cents');
    return { currency: cur, amount: (cents / 100).toFixed(2) };
  }
  return { currency: cur, amount: a.toFixed(6) };
}
async function _pgLedgerInsert(sql, row){
  const money = _pgMoneyAmount(row);
  const acct = await sql`SELECT id FROM accounts WHERE email = ${String(row.email).toLowerCase()}`;
  if (!acct.length) throw new Error('no_account_row');
  if (row.table === 'seller') {
    await sql`
      INSERT INTO seller_ledger (account_id, currency, amount, reason, idempotency_key, hold_until, at)
      VALUES (${acct[0].id}, ${money.currency}, ${money.amount},
              ${row.reason}, ${row.key}, ${_pgTime(row.holdUntil)}, ${_pgTime(row.at) || new Date()})
      ON CONFLICT (idempotency_key) DO NOTHING`;
    return;
  }
  await sql`
    INSERT INTO credit_ledger (account_id, currency, amount, reason, idempotency_key, source_event, at, note)
    VALUES (${acct[0].id}, ${money.currency}, ${money.amount},
            ${row.reason}, ${row.key}, ${row.source || null}, ${_pgTime(row.at) || new Date()}, ${row.note || null})
    ON CONFLICT (idempotency_key) DO NOTHING`;
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
function _pgSellerRow(env, email, tx){
  const row = _pgSellerLedgerRow(email, tx);
  if (!row) return;
  if (row.unkeyed) { try { audit(env, 'pg_mirror_failed', { kind: 'seller', id: email, error: 'line_without_identity:' + tx.type }); } catch(e) { /* logging: it never decides anything */ } return; }
  _pgLedger(env, row);
}
