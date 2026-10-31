
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

const PG_MIRROR_KINDS = new Set(['acct', 'ent', 'apikeys']);
const PG_REPAIR_TTL_S = 30 * 86400;
const _pgInFlight = new Set();

function _pgOn(env){
  return !!(env && env.PG && typeof env.PG.connectionString === 'string' && env.PG.connectionString.length > 10);
}

async function _pgClient(env){
  const mod = await import('postgres');
  const postgres = mod.default || mod;
  return postgres(env.PG.connectionString, { max: 1, fetch_types: false, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} });
}

/* Called by DB.put / DB.del after KV has the write. Never throws, never
   blocks the caller: it runs in the background of the request. */
function _pgAfter(env, kind, id, obj){
  if (!PG_MIRROR_KINDS.has(kind) || !_pgOn(env)) return;
  const p = _pgMirror(env, kind, String(id || '').toLowerCase(), obj)
    .catch(async (e) => {
      const why = String((e && e.message) || e).slice(0, 160);
      try { audit(env, 'pg_mirror_failed', { kind, id, error: why }); } catch (_) {}
      try { await env.AMV_KV.put('pgrepair:' + kind + ':' + String(id || '').toLowerCase(), JSON.stringify({ at: Date.now(), why }), { expirationTtl: PG_REPAIR_TTL_S }); } catch (_) {}
      try { await alertOnce(env, 'pg_mirror_failed',
        'Writes to the Postgres control plane are failing (' + kind + ': ' + why + '). Nothing has gone wrong for anybody - KV is still the record - '
        + 'and each one is listed for the backfill to repair. The migration must not move past step 2 until this is zero.', 60); } catch (_) {}
    })
    .finally(() => _pgInFlight.delete(p));
  _pgInFlight.add(p);
  try { _bg(p); } catch (e) {}
}
/* For tests and for the backfill: wait for every mirror write in flight. */
async function _pgSettle(){ while (_pgInFlight.size) await Promise.allSettled([..._pgInFlight]); }

const _pgTime = (ms) => (Number(ms) > 0 ? new Date(Number(ms)) : null);

async function _pgMirror(env, kind, email, obj){
  if (!email) return;
  const sql = await _pgClient(env);
  try {
    if (kind === 'acct') {
      if (!obj) {
        /* Erased: what hangs off the account goes first - whichever order the
           erasure deletes its records in, nothing is left pointing at a
           person - then a tombstone with nothing personal left on it. */
        await sql`DELETE FROM api_keys WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
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
    try { await sql.end({ timeout: 5 }); } catch (e) {}
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
