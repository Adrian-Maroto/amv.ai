/* THE PROVIDER THAT NEVER ANSWERS AND NEVER FAILS.

   `_modelFetch` set an abort signal only when the caller handed it one, and
   almost no call site does. So the ordinary model call had no deadline at all.

   A provider that refuses the connection is easy - it throws, the refund runs,
   the person is told. The dangerous one accepts the connection and then says
   nothing. With no signal there is nothing to interrupt it: the Worker, the
   request and the customer's booked reservation all stay open until the
   platform kills the whole invocation. That kill happens outside the code, so
   the refund never runs, no error is recorded, and the person is charged for a
   request that produced nothing and reported nothing.

   That is the worst available failure. A timeout is a bad request; a stall is a
   bad request that also loses the money and the evidence.

   The fix is a default deadline that a caller can still override, and this file
   checks both halves - because "there is a signal on it" and "the signal
   actually stops anything" are different claims, and only one of them is worth
   having. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'deadline.harness.mjs');
writeFileSync(harness, src + '\nexport { _modelFetch, MODEL_DEADLINE_MS };\n');
const W = await import(harness + '?t=' + Date.now());

const env = { AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example' };

/* A provider that accepts and then says nothing, for ever. Resolves only if
   the signal aborts, which is the behaviour under test. */
const realFetch = globalThis.fetch;
let seen = [];
function stall() {
  globalThis.fetch = async (_u, init) => {
    seen.push(init);
    return await new Promise((_res, rej) => {
      if (!init || !init.signal) return;                 // nothing can ever stop it
      init.signal.addEventListener('abort', () => {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        rej(e);
      });
    });
  };
}
function answer() {
  globalThis.fetch = async (_u, init) => { seen.push(init); return new Response('{}', { status: 200 }); };
}

section('A call that sets no deadline is given one anyway');
{
  seen = [];
  answer();
  await W._modelFetch(env, { model: 'amv-core' });
  ok(seen.length === 1, 'the provider was called', seen.length);
  /* Read defensively. With the deadline removed there IS no signal, and a bare
     `sig.aborted` throws - which kills the file before the sections that carry
     the real weight ever run. A sabotage has to produce a failure report, not a
     stack trace, or the rest of the checks were never exercised at all. */
  const sig = seen[0] && seen[0].signal;
  ok(sig && typeof sig.aborted === 'boolean', 'and the request carries an abort signal', !!sig);
  ok(!!sig && sig.aborted === false, 'which has not fired, because nothing went wrong', sig && sig.aborted);
}

section('And the deadline really interrupts a stalled provider');
{
  /* The half that matters. Attaching a signal that nothing is wired to would
     satisfy the section above and change nothing about the failure.

     Driven through the same expression the default uses, with a short value
     so the case takes milliseconds rather than two minutes. */
  seen = [];
  stall();
  /* Raced against a watchdog rather than simply awaited. Without the deadline
     this call never settles - which is the defect - and a bare `await` would
     hang the suite instead of reporting it. The watchdog turns "held open for
     ever" into a named failure, which is the finding stated exactly.

     It doubles as the clock the deadline needs: Node runs AbortSignal.timeout
     on an unref'd timer, so with nothing else pending the process would exit
     before it fired. A Worker always has the in-flight request holding the loop
     open; here the watchdog does. */
  const HELD = Symbol('held open');
  const t0 = Date.now();
  const out = await Promise.race([
    W._modelFetch(env, { model: 'amv-core' }, { timeoutMs: 60 }).then(r => r, e => e),
    new Promise((res) => setTimeout(() => res(HELD), 2500)),
  ]);
  const ms = Date.now() - t0;

  ok(out !== HELD, 'the request does not stay open indefinitely', out === HELD ? 'still pending' : 'settled');
  ok(out instanceof Error, 'a provider that never answers becomes a failed request', out && out.name);
  ok(/abort/i.test(String((out && out.name) || '') + String((out && out.message) || '')),
     'and the failure says it was aborted, so the cause is recorded', out && out.name);
  ok(ms < 2000, 'it gives up quickly rather than holding the Worker open', ms);
}

section('A caller that knows better still wins');
{
  /* Some calls have their own, shorter budget. The default fills a gap; it must
     not overrule somebody who set one on purpose. */
  seen = [];
  stall();
  const ac = new AbortController();
  const p = W._modelFetch(env, { model: 'amv-core' }, { signal: ac.signal }).catch(e => e);
  ok(seen[0] && seen[0].signal === ac.signal, 'the caller’s own signal is passed through as given', true);
  ac.abort();
  const out = await p;
  ok(out instanceof Error, 'and aborting it stops the call', out && out.name);
}

section('The default is a real number, not an accident');
{
  ok(typeof W.MODEL_DEADLINE_MS === 'number', 'the deadline is a named constant', W.MODEL_DEADLINE_MS);
  /* Bounded from both sides on purpose. Too short cuts off a long streamed
     answer mid-sentence, which is a visible product regression; too long is the
     original bug with extra steps. */
  ok(W.MODEL_DEADLINE_MS >= 30000, 'long enough for a slow streamed answer', W.MODEL_DEADLINE_MS);
  ok(W.MODEL_DEADLINE_MS <= 300000, 'and short enough to fail as a request, not as a dead Worker', W.MODEL_DEADLINE_MS);

  /* That the constant is what a caller with no options actually gets. The
     behavioural cases above run through `timeoutMs`, so on their own they would
     still pass if the fallback to the constant were removed. */
  const i = src.indexOf('async function _modelFetch');
  const body = codeOnly(src.slice(i, src.indexOf('const primary = _modelBase(env);', i)));
  ok(/AbortSignal\.timeout\(\+o\.timeoutMs \|\| MODEL_DEADLINE_MS\)/.test(body),
     'a caller with no options falls back to the constant', true);
  ok(/if \(o\.signal\)/.test(body), 'and an explicit signal is preferred to it', true);
}

globalThis.fetch = realFetch;
if (report('a-stalled-provider-cannot-hold-the-worker') > 0) process.exitCode = 1;
done();
