/* CAN B READ A'S THINGS?

   cross-account-writes covers one direction: every handler that writes outside
   the caller's own key is classified, so a new one cannot appear unnoticed. The
   other direction had nothing. A read that returns somebody else's record is
   quieter than a write - nobody's data changes, no audit line looks wrong, and
   the only symptom is a person seeing something that was never theirs.

   Source-scanning does not work for this. The writes check says so in its own
   header: a version that tried to detect a missing ownership comparison on the
   read side produced six false positives, and a checker that cries wolf is one
   somebody deletes.

   So this is behavioural and it is blunt. Account A is seeded with a canary
   string in every per-user store there is. Then account B - a real, ordinary,
   fully signed-in account - calls every route that reads per-user data, naming
   A wherever a route will accept a name. The assertion is one sentence: the
   canary never appears in any response to B.

   It goes through the worker's real router with real tokens, so it covers the
   routing and the auth as they actually ship, not handler by handler. A route
   that 403s, 404s or returns B's own empty data all pass; the only failure is
   A's data arriving. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'xread.harness.mjs');
writeFileSync(harness, src + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const CANARY = 'CANARY-PRIVATE-TO-ALICE-9f3a';
const A = 'alice@example.com';
const B = 'mallory@example.com';
const PW = 'A-real-Passw0rd!';

const kv = (() => {
  const m = new Map();
  return {
    _map: m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix, limit } = {}) {
      let keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
      if (limit) keys = keys.slice(0, limit);
      return { keys, list_complete: true };
    },
  };
})();
const env = { AMV_KV: kv, JWT_SECRET: 'test-jwt-secret', ADMIN_TOKEN: 'admin-token-secret', APP_URL: 'https://amv.test' };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const call = (path, { token, body, method } = {}) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: method || (body === undefined ? 'GET' : 'POST'),
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
    token ? { Authorization: 'Bearer ' + token } : {}),
  body: body === undefined ? undefined : JSON.stringify(body),
}), env, ctx);

async function signup(email) {
  const r = await call('/auth/signup', { body: { email, name: email.split('@')[0], password: PW } });
  const d = await r.json().catch(() => ({}));
  return d.token || '';
}

const tokA = await signup(A);
const tokB = await signup(B);

section('Two real accounts exist');
{
  ok(!!tokA && !!tokB, 'both signed up and hold tokens', { a: !!tokA, b: !!tokB });
  ok(tokA !== tokB, 'and they are different people', true);
}

section("A's things are seeded, everywhere a person's things live");
{
  /* Written straight to storage rather than through each feature's own flow:
     the point is coverage of the READ side, and a canary in every store is a
     stronger starting position than whatever a happy path happens to create. */
  const seeded = [
    ['ent', A, { plan: 'ultra', note: CANARY, updatedAt: Date.now() }],
    ['data', A, { chats: [{ id: 'c1', title: CANARY, msgs: [{ role: 'user', content: CANARY }] }] }],
    ['auto', A, { list: [{ id: 'au1', name: CANARY, prompt: CANARY }] }],
    ['approvals', A, { items: [{ id: 'ap1', what: CANARY }] }],
    ['handoff', A, { items: [{ id: 'h1', title: CANARY }] }],
    ['crewjobs', A, { jobs: [{ id: 'j1', goal: CANARY }] }],
    ['purchases', A, { items: [{ id: 'p1', title: CANARY }] }],
    ['wallet', A, { balance: 4242, note: CANARY }],
    ['wallet_tx', A, [{ type: 'sale', amount: 42, memo: CANARY }]],
    ['seller', A, { displayName: CANARY }],
    ['apikeys', A, { keys: [{ id: 'k1', label: CANARY, hash: 'x' }] }],
    ['shares', A, { items: [{ id: 's1', title: CANARY }] }],
    ['sites', A, { slugs: [CANARY] }],
    ['spendlimits', A, { dailyUSD: 5, note: CANARY }],
    ['fam', A, { children: [{ email: CANARY }] }],
    ['links', A, { granted: [{ to: CANARY }] }],
    ['support', A, { tickets: [{ id: 't1', text: CANARY, at: Date.now() }] }],
    ['widget', A, { name: CANARY }],
    ['consent', A, { birthYear: 1990, note: CANARY }],
    ['fin', A, { token: CANARY }],
  ];
  for (const [kind, id, val] of seeded) await W.DB.put(env, kind, id, val);
  await kv.put('resume:' + A + ':r1', JSON.stringify({ text: CANARY }));
  const back = await W.DB.get(env, 'data', A);
  ok(JSON.stringify(back).includes(CANARY), 'the canary really is in storage', true);
}

