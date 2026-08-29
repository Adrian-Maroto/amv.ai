/* A GATE THAT GOES RED HAS TO SAY WHY, ON THE SURFACE WHERE THAT IS ALL YOU GET.

   Two commits went red on CI and the log was unreadable: it stopped in the
   middle of an unrelated suite, carried no failing assertion anywhere, and had
   no summary. It looked exactly like the runner had crashed. It had not - every
   byte after a certain point was simply thrown away.

   When Node's stdout is a PIPE, writes are asynchronous, and `process.exit()`
   does not flush what is still queued. A terminal is synchronous and so is a
   redirect to a file, so the same code prints in full on a laptop and is cut
   off in CI - the one place where the log is the only thing you have.

   Both halves are checked here: that the mechanism really does lose bytes (so
   the fix is not solving an imaginary problem), and that the gate no longer
   uses it. */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECK = readFileSync(join(ROOT, 'check.mjs'), 'utf8');

/* Print roughly 4MB and exit(1), the shape of a real gate failure. Captured
   through a pipe, which is what a CI step gives a process. */
const bytesThrough = (how) => {
  const prog =
    `const {writeSync}=require('fs');` +
    `const line='x'.repeat(200)+'\\n';` +
    `const body=line.repeat(20000);` +
    (how === 'console' ? `console.log(body);` : `writeSync(1, body+'\\n');`) +
    `process.exit(1);`;
  try {
    execFileSync(process.execPath, ['-e', prog], { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
    return -1;
  } catch (e) {
    return ((e.stdout || '').toString()).length;
  }
};

section('The mechanism really does lose the end of a failure message');
{
  const want = 200 * 20001 + 1;
  const viaConsole = bytesThrough('console');
  const viaWriteSync = bytesThrough('writeSync');
  ok(viaWriteSync >= want - 8,
     'writeSync + exit delivers the whole message through a pipe',
     `${viaWriteSync} of ${want}`);
  ok(viaConsole < viaWriteSync,
     'console.log + exit does NOT - which is the defect this guards',
     `${viaConsole} of ${want}`);
}

section('The gate writes its failure the way that survives');
{
  /* Anchored to the catch block in step(), not to the whole file - the rest of
     the gate prints progress with console.log and should keep doing so.

     And anchored from `function step(` rather than from the first `catch (e)`
     anywhere in the file, because that is what it used to do and the file grew
     a second one above it: a lock added at the top of the gate had a
     `catch (e) { return 0; }` and a `process.exit(1)` between it and step(),
     so this read the lock's error path, found no writeSync, and went red with
     the thing it guards completely unchanged. Same failure the comment further
     down describes for a different check - a guard anchored on the first
     textual match is a guard about whatever happens to come first. */
  const stepAt = CHECK.indexOf('function step(');
  const m = stepAt < 0 ? null
          : CHECK.slice(stepAt).match(/\}\s*catch\s*\((\w+)\)\s*\{([\s\S]*?)process\.exit\(1\);/);
  ok(!!m, 'step() still has the failure path this is about');
  const body = (m ? m[2] : '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/writeSync/.test(body), 'it writes the failure synchronously');
  ok(!/console\.log\(/.test(body),
     'and does not queue any of it behind an asynchronous write',
     body.split('\n').filter((l) => /console\.log/.test(l)).slice(0, 3));
}

section('It leads with the names of the suites that failed');
{
  /* _failureReport is not exported - importing check.mjs would RUN the gate.
     Its source is lifted out and evaluated on its own, which is the only way to
     test a function that lives inside a script that has side effects. */
  const src = CHECK.match(/function _failureReport\(fullOutput\)\s*\{[\s\S]*?\n\}/);
  ok(!!src, 'the report builder is where this expects it');
  // eslint-disable-next-line no-new-func
  const build = new Function(`${src[0]}; return _failureReport;`)();

  const fake =
    'selected 3 suite(s) (all)\n' +
    '━━━ e2e/alpha.test.mjs ━━━\n  \x1b[32m✓\x1b[0m fine\n\n3 passed, 0 failed\n' +
    '━━━ e2e/beta.test.mjs ━━━\n  \x1b[31m✗\x1b[0m the thing that broke\n      got: "42"\n\n1 passed, 1 FAILED\n' +
    '━━━ worker/gamma.test.mjs ━━━\n  \x1b[32m✓\x1b[0m also fine\n\n2 passed, 0 failed\n' +
    '\n════════ SUMMARY ════════\n' +
    '  \x1b[32m✓ e2e/alpha.test.mjs\x1b[0m\n' +
    '  \x1b[31m✗ e2e/beta.test.mjs\x1b[0m\n' +
    '  \x1b[32m✓ worker/gamma.test.mjs\x1b[0m\n' +
    '\n\x1b[31m1 suite(s) FAILED\x1b[0m\n';

  const out = build(fake);
  ok(/^1 suite\(s\) failed:/.test(out), 'the count comes first', out.split('\n')[0]);
  ok(out.includes('e2e/beta.test.mjs'), 'the failing suite is named');
  ok(out.includes('the thing that broke'), 'and its failing assertion is shown');
  ok(!out.includes('also fine'), 'while the suites that passed are left out');
  ok(out.length < fake.length, 'so the report is smaller than the raw run', `${out.length} vs ${fake.length}`);

  /* A suite that DIES prints nothing of its own, and the first version of this
     reported it as a name with an empty body underneath - "1 suite(s) failed:"
     and then nothing, which is the same unreadable failure the flush fix was
     meant to end. Its stderr is at the tail of the run, so that is what an empty
     section falls back to. Caught for real: spend.test.mjs died this way during
     an AMV-D007 gate run and the report had nothing under the name. */
  const died =
    'selected 3 suite(s) (all)\n' +
    '━━━ e2e/alpha.test.mjs ━━━\n  \x1b[32m✓\x1b[0m fine\n\n1 passed, 0 failed\n' +
    '━━━ e2e/dies.test.mjs ━━━\n' +
    '━━━ e2e/omega.test.mjs ━━━\n  \x1b[32m✓\x1b[0m also fine\n\n1 passed, 0 failed\n' +
    '\n════════ SUMMARY ════════\n' +
    '  \x1b[32m✓ e2e/alpha.test.mjs\x1b[0m\n' +
    '  \x1b[31m✗ e2e/dies.test.mjs\x1b[0m\n' +
    '  \x1b[32m✓ e2e/omega.test.mjs\x1b[0m\n' +
    '\n\x1b[31m1 suite(s) FAILED\x1b[0m\n' +
    'Error: listen EADDRINUSE: address already in use :::9100\n';
  const diedOut = build(died);
  ok(diedOut.includes('e2e/dies.test.mjs'), 'a suite that dies is still named', diedOut.split('\n')[1]);
  ok(/died rather than failed/.test(diedOut),
     'and the report says it died rather than failed');
  ok(diedOut.includes('EADDRINUSE'),
     'and shows the tail of the run, which is where its error actually landed');

  /* A clean run must pass straight through - if nothing failed, the caller's
     own "did not report a clean pass" message is the one that matters. */
  const clean = 'selected 1 suite(s)\n━━━ e2e/alpha.test.mjs ━━━\n  ✓ fine\n\nAll 1 suites passed\n';
  ok(build(clean) === clean, 'output with no failures is returned untouched');
}

report('a-failing-gate-can-be-read');
done();
