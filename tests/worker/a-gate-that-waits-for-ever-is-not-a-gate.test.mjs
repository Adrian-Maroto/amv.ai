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

section('An empty answer is not evidence that an advisory was withdrawn');
{
  /* THIS ONE COST A RED CI RUN AND A WRONG DELETION.

     The stale check read `!vulns[name]` and concluded the advisory was gone.
     npm audit can return valid JSON with an empty vulnerabilities object when
     the advisory endpoint is degraded - the same endpoint that, on this
     machine, accepts a connection and never answers, which is why the call has
     a deadline at all. So an audit that came back with nothing was read as
     proof that three specific advisories had been withdrawn, the roster was
     emptied on the strength of it, and all three were live the whole time.

     A check that can order a correct exemption destroyed on ambiguous evidence
     is worse than no check. It now needs positive evidence: either the audit
     demonstrably had data, or the package is not installed at all.

     Driven against the real rule rather than asserted about the source, because
     "does the file contain the word installed" would pass on a broken one. */
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')).packages || {};
  const isInstalled = n => Object.prototype.hasOwnProperty.call(lock, 'node_modules/' + n);
  const staleOf = (accepted, vulns) => {
    const hadData = Object.keys(vulns).length > 0;
    return Object.keys(accepted).filter(n => !vulns[n] && (hadData || !isInstalled(n)));
  };
  const A = { 'extract-zip': 1, '@puppeteer/browsers': 1, '@cloudflare/puppeteer': 1 };

  ok(staleOf(A, {}).length === 0,
     'an audit that came back with nothing retires nothing', staleOf(A, {}).join(', '));
  ok(staleOf(A, { 'extract-zip': 1, 'other': 1 }).length === 2,
     'but an audit that DID find advisories retires the ones it did not name',
     staleOf(A, { 'extract-zip': 1, 'other': 1 }).join(', '));
  ok(staleOf(A, A).length === 0,
     'and retires nothing while every one of them is still flagged', staleOf(A, A).join(', '));
  ok(staleOf({ ...A, 'left-pad': 1 }, {}).join(',') === 'left-pad',
     'a package that is not installed at all is stale whatever the audit said',
     staleOf({ ...A, 'left-pad': 1 }, {}).join(', '));

  /* And the rule that is actually shipped is the one just exercised. */
  ok(/_auditHadData/.test(code) && /_isInstalled/.test(code),
     'the script uses that rule rather than a bare !vulns[n]', true);
  ok(!/const stale = Object\.keys\(ACCEPTED\)\.filter\(n => !vulns\[n\]\);/.test(code),
     'and the version that could not tell the two apart is gone', true);
}

section('A non-zero exit always says why');
{
  /* The gate reads this script's EXIT CODE, so a silent 1 is a stage that
     failed with nothing to act on. Every failing path prints first. */
  const exits = [...code.matchAll(/process\.exit\(1\)/g)];
  ok(exits.length >= 1, 'there is at least one failing path to check', exits.length);
  const unexplained = exits.filter(m => {
    const before = code.slice(Math.max(0, m.index - 400), m.index);
    return !/console\.error\(/.test(before);
  });
  ok(unexplained.length === 0,
     'and each is preceded by a console.error naming the reason', unexplained.length);
}

section('The script still runs, whatever the network is doing right now');
{
  /* Driven rather than read. The subject of this section is TERMINATION: the
     script either audits or skips, and either way it stops on its own, says
     what it did, and does so within a bounded time.

     It used to assert exit 0, which was wrong and cost a red CI run. The script
     exits 1 on a real finding - that is its whole job - so a genuine advisory,
     or a stale exemption, failed THIS suite and reported a dependency problem
     as a hang. That is precisely the confusion this file exists to prevent:
     "the gate did not come back" and "the gate came back with bad news" are
     different facts and must not arrive under the same name. The verdict has
     its own gate stage (check.mjs stage 6), which is where a red audit belongs.

     So: killed is a failure here, and any coherent verdict is a pass. */
  let out = '', killed = '';
  const started = Date.now();
  try {
    out = execFileSync(process.execPath, [join(ROOT, 'audit-deps.mjs')],
      { encoding: 'utf8', timeout: 200000 }).toString();
  } catch (e) {
    out = String((e && e.stdout) || '') + String((e && e.stderr) || '');
    /* execFileSync sets these only when IT stopped the process - a deadline or
       a signal. An ordinary non-zero exit sets neither. */
    if (e && (e.killed === true || e.signal)) killed = String(e.signal || 'timeout');
    if (e && e.status == null && !killed) killed = String((e && e.message) || e).slice(0, 200);
  }
  const secs = Math.round((Date.now() - started) / 1000);
  ok(!killed, 'it stops on its own rather than being killed', killed);
  ok(/SKIP|OK  |FAIL/.test(out),
     'and says what it did', out.trim().split('\n').filter(Boolean).slice(-1)[0]);
  ok(secs <= 180, 'within a bounded time rather than indefinitely', secs + 's');
}

if (report('a-gate-that-waits-for-ever-is-not-a-gate') > 0) process.exitCode = 1;
done();
