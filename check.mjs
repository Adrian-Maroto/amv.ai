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
import { codeOnly } from './tests/lib/source.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const R = (p) => join(ROOT, p);
const G = '\x1b[32m', RED = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

// --fast skips the full test-suite step. Used by the gate's own self-test so it
// can verify fail-fast behaviour WITHOUT recursively re-running every suite
// (which would include the self-test, causing runaway recursion).
const FAST = process.argv.includes('--fast');

/* Captured before any stage runs, so the pass marker can name the commit this
   run is ABOUT rather than whatever HEAD is when it finishes. See the write
   at the bottom of this file. */
const HEAD_AT_START = (() => {
  try { return execSync('git rev-parse HEAD', { cwd: ROOT, stdio: 'pipe' }).toString().trim(); }
  catch (e) { return ''; }
})();

/* ONE GATE AT A TIME.

   Two gates running together rebuild index.html on top of each other and then
   fight over the ports the suites bind, and the second one loses with
   EADDRINUSE - which surfaces as suites failing, so a green product reads as a
   red gate. That is not hypothetical: it is what turned an overnight run red,
   and the time after it went into deciding whether the product had broken
   rather than into the product.

   The runner takes its own lock for the port half of that. This one is here so
   the second gate stops BEFORE it rebuilds over the first one's artifact. The
   two locks are separate files on purpose: this gate's own child runner must
   still be able to take the runner lock. */
const GATE_LOCK = R('.gate.lock');
function gateHeldBy() {
  try {
    const pid = parseInt(readFileSync(GATE_LOCK, 'utf8').trim(), 10);
    if (!pid) return 0;
    try { process.kill(pid, 0); return pid; }   // signal 0 asks "does it exist?"
    catch (killErr) { return 0; }               // stale - the writer is gone
  } catch (readErr) { return 0; }
}
/* --fast does NOT take this lock, and must not. The gate's own self-test
   (tests/worker/check.test.mjs) runs `check.mjs --fast` as a child WHILE the
   full gate is running, to prove the gate still fails on a syntax error - so
   locking --fast would make the gate fail itself. It is also the iteration
   loop, which skips the suites entirely and so binds no ports. What needs to
   be exclusive is the long run that rebuilds and then holds every port. */
if (!FAST) {
  const held = gateHeldBy();
  if (held) {
    console.error(RED + 'Another gate run is already going (pid ' + held + ').' + X);
    console.error('Two gates rebuild over each other and collide on ports, so this stops here.');
    console.error('Wait for it to finish, or stop it, then run again.');
    process.exit(1);
  }
  try { writeFileSync(GATE_LOCK, String(process.pid)); } catch (e) {}
  const drop = () => { try { if (gateHeldBy() === process.pid) execSync('rm -f ' + JSON.stringify(GATE_LOCK)); } catch (dropErr) {} };
  process.on('exit', drop);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { drop(); process.exit(130); });
  }
}

const t0 = Date.now();
let stepNum = 0;
/* Kept in step with the stages below. Adding the dependency audit without
   updating this printed "[8/7]", and the fast total was two out as well - small
   things, and they read as nobody looking at the screen they are on.
   Full: syntax, worker, build, suites, bare classes, dead guards, page weight,
   deps, real runtime, preflight.
   Fast skips the two that need a clear machine and a long wait (suites, runtime). */
const TOTAL = FAST ? 9 : 11;
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

