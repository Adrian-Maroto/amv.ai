/* THE CRON FITS THE FREE KV BUDGET (LESSONS 635).

   Free-plan KV allows 1,000 lists and 1,000 deletes a day for the whole
   account, staging included. Measured on an empty deployment, every cron ran
   for a simulated day: 906 lists and 284 deletes before anybody signed up -
   three queues listed every five minutes to find nothing, and a batch cursor
   deleted every tick whether or not it existed. That is what made staging's
   erasure answer 503.

   This runs every cron for six simulated hours on an empty store and holds the
   budget, then proves the saving cost nothing: an erasure, a sign-in copy to
   forget and a batch queued AFTER a sweep marked their queue empty are all
   reached on the very next tick. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'cronbudget.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, _erasePendNote, _queueTouched };\n');

let now = Date.UTC(2026, 10, 10, 0, 0, 30); const RealDate = Date;
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
globalThis.fetch = async () => new Response('{}', { status: 200 });
const quiet = console.log; console.log = () => {}; const qw = console.warn; console.warn = () => {};
const W = await import(harness + '?t=' + RealDate.now());

const kv = new Map(); const ops = { list: 0, delete: 0, put: 0 }; const listed = [];
const env = { JWT_SECRET: 'x'.repeat(48), ADMIN_TOKEN: 'a'.repeat(40), CONNECT_KEY: 'c'.repeat(44),
  AMV_KV: { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { ops.put++; kv.set(k, String(v)); },
    async delete(k) { ops.delete++; kv.delete(k); },
    async list({ prefix = '' } = {}) { ops.list++; listed.push(prefix); return { keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: { idFromName: n => n, get: () => ({ fetch: async () => new Response(JSON.stringify({ ok: true, value: 0 }), { status: 200 }) }) } };
const pending = [];
const ctx = { waitUntil(p) { if (p && p.then) pending.push(p.catch(() => {})); }, passThroughOnException() {} };
const crons = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8').match(/^crons\s*=\s*\[([^\]]*)\]/m)[1].match(/"([^"]+)"/g).map(s => s.slice(1, -1));
async function minute() {
  const m = new RealDate(now).getUTCMinutes();
  for (const c of crons) {
    const due = c === '* * * * *' || (c === '*/5 * * * *' && m % 5 === 0) || (/^\d+ \* \* \* \*$/.test(c) && +c.split(' ')[0] === m);
    if (due) { try { await W.default.scheduled({ cron: c, scheduledTime: now }, env, ctx); } catch (e) {} while (pending.length) await Promise.all(pending.splice(0)); }
  }
  now += 60 * 1000;
}

section('Six empty hours stay well inside the free daily limits');
{
  for (let i = 0; i < 360; i++) await minute();
  ok(ops.list * 4 <= 250, 'lists, scaled to a day, are a quarter of the free 1,000 or less', ops.list * 4);
  ok(ops.delete * 4 <= 100, 'and deletes are not spent on keys that do not exist', ops.delete * 4);
  ok(ops.put * 4 <= 400, 'and writes stay well under the free 1,000', ops.put * 4);
}

section('Work queued after a queue was marked empty is reached on the next tick');
{
  ok(kv.has('qempty:erasepend') && kv.has('qempty:agentjarpend') && kv.has('qempty:batchq'), 'the three queues were marked empty by their sweeps', [...kv.keys()].filter(k => k.startsWith('qempty:')));
  await W._erasePendNote(env, 'late@example.com', ['files']);
  kv.set('agentjarpend:late@example.com:a1', JSON.stringify({ site: '', at: now })); await W._queueTouched(env, 'agentjarpend');
  kv.set('batchq:b-late', '1'); await W._queueTouched(env, 'batchq');
  listed.length = 0;
  while (new RealDate(now).getUTCMinutes() % 5 !== 0) await minute();
  await minute();
  ok(listed.includes('erasepend:'), 'the pending erasure is listed again', listed);
  ok(listed.includes('agentjarpend:'), 'the sign-in copy to forget is listed again', listed);
  ok(listed.includes('batchq:'), 'the queued batch is listed again', listed);
  ok(!kv.has('qempty:erasepend') || kv.has('erasepend:late@example.com') === false, 'an empty marker never stands beside a waiting erasure it would hide');
}

console.log = quiet; console.warn = qw;
report();
done();
