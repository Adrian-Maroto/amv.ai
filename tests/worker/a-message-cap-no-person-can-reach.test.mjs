/* THE PLAN IS SOLD IN MESSAGES, SO THE SERVER HAS TO COUNT THEM.

   Nobody shopping for this counts tokens. They count messages, because that is
   what every product they might buy instead publishes - and a token figure is
   not comparable to any of them. AMV metered tokens and advertised tokens, so
   the one number a buyer wanted did not exist anywhere in the system.

   THE CAPS ARE DELIBERATELY UNREACHABLE BY A PERSON. A hundred thousand
   messages in a month is one every 8.6 seconds, eight hours a day, every day,
   without stopping. That is what makes the number honest rather than a bluff:
   no human meets this limit, so nobody is sold something they cannot have.
   What protects the business is not a small cap - it is the throughput limit
   and the automation detection that already exist, and the shape of the
   distribution behind them.

   What this file holds is the counting, because a cap that is advertised and
   not enforced is the same defect as an allowance nobody can reach, pointing
   the other way. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'messages.harness.mjs');
writeFileSync(harness, src + `
export { PLAN_LIMITS, effectiveLimits, _baseLimits };
`);
const W = await import(harness + '?t=' + Date.now());

section('Every plan is sold in messages, and the number is beyond a person');
{
  /* One message every 8.6 seconds for eight hours a day, all month. The cap is
     set where only a script arrives, which is what makes it safe to publish. */
  const PER_HUMAN_MONTH = 6000;         // 200 a day, every day - a very heavy human
  for (const plan of ['free', 'pro', 'elite', 'ultra']) {
    const lim = W.PLAN_LIMITS[plan];
    ok(typeof lim.monthMessages === 'number' && lim.monthMessages > 0,
       `[${plan}] has a message cap at all`, lim.monthMessages);
  }
  for (const plan of ['pro', 'elite', 'ultra']) {
    ok(W.PLAN_LIMITS[plan].monthMessages > PER_HUMAN_MONTH * 5,
       `[${plan}] the cap is far past what a person could send in a month`,
       W.PLAN_LIMITS[plan].monthMessages);
  }
  /* Free is a taste, not a promise, so it is allowed to be reachable - but it
     still has to be a real month of use rather than an afternoon. */
  ok(W.PLAN_LIMITS.free.monthMessages >= 1000,
     'free is a real month of messages, not a demo', W.PLAN_LIMITS.free.monthMessages);
  ok(W.PLAN_LIMITS.free.monthMessages < W.PLAN_LIMITS.pro.monthMessages,
     'and paying still raises it', [W.PLAN_LIMITS.free.monthMessages, W.PLAN_LIMITS.pro.monthMessages]);
}

section('A plan with its own budget still gets a ceiling');
{
  /* A custom plan sets its own numbers. Without a message cap the counter has
     nothing to check, and the limit quietly stops existing - which is how a
     cap disappears without anybody deleting it. */
  const custom = W._baseLimits({ plan: 'custom', customCfg: { monthTokens: 500000, dayTokens: 50000 } });
  ok(typeof custom.monthMessages === 'number' && custom.monthMessages > 0,
     'a custom plan carries a message cap', custom.monthMessages);
  const team = W._baseLimits({ plan: 'pro' });
  ok(team.monthMessages === W.PLAN_LIMITS.pro.monthMessages,
     'and an ordinary plan carries its own', team.monthMessages);
}

