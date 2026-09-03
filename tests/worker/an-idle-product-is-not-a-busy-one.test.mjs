/* THE DEPLOYMENT WITH NO USERS WAS THE MOST EXPENSIVE ONE TO RUN.

   The 5-minute tick scanned two whole KV namespaces on every single run. Not
   because there was work - because there was NONE, and "nothing due" was
   indistinguishable from "the index does not know", so the safe reading of an
   empty index was a full scan. Measured against this Worker: 2 list operations
   and 49 reads per tick, 288 ticks a day, with nobody signed up. 576 lists is
   58% of a free plan's entire daily list allowance, spent rediscovering that
   the product is empty - and the owner's usage was sitting at 90% with zero
   users, which is what surfaced it.

   The fix is a marker that separates "no idea" from "no records", written only
   by a scan that walked a whole namespace and found nothing, and dropped by any
   write that would make it false.

   This file is mostly about the ways that could go WRONG, because the failure
   mode is silence: a marker trusted when it should not be means somebody's
   nightly automation never runs, or a customer who was charged is never
   rescued by the reconciler, and nothing anywhere reports it. So the cost
   saving is checked once and the safety properties are checked seven times. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'idle.harness.mjs');
writeFileSync(harness, src
  + '\nexport { DB, scan, reconcilePayments, runDueAutomations, '
  + '_markKindEmpty, _forgetKindEmpty, _kindKnownEmpty, '
  + 'KIND_EMPTY_PREFIX, KIND_EMPTY_TRUST_MS, CRON_SCANNED_KINDS };\n');
const W = await import(harness + '?t=' + Date.now());

globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });

/* A KV that counts every operation by class, because the whole point is the
   operation count and not the bytes. */
function mkEnv(seed = {}) {
  const m = new Map(Object.entries(seed));
  const c = { get: 0, put: 0, delete: 0, list: 0 };
  return {
    _map: m, _c: c, ALERT_WEBHOOK: '', ADMIN_TOKEN: 'tok',
    AMV_KV: {
      async get(k) { c.get++; return m.has(k) ? m.get(k) : null; },
      async put(k, v) { c.put++; m.set(k, v); },
      async delete(k) { c.delete++; m.delete(k); },
      async list({ prefix, limit } = {}) {
        c.list++;
        let keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        if (limit) keys = keys.slice(0, limit);
        return { keys, list_complete: true };
      },
    },
  };
}
const zero = (env) => { env._c.get = env._c.put = env._c.delete = env._c.list = 0; };

/* Minutes 5-59 of the hour: the automations tick's own hourly full sweep is
   NOT due, which is the window the marker is allowed to act in. */
const OFF_SWEEP = Date.UTC(2026, 8, 3, 14, 37, 0);
const ON_SWEEP  = Date.UTC(2026, 8, 3, 14, 2, 0);

section('The saving is real, and it is the list operation that matters');
{
  const env = mkEnv();
  /* First tick: the namespace is empty, so the scan walks it, finds nothing and
     records that. */
  await W.runDueAutomations(env, OFF_SWEEP);
  const first = Object.assign({}, env._c);
  zero(env);
  await W.runDueAutomations(env, OFF_SWEEP);
  const later = Object.assign({}, env._c);

  ok(first.list >= 1, 'the first tick still scans, because nothing has established emptiness yet', first);
  ok(later.list === 0, 'a later tick does not list at all', later);
  ok(later.get === 1, 'it costs exactly one read - the marker', later);
  ok(later.get + later.put + later.delete + later.list < first.get + first.put + first.delete + first.list,
     'so an idle tick is strictly cheaper than it was', { first, later });
}

section('An automation created after the marker still runs on the next tick');
{
  /* THE FAILURE THIS WHOLE FILE EXISTS FOR. If the marker outlives the write
     that falsifies it, somebody's job silently never runs. */
  const env = mkEnv();
  await W.runDueAutomations(env, OFF_SWEEP);                    // marker written
  ok(!!env._map.get(W.KIND_EMPTY_PREFIX + 'auto'), 'the marker is there to begin with');

  await W.DB.put(env, 'auto', 'someone@corp.com',
    { items: [{ id: 'j1', active: true, next: OFF_SWEEP - 60000, prompt: 'do the thing' }] });

  ok(!env._map.get(W.KIND_EMPTY_PREFIX + 'auto'),
     'writing an automation drops the marker in the same breath',
     env._map.get(W.KIND_EMPTY_PREFIX + 'auto'));

  zero(env);
  await W.runDueAutomations(env, OFF_SWEEP);
  ok(env._c.list >= 1, 'so the next tick scans again and can see it', env._c);
}

