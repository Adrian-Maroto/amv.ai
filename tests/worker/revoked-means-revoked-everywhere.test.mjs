/* REVOKED MEANS REVOKED, EVERYWHERE, AT ONCE.

   Scale audit, Oct 26, owner yes. "Sign out everywhere", a password change and
   ending a sign-in from the device list were written to KV, and another
   location may read the old value of a KV key for a minute or more - so for
   that minute a session somebody had just ended still worked there. They are
   now held in one Durable Object per account, which every location reads in
   order.

   Two locations are modelled here: A, where the revocation happens, and B,
   whose KV still returns what it held before (the stale read KV allows). Both
   reach the SAME object - the real AMVCounter class, through its own fetch,
   not a stand-in. What has to be true:
     - after sign-out-everywhere at A, B refuses the old token immediately;
     - after one sign-in is ended at A, B refuses that one and not the others;
     - accounts revoked before this existed keep their old tokens dead (the
       object is seeded from the KV epoch, never below it);
     - a restored, higher epoch reaches the object;
     - and if the object cannot be reached, sign-in stays up on the KV epoch,
       which is what it did before - an outage of one object never signs
       everybody out. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'revoked-everywhere.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { issueTokens, verifyToken, revokeUserTokens, _sessEnd, _restoreMerge, _authName, counter, apiKeyCreate, apiKeyRevoke, _userFromApiKey, DB };\n');
const W = await import(harness + '?t=' + Date.now());

/* The real Durable Object class, one instance per name, calls serialized. */
function realObjects() {
  const objs = new Map(); let calls = 0; let down = false;
  const make = () => { const store = new Map(); return new W.AMVCounter({ storage: {
    async get(k) { return store.has(k) ? store.get(k) : undefined; }, async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); }, async deleteAll() { store.clear(); }, async setAlarm() {}, async deleteAlarm() {} } }, {}); };
  let q = Promise.resolve();
  return {
    get calls() { return calls; }, set down(v) { down = v; },
    idFromName: n => n,
    get: (n) => ({ fetch: (u, init) => { calls++; if (down) return Promise.reject(new Error('object unreachable'));
      if (!objs.has(n)) objs.set(n, make());
      const run = () => objs.get(n).fetch(new Request('https://do/counter', init));
      const p = q.then(run, run); q = p.catch(() => {}); return p; } }),
  };
}
/* KV with a second location that can be frozen at what it last saw. */
function twoLocations() {
  const live = new Map(); let frozen = null;
  const view = (stale) => ({
    async get(k) { const m = stale && frozen ? frozen : live; return m.has(k) ? m.get(k) : null; },
    async put(k, v) { live.set(k, String(v)); }, async delete(k) { live.delete(k); },
    async list({ prefix } = {}) { return { keys: [...live.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
  });
  return { A: view(false), B: view(true), live, freeze() { frozen = new Map(live); } };
}
const SECRET = 'x'.repeat(48);
const mk = () => { const kv = twoLocations(), DO = realObjects();
  return { kv, DO, A: { JWT_SECRET: SECRET, AMV_KV: kv.A, AMV_COUNTER: DO }, B: { JWT_SECRET: SECRET, AMV_KV: kv.B, AMV_COUNTER: DO } }; };
const EMAIL = 'rui@example.com';

section('Sign out everywhere at A: the old token is dead at B, now');
{
  const { kv, A, B } = mk();
  const t = await W.issueTokens(A, EMAIL, 'Rui');
  ok(!!(await W.verifyToken(t.token, SECRET, B)), 'before: the token works at B');
  kv.freeze();                                   // B's KV stops seeing new writes
  await W.revokeUserTokens(A, EMAIL);
  ok(await kv.B.get('tokepoch:' + EMAIL) === null, 'B\'s KV still holds the old number (the minute KV allows)');
  ok(!(await W.verifyToken(t.token, SECRET, B)), 'and B refuses the token anyway - the object said so');
  ok(!(await W.verifyToken(t.refreshToken, SECRET, B, 'refresh')), 'the renewal token too');
  const fresh = await W.issueTokens(A, EMAIL, 'Rui');
  ok(!!(await W.verifyToken(fresh.token, SECRET, B)), 'a sign-in after it works at B');
  ok(kv.live.get('tokepoch:' + EMAIL) === '1', 'and KV is still written, for backups and the fallback', kv.live.get('tokepoch:' + EMAIL));
}

section('One sign-in ended at A: that one is dead at B, now - not the others');
{
  const { kv, A, B } = mk();
  const phone = await W.issueTokens(A, EMAIL, 'Rui', '11111111-1111-4111-8111-111111111111');
  const laptop = await W.issueTokens(A, EMAIL, 'Rui', '22222222-2222-4222-8222-222222222222');
  await kv.A.put('sess:' + EMAIL + ':11111111-1111-4111-8111-111111111111', '{"sid":"11111111-1111-4111-8111-111111111111"}');
  kv.freeze();
  await W._sessEnd(A, EMAIL, '11111111-1111-4111-8111-111111111111');
  ok(!(await W.verifyToken(phone.token, SECRET, B)), 'the ended sign-in is refused at B within its first two minutes, which KV could not do');
  ok(!!(await W.verifyToken(laptop.token, SECRET, B)), 'the other sign-in still works');
}

section('An account revoked before this existed stays revoked');
{
  const { kv, A, B } = mk();
  await kv.A.put('tokepoch:' + EMAIL, '4');       // four revocations, all in KV
  const t = await W.issueTokens(A, EMAIL, 'Rui');
  ok(!!(await W.verifyToken(t.token, SECRET, B)), 'a token issued now carries 4 and works');
  const old = await W.issueTokens({ JWT_SECRET: SECRET, AMV_KV: { async get() { return '2'; } } }, EMAIL, 'Rui');
  ok(!(await W.verifyToken(old.token, SECRET, B)), 'a token from before those revocations (epoch 2) stays dead - the object was seeded at 4, not 0');
}

section('A restore that carries a higher epoch reaches the object');
{
  const { kv, A, B } = mk();
  const t = await W.issueTokens(A, EMAIL, 'Rui');
  kv.freeze();
  /* What the restore loop does for this key: merge, write KV, raise the object. */
  const merged = await W._restoreMerge(A, 'tokepoch:' + EMAIL, '9');
  await kv.A.put('tokepoch:' + EMAIL, merged.value);
  await W.counter(A, W._authName(EMAIL), { op: 'authSeed', floor: parseInt(merged.value, 10), strict: true });
  ok(!(await W.verifyToken(t.token, SECRET, B)), 'a token below the restored epoch is refused at B');
}

section('The object down: sign-in stays up, on the KV number');
{
  const { DO, A } = mk();
  const t = await W.issueTokens(A, EMAIL, 'Rui');
  DO.down = true;
  ok(!!(await W.verifyToken(t.token, SECRET, A)), 'a valid token still works while the object is unreachable');
  await W.revokeUserTokens(A, EMAIL);
  ok(!(await W.verifyToken(t.token, SECRET, A)), 'and a revocation made then still lands, in KV');
  DO.down = false;
  ok(!(await W.verifyToken(t.token, SECRET, A)), 'and stays revoked when the object is back (seeded from KV, never below it)');
}

section('An API key revoked at A stops working at B, now');
{
  const { kv, A, B } = mk();
  await W.DB.put(A, 'acct', EMAIL, { email: EMAIL, name: 'Rui' });
  await W.DB.put(A, 'ent', EMAIL, { plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  const t = await W.issueTokens(A, EMAIL, 'Rui');
  const req = (path, body) => new Request('https://api.amv.test' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + t.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const made = await (await W.apiKeyCreate(req('/v1/keys/create', { name: 'ci' }), A)).json();
  ok(!!made.key, 'a key is made', made.error || '');
  const use = (env) => W._userFromApiKey(new Request('https://api.amv.test/v1/messages', { headers: { Authorization: 'Bearer ' + made.key } }), env);
  ok(!!(await use(B)), 'before: it works at B');
  const lookup = [...kv.live.keys()].find(k => k.startsWith('apikey:'));
  kv.freeze();
  const rv = await W.apiKeyRevoke(req('/v1/keys/revoke', { id: made.id || (made.item && made.item.id) }), A);
  ok(rv.status === 200, 'revoked at A', rv.status);
  ok(!!lookup && !!(await kv.B.get(lookup)) && !(await kv.A.get(lookup)), 'A deleted the lookup, and B\'s KV still holds it (the minute KV allows)', lookup);
  ok(!(await use(B)), 'and B refuses the key anyway - its object says revoked');
}

section('The object down: reading is fine, changing how the account is protected is not (risk tiers)');
{
  /* Audit, Oct 31: availability over immediate revocation is defensible for
     chat, not for the routes that change security, money, permissions or the
     account itself - there KV's minute is a minute a revoked session could
     use. Driven through the real router. */
  const { DO, A } = mk();
  Object.assign(A, { APP_URL: 'https://amv.test' });
  await W.DB.put(A, 'acct', EMAIL, { email: EMAIL, name: 'Rui', provider: 'email' });
  await W.DB.put(A, 'ent', EMAIL, { plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  const t = await W.issueTokens(A, EMAIL, 'Rui');
  const made = await (await W.apiKeyCreate(new Request('https://api.amv.test/v1/keys/create', { method: 'POST',
    headers: { Authorization: 'Bearer ' + t.token, 'Content-Type': 'application/json' }, body: '{"name":"ci"}' }), A)).json();
  const go = async (path, method, cred) => {
    const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: method || 'GET',
      headers: { Authorization: 'Bearer ' + (cred || t.token), 'Content-Type': 'application/json', 'CF-Connecting-IP': '7.7.7.7' },
      body: method === 'POST' ? '{}' : undefined }), A, { waitUntil() {}, passThroughOnException() {} });
    let d = {}; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
  };
  DO.down = true;
  const sync = await go('/sync/pull', 'POST');
  ok(sync.status === 200, 'with the object unreachable, reading your own chats still works', sync);
  for (const [path, method] of [['/auth/security', 'POST'], ['/v1/keys/create', 'POST'], ['/auth/delete', 'POST'], ['/v1/spend/set', 'POST'], ['/team/invite', 'POST']]) {
    const r = await go(path, method);
    ok(r.status === 503 && r.d.code === 'auth_unconfirmed', path + ': refused while the revocation cannot be confirmed - a 503 that says so, not a 401', r);
  }
  const key = await go('/v1/usage', 'GET', made.key);
  ok(key.status === 503 && key.d.code === 'auth_unconfirmed', 'and an API key fails closed: a credential nobody is watching', key);
  DO.down = false;
  const back = await go('/auth/security', 'POST');
  ok(back.status === 200, 'with the object back, the same route works again', back.status);
  const kb = await go('/v1/usage', 'GET', made.key);
  ok(kb.status === 200, 'and so does the key', kb.status);
}

section('KV failing is still a refusal, never zero');
{
  const { A } = mk();
  const t = await W.issueTokens(A, EMAIL, 'Rui');
  const broken = { ...A, AMV_KV: { async get() { throw new Error('KV down'); } }, AMV_COUNTER: undefined };
  ok(!(await W.verifyToken(t.token, SECRET, broken)), 'with no object and no readable KV, the token is refused');
}

if (report('revoked-means-revoked-everywhere') > 0) process.exitCode = 1;
done();
