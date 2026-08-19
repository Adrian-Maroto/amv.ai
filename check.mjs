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
import { readFileSync, existsSync, writeFileSync, writeSync } from 'fs';
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
/* Kept in step with the stages below. Adding the dependency audit without
   updating this printed "[8/7]", and the fast total was two out as well - small
   things, and they read as nobody looking at the screen they are on.
   Full: syntax, worker, build, ports, suites, page weight, deps, preflight.
   Fast skips the two that need a clear machine and forty minutes (ports, suites). */
const TOTAL = FAST ? 6 : 9;
/* Stages that ran but did nothing, so the final verdict can say so instead of
   letting a green tick stand in for work that never happened. */
const skipped = [];

/* Run a step. `fn` should throw (with a helpful message) on failure. */
/* A step may return a string. It is printed beside the tick, and it exists for
   one case: a stage that legitimately did NOT run.

   The real-runtime stage skips when wrangler cannot start, which is right - a
   gate that goes red for a reason that is not the code teaches people to
   ignore it. But step() only shows output on failure, so a skip printed a
   green tick and looked exactly like twenty-seven checks passing. That is the
   shape this file has been bitten by twice: a guard that cannot fail. If a
   stage did nothing, the screen has to say so. */
function step(label, fn) {
  stepNum++;
  process.stdout.write(`  ${DIM}[${stepNum}/${TOTAL}]${X} ${label}… `);
  const s = Date.now();
  try {
    const note = fn();
    const tail = note ? ` ${Y}(${note})${X}` : '';
    console.log(`${G}✓${X} ${DIM}(${Date.now() - s}ms)${X}${tail}`);
    if (note) skipped.push(`${label} - ${note}`);
  } catch (e) {
    /* WHY THIS WRITES TO FD 1 INSTEAD OF USING console.log.

       A failing gate has to say WHICH suite failed, and on CI it did not - the
       run went red and the log stopped in the middle of an unrelated suite,
       with no summary and no failing assertion anywhere in it. It read like the
       runner had crashed. It had not.

       When Node's stdout is a PIPE, writes are asynchronous. That is what CI
       gives a step, and what a laptop does NOT: a terminal and a redirect to a
       file are both synchronous, so the same code prints everything locally and
       is cut off in CI. `process.exit()` does not flush what is still queued, so
       the tail of a multi-megabyte failure message - the part carrying the
       summary that names the failing suites - was dropped every time.

       So the gate was capable of failing in a way that could not be read, on the
       one surface where reading it is all you can do. `writeSync` on fd 1 is
       synchronous whatever stdout is attached to, and the exit happens after the
       bytes are gone. */
    const say = (t) => {
      /* No console.log fallback: falling back to the asynchronous path on the
         one write that must not be lost would reintroduce exactly this bug,
         quietly, on whichever machine happened to take the fallback. writeSync
         can report EAGAIN on a pipe whose reader is behind - the answer to that
         is to try the rest again, not to give up on it. */
      const buf = Buffer.from(t, 'utf8');
      let off = 0;
      while (off < buf.length) {
        try { off += writeSync(1, buf, off, buf.length - off); }
        catch (err) { if (err && (err.code === 'EAGAIN' || err.code === 'EINTR')) continue; return; }
      }
    };
    say(`${RED}✗${X}\n`);
    say(`\n${B}${RED}FAILED:${X} ${label}\n\n`);
    say(`${e.message}\n`);
    say(`\n${B}${RED}✗ NOT shippable${X} - fix the above, then run ${B}npm run check${X} again.\n\n`);
    process.exit(1);
  }
}

/* Run a shell command; on failure, throw an Error carrying its output. */
/* THE GATE REPORTED "NOT SHIPPABLE" BECAUSE THE SUITE PRINTED TOO MUCH.

   execSync defaults to a one-megabyte output buffer. The full suite prints
   slightly over that - it crossed the line when this session added ten test
   files - and node then KILLS the child and throws. The catch below dumped the
   truncated output and the gate said "NOT shippable - fix the above", with
   nothing above to fix, because the summary line naming the failing suite was
   in the part that never arrived.

   Every one of the 287 suites was passing while it said that. It took an hour
   to find, and it was the second gate failure in a row, which is the worst
   property this could have had: a control that cries wolf teaches people to
   stop believing it, and it would have said NOT shippable for ever - the output
   only grows.

   Two changes. The buffer is large enough that output size cannot decide
   shippability. And the two failures are told apart: a command that FAILED and
   a command that talked too much are different problems, and answering both
   with the same sentence is what hid this. */
