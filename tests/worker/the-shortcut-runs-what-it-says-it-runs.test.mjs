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
import { readFileSync, readdirSync } from 'fs';
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
    /* A crashed runner used to come back as "selects nothing", which is a
       different failure wearing this one's clothes: the caller then reports
       that every suite is missing, and the reason - the runner would not even
       start - is the one thing not said. */
    return { failed: String((e && e.message) || e).slice(0, 200) };
  }
};
const sel = (filter) => { const r = select(filter); return Array.isArray(r) ? r : []; };
const selFailed = (filter) => { const r = select(filter); return Array.isArray(r) ? '' : r.failed; };
const onDisk = (dir) => readdirSync(join(ROOT, 'tests', dir)).filter(f => f.endsWith('.test.mjs'));

section('The shortcuts select whole directories');
{
  const w = sel('worker');
  const wDisk = onDisk('worker');
  ok(wDisk.length > 100, 'there is a real Worker suite on disk', wDisk.length);
  ok(w.length === wDisk.length,
     'and `test:worker` selects every file in it, not the one whose name says worker',
     { selected: w.length, onDisk: wDisk.length });
  ok(w.every(n => n.startsWith('worker/')), 'all of them from tests/worker/', w.slice(0, 2));

  const e = sel('e2e');
  const eDisk = onDisk('e2e');
  ok(e.length === eDisk.length, 'and `test:e2e` selects every end-to-end file',
     { selected: e.length, onDisk: eDisk.length });
  ok(e.every(n => n.startsWith('e2e/')), 'all of them from tests/e2e/', e.slice(0, 2));
}

section('The listing survives being read by another program');
{
  /* THIS IS WHAT ACTUALLY BROKE, AND IT BROKE INVISIBLY.

     The section below shells out with stdio 'pipe' and compares the names. It
     reported 177 of 307 - the runner apparently skipping everything
     alphabetically after "an-export-that-says-it-is-complete" - while the same
     command run by hand printed all 307, every time.

     The runner was fine. `--list` wrote with console.log in a loop and then
     called process.exit(0), and Node's stdout is ASYNCHRONOUS to a pipe, so
     exit did not wait for the queued writes. To a terminal that is invisible.
     Under the gate's parallel load it cut the output in half.

     So the check is run under load, which is the condition that produced it,
     rather than once on a quiet machine where the old code also passes. */
  /* The deterministic half. Six runs reproduce the truncation only sometimes -
     it took four attempts to see it - and a check that fails one time in six is
     worse than none, because a flaky gate teaches people to re-run it. So the
     property is asserted at the source: this listing is read by another program
     and must not be written with a call that exit can outrun. The runs below
     corroborate; with a synchronous write they cannot fail. */
  const runner = readFileSync(join(ROOT, 'tests', 'run.mjs'), 'utf8');
  const listBlock = runner.slice(runner.indexOf("flags.includes('--list')"),
                                 runner.indexOf('Say what was selected'));
  ok(listBlock.length > 0, 'the listing branch was found', listBlock.length);
  ok(!/console\.log\(/.test(listBlock),
     'the listing is not written with a call process.exit can outrun', listBlock.slice(0, 80));
  ok(/writeSync\(/.test(listBlock),
     'it is written synchronously, so the tail cannot be lost to a pipe', true);

  const N = 6;
  const runs = [];
  for (let i = 0; i < N; i++) runs.push(sel(''));
  const sizes = runs.map(r => r.length);
  const first = sizes[0];
  ok(first > 300, 'a listing has every suite in it', first);
  ok(sizes.every(n => n === first),
     'and it is the same size every time, including when several run at once', sizes.join(','));

  /* The tail specifically: a truncated write loses the END, so the last name
     is the one that goes missing first and the count alone can look plausible. */
  ok(runs.every(r => r[r.length - 1] === runs[0][r.length - 1]),
     'the last line arrives every time, which is the one truncation takes first',
     runs.map(r => r[r.length - 1]).join(' | '));
}

section('No filter still means everything, which is what the gate uses');
{
  const why = selFailed('');
  ok(!why, 'the runner could be asked what it would select', why || 'ok');
  const all = sel('');
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
     thing that decides whether AMV ships would narrow silently.

     Anchored on the sh() call rather than on the first place the file happens to
     say "node tests/run.mjs". It used to take the first textual match anywhere
     in check.mjs, which meant a COMMENT or an error message mentioning the
     command could answer this question instead of the code - and one did: a
     failure message that tells you to run a single suite on its own read as the
     gate narrowing itself to one suite, and this went red with the gate
     completely unchanged in that respect. A guard that a sentence about the
     code can satisfy is not measuring the code. */
  const check = readFileSync(join(ROOT, 'check.mjs'), 'utf8');
  const call = /\bsh\(\s*(['"`])node tests\/run\.mjs([^'"`]*)\1\s*\)/.exec(check);
  ok(call != null, 'the gate’s call to the runner was found', call && call[0]);
  ok(call != null && call[2].trim() === '',
     'and it passes no filter, so it runs everything', call && JSON.stringify(call[2]));
}

section('A name that is not a directory is still a name');
{
  /* The old behaviour is useful and is kept - `node tests/run.mjs market` to
     iterate on one area. Making the directories special must not remove it. */
  const m = sel('market');
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
     back in the old broken behaviour without saying so.

     "Directory under tests/" was the wrong question, and the `lib` exclusion was
     the evidence: the rule had already needed one hardcoded exception, which is
     what a proxy looks like just before it needs a second. It got one - adding
     tests/fixtures/ for the AMV-D007 control baseline failed this, and the
     failure was correct about the mismatch and wrong about the concern, because
     a directory of JSON is not a directory of suites nobody is running.

     The question it actually means is "does this directory hold suites". lib and
     fixtures hold none and drop out on their own, with no name written down. A
     new tests/integration/foo.test.mjs still fails this, which is the entire
     point of having it. */
  const runner = readFileSync(RUNNER, 'utf8');
  const dirs = /const DIRS = \[([^\]]*)\]/.exec(runner);
  ok(dirs != null, 'the directory list was found', dirs && dirs[1]);
  const named = dirs[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean).sort();
  const holdsSuites = (d) => {
    try { return readdirSync(join(ROOT, 'tests', d)).some(f => f.endsWith('.test.mjs')); }
    catch (e) { return false; }
  };
  const actual = readdirSync(join(ROOT, 'tests'), { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name).filter(holdsSuites).sort();
  ok(JSON.stringify(named) === JSON.stringify(actual),
     'and it matches every directory that actually holds suites', { named, actual });
}

if (report('the-shortcut-runs-what-it-says-it-runs') > 0) process.exitCode = 1;
done();
