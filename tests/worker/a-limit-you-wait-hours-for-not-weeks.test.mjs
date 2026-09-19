/* A MONTHLY CAP HAS ONE FAILURE MODE AND IT IS SEVERE.

   Somebody who works hard for three days is locked out for the remaining
   twenty-seven, and the product they pay for simply stops. A daily cap does
   the same thing in miniature, landing in the middle of whatever they were
   doing and lasting until midnight in a timezone they may not live in.

   A rolling five-hour window cannot lock anybody out for long: the worst wait
   is a few hours and it arrives four or five times a day. It bounds a burst,
   which is the only thing a short window is good at, without ever becoming a
   wall. That is the shape of every product AMV is compared to, for this
   reason rather than by imitation.

   The weekly window does a different job. It bounds the DEAREST engines,
   which is where the money actually goes, and it is what makes "the best
   engine at the cheapest paid tier" a sentence that survives the invoice: a
   hundred of those a week is about ten dollars fifty a month, which is what a
   fifteen dollar plan has to spend after overhead.

   What this file holds is that all three windows are real, that a refusal
   names the one that clears soonest, and that nothing is left booked behind a
   refusal - because a partial booking is an allowance nobody spent. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'windows.harness.mjs');
writeFileSync(harness, src + `
export { PLAN_LIMITS, ENGINES, window5hKey, weekKey, WINDOW_5H_MS,
         _DEAREST_ENGINE_IN_COST, _baseLimits, COHORT_OVERHEAD_SHARE };
`);
const W = await import(harness + '?t=' + Date.now());

section('The five-hour window really rolls, and cannot be moved');
{
  const t = Date.UTC(2026, 0, 15, 9, 30);
  ok(W.window5hKey(t) === W.window5hKey(t + 60 * 1000),
     'a minute later is the same window', W.window5hKey(t));
  ok(W.window5hKey(t) !== W.window5hKey(t + W.WINDOW_5H_MS),
     'five hours later is a different one', [W.window5hKey(t), W.window5hKey(t + W.WINDOW_5H_MS)]);
  /* Derived from absolute time, so it cannot be reset by changing a timezone -
     which a date-string key would allow, and which is the cheapest possible
     way round a limit. */
  ok(/^\d+$/.test(W.window5hKey(t)), 'the key is absolute time, not a local date', W.window5hKey(t));
  const day = 24 * 60 * 60 * 1000;
  ok((day / W.WINDOW_5H_MS) >= 4, 'so it reopens at least four times a day', day / W.WINDOW_5H_MS);
}

section('The week starts on a Monday and holds all seven days');
{
  const mon = Date.UTC(2026, 0, 12);          // a Monday
  const sun = Date.UTC(2026, 0, 18, 23, 59);  // the Sunday after
  ok(W.weekKey(mon) === W.weekKey(sun), 'Monday and the Sunday after are one week', W.weekKey(mon));
  ok(W.weekKey(mon) !== W.weekKey(sun + 60 * 1000), 'and the next Monday is not', W.weekKey(sun + 60 * 1000));
  ok(W.weekKey(mon) === '2026-01-12', 'the key names the Monday it starts on', W.weekKey(mon));
}

section('Every plan carries both windows');
{
  for (const plan of ['free', 'pro', 'elite', 'ultra']) {
    const lim = W.PLAN_LIMITS[plan];
    ok(typeof lim.messages5h === 'number' && lim.messages5h > 0,
       `[${plan}] has a five-hour window`, lim.messages5h);
    ok(typeof lim.topMessagesWeek === 'number',
       `[${plan}] states a weekly allowance on the best engine`, lim.topMessagesWeek);
  }
  ok(W.PLAN_LIMITS.free.topMessagesWeek === 0,
     'free gets none, because free cannot reach that engine at all', 0);
  for (const plan of ['pro', 'elite', 'ultra']) {
    ok(W.PLAN_LIMITS[plan].topMessagesWeek > 0, `[${plan}] gets a real weekly allowance`,
       W.PLAN_LIMITS[plan].topMessagesWeek);
  }
  /* A custom plan without them would have windows that silently do not apply. */
  const custom = W._baseLimits({ plan: 'custom', customCfg: { price: 40 } });
  ok(custom.messages5h > 0 && custom.topMessagesWeek > 0,
     'and a custom plan inherits both rather than going uncapped', custom);
}

section('The weekly allowance is what the plan can actually fund');
{
  /* This is the number that decides whether the best engine at the cheapest
     paid tier is a claim or a loss. If it ever drifts past what the plan
     funds, that is not a product decision somebody made - it is arithmetic
     that stopped being checked. */
  const dearest = Object.values(W.ENGINES).filter(e => e.inCost === W._DEAREST_ENGINE_IN_COST)[0];
  /* A MESSAGE, NOT A MILLION TOKENS - and the first version of this confused
     the two. It took the per-million rate and multiplied it by a message
     count, arriving at four thousand dollars for a fifteen dollar plan, then
     divided and multiplied by a million in the same expression so the two
     cancelled and hid it. The rate is per million; a message has to be
     converted into tokens before it costs anything.

     The shape is the one the economics were derived from: a turn mid-way
     through a conversation, its prefix served from cache at a tenth, a short
     fresh question and a normal-length reply. */
  const CACHED_PREFIX = 4000, FRESH_IN = 150, OUT = 350;
  const perMsg = (CACHED_PREFIX * 0.1 + FRESH_IN) * dearest.inCost / 1e6
               + OUT * dearest.outCost / 1e6;
  ok(perMsg > 0.005 && perMsg < 0.1,
     'a message on the best engine costs cents, not dollars', '$' + perMsg.toFixed(5));
  for (const [plan, price] of [['pro', 15], ['elite', 75], ['ultra', 200]]) {
    const budget = price * (1 - W.COHORT_OVERHEAD_SHARE);
    const monthly = W.PLAN_LIMITS[plan].topMessagesWeek * (52 / 12);
    const cost = monthly * perMsg;
    ok(cost <= budget,
       `[${plan}] a full week of the best engine, every week, stays inside the compute budget`,
       '$' + cost.toFixed(2) + ' of compute vs $' + budget.toFixed(2) + ' available');
  }
}

