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

   Not copied, and said so in the status: credit packs bought before step 2
   (their record is the payment provider's and the per-pack KV record; the
   live ledger starts at step 2), and seller lines older than the 500 the
   history keeps. */

const PG_BACKFILL_PHASES = ['acct', 'team', 'wallet', 'repair', 'verify'];
const PG_BACKFILL_PREFIX = { acct: 'acct:', team: 'team:', wallet: 'wallet_tx:', repair: 'pgrepair:', verify: 'acct:' };
const PG_BACKFILL_SLICE_MS = 20000;
const PG_BACKFILL_PAGE = 100;

async function _pgDigest(value){
  const bytes = new TextEncoder().encode(JSON.stringify(value));
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
      if (String(e[0].plan) !== String(kv.ent.plan || 'free')) out.push('plan');
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

async function _pgBackfillCursor(sql, phase){
  const r = await sql`SELECT cursor, copied FROM migration_cursor WHERE kind = ${phase}`;
  return r.length ? { cursor: r[0].cursor, copied: Number(r[0].copied) } : { cursor: null, copied: 0 };
}
async function _pgBackfillSave(sql, phase, cursor, add){
  await sql`
    INSERT INTO migration_cursor (kind, cursor, copied, updated_at) VALUES (${phase}, ${cursor}, ${add || 0}, now())
    ON CONFLICT (kind) DO UPDATE SET cursor = EXCLUDED.cursor, copied = migration_cursor.copied + ${add || 0}, updated_at = now()`;
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
  if (phase === 'verify') {
    const email = keyName.slice(5).toLowerCase();
    let diff = await _pgAccountDiff(sql, email, await _pgAccountKV(env, email));
    if (diff.length) diff = await _pgAccountDiff(sql, email, await _pgAccountKV(env, email));
    if (!diff.length) return 'same';
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
  const t = { phase: '', copied: 0, same: 0, mismatched: 0, skipped: 0, failed: 0, lines: 0, unkeyed: 0, unreadable: 0 };
  try {
    const run = await _pgBackfillCursor(sql, '_run');
    if (run.cursor !== 'running') return { on: true, state: run.cursor || 'not_started' };
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
              if (kind) { try { await env.AMV_KV.put('pgrepair:' + kind + ':' + k.name.slice(kind.length + 1).toLowerCase(), JSON.stringify({ at: Date.now(), why }), { expirationTtl: PG_REPAIR_TTL_S }); } catch (_) {} }
            }
          }
        }
        /* A repair that fails again stays on the list and is reported; the
           pass goes on past it rather than trying it for ever. */
        const finished = !!page.list_complete;
        cur = { cursor: finished ? 'done' : page.cursor, copied: cur.copied + n };
        await _pgBackfillSave(sql, phase, cur.cursor, n);
        if (finished || Date.now() - started >= sliceMs) break;
      }
      if (cur.cursor !== 'done') return { on: true, state: 'running', ...t };
    }
    await _pgBackfillSave(sql, '_run', 'done', 0);
    const left = await env.AMV_KV.list({ prefix: 'pgrepair:', limit: 1 });
    const bad = await sql`SELECT count(*)::int AS n FROM migration_accounts WHERE mismatches > 0`;
    const clean = !(left.keys || []).length && !bad[0].n;
    try { await alertOnce(env, 'pg_backfill_done', clean
      ? 'The Postgres backfill finished: every account was read back and matches, and the repair list is empty. Step 4 (shadow reads) can start.'
      : 'The Postgres backfill finished with work left: ' + bad[0].n + ' account(s) differ and the repair list is ' + ((left.keys || []).length ? 'not ' : '') + 'empty. See GET /admin/pg/backfill. Step 4 must wait.', 60); } catch (e) {}
    return { on: true, state: 'done', clean, ...t };
  } finally {
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
    const left = await env.AMV_KV.list({ prefix: 'pgrepair:', limit: 1000 });
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
      accountsDiffering: await count(sql`SELECT count(*)::int AS n FROM migration_accounts WHERE mismatches > 0`),
      repairsWaiting: (left.keys || []).length,
      repairsMoreThanShown: !left.list_complete,
      notCopied: 'Credit packs bought before step 2, and seller lines older than the 500 a history keeps.',
    });
  } finally {
    try { await sql.end({ timeout: 5 }); } catch (e) {}
  }
}
