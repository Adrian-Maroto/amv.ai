#!/usr/bin/env node
/* Runs every test suite and exits non-zero if anything fails.
   Usage:
     node tests/run.mjs            # everything
     node tests/run.mjs security   # only suites matching "security"
*/
import { spawn } from 'child_process';
import { cpus } from 'os';
import { readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { say, sayLine } from './lib/say.mjs';
const sayErr = (t) => sayLine(t, 2);

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
/* Flags are not filters. `process.argv[2]` used to be taken verbatim, so
   `run.mjs --list` filtered for suites named "--list", matched none, and
   exited 1 - a filter that is really a typo should not look like an empty
   suite. */
const argv = process.argv.slice(2);
const flags = argv.filter(a => a.startsWith('--'));
const filter = argv.find(a => !a.startsWith('--')) || '';

if (!existsSync(join(ROOT, 'index.html'))) {
  sayErr('\x1b[31mindex.html not found. Run `node build.mjs` first.\x1b[0m');
  process.exit(1);
}

/* AMV-057: A DIRECTORY NAME IS NOT A FILENAME.

   The filter was a substring match on the FILENAME, so `npm run test:worker`
   selected files whose name contained "worker" - which is one file out of the
   hundred and thirty-nine in tests/worker. Anybody running the shortcut before
   pushing believed they had run the Worker suite and had run 0.7% of it.

   `npm run check` was never affected: it calls this with no filter and runs
   everything. So the release gate was honest while the convenience script was
   not, which is the more dangerous way round - the lie is in the thing people
   reach for when they are in a hurry.

   A bare `e2e` or `worker` now means that DIRECTORY. Anything else is still a
   filename substring, so `node tests/run.mjs market` keeps working. */
const DIRS = ['e2e', 'worker'];
const dirFilter = DIRS.includes(filter) ? filter : '';
const nameFilter = dirFilter ? '' : filter;

const suites = [];
for (const dir of DIRS) {
  if (dirFilter && dir !== dirFilter) continue;
  const p = join(__dir, dir);
  if (!existsSync(p)) continue;
  for (const f of readdirSync(p)) {
    if (f.endsWith('.test.mjs') && f.includes(nameFilter)) {
      suites.push({ name: `${dir}/${f}`, path: join(p, f) });
    }
  }
}

if (!suites.length) {
  sayErr(`No suites matched "${filter}"`);
  process.exit(1);
}

/* What WOULD run, without running it. The selection is the thing that was
   broken, and a test for it cannot be "run the suite and count" - that is the
   suite. This makes the choice inspectable on its own. */
if (flags.includes('--list')) {
  /* WRITTEN SYNCHRONOUSLY, BECAUSE SOMETHING IS READING THIS.

     `console.log` in a loop followed by `process.exit(0)` loses its tail. To a
     TTY that is invisible; to a PIPE it is not, because Node's stdout is
     asynchronous there and exit does not wait for the queued writes.

     It cost 130 suites. The guard that checks this selection shells out with
     stdio 'pipe', and under the gate's parallel load the write was cut at 177
     lines of 307 - reporting that the runner silently skipped everything
     alphabetically after "an-export-that-says-it-is-complete". The runner was
     fine. The listing was truncated, and the same command run by hand printed
     all 307 every time, which is what makes this kind of failure so hard to
     believe when it is real. Six runs in a loop reproduced it once: 307, 307,
     307, 231, 307, 307.

     The identical defect was fixed in check.mjs earlier, with a test that
     pushes 4MB through a real pipe to prove it. That fix went to the one
     caller I was looking at. This is the other one. */
  say(suites.map(s => s.name).join('\n') + '\n');
  process.exit(0);
}

/* ── HOW MANY AT ONCE ──────────────────────────────────────────────────────

   Every suite was run one after another, and the browser-driven ones are the
   overwhelming majority of the clock: each boots Chromium, loads the app, and
   drives it. Serially that is hours on a four-core machine that is idle for
   most of them, and a gate somebody has to plan their afternoon around is a
   gate they stop running before pushing - which is the failure that matters,
   because an unrun check is not a check.

   The only thing that made serial necessary was the harness counting ports up
   from a fixed number. It asks the kernel for a free one now, so two suites
   running at once cannot take the same port, and there is nothing else shared
   between them: each is its own process with its own server and its own
   browser.

   Default is the core count, capped at 4 - past that the browsers contend for
   CPU and the wall clock stops improving. `--jobs=N` overrides it and
   `--serial` is `--jobs=1`, which is what to reach for when a failure might be
   about ordering and needs to be reproduced without interleaving. */
const JOBS = (() => {
  if (flags.includes('--serial')) return 1;
  const j = flags.find(f => f.startsWith('--jobs='));
  if (j) return Math.max(1, Math.min(16, parseInt(j.slice(7), 10) || 1));
  return Math.max(1, Math.min(4, cpus().length || 1));
})();

/* Say what was selected. A run that quietly covers one file looks exactly like
   a run that covers all of them once the output scrolls. */
sayLine(`\x1b[2mselected ${suites.length} suite(s)` +
  (dirFilter ? ` in tests/${dirFilter}/` : nameFilter ? ` matching "${nameFilter}"` : ' (all)') +
  `, ${JOBS} at a time\x1b[0m`);

/* OUTPUT IS BUFFERED PER SUITE AND PRINTED WHOLE.

   'inherit' was right when one child spoke at a time. With several it
   interleaves them line by line, so a failing assertion appears under whichever
   suite header happened to be printed last - a report that is not merely hard
   to read but actively wrong about which suite failed.

   So each child writes into its own buffer and the whole thing is printed, with
   its header, when that suite finishes. The suites are still reported in the
   order they were selected, not the order they happened to finish, so two runs
   of the same tree read the same. */
const run = (s) => new Promise((resolve) => {
  const chunks = [];
  const p = spawn('node', [s.path], { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT });
  p.stdout.on('data', (d) => chunks.push(d));
  p.stderr.on('data', (d) => chunks.push(d));
  /* A suite that cannot be spawned at all resolves like one that failed, rather
     than leaving a promise nobody settles and a run that hangs for ever with no
     output. */
  p.on('error', (e) => resolve({ name: s.name, code: 1, out: Buffer.from(String(e && e.message || e) + '\n') }));
  p.on('close', (code) => resolve({ name: s.name, code, out: Buffer.concat(chunks) }));
});

const results = new Array(suites.length);
{
  let next = 0;
  let printed = 0;
  /* Printed in SELECTION order however they finish, so the transcript of a
     parallel run is identical to a serial one. A suite that finished early
     waits its turn in the buffer. */
  const flush = () => {
    while (printed < results.length && results[printed]) {
      const r = results[printed];
      sayLine(`\n\x1b[1m\x1b[36m━━━ ${r.name} ━━━\x1b[0m`);
      if (r.out && r.out.length) process.stdout.write(r.out);
      printed++;
    }
  };
  /* PROGRESS, SEPARATELY FROM THE TRANSCRIPT.

     Printing in selection order means a slow suite early in the list holds back
     everything that finished behind it, so for minutes at a time the screen
     shows nothing at all and a working run is indistinguishable from a hung
     one. The count goes to STDERR, which is not the transcript, so it can say
     what is happening without getting into the record the gate reads. */
  let done = 0;
  const tick = (name) => {
    done++;
    if (!process.stderr.isTTY) return;
    const line = `  [${done}/${suites.length}] ${name}`;
    process.stderr.write('\r\x1b[2K\x1b[2m' + line.slice(0, 100) + '\x1b[0m');
    if (done === suites.length) process.stderr.write('\r\x1b[2K');
  };
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= suites.length) return;
      results[i] = await run(suites[i]);
      tick(suites[i].name);
      flush();
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, suites.length) }, worker));
  flush();
}

const failed = results.filter(r => r.code !== 0);
sayLine('\n\x1b[1m════════ SUMMARY ════════\x1b[0m');
results.forEach(r => {
  sayLine(r.code === 0
    ? `  \x1b[32m✓ ${r.name}\x1b[0m`
    : `  \x1b[31m✗ ${r.name}\x1b[0m`);
});

if (failed.length) {
  /* Written synchronously: this line is immediately followed by an exit, and
     it is the line check.mjs reads to say WHICH suites failed. */
  sayLine(`\n\x1b[31m${failed.length} suite(s) FAILED\x1b[0m`);
  process.exit(1);
}
sayLine(`\n\x1b[32mAll ${results.length} suites passed\x1b[0m`);
