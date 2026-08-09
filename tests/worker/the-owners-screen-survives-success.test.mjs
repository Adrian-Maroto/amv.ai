/* THE ADMIN SCREEN GOT WORSE EVERY TIME AMV SUCCEEDED AT ANYTHING.

   The user list did six storage round trips per account, across up to three
   hundred of them: eighteen hundred in one request, for one screen. A Worker
   has a ceiling on how many it may make, so this was on a countdown to failing
   outright - and long before that it was simply slow, in a way that got worse
   with every account gained. The owner's own Control Center, degrading in
   proportion to the business working.

   The shape of the fix matters more than the number. Two of the six kinds are
   now read once for the whole page instead of once per account, and the rest
   are read only for the page being looked at. Nothing is dropped from the
   screen; it arrives in pieces, and the count says which pieces.

   What must not have been traded away: the numbers have to still be right, a
   page must not silently become the whole truth, and an operator must never
   read a count off this screen and believe it is the size of the business. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ownerscreen.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, setEntitlement, ADMIN_USERS_PAGE, ADMIN_USERS_LIMIT };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

/* Every storage touch is counted, because the whole point is how many there
   are. A test that only checked the rows would pass at eighteen hundred reads. */
function mkEnv() {
  const m = new Map(); const n = new Map();
  const reads = { kv: 0, counter: 0, list: 0 };
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'a',
    APP_URL: 'https://amv.test', OWNER_EMAIL: 'owner@example.com',
    _reads: reads,
    AMV_KV: {
      _map: m,
      async get(k) { reads.kv++; return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        reads.list++;
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        const from = cursor ? +cursor : 0;
        const page = all.slice(from, from + (limit || 1000));
        return { keys: page, list_complete: from + page.length >= all.length, cursor: String(from + page.length) };
      },
    },
    AMV_COUNTER: {
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
        reads.counter++;
        const b = JSON.parse(init.body); const cur = n.get(x) || 0;
        if (b.op === 'claim') { if (n.has('c:' + x)) return new Response(JSON.stringify({ claimed: false })); n.set('c:' + x, 1); return new Response(JSON.stringify({ claimed: true })); }
        if (b.op === 'release') { n.delete('c:' + x); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'incr') { n.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: n.get(x) })); }
        if (b.op === 'rateCheck') { n.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const PW = 'A-real-Passw0rd!';
const OWNER = 'owner@example.com';

const call = (env, path, body, tok, method) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: method || 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '88.88.88.88',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: (method === 'GET') ? undefined : JSON.stringify(body || {}),
}), env, ctx);

