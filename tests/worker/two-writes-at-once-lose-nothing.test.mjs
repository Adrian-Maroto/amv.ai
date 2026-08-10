/* READ, CHANGE, WRITE - AND THE OTHER WRITER IS GONE.

   The wallet was the first record caught doing this without a lock, and the
   sweep afterwards found fifty more sites with the same shape. Most are a
   person editing their own thing, where losing one edit costs an edit. Two are
   not, and both cost more than money.

   `acct`. Login rewrites the password hash when it upgrades the iteration
   count, and the reset flow writes the NEW hash. A login with the OLD password
   in flight when a reset lands writes back the record it read BEFORE the reset,
   restoring the old hash and salt. The reset says it worked. The new password
   does not work. The old one still does - which is exactly the situation
   somebody resets their password to get out of.

   `ent`. Thirteen callers of setEntitlement plus three direct writers, several
   of which land in the same second after a checkout: the Stripe webhook, a
   referral bonus, a past-due mark. Whichever loses, loses silently, and it can
   be the plan somebody just paid for. Nothing errors; they are simply still on
   free.

   Concurrency is not testable by hoping. Each case here fires the writers
   together and asserts that BOTH survived. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'rmw.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, setEntitlement, _withRecord, _withAcct, _planOf, counter, _hashPassword, PBKDF2_ITERATIONS };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;
/* Read a maintained counter the way the product does. A module namespace is
   frozen, so this is a local helper rather than a property on it. */
const countOf = async (env, name) => {
  try { return (await W.counter(env, name, { op: 'get' })).value || 0; } catch (e) { return 0; }
};

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

/* A store with a REAL gap between read and write. Without one, everything here
   passes trivially: an in-memory map that resolves instantly never interleaves,
   so the race cannot happen and the test proves nothing about the lock.

   The value is taken at the MOMENT the read is issued and handed back after the
   delay, because that is what a read is: a storage node answers with what it
   held when the request reached it. Sleeping first and reading the map
   afterwards looks the same and is the opposite - the late reader silently sees
   the other writer's result, so the two never disagree and the race can never
   happen. That version of this fixture passed with every lock removed. */