/* Every route that reads something belonging to a person, with A named
   wherever the route will take a name. A route that ignores the name and
   answers about the CALLER is the correct behaviour and passes; so is a 403,
   a 404, or an empty list. The only failure is A's canary coming back. */
const READS = [
  ['/v1/entitlement?email=' + encodeURIComponent(A), {}],
  ['/v1/activity', { body: { email: A } }],
  ['/v1/usage', { body: { email: A } }],
  ['/v1/resume', { body: { email: A, id: 'r1' } }],
  ['/v1/keys/list', { body: { email: A } }],
  ['/v1/share/list', { body: { email: A } }],
  ['/v1/referral', { body: { email: A } }],
  ['/sync/pull', { body: { email: A } }],
  ['/auto/list', { body: { email: A } }],
  ['/auto/read', { body: { email: A, id: 'au1' } }],
  ['/api/jobs', { body: { email: A } }],
  ['/api/approvals', { body: { email: A } }],
  ['/api/handoff', { body: { email: A } }],
  ['/deploy/list', { body: { email: A } }],
  ['/v1/spend/limits', { body: { email: A } }],
  ['/v1/family/get', { body: { email: A } }],
  ['/v1/link/list', { body: { email: A } }],
  ['/v1/consent', { body: { email: A } }],
  ['/v1/finance/status', { body: { email: A } }],
  ['/v1/market/purchases', { body: { email: A } }],
  ['/v1/market/earnings', { body: { email: A } }],
  ['/v1/market/mylistings', { body: { email: A } }],
  ['/v1/market/threads', { body: { email: A } }],
  ['/v1/market/status', { body: { email: A } }],
  ['/v1/account/export', { body: { email: A } }],
  ['/v1/widget/config', { body: { email: A } }],
  ['/team/get', { body: { email: A } }],
  ['/team/data', { body: { email: A } }],
  ['/team/shared', { body: { email: A } }],
  ['/team/members', { body: { email: A } }],
  ['/errors/list', { body: { email: A } }],
];

section('Nothing of A’s reaches B, through any route that reads');
{
  const leaked = [];
  const reached = [];
  for (const [path, opts] of READS) {
    let r, text;
    try {
      r = await call(path, Object.assign({ token: tokB }, opts));
      text = await r.text();
    } catch (e) { text = ''; r = { status: 0 }; }
    reached.push(path.split('?')[0] + ' ' + (r.status || 0));
    if (text.includes(CANARY)) leaked.push(path.split('?')[0] + ' -> ' + text.slice(0, 160));
  }
  ok(reached.length === READS.length, 'every route was actually called', reached.length);
  /* If they all 404 the sweep is measuring nothing - a typo in a path would
     make this file pass by never reaching a handler. */
  const answered = reached.filter(x => !/ 404$/.test(x)).length;
  ok(answered >= READS.length - 3,
     'and the routes exist, so this is a real sweep and not a list of typos',
     reached.filter(x => / 404$/.test(x)));
  ok(leaked.length === 0,
     'B receives nothing that belongs to A, from any of them', leaked);
}

section('And the admin surfaces are not a way round it');
{
  /* Every operator surface holds everybody's data by design, so the only thing
     between B and all of it is the token check. */
  const adminish = ['/v1/admin/stats', '/v1/admin/finance', '/v1/admin/support',
                    '/admin/readiness', '/admin/payouts', '/admin/abuse/list',
                    '/admin/backup/export', '/v1/admin/user'];
  const leaked = [];
  for (const path of adminish) {
    const r = await call(path, { token: tokB, body: { email: A } });
    const text = await r.text();
    if (r.status < 400) leaked.push(path + ' answered ' + r.status);
    if (text.includes(CANARY)) leaked.push(path + ' LEAKED');
  }
  ok(leaked.length === 0, 'an ordinary account is refused by every one of them', leaked);
}

section('A signed-in stranger is still a stranger');
{
  /* The failure mode this whole file is about is a route that checks whether
     you are signed in and then trusts the name you sent. So: no token at all
     must fail too, or "authenticated" was doing all the work. */
  const noTok = [];
  for (const [path, opts] of READS.slice(0, 12)) {
    const r = await call(path, opts);
    const text = await r.text();
    if (text.includes(CANARY)) noTok.push(path);
  }
  ok(noTok.length === 0, 'and an unauthenticated caller gets nothing either', noTok);
}

section('A can still read A’s own things');
{
  /* The other half. A sweep that passes because every route refuses everybody
     proves nothing and would hide a product that had stopped working. */
  const r = await call('/v1/account/export', { token: tokA, body: {} });
  const text = await r.text();
  ok(r.status === 200, 'their own export is served', r.status);
  ok(text.includes(CANARY),
     'and it really contains their data, so the sweep above means something', text.length);
}

if (report('nothing-of-yours-reaches-them') > 0) process.exitCode = 1;
done();
