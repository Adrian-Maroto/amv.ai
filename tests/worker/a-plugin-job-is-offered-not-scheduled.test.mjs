/* A PLUGIN'S JOBS, AS THE MARKETPLACE TAKES THEM.

   The server checks a plugin listing whole because a request does not have
   to come from the page: jobs are text and a schedule, no more often than
   daily, at most five, and their words are screened with the rest of the
   plugin - they are what a buyer may set running. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'pluginjobs.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _mktPluginClean };\n');
const W = await import(harness + '?t=' + Date.now());

const job = (o) => Object.assign({ title: 'Monday review', detail: 'Summarise last week.', repeat: 'weekly', time: '08:00', days: ['Mon', 'xyz'] }, o);

section('A job is kept as text and a schedule');
{
  const r = W._mktPluginClean({ jobs: [job({ extra: 'dropped', run: 'rm -rf' })] });
  ok(!r.error && r.plugin.jobs.length === 1, 'a plugin of one job is a plugin', r);
  const j = r.plugin.jobs[0];
  ok(j.repeat === 'weekly' && j.time === '08:00' && j.days.join() === 'mon' && !('extra' in j) && !('run' in j),
     'only its title, words and schedule are kept; an unknown day and unknown fields are dropped', j);
  ok(/Summarise last week/.test(r.text), 'and its words are part of what the content screen reads', r.text);
  ok(W._mktPluginClean({ jobs: [job({ time: '25:00' })] }).plugin.jobs[0].time === '', 'a time that is not one is dropped, not guessed');
}

section('More often than daily, more than five, or too long is refused');
{
  ok(/daily, weekly or monthly/.test(W._mktPluginClean({ jobs: [job({ repeat: '10min' })] }).error || ''), 'every ten minutes is refused');
  ok(/at most 5/.test(W._mktPluginClean({ jobs: Array(6).fill(job()) }).error || ''), 'six jobs are refused');
  ok(/limited to 1000/.test(W._mktPluginClean({ jobs: [job({ detail: 'x'.repeat(1001) })] }).error || ''), 'a job past 1,000 characters is refused, not cut');
  ok(/title and what it does/.test(W._mktPluginClean({ jobs: [job({ title: ' ' })] }).error || ''), 'a job with no title is refused');
}

if (report('a-plugin-job-is-offered-not-scheduled') > 0) process.exitCode = 1;
done();