section('The counter is reserved before the model runs, and given back if it does not');
{
  /* Counting a message after a success undercounts every turn that failed
     halfway, which costs the operator. Counting it before and never refunding
     eats an allowance nobody spent, which costs the customer. The tokens
     already solve this by reserving and refunding, and the message has to ride
     the same path or it is a second, worse answer to a solved problem. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const at = code.indexOf('const msgName =');
  ok(at > 0, 'the message counter exists', at);

  const reserveAt = code.indexOf("op: 'reserve', amount: 1", at);
  ok(reserveAt > at, 'it is RESERVED, like the tokens', reserveAt > at);

  /* THE CLAIM, FOLLOWED TO WHERE IT IS ANSWERED.

     This looked for `msgName` and `amount: -1` inside the refund, which was
     true while three windows were refunded by three hand-written lines. They
     are booked into one list now and given back by one `unbook()`, which is a
     better shape for the reason this assertion exists - a fourth window cannot
     be added above and forgotten below. So the check follows the claim: the
     refund reaches the one path that gives bookings back, and that path really
     does reverse what was taken. */
  const refundAt = code.indexOf('const refundReservation', at);
  const refundBody = code.slice(refundAt, refundAt + 900);
  ok(/unbook\(\)/.test(refundBody),
     'the refund reaches the path that gives bookings back', true);
  const unbookAt = code.indexOf('const unbook = async');
  const unbookBody = code.slice(unbookAt, unbookAt + 400);
  ok(/amount: -b\.amount/.test(unbookBody) && /of booked/.test(unbookBody),
     'and that path reverses exactly what was booked, whatever was booked', true);
  ok(/booked\.push\(\{ name: msgName/.test(code),
     'with the message itself among the bookings', true);

  /* AND A REFUSAL MUST NOT KEEP THE TOKENS IT ALREADY BOOKED.

     Scoped to the refusal branch itself, which the first version of this was
     not: it read a window of characters after the reservation, and
     `refundReservation` sits inside that window carrying the very text being
     looked for. So the check passed by matching a DIFFERENT function, and
     deleting the refund it was meant to guard changed nothing. Measured by
     breaking it, which is the only way that shows up.

     The branch is cut out exactly - from the refusal test to its closing brace
     - so what is asserted is what that branch does and nothing else. */
  const branchStart = code.indexOf('if (!msgRes.allowed)', at);
  ok(branchStart > at, 'the refusal branch was found', branchStart > at);
  let depth = 0, branchEnd = branchStart;
  for (let i = code.indexOf('{', branchStart); i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) { branchEnd = i; break; }
  }
  const branch = code.slice(branchStart, branchEnd);
  ok(branch.length > 50 && branch.length < 1400, 'and it is a branch, not the rest of the file', branch.length);
  /* The refusal used to hand the tokens back inline, and counting those two
     lines was how this was checked. Three windows can now refuse, so they
     share one path rather than repeating the refund three times - and the
     assertion moves with it, to that path, which is where the property now
     lives. */
  ok(/refuseWindow\(/.test(branch),
     'a refusal goes through the one path that gives everything back', true);
  const rwAt = code.indexOf('const refuseWindow');
  const rw = code.slice(rwAt, rwAt + 420);
  ok((rw.match(/amount: -reserve/g) || []).length === 2,
     'and that path hands back BOTH token reservations', rw.match(/amount: -reserve/g).length);
  ok(/unbook\(\)/.test(rw),
     'along with every window booked before the refusal', true);
}

section('It is keyed like the money, not like the account');
{
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const line = code.slice(code.indexOf('const msgName ='), code.indexOf('const msgName =') + 120);
  /* A team shares one plan, so it shares one allowance - keying on the email
     would multiply the plan by the number of people on it. And the period is
     the one they are BILLED on, not the calendar month, or the counter resets
     on a day that means nothing to them. */
  ok(/\$\{subject\}/.test(line), 'keyed on the billing subject, so a team shares one allowance', line.trim());
  ok(/_periodKeyOf\(user\)/.test(line), 'and on the billing period, not the calendar month', line.trim());
  ok(!/usg:/.test(line), 'under its own prefix, so nothing already stored changes meaning', line.trim());
}

section('The screen reads the counter that would refuse the next message');
{
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const rep = code.slice(code.indexOf('async function usageReport'), code.indexOf('async function usageReport') + 2200);
  ok(/msgs:\$\{subject\}/.test(rep),
     'the usage report reads the same key the proxy reserves against', true);
  ok(/messages:\s*\{\s*used/.test(rep), 'and reports messages as their own figure', true);
  ok(/limit:\s*limits\.monthMessages/.test(rep),
     'against the enforced cap, not a number typed twice', true);
}

section('What a message really costs is measured, never assumed');
{
  /* The variable that decides whether a large cap is generous or ruinous is
     reply length, and no estimate survives contact with real traffic. Two
     figures already in hand divide into the answer. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const rep = code.slice(code.indexOf('async function usageReport'), code.indexOf('async function usageReport') + 2200);
  ok(/perMessageUSD/.test(rep), 'the real cost per message is reported', true);
  ok(/msgUsed > 0 \?/.test(rep),
     'and is null until there is something to divide, rather than a made-up figure', true);
}

if (report('a-message-cap-no-person-can-reach') > 0) process.exitCode = 1;
done();
