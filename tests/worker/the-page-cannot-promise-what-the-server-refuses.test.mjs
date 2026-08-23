/* SOMEBODY PAID SEVENTY-FIVE DOLLARS A MONTH FOR THE WORD "UNLIMITED".

   The plans page sold Elite and above "Unlimited scheduled automations", in the
   feature list and again in the comparison table. The server has never allowed
   it. AUTO_MAX_BY_PLAN caps Elite at 25 and Ultra at 100, a Teams seat gets
   five per seat, and a Custom plan gets 25 or 100 by its tier.

   Nothing was wrong with the limit - 25 background jobs is a good number. The
   claim was wrong, and a customer found out at their twenty-sixth job, having
   already paid for a month of something the product cannot do.

   Two guards, and the second is the one that lasts:

     the page may not use a word the enforcement does not support, and

     the number the page prints is READ FROM the same table the server
     enforces, so the two cannot drift apart again. That is the actual defect -
     not the word, but a claim and its enforcement living in two files with
     nothing tying them together. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const server = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const client = readFileSync(join(ROOT, 'app.js'), 'utf8');

/* Both tables, read out of the source they actually live in. Parsed rather
   than imported: app.js is a browser bundle and the Worker is a module, and a
   test that only compares two things it defined itself compares nothing. */
function table(src, name) {
  const m = codeOnly(src).match(new RegExp(name + '\\s*=\\s*\\{([^}]*)\\}'));
  if (!m) return null;
  const out = {};
  for (const [, k, v] of m[1].matchAll(/([a-z]+)\s*:\s*(\d+)/g)) out[k] = Number(v);
  return out;
}

section('The page and the server read the same numbers');
{
  const s = table(server, 'AUTO_MAX_BY_PLAN');
  const c = table(client, 'AUTO_MAX_BY_PLAN');
  ok(!!s, 'the Worker has a per-plan automation cap', s);
  ok(!!c, 'and the app carries the same table for the page to print', c);
  ok(s && c && JSON.stringify(s) === JSON.stringify(c),
     'and the two agree, plan for plan', JSON.stringify(s) + ' vs ' + JSON.stringify(c));
  ok(s && Object.keys(s).length >= 4, 'covering every named plan', s && Object.keys(s));
  const sPer = (codeOnly(server).match(/AUTO_MAX_PER_USER\s*=\s*(\d+)/) || [])[1];
  const cPer = (codeOnly(client).match(/AUTO_MAX_PER_USER\s*=\s*(\d+)/) || [])[1];
  ok(!!sPer && sPer === cPer, 'and so does the hard per-account ceiling', sPer + ' vs ' + cPer);
}

