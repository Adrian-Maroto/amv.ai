/* THE BUILD 17 AUDIT STAYS FIXED (Nov 21).

   The Build 17 audit came with probes that reproduced each failure against the
   source. Each one is here, run against the real Worker rather than an
   isolated copy of one function, and each asserts the fixed behaviour - so the
   day one comes back, this says which.

   Covered elsewhere, and not repeated: company sign-in binding and a callback
   used twice (a-company-signs-in-only-its-own-people), the sign-in code when
   mail is refused (a-code-is-the-other-half-of-the-key), an undo ticket sent
   twice (what-amv-did-can-be-taken-back), a purchase hold retried and a
   receipt the page says it saw (a-purchase-is-held-against-your-limits-first,
   a-purchase-closes-once). */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'build17.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { DB, issueTokens, authLogout, authRefresh, passkeyOptions, authSsoStart, _revRead, RecordSettlingError, _autoEnqueue, _resolvesPrivate, fetchGuarded, _withAcct };\n');
const W = await import(harness + '?t=' + Date.now());

let dns = 'ok';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url && url.url ? url.url : url);
  if (u.startsWith('https://cloudflare-dns.com/dns-query')) {
    if (dns === 'down') throw new TypeError('fetch failed');
    if (dns === 'garbled') return new Response('<html>busy</html>', { status: 200 });
    if (dns === 'error') return new Response('', { status: 502 });
    if (dns === 'private') return new Response(JSON.stringify({ Status: 0, Answer: /type=A&/.test(u) ? [{ type: 1, data: '10.0.0.7' }] : [] }), { status: 200 });
    if (dns === 'nxdomain') return new Response(JSON.stringify({ Status: 3 }), { status: 200 });
    return new Response(JSON.stringify({ Status: 0, Answer: /type=A&/.test(u) ? [{ type: 1, data: '93.184.216.34' }] : [] }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
};

function mkEnv(extra) {
  const m = new Map();
  const env = Object.assign({
    _kv: m,
    AMV_KV: {
      async get(k) { if (env._hide && env._hide(k)) return null; return m.has(k) ? m.get(k) : null; },
      async put(k, v) { if (env._drop && env._drop(k)) return; m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, cursor, limit } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }; },
    },
    AMV_COUNTER: withAuthOps({ idFromName: (n) => n, get: () => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body);
      if (b.op === 'rateCheck') return new Response(JSON.stringify({ allowed: true, value: 1 }));
      return new Response(JSON.stringify({ value: 0 }));
    } }) }),
    JWT_SECRET: 'j'.repeat(40), APP_URL: 'https://amv.test',
  }, extra || {});
  return env;
}
const post = (path, body, token) => new Request('https://api.amv.test' + path, { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '61.61.61.61', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: JSON.stringify(body || {}) });
const out = async (r) => ({ status: r.status, d: await r.json().catch(() => ({})) });

section('Signing out of this device says done only when the server said so (AMV17-T01, D17-AUTH-01)');
{
  const env = mkEnv();
  const t = await W.issueTokens(env, 'a@x.test', 'A', 'sid-a');
  env.AMV_COUNTER.fault = (_n, b) => b.op === 'authEndSession' ? new Response(JSON.stringify({ seeded: true, epoch: 0 })) : null;
  const r = await out(await W.authLogout(post('/auth/logout', { refreshToken: t.refreshToken }, t.token), env));
  ok(r.status === 202 && r.d.pending === true && r.d.code === 'signout_unconfirmed' && r.d.ok === false,
     'an answer that is not "ended" is not taken as one: pending, and said', r);
  env.AMV_COUNTER.fault = null;
  const t2 = await W.issueTokens(env, 'a@x.test', 'A', 'sid-b');
  const r2 = await out(await W.authLogout(post('/auth/logout', { refreshToken: t2.refreshToken }, t2.token), env));
  ok(r2.status === 200 && r2.d.ok === true && r2.d.scope === 'device', 'when the object confirms it, it is done', r2);
  const t3 = await W.issueTokens(env, 'a@x.test', 'A', 'sid-c');
  env.AMV_COUNTER.fault = (_n, b) => b.op === 'claim' ? new Response('down', { status: 503 }) : null;
  const r3 = await out(await W.authLogout(post('/auth/logout', { refreshToken: t3.refreshToken }, t3.token), env));
  env.AMV_COUNTER.fault = null;
  ok(r3.status === 202 && r3.d.pending === true, 'nor when the refresh token could not be retired: it might still renew', r3);
}

