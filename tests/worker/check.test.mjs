/* HEALTH GATE self-test.
   The gate (check.mjs) is the thing you trust to say "shippable". We can't run
   the whole 60s gate inside a suite, but we CAN prove its failure-detection
   logic is sound: it fails on a syntax error, on a Worker that won't load as a
   module, and it does NOT fail merely because of the dev-time KV placeholder.
   These run check.mjs against temporary broken copies in a scratch dir. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');

/* run check.mjs, return { code, out } */
function runCheck() {
  try {
    const out = execSync('node check.mjs --fast', { cwd: ROOT, stdio: 'pipe', timeout: 180000 }).toString();
    return { code: 0, out };
  } catch (e) {
    return { code: e.status || 1, out: (e.stdout || '').toString() + (e.stderr || '').toString() };
  }
}

const APP = join(ROOT, 'app.js');
const BACKEND = join(ROOT, 'amv-backend.js');
const bakApp = join(__dir, '.build', 'app.bak.js');
const bakBackend = join(__dir, '.build', 'backend.bak.js');
mkdirSync(join(__dir, '.build'), { recursive: true });

/* ── Fail-fast on a syntax error (cheap - dies at step 1, no full suite) ──── */
section('The gate fails on a syntax error');

copyFileSync(APP, bakApp);
try {
  writeFileSync(APP, readFileSync(APP, 'utf8') + '\nconst broken = ;\n');
  const r = runCheck();
  ok(r.code === 1, 'a syntax error makes the gate exit non-zero', r.code);
  ok(/NOT shippable/.test(r.out), 'and it says NOT shippable');
  ok(/Syntax/.test(r.out), 'naming the syntax step');
} finally {
  copyFileSync(bakApp, APP);
}

// sanity: app.js is valid again after restore
try { execSync(`node --check "${APP}"`, { stdio: 'pipe' }); ok(true, 'app.js is restored and valid'); }
catch { ok(false, 'app.js failed to restore'); }

/* ── Fail on a Worker that will not load as a module (bad export) ─────────── */
section('The gate fails when the Worker will not load as a module');

copyFileSync(BACKEND, bakBackend);
try {
  writeFileSync(BACKEND, readFileSync(BACKEND, 'utf8') + '\nexport { __definitelyNotDefined__ };\n');
  const r = runCheck();
  ok(r.code === 1, 'a bad export makes the gate exit non-zero', r.code);
  ok(/NOT shippable/.test(r.out), 'and it reports NOT shippable');
} finally {
  copyFileSync(bakBackend, BACKEND);
}

try { execSync(`node --check "${BACKEND}"`, { stdio: 'pipe' }); ok(true, 'amv-backend.js is restored and valid'); }
catch { ok(false, 'amv-backend.js failed to restore'); }

/* ── The dev-time KV placeholder is a WARNING, not a hard failure ─────────── */
section('The dev KV placeholder does not fail the whole gate');

// This runs the full gate once, unmodified. In dev the KV id is the placeholder,
// so this proves the gate stays green (with a warning) rather than red.
{
  const r = runCheck();
  ok(r.code === 0, 'with only the dev placeholder outstanding, the gate is green', r.code);
  ok(/SHIPPABLE/.test(r.out), 'it reports SHIPPABLE');
  ok(/placeholder/i.test(r.out), 'while still surfacing the KV placeholder as a warning');
}

section('The gate does not fail because the suite talked too much');
{
  /* WHAT THIS SUITE COULD NOT SEE, AND WHY.

     Every check above runs `check.mjs --fast`, which SKIPS the "All test
     suites" step - sensibly, because running 287 suites inside a suite would
     take forty minutes. So the one stage capable of producing a megabyte of
     output is the one stage the test of the gate never exercised.

     And that is exactly where it broke. execSync defaults to a one-megabyte
     output buffer; the full suite crossed it when this session added ten test
     files; node killed the child and threw; and the gate printed "NOT shippable
     - fix the above" with nothing above to fix, because the summary naming the
     failing suite was in the part that never arrived. All 287 suites were
     passing while it said that.

     The stage is still not run here. What IS run is the thing that broke: a
     command whose output is larger than the old limit. That is cheap, and it
     fails on the actual defect. */
  const big = 1024 * 1024 + 64 * 1024;   // comfortably past the old default
  const probe = "node -e \"process.stdout.write('x'.repeat(" + big + "))\"";
  let threw = null, len = 0;
  try {
    len = execSync(probe, { cwd: ROOT, stdio: 'pipe', maxBuffer: 256 * 1024 * 1024 }).toString().length;
  } catch (e) { threw = e; }
  ok(threw === null, 'a command can print more than a megabyte', threw && threw.message);
  ok(len === big, 'and all of it arrives', { got: len, want: big });

  /* And the gate uses a buffer at least that large, rather than the default. */
  const gate = readFileSync(join(ROOT, 'check.mjs'), 'utf8');
  ok(/maxBuffer: SH_MAX_BUFFER/.test(gate), 'the gate sets an explicit output buffer', true);
  const m = /const SH_MAX_BUFFER = ([0-9* ]+);/.exec(gate);
  ok(!!m, 'with a named size', m && m[1]);
  const size = m ? Function('return ' + m[1])() : 0;
  ok(size >= 64 * 1024 * 1024, 'that output volume cannot realistically reach', size);

  /* And if it ever DOES, the gate says so instead of blaming the tests. A
     control that reports the wrong cause is worse than one that stays quiet:
     the second gate failure in a row is where people stop believing it. */
  ok(/is NOT a test failure/.test(gate),
     'and an over-large output is reported as itself, not as a failing suite', true);
}

section('And the stage counter counts the stages there are');
{
  /* Cosmetic, and it is the operator's screen. It printed "[8/7]" after a stage
     was added without updating the total, and the fast total was two out as
     well - the sort of thing that reads as nobody looking at the output they
     are asking somebody to trust. */
  const gate = readFileSync(join(ROOT, 'check.mjs'), 'utf8');
  const stages = (gate.match(/^\s*(?:if \(!FAST\) )?step\(/gm) || []).length;
  const skipped = (gate.match(/^\s*if \(!FAST\) step\(/gm) || []).length;
  const m = /const TOTAL = FAST \? (\d+) : (\d+);/.exec(gate);
  ok(!!m, 'the totals are declared', m && m[0]);
  ok(+m[2] === stages, 'the full total matches the stages that run', { said: m && +m[2], real: stages });
  ok(+m[1] === stages - skipped,
     'and the fast total matches the ones fast actually runs',
     { said: m && +m[1], real: stages - skipped });

  const r = runCheck();
  ok(!/\[(\d+)\/\1\]/.test(r.out.replace(/\[(\d+)\/(\d+)\]/g, (a, x, y) => (+x <= +y ? '' : a))) &&
     !/\[(\d+)\/(\d+)\]/.test(r.out.split('\n').filter(l => {
       const mm = /\[(\d+)\/(\d+)\]/.exec(l); return mm && +mm[1] > +mm[2];
     }).join('\n')),
     'and no stage numbers itself past the total', r.out.split('\n').filter(l => /\[\d+\/\d+\]/.test(l)).join(' | '));
}

// cleanup scratch
try { rmSync(bakApp); rmSync(bakBackend); } catch {}

report();
done();