/* ── 3b. THE TEST PORTS WERE A STAGE, AND ARE NOT ONE ANY MORE ─────────────

   There was a check here that port 9100 was free. The e2e harness counted
   ports up from that number, so a leftover server or a second gate meant every
   browser-driven suite died with EADDRINUSE and the run reported fifty-odd
   failures that said nothing about the code. It cost two full gate runs before
   it was worth a stage.

   The harness asks the kernel for a free port now (`listen(0)`), which is also
   what let the suites start running several at a time. There is no fixed port
   left to be occupied, so the guard has nothing to guard and a stage that
   cannot fail is worse than no stage - it teaches people that a green tick
   means something was checked. */

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
  for (let i = 1; i < parts.length; i += 2) {
    /* Cut at the summary. The LAST suite's section otherwise runs on into the
       runner's own ✓/✗ list, which makes a suite that printed nothing look like
       it printed plenty - and that is exactly the case this needs to detect. */
    sections.set(parts[i], String(parts[i + 1] || '').split('════════ SUMMARY')[0]);
  }

  /* A suite that DIES rather than fails prints nothing between its banner and
     the next one: the runner gives each child stdio:'inherit', so a startup
     crash writes to stderr, and stderr arrives concatenated after all of stdout
     rather than inside the section it belongs to. The first version of this
     reported an empty body and left "1 suite(s) failed:" with nothing under it -
     which is the same unreadable failure the flush fix was supposed to end,
     arriving by a different route.

     So an empty section falls back to the tail of the whole run, which is where
     that stderr actually is. */
  const tailOfRun = plain.split('\n').filter((l) => l.trim()).slice(-25).join('\n');
  const bodies = failing.map((name) => {
    const body = sections.get(name);
    const lines = (body || '').split('\n').filter((l) => l.trim());
    if (!lines.length) {
      return `━━━ ${name} ━━━\n`
        + `  (it printed nothing of its own - it died rather than failed.\n`
        + `   The end of the whole run follows, which is where a crash lands:)\n`
        + tailOfRun;
    }
    /* Keep the tail: assertions print as they go and the failures are at the end
       of a suite's own output, next to its count line. */
    return `━━━ ${name} ━━━\n` + lines.slice(-40).join('\n');
  });

  return `${failing.length} suite(s) failed:\n  ` + failing.join('\n  ') + '\n\n'
    + bodies.join('\n\n') + '\n\n'
    + `(only the failing suites are shown; pass one of those names to the runner to work on it alone)`;
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

/* ── A CLASS THAT NAMES A LOOK NOTHING GIVES IT ──────────────────────────
   The sibling of the stage below, and it exists for the same reason: three
   real defects found by one scan, none of which any suite could see.

     The GO-LIVE screen - the one somebody reads to decide whether AMV can
     launch - had .gl-row, .gl-ic, .gl-tag, .gl-body, .gl-label and .gl-how in
     its markup and rules for none of them, so it rendered as stacked
     default-weight divs. Sixteen green assertions over that screen did not
     notice, because "does it contain the word required" is true either way.

     The CHECKOUT SHEET's .pay-body, and the whole "Secure checkout is not
     connected yet" panel, the same - on the screen that takes money.

     And FOUR MODALS used .ovr-bg / .ovr-card, which have never existed; the
     real classes are .ov and .ob. Measured side by side, the forked pair came
     out position:static, z-index:auto, no backdrop, no card, no centring - so
     a purchase refusal and an abuse report rendered as loose text at the top
     of the page with the app still clickable behind them.

   A class name is a PROMISE about appearance. Nothing in a build checks that
   the promise is kept, and CSS has no compiler to notice, so the gap simply
   accumulates until somebody happens to look at that screen.

   THE RULE. A class written into a static class attribute must either have a
   rule in styles.css, be read back by the code (querySelector, closest,
   classList.contains, matches), or be named below with a reason somebody typed.
   Dynamic class attributes - anything built by concatenation - are skipped:
   this cannot know what they evaluate to, and guessing would produce exactly
   the false positives that get a check switched off. */
