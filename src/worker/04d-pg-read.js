/* ══════════════════════════════════════════════════════════════════════════
   THE CONTROL PLANE IN POSTGRES: STEP 5, POSTGRES ANSWERS (Oct 31 audit, item
   13; owner approval Nov 1; docs/DATA-TIER.md).

   For the accounts in the read cohort - the `PG_READ` variable, the same
   shape as PG_SHADOW: addresses and/or a share, like `amv@amv.homes,5%` - an
   account record and a plan are answered FROM POSTGRES. Everybody else, and
   API keys for everybody, are answered by KV exactly as before.

   It is built so that Postgres can only answer where it has PROVED it gives
   the answer KV would:

     - WRITES GO THROUGH FIRST. For an account in the cohort, a write of its
       account or plan reaches Postgres before the request goes on, instead
       of in the background - so the next read, on any instance, sees it. A
       write that does not reach Postgres marks the record stale
       (`pgstale:<kind>:<email>`) before returning, and a stale record is
       answered by KV.
     - EVERY ANSWER IS CHECKED. After Postgres answers, the same record is
       read from KV in the background and compared field by field. A
       difference marks the record stale (KV answers from then on), is counted
       and audited, and the owner is alerted. A stale record whose two copies
       agree again is unmarked - so a repaired row goes back to Postgres on
       its own.
     - ANY FAILURE FALLS BACK. Postgres unreachable, a query error, a row
       that cannot be turned back into the record: KV answers, and it is
       counted. Nobody is refused because the new store had a bad minute.

   So the step's check is a number, at GET /admin/pg/shadow: reads Postgres
   answered, reads that fell back, and answers that differed. A clean week at
   100% is what step 6 (Postgres alone) waits for; until then KV is still
   written for everybody and is still the record of truth.

   API keys are not moved here: their record carries fields the key table
   does not hold, so a key read from Postgres could not be the same record.
   They stay on KV until the table holds them whole. */

const PG_READ_KINDS = new Set(['acct', 'ent']);
const PG_READ_STALE_TTL_S = 30 * 86400;
const PG_READ_RECHECK_MS = 60000;
const _pgReadChecked = new Map();
let _pgReadCohortCache = { raw: null, emails: new Set(), basisPoints: 0 };

function _pgReadCohort(env){
  const raw = String((env && env.PG_READ) || '');
  if (_pgReadCohortCache.raw === raw) return _pgReadCohortCache;
  const emails = new Set(); let basisPoints = 0;
  for (const part of raw.split(',').map(x => x.trim()).filter(Boolean)) {
    const pct = /^(\d+(?:\.\d+)?)%$/.exec(part);
    if (pct) basisPoints = Math.max(0, Math.min(10000, Math.round(parseFloat(pct[1]) * 100)));
    else if (part.includes('@')) emails.add(part.toLowerCase());
  }
  _pgReadCohortCache = { raw, emails, basisPoints };
  return _pgReadCohortCache;
}
/* The same hash as the shadow cohort's, so 5% read is a subset of 5% shadow
   when both are set: the people answered from Postgres were compared first. */
async function _pgReadIn(env, email){
  const c = _pgReadCohort(env);
  if (c.emails.has(email)) return true;
  if (!c.basisPoints) return false;
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email)));
  return (((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0) % 10000 < c.basisPoints;
}
function _pgReadApplies(env, kind, id){
  if (!env || !env.PG_READ || !PG_READ_KINDS.has(kind) || !_pgOn(env) || DB._hasD1(env)) return '';
  const email = String(id || '').toLowerCase();
  return email.includes('@') ? email : '';
}

/* A row turned back into the record KV holds: every column under the name
   the record uses, the rest from `extra`, and nothing for a column that is
   empty - a record that never had a field must not gain one. */
const _pgMs = (t) => (t == null ? undefined : new Date(t).getTime());
function _pgDrop(o){ for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k]; return o; }
function _pgAcctFromRow(r){
  return _pgDrop({ ...(r.extra || {}), email: r.email, name: r.name, provider: r.provider, pwHash: r.pw_hash, salt: r.pw_salt,
    pwIter: r.pw_iter, pwAlgo: r.pw_algo, createdAt: _pgMs(r.created_at), emailVerifiedAt: _pgMs(r.email_verified_at) });
}
function _pgEntFromRow(r){
  return _pgDrop({ ...(r.extra || {}), plan: r.plan, seats: r.seats, source: r.source, renewedAt: _pgMs(r.period_start),
    periodEnd: _pgMs(r.period_end), lapsedAt: _pgMs(r.lapsed_at), blocked: r.blocked ? true : undefined,
    blockedReason: r.blocked_reason, customCfg: r.custom_cfg, updatedAt: _pgMs(r.updated_at) });
}
/* What two copies are compared as: keys sorted, empty values gone, and the
   few values the table fills in by default (an empty name, the hash's
   algorithm name, a plan's "none" source and "free" plan, not blocked)
   treated as the absence they stand for. Nothing else is forgiven. */
