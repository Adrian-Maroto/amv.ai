/* AN API KEY IS NOT THE PERSON (Nov 14).

   An API key is a credential somebody pastes into a script. It may ask the
   model things. It may not do what only the person holding the account may
   do: add or remove a passkey or a second step, end sessions, change how
   extra usage is charged, change or delete an agent or forget its sign-ins,
   register a device for notifications, act on a connected account, reach
   the files in the account, or delete the account.

   Each of those routes refuses a key by itself, in some thirty places, and a
   mutation that removed one of them (an agent's kept sign-in) passed every
   suite: most had never been driven with a key at all. This suite makes a
   real key and drives every one. The same request with the person's own
   session must NOT be refused the same way - so what is proved is that the
   key is the reason, not that the route refuses everybody. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'keynotperson.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());
const quiet = console.log; console.log = (...a) => { if (String(a[0]).startsWith('AUDIT')) return; quiet(...a); };

const m = new Map(), vals = new Map(), r2 = new Map();
const env = {
  JWT_SECRET: 'j'.repeat(40), APP_URL: 'https://amv.test', CONNECT_KEY: 'c'.repeat(44),
  VAPID_PUBLIC_KEY: 'BPublicKeyForTheTestOnly', VAPID_PRIVATE_KEY: 'private-for-the-test-only', VAPID_SUBJECT: 'mailto:ops@amv.test',
  AMV_FILES: { async put(k, v) { r2.set(k, String(v)); return {}; }, async get(k) { return r2.has(k) ? { text: async () => r2.get(k) } : null; }, async delete(k) { r2.delete(k); },
    async list({ prefix } = {}) { return { objects: [...r2.keys()].filter(k => k.startsWith(prefix || '')).map(key => ({ key })), truncated: false }; } },
  AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, String(v)); }, async delete(k) { m.delete(k); },
    async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: withAuthOps({ idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse((init && init.body) || '{}'); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
    if (b.op === 'claim') { if (vals.get(n)) return r({ claimed: false }); vals.set(n, 1); return r({ claimed: true, owner: n }); }
    if (b.op === 'release') { vals.delete(n); return r({ ok: true }); }
    if (b.op === 'incr') { vals.set(n, cur + Number(b.amount || 0)); return r({ value: vals.get(n) }); }
    return r({ allowed: true, value: cur, count: 1, ok: true });
  } }) }),
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
let ip = 1;
const call = async (method, path, body, bearer) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.8.0.' + (ip++ % 200 + 1), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};

const ME = 'rosa@example.com', PW = 'correct horse battery staple';
const tok = (await call('POST', '/auth/signup', { email: ME, name: 'Rosa', password: PW })).d.token;
await W.DB.put(env, 'ent', ME, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
const key = (await call('POST', '/v1/keys/create', { name: 'k' }, tok)).d.key || '';

section('There is a session and a real key to compare');
ok(!!tok && /^amv_/.test(key), 'the account signed up and made an API key', [!!tok, key.slice(0, 6)]);
const works = await call('POST', '/v1/keys/list', {}, tok);
ok(works.status === 200, 'and the session is good', works.status);

/* What "refused because it is a key" looks like, across the four ways the
   Worker says it. */
const refusedAsKey = (r) => (r.status === 401 && r.d.error === 'unauthorized')
  || (r.status === 403 && ['session_only', 'session_required', 'reauth_required'].includes(r.d.code));

const ROUTES = [
  ['GET',  '/v1/sessions', null, 'list where the account is signed in'],
  ['POST', '/v1/sessions/end', { id: 'x' }, 'end a session'],
  ['POST', '/v1/credit/mode', { mode: 'auto' }, 'change how extra usage is charged'],
  ['POST', '/v1/firstgoal', { goal: 'write' }, 'record the account’s first goal'],
  ['POST', '/auth/passkey/options', { purpose: 'stepup' }, 'ask for a proof challenge'],
  ['POST', '/auth/passkey/options', { purpose: 'register', proof: { password: PW } }, 'start adding a passkey, even with the password'],
  ['POST', '/auth/passkey/register', { cid: 'x', credential: {} }, 'add a passkey'],
  ['POST', '/auth/security', {}, 'read what guards the account'],
  ['POST', '/auth/passkey/remove', { id: 'x', proof: { password: PW } }, 'remove a passkey'],
  ['POST', '/auth/totp/start', { proof: { password: PW } }, 'start an authenticator app'],
  ['POST', '/auth/totp/confirm', { code: '000000' }, 'confirm an authenticator app'],
  ['POST', '/auth/totp/disable', { proof: { password: PW } }, 'turn the second step off'],
  ['POST', '/auth/recovery/new', { proof: { password: PW } }, 'make new recovery codes'],
  ['POST', '/v1/agents/save', { agent: { name: 'A', instructions: 'be brief' } }, 'make or change an agent'],
  ['POST', '/v1/agents/delete', { id: 'x' }, 'delete an agent'],
  ['POST', '/v1/agents/signins/forget', { id: 'x', site: 'example.com' }, 'forget an agent’s kept sign-in'],
  ['GET',  '/v1/push', null, 'read the notification setup'],
  ['POST', '/v1/push/subscribe', { subscription: { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } } }, 'register a device for notifications'],
  ['POST', '/v1/push/unsubscribe', { endpoint: 'https://push.example/x' }, 'remove a device'],
  ['POST', '/v1/push/test', {}, 'send a test notification'],
  ['POST', '/v1/connect/api', { provider: 'microsoft', method: 'GET', path: 'me' }, 'call a connected app'],
  ['POST', '/v1/connect/act', { action: 'gmail.send', args: {} }, 'act on a connected account'],
  ['POST', '/v1/connect/undo', { ticket: 'x' }, 'take an action back'],
  ['POST', '/v1/remote/start', { slug: 'x' }, 'connect an app'],
  ['POST', '/v1/remote/finish', { code: 'x', state: 'y' }, 'finish connecting an app'],
  ['POST', '/v1/remote/remove', { slug: 'x' }, 'disconnect an app'],
  ['POST', '/v1/remote/tools', { slug: 'x' }, 'list a connected app’s tools'],
  ['POST', '/v1/remote/call', { slug: 'x', tool: 't', args: {} }, 'use a connected app’s tool'],
  ['GET',  '/v1/library', null, 'list the files in the account'],
  ['POST', '/v1/library/put', { sig: 'text|a.txt|2', kind: 'text', name: 'a.txt', size: 2, body: 'hi' }, 'keep a file in the account'],
  ['GET',  '/v1/library/get?id=x', null, 'open a file in the account'],
  ['POST', '/v1/library/delete', { ids: ['x'] }, 'delete files in the account'],
  ['POST', '/v1/library/move', { ids: ['x'], folder: 'A' }, 'move files in the account'],
  ['POST', '/v1/library/search', { query: 'anything at all' }, 'search inside the files'],
  ['POST', '/auth/delete', { password: PW }, 'delete the account'],
];

