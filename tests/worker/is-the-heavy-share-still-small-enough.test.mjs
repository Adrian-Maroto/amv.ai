/* A CAP BEYOND WHAT A PERSON CAN REACH IS SAFE UNTIL IT ISN'T.

   The message caps are set where only a script arrives, which costs nothing
   while almost every account sends a few hundred messages a month. The
   arithmetic behind that is unforgiving and it is the whole reason this file
   exists: with a typical account at four hundred messages, one percent of
   accounts running to the cap still leaves a healthy margin, two percent
   leaves almost none, and five percent loses money on every subscriber in the
   book - including the ones who barely use it.

   So the business does not turn on the cap. It turns on the shape of the
   distribution, and nothing was measuring that shape, which meant the caps
   were safe by assumption. This is the measurement, and what it must not do is
   cost a read per account - a measurement whose price grows with the customer
   list is one that gets deleted the first time the bill is looked at. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'cohort.harness.mjs');
writeFileSync(harness, src + `
export { runCohortCheck, _breakEvenMessages, PLAN_LIMITS,
         COHORT_OVERHEAD_SHARE, COHORT_COST_PER_MESSAGE_USD,
         COHORT_HEAVY_SHARE_ALARM, COHORT_MIN_ACCOUNTS };
export function __setAlertOnce(fn){ alertOnce = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

/* A counter store that answers only what this check asks for. */
const vals = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k) { return vals.has('kv:' + k) ? vals.get('kv:' + k) : null; },
    async put(k, v) { vals.set('kv:' + k, String(v)); },
    async delete(k) { vals.delete('kv:' + k); },
    async list() { return { keys: [], list_complete: true }; },
  },
  AMV_COUNTER: {
    idFromName: (n) => ({ name: n }),
    get: (id) => ({
      async fetch(_u, init) {
        const body = JSON.parse(init.body);
        const key = 'c:' + id.name;
        if (body.op === 'get') return new Response(JSON.stringify({ value: vals.get(key) || 0 }));
        if (body.op === 'incr') { vals.set(key, (vals.get(key) || 0) + body.amount); return new Response(JSON.stringify({ value: vals.get(key) })); }
        return new Response(JSON.stringify({ allowed: true, value: 0 }));
      },
    }),
  },
};
let alerts = [];
W.__setAlertOnce(async (_e, key, msg) => { alerts.push({ key, msg }); return true; });

const period = new Date().toISOString().slice(0, 7);
function seed(active, heavy) {
  vals.clear(); alerts = [];
  vals.set('c:cohort:active:' + period, active);
  vals.set('c:cohort:heavy:' + period, heavy);
}

section('Break-even is computed from the plan that funds it');
{
  /* Typed numbers go stale the moment a price or a rate moves; a derived one
     follows them. And the overhead share is in it because gross margin on
     tokens is not margin - tax, fees, infrastructure and support are paid out
     of the same fifteen dollars. */
  const pro = W._breakEvenMessages({ plan: 'pro' });
  ok(pro > 0, 'a paid plan has a break-even at all', pro);
  /* $15, less 30% overhead, at the stated cost per message. */
  const expect = Math.floor((15 * (1 - W.COHORT_OVERHEAD_SHARE)) / W.COHORT_COST_PER_MESSAGE_USD);
  ok(pro === expect, 'and it is the plan price less overhead, divided by the cost of a message', [pro, expect]);
  ok(pro < W.PLAN_LIMITS.pro.monthMessages,
     'break-even sits far below the published cap, which is why the cap is not the protection',
     [pro, W.PLAN_LIMITS.pro.monthMessages]);

  const dearer = W._breakEvenMessages({ plan: 'ultra' });
  ok(dearer > pro, 'a dearer plan funds more messages before it stops paying for itself', [pro, dearer]);
  ok(W._breakEvenMessages({ plan: 'free' }) === 0,
     'and a free account has no revenue to break even against, so it is never counted heavy', 0);
  /* THE PROPERTY, HELD WITHOUT A BRANCH TO HOLD IT.

     A break-even of NaN would mean nobody is ever counted heavy and the alarm
     goes quiet without failing - and silence is the one failure mode a safety
     measurement must not have. There is no guard in the function for it,
     deliberately: two attempts to write one turned out to be dead, because the
     price it reads ends in `|| 0` and cannot return anything but a finite,
     non-negative number. So the guarantee comes from upstream and this is what
     proves it still does - if that ever changes, this line fails rather than
     the alarm going quietly deaf. */
  for (const bad of [{ plan: 'custom', customCfg: { price: 'twenty' } },
                     { plan: 'custom', customCfg: { price: NaN } },
                     { plan: 'custom', customCfg: {} }]) {
    const v = W._breakEvenMessages(bad);
    ok(Number.isFinite(v), 'a broken plan price gives a real number, never NaN', v);
  }
}