section('No plan is sold something the server refuses');
{
  const code = codeOnly(client);
  /* The feature lists and the comparison table, taken as text. "Unlimited" is
     legitimate elsewhere on the page - parallel agents genuinely have no cap -
     so this asks only about the claim that was false. */
  const bad = [
    /[Uu]nlimited scheduled automations?/,
    /[Uu]nlimited (?:background )?(?:scheduled )?jobs/,
    /[Uu]nlimited automations?/,
  ].filter(re => re.test(code));
  ok(bad.length === 0, 'nothing sells unlimited background jobs', bad.map(String));

  /* And the row that used to print the word now prints a number that comes
     from the table, rather than a literal somebody has to remember to update. */
  ok(/Scheduled & background jobs['"],\s*p\s*=>\s*String\(_autoMaxForPlan\(p\)\)/.test(code),
     'the comparison row is computed from the cap, not typed out', true);
  ok(/_autoMaxLabel\('elite'\)/.test(code) && /_autoMaxLabel\('ultra'\)/.test(code),
     'and so are the two feature lists that named it', true);
}

section('The page prints the number the server would actually grant')
{
  const code = codeOnly(client);
  const scode = codeOnly(server);
  /* Both functions, lifted by brace-matching rather than by slicing between
     landmarks - the first attempt swallowed four hundred lines of the bundle
     and blew up on `window`, which is a test failing for a reason that has
     nothing to do with the claim. */
  const grab = (src, name) => {
    const i = src.indexOf('function ' + name + '(');
    if (i < 0) return '';
    let d = 0;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
      if (src[k] === '{') d++;
      else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
    }
    return '';
  };
  const tbl = (src) => (src.match(/const AUTO_MAX_BY_PLAN\s*=\s*\{[^}]*\};/) || [''])[0];

  const clientMax = new Function('TEAM_SEAT_MIN',
    tbl(code) + '\n' + (code.match(/const AUTO_MAX_PER_USER\s*=\s*\d+;/) || [''])[0] + '\n'
    + grab(code, '_autoMaxForPlan') + '\nreturn _autoMaxForPlan;')(3);
  const serverMax = new Function(
    tbl(scode) + '\n' + (scode.match(/const AUTO_MAX_PER_USER\s*=\s*\d+;/) || [''])[0]
    + '\nfunction _teamSeatCount(){ return 3; }\nfunction _customRank(){ return 2; }\n'
    + grab(scode, '_autoMaxFor') + '\nreturn _autoMaxFor;')();

  ok(typeof clientMax === 'function' && typeof serverMax === 'function',
     'both implementations were lifted out of their own source', true);

  /* The answers, not the tables. `AUTO_MAX_BY_PLAN.free` is 0 and the server
     returns 1 for free, because `|| 1` turns the zero into the one weekly job
     the refusal message promises. Comparing the tables would have missed that
     entirely and called them equal; comparing what each one ANSWERS is what
     the page actually prints. */
  for (const plan of ['free', 'pro', 'elite', 'ultra', 'custom']) {
    const a = serverMax(plan, {});
    const b = clientMax(plan);
    ok(a === b, 'the page and the server agree on ' + plan, a + ' vs ' + b);
  }
  ok(serverMax('free', {}) === 1,
     'and free really is the one weekly job the refusal message promises', serverMax('free', {}));
}

section('Throughput is sold as the tier it actually is')
{
  /* The comparison table used to read Free "-", Pro "Limited", Elite "Up to 5",
     Ultra "Unlimited" for parallel agents. NOTHING in the Worker caps
     concurrency at any tier, so Pro and Elite already had what Ultra was sold
     as having and the headline reason to pay $125 more was fiction.

     Not closed by adding a cap - that removes capability from paying customers
     to make a table honest, for no margin gain. Closed by selling the
     throughput tier that is real and enforced atomically: PLAN_LIMITS.rpm. */
  const code = codeOnly(client);
  const scode = codeOnly(server);

  const srvRpm = {};
  for (const m of scode.matchAll(/(free|pro|elite|ultra):\s*\{[^}]*rpm:\s*(\d+)/g)) srvRpm[m[1]] = Number(m[2]);
  const cliRpm = {};
  const cm = code.match(/const PLAN_RPM\s*=\s*\{([^}]*)\}/);
  if (cm) for (const m of cm[1].matchAll(/([a-z]+)\s*:\s*(\d+)/g)) cliRpm[m[1]] = Number(m[2]);

  ok(Object.keys(srvRpm).length >= 4, 'the Worker sets a per-plan requests-a-minute limit', srvRpm);
  ok(Object.keys(cliRpm).length >= 4, 'and the page carries the same table', cliRpm);
  ok(JSON.stringify(srvRpm) === JSON.stringify(cliRpm),
     'and they agree, plan for plan', JSON.stringify(srvRpm) + ' vs ' + JSON.stringify(cliRpm));

  /* It is enforced, not merely declared - this is the difference between the
     row that was there before and the one replacing it. */
  ok(/rateCheck[^;]*limits\.rpm|limits\.rpm[^;]*rateCheck/.test(scode.replace(/\s+/g, ' ')),
     'and the Worker actually checks it, atomically', true);

  ok(!/Parallel agents \/ long jobs/.test(code),
     'the fictional parallel-agents row is gone', true);
  ok(!/[Uu]nlimited parallel agents/.test(code),
     'and nothing anywhere still sells unlimited parallel agents', true);
  ok(/_rpmCell\(p\)/.test(code),
     'the row is computed from the enforced limit, not typed out', true);
}