function mkEnv(readDelayMs = 12) {
  const m = new Map(); const n = new Map();
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    AMV_KV: {
      _map: m,
      async get(k) {
        const asServed = m.has(k) ? m.get(k) : null;
        await new Promise(r => setTimeout(r, readDelayMs));
        /* A seam for driving a race in a stated order rather than hoping two
           slow hashes finish in the useful sequence. Whatever the hook does
           happens WHILE this read is outstanding, so the caller carries on with
           the copy it was already served. */
        if (this._onGet) { const h = this._onGet; await h(k); }
        return asServed;
      },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: all.slice(0, limit || 1000), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
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
/* Fire two writers at once and report who was refused instead of ending the
   run. A lock that turns one of them away is an answer worth printing; an
   unhandled rejection is just a stopped test. */
const together = async (...ps) => (await Promise.allSettled(ps))
  .filter(r => r.status === 'rejected')
  .map(r => String((r.reason && r.reason.message) || r.reason));
const post = async (env, path, body) => {
  const r = await worker.fetch(new Request('https://api.amv.test' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '33.33.33.33' },
    body: JSON.stringify(body || {}),
  }), env, ctx);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

section('The fixture can actually express a race');
{
  /* If the store has no gap between read and write, nothing here is a test. */
  const env = mkEnv();
  const t0 = Date.now();
  await env.AMV_KV.get('anything');
  ok(Date.now() - t0 >= 10, 'reads take real time, so two writers can interleave', Date.now() - t0);

  /* Slow is not enough. A read that is slow but resolves against the map at the
     END sees whatever landed meanwhile, and no two writers ever hold different
     views - which is the whole thing being tested. This asserts the read is
     STALE: issued before a write, answered after it, still showing the old
     value. */
  await env.AMV_KV.put('race:probe', 'before');
  const inFlight = env.AMV_KV.get('race:probe');
  await env.AMV_KV.put('race:probe', 'after');
  ok(await inFlight === 'before',
     'a read already in flight does not see a write that landed after it', await inFlight);
}

section('Two plan grants at the same moment, and the books still balance');
{
  /* Asserting the PLAN survives is not enough: if both writers grant the same
     plan, whichever wins leaves it correct and a lost write is invisible. The
     first version of this case did exactly that and passed with the lock
     removed.

     What a lost write really costs is the bookkeeping. Every setEntitlement
     shifts the population counters from the plan it READ to the plan it wrote.
     Two writers reading the same `free` both shift free -> paid, and the paid
     count ends up one too high - a number the owner steers by, wrong, with
     nothing failing. */
  const env = mkEnv();
  await W.setEntitlement(env, 'buyer@example.com', 'free');
  /* Baselines taken AFTER setup. The initial free grant already moved the free
     counter, so asserting against zero measures the fixture rather than the
     race - which is how the first version of this passed with the lock removed. */
  const freeBefore = await countOf(env, 'plancount:free');
  const ultraBefore = await countOf(env, 'plancount:ultra');
  const paidBefore = await countOf(env, 'funnel:paid');

  const refused = await together(
    W.setEntitlement(env, 'buyer@example.com', 'ultra', { source: 'stripe' }),
    W.setEntitlement(env, 'buyer@example.com', 'ultra', { source: 'stripe' }),
  );
  ok(refused.length === 0, 'neither grant was turned away by the other', refused);

  const ent = await W.DB.get(env, 'ent', 'buyer@example.com');
  ok(W._planOf(ent) === 'ultra', 'the plan they paid for is what they have', ent.plan);
  ok(!!ent.renewedAt, 'recorded as paid for, so the sweep will not revoke it', !!ent.renewedAt);

  /* One account moved from free to ultra, once. The counters have to say that
     however many writers raced. */
  const dUltra = (await countOf(env, 'plancount:ultra')) - ultraBefore;
  const dFree = (await countOf(env, 'plancount:free')) - freeBefore;
  ok(dUltra === 1, 'ultra gained exactly one account, not two', { dUltra, dFree });
  ok(dFree === -1, 'and free lost exactly one, not two', { dUltra, dFree });

  /* Same account, same upgrade, one conversion. Two writers each seeing a free
     record both mark the funnel, and the paid-conversion number - the one the
     owner uses to decide what is working - counts one customer twice. */
  const dPaid = (await countOf(env, 'funnel:paid')) - paidBefore;
  ok(dPaid === 1, 'and one customer counts as one conversion', dPaid);
}

section('A grant racing a past-due mark does not lose the grant');
{
  const env = mkEnv();
  await W.setEntitlement(env, 'renew@example.com', 'pro', { source: 'stripe' });

  const refused = await together(
    W.setEntitlement(env, 'renew@example.com', 'ultra', { source: 'stripe' }),
    W.setEntitlement(env, 'renew@example.com', 'pro', { source: 'stripe', pastDueSince: Date.now() }),
  );
  ok(refused.length === 0, 'both writes were applied rather than one refused', refused);

  const ent = await W.DB.get(env, 'ent', 'renew@example.com');
  ok(['pro', 'ultra'].includes(ent.plan),
     'one of the two writes won cleanly rather than a torn record', ent.plan);
  ok(typeof ent.updatedAt === 'number' && ent.updatedAt > 0,
     'and the record is whole', ent.updatedAt);
}

section('A login in flight cannot restore a password that was just reset');
{
  /* The sharpest one. Somebody resets because they think they are compromised,
     and a login with the OLD password is in flight. Unguarded, the login writes
     back the record it read first, the old hash returns, and the reset - which
     said it worked - did nothing. */
  const env = mkEnv();
  const acct = { email: 'victim@example.com', salt: 'oldsalt', pwHash: 'OLD-HASH', pwIter: 1000 };
  await W.DB.put(env, 'acct', 'victim@example.com', acct);

  const refused = await together(
    /* the reset: a whole new credential */
    W._withAcct(env, 'victim@example.com', (a) => {
      a.pwHash = 'NEW-HASH'; a.salt = 'newsalt'; a.pwIter = 210000; a.pwResetAt = Date.now();
    }),
    /* the login's iteration upgrade, working from the record as it was BEFORE */
    W._withAcct(env, 'victim@example.com', (fresh) => {
      if (!fresh || fresh.pwHash !== acct.pwHash || fresh.salt !== acct.salt) return;   // moved underneath us
      fresh.pwHash = 'OLD-HASH-REHASHED'; fresh.pwIter = 210000;
    }),
  );
  ok(refused.length === 0, 'both changes were applied in turn, neither abandoned', refused);

  const after = await W.DB.get(env, 'acct', 'victim@example.com');
  ok(after.pwHash === 'NEW-HASH', 'the reset password is the one that survived', after.pwHash);
  ok(after.salt === 'newsalt', 'with its own salt', after.salt);
  ok(after.pwHash !== 'OLD-HASH' && after.pwHash !== 'OLD-HASH-REHASHED',
     'and the old credential is not back', after.pwHash);
}

section('The upgrade still happens when nothing else is going on');
{
  /* The guard must not turn into "logins never upgrade the hash", which would
     quietly leave every account on the old iteration count for ever. */
  const env = mkEnv();
  const acct = { email: 'normal@example.com', salt: 's', pwHash: 'H', pwIter: 1000 };
  await W.DB.put(env, 'acct', 'normal@example.com', acct);

  await W._withAcct(env, 'normal@example.com', (fresh) => {
    if (!fresh || fresh.pwHash !== acct.pwHash || fresh.salt !== acct.salt) return;
    fresh.pwHash = 'H-UPGRADED'; fresh.pwIter = 210000;
  });

  const after = await W.DB.get(env, 'acct', 'normal@example.com');
  ok(after.pwHash === 'H-UPGRADED', 'an undisturbed login still upgrades', after.pwHash);
  ok(after.pwIter === 210000, 'to the current iteration count', after.pwIter);
}

section('End to end: the reset holds against a login already under way');
{
  /* The two cases above use the primitive directly. This one goes through the
     real routes, because the thing that has to be true is not "the lock works"
     - it is "the password they set is the password that opens the account".

     The account is written with an OLD iteration count on purpose: that is what
     makes a login rewrite the credential at all, and it is the only reason
     these two writers ever meet. */
  const env = mkEnv();
  const EMAIL = 'reset@example.com';
  const OLD = 'A-real-Passw0rd!';
  const NEW = 'An-entirely-N3w-0ne!';
  const salt = 'a-fixed-salt-for-this-case';
  await W.DB.put(env, 'acct', EMAIL, {
    email: EMAIL, name: 'R', provider: 'email', salt,
    pwHash: await W._hashPassword(OLD, salt, 1000), pwIter: 1000,
    createdAt: Date.now() - 60000,
  });
  await env.AMV_KV.put('reset:tok-race', JSON.stringify({ email: EMAIL, at: Date.now() }));

  const [confirm, login] = await Promise.all([
    post(env, '/auth/reset/confirm', { token: 'tok-race', password: NEW }),
    post(env, '/auth/login', { email: EMAIL, password: OLD }),
  ]);
  ok(confirm.body.ok === true, 'the reset reports success', confirm.body.error || confirm.status);
  ok(login.status === 200 || login.status === 401,
     'and the login in flight either worked or did not, without erroring', login.status);

  const withNew = await post(env, '/auth/login', { email: EMAIL, password: NEW });
  ok(!!withNew.body.token, 'the password they just set opens the account', withNew.body.error || withNew.status);
  const withOld = await post(env, '/auth/login', { email: EMAIL, password: OLD });
  ok(!withOld.body.token, 'and the one they were escaping from does not', withOld.status);

  const after = await W.DB.get(env, 'acct', EMAIL);
  ok(after.pwIter === W.PBKDF2_ITERATIONS,
     'with the credential stored at the current strength', after.pwIter);
}

section('And it holds in the order that actually breaks it');
{
  /* The case above fires both at once and lets them land where they land, which
     is a real test of the flow but not of the ORDER that does the damage. That
     order is exact: the login reads the account, the reset completes in full,
     and only then does the login write. Left to chance it almost never happens
     - the hashing either side takes a different amount of time on every run -
     so it is stated here instead. Without it, a login that writes back its
     stale copy passes.

     The hook makes the login's very first account read outlast the entire
     reset. Everything the login does afterwards is working from a record that
     is already out of date, which is precisely the situation. */
  const env = mkEnv();
  const EMAIL = 'ordered@example.com';
  const OLD = 'A-real-Passw0rd!';
  const NEW = 'An-entirely-N3w-0ne!';
  const salt = 'a-fixed-salt-for-this-case';
  await W.DB.put(env, 'acct', EMAIL, {
    email: EMAIL, name: 'O', provider: 'email', salt,
    pwHash: await W._hashPassword(OLD, salt, 1000), pwIter: 1000,
    createdAt: Date.now() - 60000,
  });
  await env.AMV_KV.put('reset:tok-ordered', JSON.stringify({ email: EMAIL, at: Date.now() }));

  let armed = true, reset = null;
  env.AMV_KV._onGet = async (k) => {
    if (!armed || k !== 'acct:' + EMAIL) return;
    armed = false;                                  // the reset reads it too
    reset = await post(env, '/auth/reset/confirm', { token: 'tok-ordered', password: NEW });
  };
  const login = await post(env, '/auth/login', { email: EMAIL, password: OLD });
  env.AMV_KV._onGet = null;

  ok(reset && reset.body.ok === true, 'the reset went through first', reset && (reset.body.error || 'ok'));
  ok(login.status === 200, 'and the login with the old password was still valid at the time', login.status);

  const withNew = await post(env, '/auth/login', { email: EMAIL, password: NEW });
  ok(!!withNew.body.token, 'the new password still opens the account afterwards', withNew.body.error || withNew.status);
  const withOld = await post(env, '/auth/login', { email: EMAIL, password: OLD });
  ok(!withOld.body.token, 'and the old one is gone for good', withOld.status);
}

section('A reset that cannot be written does not claim to have worked');
{
  /* The failure mode this must never have: telling somebody their password is
     changed when it is not. They stop trying the old one; the old one is what
     still works; and if they reset because they were compromised, whoever has
     it keeps it. */
  const env = mkEnv();
  const EMAIL = 'stuck@example.com';
  const salt = 's';
  await W.DB.put(env, 'acct', EMAIL, { email: EMAIL, salt, pwHash: 'KEEP', pwIter: 1000, createdAt: Date.now() - 60000 });
  await env.AMV_KV.put('reset:tok-stuck', JSON.stringify({ email: EMAIL, at: Date.now() }));

  /* Hold the account's lock so the reset cannot take it. */
  let r = null;
  await W._withAcct(env, EMAIL, async () => {
    r = await post(env, '/auth/reset/confirm', { token: 'tok-stuck', password: 'An-entirely-N3w-0ne!' });
  });
  ok(r.body.ok !== true, 'it does not report success', r.body);
  ok(r.status === 503, 'it says the account was busy', r.status);
  ok(/not changed|try again/i.test(r.body.error || ''), 'in words that tell them to retry', r.body.error);
  ok((await W.DB.get(env, 'acct', EMAIL)).pwHash === 'KEEP', 'and nothing was written', 'KEEP');
  ok(!!(await env.AMV_KV.get('reset:tok-stuck')),
     'the link is still usable, because it was never spent', true);
}

section('A change that cannot take the lock is refused, not written anyway');
{
  /* Silently proceeding without the lock is worse than failing: it is the
     original bug with a comment claiming otherwise. */
  const env = mkEnv();
  await W.DB.put(env, 'acct', 'busy@example.com', { email: 'busy@example.com', pwHash: 'KEEP' });
  let threw = false;
  await W._withAcct(env, 'busy@example.com', async () => {
    /* Hold the lock, and try to take it again from inside. */
    try { await W._withAcct(env, 'busy@example.com', (a) => { a.pwHash = 'CLOBBERED'; }); }
    catch (e) { threw = true; }
  });
  ok(threw, 'the second writer gives up rather than writing blind', threw);
  const after = await W.DB.get(env, 'acct', 'busy@example.com');
  ok(after.pwHash === 'KEEP', 'and nothing was changed underneath the first', after.pwHash);
}

section('Different people do not queue behind each other');
{
  /* A per-record lock that is really a global one would serialise the whole
     product. Two different accounts must not contend. */
  const env = mkEnv();
  await W.DB.put(env, 'acct', 'a@example.com', { email: 'a@example.com', v: 0 });
  await W.DB.put(env, 'acct', 'b@example.com', { email: 'b@example.com', v: 0 });
  const t0 = Date.now();
  /* A shared lock does not fail politely here - it throws "busy" out of the
     loser. Catching it keeps that a reported failure rather than a crash, which
     is the difference between a test that tells you what is wrong and one that
     just stops. */
  let contention = null;
  await Promise.all([
    W._withAcct(env, 'a@example.com', (x) => { x.v = 1; }),
    W._withAcct(env, 'b@example.com', (x) => { x.v = 1; }),
  ]).catch((e) => { contention = e.message || String(e); });
  const elapsed = Date.now() - t0;
  ok(!contention, 'neither writer was refused because of the other', contention);
  ok(((await W.DB.get(env, 'acct', 'a@example.com')) || {}).v === 1, 'the first went through', 1);
  ok(((await W.DB.get(env, 'acct', 'b@example.com')) || {}).v === 1, 'and so did the second', 1);
  ok(elapsed < 200, 'without one waiting on the other', elapsed);
}

section('Nothing writes an entitlement outside the lock');
{
  /* A LOCK ONLY HOLDS IF EVERY WRITER TAKES IT.

     setEntitlement went under the lock and eleven other functions kept writing
     this record directly: the past-due mark, the referral bonus, the team
     marker, the family marker, erasure, and a renewal touch-up in the PayPal
     webhook. A locked writer is no safer than the unlocked one racing it, so
     the guard was worth nothing against any of them - and the sharpest, a
     past-due mark landing beside a payment, takes access away from somebody who
     has just paid.

     Stated as a source rule because the defect is an absence. The next function
     that needs to change an entitlement will reach for DB.put, since that is
     what the rest of the file looks like, and nothing else would notice.

     A write that appears INSIDE a lock's own save callback is the lock doing
     its job, so the rule is about the enclosing function: whichever function
     contains an entitlement write must also be taking the lock. A bare
     `DB.put(env,'ent',...)` in a function that mentions no lock is the defect,
     and that is exactly what the eleven looked like. */
  const allowed = new Set(['setEntitlement', '_saveEnt']);
  /* Top-level declarations of both shapes. Matching only `function name(`
     attributed `_saveEnt` - an arrow const - to whatever function happened to
     precede it, and blamed that one instead. */
  const decl = /(?:^|\n)(?:(?:async )?function ([A-Za-z_$][\w$]*)\s*\(|const ([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\()/g;
  const marks = [];
  let m;
  while ((m = decl.exec(src))) marks.push({ name: m[1] || m[2], at: m.index });
  const ownerOf = (i) => { let o = '(top level)'; for (const k of marks) { if (k.at < i) o = k.name; else break; } return o; };
  const bodyOfMark = (name) => {
    const i = marks.findIndex(k => k.name === name);
    if (i < 0) return '';
    return src.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : src.length);
  };
  const writers = new Set();
  for (const w of src.matchAll(/DB\.put\(\s*e(?:nv)?\s*,\s*'ent'/g)) writers.add(ownerOf(w.index));
  const offenders = [...writers].filter(fn => {
    if (allowed.has(fn)) return false;
    const body = bodyOfMark(fn);
    return !/_withEnt\(|_withRecord\(\s*env,\s*'ent'/.test(body);
  });
  ok(offenders.length === 0,
     'every function that writes an entitlement takes the lock', offenders);
}

globalThis.fetch = realFetch;
if (report('two-writes-at-once-lose-nothing') > 0) process.exitCode = 1;
done();
