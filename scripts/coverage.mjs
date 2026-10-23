#!/usr/bin/env node
/* COVERAGE OF THE WORKER, MEASURED BY V8 - NO DEPENDENCY.

   `node scripts/coverage.mjs` runs every Worker suite (tests/worker) with
   Node's own coverage switched on (NODE_V8_COVERAGE), then maps what V8
   recorded back onto src/worker/*.js and writes docs/COVERAGE.md.

   It can map exactly because of how the Worker is built: amv-backend.js is
   the src/worker files concatenated with nothing between them (build.mjs),
   and every suite runs either that file or a copy of it with an `export`
   line appended (tests/worker/.build/*.harness.mjs). Either way the first
   amv-backend.js-length bytes of the script ARE amv-backend.js, so an offset
   V8 reports is an offset into it, and from there into one source file.

   What it reports, per source file and for the whole Worker:
     - functions: how many top-level functions any suite called at all;
     - code: the share of bytes inside blocks that ran (V8's block coverage -
       an `if` whose branch never ran is a block that did not run, so this is
       branch coverage measured in bytes rather than counted in branches).
   And, for the areas an outside audit named - sign-in, money, permissions,
   the action protocol, SCIM, webhooks, spending, sessions - every function
   no suite ever called, by name, because that list is the work.

   It is a report, not a gate: the suites take ~20 minutes in the gate
   already, and a percentage floor is a number people learn to game. The list
   of never-called functions in the trust areas is what to act on.

   Options: --jobs=N (default 4), --only=<substring> to run a subset. */
import { spawn } from 'child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const JOBS = Math.max(1, Number(arg('jobs', 4)) || 4);
const ONLY = arg('only', '');
const COV = join(ROOT, 'tests', 'worker', '.build', 'v8cov');
rmSync(COV, { recursive: true, force: true }); mkdirSync(COV, { recursive: true });

const SRC_DIR = join(ROOT, 'src', 'worker');
const files = readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).sort();
const texts = files.map(f => readFileSync(join(SRC_DIR, f), 'utf8'));
const backend = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
if (texts.join('') !== backend) { console.error('amv-backend.js is not the concatenation of src/worker - run node build.mjs first'); process.exit(2); }
const N = backend.length;
/* Where each source file starts in the bundle. JS strings are UTF-16, and so
   are V8's coverage offsets, so the two agree without any byte conversion. */
const starts = []; { let o = 0; for (const t of texts) { starts.push(o); o += t.length; } }
const fileAt = (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= off) lo = m; else hi = m - 1; } return lo; };

const suites = readdirSync(join(ROOT, 'tests', 'worker')).filter(f => f.endsWith('.test.mjs') && f.includes(ONLY)).sort();
console.error('running ' + suites.length + ' worker suites with coverage, ' + JOBS + ' at a time…');
let next = 0, doneN = 0; const failed = [];
await new Promise((resolve) => {
  const one = () => {
    if (next >= suites.length) { if (doneN === suites.length) resolve(); return; }
    const s = suites[next++];
    const p = spawn(process.execPath, [join('tests', 'worker', s)], { cwd: ROOT, stdio: 'ignore',
      env: { ...process.env, NODE_V8_COVERAGE: COV } });
    const kill = setTimeout(() => p.kill('SIGKILL'), 300000);
    p.on('exit', (code) => { clearTimeout(kill); if (code) failed.push(s); doneN++; process.stderr.write('\r[' + doneN + '/' + suites.length + ']'); one(); });
  };
  for (let i = 0; i < Math.min(JOBS, suites.length); i++) one();
  if (!suites.length) resolve();
});
console.error('');
/* A suite that failed in the pool runs once more with the machine to itself,
   as the gate's AMV_TEST_RETRY_ALONE does: several suites write helper files
   and bind ports, and four that sort next to each other collided when they
   started together - which read as their code never having run. */
const retried = failed.splice(0);
for (const s of retried) {
  const code = await new Promise((r) => { const p = spawn(process.execPath, [join('tests', 'worker', s)], { cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, NODE_V8_COVERAGE: COV } }); const k = setTimeout(() => p.kill('SIGKILL'), 300000); p.on('exit', (c) => { clearTimeout(k); r(c); }); });
  if (code) failed.push(s);
}
if (retried.length) console.error('re-ran ' + retried.length + ' alone; ' + failed.length + ' still failing');

/* covered[i] = 1 if byte i of the bundle was inside a block that ran in any
   suite; seen[i] = 1 if any suite loaded it at all. called: function start
   offsets with a count above zero anywhere. */