section('Which engines are metered follows the table, not a typed number');
{
  /* This was `inCost >= 10`, the dearest rate as it happened to stand. A rate
     moved twice in one week here; the literal would either meter an engine
     that is no longer dear or stop metering the one that is, silently. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/_DEAREST_ENGINE_IN_COST\s*=\s*Math\.max/.test(code),
     'the dearest rate is computed from the engine table', true);
  ok(/isTopEngine\s*=\s*eng && eng\.inCost >= _DEAREST_ENGINE_IN_COST/.test(code),
     'and the weekly meter asks that, not a literal', true);
  ok(!/inCost >= 10\b/.test(code), 'no typed rate survives in the meter', true);
}

section('A refusal names the window that clears soonest');
{
  /* Booked smallest-window-first on purpose. Refused the other way round,
     somebody a few messages into a burst is told to come back next month when
     in fact they can come back at four o'clock - and that is the message that
     gets a subscription cancelled. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const at = code.indexOf('const win5Name =');
  const region = code.slice(at, at + 3000);
  const five = region.indexOf('quota_window');
  const week = region.indexOf('quota_top_week');
  const month = region.indexOf('quota_messages');
  ok(five > 0 && week > 0 && month > 0, 'all three refusals exist', { five, week, month });
  ok(five < week && week < month,
     'checked shortest window first, so the soonest reset is the one named', { five, week, month });

  /* AND THAT EACH ONE IS ACTUALLY ENFORCED, WHICH ORDER ALONE DOES NOT SAY.

     The assertions above check where the refusals sit in the file. Disabling
     the five-hour check outright leaves that order untouched, so it passed a
     mutation that removed the window entirely - the test was reading the
     shape of the code and not what it does. Each window has to be RESERVED
     against its own cap, or the limit is a comment. */
  for (const [what, cap] of Object.entries({
    'the five-hour window': 'cap: win5Cap',
    'the weekly best-engine window': 'cap: topCap',
    'the monthly backstop': 'cap: msgCap',
  })) {
    ok(region.indexOf(cap) > 0, what + ' is reserved against its own cap', cap);
  }
  /* A reserve that is never reached enforces nothing either, so the guard in
     front of each one has to be the cap being set rather than a constant. */
  for (const guard of ['if (win5Cap > 0)', 'if (topCap > 0 && isTopEngine)', 'if (msgCap > 0)']) {
    ok(region.indexOf(guard) > 0, 'reached whenever that cap is set: ' + guard, guard);
  }
}

section('Nothing stays booked behind a refusal');
{
  /* A window reserved and then refused by a LATER window is an allowance
     nobody spent, and because the caps are large it would go unnoticed for a
     long time. The bookings are tracked so the refund cannot drift from them
     the way three hand-written refunds would. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/const booked = \[\]/.test(code), 'what was taken is tracked', true);
  ok(/const unbook = async/.test(code), 'and given back by one path', true);
  const refuse = code.slice(code.indexOf('const refuseWindow'), code.indexOf('const refuseWindow') + 420);
  ok(/amount: -reserve/.test(refuse) && /unbook\(\)/.test(refuse),
     'a refusal hands back the tokens AND every window booked before it', true);
  /* And the ordinary failure path uses the same one, so a new window cannot be
     added above and forgotten below. */
  const refund = code.slice(code.indexOf('const refundReservation'), code.indexOf('const refundReservation') + 700);
  ok(/unbook\(\)/.test(refund),
     'the failed-call refund uses the same path, so a new window cannot be missed', true);
}

section('The screen can say when each window reopens');
{
  /* "812 of 1000" answers a question nobody asked. The question is when they
     can carry on, and a window that cannot say so is the same wall a monthly
     cap was - it just arrives sooner. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const rep = code.slice(code.indexOf('async function usageReport'), code.indexOf('async function usageReport') + 3000);
  ok(/window5h:\s*\{/.test(rep) && /topEngineWeek:\s*\{/.test(rep), 'both windows are reported', true);
  ok((rep.match(/resetAt:/g) || []).length >= 2, 'each with the moment it reopens', true);
  ok(/msgs5h:\$\{subject\}/.test(rep) && /msgtop:\$\{subject\}/.test(rep),
     'read from the same keys the proxy reserves against', true);
}

if (report('a-limit-you-wait-hours-for-not-weeks') > 0) process.exitCode = 1;
done();