section('A pending payment created after the marker is still reconciled');
{
  /* Same shape, but this one is money: the person has been CHARGED. */
  const env = mkEnv();
  const r1 = await W.reconcilePayments(env);
  ok(!!env._map.get(W.KIND_EMPTY_PREFIX + 'paypending'), 'an empty sweep records that it was empty', r1);

  zero(env);
  const r2 = await W.reconcilePayments(env);
  ok(env._c.list === 0 && r2 && r2.idle === true, 'the next sweep skips the scan and says why', { c: env._c, r2 });

  await W.DB.put(env, 'paypending', 'sub_123', { email: 'buyer@corp.com', plan: 'pro', provider: 'stripe', at: Date.now() });
  zero(env);
  const r3 = await W.reconcilePayments(env);
  ok(env._c.list >= 1 && !(r3 && r3.idle),
     'recording a pending payment puts the reconciler back to work', { c: env._c, r3 });
}

section('The hourly full sweep ignores the marker, which is what bounds the damage');
{
  /* This is the property that makes a stale marker cost an hour of lateness
     instead of the work never happening. If this assertion ever goes, the
     mechanism stops being safe and starts being a silent dropped job. */
  const env = mkEnv();
  await W.runDueAutomations(env, OFF_SWEEP);
  ok(!!env._map.get(W.KIND_EMPTY_PREFIX + 'auto'), 'a fresh marker is in place');
  zero(env);
  await W.runDueAutomations(env, ON_SWEEP);
  ok(env._c.list >= 1, 'the tick in the first five minutes of the hour scans anyway', env._c);
}

section('A marker is only ever believed for less than an hour');
{
  const env = mkEnv();
  env._map.set(W.KIND_EMPTY_PREFIX + 'auto', String(Date.now() - (W.KIND_EMPTY_TRUST_MS + 60000)));
  ok((await W._kindKnownEmpty(env, 'auto')) === false, 'an expired marker is not trusted');
  env._map.set(W.KIND_EMPTY_PREFIX + 'auto', String(Date.now() - 60000));
  ok((await W._kindKnownEmpty(env, 'auto')) === true, 'a recent one is');
  ok(W.KIND_EMPTY_TRUST_MS < 3600000,
     'and the window is under an hour, so it expires in step with the hourly sweep', W.KIND_EMPTY_TRUST_MS);
}

section('Nothing unparseable is believed');
{
  const env = mkEnv();
  for (const junk of ['', 'yes', 'null', '{}', 'NaN', '-1', '0']) {
    env._map.set(W.KIND_EMPTY_PREFIX + 'auto', junk);
    ok((await W._kindKnownEmpty(env, 'auto')) === false,
       `a marker reading ${JSON.stringify(junk)} is not trusted`);
  }
}

section('A marker dated in the FUTURE is not a marker from the past');
{
  /* Found by mutation-testing the section above: both of its guards turned out
     to be unreachable, and working out why turned up the case neither of them
     covered. A future timestamp gives a negative age, which is less than the
     trust window, so the marker would have been believed until the clock
     caught up - and the automations tick's hourly sweep would have been the
     only thing still finding the work.

     It is reachable. backupImport writes whatever keys a snapshot holds
     straight to KV, without going through DB.put, and a snapshot is JSON an
     operator supplies - so this key can arrive holding any number. */
  const env = mkEnv();
  for (const ahead of [60 * 1000, 86400 * 1000, 365 * 86400 * 1000, 8.64e15]) {
    env._map.set(W.KIND_EMPTY_PREFIX + 'auto', String(Date.now() + ahead));
    ok((await W._kindKnownEmpty(env, 'auto')) === false,
       `a marker dated ${Math.round(ahead / 60000)} minutes ahead is not trusted`);
  }

  /* And the tick really does scan rather than merely disbelieving in private. */
  env._map.set(W.KIND_EMPTY_PREFIX + 'auto', String(Date.now() + 365 * 86400 * 1000));
  zero(env);
  await W.runDueAutomations(env, OFF_SWEEP);
  ok(env._c.list >= 1, 'so an off-sweep tick still scans for work', env._c);
}

