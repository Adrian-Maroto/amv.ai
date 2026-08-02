/* AGE, ON THE SIDE THE MONEY RUNS ON.

   The client has always had an age gate. It lived entirely in localStorage, so
   clearing one key walked through it - and an API key skips the browser
   altogether. Meanwhile the word "age" did not appear anywhere in the worker
   except in a cache header.

   That is the wrong place for it to be missing. Under-13 handling is strict
   liability, and a minor cannot form a binding contract, which is precisely why
   their purchases come back as chargebacks. The protection the product claimed
   to have existed only where it could not be enforced.

   Deny by default: an age nobody has recorded is "not known", never "adult".
   But not knowing is told apart from being too young, because an existing
   customer who has simply never been asked needs a prompt, not a wall. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'agegate.harness.mjs');
writeFileSync(harness, src + `
export { _moneyAgeGate, consentRecord, ADULT_AGE, DB, browserRun };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k, v){ store.set(k, String(v)); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys:[...store.keys()].filter(k=>k.startsWith(prefix||'')).map(name=>({name})), list_complete:true }; },
  },
};
W.__setRequireUser(async () => ({ email: 'a@x.com' }));
const req = (body) => new Request('https://x/v1/consent', { method:'POST', body: JSON.stringify(body || {}) });
const YEAR = new Date().getUTCFullYear();

section('An age nobody recorded is not an adult');
{
  store.clear();
  const g = await W._moneyAgeGate(env, 'a@x.com');
  ok(g && g.code === 'age_required', 'money is refused until the age is known', g);
  /* Distinct from a refusal on purpose: a customer who was never asked needs a
     prompt. Answering both with the same code would either wall them out or
     wave a minor through. */
  ok(g.code !== 'age_blocked', 'and "never asked" is not the same answer as "too young"', g.code);
}

section('The age is recorded through the consent route');
{
  await W.consentRecord(req({ termsVersion: '2026-07-26', birthYear: YEAR - 30 }), env);
  const rec = await W.DB.get(env, 'consent', 'a@x.com');
  ok(rec.birthYear === YEAR - 30, 'the birth year is stored server-side', rec.birthYear);
  ok(rec.ageSetAt > 0, 'with when', rec.ageSetAt);
  ok(rec.current && rec.current.version === '2026-07-26', 'alongside the consent it came with', rec.current);

  const g = await W._moneyAgeGate(env, 'a@x.com');
  ok(g === null, 'and an adult may now use money features', g);
}

section('Only the year is kept, not a date of birth');
{
  const rec = await W.DB.get(env, 'consent', 'a@x.com');
  ok(typeof rec.birthYear === 'number' && String(rec.birthYear).length === 4,
     'the least personal thing that does the job', rec.birthYear);
}

section('It cannot be retyped once set');
{
  /* A limit anybody can raise by answering again is not a limit. */
  await W.consentRecord(req({ termsVersion: '2026-07-26', birthYear: YEAR - 5 }), env);
  const rec = await W.DB.get(env, 'consent', 'a@x.com');
  ok(rec.birthYear === YEAR - 30, 'a second answer does not overwrite the first', rec.birthYear);
}

section('Someone under eighteen is refused, and told why');
{
  store.clear();
  await W.consentRecord(req({ termsVersion: '2026-07-26', birthYear: YEAR - 15 }), env);
  const g = await W._moneyAgeGate(env, 'a@x.com');
  ok(g && g.code === 'age_blocked', 'money features are refused', g);
  ok(/18 and over/.test(g.error), 'in a sentence that says the rule', g.error);
}

section('A nonsense year is not recorded at all');
{
  store.clear();
  await W.consentRecord(req({ termsVersion: '2026-07-26', birthYear: 1200 }), env);
  let rec = await W.DB.get(env, 'consent', 'a@x.com');
  ok(!rec.birthYear, 'a year before 1900 is ignored', rec.birthYear);

  await W.consentRecord(req({ termsVersion: '2026-07-26', birthYear: YEAR + 5 }), env);
  rec = await W.DB.get(env, 'consent', 'a@x.com');
  ok(!rec.birthYear, 'and one in the future', rec.birthYear);

  /* Ignoring it must leave the gate CLOSED, not open. */
  const g = await W._moneyAgeGate(env, 'a@x.com');
  ok(g && g.code === 'age_required', 'so money stays refused rather than allowed by a bad value', g);
}

section('The gate is actually wired into the money routes');
{
  const fn = (name) => {
    const at = src.indexOf('async function ' + name);
    const rest = src.slice(at + 1);
    const ends = [rest.indexOf('\nasync function '), rest.indexOf('\nfunction ')].filter(x => x >= 0);
    return ends.length ? src.slice(at, at + 1 + Math.min(...ends)) : src.slice(at);
  };
  ['marketBuy', 'marketWithdraw'].forEach(n => {
    const b = fn(n);
    ok(/_moneyAgeGate\(env, user\.email\)/.test(b), n + ' checks the age', n);
    /* Before it does anything with money, not after. */
    ok(b.indexOf('_moneyAgeGate') < b.indexOf('_getListing') || n !== 'marketBuy',
       'and checks it before reading the listing', n);
  });
}

section('The browser agent cannot be used to walk around it');
{
  /* It can complete a checkout, so a purchase routed through it would skip the
     check marketBuy makes. 18-universal.js warns about exactly this bypass, and
     the gate it relies on is the client-side one that can be cleared. */
  const fn = (name) => {
    const at = src.indexOf('async function ' + name);
    const rest = src.slice(at + 1);
    const ends = [rest.indexOf('\nasync function '), rest.indexOf('\nfunction ')].filter(x => x >= 0);
    return ends.length ? src.slice(at, at + 1 + Math.min(...ends)) : src.slice(at);
  };
  const b = fn('browserRun');
  ok(/_moneyAgeGate\(env, user\.email\)/.test(b), 'browserRun checks the age', true);
  /* A spend does not have to be DECLARED to happen, so the goal itself is read. */
  ok(/buy\|purchase\|checkout\|order\|pay\|subscribe/.test(b),
     'and treats a purchase-shaped goal as a purchase even with no amount declared', true);
  ok(b.indexOf('_moneyAgeGate') < b.indexOf('WEB_ABSOLUTE_SPEND_CAP'),
     'before the spend cap, so an underage run is refused rather than merely capped', true);
}

if (report('age-gate') > 0) process.exitCode = 1;
done();
