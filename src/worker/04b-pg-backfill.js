/* ══════════════════════════════════════════════════════════════════════════
   THE CONTROL PLANE IN POSTGRES: STEP 3, THE BACKFILL (docs/DATA-TIER.md).

   Step 2 writes every NEW change to both stores. This copies what was there
   before, then reads every account back and compares it, so the check that
   lets step 4 start is a measurement, not an assumption.

   It is started by the owner (POST /admin/pg/backfill), never by binding the
   database: the plan's check before step 3 is a day of step 2 with no failed
   writes, and only a person can say that day has passed. Once started, the
   five-minute cron gives it a slice of about twenty seconds a tick until it is
   done; it stops between pages, never inside one.

   Phases, in order, each resumable from `migration_cursor` (kind = phase,
   cursor = where the KV listing got to):
     acct    - every account with its plan and API keys, through the same
               writes step 2 uses. A digest of the three KV records is kept on
               migration_accounts, and an account whose digest has not changed
               since it was copied is skipped: running it twice does nothing
               twice.
     team    - every team, after every account, so its members have rows.
     wallet  - every seller's money history, as seller_ledger rows under the
               same keys the live writes use, so a line already written live
               is the same row, not a second one.
     repair  - the `pgrepair:` list step 2 left: a record is copied again from
               KV as it is NOW (never as it was when the write failed); a money
               row is written exactly as it was kept. Each is taken off the
               list only once its write succeeded.
     verify  - every account read back from Postgres and compared with KV:
               name, sign-in, plan and keys. A difference is re-checked once
               (a live write may have landed between the two reads) and then
               counted on migration_accounts (mismatches, last_mismatch).
   `_run` is the switch: cursor 'running', 'stopped' or 'done'.

   MONEY FROM BEFORE THE LEDGER (Nov 3 audit DATA-004/005, USAGE-006).
   Credit packs bought before step 2, and seller lines older than the 500 a
   history keeps, have no ledger rows of their own - so the ledger alone
   would show less money than people have. Two more phases close that:
     opencredit / openseller - one OPENING row per credit balance (every
               subject a pack was ever paid for, from `creditpay:`) and per
               seller (`wallet:`): the balance AMV holds now, less what the
               ledger already has for it, measured with the ledger read on both
               sides of the balance so a sale landing meanwhile is not counted
               twice (moved: tried again on the next pass). Keyed
               `opening:<kind>:<who>`, so it is written once, ever.
     reconcredit / reconseller - every balance compared with its ledger sum to
               the cent; each that differs is kept as `money:<kind>:<who>` on
               migration_cursor, cleared when it agrees. The status shows how
               many: money may not be read from Postgres while it is not zero. */

const PG_BACKFILL_PHASES = ['acct', 'team', 'wallet', 'repair', 'opencredit', 'openseller', 'verify', 'reconcredit', 'reconseller'];
const PG_BACKFILL_PREFIX = { acct: 'acct:', team: 'team:', wallet: 'wallet_tx:', repair: 'pgrepair:', verify: 'acct:',
  opencredit: 'creditpay:', openseller: 'wallet:', reconcredit: 'creditpay:', reconseller: 'wallet:' };
const _pgR6 = (x) => Math.round(Number(x) * 1e6) / 1e6;
/* What AMV holds now: a credit balance is its two counters (bought less
   spent, exact); a seller's is their wallet. */
async function _pgMoneyLive(env, kind, who){
  if (kind === 'credit') { const st = await _creditState(env, who); return _pgR6(st.bought - st.spent); }
  const w = await _wallet(env, who);
  return _pgR6(+w.balance || 0);
}
/* What the ledger has for it: a credit row names its subject first in its
   note ('subject:<who>' ...); a seller row is the seller's account. */
