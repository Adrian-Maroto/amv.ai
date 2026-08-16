/* THREE WAYS A GUARANTEE STOPPED BEING ONE WITHOUT SAYING SO.

   THE LEASE (AMV-013). Locks expire, because a holder that dies must not hold
   one for ever. So a holder whose work outran its lease - a slow storage call,
   a provider taking its time - lost the lock without being told, and somebody
   else took it. Then the first one finished and released, and the release was
   unconditional: it deleted the SECOND holder's lock while that holder was
   still inside the critical section. From there both of them believe they are
   alone, which is precisely the state a lock exists to make impossible. It
   needs load, not an attacker.

   THE DEGRADATION (AMV-032). The atomic counter falls back to plain storage
   when the Durable Object cannot be reached. For a tally that is a reasonable
   trade. For `claim` and `reserve` it is not: through storage they are a read
   followed by a write, which is the exact race they exist to close. So a
   failing DO turned "only one of these may proceed" into "all of them may". An
   alert was added for this once, and the fallback still ran underneath it - the
   operator found out, and the guarantee was gone either way.

   THE CORRUPT RECORD (AMV-031). A record that will not parse reads as a record
   that is not there, and for most callers that is the right answer. It is
   exactly wrong wherever ABSENCE GRANTS SOMETHING: an unreadable seller row is
   a seller who was never banned, an unreadable abuse row is somebody with no
   disputes, an unreadable family row is a child with no spending limit, and an
   unreadable account row is an address nobody has registered - which, since
   signup decides existence from that read, means anybody who knows the address
   can sign up over it with a password of their own.

   All three fail open, and all three are invisible from the call site: a clean
   answer and no answer at all look the same. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'lease.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _claimOnce, _releaseClaim, counter, _payoutRisk, _familyOf, FAMILY_DEFAULTS, UnreadableRecordError };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

/* The REAL Durable Object class, driven directly. The lock lives inside it, so
   a stubbed counter would be testing the stub. */
function mkDO() {
  const store = new Map();
  const state = { storage: {
    async get(k) { return store.has(k) ? store.get(k) : undefined; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async deleteAll() { store.clear(); },
    async setAlarm() {},
  } };
  return new W.AMVCounter(state, {});
}
const doCall = async (obj, payload) => JSON.parse(await (await obj.fetch(new Request('https://do/counter', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
}))).text());

function mkEnv(counterImpl) {
  const m = new Map(); const objs = new Map();
  return {
    JWT_SECRET: 'j', APP_URL: 'https://amv.test',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    /* A Durable Object STUB, not the object. The real stub takes (url, init)
       and builds the Request; handing the raw class those arguments makes it
       call .json() on a string, which surfaces as the DO being unreachable -
       a harness that fails in exactly the way the code under test treats as a
       fault, and would have reported the fallback rule working when nothing
       was reaching the object at all. */
    AMV_COUNTER: counterImpl || {
      idFromName: (n) => n,
      get: (n) => {
        if (!objs.has(n)) objs.set(n, mkDO());
        const o = objs.get(n);
        return { fetch: (url, init) => o.fetch(new Request(url, init)) };
      },
    },
  };
}

section('A lock is held by one holder at a time');
{
  const obj = mkDO();
  const a = await doCall(obj, { op: 'claim', ttlMs: 60000 });
  ok(a.claimed === true, 'the first holder takes it', a.claimed);
  ok(typeof a.owner === 'string' && a.owner.length > 8, 'and is told which claim is theirs', a.owner);
  const b = await doCall(obj, { op: 'claim', ttlMs: 60000 });
  ok(b.claimed === false, 'the second is refused while it is held', b.claimed);
}

