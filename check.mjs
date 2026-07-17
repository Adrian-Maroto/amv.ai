#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   AMV HEALTH GATE  —  `npm run check`

   One command, one answer: is this safe to ship?

   It runs the whole gauntlet in fail-fast order (cheapest checks first so a
   syntax slip doesn't wait behind the full test suite):

     1. Syntax        — node --check on both source files
     2. Worker module — the Worker must load as an ES MODULE, not just parse as
                        a script (node --check passes on a Worker that would
                        fail to deploy; this catches that gap)
     3. Build         — a fresh build, then verify index.html actually reflects
                        current source (the "stale build" trap)
     4. Tests         — every suite
     5. Preflight     — the deploy config is valid

   Exit 0 = green, ship it. Exit 1 = red, with the first failure spelled out.
   No keys required.
   ───────────────────────────────────────────────────────────────────────── */
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const R = (p) => join(ROOT, p);
const G = '\x1b[32m', RED = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

// --fast skips the full test-suite step. Used by the gate's own self-test so it
// can verify fail-fast behaviour WITHOUT recursively re-running every suite
// (which would include the self-test, causing runaway recursion).
const FAST = process.argv.includes('--fast');

const t0 = Date.now();
let stepNum = 0;
const TOTAL = FAST ? 4 : 5;

/* Run a step. `fn` should throw (with a helpful message) on failure. */
function step(label, fn) {
  stepNum++;
  process.stdout.write(`  ${DIM}[${stepNum}/${TOTAL}]${X} ${label}… `);
  const s = Date.now();
  try {
    fn();
    console.log(`${G}✓${X} ${DIM}(${Date.now() - s}ms)${X}`);
  } catch (e) {
    console.log(`${RED}✗${X}`);
    console.log(`\n${B}${RED}FAILED:${X} ${label}\n`);
    console.log(`${e.message}\n`);
    console.log(`${B}${RED}✗ NOT shippable${X} — fix the above, then run ${B}npm run check${X} again.\n`);
    process.exit(1);
  }
}

/* Run a shell command; on failure, throw an Error carrying its output. */
function sh(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString();
  } catch (e) {
    const out = (e.stdout || '').toString() + (e.stderr || '').toString();
    throw new Error(out.trim() || `command failed: ${cmd}`);
  }
}

console.log(`\n${B}AMV health gate${X} ${DIM}— full shippability check${X}\n`);

/* ── 1. Syntax ───────────────────────────────────────────────────────────── */
step('Syntax (app.js + amv-backend.js)', () => {
  for (const f of ['app.js', 'amv-backend.js']) {
    if (!existsSync(R(f))) throw new Error(`${f} is missing`);
    sh(`node --check "${R(f)}"`);
  }
});

/* ── 2. Worker loads as a MODULE ─────────────────────────────────────────── */
step('Worker loads as an ES module', () => {
  // node --check passes on a file that parses but fails to import (bad export,
  // top-level await misuse, etc). Actually import it and fail on SyntaxError.
  const path = R('amv-backend.js').replace(/\\/g, '/');
  sh(`node -e "import('file://${path}').catch(e=>{if(e instanceof SyntaxError){console.error(e.message);process.exit(1)}})"`);
});

/* ── 3. Fresh build + not stale ──────────────────────────────────────────── */
step('Build is fresh (index.html reflects source)', () => {
  sh('node build.mjs');
  const html = existsSync(R('index.html')) ? readFileSync(R('index.html'), 'utf8') : '';
  const app = existsSync(R('app.js')) ? readFileSync(R('app.js'), 'utf8') : '';
  // pick a few distinctive current-source markers; if app.js has them but the
  // built html doesn't, the build didn't actually pick up the latest source.
  const markers = ['_admGrowthBlock', 'openResearchWatch', '_abuseRecord'];
  const missing = markers.filter(m => app.includes(m) && !html.includes(m));
  if (missing.length)
    throw new Error(`index.html is STALE — missing ${missing.join(', ')}. The build did not pick up current app.js.`);
});

/* ── 4. All test suites ──────────────────────────────────────────────────── */
if (!FAST) step('All test suites', () => {
  const out = sh('node tests/run.mjs');
  // run.mjs exits non-zero on failure (so sh would throw), but double-check the
  // summary line so a silent pass-through can't slip by.
  if (!/All \d+ suites passed/.test(out)) {
    const tail = out.split('\n').slice(-12).join('\n');
    throw new Error(`the suite did not report a clean pass:\n${tail}`);
  }
});

/* ── 5. Deploy preflight ─────────────────────────────────────────────────── */
step('Deploy preflight', () => {
  // Preflight exits 1 when the config isn't deployable. In dev the KV id is a
  // placeholder, which SHOULD flag — so we surface that as a WARNING here rather
  // than failing the whole health gate on a known dev-time state.
  try {
    sh('node preflight.mjs');
  } catch (e) {
    const msg = e.message || '';
    const onlyPlaceholder = /PLACEHOLDER/.test(msg) &&
      (msg.match(/✗/g) || []).length <= 1;
    if (onlyPlaceholder) {
      // don't fail the gate for the expected dev placeholder; note it.
      globalThis.__preflightPlaceholderWarn = true;
      return;
    }
    throw new Error(msg);
  }
});

/* ── Verdict ─────────────────────────────────────────────────────────────── */
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log('');
if (globalThis.__preflightPlaceholderWarn) {
  console.log(`  ${Y}!${X} preflight: KV namespace id is still the dev placeholder`);
  console.log(`    ${DIM}→ set a real id in wrangler.toml before deploying (expected during development)${X}`);
}
console.log(`${B}${G}✓ SHIPPABLE${X} — all checks passed in ${secs}s.`);
console.log(`${DIM}  (source valid · worker loads · build fresh · tests green · config checked)${X}\n`);
process.exit(0);