section('Only a scan that found nothing may claim the namespace is empty');
{
  /* The first version of this section set a cap of 2 over 5 records and
     asserted that a TRUNCATED scan writes no marker. It passed, and it was
     checking nothing: `truncated` is `all.length >= cap` and `rows` is
     `all.slice(0, cap)`, so a truncated scan always has at least `cap` rows
     and can never have zero. The condition it claimed to test was unreachable,
     which a mutation run showed by removing the truncation guard and watching
     all 34 assertions still pass.

     The operative property is the row count, so that is what is checked - and
     with enough records to be sure the answer is not an artefact of the cap. */
  const env = mkEnv();
  for (let i = 0; i < 5; i++) env._map.set('auto:u' + i + '@x.com', JSON.stringify({ items: [] }));

  await W.scan(env, 'auto', 2, 'stopped short');
  ok(!env._map.get(W.KIND_EMPTY_PREFIX + 'auto'),
     'a scan that stopped short writes no marker', env._map.get(W.KIND_EMPTY_PREFIX + 'auto'));

  await W.scan(env, 'auto', 1000, 'read everything');
  ok(!env._map.get(W.KIND_EMPTY_PREFIX + 'auto'),
     'and neither does a complete scan that found records',
     env._map.get(W.KIND_EMPTY_PREFIX + 'auto'));

  /* The positive case, so the pair together pin the condition from both sides
     rather than only proving the marker is hard to write. */
  const empty = mkEnv();
  await W.scan(empty, 'auto', 1000, 'read everything');
  ok(!!empty._map.get(W.KIND_EMPTY_PREFIX + 'auto'),
     'a complete scan of a genuinely empty namespace does write it');
}

section('A delete does not get to claim emptiness on its own');
{
  const env = mkEnv();
  env._map.set(W.KIND_EMPTY_PREFIX + 'auto', String(Date.now()));
  await W.DB.del(env, 'auto', 'gone@corp.com');
  ok(!env._map.get(W.KIND_EMPTY_PREFIX + 'auto'),
     'removing one record drops the marker rather than confirming it - only a completed scan may claim it');
}

section('A restore brings work back, and the marker does not outlive it');
{
  /* backupImport is the one writer that does not go through DB.put: it writes
     whatever keys the snapshot holds, straight to KV. A restore is run during
     an incident, so an hour of unscanned automations is at the worst moment. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const imp = code.slice(code.indexOf('async function backupImport'));
  const body = imp.slice(0, imp.indexOf('\n}\n'));
  ok(/_forgetKindEmpty/.test(body),
     'backupImport drops the marker for the kinds it writes');
  ok(/AMV_KV\.put\(key/.test(body),
     'and it really is a raw write, so that line is load-bearing rather than decorative');
}

section('The mechanism is confined to the two kinds the tick scans');
{
  /* DB.put is the write path for well over a hundred call sites. If the marker
     applied to every kind, each of those writes would carry an extra KV delete
     - which would cost far more than the lists it saves. This is a COST
     regression guard: it fails if somebody widens the set without noticing
     what DB.put is. */
  const env = mkEnv();
  zero(env);
  await W.DB.put(env, 'acct', 'someone@corp.com', { email: 'someone@corp.com' });
  ok(env._c.delete === 0, 'writing an account costs no extra operation', env._c);
  ok(env._c.put === 1, 'just the one write it always was', env._c);

  zero(env);
  await W.DB.put(env, 'auto', 'someone@corp.com', { items: [] });
  ok(env._c.delete === 1, 'writing an automation pays one delete to stay correct', env._c);

  ok(W.CRON_SCANNED_KINDS.size === 2,
     'and the set is still just the two namespaces the tick scans', [...W.CRON_SCANNED_KINDS]);
  for (const k of W.CRON_SCANNED_KINDS) {
    ok(new RegExp(`scan\\(env, (?:'${k}'|PEND_KIND)`).test(src) || src.includes(`'${k}'`),
       `${k} is a kind the cron really does scan`);
  }
}

section('D1 deployments pay nothing for any of this');
{
  /* On D1 a namespace read is a SELECT with no daily ceiling, so a KV marker
     there would add an operation where there was none. */
  const env = mkEnv();
  env.DB = { prepare: () => ({ bind: () => ({ run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) }) }) };
  zero(env);
  ok((await W._kindKnownEmpty(env, 'auto')) === false, 'the marker is never consulted on D1');
  await W._markKindEmpty(env, 'auto');
  W._forgetKindEmpty(env, 'auto');
  ok(env._c.get === 0 && env._c.put === 0 && env._c.delete === 0,
     'and none of the three helpers touches KV there', env._c);
}

if (report('an-idle-product-is-not-a-busy-one') > 0) process.exitCode = 1;
done();
