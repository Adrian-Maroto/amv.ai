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

/* ── Fail-fast on a syntax error (cheap — dies at step 1, no full suite) ──── */
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

// cleanup scratch
try { rmSync(bakApp); rmSync(bakBackend); } catch {}

report();
done();