const SH_MAX_BUFFER = 256 * 1024 * 1024;

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: 'pipe', maxBuffer: SH_MAX_BUFFER }).toString();
  } catch (e) {
    /* Node reports this as ENOBUFS, and on some versions only as a message. */
    if (e && (e.code === 'ENOBUFS' || /maxBuffer/i.test(String(e.message || '')))) {
      throw new Error(
        `The output of \`${cmd}\` exceeded ${Math.round(SH_MAX_BUFFER / 1048576)}MB and the run was killed.\n` +
        'This is NOT a test failure - nothing below it ran to completion, and no suite reported anything.\n' +
        'Raise SH_MAX_BUFFER in check.mjs, or run the command directly to see what it says.');
    }
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
/* LEAD WITH THE ANSWER, AND PRINT ONLY WHAT IS BEING ASKED ABOUT.

   `sh` throws carrying the runner's ENTIRE output - every tick of 296 suites,
   several megabytes of it - and the names of the suites that failed are in the
   summary at the very bottom. Reading a gate failure meant scrolling past
   everything that worked to reach the four lines that did not.

   The names go first now, and the body is cut down to the sections belonging to
   the suites that actually failed. Nothing is hidden: the run is still on disk,
   and the message says where. */
function _failureReport(fullOutput) {
  const plain = fullOutput.replace(/\x1b\[[0-9;]*m/g, '');
  const failing = (plain.match(/^\s*✗ (?:e2e|worker)\/\S+/gm) || [])
    .map((l) => l.replace(/^\s*✗ /, '').trim());
  if (!failing.length) return fullOutput;

  /* Split on the runner's own suite banner so each section can be matched back
     to the name that headed it. */
  const parts = plain.split(/^━━━ (\S+) ━━━$/m);
  const sections = new Map();
  for (let i = 1; i < parts.length; i += 2) sections.set(parts[i], parts[i + 1] || '');

  const bodies = failing.map((name) => {
    const body = sections.get(name);
    if (!body) return `━━━ ${name} ━━━\n  (its output was not found in the run - read the full log)`;
    /* Keep the tail: assertions print as they go and the failures are at the end
       of a suite's own output, next to its count line. */
    const lines = body.split('\n').filter((l) => l.trim());
    return `━━━ ${name} ━━━\n` + lines.slice(-40).join('\n');
  });

  return `${failing.length} suite(s) failed:\n  ` + failing.join('\n  ') + '\n\n'
    + bodies.join('\n\n') + '\n\n'
    + `(only the failing suites are shown; run \`node tests/run.mjs <name>\` for one of them)`;
}

if (!FAST) step('All test suites', () => {
  let out;
  try {
    out = sh('node tests/run.mjs');
  } catch (e) {
    throw new Error(_failureReport(String((e && e.message) || '')));
  }
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

/* AMV-SP-12: the dependency audit, run from the committed lockfile rather than
   by hand in an environment somebody has to arrange. It skips itself when the
   registry is unreachable, because a gate that goes red on a train is a gate
   people learn to ignore - and it fails on any advisory nobody has written a
   reason for. */
step('Dependencies have no unassessed advisories', () => {
  sh('node audit-deps.mjs');
});

/* ── 4c. The Worker, in the runtime it actually deploys to ────────────────
   Every Worker suite hands amv-backend.js an env built by hand: a Map for KV,
   an object for the Durable Object. A double encodes what its author expected
   to matter, and the first run of the real runtime found two defects in ninety
   seconds that 280 suites had never been positioned to see - one of them being
   what this Worker does with no secrets set, which is the state of every first
   deploy.

   Skipped honestly when wrangler cannot start. It binds 8877, not the 9100
   range the e2e harness uses, so it cannot collide with stage 5. */
if (!FAST) step('The Worker runs in workerd, not just in a mock', () => {
  const out = sh('node smoke-real.mjs');
  /* smoke-real.mjs exits 0 when it could not start the runtime, on purpose.
     Exit code alone cannot tell that apart from twenty-seven passing checks,
     so the note is read out of what it printed. */
  const m = /^SKIP\s+(.*)$/m.exec(out);
  return m ? 'SKIPPED: ' + m[1].trim() : '';
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
/* And a stage that did not run is named before either verdict. "All checks
   passed" is the sentence that stops anyone looking - the same reason the
   config blocker was split out above - so it must not be printed over a stage
   that was skipped. */
if (skipped.length) {
  console.log(`${B}${Y}! ${skipped.length} stage(s) did NOT run${X}, so this verdict covers less than usual:`);
  for (const sk of skipped) console.log(`  ${Y}•${X} ${sk}`);
  console.log('');
}

if (globalThis.__preflightPlaceholderWarn) {
  console.log(`${B}${G}✓ SHIPPABLE${X} - code is ready: ${skipped.length ? 'every check that RAN passed' : 'all checks passed'} in ${secs}s.`);
  console.log(`${DIM}  (source valid · worker loads · build fresh · tests green)${X}`);
  console.log('');
  console.log(`${B}${Y}! NOT DEPLOYABLE YET${X} - 1 configuration blocker:`);
  console.log(`  ${Y}•${X} AMV_KV namespace id is still the placeholder in wrangler.toml`);
  console.log(`    ${DIM}→ npx wrangler kv namespace create AMV_KV, then paste the id${X}`);
  console.log(`${DIM}  Deploying now would fail, or write to the wrong store.${X}\n`);
  process.exit(0);
}
console.log(`${B}${G}✓ SHIPPABLE${X} - ${skipped.length ? 'every check that RAN passed' : 'all checks passed'} in ${secs}s.`);
console.log(`${DIM}  (source valid · worker loads · build fresh · tests green · config checked)${X}\n`);
process.exit(0);