async function anOwnerAndSomeAccounts(env, howMany) {
  const tok = (await (await call(env, '/auth/signup', { email: OWNER, name: 'Olive', password: PW })).json()).token;
  /* Written straight in. Signing each one up would test signup, and would take
     as long as the thing being measured. */
  for (let i = 0; i < howMany; i++) {
    const em = 'person' + i + '@example.com';
    await W.DB.put(env, 'acct', em, { email: em, name: 'P' + i, createdAt: Date.now(), provider: 'email' });
    await W.DB.put(env, 'ent', em, { plan: i % 5 === 0 ? 'pro' : 'free', source: 'stripe' });
    if (i % 20 === 0) await W.DB.put(env, 'abuse', em, { blocked: true, disputes: 2 });
  }
  return tok;
}
const usersPage = async (env, tok, offset, limit) => {
  const q = '?offset=' + (offset || 0) + (limit ? '&limit=' + limit : '');
  const r = await call(env, '/admin/users' + q, null, tok, 'GET');
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

section('The owner can see their accounts');
{
  const env = mkEnv();
  const tok = await anOwnerAndSomeAccounts(env, 12);
  const r = await usersPage(env, tok, 0);
  ok(r.status === 200, 'the screen loads', r.status);
  ok((r.body.users || []).length === 13, 'everybody is on it, owner included', (r.body.users || []).length);
  const one = (r.body.users || []).find(u => u.email === 'person0@example.com') || {};
  ok(one.plan === 'pro', 'with the plan from the entitlement record, not the account row', one.plan);
  ok(one.flagged === true, 'and the abuse flag that belongs to them', one.flagged);
  const clean = (r.body.users || []).find(u => u.email === 'person1@example.com') || {};
  ok(clean.flagged === false, 'and somebody else’s flag is not on them', clean.flagged);
}

section('A big account base costs one page of reads, not one per account');
{
  /* The measurement the whole change is about. At six reads each, two hundred
     accounts was twelve hundred round trips in a single request. */
  const cost = async (howMany) => {
    const env = mkEnv();
    const tok = await anOwnerAndSomeAccounts(env, howMany);
    const before = { ...env._reads };
    const r = await usersPage(env, tok, 0);
    const after = env._reads;
    return { status: r.status, rows: (r.body.users || []).length,
             touches: (after.kv - before.kv) + (after.counter - before.counter) + (after.list - before.list) };
  };

  const small = await cost(100);
  const big = await cost(200);
  ok(big.status === 200, 'the screen still loads at two hundred accounts', big.status);
  ok(big.touches < 1000, 'one request stays well inside what a Worker may do', big.touches);

  /* The property, stated as growth rather than as a total. Listing the accounts
     costs one read each on KV and there is no way round that without a second
     index - but the six-reads-of-DETAIL each was the part that made this a
     countdown, and that is now bounded by the page. So a hundred more accounts
     may add about a hundred touches. Six hundred means the detail is being
     fetched for everybody again. */
  const perExtraAccount = (big.touches - small.touches) / 100;
  ok(perExtraAccount < 3,
     'a hundred more accounts cost about a hundred more reads, not six hundred',
     +perExtraAccount.toFixed(2));
  ok(big.rows === small.rows,
     'and the page is the same size either way, which is what bounds it',
     { small: small.rows, big: big.rows });
}

section('A page is not passed off as the whole list');
{
  /* The failure that would replace the old one. An operator reading "60
     accounts" off a screen holding the first sixty of two hundred would go and
     make decisions with that number. */
  const env = mkEnv();
  const tok = await anOwnerAndSomeAccounts(env, 200);
  const r = await usersPage(env, tok, 0);

  ok(r.body.users.length <= W.ADMIN_USERS_PAGE, 'a page is a page', r.body.users.length);
  ok(r.body.total === 201, 'the real number of accounts is stated', r.body.total);
  ok(r.body.hasMore === true, 'and it says there are more', r.body.hasMore);
  ok(/\b201\b/.test(r.body.note || ''), 'in words as well as a number', r.body.note);
}

section('The next page is the next accounts, not the same ones again');
{
  const env = mkEnv();
  const tok = await anOwnerAndSomeAccounts(env, 200);
  const first = await usersPage(env, tok, 0);
  const second = await usersPage(env, tok, first.body.users.length);

  const a = new Set(first.body.users.map(u => u.email));
  const overlap = second.body.users.filter(u => a.has(u.email));
  ok(second.body.users.length > 0, 'the second page has accounts on it', second.body.users.length);
  ok(overlap.length === 0, 'and none of them were on the first', overlap.map(u => u.email).slice(0, 5));
}

section('Walking every page reaches every account, once');
{
  const env = mkEnv();
  const tok = await anOwnerAndSomeAccounts(env, 130);
  const seen = [];
  let offset = 0;
  for (let i = 0; i < 20; i++) {
    const r = await usersPage(env, tok, offset);
    seen.push(...r.body.users.map(u => u.email));
    offset += r.body.users.length;
    if (!r.body.hasMore || !r.body.users.length) break;
  }
  ok(seen.length === 131, 'every account was reached', seen.length);
  ok(new Set(seen).size === seen.length, 'and none of them twice', seen.length - new Set(seen).size);
}

section('A page past the end is empty, not an error and not the first page');
{
  const env = mkEnv();
  const tok = await anOwnerAndSomeAccounts(env, 5);
  const r = await usersPage(env, tok, 500);
  ok(r.status === 200, 'it answers', r.status);
  ok((r.body.users || []).length === 0, 'with nothing on it', (r.body.users || []).length);
  ok(r.body.hasMore === false, 'and does not offer another', r.body.hasMore);
}

section('The page size is a stated ceiling a caller cannot talk past');
{
  /* Otherwise the limit is a suggestion and one request can still ask for
     everything, which is the thing being fixed. */
  const env = mkEnv();
  const tok = await anOwnerAndSomeAccounts(env, 200);
  const r = await usersPage(env, tok, 0, 100000);
  ok(r.body.users.length <= W.ADMIN_USERS_PAGE,
     'asking for everything still gets one page', r.body.users.length);
  ok(r.body.limit <= W.ADMIN_USERS_PAGE, 'and the limit it reports is the real one', r.body.limit);
}

section('Still nobody else’s screen');
{
  const env = mkEnv();
  await anOwnerAndSomeAccounts(env, 3);
  const theirs = (await (await call(env, '/auth/signup', { email: 'nosy@example.com', name: 'N', password: PW })).json()).token;
  const r = await usersPage(env, theirs, 0);
  ok(r.status === 403 || r.status === 401, 'an ordinary account cannot read the user list', r.status);
  ok(!(r.body.users || []).length, 'and gets no accounts', (r.body.users || []).length);
}

globalThis.fetch = realFetch;
if (report('the-owners-screen-survives-success') > 0) process.exitCode = 1;
done();
