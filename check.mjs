#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   AMV HEALTH GATE  -  `npm run check`

   One command, one answer: is this safe to ship?

   It runs the whole gauntlet in fail-fast order (cheapest checks first so a
   syntax slip doesn't wait behind the full test suite):

     1. Syntax        - node --check on both source files
     2. Worker module - the Worker must load as an ES MODULE, not just parse as
                        a script (node --check passes on a Worker that would
                        fail to deploy; this catches that gap)
     3. Build         - a fresh build, then verify index.html actually reflects
                        current source (the "stale build" trap)
     4. Tests         - every suite
     5. Preflight     - the deploy config is valid

   Exit 0 = green, ship it. Exit 1 = red, with the first failure spelled out.
   No keys required.
   ───────────────────────────────────────────────────────────────────────── */
import { gzipSync } from 'zlib';
import { execSync } from 'child_process';
import { readFileSync, existsSync, writeFileSync } from 'fs';
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
const TOTAL = FAST ? 4 : 7;   // syntax, worker, build, ports, suites, page weight, preflight

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
    console.log(`${B}${RED}✗ NOT shippable${X} - fix the above, then run ${B}npm run check${X} again.\n`);
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

console.log(`\n${B}AMV health gate${X} ${DIM}- full shippability check${X}\n`);

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
    throw new Error(`index.html is STALE - missing ${missing.join(', ')}. The build did not pick up current app.js.`);
});

/* ── 3b. Nothing else is holding the test ports ───────────────────────────
   The e2e harness serves the app from 9100 upwards. If anything else is on
   9100 - a leftover server, or a second gate somebody forgot to stop - every
   browser-driven suite dies with EADDRINUSE and the run reports fifty-odd
   failures that say nothing about the code.

   That has now cost two full gate runs and a lot of reading, both times because
   the symptom points at the product and the cause is the machine. So it is
   checked in one second, before the thirty minutes, and named exactly. */
/* Synchronous on purpose: step() calls fn() without awaiting it, so an async
   check here would return a promise nobody looks at and report a tick whatever
   happened. A guard that cannot fail is worse than no guard. */
if (!FAST) step('Test ports are free', () => {
  const probe =
    "const s=require('net').createServer();" +
    "s.once('error',e=>{console.log(e.code||'EADDRINUSE');process.exit(3)});" +
    "s.listen(9100,()=>s.close(()=>process.exit(0)));";
  try {
    execSync(`node -e "${probe}"`, { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    const why = ((e.stdout || '').toString() + (e.stderr || '').toString()).trim() || 'in use';
    throw new Error(
      'port 9100 is not free (' + why + '), so every browser-driven suite would fail with '
      + 'EADDRINUSE and not one of those failures would be about the code. Something else is '
      + 'still running - most likely another `npm run check`, or a test server left behind. '
      + 'Stop it, then run this again.');
  }
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

/* ── 4b. Page weight ──────────────────────────────────────────────────────
   index.html is one file and every visitor downloads all of it before the app
   exists. Nothing measured it, so it could only grow - and it had, to 2.3MB
   plain. The ceiling is set a little above where the build lands today so a
   real regression fails here rather than on somebody's phone. */
step('Page weight is under control', () => {
  const buf = readFileSync(R('index.html'));
  const wire = gzipSync(buf).length;
  const KB = (n) => Math.round(n / 1024) + 'KB';
  const CEILING = 620 * 1024;   // gzipped, which is what actually crosses the network
  if (wire > CEILING)
    throw new Error(`index.html is ${KB(wire)} gzipped (${KB(buf.length)} raw) - over the ${KB(CEILING)} ceiling. `
      + 'Trim it, or raise the ceiling deliberately and say why.');
});

/* ── 5. Deploy preflight ─────────────────────────────────────────────────── */
step('Deploy preflight', () => {
  // Preflight exits 1 when the config isn't deployable. In dev the KV id is a
  // placeholder, which SHOULD flag - so we surface that as a WARNING here rather
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

/* WHAT THIS COMMIT IS ALLOWED TO DEPLOY.

   A Stop hook fast-forwards main to whatever is committed, and Render deploys
   main - so an intermediate commit that happens to be red goes live, and mails
   a failure. That is most of where a mailbox full of CI failures came from: not
   one broken thing, but a red commit reaching main for the few minutes before
   the follow-up fixed it.

   So a FULL pass records which commit it passed on. The hook pushes the branch
   always - work is never stranded - and moves main only when this marker names
   the exact commit it is about to push. A commit nobody has proven stays on the
   branch, which is where an unproven commit belongs.

   --fast never writes it: it skips the suites, so it has proven nothing about
   whether the product works. */
if (!FAST) {
  try {
    const head = execSync('git rev-parse HEAD', { cwd: ROOT, stdio: 'pipe' }).toString().trim();
    writeFileSync(join(ROOT, '.gate-pass'), head + '\n');
  } catch (e) { /* not a git checkout, or git is unavailable - not a gate failure */ }
}
console.log('');
/* AMV-094: SHIPPABLE and DEPLOYABLE are two different claims, and printing one
   green line for both let a config blocker hide behind a passing test suite.
   The code can be perfect while the deploy would still fail on a placeholder
   namespace id - and "all checks passed" is exactly the sentence that stops
   anyone looking. So the verdict now says which of the two it means. */
if (globalThis.__preflightPlaceholderWarn) {
  console.log(`${B}${G}✓ SHIPPABLE${X} - code is ready: all checks passed in ${secs}s.`);
  console.log(`${DIM}  (source valid · worker loads · build fresh · tests green)${X}`);
  console.log('');
  console.log(`${B}${Y}! NOT DEPLOYABLE YET${X} - 1 configuration blocker:`);
  console.log(`  ${Y}•${X} AMV_KV namespace id is still the placeholder in wrangler.toml`);
  console.log(`    ${DIM}→ npx wrangler kv namespace create AMV_KV, then paste the id${X}`);
  console.log(`${DIM}  Deploying now would fail, or write to the wrong store.${X}\n`);
  process.exit(0);
}
console.log(`${B}${G}✓ SHIPPABLE${X} - all checks passed in ${secs}s.`);
console.log(`${DIM}  (source valid · worker loads · build fresh · tests green · config checked)${X}\n`);
process.exit(0);