section('Signing out everywhere says done only when every sign-in ended (D17-003)');
{
  const env = mkEnv();
  const t = await W.issueTokens(env, 'b@x.test', 'B', 'sid-1');
  env.AMV_COUNTER.fault = (_n, b) => b.op === 'authRevokeAll' ? new Response('{}') : null;
  const r = await out(await W.authLogout(post('/auth/logout', { everywhere: true }, t.token), env));
  ok(r.status === 202 && r.d.scope === 'all' && r.d.pending === true, 'an unconfirmed revocation is pending, not "signed out everywhere"', r);
  env.AMV_COUNTER.fault = null;
}

section('Two tabs renewing together do not sign the account out (D17-AUTH-02)');
{
  const env = mkEnv();
  /* The KV mark written by the first renewal has not reached this region. */
  env._drop = (k) => k.startsWith('rtgrace:');
  const t = await W.issueTokens(env, 'c@x.test', 'C', '');
  const first = await out(await W.authRefresh(post('/auth/refresh', { refreshToken: t.refreshToken }), env));
  const second = await out(await W.authRefresh(post('/auth/refresh', { refreshToken: t.refreshToken }), env));
  ok(first.status === 200 && second.status === 200 && second.d.token, 'the second is the overlap the object timed, not a theft', [first.status, second.status, second.d.error]);
  const t2 = await W.issueTokens(env, 'c@x.test', 'C', '');
  ok(!!(await W.authRefresh(post('/auth/refresh', { refreshToken: t2.refreshToken }), env)).ok, 'and the account is still signed in');
  /* A real replay, long after: the first use the object recorded is old. */
  env.AMV_COUNTER.fault = (_n, b) => b.op === 'claim' ? new Response(JSON.stringify({ claimed: false, until: Date.now() + 1e9, at: Date.now() - 3600e3, note: 'renew' })) : null;
  const replay = await out(await W.authRefresh(post('/auth/refresh', { refreshToken: t2.refreshToken }), env));
  env.AMV_COUNTER.fault = null;
  ok(replay.status === 401 && /already used/.test(replay.d.error || ''), 'a reuse an hour later is still a replay', replay);
  /* Spent by its own device signing out: refused, not a theft. */
  const t3 = await W.issueTokens(env, 'c@x.test', 'C', '');
  env.AMV_COUNTER.fault = (_n, b) => b.op === 'claim' ? new Response(JSON.stringify({ claimed: false, until: Date.now() + 1e9, at: Date.now() - 2000, note: 'out' })) : null;
  const after = await out(await W.authRefresh(post('/auth/refresh', { refreshToken: t3.refreshToken }), env));
  env.AMV_COUNTER.fault = null;
  ok(after.status === 401 && after.d.code === 'signed_out', 'a renewal after this device signed out is "signed out", nothing more', after);
}

section('An undecided rate limit is a bound, not an open door (D17-AUTH-04, D17-AUTH-05)');
{
  const env = mkEnv({ APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test' });
  env.AMV_COUNTER.fault = (_n, b) => b.op === 'rateCheck' ? new Response('down', { status: 503 }) : null;
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await W.passkeyOptions(new Request('https://api.amv.test/auth/passkey/options', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '62.62.62.62' }, body: '{"purpose":"signin"}' }), env)).status);
  ok(codes.slice(0, 5).every(c => c === 200) && codes.slice(5).every(c => c === 429), 'passkey challenges: a few still go through, then this instance stops minting them', codes);
  const sso = [];
  for (let i = 0; i < 8; i++) sso.push((await W.authSsoStart(new Request('https://api.amv.test/auth/sso/start', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '63.63.63.63' }, body: '{"email":"x@nowhere.test"}' }), env)).status);
  ok(sso.slice(0, 5).every(c => c !== 429) && sso.slice(5).every(c => c === 429), 'company sign-in starts: the same', sso);
  env.AMV_COUNTER.fault = null;
}

section('A page of records says which it could not read (D17-DB-01)');
{
  const env = mkEnv();
  env._kv.set('ent:a@x.test', JSON.stringify({ plan: 'pro' }));
  env._kv.set('ent:b@x.test', '{not json');
  env._kv.set('ent:c@x.test', JSON.stringify({ plan: 'free' }));
  const p = await W.DB.page(env, 'ent', '', 500);
  ok(p.rows.length === 2 && Array.isArray(p.unreadable) && p.unreadable.includes('b@x.test'), 'the unreadable record is named, not skipped in silence', p);
}

section('No copy here is not "it does not exist" while the authority is unreachable (AMV17-T02, B17-002)');
{
  const env = mkEnv();
  env.AMV_COUNTER.fault = (_n, b) => b.op === 'revGet' ? new Response('down', { status: 503 }) : null;
  let threw = null;
  try { await W._revRead(env, 'acct', 'd@x.test', null); } catch (e) { threw = e; }
  ok(threw instanceof W.RecordSettlingError, 'a missing local copy is a short wait, not absent', threw && threw.name);
  env.AMV_COUNTER.fault = null;
}

