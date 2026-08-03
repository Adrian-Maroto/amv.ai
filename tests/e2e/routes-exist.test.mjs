/* THE CLIENT MUST NOT CALL A ROUTE THE SERVER DOES NOT HAVE.

   Crew's "Add to Running jobs" posted to /api/schedule/create. The worker has
   never had that route. Every job created from the command bar was therefore
   registered nowhere and ran only while AMV happened to be open - while the
   screen said "Added to Running jobs · Autonomous".

   It survived because the call was fired and forgotten: a 404 landed in a
   discarded promise, and the success message went out regardless. Fixing the
   claim is what made the missing route visible at all.

   This is the same defect this codebase keeps producing in different costumes -
   complete, careful code on one side of a boundary that nothing answers on the
   other. It is mechanical to check, so it should be. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');
const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');

/* Every path the worker answers: the switch cases, plus the patterns it matches
   for dynamic segments. */
const cases = new Set([...worker.matchAll(/case\s+'([^']+)'\s*:/g)].map(m => m[1]));
/* Prefix-matched families (/s/<slug>, /v1/finance/..., etc). */
const dynamic = [...worker.matchAll(/startsWith\('([^']+)'\)/g)].map(m => m[1]);

/* Every path the client asks for through its own API helper. Template literals
   and concatenations are skipped - they cannot be resolved statically, and a
   guess would make this noisy rather than useful. */
const called = new Set(
  [...bundle.matchAll(/_fetch\(\s*'(\/[A-Za-z0-9/_\-.]+)'/g)].map(m => m[1])
);

section('Both sides were parsed');
{
  ok(cases.size > 40, 'the worker exposes a lot of routes', cases.size);
  /* If this hits zero the pattern has drifted and the check below is vacuous. */
  ok(called.size > 10, 'and the client calls plenty of them by literal path', called.size);
}

section('Every route the client calls is one the worker answers');
{
  const answered = (p) => cases.has(p) || dynamic.some(d => p.startsWith(d));
  const missing = [...called].filter(p => !answered(p)).sort();
  ok(missing.length === 0,
     'no request goes to a path nothing on the server handles', missing);
}

section('The scheduler the command bar uses is the one the cron runs');
{
  /* Naming it directly, because the generic check above would be satisfied by
     ANY existing route - including one that exists but is not the scheduler. */
  ok(/_fetch\('\/auto\/create'/.test(bundle),
     'Crew registers background jobs through /auto/create', true);
  /* Matched on a CALL, not a mention - the comment explaining this defect names
     the dead route, and a check that cannot tell prose from a request would
     force the explanation to be deleted to stay green. */
  ok(!/_fetch\(\s*'\/api\/schedule\//.test(bundle),
     'and nothing still posts to the scheduler that never existed', true);

  const cronAt = worker.indexOf('async function runDueAutomations');
  const cron = worker.slice(cronAt, cronAt + 800);
  ok(/DB\.list\(env, 'auto'/.test(cron),
     'while the cron walks exactly the records /auto/create writes', true);
}

if (report('routes-exist') > 0) process.exitCode = 1;
done();
