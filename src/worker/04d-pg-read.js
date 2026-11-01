/* ══════════════════════════════════════════════════════════════════════════
   THE CONTROL PLANE IN POSTGRES: STEP 5, POSTGRES ANSWERS (Oct 31 audit, item
   13; owner approval Nov 1; docs/DATA-TIER.md).

   For the accounts in the read cohort - the `PG_READ` variable, the same
   shape as PG_SHADOW: addresses and/or a share, like `amv@amv.homes,5%` - an
   account record and a plan are answered FROM POSTGRES. Everybody else, and
   API keys for everybody, are answered by KV exactly as before.

   It is built so that Postgres can only answer where it has PROVED it gives
   the answer KV would - see "PROVED, OR NOT SERVED" below: a row answers only
   if it matches a proof written after the two copies were compared (or after
   a write-through read its own row back), a write removes the proof before KV
   changes, and any failure means KV answers. Postgres unreachable: KV
   answers, and it is counted. Nobody is refused because the new store had a
   bad minute.

   So the step's check is a number, at GET /admin/pg/shadow: reads Postgres
   answered, reads that fell back, and answers that differed. A clean week at
   100% is what step 6 (Postgres alone) waits for; until then KV is still
   written for everybody and is still the record of truth.

   API keys are not moved here: their record carries fields the key table
   does not hold, so a key read from Postgres could not be the same record.
   They stay on KV until the table holds them whole. */

const PG_READ_KINDS = new Set(['acct', 'ent']);
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
/* PROVED, OR NOT SERVED (Nov 1 audit DATA-001/002/003).

   The first version of this step answered from Postgres and then checked the
   answer against KV in the background - so a row that was wrong was wrong
   for one real request before anything noticed. Now a row may answer only
   if it matches a PROOF: `pgok:<kind>:<email>`, a digest of the record in the
   form both copies were compared in, written only after the two copies were
   compared and found the same (or after a write-through that read its own
   row back). With no proof, KV answers and the comparison runs in the
   background; a row that does not match its proof is not served, and the
   proof is removed. So:
     - a failed comparison leaves no proof, and KV answers (DATA-002);
     - a failed write leaves no proof, and KV answers (DATA-003) - the proof
       is removed BEFORE KV is written, and if that removal fails, so does
       the write;
     - a row changed by anything but a proved write no longer matches its
       proof, and is never served unverified (DATA-001).
   The proof has no expiry: a record is proved until a write removes it. */
const _pgOkKey = (kind, email) => 'pgok:' + kind + ':' + email;
async function _pgProofOf(kind, value){ return (await _pgDigest(_pgCanon(kind, value))).slice(0, 40); }
async function _pgReadTally(env, what, email){
  try { await _tallyAdd(env, 'pgread:' + todayKey() + ':' + what, email, 1, 40 * 86400000); } catch (e) {}
}

/* Called by DB.get / DB.getStrict before KV. Returns the record's text when
   a proved Postgres row answers, or undefined for "ask KV" - never throws. */
async function _pgReadServe(env, kind, id){
  const email = _pgReadApplies(env, kind, id);
  if (!email || !(await _pgReadIn(env, email))) return undefined;
  let proof = null;
  try { proof = await env.AMV_KV.get(_pgOkKey(kind, email)); } catch (e) { return undefined; }
  if (!proof) { _pgReadVerify(env, kind, email); await _pgReadTally(env, 'unproved', email); return undefined; }
  let value, sql;
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
  if ((await _pgProofOf(kind, value)) !== proof) {
    /* The row is not the one that was proved. Not served; proof gone; KV
       answers; the comparison says whether it was Postgres or KV that moved. */
    try { await env.AMV_KV.delete(_pgOkKey(kind, email)); } catch (e) {}
    await _pgReadTally(env, 'differed', email);
    try { audit(env, 'pg_read_unproved_row', { kind, id: email }); } catch (e) {}
    _pgReadVerify(env, kind, email);
    return undefined;
  }
  await _pgReadTally(env, 'served', email);
  return value == null ? null : JSON.stringify(value);
}

