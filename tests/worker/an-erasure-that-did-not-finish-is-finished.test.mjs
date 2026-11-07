/* AN ERASURE THAT DID NOT FINISH IS FINISHED - BY AMV, NOT BY HAND
   (Nov 3 audit OPS-004).

   an-erasure-that-half-worked-has-to-say-so holds that a deletion which left
   something behind says so. What happened next was a page to the owner and a
   person finishing it by hand, one account at a time - at a million accounts,
   a queue of legal obligations nobody is working. Now what is left is kept as
   erasepend:<email>, the cron runs the erasure again, the note goes when it
   completes, and the owner is told only when it still has not after many
   tries. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'erase-retry.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { authSignup, authDeleteAccount, runPendingErasures, ERASE_RETRY_MAX };\n');
const W = await import(harness + '?t=' + Date.now());
const told = [];
globalThis.fetch = async (u, init) => { if (String(u) === 'https://hooks.example/owner') told.push(JSON.parse(init.body).text); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; };
const quiet = console.log; console.log = () => {};
const PW = 'correct-horse-9';

function makeEnv() {
  const kv = new Map();
  const env = { _kv: kv, JWT_SECRET: 'test-secret-abcdefghijklmnopqrstuv', ALERT_WEBHOOK: 'https://hooks.example/owner', _fail: null };
  env.AMV_KV = {
    get: async k => (kv.has(k) ? kv.get(k) : null),
    put: async (k, v) => { kv.set(k, String(v)); },
    delete: async k => { if (env._fail && env._fail.test(String(k))) throw new Error('storage fault'); kv.delete(k); },
    list: async ({ prefix, limit }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).slice(0, limit || 1000).map(name => ({ name })), list_complete: true }),
  };
  return env;
}
const post = (path, body, token) => new Request('https://w' + path, { method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body || {}) });
const signup = async (env, email) => (await (await W.authSignup(post('/auth/signup', { email, name: 'T', password: PW }), env)).json());

section('What could not be removed is kept to be finished, and the person is told so');
const env = makeEnv();
{
  const a = await signup(env, 'leave@x.com');
  await env.AMV_KV.put('resetcode:leave@x.com', JSON.stringify({ code: '123456' }));
  env._fail = /^resetcode:/;
  told.length = 0;
  const r = await W.authDeleteAccount(post('/auth/delete', { password: PW }, a.token), env);
  const d = await r.json();
  ok(d.incomplete === true && d.deleted === false, 'the answer still says it is incomplete', d);
  ok(/keeps trying to remove the rest on its own/.test(d.error || ''), 'and that AMV will finish it, not that somebody will by hand', d.error);
  const pend = JSON.parse(env._kv.get('erasepend:leave@x.com') || 'null');
  ok(pend && pend.tries === 1 && pend.failed.length > 0, 'what is left is recorded, with what failed', pend);
  ok(told.length === 0, 'and the owner is not paged for one the cron can finish', told);
}

section('The cron finishes it once the store works, and the note goes with it');
{
  const r1 = await W.runPendingErasures(env, 5);
  ok(r1.tried === 1 && r1.still === 1, 'while the fault lasts it is tried and still pending', r1);
  ok(JSON.parse(env._kv.get('erasepend:leave@x.com')).tries === 2, 'counted as another try');
  env._fail = null;
  const r2 = await W.runPendingErasures(env, 5);
  ok(r2.finished === 1, 'once the store works, the next run finishes it', r2);
  ok(!env._kv.has('resetcode:leave@x.com'), 'the credential that survived is gone');
  ok(!env._kv.has('erasepend:leave@x.com'), 'and so is the note - the address is not kept to remember the deletion');
  const r3 = await W.runPendingErasures(env, 5);
  ok(r3.tried === 0, 'nothing is left to do', r3);
}

section('One that never finishes is told to the owner, after the retries, once');
{
  const e2 = makeEnv();
  const a = await signup(e2, 'stuck@x.com');
  await e2.AMV_KV.put('resetcode:stuck@x.com', JSON.stringify({ code: '1' }));
  e2._fail = /^resetcode:/;
  told.length = 0;
  await W.authDeleteAccount(post('/auth/delete', { password: PW }, a.token), e2);
  for (let i = 1; i < W.ERASE_RETRY_MAX; i++) await W.runPendingErasures(e2, 5);
  ok(told.length === 1 && /did not complete after/i.test(told[0]) && /stuck@x\.com/.test(told[0]), 'after the last try the owner is told what is left, and where', told);
  await W.runPendingErasures(e2, 5);
  ok(told.length === 1, 'and not again that day', told.length);
}

console.log = quiet;
report();
done();
