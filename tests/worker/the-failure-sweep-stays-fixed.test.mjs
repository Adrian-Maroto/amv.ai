/* THE FAILURE SWEEP STAYS FIXED (Nov 22).

   Every catch in the Worker that turned a failure into an answer was read,
   and the ones that turned "could not check" into "checked, all clear" were
   fixed. Then each fix was broken on purpose, and six of them survived: no
   suite noticed. This is where they are noticed. Each case makes the store
   fail exactly where the guard is, and asserts the strict answer. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'failure-sweep.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { _cookiesFromAmvOnly, _bodyCapped, _creditModeChosen, _restoreMerge, _recordTxn, DB };\n');
const W = await import(harness + '?t=' + Date.now());

const logs = [];
const realLog = console.log;
console.log = (...a) => { logs.push(a.map(String).join(' ')); };
const posted = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { posted.push({ url: String(url), body: String((init && init.body) || '') }); return new Response('{}', { status: 200 }); };

function mkEnv(extra, failGet, failPut) {
  const m = new Map();
  return Object.assign({
    _m: m, JWT_SECRET: 'j'.repeat(40), APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test', ALERT_WEBHOOK: 'https://hooks.example/alert',
    AMV_KV: {
      async get(k) { if (failGet && failGet(k)) throw new Error('storage down'); return m.has(k) ? m.get(k) : null; },
      async put(k, v) { if (failPut && failPut(k)) throw new Error('429 Too Many Requests'); m.set(k, String(v)); },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }; },
    },
  }, extra || {});
}
const ctx = () => ({ _p: [], waitUntil(p) { if (p) this._p.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {}, async settle() { await Promise.all(this._p); } });

section('The kill switch, unreadable, counts as on for that run');
{
  logs.length = 0;
  const env = mkEnv(null, (k) => k === 'GLOBAL_KILL');
  const c = ctx();
  await W.default.scheduled({ cron: '*/5 * * * *' }, env, c);
  await c.settle();
  ok(logs.some(l => /paused by GLOBAL_KILL/.test(l)) && logs.some(l => /kill_switch_unreadable/.test(l)),
     'the run is paused, and the unread switch is said', logs.filter(l => /GLOBAL_KILL|kill_switch|cron/.test(l)).slice(0, 4));
  logs.length = 0;
  const env2 = mkEnv();
  const c2 = ctx();
  await W.default.scheduled({ cron: '*/5 * * * *' }, env2, c2);
  await c2.settle();
  ok(!logs.some(l => /paused by GLOBAL_KILL/.test(l)), 'and a switch that reads as off does not pause it - the case above is not a pause for everybody');
}

section('A defence that could not be applied refuses the request');
{
  /* Something that is not a Request: rebuilding it throws, which is the
     failure the two defences used to answer with the request untouched. */
  const odd = { method: 'POST', url: 'https://api.amv.test/auth/refresh', headers: new Headers({ Cookie: 'amv_rt=x', Origin: 'https://stranger.example' }), body: new ReadableStream() };
  const env = mkEnv();
  ok(W._cookiesFromAmvOnly(odd, env) === null, 'the cookie strip says it could not, rather than handing the cookies on');
  ok(W._bodyCapped({ method: 'POST', url: 'https://api.amv.test/v1/chat', headers: new Headers(), body: new ReadableStream() }) === null,
     'and so does the size cap, rather than handing on a body with no cap');
  const r = await W.default.fetch(odd, env, ctx());
  const d = await r.json().catch(() => ({}));
  ok(r.status === 400 && d.code === 'request_unreadable', 'and the router refuses the request', [r.status, d]);
  const fine = await W._cookiesFromAmvOnly(new Request('https://api.amv.test/auth/refresh', { method: 'POST', headers: { Cookie: 'amv_rt=x', Origin: 'https://stranger.example' }, body: '{}' }), env);
  ok(fine && !fine.headers.get('Cookie'), 'while an ordinary request from a stranger’s page still just loses its cookies');
}

section('"Have you chosen how extra usage is paid?" unknown asks again');
{
  const env = mkEnv(null, (k) => k.startsWith('creditpref:'));
  ok((await W._creditModeChosen(env, 'a@x.test')) === false, 'unread is "not said yet", so the question is asked');
  const env2 = mkEnv();
  await W.DB.put(env2, 'creditpref', 'a@x.test', { mode: 'auto' });
  ok((await W._creditModeChosen(env2, 'a@x.test')) === true, 'and a choice that was made reads as made');
}

section('A backup value that does not parse is not restored over a live record');
{
  const env = mkEnv();
  env._m.set('ent:b@x.test', JSON.stringify({ plan: 'free', blocked: true, updatedAt: Date.now() }));
  const r = await W._restoreMerge(env, 'ent:b@x.test', '{not json');
  ok(r && r.unknown === true && !('value' in r), 'it is held back and named, never written over the live one', r);
}

section('A payment line the ledger could not take is said');
{
  posted.length = 0;
  const env = mkEnv(null, null, (k) => k.startsWith('txn:'));
  const out = await W._recordTxn(env, { provider: 'stripe', email: 'c@x.test', amount: 10, currency: 'USD', kind: 'credit', status: 'succeeded', ref: 'pi_1' });
  ok(out === null, 'the write is reported as not done');
  ok(logs.some(l => /txn_record_failed/.test(l)), 'it is in the audit log');
  ok(posted.some(p => /transaction ledger could not be written/.test(p.body)),
     'and the owner is paged, not left with revenue short by a line nobody knows about', posted.map(p => p.body.slice(0, 80)));
}

console.log = realLog;
globalThis.fetch = realFetch;
if (report('the-failure-sweep-stays-fixed') > 0) process.exitCode = 1;
done();
