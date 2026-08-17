#!/usr/bin/env node
/* Runs every test suite and exits non-zero if anything fails.
   Usage:
     node tests/run.mjs            # everything
     node tests/run.mjs security   # only suites matching "security"
*/
import { spawn } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
  console.error('\x1b[31mindex.html not found. Run `node build.mjs` first.\x1b[0m');
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
  console.error(`No suites matched "${filter}"`);
  process.exit(1);
}

/* What WOULD run, without running it. The selection is the thing that was
   broken, and a test for it cannot be "run the suite and count" - that is the
   suite. This makes the choice inspectable on its own. */
if (flags.includes('--list')) {
  for (const s of suites) console.log(s.name);
  process.exit(0);
}

/* Say what was selected. A run that quietly covers one file looks exactly like
   a run that covers all of them once the output scrolls. */
console.log(`\x1b[2mselected ${suites.length} suite(s)` +
  (dirFilter ? ` in tests/${dirFilter}/` : nameFilter ? ` matching "${nameFilter}"` : ' (all)') + '\x1b[0m');

const run = (s) => new Promise((resolve) => {
  console.log(`\n\x1b[1m\x1b[36m━━━ ${s.name} ━━━\x1b[0m`);
  const p = spawn('node', [s.path], { stdio: 'inherit', cwd: ROOT });
  p.on('close', (code) => resolve({ name: s.name, code }));
});

const results = [];
for (const s of suites) results.push(await run(s));

const failed = results.filter(r => r.code !== 0);
console.log('\n\x1b[1m════════ SUMMARY ════════\x1b[0m');
results.forEach(r => {
  console.log(r.code === 0
    ? `  \x1b[32m✓ ${r.name}\x1b[0m`
    : `  \x1b[31m✗ ${r.name}\x1b[0m`);
});

if (failed.length) {
  console.log(`\n\x1b[31m${failed.length} suite(s) FAILED\x1b[0m`);
  process.exit(1);
}
console.log(`\n\x1b[32mAll ${results.length} suites passed\x1b[0m`);