section('The usage multiplier is computed, and conservative')
{
  /* The page advertised 5x / 20x / 50x against Free while PLAN_LIMITS delivers
     7.2x / 28x / 72x - conservative on every tier, so no exposure, just a
     number nobody had recomputed since the allowances moved, quoted at the
     moment somebody decides whether to pay.

     Computed from the allowance now and rounded DOWN, because an advertised
     multiplier is a promise: an exact figure drops visibly the next time the
     allowances are tuned, a rounded-down one has headroom. */
  const code = codeOnly(client);
  const scode = codeOnly(server);

  const srv = {};
  for (const m of scode.matchAll(/(free|pro|elite|ultra):\s*\{[^}]*monthTokens:\s*(\d+)/g)) srv[m[1]] = Number(m[2]);
  const cli = {};
  const cm = code.match(/const PLAN_MONTH_TOKENS\s*=\s*\{([^}]*)\}/);
  if (cm) for (const m of cm[1].matchAll(/([a-z]+)\s*:\s*(\d+)/g)) cli[m[1]] = Number(m[2]);

  ok(Object.keys(srv).length >= 4, 'the Worker sets a monthly allowance per plan', srv);
  ok(JSON.stringify(srv) === JSON.stringify(cli),
     'and the page carries the same numbers', JSON.stringify(srv) + ' vs ' + JSON.stringify(cli));

  /* Run the real function out of the bundle, against the SERVER's numbers. */
  const grab = (src, name) => {
    const i = src.indexOf('function ' + name + '(');
    let d = 0;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
      if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
    }
    return '';
  };
  const mult = new Function(
    (code.match(/const PLAN_MONTH_TOKENS\s*=\s*\{[^}]*\};/) || [''])[0] + '\n'
    + grab(code, '_usageMultiplier') + '\nreturn _usageMultiplier;')();

  for (const p of ['pro', 'elite', 'ultra']) {
    const real = srv[p] / srv.free;
    const shown = mult(p);
    ok(shown > 1, p + ' advertises a multiplier at all', shown);
    ok(shown <= real, p + ' never claims more than the allowance delivers',
       'claims ' + shown + 'x, delivers ' + real.toFixed(1) + 'x');
    ok(real - shown < 6, 'and does not undersell it into meaninglessness',
       'claims ' + shown + 'x, delivers ' + real.toFixed(1) + 'x');
  }

  ok(!/mult:'[0-9]/.test(code),
     'no plan carries a hand-typed multiplier any more', true);
}

section('The label says what the answer is');
{
  const code = codeOnly(client);
  const grab = (src, name) => {
    const i = src.indexOf('function ' + name + '(');
    let d = 0;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
      if (src[k] === '{') d++;
      else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
    }
    return '';
  };
  const label = new Function('TEAM_SEAT_MIN',
    (code.match(/const AUTO_MAX_BY_PLAN\s*=\s*\{[^}]*\};/) || [''])[0] + '\n'
    + (code.match(/const AUTO_MAX_PER_USER\s*=\s*\d+;/) || [''])[0] + '\n'
    + grab(code, '_autoMaxForPlan') + '\n' + grab(code, '_autoMaxLabel') + '\nreturn _autoMaxLabel;')(3);
  const s = table(server, 'AUTO_MAX_BY_PLAN');
  ok(label('free') === '1 scheduled job', 'free reads as its single job, singular', label('free'));
  ok(label('pro') === s.pro + ' scheduled jobs', 'Pro prints its five', label('pro'));
  ok(label('elite') === s.elite + ' scheduled jobs', 'Elite prints twenty-five, not "unlimited"', label('elite'));
  ok(label('ultra') === s.ultra + ' scheduled jobs', 'Ultra prints its hundred', label('ultra'));
}

report();
done();