const covered = new Uint8Array(N), seen = new Uint8Array(N);
const calledAt = new Set();
const ours = (url) => /\/amv-backend\.js(\?|$)/.test(url) || /\/tests\/worker\/\.build\/[^/]+\.harness\.mjs(\?|$)/.test(url);
for (const f of readdirSync(COV)) {
  let data; try { data = JSON.parse(readFileSync(join(COV, f), 'utf8')); } catch (e) { continue; }
  for (const sc of (data.result || [])) {
    if (!ours(String(sc.url || ''))) continue;
    const local = new Int8Array(N).fill(-1);
    for (const fn of (sc.functions || [])) {
      const r0 = (fn.ranges || [])[0];
      if (r0 && r0.count > 0 && r0.startOffset < N) calledAt.add(r0.startOffset);
      /* Ranges come outermost first; an inner block overrides its parent. */
      for (const r of (fn.ranges || [])) {
        const a = Math.max(0, r.startOffset), b = Math.min(N, r.endOffset);
        if (a >= b) continue;
        local.fill(r.count > 0 ? 1 : 0, a, b);
      }
    }
    for (let i = 0; i < N; i++) if (local[i] >= 0) { seen[i] = 1; if (local[i] === 1) covered[i] = 1; }
  }
}

/* Top-level functions per source file, by declaration. */
const FN = /^(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)\s*\(/gm;
const perFile = files.map((f, i) => {
  const t = texts[i], base = starts[i], fns = [];
  let m; FN.lastIndex = 0;
  while ((m = FN.exec(t))) fns.push({ name: m[1], at: base + m.index });
  /* A function's own V8 range starts at `function` (or `async`), which is
     where the declaration matched. */
  let cov = 0, tot = 0;
  for (let o = base; o < base + t.length; o++) { if (!seen[o]) continue; const c = backend.charCodeAt(o); if (c === 32 || c === 10 || c === 9 || c === 13) continue; tot++; if (covered[o]) cov++; }
  const never = fns.filter(x => !calledAt.has(x.at)).map(x => x.name);
  return { file: f, fns: fns.length, called: fns.length - never.length, never, cov, tot };
});
const sum = perFile.reduce((a, x) => ({ fns: a.fns + x.fns, called: a.called + x.called, cov: a.cov + x.cov, tot: a.tot + x.tot }), { fns: 0, called: 0, cov: 0, tot: 0 });
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';

/* The areas the audit named, by the source files that implement them. */
const TRUST = [
  ['Sign-in, passkeys, two-step, sessions', /^(30|31|41|73|28)-/],
  ['Company sign-in and SCIM', /^(11|71)-/],
  ['Teams and permissions', /^(32|33)-/],
  ['Money: subscriptions, payments, credit, payouts, marketplace', /^(22|44|47|50|53|54)-/],
  ['Spending limits and usage', /^(07|35|36)-/],
  ['Action protocol (writes on connected accounts)', /^09a-/],
  ['Webhooks and event triggers', /^(70|13)-/],
];
let md = '# Worker coverage\n\nMeasured by `node scripts/coverage.mjs` - V8\'s own block coverage over every\nWorker suite (tests/worker), mapped back onto `src/worker/`. Generated on\n' + new Date().toISOString().slice(0, 10) + ' from ' + suites.length + ' suites' + (failed.length ? ' (' + failed.length + ' exited non-zero: ' + failed.join(', ') + ')' : '') + '.\n\n'
  + '"Functions" is how many top-level functions any suite called at all. "Code" is the share of\ncode inside blocks that ran - an `if` whose branch never ran is a block that did not run, so\nthis is branch coverage in bytes. Browser suites (tests/e2e) are not counted here: they drive\nthe Worker too, so these numbers are a floor.\n\n'
  + '**Whole Worker:** functions ' + sum.called + '/' + sum.fns + ' (' + pct(sum.called, sum.fns) + '), code ' + pct(sum.cov, sum.tot) + '.\n\n'
  + '## The trust areas\n\nEvery function in these areas that no Worker suite ever calls, by name. This list is the work.\n\n';
for (const [title, re] of TRUST) {
  const rows = perFile.filter(x => re.test(x.file));
  const a = rows.reduce((s, x) => ({ fns: s.fns + x.fns, called: s.called + x.called, cov: s.cov + x.cov, tot: s.tot + x.tot }), { fns: 0, called: 0, cov: 0, tot: 0 });
  md += '### ' + title + '\n\nFunctions ' + a.called + '/' + a.fns + ' (' + pct(a.called, a.fns) + '), code ' + pct(a.cov, a.tot) + '.\n\n';
  for (const x of rows) if (x.never.length) md += '- `' + x.file + '`: ' + x.never.map(n => '`' + n + '`').join(', ') + '\n';
  md += '\n';
}
md += '## Every file\n\n| File | Functions called | Code |\n|---|---|---|\n'
  + perFile.map(x => '| `' + x.file + '` | ' + x.called + '/' + x.fns + ' | ' + pct(x.cov, x.tot) + ' |').join('\n') + '\n';
mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'COVERAGE.md'), md);
rmSync(COV, { recursive: true, force: true });
console.log('functions ' + sum.called + '/' + sum.fns + ' (' + pct(sum.called, sum.fns) + '), code ' + pct(sum.cov, sum.tot) + ' - docs/COVERAGE.md written' + (failed.length ? '; ' + failed.length + ' suites exited non-zero' : ''));
