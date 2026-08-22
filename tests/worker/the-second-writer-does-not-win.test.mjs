/* NINE RECORDS, ONE SHAPE, NINE DIFFERENT THINGS TO LOSE.

   A full inventory of every record kind and every function that writes it found
   the same defect on nine kinds at once: read the record, change it, write the
   whole thing back, with nothing holding it. What that costs depends entirely
   on which record it is.

     approvals   a decision somebody made is undone, or an item they rejected
                 comes back in front of them. This is the consent boundary for
                 autonomous work.
     auto        pause is written away by the tick that is mid-run, so the job
                 the person stopped keeps running and keeps spending.
     market      a visitor loading a page writes the whole listing back, so an
                 item that had just sold goes back on sale because somebody
                 looked at it.
     purchases   a refund and a purchase landing together lose one of the two.
     abuse       a fraud flag is lost to the write that cleared a different one.
     site        two people claim the same public name and the check that exists
                 to prevent it passes for both.
     apikeys     the hot path stamps lastUsed on every request and can write a
                 revoke away, so a screen shows a dead key as live.

   Two things this file must ALSO prove, because both are ways of "fixing" it
   that are worse than the bug: the lock must not turn a normal write into a
   refusal, and it must not serialise unrelated people behind each other. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'secondwriter.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, setEntitlement, _withKind, _withKV, _abuseRecord, ABUSE_DISPUTE_BLOCK, MKT_VIEW_FOLD };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

/* Reads answer with what was held when the read was ISSUED. Without that the
   slow reader sees the other writer's result, the two never disagree, and none
   of this is a test - it passed with every lock removed the first time. */
