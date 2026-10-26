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
  + '\nexport { issueTokens, verifyToken, revokeUserTokens, _sessEnd, _restoreMerge, _authName, counter };\n');
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

section('KV failing is still a refusal, never zero');
{
  const { A } = mk();
  const t = await W.issueTokens(A, EMAIL, 'Rui');
  const broken = { ...A, AMV_KV: { async get() { throw new Error('KV down'); } }, AMV_COUNTER: undefined };
  ok(!(await W.verifyToken(t.token, SECRET, broken)), 'with no object and no readable KV, the token is refused');
}

if (report('revoked-means-revoked-everywhere') > 0) process.exitCode = 1;
done();