section('And a release that does not own it changes nothing');
{
  /* The finding. The first holder's lease expired, the second took the lock,
     and then the first finished and released - deleting a lock somebody else
     was working inside. */
  const obj = mkDO();
  /* The shortest lease the object will actually grant. It floors ttl at one
     second, so asking for 1ms and waiting 5ms tests nothing - the lock is still
     held and the case passes for the wrong reason. */
  const obj_ttl = 1000;
  const first = await doCall(obj, { op: 'claim', ttlMs: obj_ttl });
  ok(first.claimed === true, 'the first holder takes it', first.claimed);

  await new Promise(r => setTimeout(r, obj_ttl + 60));   // its lease runs out
  const second = await doCall(obj, { op: 'claim', ttlMs: 60000 });
  ok(second.claimed === true, 'the lease expires and somebody else takes it', second.claimed);
  ok(second.owner !== first.owner, 'a different claim', { a: first.owner, b: second.owner });

  /* Now the slow first holder finishes. */
  const stale = await doCall(obj, { op: 'release', owner: first.owner });
  ok(stale.released === false, 'its release is refused', stale);
  ok(stale.reason === 'not_owner', 'because it no longer owns the lock', stale.reason);

  const third = await doCall(obj, { op: 'claim', ttlMs: 60000 });
  ok(third.claimed === false,
     'so the second holder still has it - two writers are never inside at once', third.claimed);

  /* And the real owner can still give it back. */
  const good = await doCall(obj, { op: 'release', owner: second.owner });
  ok(good.released === true, 'the holder that owns it releases normally', good.released);
  const fourth = await doCall(obj, { op: 'claim', ttlMs: 60000 });
  ok(fourth.claimed === true, 'and the lock is free again', fourth.claimed);
}

section('The helpers carry the token, so no call site has to');
{
  /* Seventeen claim sites and fourteen release sites. Threading a token through
     every one of them is seventeen chances to forget, and the one that forgot
     would be the one deleting somebody else's lock. */
  const env = mkEnv();
  ok(await W._claimOnce(env, 'thing', 'x', 60) === true, 'a claim is taken', true);
  ok(await W._claimOnce(env, 'thing', 'x', 60) === false, 'and excludes a second', true);
  await W._releaseClaim(env, 'thing', 'x');
  ok(await W._claimOnce(env, 'thing', 'x', 60) === true, 'releasing frees it', true);
}

