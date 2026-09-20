/* "TRY TO ACTUALLY RUN THE BACKGROUND TASK AND IF IT CAN'T EVEN AFTER LIKE OR
   SO 50 ATTEMPTS THEN GIVE SUGGESTIONS ON HOW TO DO AND WHAT AMV CAN DO
   RELATED TO WHAT THEY ASKED."

   What was there: one attempt per scheduled run, no distinction between a
   dropped packet and a refusal, and after five failed runs the sentence "Fix
   the cause and turn it back on" - which is useless to the person reading it,
   because they do not know what the cause is and they are reading it precisely
   because AMV was supposed to be the one handling it.

   Fifty blind retries would be worse than one, and this file is partly the
   record of why. Fifty attempts at a PERMANENT failure is fifty identical
   errors, fifty hits on somebody else's API, a day's capacity gone, and - for
   a job whose failure came after the mail left - fifty deliveries. So what is
   built is retry where retrying is the answer, counted across runs so the
   number is real: three attempts a run over five runs is fifteen, and the
   give-up message says fifteen rather than five.

   Every assertion here is on the CLASSIFIER, the LOOP and the MESSAGE, driven
   directly with a stubbed executor. No model is called and none is needed:
   what is being measured is which failures are worth repeating and what is
   said when repeating stops, and both are decisions this code makes on its
   own. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'retry.harness.mjs');
writeFileSync(harness, src + `
export { _autoTransient, _autoExecuteTried, _autoGiveUpAdvice,
         AUTO_RETRY_PER_RUN, AUTO_RETRY_BACKOFF_MS, AUTO_RETRY_MIN_HEADROOM_MS };
export function __setAutoExecute(fn){ _autoExecute = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

section('Which failures are worth repeating');
{
  const yes = [
    'model error 429: rate limited',
    'model error 503: upstream unavailable',
    'model error 529: overloaded',
    'model error 500: internal',
    'fetch failed',
    'socket hang up',
    'ECONNRESET while reading',
    'The request timed out',
  ];
  const no = [
    'model error 400: your request was malformed',
    'model error 401: no key',
    'model error 403: forbidden',
    'Connect Gmail first.',
    'no connector "teleport" is registered',
    'refused: that is not something AMV will do',
    'something nobody has seen before',
  ];
  yes.forEach(m => ok(W._autoTransient(new Error(m)) === true, 'retried: ' + m));
  no.forEach(m => ok(W._autoTransient(new Error(m)) === false, 'not retried: ' + m));
  /* The default is NO, and that is the point. Being wrong costs a few minutes
     in one direction and real money, third-party load and possibly a duplicate
     send in the other. */
  ok(W._autoTransient(null) === false, 'and an error with nothing in it is not retried');
}

section('A dropped connection costs seconds, not a day');
{
  let calls = 0;
  W.__setAutoExecute(async () => {
    calls++;
    if(calls < 2) throw new Error('fetch failed');
    return { text: 'the brief', usage: { input: 10, output: 20, webSearches: 0 } };
  });
  const t0 = Date.now();
  const r = await W._autoExecuteTried({}, { id:'j1', detail:'brief me' }, {}, 'a@b.c', '', [], Date.now() + 60000);
  ok(calls === 2, 'it tried again', String(calls));
  ok(r.exec.text === 'the brief', 'and the second attempt is the answer');
  ok(r.attempts === 2, 'the count is what actually happened', String(r.attempts));
  ok(Date.now() - t0 >= W.AUTO_RETRY_BACKOFF_MS[0], 'it waited before retrying rather than hammering');
}

section('A refusal is not tried again, however many attempts are allowed');
{
  let calls = 0;
  W.__setAutoExecute(async () => { calls++; throw new Error('model error 400: your request was malformed'); });
  let err = null;
  try{ await W._autoExecuteTried({}, { id:'j2', detail:'x' }, {}, 'a@b.c', '', [], Date.now() + 60000); }
  catch(e){ err = e; }
  ok(calls === 1, 'it was attempted exactly once', String(calls));
  ok(err && err.attempts === 1, 'and the error carries that count', String(err && err.attempts));
  ok(W.AUTO_RETRY_PER_RUN > 1, 'even though more attempts were available', String(W.AUTO_RETRY_PER_RUN));
}

section('Retrying has a ceiling');
{
  let calls = 0;
  W.__setAutoExecute(async () => { calls++; throw new Error('model error 529: overloaded'); });
  let err = null;
  try{ await W._autoExecuteTried({}, { id:'j3', detail:'x' }, {}, 'a@b.c', '', [], Date.now() + 60000); }
  catch(e){ err = e; }
  ok(calls === W.AUTO_RETRY_PER_RUN, 'it stopped at the ceiling', calls + '/' + W.AUTO_RETRY_PER_RUN);
  ok(err && err.attempts === W.AUTO_RETRY_PER_RUN, 'and says so', String(err && err.attempts));
}

section('Somebody else’s overdue job is worth more than one more attempt');
{
  /* The tick has a wall-clock budget and the jobs behind this one are already
     late. A retry that would not fit is not started - measured by handing it a
     deadline too close for the backoff. */
  let calls = 0;
  W.__setAutoExecute(async () => { calls++; throw new Error('fetch failed'); });
  const t0 = Date.now();
  let err = null;
  try{ await W._autoExecuteTried({}, { id:'j4', detail:'x' }, {}, 'a@b.c', '', [], Date.now() + 500); }
  catch(e){ err = e; }
  ok(calls === 1, 'it did not start a retry it could not finish', String(calls));
  ok(Date.now() - t0 < W.AUTO_RETRY_BACKOFF_MS[0], 'and did not sleep out the budget');
  ok(err && err.attempts === 1, 'the count is still honest', String(err && err.attempts));
}

section('When it gives up it says what would work');
{
  const job = { detail: 'summarise my inbox every morning and email me the three things that matter' };
  const busy  = W._autoGiveUpAdvice(job, 'model error 429: rate limited', 15);
  const dead  = W._autoGiveUpAdvice(job, 'fetch failed', 15);
  const money = W._autoGiveUpAdvice(job, 'monthly allowance reached', 15);
  const no    = W._autoGiveUpAdvice(job, 'model error 400: refused', 15);

  ok(/15 times/.test(busy), 'it states the real number of attempts, not the number of runs', busy.slice(0, 60));
  ok(/summarise my inbox/.test(busy), 'it quotes back what was asked for');
  ok(!/Fix the cause/.test(busy), 'it does not hand back a cause the person cannot see');
  ok(busy.split('\n- ').length >= 3, 'it gives more than one thing to try');

  /* Four different causes must not produce one generic paragraph - that is the
     failure mode of advice generated from a template. */
  const heads = [busy, dead, money, no].map(t => t.split('\n')[0]);
  ok(new Set(heads).size === 4, 'each cause gets its own answer', JSON.stringify(heads));
  ok(/quieter hour/.test(busy), 'a busy engine suggests moving the hour');
  ok(/clears on its own/.test(dead), 'a dropped connection says it usually clears');
  ok(/Spending/.test(money), 'a spent allowance points at the screen that holds it');
  ok(/reword/i.test(no), 'a refusal says the instruction is what to change');
  ok(/switched off/.test(busy), 'and every one of them says the job is off now');
}

report();
done();