function mkEnv(readDelayMs = 12) {
  const m = new Map(); const n = new Map();
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    _map: m, _n: n,
    AMV_KV: {
      _map: m,
      async get(k) {
        const asServed = m.has(k) ? m.get(k) : null;
        if (readDelayMs) await new Promise(r => setTimeout(r, readDelayMs));
        return asServed;
      },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        const from = cursor ? +cursor : 0;
        const page = all.slice(from, from + (limit || 1000));
        return { keys: page, list_complete: from + page.length >= all.length, cursor: String(from + page.length) };
      },
    },
    AMV_COUNTER: {
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = n.get(x) || 0;
        if (b.op === 'claim') { if (n.has('c:' + x)) return new Response(JSON.stringify({ claimed: false })); n.set('c:' + x, 1); return new Response(JSON.stringify({ claimed: true })); }
        if (b.op === 'release') { n.delete('c:' + x); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'incr') { n.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: n.get(x) })); }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'rateCheck') { n.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '99.9.9.' + Math.floor(Math.random() * 250),
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const signup = async (env, email) => (await (await call(env, '/auth/signup', { email, name: 'N', password: 'A-real-Passw0rd!' })).json()).token;
/* Publishing to a live URL is an Elite feature and the server enforces it, so
   anybody in this file who is about to deploy has to be able to. Ultra, because
   these races involve two sites, and Elite hosts one. The gate itself is proved
   in worker.test.mjs - this only stops it from standing in the way of the races
   that are actually under test here. */
const canPublish = async (env, email) => { await W.setEntitlement(env, email, 'ultra'); };
const together = async (...ps) => (await Promise.allSettled(ps))
  .filter(r => r.status === 'rejected').map(r => String((r.reason && r.reason.message) || r.reason));

section('The fixture can express a race at all');
{
  const env = mkEnv();
  await env.AMV_KV.put('probe', 'before');
  const inFlight = env.AMV_KV.get('probe');
  await env.AMV_KV.put('probe', 'after');
  ok(await inFlight === 'before',
     'a read already in flight does not see a write that landed after it', await inFlight);
}

section('Two appends to the same list both survive');
{
  /* The shape underneath seven of the nine. Proved on the primitive first, so a
     failure below is about the caller rather than about this. */
  const env = mkEnv();
  await W.DB.put(env, 'approvals', 'a@example.com', { items: [] });
  const refused = await together(
    W._withKind(env, 'approvals', 'a@example.com', (r) => { r.items = (r.items || []).concat({ id: 'one' }); }, { items: [] }),
    W._withKind(env, 'approvals', 'a@example.com', (r) => { r.items = (r.items || []).concat({ id: 'two' }); }, { items: [] }),
  );
  ok(refused.length === 0, 'neither append was refused', refused);
  const ids = ((await W.DB.get(env, 'approvals', 'a@example.com')) || {}).items.map(i => i.id);
  ok(ids.includes('one') && ids.includes('two'), 'both are there', ids);
}

section('A decision is not undone by work arriving behind it');
{
  /* The consent boundary. An enqueue landing on top of a rejection puts the
     rejected item back in front of the person, which is the product asking
     again for permission they have already refused. */
  const env = mkEnv();
  const email = 'crew@example.com';
  await W.DB.put(env, 'approvals', email, { items: [{ id: 'ap_old', title: 'the one they reject' }] });

  const refused = await together(
    W._withKind(env, 'approvals', email, (r) => { r.items = (r.items || []).filter(a => a.id !== 'ap_old'); }, { items: [] }),
    W._withKind(env, 'approvals', email, (r) => { r.items = (r.items || []).concat({ id: 'ap_new' }); }, { items: [] }),
  );
  ok(refused.length === 0, 'neither the decision nor the new item threw', refused);

  const items = ((await W.DB.get(env, 'approvals', email)) || {}).items.map(a => a.id);
  ok(!items.includes('ap_old'), 'the rejected item does not come back', items);
  ok(items.includes('ap_new'), 'and the new one is still queued', items);
}

section('Pause is not written away by the run that is under way');
{
  /* The tick holds this record for the whole of a run and used to write its
     stale copy back at the end. Pause is what people reach for when something
     is going wrong, so it failing silently is worse than not having it. */
  const env = mkEnv();
  const email = 'busy@example.com';
  const key = email;
  await W.DB.put(env, 'auto', key, { items: [{ id: 'j1', active: true, runs: 0 }], results: [], paused: false });

  const refused = await together(
    /* what the person does */
    W._withKind(env, 'auto', key, (r) => { r.paused = true; }, { items: [], results: [] }),
    /* what the tick writes back after a run */
    W._withKind(env, 'auto', key, (r) => {
      for (const it of (r.items || [])) if (it.id === 'j1') { it.runs = 1; it.next = 123; }
    }, { items: [], results: [] }),
  );
  ok(refused.length === 0, 'neither write threw', refused);

  const after = await W.DB.get(env, 'auto', key);
  ok(after.paused === true, 'the job stays paused', after.paused);
  ok((after.items[0] || {}).runs === 1, 'and the run that happened is still recorded', after.items[0]);
}

section('Looking at a listing cannot put a sold item back on sale');
{
  /* marketView used to read the listing, add one to `views`, and write the
     whole record back - with no auth, on every page load. So the most frequent
     write in the marketplace raced the two that carry money. */
  const env = mkEnv();
  const seller = await signup(env, 'seller@example.com');
  const item = (await post(env, '/v1/market/publish', { title: 'Vintage jacket', text: 'x', price: 40 }, seller)).body.item;
  ok(!!(item && item.id), 'a listing exists', item && item.id);

  await Promise.all([
    post(env, '/v1/market/view', { id: item.id }),
    post(env, '/v1/market/status', { id: item.id, status: 'sold' }, seller),
  ]);

  const after = JSON.parse(await env.AMV_KV.get(`market:${item.id}`));
  ok(after.status === 'sold', 'the listing is still sold', after.status);
}

section('And a view does not rewrite the listing at all');
{
  /* The other half: an unauthenticated endpoint that forces a storage write per
     request is billed, is an abuse vector, and hits the roughly one-write-per-
     second-per-key limit exactly on the listing that gets popular. */
  const env = mkEnv();
  const seller = await signup(env, 'seller2@example.com');
  const item = (await post(env, '/v1/market/publish', { title: 'Lamp', text: 'x', price: 10 }, seller)).body.item;
  const before = await env.AMV_KV.get(`market:${item.id}`);

  for (let i = 0; i < 5; i++) await post(env, '/v1/market/view', { id: item.id });
  const after = await env.AMV_KV.get(`market:${item.id}`);
  ok(after === before, 'five views wrote the record zero times', after === before);

  const counted = (await W.DB.get(env, 'market', item.id));
  ok(true, 'and the count lives in the counter instead', env._n.get(`mktviews:${item.id}`));
  ok((env._n.get(`mktviews:${item.id}`) || 0) === 5, 'which has all five', env._n.get(`mktviews:${item.id}`));
}

section('A purchase and a refund landing together lose neither');
{
  const env = mkEnv();
  const buyer = 'shopper@example.com';
  await env.AMV_KV.put(`purchases:${buyer}`, JSON.stringify([{ id: 'old', title: 'Earlier' }]));

  const refused = await together(
    W._withKV(env, 'purchases', buyer, (l) => { l.unshift({ id: 'new', title: 'Just bought' }); }, []),
    W._withKV(env, 'purchases', buyer, (l) => { const keep = l.filter(p => p.id !== 'old'); l.length = 0; for (const p of keep) l.push(p); }, []),
  );
  ok(refused.length === 0, 'neither write threw', refused);
  const list = JSON.parse(await env.AMV_KV.get(`purchases:${buyer}`));
  const ids = list.map(p => p.id);
  ok(ids.includes('new'), 'the new purchase is on the list', ids);
  ok(!ids.includes('old'), 'and the refunded one is off it', ids);
}

section('A fraud flag is not lost to the write that cleared another');
{
  const env = mkEnv();
  const who = 'risky@example.com';
  const refused = await together(
    W._abuseRecord(env, who, 'dispute', {}),
    W._abuseRecord(env, who, 'refund', {}),
  );
  ok(refused.length === 0, 'neither flag threw', refused);
  const rec = await W.DB.get(env, 'abuse', who);
  ok(rec.disputes === 1 && rec.refunds === 1, 'both were recorded', { d: rec.disputes, r: rec.refunds });
  ok((rec.events || []).length === 2, 'and the evidence has both events', (rec.events || []).length);
}

section('Two people cannot claim the same public name');
{
  /* The check reads the slug and refuses when somebody else holds it, then
     writes. Both used to read nothing and both wrote, so the check that exists
     to prevent exactly this passed for both of them. */
  const env = mkEnv();
  const a = await signup(env, 'alice@example.com');
  const b = await signup(env, 'bob@example.com');
  await canPublish(env, 'alice@example.com');
  await canPublish(env, 'bob@example.com');
  const [ra, rb] = await Promise.all([
    post(env, '/deploy', { slug: 'the-same-name', title: 'A', html: '<p>a</p>' }, a),
    post(env, '/deploy', { slug: 'the-same-name', title: 'B', html: '<p>b</p>' }, b),
  ]);
  const rec = await W.DB.get(env, 'site', 'the-same-name');
  ok(!!rec, 'the name was claimed', !!rec);
  const winners = [ra, rb].filter(r => r.body && r.body.ok !== false && r.status === 200);
  ok(winners.length === 1, 'exactly one of them got it', { a: ra.status, b: rb.status });
  ok(!!rec && (rec.owner === 'alice@example.com' || rec.owner === 'bob@example.com'),
     'and it belongs to one of them', rec && rec.owner);
  const loser = [ra, rb].find(r => r.status !== 200);
  ok(loser && /taken/i.test((loser.body || {}).error || ''), 'the other is told the name is taken', loser && loser.body);
}

section('An ordinary write is still just a write');
{
  /* The failure that would be worse than the bug: a lock so eager that normal
     use starts being refused. */
  const env = mkEnv();
  const tok = await signup(env, 'normal@example.com');
  await canPublish(env, 'normal@example.com');
  const r = await post(env, '/deploy', { slug: 'my-page', title: 'Mine', html: '<p>hi</p>' }, tok);
  ok(r.status === 200, 'deploying a page works', r.status + ' ' + ((r.body || {}).error || ''));
  const again = await post(env, '/deploy', { slug: 'my-page', title: 'Mine v2', html: '<p>hi2</p>' }, tok);
  ok(again.status === 200, 'and updating your own page works', again.status + ' ' + ((again.body || {}).error || ''));
}

section('Different people do not queue behind each other');
{
  const env = mkEnv();
  const t0 = Date.now();
  const refused = await together(
    W._withKind(env, 'approvals', 'p1@example.com', (r) => { r.items = [{ id: 'x' }]; }, { items: [] }),
    W._withKind(env, 'approvals', 'p2@example.com', (r) => { r.items = [{ id: 'y' }]; }, { items: [] }),
    W._withKind(env, 'auto', 'p3@example.com', (r) => { r.paused = true; }, { items: [], results: [] }),
  );
  const elapsed = Date.now() - t0;
  ok(refused.length === 0, 'none of them was refused', refused);
  ok(elapsed < 400, 'and they did not serialise behind each other', elapsed);
}

section('The tick does not write the person’s record wholesale');
{
  /* The case above proves the lock; this pins the CALLER, because the tick is
     the writer that made pause fail and it is the one that is hard to drive
     here - it needs a due job, a model, and a clock. What has to be true is
     expressible directly: whatever the run produced is merged onto the record as
     it is now, and the tick never puts its own stale copy back. A plain
     DB.put of the whole record inside that function is the defect, exactly as
     it was. */
  const m = src.match(/async function runDueAutomations\s*\(/);
  ok(!!m, 'the tick was found', !!m);
  const nexts = [src.indexOf('\nasync function ', m.index + 10), src.indexOf('\nfunction ', m.index + 10)].filter(i => i > 0);
  const body = src.slice(m.index, Math.min(...nexts));
  ok(!/DB\.put\(env, 'auto'/.test(body),
     'the tick does not write the auto record directly',
     (body.match(/DB\.put\(env, 'auto'[^;]*/g) || []).slice(0, 2));
  /* _withAuto is the one function every write of an automation record goes
     through: it takes the same lock and books the due-time index from the
     record, so booking cannot be left to a caller. A named wrapper around the
     lock is still the lock. */
  ok(/_with(?:Auto|Kind)\(env, (?:'auto', )?/.test(body),
     'it merges what the run produced under the lock instead', true);
}

globalThis.fetch = realFetch;
if (report('the-second-writer-does-not-win') > 0) process.exitCode = 1;
done();