section('A lease that expired mid-work is reported, not shrugged off');
{
  /* It means the work just finished ran outside the lock. That is worth knowing
     about, and it shows up under load rather than in a review. */
  const env = mkEnv();
  await W._claimOnce(env, 'slow', 'y', 60);
  /* Somebody else takes it - simulated by clearing this isolate's memory of
     which claim was ours, which is what an expired lease amounts to. */
  const rel = codeOnly(functionBody(src, '_releaseClaim'));
  ok(/not_owner/.test(rel), 'the release inspects the answer', true);
  ok(/lock_lease_expired/.test(rel), 'and audits when it was not the owner', true);
  ok(/alertOnce\(env, 'lock_lease_expired/.test(rel),
     'and pages somebody, because a lease too short for its work will recur', true);
}

section('A claim that cannot be made atomically is refused, not faked');
{
  /* AMV-032. A bound Durable Object that cannot answer is a fault. Taking the
     lock through plain storage instead is a read followed by a write - the race
     the lock exists to close. */
  const env = mkEnv({ idFromName: (n) => n, get: () => ({ async fetch() { throw new Error('DO unreachable'); } }) });
  const got = await W._claimOnce(env, 'money', 'z', 60);
  ok(got === false, 'the claim is refused rather than granted non-atomically', got);

  const res = await W.counter(env, 'usg:x', { op: 'reserve', amount: 1, cap: 10 });
  ok(res.allowed === false, 'and a reservation is refused too', res.allowed);
  ok(res.unavailable === true, 'saying it could not be answered, not that the cap was hit', res.unavailable);
}

section('But a deployment with no Durable Object at all still runs');
{
  /* The difference that matters: unbound is a development machine with nothing
     configured, and the fallback is documented degradation. Refusing there
     would mean the product does not start without wrangler. */
  const env = mkEnv();
  delete env.AMV_COUNTER;
  const got = await W._claimOnce(env, 'devbox', 'q', 60);
  ok(got === true, 'a claim still works with no Durable Object bound', got);
}

section('A corrupt record does not read as permission');
{
  /* AMV-031, at the three places absence grants something. */
  const env = mkEnv();
  env.AMV_KV._map.set('seller:s@x.z', '{banned:true,,,');
  let threw = null;
  try { await W.DB.getStrict(env, 'seller', 's@x.z'); } catch (e) { threw = e; }
  ok(threw instanceof W.UnreadableRecordError, 'a strict read of it throws', threw && threw.name);

  /* While an ordinary read still answers null, because most callers want that
     and breaking them was the defect the null was introduced to fix. */
  ok(await W.DB.get(env, 'seller', 's@x.z') === null,
     'and the ordinary read still treats it as missing, for the callers that need that', true);

  /* Genuinely absent is still a real answer, not an error. */
  ok(await W.DB.getStrict(env, 'seller', 'nobody@x.z') === null,
     'a record that has never existed is not an error', true);
}

section('An unreadable seller is reviewed, not released');
{
  const env = mkEnv();
  env.AMV_KV._map.set('acct:s@x.z', JSON.stringify({ email: 's@x.z', createdAt: Date.now() - 400 * 86400000 }));
  env.AMV_KV._map.set('seller:s@x.z', 'not json');
  const risk = await W._payoutRisk(env, 's@x.z', 50, { balance: 100, payouts: [] });
  ok(risk.tier === 'review', 'the payout goes to a person', risk.tier);
  ok(risk.reasons.some(r => /a person should look at it/.test(r)),
     'rather than scoring as a seller in good standing', risk.reasons);
}

section('An unreadable family record is the strictest limits, not none');
{
  /* The entitlement says this person is in a family. Answering "then they have
     no limits" hands a capped child the whole plan allowance. */
  const env = mkEnv();
  await W.DB.put(env, 'ent', 'kid@x.z', { plan: 'ultra', familyOf: 'fam9' });
  env.AMV_KV._map.set('fam:fam9', '{members:[broken');

  /* Read defensively: without the fix this answers null, and a bare
     `fam.limits` throws - which kills the file before the sections after it
     ever run, so a sabotage would report less than it looks like it reports. */
  const fam = await W._familyOf(env, 'kid@x.z', null);
  ok(!!(fam && fam.limits), 'they are still treated as being in a family', fam);
  ok(!!fam && fam.limits.monthlyUSD === W.FAMILY_DEFAULTS.monthlyUSD,
     'with the default limits applied', fam && fam.limits && fam.limits.monthlyUSD);
  ok(!!fam && fam.unreadable === true,
     'and the state is marked so it is not mistaken for a real cap', fam && fam.unreadable);
}

section('An unreadable account cannot be signed up over');
{
  /* The sharpest one, and it only appeared once signup started deciding
     existence from this read. A corrupt account record read as an address
     nobody had taken - so anybody who knew it could create it again, with a
     password of their own. */
  const env = mkEnv();
  env.AMV_KV._map.set('acct:taken@example.com', '{"email":"taken@example.com"');   // truncated write
  const r = await worker.fetch(new Request('https://api.amv.test/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
    body: JSON.stringify({ email: 'taken@example.com', name: 'Impostor', password: 'A-real-Passw0rd!' }),
  }), env, { waitUntil() {}, passThroughOnException() {} });
  const d = await r.json().catch(() => ({}));

  ok(r.status === 503, 'the signup is refused', r.status);
  ok(d.code === 'account_unreadable', 'because the address could not be checked', d.code);
  ok(env.AMV_KV._map.get('acct:taken@example.com') === '{"email":"taken@example.com"',
     'and the damaged record is left exactly as it was, not overwritten', true);
}

section('And an address nobody has is still free to take');
{
  /* The counter-rule: a strict read that refused everything would be a signup
     nobody can complete. */
  const env = mkEnv();
  const r = await worker.fetch(new Request('https://api.amv.test/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
    body: JSON.stringify({ email: 'fresh@example.com', name: 'New', password: 'A-real-Passw0rd!' }),
  }), env, { waitUntil() {}, passThroughOnException() {} });
  ok(r.status === 200, 'an ordinary signup works', r.status);
}

globalThis.fetch = realFetch;
if (report('a-lock-that-expired-is-somebody-elses-lock') > 0) process.exitCode = 1;
done();