function _pgCanon(kind, o){
  if (!o) return 'null';
  const c = JSON.parse(JSON.stringify(o));
  _pgDrop(c);
  if (kind === 'acct') { if (c.name === '') delete c.name; if (c.pwAlgo === 'pbkdf2-sha256') delete c.pwAlgo; }
  if (kind === 'ent') { if (c.source === 'none') delete c.source; if (c.plan === 'free') delete c.plan; if (c.blocked === false) delete c.blocked; }
  const sort = (v) => Array.isArray(v) ? v.map(sort) : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((a, k) => (a[k] = sort(v[k]), a), {}) : v;
  return JSON.stringify(sort(c));
}
async function _pgReadRow(sql, kind, email){
  if (kind === 'acct') {
    const a = await sql`SELECT email, name, provider, pw_hash, pw_salt, pw_iter, pw_algo, created_at, email_verified_at, extra
                        FROM accounts WHERE email = ${email} AND deleted_at IS NULL`;
    return a.length ? _pgAcctFromRow(a[0]) : null;
  }
  const e = await sql`SELECT e.plan, e.seats, e.source, e.period_start, e.period_end, e.lapsed_at, e.blocked, e.blocked_reason, e.custom_cfg, e.extra, e.updated_at
                      FROM entitlements e JOIN accounts a ON a.id = e.account_id WHERE a.email = ${email} AND a.deleted_at IS NULL`;
  return e.length ? _pgEntFromRow(e[0]) : null;
}
const _pgStaleKey = (kind, email) => 'pgstale:' + kind + ':' + email;
async function _pgReadTally(env, what, email){
  try { await _tallyAdd(env, 'pgread:' + todayKey() + ':' + what, email, 1, 40 * 86400000); } catch (e) {}
}

/* Called by DB.get / DB.getStrict before KV. Returns the record's text when
   Postgres answers, or undefined for "ask KV" - never throws. */
async function _pgReadServe(env, kind, id){
  const email = _pgReadApplies(env, kind, id);
  if (!email || !(await _pgReadIn(env, email))) return undefined;
  let stale = false;
  try { stale = !!(await env.AMV_KV.get(_pgStaleKey(kind, email))); } catch (e) { return undefined; }
  if (stale) { _pgReadVerify(env, kind, email, null, true); return undefined; }
  let value;
  let sql;
  try {
    sql = await _pgClient(env);
    value = await _pgReadRow(sql, kind, email);
  } catch (e) {
    try { audit(env, 'pg_read_fell_back', { kind, id: email, error: String((e && e.message) || e).slice(0, 160) }); } catch (_) {}
    await _pgReadTally(env, 'fellback', email);
    return undefined;
  } finally {
    if (sql) { try { await sql.end({ timeout: 5 }); } catch (e) {} }
  }
  await _pgReadTally(env, 'served', email);
  const raw = value == null ? null : JSON.stringify(value);
  _pgReadVerify(env, kind, email, raw, false);
  return raw;
}

/* The background check of an answer Postgres gave (or, for a stale record,
   whether it may answer again). Rate-limited per record per instance, except
   that a served answer is always checked the first time. */
function _pgReadVerify(env, kind, email, servedRaw, wasStale){
  const key = kind + ':' + email, now = Date.now();
  if (now - (_pgReadChecked.get(key) || 0) < PG_READ_RECHECK_MS) return;
  if (_pgReadChecked.size > 5000) _pgReadChecked.clear();
  _pgReadChecked.set(key, now);
  const p = (async () => {
    let kvRaw = null;
    try { kvRaw = await env.AMV_KV.get(kind + ':' + email); } catch (e) { return; }
    let kvVal = null; try { kvVal = kvRaw ? JSON.parse(kvRaw) : null; } catch (e) { return; }
    let pgVal;
    if (wasStale) {
      const sql = await _pgClient(env);
      try { pgVal = await _pgReadRow(sql, kind, email); } finally { try { await sql.end({ timeout: 5 }); } catch (e) {} }
    } else pgVal = servedRaw ? JSON.parse(servedRaw) : null;
    const same = _pgCanon(kind, pgVal) === _pgCanon(kind, kvVal);
    if (wasStale) {
      if (same) { await env.AMV_KV.delete(_pgStaleKey(kind, email)); try { audit(env, 'pg_read_unstale', { kind, id: email }); } catch (e) {} }
      return;
    }
    if (same) return;
    await env.AMV_KV.put(_pgStaleKey(kind, email), JSON.stringify({ at: Date.now(), why: 'differed' }), { expirationTtl: PG_READ_STALE_TTL_S });
    await _pgReadTally(env, 'differed', email);
    try { audit(env, 'pg_read_differed', { kind, id: email }); } catch (e) {}
    try { await alertOnce(env, 'pg_read_differed',
      'Postgres answered an ' + kind + ' read differently from KV. That record is now answered by KV again, and the step must not '
      + 'grow until every difference is explained. GET /admin/pg/shadow counts them.', 60); } catch (e) {}
  })().catch((e) => { try { audit(env, 'pg_read_verify_failed', { kind, id: email, error: String((e && e.message) || e).slice(0, 160) }); } catch (_) {} })
    .finally(() => _pgInFlight.delete(p));
  _pgInFlight.add(p);
  try { _bg(p); } catch (e) {}
}

/* Called by DB.put / DB.del after KV has the write, INSTEAD of the background
   mirror, for a record Postgres answers: the write reaches Postgres before
   the request goes on, or the record is marked stale before it does. */
async function _pgWriteThrough(env, kind, id, obj){
  const email = _pgReadApplies(env, kind, id);
  if (!email || !(await _pgReadIn(env, email))) return false;
  try {
    await _pgMirror(env, kind, email, obj);
  } catch (e) {
    const why = String((e && e.message) || e).slice(0, 160);
    try { await env.AMV_KV.put(_pgStaleKey(kind, email), JSON.stringify({ at: Date.now(), why }), { expirationTtl: PG_READ_STALE_TTL_S }); } catch (_) {}
    try { await env.AMV_KV.put('pgrepair:' + kind + ':' + email, JSON.stringify({ at: Date.now(), why }), { expirationTtl: PG_REPAIR_TTL_S }); } catch (_) {}
    try { audit(env, 'pg_write_through_failed', { kind, id: email, error: why }); } catch (_) {}
  }
  return true;
}