section('Every one of them refuses the key - and not the person');
let n = 0;
for (const [method, path, body, what] of ROUTES) {
  const k = await call(method, path, body, key);
  ok(refusedAsKey(k), 'a key cannot ' + what + '  (' + method + ' ' + path + ')', [k.status, k.d.error, k.d.code]);
  if (path === '/auth/delete') continue;                // the person's own request would really delete it
  const p = await call(method, path, body, tok);
  ok(!refusedAsKey(p), '    while the person is not turned away as a key would be', [p.status, p.d.error, p.d.code]);
  n++;
}
ok(n >= 30, 'thirty or more routes were driven both ways', n);

section('The whole router: a key reaches the API and nothing else');
{
  /* The list above is the routes somebody thought of. This is every route
     there is, read out of the router - because the defect was never a missing
     refusal on a route somebody had considered. Before Nov 14 a key was
     admitted to 157 of them: it could make more keys, approve an action
     waiting for the person, change a spending limit, manage a team, export
     the account. A route counts as reached when the key gets an answer that
     nobody-signed-in is refused. */
  const API = /^(?:\/v1\/(?:messages(?:\/count_tokens|\/batches(?:\/(?:list|get|results|cancel))?)?|tasks(?:\/cancel)?|resume|stop|usage)|\/team\/audit\/export)$/;
  const src = readFileSync(join(ROOT, 'src', 'worker', '29-router.js'), 'utf8');
  const paths = [...new Set([...src.matchAll(/case '(\/[^']+)':/g)].map(x => x[1]))].filter(p => !/^\/admin|webhook|\/auth\/delete$/.test(p));
  ok(paths.length > 200, 'the router was read: more than two hundred routes', paths.length);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  const reached = [], apiSeen = [];
  try {
    for (const p of paths) {
      let method = 'POST', k = await call('POST', p, {}, key);
      if (k.status === 405) { method = 'GET'; k = await call('GET', p, undefined, key); }
      if (refusedAsKey(k)) continue;
      const anon = await call(method, p, method === 'GET' ? undefined : {}, null);
      if (anon.status !== 401) continue;              // open to everybody: the key added nothing
      if (k.status === 401) continue;                 // refused both: a sign-in route saying a credential is wrong
      (API.test(p) ? apiSeen : reached).push(p + ' -> ' + k.status);
    }
  } finally { globalThis.fetch = realFetch; }
  ok(reached.length === 0, 'outside the API, no route answers a key that it refuses nobody-signed-in', reached.slice(0, 12));
  ok(apiSeen.length >= 10, 'and the API’s own routes do answer it - messages, batches, tasks, usage', apiSeen.length);
  const stray = await call('POST', '/v1/keys/create', { name: 'second' }, key);
  ok(stray.status === 403 && stray.d.code === 'session_required', 'a key cannot make another key', [stray.status, stray.d.code]);
  const appr = await call('POST', '/api/approvals/act', { id: 'x', decision: 'approve' }, key);
  ok(appr.status === 403, 'or approve something that is waiting for the person', appr.status);
  const lim = await call('POST', '/v1/spend/set', { monthly: 5000 }, key);
  ok(lim.status === 403, 'or change a spending limit', lim.status);
  const pull = await call('POST', '/sync/pull', {}, key);
  ok(pull.status === 403, 'or read the account’s synced chats', pull.status);
}

section('The key still does what a key is for');
{
  const r = await call('POST', '/v1/keys/list', {}, tok);
  ok(r.status === 200 && (r.d.keys || []).length === 1, 'it exists, unchanged', r.status);
  ok(!!(await W.DB.get(env, 'acct', ME)), 'and the account is still there');
}

console.log = quiet;
if (report('an-api-key-is-not-the-person') > 0) process.exitCode = 1;
done();
