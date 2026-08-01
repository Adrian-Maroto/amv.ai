/* SIGNUP -> ACTIVATED -> RETURNED -> PAID.

   Every dashboard number said how the business was doing today. None of them
   said whether the product WORK was landing. A first-run screen, an activation
   nudge, better onboarding copy - all of it was being judged on feel, because
   plan population cannot tell you how many of the people who signed up ever got
   anything out of AMV.

   Two properties make the numbers worth trusting:

     - each step is marked ONCE PER USER, ever, off the event that actually
       proves it. `activated` is a real answer AMV finished writing, not a page
       view. `returned` is a second distinct DAY, not a second session. `paid` is
       a verified payment, counted only on the way up from not paying.
     - the counters are cumulative, so the ratios are exact at forty accounts and
       at four hundred thousand with no scan - the same reason plan population
       works at scale.

   And one property that keeps it honest: a stat may never break the thing it is
   measuring. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'funnel.harness.mjs');
writeFileSync(harness, src + `
export { _funnelMark, _funnelReport, _markActive, setEntitlement, DB, counter,
         todayKey, FUNNEL_STEPS };
`);
const W = await import(harness + '?t=' + Date.now());

const mkEnv = () => {
  const kv = new Map();
  return { _kv: kv, AMV_KV: {
    async get(k) { return kv.has(k) ? kv.get(k) : null; },
    async put(k, v) { kv.set(k, String(v)); },
    async delete(k) { kv.delete(k); },
    async list({ prefix }) { return { keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }; },
  } };
};

section('A step is counted once per person, however many times it happens');
{
  const env = mkEnv();
  ok((await W._funnelMark(env, 'a@x.com', 'signup')) === true, 'the first mark counts');
  ok((await W._funnelMark(env, 'a@x.com', 'signup')) === false, 'the second does not');
  for (let i = 0; i < 20; i++) await W._funnelMark(env, 'a@x.com', 'activated');
  const r = await W._funnelReport(env);
  ok(r.signup === 1, 'one signup, not two', r.signup);
  ok(r.activated === 1, 'and one activation, not twenty', r.activated);
  ok(r.activatedPct === 100, 'so the ratio is a real ratio', r.activatedPct);
}

section('The ratios are exact without reading a single account');
{
  const env = mkEnv();
  for (let i = 0; i < 200; i++) await W._funnelMark(env, 'u' + i + '@x.com', 'signup');
  for (let i = 0; i < 50; i++) await W._funnelMark(env, 'u' + i + '@x.com', 'activated');
  for (let i = 0; i < 20; i++) await W._funnelMark(env, 'u' + i + '@x.com', 'returned');
  for (let i = 0; i < 4; i++) await W._funnelMark(env, 'u' + i + '@x.com', 'paid');

  const r = await W._funnelReport(env);
  ok(r.activatedPct === 25, 'a quarter of signups got a real answer', r.activatedPct);
  ok(r.returnedPct === 10, 'a tenth came back', r.returnedPct);
  ok(r.paidPct === 2, 'and two percent paid', r.paidPct);
  ok(/older than that are not included/.test(r.note || ''),
     'and it says which accounts are not in the denominator', r.note);
}

section('An empty funnel reports nothing rather than a made-up number');
{
  const env = mkEnv();
  const r = await W._funnelReport(env);
  ok(r.signup === 0, 'no signups', r.signup);
  ok(r.activatedPct === null, 'no percentage invented from a zero denominator', r.activatedPct);
  ok(r.paidPct === null, 'and none for conversion either', r.paidPct);
  ok(r.avgDaysToPay === null, 'nor an average time to pay when nobody has paid', r.avgDaysToPay);
}

section('"Came back" means a second DAY, not a second visit');
{
  /* Somebody who opens AMV three times in one afternoon has not come back. */
  const env = mkEnv();
  await W._markActive(env, 'b@x.com');
  env._kv.delete('active:b@x.com:' + W.todayKey());       // a new session, same day
  await W._markActive(env, 'b@x.com');
  env._kv.delete('active:b@x.com:' + W.todayKey());
  await W._markActive(env, 'b@x.com');
  let r = await W._funnelReport(env);
  ok(r.returned === 0, 'three sessions on one day is not a return', r.returned);

  // now it is genuinely a different day
  env._kv.set('factive:b@x.com', '2020-01-01');
  env._kv.delete('active:b@x.com:' + W.todayKey());
  await W._markActive(env, 'b@x.com');
  r = await W._funnelReport(env);
  ok(r.returned === 1, 'a second distinct day is', r.returned);

  env._kv.delete('active:b@x.com:' + W.todayKey());
  await W._markActive(env, 'b@x.com');
  ok((await W._funnelReport(env)).returned === 1, 'and a third day does not count them again');
}

