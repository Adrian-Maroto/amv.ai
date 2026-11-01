/* ══════════════════════════════════════════════════════════════════════════
   THE CONTROL PLANE IN POSTGRES: STEP 4, SHADOW READS (docs/DATA-TIER.md).

   For the accounts in the shadow cohort, a read of an account, a plan or a
   set of API keys is answered from KV as always - and then, in the
   background, the same thing is read from Postgres and compared. KV's answer
   is the one used, every time: nothing here can change what anybody sees.
   A difference is re-checked once a moment later (a write may have been on
   its way to Postgres), then counted against the account (migration_accounts
   mismatches, last_mismatch), audited and alerted.

   The cohort is the `PG_SHADOW` variable, which only a deploy sets: a comma
   list of addresses (staff first) and/or a share of everybody, like
   `amv@amv.homes,5%`. Empty or unset, nothing is compared. The step's check -
   a week of shadow reads with no unexplained difference - is read from
   GET /admin/pg/shadow: reads compared and differing per day, and the
   accounts that differ.

   Its cost is bounded: an account's record is compared at most once a minute
   per Worker instance, and the tallies are sharded like every other total. */

const PG_SHADOW_KINDS = new Set(['acct', 'ent', 'apikeys']);
const PG_SHADOW_EVERY_MS = 60000;
const PG_SHADOW_RECHECK_MS = 1500;
const _pgShadowSeen = new Map();
let _pgShadowCohortCache = { raw: null, emails: new Set(), basisPoints: 0 };

function _pgShadowCohort(env){
  const raw = String((env && env.PG_SHADOW) || '');
  if (_pgShadowCohortCache.raw === raw) return _pgShadowCohortCache;
  const emails = new Set(); let basisPoints = 0;
  for (const part of raw.split(',').map(x => x.trim()).filter(Boolean)) {
    const pct = /^(\d+(?:\.\d+)?)%$/.exec(part);
    if (pct) basisPoints = Math.max(0, Math.min(10000, Math.round(parseFloat(pct[1]) * 100)));
    else if (part.includes('@')) emails.add(part.toLowerCase());
  }
  _pgShadowCohortCache = { raw, emails, basisPoints };
  return _pgShadowCohortCache;
}

/* In the cohort: named, or in the share by a hash of the address - so the
   same people are compared on every instance, and growing the share only
   adds people. */