section('A share computed from a handful of accounts is not reported');
{
  /* Three heavy out of five is sixty percent and means nothing. An alarm that
     fires on a meaningless number is an alarm somebody switches off, and then
     it is not there for the real one. */
  seed(5, 3);
  const r = await W.runCohortCheck(env);
  ok(r.ran === true, 'the check runs', r);
  ok(r.share === null, 'but reports no share', r);
  ok(alerts.length === 0, 'and raises nothing', alerts.length);
}

section('A healthy month is measured and stays quiet');
{
  seed(1000, 5);                                   // half a percent
  const r = await W.runCohortCheck(env);
  ok(r.share === 0.005, 'the share is reported', r.share);
  ok(!r.alarmed, 'and nothing is raised, because half a percent is fine', r);
  ok(alerts.length === 0, 'no alert', alerts.length);
}

section('The month the margin starts going, somebody is told');
{
  seed(1000, 35);                                  // three and a half percent
  const r = await W.runCohortCheck(env);
  ok(r.alarmed === true, 'it alarms', r);
  ok(alerts.length === 1, 'exactly once', alerts.length);
  const msg = alerts[0].msg;
  ok(/3[45]?%|3\.5/.test(msg) || /35 of 1000/.test(msg),
     'and says how many out of how many, not just that something is wrong', msg.slice(0, 120));
  /* THE PART THAT MAKES IT ACTIONABLE. A page that says a number is bad and
     not what to look at is a page that gets acknowledged and forgotten. */
  ok(/cost per message/i.test(msg),
     'it points at the real cost per message, which is the usual cause', msg.slice(-160));
  ok(/replies have got longer|longer/i.test(msg),
     'and names the thing that actually moves it', msg.slice(-160));
  ok(/pricing decision|Nothing has been changed/i.test(msg),
     'while making clear nothing was changed automatically', msg.slice(-200));
}

section('It costs the same whether there are ten customers or ten million');
{
  /* The reason this is two counters and not a scan. A measurement whose price
     grows with the customer list is one that gets deleted the first time
     somebody looks at the bill - and then the caps are back to being safe by
     assumption. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const fn = code.slice(code.indexOf('async function runCohortCheck'),
                        code.indexOf('async function runRenewalSweep'));
  ok(fn.length > 200, 'the check was found', fn.length);
  ok(!/scan\(/.test(fn), 'it does not scan the accounts', true);
  ok(!/DB\.get/.test(fn), 'and reads no account record', true);
  const reads = (fn.match(/op: 'get'/g) || []).length;
  ok(reads === 2, 'exactly two counter reads, whatever the size of the business', reads);
}

section('And it reports rather than acts');
{
  /* What to do about a rising heavy share is a pricing decision. A cron job
     throttling customers at four in the morning is not a pricing decision, it
     is an outage with a spreadsheet behind it. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const fn = code.slice(code.indexOf('async function runCohortCheck'),
                        code.indexOf('async function runRenewalSweep'));
  for (const [what, re] of Object.entries({
    'change an entitlement': /setEntitlement/,
    'mark anybody past due': /_markPastDue/,
    'block an account': /blocked/,
    'write a plan': /DB\.put/,
  })) {
    ok(!re.test(fn), `it does not ${what}`, what);
  }
}

section('The cron runs it, in its own try');
{
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const sched = code.slice(code.indexOf('async scheduled('), code.indexOf('async scheduled(') + 6000);
  ok(/runCohortCheck\(env\)/.test(sched), 'the tick calls it', true);
  /* Two counter reads must not be able to take out the sweep that revokes
     plans for unpaid subscriptions. */
  const at = sched.indexOf('runCohortCheck');
  const around = sched.slice(Math.max(0, at - 200), at + 300);
  ok(/try\s*\{/.test(around) && /catch/.test(around),
     'inside its own try, so it cannot take out the renewal sweep', true);
}

if (report('is-the-heavy-share-still-small-enough') > 0) process.exitCode = 1;
done();