section('A job message is sealed or not sent (B17-022)');
{
  const sent = [];
  const env = mkEnv({ AMV_JOBS: { async sendBatch(b) { sent.push(...b); } } });
  delete env.JWT_SECRET;   /* the queue's key is derived from it */
  const r = await W._autoEnqueue(env, [{ id: 'e@x.test', soonest: 1 }], Date.now());
  ok(sent.length === 0 && r.unsent.length === 1, 'with no key to seal it, the account runs inline instead', r);
  ok(!JSON.stringify(sent).includes('e@x.test'), 'and no address goes onto the queue', sent);
}

section('An address nobody could look up is not opened (B17-023)');
{
  for (const mode of ['down', 'garbled', 'error']) {
    dns = mode;
    const g = await W.fetchGuarded('https://' + mode + '.example.net/', {}, 3000);
    ok(g.blocked === true && /could not check where that address points/.test(g.why), 'lookup ' + mode + ': refused, and said why', g);
  }
  dns = 'private';
  const p = await W.fetchGuarded('https://example.com/', {}, 3000);
  ok(p.blocked === true && /private or internal/.test(p.why), 'a private answer is still refused as private', p.why);
  dns = 'nxdomain';
  ok((await W._resolvesPrivate('nothing-here.example')) === false, 'a name that does not exist is an answer, not unknown');
  dns = 'ok';
  const g = await W.fetchGuarded('https://public.example.org/', {}, 3000);
  ok(g.blocked === false, 'and a public answer goes through', g.why);
}

section('On a database deployment, a stale whole record cannot overwrite a newer one (B17-009)');
{
  /* An in-memory D1 that answers the way D1 does: rows with their stamp, and
     how many rows each write changed. */
  const rows = new Map();
  const d1 = { prepare(q) { return { bind(...a) { return {
    async first() { if (/^SELECT json(, updated_at)? FROM kv/.test(q)) { const v = rows.get(a[0] + ':' + a[1]); return v ? { json: v.json, updated_at: v.at } : null; } return null; },
    async run() {
      let changes = 0;
      if (/^INSERT INTO kv/.test(q)) { const k = a[0] + ':' + a[1]; if (!(/DO NOTHING/.test(q) && rows.has(k))) { rows.set(k, { json: a[2], at: a[3] }); changes = 1; } }
      else if (/^UPDATE kv SET json=\?, updated_at=\? WHERE kind=\? AND id=\? AND updated_at=\?/.test(q)) { const k = a[2] + ':' + a[3], c = rows.get(k); if (c && c.at === a[4]) { rows.set(k, { json: a[0], at: a[1] }); changes = 1; } }
      else if (/^DELETE FROM kv/.test(q)) changes = rows.delete(a[0] + ':' + a[1]) ? 1 : 0;
      return { meta: { changes } };
    },
    async all() { return { results: [] }; } }; } }; } };
  const env = mkEnv({ DB: d1, DATA_STORE: 'd1' });
  env.AMV_COUNTER = withAuthOps({ idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0 })); } }) });
  await W.DB.put(env, 'acct', 'f@x.test', { email: 'f@x.test', name: 'F', mfa: false });
  let err = null;
  try {
    await W._withAcct(env, 'f@x.test', async (a) => {
      /* Meanwhile - its lock lapsed - somebody else turns two-step on. */
      const k = 'acct:f@x.test', cur = rows.get(k);
      rows.set(k, { json: JSON.stringify(Object.assign(JSON.parse(cur.json), { mfa: true })), at: cur.at + 5 });
      a.name = 'F renamed';
      return a;
    });
  } catch (e) { err = e; }
  const now = JSON.parse(rows.get('acct:f@x.test').json);
  ok(err && err.code === 'record_busy' && now.mfa === true && now.name === 'F', 'the stale write is refused, and the newer security setting stays', [err && err.code, now]);
  const r = await W._withAcct(env, 'f@x.test', async (a) => { a.name = 'F again'; return a; });
  const after = JSON.parse(rows.get('acct:f@x.test').json);
  ok(after.name === 'F again' && after.mfa === true, 'a change from the current row goes through', after);
  await W._withAcct(env, 'f@x.test', async (a) => { a.name = 'one'; await W.DB.put(env, 'acct', 'f@x.test', a); a.name = 'two'; return a; });
  ok(JSON.parse(rows.get('acct:f@x.test').json).name === 'two', 'and a holder that writes twice is still the holder');
}

globalThis.fetch = realFetch;
if (report('the-build-17-audit-stays-fixed') > 0) process.exitCode = 1;
done();
