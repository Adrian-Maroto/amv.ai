/* LOAD PROBE - what one request costs in storage, and what everybody shares.

   Scale audit #40. A real load test of a Cloudflare Worker needs Cloudflare;
   what CAN be measured here, exactly, is the thing that decides how AMV
   scales: how many storage operations each request makes, and whether
   requests from DIFFERENT people land on the SAME key or object. One shared
   counter that every model call booked against was the throughput ceiling the
   audit found - and it was invisible to every test, because each test had
   one user.

   This drives the real router (amv-backend.js) for many distinct accounts,
   with in-memory KV and a counter namespace that both count every operation,
   and a model that answers instantly. It reports, per route:
     - KV reads and writes per request, Durable Object calls per request;
     - p50/p95 of the time spent in AMV's own code (the model is instant);
   and across all accounts:
     - the hottest KV key written and the hottest object called, and how many
       DIFFERENT accounts touched it. A key every account writes is a ceiling.

   Usage:  node tools/load-probe.mjs [--users=200] [--json]
   tests/worker/no-key-is-shared-by-everybody.test.mjs runs it with budgets. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function probe({ users = 200 } = {}) {
  mkdirSync(join(ROOT, 'tests', 'worker', '.build'), { recursive: true });
  const h = join(ROOT, 'tests', 'worker', '.build', 'load-probe.' + process.pid + '.harness.mjs');
  writeFileSync(h, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB };\n');
  const W = await import(h + '?t=' + Date.now());
  const worker = W.default;

  /* The model answers at once, so what is timed is AMV. */
  const sse = 'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n'
            + 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n'
            + 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n'
            + 'data: {"type":"message_stop"}\n\n';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => /model\.example/.test(String(url))
    ? new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    : new Response('{}', { status: 200 });

  /* Who is making the current request, so every operation can be attributed. */
  let who = '', route = '';
  const kvOps = [], doOps = [];
  const store = new Map(), vals = new Map();
  const env = {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example', JWT_SECRET: 'j'.repeat(48),
    APP_URL: 'https://amv.test', GLOBAL_DAILY_USD_CAP: '5000',
    AMV_KV: {
      async get(k) { kvOps.push({ op: 'r', k, who, route }); return store.has(k) ? store.get(k) : null; },
      async put(k, v) { kvOps.push({ op: 'w', k, who, route }); store.set(k, String(v)); },
      async delete(k) { kvOps.push({ op: 'w', k, who, route }); store.delete(k); },
      async list({ prefix, limit } = {}) { kvOps.push({ op: 'l', k: prefix || '', who, route });
        const keys = [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true }; },
    },
    AMV_COUNTER: {
      idFromName: n => n,
      get: (n) => ({ async fetch(_u, init) {
        doOps.push({ k: n, who, route });
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        const out = (o) => new Response(JSON.stringify(o));
        if (b.op === 'reserve') { if (b.cap != null && cur + b.amount > b.cap) return out({ allowed: false, value: cur }); vals.set(n, cur + b.amount); return out({ allowed: true, value: cur + b.amount }); }
        if (b.op === 'incr') { vals.set(n, Math.max(0, cur + (b.amount || 0))); return out({ value: vals.get(n) }); }
        if (b.op === 'checkCap') return out({ allowed: b.cap == null || cur < b.cap, value: cur });
        if (b.op === 'rateCheck') return out({ allowed: true, count: 1 });
        if (b.op === 'claim') return out({ claimed: true });
        if (b.op && b.op.startsWith('auth')) return out({ seeded: true, epoch: 0, ended: false });
        return out({ allowed: true, value: cur });
      } }),
    },
  };
  const ctx = { _p: [], waitUntil(p) { this._p.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} };
  const call = async (path, body, tok, method) => {
    const r = await worker.fetch(new Request('https://api.amv.test' + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.' + (Math.random() * 250 | 0) + '.' + (Math.random() * 250 | 0) },
                             tok ? { Authorization: 'Bearer ' + tok } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env, ctx);
    if (r.body) await r.text();               // a stream is read to its end, as a browser would
    await Promise.all(ctx._p.splice(0));       // and the work it left behind is counted too
    return r.status;
  };

  const ROUTES = {
    signup: (u) => call('/auth/signup', { email: u.email, name: 'P', password: 'A-real-Passw0rd!' }),
    chat: (u) => call('/v1/messages', { model: 'amv-core', max_tokens: 64, messages: [{ role: 'user', content: 'hello' }] }, u.tok),
    usage: (u) => call('/v1/usage', undefined, u.tok),
    entitlement: (u) => call('/v1/entitlement', undefined, u.tok),
    syncPull: (u) => call('/sync/pull', {}, u.tok),
  };
  const timing = {}, status = {};
  const people = [];
  for (let i = 0; i < users; i++) people.push({ email: 'p' + i + '@example.com' });

  for (const [name, fn] of Object.entries(ROUTES)) {
    timing[name] = []; status[name] = {};
    for (const u of people) {
      who = u.email; route = name;
      const t = performance.now();
      let st;
      if (name === 'signup') {
        const r = await worker.fetch(new Request('https://api.amv.test/auth/signup', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.1.' + (people.indexOf(u) % 250) + '.1' },
          body: JSON.stringify({ email: u.email, name: 'P', password: 'A-real-Passw0rd!' }) }), env, ctx);
        const d = await r.json().catch(() => ({})); u.tok = d.token; st = r.status;
        await Promise.all(ctx._p.splice(0));
        if (u.tok) await W.DB.put(env, 'ent', u.email, { plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
      } else st = await fn(u);
      timing[name].push(performance.now() - t);
      status[name][st] = (status[name][st] || 0) + 1;
    }
  }
  globalThis.fetch = realFetch;

  const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
  const perRoute = {};
  for (const name of Object.keys(ROUTES)) {
    const kv = kvOps.filter(o => o.route === name), dos = doOps.filter(o => o.route === name);
    perRoute[name] = {
      status: status[name],
      kvReadsPerReq: +(kv.filter(o => o.op === 'r').length / users).toFixed(2),
      kvWritesPerReq: +(kv.filter(o => o.op === 'w').length / users).toFixed(2),
      kvListsPerReq: +(kv.filter(o => o.op === 'l').length / users).toFixed(2),
      doCallsPerReq: +(dos.length / users).toFixed(2),
      p50ms: pct(timing[name], 0.5), p95ms: pct(timing[name], 0.95),
    };
  }
  /* What different people share. A key or object only one person touches
     scales with people; one that every person touches does not. */
  const shared = (ops, filter) => {
    const by = new Map();
    for (const o of ops) { if (filter && !filter(o)) continue; const e = by.get(o.k) || { n: 0, who: new Set() }; e.n++; e.who.add(o.who); by.set(o.k, e); }
    return [...by.entries()].map(([k, e]) => ({ k, ops: e.n, accounts: e.who.size }))
      .sort((a, b) => b.accounts - a.accounts || b.ops - a.ops);
  };
  const kvWritesShared = shared(kvOps, o => o.op === 'w').slice(0, 8);
  const doShared = shared(doOps).slice(0, 8);
  return { users, perRoute, kvWritesShared, doShared };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const users = +((process.argv.find(a => a.startsWith('--users=')) || '').split('=')[1] || 200);
  const r = await probe({ users });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
  console.log(`\nAMV load probe - ${r.users} distinct accounts, every route below run once per account\n`);
  console.log('route        statuses              kv r/w/list per req   object calls/req   p50ms   p95ms');
  for (const [name, x] of Object.entries(r.perRoute))
    console.log(name.padEnd(12), JSON.stringify(x.status).padEnd(21), `${x.kvReadsPerReq}/${x.kvWritesPerReq}/${x.kvListsPerReq}`.padEnd(21), String(x.doCallsPerReq).padEnd(18), String(x.p50ms).padEnd(7), x.p95ms);
  console.log('\nKV keys written by the most different accounts:');
  for (const x of r.kvWritesShared) console.log('  ' + String(x.accounts).padStart(4) + ' accounts, ' + String(x.ops).padStart(5) + ' writes  ' + x.k);
  console.log('\nCounter objects called by the most different accounts:');
  for (const x of r.doShared) console.log('  ' + String(x.accounts).padStart(4) + ' accounts, ' + String(x.ops).padStart(5) + ' calls   ' + x.k);
  process.exit(0);
}