async function _pgShadowIn(env, email){
  const c = _pgShadowCohort(env);
  if (c.emails.has(email)) return true;
  if (!c.basisPoints) return false;
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email)));
  return (((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0) % 10000 < c.basisPoints;
}

/* Called by DB.get / DB.getStrict with the text KV answered (not the object
   the caller was handed, which it may change before this runs). Never
   throws, never waits: the caller already has its answer. */
function _pgShadowRead(env, kind, id, raw){
  if (!env || !env.PG_SHADOW || !PG_SHADOW_KINDS.has(kind) || !_pgOn(env) || DB._hasD1(env)) return;
  const email = String(id || '').toLowerCase();
  if (!email.includes('@')) return;
  const key = kind + ':' + email, now = Date.now();
  if (now - (_pgShadowSeen.get(key) || 0) < PG_SHADOW_EVERY_MS) return;
  if (_pgShadowSeen.size > 5000) _pgShadowSeen.clear();
  _pgShadowSeen.set(key, now);
  const p = _pgShadowCompare(env, kind, email, raw)
    .catch((e) => { try { audit(env, 'pg_shadow_failed', { kind, id: email, error: String((e && e.message) || e).slice(0, 160) }); } catch (_) {} })
    .finally(() => _pgInFlight.delete(p));
  _pgInFlight.add(p);
  try { _bg(p); } catch (e) {}
}

const _pgShadowAs = (kind, value) => kind === 'acct' ? { acct: value } : kind === 'ent' ? { ent: value } : { keys: value };
async function _pgShadowKV(env, kind, email){
  try { return JSON.parse((await env.AMV_KV.get(kind + ':' + email)) || 'null'); } catch (e) { return null; }
}

async function _pgShadowCompare(env, kind, email, raw){
  if (!(await _pgShadowIn(env, email))) return 'outside';
  const value = JSON.parse(raw);
  const sql = await _pgClient(env);
  try {
    let diff = await _pgAccountDiff(sql, email, _pgShadowAs(kind, value), [kind]);
    if (diff.length) {
      /* A write that had reached KV but not yet Postgres is not a difference:
         a moment later, both are read again. */
      await new Promise(r => setTimeout(r, PG_SHADOW_RECHECK_MS));
      diff = await _pgAccountDiff(sql, email, _pgShadowAs(kind, await _pgShadowKV(env, kind, email)), [kind]);
    }
    const day = todayKey();
    try { await _tallyAdd(env, 'pgshadow:' + day + ':compared', email, 1, 40 * 86400000); } catch (e) {}
    if (!diff.length) return 'same';
    const fields = kind + ':' + diff.join(',');
    try { await _tallyAdd(env, 'pgshadow:' + day + ':differed', email, 1, 40 * 86400000); } catch (e) {}
    await sql`UPDATE migration_accounts SET mismatches = mismatches + 1, last_mismatch = ${fields.slice(0, 200)} WHERE email = ${email}`;
    try { audit(env, 'pg_shadow_mismatch', { kind, id: email, fields: diff.join(',') }); } catch (e) {}
    try { await alertOnce(env, 'pg_shadow_mismatch',
      'A shadow read found Postgres differing from KV (' + fields + '). Nobody saw it - KV answered - but step 5 must not start until '
      + 'every difference is explained. GET /admin/pg/shadow lists them.', 60); } catch (e) {}
    return 'differed';
  } finally {
    try { await sql.end({ timeout: 5 }); } catch (e) {}
  }
}

/* GET /admin/pg/shadow: who is compared, how many reads a day, how many
   differed, and the accounts that differ (most recent first, at most 50). */
async function pgShadowRoute(request, env){
  const gate = await _adminGate(request, env, 'pgshadow', 10, 200);
  if (gate) return gate;
  const c = _pgShadowCohort(env);
  const cohort = { addresses: c.emails.size, percent: c.basisPoints / 100 };
  if (!_pgOn(env)) return json({ on: false, cohort, note: 'The Postgres binding PG is not set.' });
  const rc = _pgReadCohort(env);
  cohort.read = { addresses: rc.emails.size, percent: rc.basisPoints / 100 };
  if (!c.emails.size && !c.basisPoints && !rc.emails.size && !rc.basisPoints) return json({ on: false, cohort, note: 'Nobody is in the shadow cohort: set PG_SHADOW (addresses and/or a share, like "5%").' });
  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const [compared, differed, served, fellBack, readDiffered] = await Promise.all([_tallyGet(env, 'pgshadow:' + day + ':compared'), _tallyGet(env, 'pgshadow:' + day + ':differed'),
      _tallyGet(env, 'pgread:' + day + ':served'), _tallyGet(env, 'pgread:' + day + ':fellback'), _tallyGet(env, 'pgread:' + day + ':differed')]);
    /* `read` is step 5 (04d-pg-read.js): answers Postgres gave, reads that
       fell back to KV, and answers that differed from KV. */
    days.push({ day, compared, differed, read: { served, fellBack, differed: readDiffered } });
  }
  const sql = await _pgClient(env);
  try {
    const rows = await sql`SELECT email, mismatches, last_mismatch FROM migration_accounts WHERE mismatches > 0 ORDER BY mismatches DESC, email LIMIT 50`;
    const n = await sql`SELECT count(*)::int AS n FROM migration_accounts WHERE mismatches > 0`;
    return json({ on: true, cohort, days, accountsDiffering: n[0].n,
      differing: rows.map(r => ({ email: r.email, mismatches: r.mismatches, last: r.last_mismatch })) });
  } finally {
    try { await sql.end({ timeout: 5 }); } catch (e) {}
  }
}
