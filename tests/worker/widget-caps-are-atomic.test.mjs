/* A CAP ON A PUBLIC ENDPOINT HAS TO HOLD UNDER A BURST.

   /v1/widget/chat is reachable by anyone on the internet who can find a site
   key, and every call spends the operator's model budget. Its daily message cap
   is the thing standing between that and a bill.

   The cap was a read, a comparison, and an increment forty lines apart, under a
   comment saying "atomic test-and-increment". Requests arriving together all
   read the same value, all compare it against the cap, all pass, and all
   increment. The cap is exceeded by however many were in flight, which on a
   public endpoint is however many somebody chooses to send at once.

   The per-visitor IP throttle is often offered as the answer to this and is
   not: it bounds ONE caller. A cap on a public endpoint exists for the case
   where the callers are many, which is exactly when the read-then-check window
   is widest.

   The counter already had `reserve` for this - it is what the image and video
   quotas use. What this asserts is that the widget uses it, that a reservation
   is given back on every path that never reaches the model, and that "no cap
   configured" still means no cap rather than a cap of zero. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'widget-caps.harness.mjs');
writeFileSync(harness, src + '\nexport { widgetChat, DB, todayKey };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const counters = new Map();
/* A counter that behaves like the Durable Object: one request at a time, so a
   reserve really is a test-and-set and a read-then-check really can race. */
const env = {
  JWT_SECRET: 'x'.repeat(40),
  ANTHROPIC_API_KEY: 'sk-test',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }; },
  },
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (id) => ({
      async fetch(_url, init) {
        const b = JSON.parse((init && init.body) || '{}');
        const cur = counters.get(id) || 0;
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'incr') { const n = Math.max(0, cur + (b.amount || 0)); counters.set(id, n); return new Response(JSON.stringify({ value: n })); }
        if (b.op === 'reserve') {
          if (cur >= b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          counters.set(id, cur + (b.amount || 0));
          return new Response(JSON.stringify({ allowed: true, value: cur + (b.amount || 0) }));
        }
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: cur < b.cap, value: cur }));
        /* The rate limiter's own op. Left unhandled it returns {} and every
           request reads as throttled, which is how this file first reported
           twelve 429s and measured nothing at all. */
        if (b.op === 'rateCheck') {
          const n = cur + 1; counters.set(id, n);
          return new Response(JSON.stringify({ allowed: n <= b.limit, value: n }));
        }
        return new Response('{}');
      },
    }),
  },
};
const ctx = { waitUntil(p) { /* metering runs out of band; not what is under test */ } };

const stream = () => new ReadableStream({ start(c) { c.close(); } });
let upstreamOk = true;
globalThis.fetch = async () => (upstreamOk
  ? { ok: true, status: 200, body: stream(), json: async () => ({}), headers: { get: () => null } }
  : { ok: false, status: 500, body: null, json: async () => ({ error: { message: 'upstream down' } }), headers: { get: () => null } });

const setWidget = async (cfg) => {
  await W.DB.put(env, 'widget', 'wk1', Object.assign({
    key: 'wk1', enabled: true, origins: ['https://site.example'],
    model: 'amv-core', systemPrompt: 'be helpful', maxOut: 512,
    dailyMsgCap: 3, dailySpendCapUSD: 0,
  }, cfg));
};
/* Every request from a different IP: the per-visitor throttle is a different
   defence and would otherwise be the thing being measured. */
let ipN = 0;
const hit = () => W.widgetChat(new Request('https://api/v1/widget/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://site.example',
             'CF-Connecting-IP': '10.0.0.' + (++ipN % 250) },
  body: JSON.stringify({ key: 'wk1', messages: [{ role: 'user', content: 'hi' }] }),
}), env, ctx);
const reset = () => { counters.clear(); ipN = 0; upstreamOk = true; };
const used = () => counters.get(`wmsg:wk1:${W.todayKey()}`) || 0;

section('Under the cap, messages go through');
{
  reset(); await setWidget({ dailyMsgCap: 3 });
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await hit()).status);
  ok(codes.every(c => c === 200), 'all three are answered', codes);
  ok(used() === 3, 'and all three are counted', used());
}

section('Over the cap, they do not');
{
  const r = await hit();
  ok(r.status === 429, 'the fourth is refused', r.status);
  const d = await r.json();
  ok(/daily message limit/i.test(d.error || ''), 'and told why', d.error);
  ok(used() === 3, 'and a refused request does not count against tomorrow', used());
}

section('And a burst arriving together cannot slip past it');
{
  /* The whole point. With a read-then-check, all ten of these read 0, all ten
     pass, and all ten are answered. */
  reset(); await setWidget({ dailyMsgCap: 3 });
  const results = await Promise.all(Array.from({ length: 10 }, () => hit()));
  const answered = results.filter(r => r.status === 200).length;
  ok(answered === 3, 'exactly the cap is answered, not the whole burst', answered);
  ok(used() === 3, 'and the counter agrees', used());
}

section('A request that never reaches the model gives its reservation back');
{
  /* Reserving up front is what makes the cap hold; refunding is what stops a
     rejected request from permanently costing the owner one. */
  reset(); await setWidget({ dailyMsgCap: 5 });
  upstreamOk = false;
  const r = await hit();
  ok(r.status === 502, 'the model was unreachable', r.status);
  ok(used() === 0, 'so nothing was charged against the day', used());

  upstreamOk = true;
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await hit()).status);
  ok(codes.every(c => c === 200), 'and the full allowance is still there', codes);
}

section('A blocked origin is not charged either');
{
  reset(); await setWidget({ dailyMsgCap: 5 });
  const r = await W.widgetChat(new Request('https://api/v1/widget/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://elsewhere.example', 'CF-Connecting-IP': '10.1.1.1' },
    body: JSON.stringify({ key: 'wk1', messages: [{ role: 'user', content: 'hi' }] }),
  }), env, ctx);
  ok(r.status === 403, 'refused for the wrong domain', r.status);
  ok(used() === 0, 'and it cost the owner nothing', used());
}

section('No cap configured still means no cap');
{
  /* A cap of 0 means unlimited. Reserving against a cap of zero would refuse
     every request, which is the obvious way to get this wrong. */
  reset(); await setWidget({ dailyMsgCap: 0 });
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await hit()).status);
  ok(codes.every(c => c === 200), 'twelve messages with no ceiling set', codes.filter(c => c !== 200));
}

section('The endpoint reserves rather than reads');
{
  /* Read from the source too: the behavioural test above passes with a
     read-then-check under a sequential runner, and the defect is about
     concurrency. */
  const at = src.indexOf('async function widgetChat');
  const body = src.slice(at, src.indexOf('\n}', src.indexOf('return new Response(toClient', at)));
  ok(/op: 'reserve'[^}]*cap: msgCap/.test(body.replace(/\n/g, ' ')),
     'the message cap is a reservation', true);
  ok(!/op: 'get' \}\)\)\.value \|\| 0;\s*if \(cfg\.dailyMsgCap/.test(body),
     'and not a read followed by a comparison', true);
  ok(/refundMsg/.test(body), 'with a refund path', true);
}

if (report('widget-caps-are-atomic') > 0) process.exitCode = 1;
done();