async function _pgMoneyLedger(sql, kind, who){
  const r = kind === 'credit'
    ? await sql`SELECT COALESCE(SUM(amount), 0)::text AS s FROM credit_ledger WHERE split_part(note, ' ', 1) = ${'subject:' + who}`
    : await sql`SELECT COALESCE(SUM(l.amount), 0)::text AS s FROM seller_ledger l JOIN accounts a ON a.id = l.account_id WHERE a.email = ${who}`;
  return _pgR6(r[0].s);
}
const PG_MONEY_TOLERANCE = { credit: 0.0001, seller: 0.005 };
/* The balances a waiting money repair belongs to, read once per run. */
async function _pgMoneyPending(env, t){
  if (t._pending) return t._pending;
  const out = new Set(); let cursor;
  do {
    const page = await env.AMV_KV.list({ prefix: 'pgrepair:ledger:', cursor, limit: 1000 });
    for (const k of page.keys || []) {
      let kept = null; try { kept = JSON.parse((await env.AMV_KV.get(k.name)) || 'null'); } catch (e) { kept = null; }
      const row = kept && kept.row; if (!row) continue;
      if (row.table === 'seller') out.add('seller:' + String(row.email || '').toLowerCase());
      else { const m = /^subject:(\S+)/.exec(String(row.note || '')); out.add('credit:' + (m ? m[1] : String(row.email || '')).toLowerCase()); }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  Object.defineProperty(t, '_pending', { value: out, enumerable: false });
  return out;
}
async function _pgMoneyWho(env, kind, keyName){
  if (kind === 'seller') { const em = keyName.slice(7).toLowerCase(); return { who: em, email: em }; }
  let rec = null; try { rec = JSON.parse((await env.AMV_KV.get(keyName)) || 'null'); } catch (e) { rec = null; }
  if (!rec || !rec.subject) return null;
  const who = String(rec.subject).toLowerCase();
  return { who, email: String(who.includes('@') ? who : (rec.email || '')).toLowerCase() };
}
const PG_BACKFILL_SLICE_MS = 20000;
const PG_BACKFILL_PAGE = 100;

/* Keys sorted at every level before hashing (Nov 1 audit DATA-012): the
   same record written by two paths in a different key order is the same
   record, and must hash the same. (Changing this once makes every stored
   digest and read proof look stale: the backfill copies each account again
   and each proof is made again - work, never a wrong answer.) */
function _pgStable(v){
  if (Array.isArray(v)) return '[' + v.map(x => _pgStable(x === undefined ? null : x)).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + _pgStable(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
async function _pgDigest(value){
  const bytes = new TextEncoder().encode(_pgStable(value));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* What the KV side of one account is, in the shape both the digest and the
   comparison use. */
async function _pgAccountKV(env, email){
  const [acct, ent, keys] = await Promise.all([DB.get(env, 'acct', email), DB.get(env, 'ent', email), DB.get(env, 'apikeys', email)]);
  return { acct, ent, keys };
}

/* The differences between an account in KV and its rows, as short words
   (never the values: they go to an audit line and a database column).
   `kinds` narrows it to the records named (the shadow read compares the one
   it read); every kind by default. */
async function _pgAccountDiff(sql, email, kv, kinds){
  const want = new Set(kinds || ['acct', 'ent', 'apikeys']);
  const out = [];
  const a = await sql`SELECT id, name, provider, pw_hash FROM accounts WHERE email = ${email} AND deleted_at IS NULL`;
  if (want.has('acct')) {
    if (!kv.acct) { if (a.length) out.push('account_not_erased'); return out; }
    if (!a.length) return ['account_missing'];
    const row = a[0];
    if (String(row.name || '') !== String(kv.acct.name || '')) out.push('name');
    if (String(row.provider || '') !== String(kv.acct.provider || 'email')) out.push('provider');
    if ((row.pw_hash || null) !== (kv.acct.pwHash || null)) out.push('password');
  } else if (!a.length) {
    return ((want.has('ent') && kv.ent) || (want.has('apikeys') && kv.keys && (kv.keys.items || []).length)) ? ['account_missing'] : [];
  }
  const id = a[0].id;
  if (want.has('ent')) {
    const e = await sql`SELECT plan, blocked FROM entitlements WHERE account_id = ${id}`;
    if (!kv.ent) { if (e.length) out.push('plan_not_removed'); }
    else if (!e.length) out.push('plan_missing');
    else {
      /* The plan as STORED, compared with the row it was copied to - not the
       plan anybody is granted, which is _planOf's question and not this one. */
    if (String(e[0].plan) !== _pgStoredPlan(kv.ent)) out.push('plan');
      if (!!e[0].blocked !== !!kv.ent.blocked) out.push('blocked');
    }
  }
  if (want.has('apikeys')) {
    const wantKeys = ((kv.keys && Array.isArray(kv.keys.items)) ? kv.keys.items.filter(k => k && k.id && k.hash) : [])
      .map(k => k.hash + (k.revoked ? ':r' : '')).sort().join(',');
    const k = await sql`SELECT key_hash, revoked_at FROM api_keys WHERE account_id = ${id}`;
    const have = k.map(r => r.key_hash + (r.revoked_at ? ':r' : '')).sort().join(',');
    if (wantKeys !== have) out.push('api_keys');
  }
  return out;
}

const _pgStoredPlan = (ent) => (ent && ent.plan ? String(ent.plan) : 'free');

async function _pgBackfillCursor(sql, phase){
  const r = await sql`SELECT cursor, copied FROM migration_cursor WHERE kind = ${phase}`;
  return r.length ? { cursor: r[0].cursor, copied: Number(r[0].copied) } : { cursor: null, copied: 0 };
}
async function _pgBackfillSave(sql, phase, cursor, add){
  await sql`
    INSERT INTO migration_cursor (kind, cursor, copied, updated_at) VALUES (${phase}, ${cursor}, ${add || 0}, now())
    ON CONFLICT (kind) DO UPDATE SET cursor = EXCLUDED.cursor, copied = migration_cursor.copied + ${add || 0}, updated_at = now()`;
}

/* ONE RUN AT A TIME (Nov 1 audit DATA-008). The cron and an owner's "start"
   could each run a slice at once, both reading the same cursor and both
   moving it - a page copied twice is harmless, a cursor moved back past
   pages the other run already did is not. A run now holds a lease: the
   `_lease` row of migration_cursor names its holder and when it last showed
   it was alive. Taking it succeeds only when nobody holds it or the holder
   has been silent for PG_BACKFILL_LEASE_S (a crashed run is taken over);
   every cursor it saves renews the lease in the SAME statement and is written
   only while it still holds it, so a run that lost its lease cannot move a
   cursor, and stops. Released when the slice ends. */
const PG_BACKFILL_LEASE_S = 120;
async function _pgLeaseTake(sql, me){
  const r = await sql`
    INSERT INTO migration_cursor (kind, cursor, copied, updated_at) VALUES ('_lease', ${me}, 0, now())
    ON CONFLICT (kind) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()
      WHERE migration_cursor.cursor IS NULL OR migration_cursor.cursor = ''
         OR migration_cursor.updated_at < now() - make_interval(secs => ${PG_BACKFILL_LEASE_S})
    RETURNING cursor`;
  return r.length === 1 && r[0].cursor === me;
}
async function _pgLeaseRelease(sql, me){
  await sql`UPDATE migration_cursor SET cursor = '', updated_at = now() WHERE kind = '_lease' AND cursor = ${me}`;
}
/* A cursor saved under the lease, renewing it: false when the lease is no
   longer this run's - and then nothing was written. */
async function _pgBackfillSaveHeld(sql, me, phase, cursor, add){
  const r = await sql`
    WITH held AS (UPDATE migration_cursor SET updated_at = now() WHERE kind = '_lease' AND cursor = ${me} RETURNING 1)
    INSERT INTO migration_cursor (kind, cursor, copied, updated_at)
      SELECT ${phase}, ${cursor}, ${add || 0}, now() WHERE EXISTS (SELECT 1 FROM held)
    ON CONFLICT (kind) DO UPDATE SET cursor = EXCLUDED.cursor, copied = migration_cursor.copied + ${add || 0}, updated_at = now()
    RETURNING kind`;
  return r.length === 1;
}

/* One record of one phase. Returns 'copied', 'same', 'mismatched' (verify),
   'skipped', or throws. */
async function _pgBackfillOne(env, sql, phase, keyName, t){
  if (phase === 'acct') {
    const email = keyName.slice(5).toLowerCase();
    const kv = await _pgAccountKV(env, email);
    if (!kv.acct) return 'skipped';                 // unreadable or gone since the listing
    const digest = await _pgDigest(kv);
    const was = await sql`SELECT kv_digest FROM migration_accounts WHERE email = ${email}`;
    if (was.length && was[0].kv_digest === digest) return 'same';
    await _pgMirror(env, 'acct', email, kv.acct, sql);
    await _pgMirror(env, 'ent', email, kv.ent, sql);
    await _pgMirror(env, 'apikeys', email, kv.keys, sql);
    await sql`UPDATE migration_accounts SET kv_digest = ${digest}, backfilled_at = now() WHERE email = ${email}`;
    return 'copied';
  }
  if (phase === 'team') {
    const id = keyName.slice(5);
    const team = await DB.get(env, 'team', id);
    if (!team) return 'skipped';
    await _pgMirror(env, 'team', id.toLowerCase(), team, sql);
    return 'copied';
  }
  if (phase === 'wallet') {
    const email = keyName.slice(10).toLowerCase();
    let list = null;
    try { list = JSON.parse((await env.AMV_KV.get(keyName)) || 'null'); } catch (e) { list = null; }
    if (!Array.isArray(list)) return 'skipped';
    for (const tx of list) {
      const row = _pgSellerLedgerRow(email, tx);
      if (!row) continue;
      if (row.unkeyed) { t.unkeyed++; continue; }
      await _pgLedgerInsert(sql, row);
      t.lines++;
    }
    return 'copied';
  }
  if (phase === 'repair') {
    const rest = keyName.slice(9);
    const at = rest.indexOf(':');
    const kind = rest.slice(0, at), id = rest.slice(at + 1);
    if (kind === 'ledger') {
      let kept = null;
      try { kept = JSON.parse((await env.AMV_KV.get(keyName)) || 'null'); } catch (e) { kept = null; }
      if (!kept || !kept.row) { t.unreadable++; return 'skipped'; }   // left on the list for a person to read
      await _pgLedgerInsert(sql, kept.row);
    } else if (PG_MIRROR_KINDS.has(kind)) {
      /* As KV has it now: if it was deleted since, that is what is copied. */
      await _pgMirror(env, kind, id, await DB.get(env, kind, id), sql);
    } else { t.unreadable++; return 'skipped'; }
    await env.AMV_KV.delete(keyName);
    return 'copied';
  }
  if (phase === 'opencredit' || phase === 'openseller') {
    const kind = phase === 'opencredit' ? 'credit' : 'seller';
    const w = await _pgMoneyWho(env, kind, keyName);
    if (!w || !w.email) { t.unreadable++; return 'skipped'; }
    const key = 'opening:' + kind + ':' + w.who;
    const have = kind === 'credit' ? await sql`SELECT 1 FROM credit_ledger WHERE idempotency_key = ${key}` : await sql`SELECT 1 FROM seller_ledger WHERE idempotency_key = ${key}`;
    if (have.length) return 'same';
    /* A money row for this balance still waiting on the repair list would be
       counted twice - once in the opening, once when it is repaired. Not
       yet, then. (A repair entry nobody can read is for a person, and
       blocks nothing.) */
    if ((await _pgMoneyPending(env, t)).has(kind + ':' + w.who)) { t.moved = (t.moved || 0) + 1; return 'skipped'; }
    const before = await _pgMoneyLedger(sql, kind, w.who);
    const live = await _pgMoneyLive(env, kind, w.who);
    const after = await _pgMoneyLedger(sql, kind, w.who);
    if (before !== after) { t.moved = (t.moved || 0) + 1; return 'skipped'; }
    const amount = _pgR6(live - after);
    /* Written even when it is zero: the row is the record that this balance
       was measured, and its key makes it the only one. */
    await _pgLedgerInsert(sql, kind === 'credit'
      ? { table: 'credit', email: w.email, currency: 'USD', amount, reason: 'correction', key, note: 'subject:' + w.who + ' opening' }
      : { table: 'seller', email: w.email, currency: 'USD', amount, reason: 'correction', key });
    try { audit(env, 'pg_money_opening', { kind, id: w.who, amount }); } catch (e) {}
    return 'copied';
  }
  if (phase === 'reconcredit' || phase === 'reconseller') {
    const kind = phase === 'reconcredit' ? 'credit' : 'seller';
    const w = await _pgMoneyWho(env, kind, keyName);
    if (!w) { t.unreadable++; return 'skipped'; }
    const live = await _pgMoneyLive(env, kind, w.who);
    const led = await _pgMoneyLedger(sql, kind, w.who);
    const tag = 'money:' + kind + ':' + w.who;
    if (Math.abs(live - led) < PG_MONEY_TOLERANCE[kind]) { await sql`DELETE FROM migration_cursor WHERE kind = ${tag}`; return 'same'; }
    await sql`INSERT INTO migration_cursor (kind, cursor, copied, updated_at) VALUES (${tag}, ${String(_pgR6(live - led))}, 0, now())
              ON CONFLICT (kind) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()`;
    try { audit(env, 'pg_money_differs', { kind, id: w.who, live, ledger: led }); } catch (e) {}
    return 'mismatched';
  }
  if (phase === 'verify') {
    const email = keyName.slice(5).toLowerCase();
    let diff = await _pgAccountDiff(sql, email, await _pgAccountKV(env, email));
    if (diff.length) diff = await _pgAccountDiff(sql, email, await _pgAccountKV(env, email));
    /* Matching now clears what is CURRENTLY wrong; `mismatches` stays as the
       history (Nov 1 audit DATA-010). */
    if (!diff.length) { await sql`UPDATE migration_accounts SET last_mismatch = NULL WHERE email = ${email} AND last_mismatch IS NOT NULL`; return 'same'; }
    await sql`UPDATE migration_accounts SET mismatches = mismatches + 1, last_mismatch = ${diff.join(',').slice(0, 200)} WHERE email = ${email}`;
    try { audit(env, 'pg_backfill_mismatch', { id: email, fields: diff.join(',') }); } catch (e) {}
    return 'mismatched';
  }
  return 'skipped';
}

/* A slice of the backfill. Called by the cron; returns what it did. A slice
   always does at least one page, so a short one still moves. */
async function runPgBackfill(env, opts){
  const sliceMs = (opts && +opts.sliceMs) > 0 ? +opts.sliceMs : PG_BACKFILL_SLICE_MS;
  if (!_pgOn(env)) return { on: false };
  if (DB._hasD1(env)) return { on: false, why: 'd1' };
  const started = Date.now();
  const sql = await _pgClient(env);
  const t = { phase: '', copied: 0, same: 0, mismatched: 0, skipped: 0, failed: 0, lines: 0, unkeyed: 0, unreadable: 0, moved: 0 };
  const me = 'run:' + [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
  let held = false;
  try {
    const run = await _pgBackfillCursor(sql, '_run');
    if (run.cursor !== 'running') return { on: true, state: run.cursor || 'not_started' };
    held = await _pgLeaseTake(sql, me);
    if (!held) return { on: true, state: 'running', busy: true, note: 'Another run of the backfill holds the lease; this one did nothing.' };
    for (const phase of PG_BACKFILL_PHASES) {
      let cur = await _pgBackfillCursor(sql, phase);
      if (cur.cursor === 'done') continue;
      t.phase = phase;
      for (;;) {
        const page = await env.AMV_KV.list({ prefix: PG_BACKFILL_PREFIX[phase], cursor: cur.cursor || undefined, limit: PG_BACKFILL_PAGE });
        let n = 0;
        for (const k of (page.keys || [])) {
          try {
            const r = await _pgBackfillOne(env, sql, phase, k.name, t);
            t[r]++; if (r !== 'skipped') n++;
          } catch (e) {
            t.failed++;
            const why = String((e && e.message) || e).slice(0, 160);
            try { audit(env, 'pg_backfill_failed', { phase, key: k.name, error: why }); } catch (_) {}
            /* A record that would not copy goes on the repair list, which is
               worked after it - so one bad record never stops the run. A
               repair that fails again stays where it is. */
            if (phase !== 'repair' && phase !== 'verify') {
              const kind = phase === 'wallet' ? null : phase;
              if (kind) { try { await env.AMV_KV.put('pgrepair:' + kind + ':' + k.name.slice(kind.length + 1).toLowerCase(), JSON.stringify({ at: Date.now(), why })); } catch (_) {} }
            }
          }
        }
        /* A repair that fails again stays on the list and is reported; the
           pass goes on past it rather than trying it for ever. */
        const finished = !!page.list_complete;
        cur = { cursor: finished ? 'done' : page.cursor, copied: cur.copied + n };
        if (!(await _pgBackfillSaveHeld(sql, me, phase, cur.cursor, n))) {
          held = false;
          try { audit(env, 'pg_backfill_lease_lost', { phase }); } catch (_) {}
          return { on: true, state: 'running', leaseLost: true, ...t };
        }
        if (finished || Date.now() - started >= sliceMs) break;
      }
      if (cur.cursor !== 'done') return { on: true, state: 'running', ...t };
    }
    if (!(await _pgBackfillSaveHeld(sql, me, '_run', 'done', 0))) { held = false; return { on: true, state: 'running', leaseLost: true, ...t }; }
    const left = await env.AMV_KV.list({ prefix: 'pgrepair:', limit: 1 });
    const bad = await sql`SELECT count(*)::int AS n FROM migration_accounts WHERE last_mismatch IS NOT NULL`;
    const money = await sql`SELECT count(*)::int AS n FROM migration_cursor WHERE kind LIKE 'money:%'`;
    const clean = !(left.keys || []).length && !bad[0].n && !money[0].n;
    try { await alertOnce(env, 'pg_backfill_done', clean
      ? 'The Postgres backfill finished: every account was read back and matches, every balance reconciles to the cent, and the repair list is empty. Step 4 (shadow reads) can start.'
      : 'The Postgres backfill finished with work left: ' + bad[0].n + ' account(s) differ, ' + money[0].n + ' balance(s) do not reconcile, and the repair list is ' + ((left.keys || []).length ? 'not ' : '') + 'empty. See GET /admin/pg/backfill. Step 4 must wait; a restart measures balances that moved again.', 60); } catch (e) {}
    return { on: true, state: 'done', clean, ...t };
  } finally {
    if (held) { try { await _pgLeaseRelease(sql, me); } catch (e) {} }
    try { await sql.end({ timeout: 5 }); } catch (e) {}
  }
}

/* GET: where it is. POST { action: 'start' | 'stop' | 'restart' }: start or
   resume it, pause it, or start it from the beginning (every phase's cursor
   cleared; the digests stay, so unchanged accounts are still skipped). */
async function pgBackfillRoute(request, env){
  const gate = await _adminGate(request, env, 'pgbackfill', 10, 200);
  if (gate) return gate;
  if (!_pgOn(env)) return json({ on: false, note: 'The Postgres binding PG is not set (wrangler.toml, docs/DATA-TIER.md).' });
  if (DB._hasD1(env)) return json({ on: false, note: 'The backfill reads KV; this deployment stores its records in D1.' });
  const sql = await _pgClient(env);
  try {
    if (request.method === 'POST') {
      let body = {}; try { body = await request.json(); } catch (e) { body = {}; }
      const action = String(body.action || '');
      if (!['start', 'stop', 'restart'].includes(action)) return json({ error: 'action must be start, stop or restart', code: 'bad_request' }, 400);
      if (action === 'restart') await sql`DELETE FROM migration_cursor WHERE kind IN ${sql(PG_BACKFILL_PHASES)}`;
      await _pgBackfillSave(sql, '_run', action === 'stop' ? 'stopped' : 'running', 0);
      audit(env, 'pg_backfill_' + action, {});
    }
    const rows = await sql`SELECT kind, cursor, copied, updated_at FROM migration_cursor`;
    const by = Object.fromEntries(rows.map(r => [r.kind, r]));
    const count = async (q) => (await q)[0].n;
    /* The whole repair list, counted page by page and by kind (Nov 1 audit
       DATA-011) - not the first thousand. Bounded in time; `exact` says
       whether it reached the end. */
    const backlog = { total: 0, byKind: {}, exact: true };
    { const until = Date.now() + 8000; let cursor;
      do {
        const page = await env.AMV_KV.list({ prefix: 'pgrepair:', cursor, limit: 1000 });
        for (const k of page.keys || []) { backlog.total++; const kind = k.name.split(':')[1] || '?'; backlog.byKind[kind] = (backlog.byKind[kind] || 0) + 1; }
        cursor = page.list_complete ? undefined : page.cursor;
        if (cursor && Date.now() > until) { backlog.exact = false; break; }
      } while (cursor); }
    return json({
      on: true,
      state: (by._run && by._run.cursor) || 'not_started',
      phases: PG_BACKFILL_PHASES.map(p => ({ phase: p, done: !!(by[p] && by[p].cursor === 'done'), copied: by[p] ? Number(by[p].copied) : 0,
        updatedAt: by[p] ? by[p].updated_at : null })),
      rows: {
        accounts: await count(sql`SELECT count(*)::int AS n FROM accounts WHERE deleted_at IS NULL`),
        entitlements: await count(sql`SELECT count(*)::int AS n FROM entitlements`),
        apiKeys: await count(sql`SELECT count(*)::int AS n FROM api_keys`),
        organizations: await count(sql`SELECT count(*)::int AS n FROM organizations`),
        sellerLines: await count(sql`SELECT count(*)::int AS n FROM seller_ledger`),
        creditLines: await count(sql`SELECT count(*)::int AS n FROM credit_ledger`),
      },
      accountsDiffering: await count(sql`SELECT count(*)::int AS n FROM migration_accounts WHERE last_mismatch IS NOT NULL`),
      /* Balances whose ledger does not add up to what AMV holds, to the cent
         (DATA-004/005). Money is read from Postgres only when this is zero
         and both reconcile phases are done. */
      moneyDiffering: await count(sql`SELECT count(*)::int AS n FROM migration_cursor WHERE kind LIKE 'money:%'`),
      moneyReconciled: !!(by.reconcredit && by.reconcredit.cursor === 'done' && by.reconseller && by.reconseller.cursor === 'done')
        && (await count(sql`SELECT count(*)::int AS n FROM migration_cursor WHERE kind LIKE 'money:%'`)) === 0,
      repairsWaiting: backlog.total,
      repairsByKind: backlog.byKind,
      repairsMoreThanShown: !backlog.exact,
      notCopied: 'Credit packs bought before step 2 and seller lines older than the 500 a history keeps are not copied line by line: each balance has one opening row instead, reconciled to the cent.',
    });
  } finally {
    try { await sql.end({ timeout: 5 }); } catch (e) {}
  }
}
