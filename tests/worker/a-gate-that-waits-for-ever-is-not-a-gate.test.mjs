/* THE GATE STOPPED AT STAGE SIX OF SEVEN AND STAYED THERE.

   `npm run check:fast` normally finishes in about seven seconds. It sat at
   "Dependencies have no unassessed advisories" until something killed it, and
   the full gate did the same - so nothing could be verified and nothing could
   be pushed, on a working tree with nothing wrong in it.

   audit-deps.mjs ran `execSync('npm audit --json')` with no timeout. Its skip
   path fires on an error MESSAGE - ENOTFOUND, ECONNREFUSED, EAI_AGAIN - which
   requires npm to actually fail. A registry that accepts the connection and
   then never answers does not fail. It waits, and the gate waited with it.

   The stage's own comment in check.mjs says it "skips itself when the registry
   is unreachable, because a gate that goes red on a train is a gate people
   learn to ignore". That intent is right and the code could not reach it: the
   commonest shape of a bad network is a stall, not a refusal, and a stall was
   the one case not covered.

   A gate that hangs is worse than one that fails. A failure names something; a
   hang looks like the machine being slow, and the honest response to it -
   waiting a bit longer - is the one that never ends. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execFileSync } from 'child_process';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'audit-deps.mjs'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

section('The audit cannot wait for ever');
{
  ok(/execSync\([\s\S]{0,200}?timeout:\s*[A-Z_]*AUDIT_TIMEOUT_MS/.test(code)
     || /timeout:\s*\d{4,}/.test(code),
     'the npm call is given a deadline', code.match(/timeout:[^,}]*/g));

  const m = /AUDIT_TIMEOUT_MS\s*=\s*(\d+)/.exec(code);
  ok(!!m, 'the deadline is a named constant rather than a number in the call', m && m[1]);
  const ms = m ? +m[1] : 0;
  ok(ms >= 30000,
     'long enough that a slow but working registry is not called unreachable', ms);
  ok(ms <= 300000,
     'and short enough that a stall is noticed rather than endured', ms);
}

section('A stall is reported as a stall, and not as something else');
{
  /* Naming the wrong cause sends somebody to check their DNS for an hour. The
     two conditions are genuinely different and are said differently. */
  ok(/e\.code === 'ETIMEDOUT'|e\.killed === true|e\.signal === 'SIGTERM'/.test(code),
     'a killed-on-deadline npm is recognised for what it is');
  ok(/did not answer within/.test(src),
     'and described as a registry that did not answer', src.match(/SKIP[^']*/g));
  ok(/is not reachable/.test(src),
     'while a refusal keeps its own separate wording');
}

section('And it skips rather than failing, which is the whole point');
{
  /* The stage exists to catch advisories, not to punish a bad connection. A
     gate that goes red on a train is a gate people learn to ignore - so an
     unreachable registry must exit 0 and say so, on both paths. */
  const skips = [...code.matchAll(/console\.log\('SKIP[\s\S]{0,220}?process\.exit\(0\)/g)];
  ok(skips.length >= 2,
     'both the stall and the refusal exit zero after saying why', skips.length);
  ok(/console\.error\('FAIL[\s\S]{0,120}process\.exit\(1\)/.test(code),
     'while a genuinely unreadable audit still fails, so this is not a blanket pass');
}

section('The script still runs, whatever the network is doing right now');
{
  /* Driven rather than read: it either audits or skips, and either way it
     finishes and exits 0. If the registry is reachable from here this is the
     ordinary path; if it is stalling, this is the fix under test. */
  let outcome = '', threw = '';
  const started = Date.now();
  try {
    outcome = execFileSync(process.execPath, [join(ROOT, 'audit-deps.mjs')],
      { encoding: 'utf8', timeout: 200000 }).toString();
  } catch (e) { threw = String((e && e.message) || e); }
  const secs = Math.round((Date.now() - started) / 1000);
  ok(!threw, 'it exits without being killed', threw.slice(0, 200));
  ok(/SKIP|OK|advisor/i.test(outcome),
     'and says what it did', outcome.trim().split('\n').slice(-1)[0]);
  ok(secs <= 180, 'within a bounded time rather than indefinitely', secs + 's');
}

if (report('a-gate-that-waits-for-ever-is-not-a-gate') > 0) process.exitCode = 1;
done();