/* The comparison: both copies read, compared in canonical form, and the proof
   written only when they are the same. Rate-limited per record per instance.
   Any failure - a store that does not answer, a record that does not parse -
   leaves no proof, which means KV keeps answering. */
function _pgReadVerify(env, kind, email){
  const key = kind + ':' + email, now = Date.now();
  if (now - (_pgReadChecked.get(key) || 0) < PG_READ_RECHECK_MS) return;
  if (_pgReadChecked.size > 5000) _pgReadChecked.clear();
  _pgReadChecked.set(key, now);
  const p = (async () => {
    const kvRaw = await env.AMV_KV.get(kind + ':' + email);
    const kvVal = kvRaw ? JSON.parse(kvRaw) : null;
    const sql = await _pgClient(env);
    let pgVal;
    try { pgVal = await _pgReadRow(sql, kind, email); } finally { try { await sql.end({ timeout: 5 }); } catch (e) {} }
    if (_pgCanon(kind, pgVal) === _pgCanon(kind, kvVal)) {
      /* Re-read KV: a write that landed during the comparison removed the
         proof it would otherwise be written over. */
      const again = await env.AMV_KV.get(kind + ':' + email);
      if (again !== kvRaw) return;
      await env.AMV_KV.put(_pgOkKey(kind, email), await _pgProofOf(kind, pgVal));
      return;
    }
    await _pgReadTally(env, 'differed', email);
    try { audit(env, 'pg_read_differed', { kind, id: email }); } catch (e) {}
    try { await alertOnce(env, 'pg_read_differed',
      'Postgres holds an ' + kind + ' record that differs from KV. KV is answering for it, and the step must not grow until every '
      + 'difference is explained. GET /admin/pg/shadow counts them.', 60); } catch (e) {}
  })().catch((e) => { try { audit(env, 'pg_read_verify_failed', { kind, id: email, error: String((e && e.message) || e).slice(0, 160) }); } catch (_) {} })
    .finally(() => _pgInFlight.delete(p));
  _pgInFlight.add(p);
  try { _bg(p); } catch (e) {}
}

/* Called by DB.put / DB.del BEFORE KV is written: the proof goes first. If it
   cannot be removed, this throws and the write does not happen - a record
   whose proof outlived its change is the one thing that may not exist. */
async function _pgReadFence(env, kind, id){
  const email = _pgReadApplies(env, kind, id);
  if (!email || !(await _pgReadIn(env, email))) return;
  await env.AMV_KV.delete(_pgOkKey(kind, email));
}

/* Called by DB.put / DB.del after KV has the write, INSTEAD of the background
   mirror, for a record Postgres answers: the write reaches Postgres before
   the request goes on and is read back; only a row that reads back the same
   as what was written gets a proof. Anything else leaves no proof (KV
   answers) and goes on the repair list. Answers whether this path handled
   the record at all. */
async function _pgWriteThrough(env, kind, id, obj){
  const email = _pgReadApplies(env, kind, id);
  if (!email || !(await _pgReadIn(env, email))) return false;
  let why = '';
  try {
    await _pgMirror(env, kind, email, obj);
    const sql = await _pgClient(env);
    let back;
    try { back = await _pgReadRow(sql, kind, email); } finally { try { await sql.end({ timeout: 5 }); } catch (e) {} }
    if (_pgCanon(kind, back) === _pgCanon(kind, obj)) {
      await env.AMV_KV.put(_pgOkKey(kind, email), await _pgProofOf(kind, back));
      return true;
    }
    why = 'read back differs';
  } catch (e) {
    why = String((e && e.message) || e).slice(0, 160);
  }
  try { await env.AMV_KV.put('pgrepair:' + kind + ':' + email, JSON.stringify({ at: Date.now(), why })); } catch (_) {}
  try { audit(env, 'pg_write_through_failed', { kind, id: email, error: why }); } catch (_) {}
  return true;
}