section('Paying is counted on the way up, and only once');
{
  const env = mkEnv();
  await W.DB.put(env, 'acct', 'c@x.com', { email: 'c@x.com', createdAt: Date.now() - 6 * 86400000 });

  await W.setEntitlement(env, 'c@x.com', 'free');
  ok((await W._funnelReport(env)).paid === 0, 'free is not a conversion');

  await W.setEntitlement(env, 'c@x.com', 'pro', { source: 'stripe' });
  ok((await W._funnelReport(env)).paid === 1, 'upgrading is');

  await W.setEntitlement(env, 'c@x.com', 'elite', { source: 'stripe' });
  ok((await W._funnelReport(env)).paid === 1, 'and upgrading again is not a second conversion');

  await W.setEntitlement(env, 'c@x.com', 'free', { source: 'stripe', canceled: true });
  await W.setEntitlement(env, 'c@x.com', 'pro', { source: 'stripe' });
  ok((await W._funnelReport(env)).paid === 1,
     'nor is cancelling and coming back - that is retention, not acquisition');

  const r = await W._funnelReport(env);
  ok(r.avgDaysToPay >= 5.5 && r.avgDaysToPay <= 6.5,
     'and how long it took them is measured from when they signed up', r.avgDaysToPay);
}

section('A team is counted as paying, at what it actually pays');
{
  const env = mkEnv();
  await W.DB.put(env, 'acct', 'd@x.com', { email: 'd@x.com', createdAt: Date.now() - 86400000 });
  await W.setEntitlement(env, 'd@x.com', 'team', { custom: { seats: 10 }, source: 'stripe' });
  ok((await W._funnelReport(env)).paid === 1,
     'a per-seat plan is a conversion like any other', (await W._funnelReport(env)).paid);
}

section('A broken stat never breaks the thing it is measuring');
{
  /* This runs inside signup, inside the metering path and inside the one place
     a plan is granted. If it can throw, it can lose a customer. */
  const hostile = { AMV_KV: {
    async get() { throw new Error('kv down'); },
    async put() { throw new Error('kv down'); },
    async delete() { throw new Error('kv down'); },
    async list() { throw new Error('kv down'); },
  } };
  ok((await W._funnelMark(hostile, 'e@x.com', 'signup')) === false,
     'a dead store makes the mark a no-op rather than an exception');
  const r = await W._funnelReport(hostile);
  ok(r && r.signup === 0, 'and the report still answers, with zeros', r && r.signup);

  const env = mkEnv();
  ok((await W._funnelMark(env, '', 'signup')) === false, 'a missing email marks nothing');
  ok((await W._funnelMark(env, 'f@x.com', 'not_a_step')) === false, 'and an unknown step is refused');
  ok((await W._funnelReport(env)).signup === 0, 'neither of which left a phantom count');
}

section('Each step is wired to the event that actually proves it');
{
  ok(/await _funnelMark\(env, user\.email, 'activated'\)/.test(src) &&
     /total > 0/.test(src.slice(src.indexOf("'activated'") - 400, src.indexOf("'activated'") + 100)),
     'activated fires when AMV has finished writing a real answer, not on a page view');
  ok(/else if\(first !== day\) await _funnelMark\(env, email, 'returned'\)/.test(src),
     'returned fires on a different calendar day from the first');
  ok(/_planPriceUSD\(_planOf\(ent\), ent\.custom\) > 0 && _planPriceUSD\(_planOf\(prev\), prev\.custom\) === 0/.test(src),
     'paid fires only on the transition from not paying to paying');
  ok(/try \{ if \(total > 0 && user && user\.email\) await _funnelMark/.test(src),
     'and the activation mark is inside a guard, in the request path');
}

section('The markers name a person, so they are erased with the account');
{
  /* The aggregate counters carry no identity and stay - the funnel would be
     useless if deleting one account rewrote history. `fstep:` and `factive:`
     name somebody, so erasure has to reach them. */
  ok(/`factive:\$\{email\}`/.test(src), 'the first-active-day marker is on the deletion list');
  ok(/FUNNEL_STEPS\.map\(step => `fstep:\$\{email\}:\$\{step\}`\)/.test(src),
     'and so is every step marker, by name rather than by guess');
  ok(!/funnel:.*delete/.test(src), 'while the aggregate counters are not touched');
}

if (report('funnel') > 0) process.exitCode = 1;
done();