step('No class is applied without something to apply', () => {
  /* Named, so a scanner that breaks says so rather than blaming the code. */
  const css = readFileSync(R('styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const defined = new Set();
  for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(m[1]);

  /* app.js is the whole client; index.html contributes only its hand-written
     shell, because everything after the BUILD:JS marker is app.js again and
     counting it twice proves nothing. */
  const shell = readFileSync(R('index.html'), 'utf8').split('BUILD:JS')[0];
  const src = readFileSync(R('app.js'), 'utf8') + '\n' + shell;

  const queried = new Set();
  for (const m of src.matchAll(/(?:querySelector(?:All)?|closest|getElementsByClassName|matches)\(\s*['"`]([^'"`]+)['"`]/g))
    for (const c of m[1].split(/[^\w-]+/)) if (c) queried.add(c);
  for (const m of src.matchAll(/classList\.contains\(\s*['"`]([\w-]+)/g)) queried.add(m[1]);

  if (defined.size < 400 || queried.size < 50)
    throw new Error(`the class scan found ${defined.size} styled and ${queried.size} queried names, `
      + 'which cannot be right - the scanner is broken, not the code.');

  /* Every one of these was measured before it was written down. The reason is
     the point: an entry with no reason is a hole with a comment over it, and
     the next person needs to know whether this was decided or merely tolerated. */
  const ALLOWED = {
    /* A third party finds the element by this exact class. Renaming or styling
       it is not ours to do. */
    'cf-turnstile': "Cloudflare's script renders the widget into this class",

    /* The landing block is never painted. #land is hidden on every route - AMV
       opens straight into a chat, signed in or not - and every element in the
       hero measures 0x0 in a real browser. It is kept for crawlers and text
       extractors, which read textContent and do not care about styles. */
    'hero-rd-eyebrow': 'in the landing block, which is never painted',
    'hero-rd-sub': 'in the landing block, which is never painted',
    'hero-rd-row': 'in the landing block, which is never painted',
    'hero-rd-strip': 'in the landing block, which is never painted',
    'hero-rd-stat': 'in the landing block, which is never painted',

    /* The element carries its own style="..." attribute. It IS styled - just
       not through a class - so the class here is a name, and naming a thing is
       allowed. Migrating these onto tokens is worth doing and is not this
       stage's business. */
    'mp-dot': 'styled by its own inline style attribute',
    'tt-failed': 'styled by its own inline style attribute',
    'wsc-chat': 'styled by its own inline style attribute',
    'sched-days': 'styled by its own inline style attribute',

    /* Grouping elements. Each sits inside an already-styled parent and holds
       children that carry the styling themselves, so the class is a name for a
       region rather than a description of how it looks. Verified one at a time:
       every one of these has a child whose class does have a rule. */
    'act-main': 'a grouping element whose children carry the styling',
    'adm-fb-main': 'a grouping element whose children carry the styling',
    'adm-fnl-row': 'a grouping element whose children carry the styling',
    'ai-retrying': 'a grouping element whose children carry the styling',
    'conn-body': 'a grouping element whose children carry the styling',
    'crew-results': 'a grouping element whose children carry the styling',
    'cw-pop-body': 'a grouping element whose children carry the styling',
    'cwp-foot': 'a grouping element whose children carry the styling',
    'golive': 'a grouping element whose children carry the styling',
    'ho-row-l': 'a grouping element whose children carry the styling',
    'jb-c': 'a grouping element whose children carry the styling',
    'mc-head-l': 'a grouping element whose children carry the styling',
    'mc-sched-mode-row': 'a grouping element whose children carry the styling',
    'mkt-seller-b': 'a grouping element whose children carry the styling',
    'pvw-mail': 'a grouping element whose children carry the styling',
    'pvw-sec': 'a grouping element whose children carry the styling',
    'pvw-skel-frame': 'a grouping element whose children carry the styling',
    'pvw-tl-b': 'a grouping element whose children carry the styling',
    'sess-txt': 'a grouping element whose children carry the styling',
    'site-l': 'a grouping element whose children carry the styling',
    'studio-hrow-b': 'a grouping element whose children carry the styling',
    'uni-ic': 'a grouping element whose children carry the styling',
    'upg-row-l': 'a grouping element whose children carry the styling',
  };
  for (const [k, why] of Object.entries(ALLOWED))
    if (!why || why.length < 12)
      throw new Error(`the allowance for .${k} has no real reason written against it`);

  /* PER ELEMENT, NOT PER CLASS - AND THIS IS THE DIFFERENCE BETWEEN A CHECK
     PEOPLE KEEP AND ONE THEY SWITCH OFF.

     Written per class, this failed on 26 further names, every one of them a
     second class sitting beside a styled one: `ss2 bill-txns`, `crew-page
     mc-page`, `hero hero-rd`, `lsec trust-sec`. Those elements ARE styled. The
     extra name is a hook somebody added and never used - untidy, harmless, and
     invisible to a person looking at the screen. Reporting 26 of those in order
     to find 3 real defects is how a check earns a reputation for crying wolf,
     and the one after that gets ignored too.

     So the unit is the ELEMENT: it fails when NOTHING on an element styles it.
     That is exactly the shape of all three defects this stage was written for -
     .gl-row/.gl-done, .pay-body, .ovr-bg/.ovr-card each stood alone - and it is
     the shape that a person actually sees.

     The honest cost: a modifier that was meant to add something to an
     already-styled element slips through. That is a smaller, quieter fault than
     an element with no styling at all, and it is the trade being made. */
  const bare = new Set();
  for (const m of src.matchAll(/class="([^"]*)"/g)) {
    const raw = m[1];
    /* Built at runtime. What it evaluates to is not knowable from here. */
    if (/['"`+${]/.test(raw)) continue;
    const toks = raw.split(/\s+/).filter(t => /^[a-zA-Z][\w-]*$/.test(t));
    if (!toks.length) continue;
    if (toks.some(t => defined.has(t) || queried.has(t) || ALLOWED[t])) continue;
    for (const t of toks) bare.add(t);
  }

  if (bare.size)
    throw new Error('these are written into a class attribute, have no rule in styles.css and are never read '
      + 'back by the code, so the element is named for a look nothing gives it: ' + [...bare].sort().join(', ')
      + '\n  Style it, use the class that already does the job, or add it to ALLOWED in check.mjs with a reason.');
});

/* ── A GUARD THAT IS ALWAYS FALSE IS A FEATURE THAT NEVER RAN ─────────────
   This exists because of LESSONS 297. checkOAuthCallback was deleted, its only
   call site was `try{ checkOAuthCallback(); }catch(e){}`, and the ReferenceError
   went into that bare catch - so every account connection silently threw away
   the authorization code while the syntax check, the build and all 327 suites
   stayed green. Nothing measured it, because nothing CAN: an error nobody can
   observe is indistinguishable from correct behaviour.

   The same scan, run once by hand, found two more:
     applyTheme  - guarded by typeof and never written, so the model tool that
                   switches to light mode saved the preference and left the
                   screen dark.
     confirmModal - guarded by typeof and never written, so three destructive
                   actions fell to their fallbacks, two of which did the thing
                   without asking at all.

   Three real defects from one regex, so it is a stage rather than an anecdote.
   It reads app.js because that is the whole client in one scope. */
step('No client reads a field the server does not send', () => {
  /* THREE BUGS IN ONE ROUND HAD THIS SHAPE, and none of them threw.

     `/v1/entitlement` answers `{ok, entitlement:{plan}, ...}` and two functions
     on the post-payment path read `ent.plan` off the whole response, so a
     customer who had just paid got no confirmation and the guard against faked
     unlocks never ran (LESSONS 364). `/auth/login` answers `{token,
     refreshToken, email, name}` and the reset flow read `d.user.name`, so a
     password reset renamed the account to the email prefix (LESSONS 365). And
     the sync `profile` slot was written by nobody and read by nobody (363).

     A missing property is `undefined`, and every one of these had a fallback
     ready to turn `undefined` into something plausible. Nothing throws, nothing
     logs, and the variable name always sounds right - so the only check that
     finds them is mechanical: take the route each AMV_API method calls, take
     the object literals its handler returns, and compare them to the fields the
     caller actually reads off the result.

     DELIBERATELY CONSERVATIVE. A handler that returns anything but an object
     literal - `json(await issueTokens(...))`, an Object.assign, a spread - has
     a shape this cannot see, and is skipped rather than guessed at. The read
     window stops at the next `await` assignment, because without that a Date
     declared four lines later was attributed to the response and `.getMonth`
     was reported as a missing field. False alarms are what get a stage
     deleted. */
  const be = readFileSync(R('amv-backend.js'), 'utf8');
  const app = readFileSync(R('app.js'), 'utf8');

  const route = new Map();
  for (const m of be.matchAll(/case\s+'([^']+)':\s*return\s+([A-Za-z_$][\w$]*)\s*\(/g))
    if (!route.has(m[1])) route.set(m[1], m[2]);

  const bodyOf = (name) => {
    const i = be.search(new RegExp('async function ' + name.replace(/\$/g, '\\$') + '\\s*\\('));
    if (i < 0) return '';
    let d = 0, j = be.indexOf('{', i); const start = j;
    for (; j < be.length; j++) { const c = be[j]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
    return be.slice(start, j + 1);
  };
  const topKeys = (src) => {
    const keys = new Set();
    for (const m of src.matchAll(/\bjson\(\s*\{/g)) {
      let i = m.index + m[0].length - 1, d = 0, j = i;
      for (; j < src.length; j++) { const c = src[j]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
      const body = src.slice(i + 1, j);
      let dep = 0, cur = '', parts = [];
      for (const ch of body) {
        if ('{[('.includes(ch)) dep++; else if ('}])'.includes(ch)) dep--;
        if (ch === ',' && dep === 0) { parts.push(cur); cur = ''; } else cur += ch;
      }
      parts.push(cur);
      for (const p of parts) {
        const mm = p.match(/^\s*(?:\.\.\.)?\s*([A-Za-z_$][\w$]*)\s*:/) || p.match(/^\s*([A-Za-z_$][\w$]*)\s*$/);
        if (mm) keys.add(mm[1]);
      }
    }
    for (const _ of src.matchAll(/\bjson\(\s*([^{\s])/g)) keys.add('*');
    if (/\bjson\(\s*Object\.assign|\.\.\./.test(src)) keys.add('*');
    return keys;
  };

  const meth = new Map();
  for (const m of app.matchAll(/async\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const j = app.indexOf('{', m.index + m[0].length - 1);
    if (j < 0) continue;
    let d = 0, k = j;
    for (; k < app.length; k++) { const c = app[k]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
    const body = app.slice(j, k + 1);
    if (body.length > 2500) continue;
    const p = body.match(/_fetch\(\s*'([^']+)'/);
    if (p && /\.json\(\)/.test(body)) meth.set(m[1], p[1].split('?')[0]);
  }

  const UNIVERSAL = new Set(['error', 'ok', 'code', 'message', 'then', 'catch', 'length', 'map', 'forEach', 'filter', 'slice']);
  const bad = [];
  for (const m of app.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+AMV_API\.([A-Za-z_$][\w$]*)\(/g)) {
    const v = m[1], fn = m[2];
    const path = meth.get(fn); if (!path) continue;
    const h = route.get(path); if (!h) continue;
    const keys = topKeys(bodyOf(h));
    if (!keys.size || keys.has('*')) continue;
    let seg = app.slice(m.index + m[0].length, m.index + 900);
    const nxt = seg.search(/(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*await\b/);
    if (nxt > 0) seg = seg.slice(0, nxt);
    for (const f of new Set([...(v + seg).matchAll(new RegExp('\\b' + v + '\\.([A-Za-z_$][\\w$]*)', 'g'))].map(x => x[1]))) {
      if (UNIVERSAL.has(f) || keys.has(f)) continue;
      bad.push(fn + '() -> ' + path + ' (' + h + ') reads .' + f + ' | sends: ' + [...keys].join(', '));
    }
  }
  /* THROWN, not returned. A returned string is how this file marks a stage
     that did not RUN, and it prints a green tick with a note beside it - so
     the first version of this reported the real defect and the gate still said
     SHIPPABLE. A finding is a failure; only an absent stage is a note. */
  if (bad.length) {
    throw new Error('A client reads a field its endpoint never returns:\n  ' + bad.join('\n  '));
  }
});

step('No guard names a function that does not exist', () => {
  /* COMMENTS AND STRINGS STRIPPED FIRST, and this is not a detail.

     The first version of this read app.js whole and reported `applyTheme` -
     which had just been FIXED, and whose only remaining mention was the comment
     explaining the fix. A check that reads prose as code reports a correct
     repair as the defect it repaired, and there is already a suite in this
     repo named after that exact mistake. */
  const src = codeOnly(readFileSync(R('app.js'), 'utf8'));

  const defined = new Set();
  for (const m of src.matchAll(/\n\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)) defined.add(m[1]);
  /* After a newline OR a semicolon OR an opening brace. Anchored on `\n` alone
     this missed `let tries=0; const poll=()=>{...}` - a second declaration on
     the same line - and reported `poll` as a function that does not exist. */
  for (const m of src.matchAll(/(?:^|[\n;{(,])\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/g)) defined.add(m[1]);
  for (const m of src.matchAll(/window\.([A-Za-z0-9_$]+)\s*=/g)) defined.add(m[1]);
  /* Object-literal and class methods, and accessors: `_save(){`, `async run(`,
     `get cookieAuth(`. AMV_API alone is a hundred of these, and without them
     every call to one reads as a missing function. */
  for (const m of src.matchAll(/(?:^|[,{;\n])\s*(?:async\s+|get\s+|set\s+|\*\s*)?([A-Za-z_$][\w$]*)\s*\([^()]{0,200}\)\s*\{/g))
    defined.add(m[1]);
  /* PARAMETERS COUNT AS DEFINED. A helper that takes a callback and guards it
     with `typeof onConfirm === 'function'` is doing exactly the right thing -
     the argument is optional and may not be passed. Without this the check
     reports every such helper, which is the way a useful check gets switched
     off. Both shapes: a parameter list, and an arrow's. */
  for (const m of src.matchAll(/(?:function\s*[A-Za-z0-9_$]*\s*|\b)\(([^()]{0,300}?)\)\s*(?:\{|=>)/g))
    for (const part of m[1].split(','))
      { const n = part.trim().split(/[\s=:.[\]]/)[0]; if (/^[A-Za-z_$][\w$]*$/.test(n)) defined.add(n); }

  /* THE NEGATIVE CONTROL (LESSONS 294). If the patterns above stop matching,
     every name reads as undefined and this stage fails on everything - or, if
     it were written the other way round, passes on everything. Named, so the
     failure says "the scanner broke" rather than "the code is wrong". */
  if (defined.size < 500)
    throw new Error(`the definition scan found only ${defined.size} names in app.js, which cannot be right - `
      + 'the scanner is broken, not the code.');

  /* Things the browser provides, or that a page may legitimately ask about
     because they are not everywhere. A guard on one of these is doing its job:
     the point of the check is a guard on a name that was OURS and is gone. */
  /* NAMES THIS SCANNER MUST NOT MISTAKE FOR MISSING FUNCTIONS.

     The first version of this reported twenty-one, every one of them a false
     positive, which is worse than reporting none: a check that cries wolf gets
     switched off, and then the one real finding goes with it. They fell into
     four groups and each needed a different fix.

     Language keywords - `if (`, `for (`, `catch (`, `async (` all look exactly
     like a call. */
  const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof',
    'function', 'new', 'await', 'try', 'do', 'else', 'delete', 'void', 'in', 'of', 'yield',
    'throw', 'async', 'case', 'get', 'set', 'this', 'super']);

  /* Things the platform provides. Node has most of them, so ask rather than
     keep a list that goes stale; the rest are browser-only or optional. */
  const PROVIDED = new Set(['alert', 'confirm', 'prompt', 'requestIdleCallback',
    'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'IntersectionObserver',
    'ResizeObserver', 'MutationObserver', 'showOpenFilePicker', 'BarcodeDetector',
    'SpeechRecognition', 'webkitSpeechRecognition', 'IdleDetector', 'ClipboardItem',
    'FileReader', 'Image', 'Audio', 'Notification', 'getComputedStyle', 'scrollTo',
    'open', 'print', 'postMessage', 'btoa', 'atob']);
  const isPlatform = (n) => {
    if (PROVIDED.has(n)) return true;
    try { return typeof globalThis[n] !== 'undefined'; } catch (e) { return false; }
  };

  const dead = [...new Set([...src.matchAll(/typeof\s+([A-Za-z_$][\w$]*)\s*===?\s*['"]function['"]/g)]
    .map(m => m[1])
    .filter(n => !defined.has(n) && !isPlatform(n)))];

  if (dead.length)
    throw new Error('these are guarded by `typeof X === "function"` and are defined nowhere, so the guard is '
      + 'permanently false and whatever it protects never runs: ' + dead.join(', ')
      + '. Write the function, or take the branch out - a guard that cannot pass is not a fallback.');

  /* AND THE SHAPE THAT ACTUALLY SHIPPED, which the rule above would have
     missed. checkOAuthCallback had no typeof guard at all - it was called
     plainly, inside `try{ ... }catch(e){}`. Deleting it turned every account
     connection into a silent no-op, and a bare catch is precisely what stops
     that being visible: a ReferenceError goes in and nothing comes out.

     So: a call inside a catch that swallows must name something that exists.
     A catch that DOES something with the error is not covered here - if it
     logs or reports, the failure is observable and this check has no business
     objecting. It is the silent ones that can hide a deletion. */
  /* THE 400-CHARACTER WINDOW THAT LET ONE THROUGH.

     This matched `try{ ... }catch(e){}` with the body capped at 400
     characters, and a fixed character window is wrong in both directions -
     the same mistake tests/lib/source.mjs was written to stop making. A
     `try` whose body opens with a long message string pushes everything
     after it past the cap, so the call is never examined.

     That is not hypothetical: `saveConvs()` sat 350 characters into such a
     block on the handoff-resume path, defined nowhere, throwing a
     ReferenceError into the empty catch beside it - so the message AMV drew
     when it carried your context over was never saved, and reloading lost
     it. This check existed to catch exactly that and could not see it.

     So the body is found by matching braces from the `try` rather than by
     counting characters. `src` has already had its comments and strings
     stripped, which is what makes brace counting reliable here - a brace
     inside a string is the reason this would otherwise be the wrong tool. */
  const swallowed = new Map();
  /* STRINGS BLANKED, WHICH THE BRACE MATCHING BELOW DEPENDS ON.

     `codeOnly` keeps string literals on purpose - most callers are looking for
     one - and here they are noise that reads as code: `Handoffs (` and
     `hyphen ( - )`, sitting in ordinary prose inside a message, match "a call"
     exactly as well as a call does. Widening the search without this reported
     four names, every one of them a word in a sentence.

     Done by the scanner rather than by a second pass over its output, because
     the second pass is the thing that goes wrong: a regex literal containing a
     quote starts a string that never ends, and from there it eats real code.
     That was tried here and it silently swallowed the very call this widening
     exists to catch. */
  const noStrings = codeOnly(readFileSync(R('app.js'), 'utf8'), { blankStrings: true });
  const bodyAfter = (from) => {
    let depth = 0;
    for (let i = from; i < noStrings.length; i++) {
      const ch = noStrings[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return { body: noStrings.slice(from + 1, i), end: i }; }
    }
    return null;
  };
  for (const m of noStrings.matchAll(/\btry\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const found = bodyAfter(open);
    if (!found) continue;
    /* Only the ones that swallow. A catch that logs or reports makes the
       failure observable, and this rule has no business objecting to it. */
    if (!/^\s*catch\s*\([A-Za-z0-9_$]*\)\s*\{\s*\}/.test(noStrings.slice(found.end + 1))) continue;
    for (const c of found.body.matchAll(/(?:^|[^.\w$'"`])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const n = c[1];
      if (KEYWORDS.has(n) || defined.has(n) || isPlatform(n)) continue;
      swallowed.set(n, (swallowed.get(n) || 0) + 1);
    }
  }
  if (swallowed.size)
    throw new Error('these are CALLED inside a try/catch that swallows the error, and are defined nowhere - '
      + 'so the call throws a ReferenceError into an empty catch and whatever it was supposed to do silently '
      + 'does not happen: ' + [...swallowed.keys()].join(', ')
      + '. This is LESSONS 297: it is how a deleted feature ships through every gate.');
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
    /* THE COMMIT THIS RUN WAS ABOUT, NOT THE ONE THAT HAPPENS TO BE HEAD NOW.

       This read HEAD here, at the end, twenty minutes after the run began.
       Commit anything while a gate is going - which is the normal way to work
       during a twenty-minute wait - and the marker names a commit whose code
       this run never saw, and the hook that moves `main` believes it.

       It happened: a run started on one tree, two commits landed while it
       worked, and it stamped the second of them green. The tests were green;
       they were green about a different tree. That is the exact shape of
       defect this repository keeps finding, and the gate's own marker was an
       instance of it.

       So HEAD is captured BEFORE the first stage and written afterwards. If
       the tree moved meanwhile the marker names the commit that was actually
       proven, the hook declines to move main, and somebody runs it again -
       which is the correct outcome and the one that was not available. */
    if (HEAD_AT_START) writeFileSync(join(ROOT, '.gate-pass'), HEAD_AT_START + '\n');
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
