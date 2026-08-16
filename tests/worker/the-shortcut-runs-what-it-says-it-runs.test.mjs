/* `npm run test:worker` RAN ONE FILE OUT OF A HUNDRED AND FIFTY.

   The runner filtered by substring against the FILENAME. `worker` matched
   `worker.test.mjs` and nothing else, so the shortcut named after the Worker
   suite ran 0.7% of it and reported "All 1 suites passed" - which is true, and
   is why nobody looked twice.

   The release gate was never affected: `check.mjs` calls the runner with no
   filter and runs everything. That is the more dangerous way round. The honest
   thing is the slow thing, and the lie is in the command people reach for when
   they are in a hurry and about to push.

   The general defect is a selector that can silently select almost nothing. It
   has the same signature as a sweep whose pattern never matches: a green result
   and an empty scope look identical from the outside. So this file asserts what
   the shortcut SELECTS, against what is on disk, rather than trusting a pass. */
import { execFileSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const RUNNER = join(ROOT, 'tests', 'run.mjs');

/* What the runner WOULD run, without running it.

   A runner that exits non-zero returns an empty selection rather than throwing.
   Selecting nothing is one of the outcomes under test - it is what a broken
   filter does - and letting it escape as an exception would abort the file
   before the remaining cases ran, which reports less than it looks like it
   reports. */
const select = (filter) => {
  const args = [RUNNER];
  if (filter) args.push(filter);
  args.push('--list');
  try {
    return execFileSync('node', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
};
const onDisk = (dir) => readdirSync(join(ROOT, 'tests', dir)).filter(f => f.endsWith('.test.mjs'));

section('The shortcuts select whole directories');
{
  const w = select('worker');
  const wDisk = onDisk('worker');
  ok(wDisk.length > 100, 'there is a real Worker suite on disk', wDisk.length);
  ok(w.length === wDisk.length,
     'and `test:worker` selects every file in it, not the one whose name says worker',
     { selected: w.length, onDisk: wDisk.length });
  ok(w.every(n => n.startsWith('worker/')), 'all of them from tests/worker/', w.slice(0, 2));

  const e = select('e2e');
  const eDisk = onDisk('e2e');
  ok(e.length === eDisk.length, 'and `test:e2e` selects every end-to-end file',
     { selected: e.length, onDisk: eDisk.length });
  ok(e.every(n => n.startsWith('e2e/')), 'all of them from tests/e2e/', e.slice(0, 2));
}

section('No filter still means everything, which is what the gate uses');
{
  const all = select('');
  const disk = [...onDisk('worker').map(f => 'worker/' + f), ...onDisk('e2e').map(f => 'e2e/' + f)];
  /* The names, not only the count. A mismatch of one is impossible to diagnose
     from two numbers, and this file exists because a selection that quietly
     covers less than it claims looks identical to one that covers everything. */
  const missing = disk.filter(f => !all.includes(f));
  const extra = all.filter(f => !disk.includes(f));
  ok(missing.length === 0 && extra.length === 0,
     'every suite in the repository is selected',
     { selected: all.length, onDisk: disk.length, missing, extra });

  /* The gate calls the runner with no filter. If that ever gained a filter, the
     thing that decides whether AMV ships would narrow silently. */
  const check = readFileSync(join(ROOT, 'check.mjs'), 'utf8');
  const call = /node[^\n]*tests\/run\.mjs([^\n']*)/.exec(check);
  ok(call != null, 'the gate’s call to the runner was found', call && call[0]);
  ok(!/run\.mjs\s+\S/.test(call[0]), 'and it passes no filter, so it runs everything', call[0]);
}

section('A name that is not a directory is still a name');
{
  /* The old behaviour is useful and is kept - `node tests/run.mjs market` to
     iterate on one area. Making the directories special must not remove it. */
  const m = select('market');
  ok(m.length > 0, 'a substring filter still selects by filename', m.length);
  ok(m.every(n => /market/.test(n)), 'and only files whose name contains it', m);
  ok(m.length < onDisk('worker').length, 'a narrow filter really is narrow', m.length);
}

section('The selection is announced, so a narrow run cannot pass for a wide one');
{
  /* The defect was survivable only because the output looked the same either
     way. One line at the top, before any suite runs, that says how many. */
  const out = execFileSync('node', [RUNNER, 'market', '--list'], { cwd: ROOT, encoding: 'utf8' });
  const runner = readFileSync(RUNNER, 'utf8');
  ok(/selected \$\{suites\.length\} suite\(s\)/.test(runner),
     'the runner reports the size of its selection', true);
  ok(out.length > 0, 'and listing works without running anything', out.split('\n').length);
}

section('The two names that mean a directory are the two directories');
{
  /* A hardcoded pair that drifts from the filesystem would put a new directory
     back in the old broken behaviour without saying so. */
  const runner = readFileSync(RUNNER, 'utf8');
  const dirs = /const DIRS = \[([^\]]*)\]/.exec(runner);
  ok(dirs != null, 'the directory list was found', dirs && dirs[1]);
  const named = dirs[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean).sort();
  const actual = readdirSync(join(ROOT, 'tests'), { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'lib')
    .map(d => d.name).sort();
  ok(JSON.stringify(named) === JSON.stringify(actual),
     'and it matches the test directories that actually exist', { named, actual });
}

if (report('the-shortcut-runs-what-it-says-it-runs') > 0) process.exitCode = 1;
done();
