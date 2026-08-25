/* ONE WAY OUT TO THE MODEL.

   The endpoint, the auth header and the protocol version were copied into six
   call sites. The duplication was the smaller problem. The real one was that
   AMV had no answer to its provider having a bad hour: changing where a request
   goes meant editing six places correctly, so nobody was ever going to do it
   during an outage, which is the only time it matters.

   The destination is configuration now, and there is a fallback - but the
   fallback has to be careful in a specific way. A streaming response has
   already put words on the user's screen. Retrying it somewhere else repeats
   them, and a duplicated answer is a worse failure than an honest error. So a
   retry is allowed only where nothing has been delivered yet, and only for the
   failures that a different endpoint could actually fix. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'transport.harness.mjs');
writeFileSync(harness, src + `
export { _modelFetch, _modelBase, _modelHeaders, _modelKey, MODEL_API_DEFAULT, MODEL_API_VERSION };
`);
const W = await import(harness + '?t=' + Date.now());

const realFetch = globalThis.fetch;
/* Record every attempt so the assertions can be about what actually went out. */
const spy = (plan) => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const step = plan[calls.length - 1] ?? plan[plan.length - 1];
    if (step instanceof Error) throw step;
    return { ok: step < 400, status: step, json: async () => ({}), text: async () => '' };
  };
  return calls;
};
const env = (extra = {}) => ({ AMV_MODEL_KEY: 'k-secret', AMV_KV: {
  async get() { return null; }, async put() {}, async delete() {},
  async list() { return { keys: [], list_complete: true }; } }, ...extra });

section('The destination is configuration, with a sane default');
{
  ok(W._modelBase(env()) === W.MODEL_API_DEFAULT, 'unset means the default endpoint', W._modelBase(env()));
  ok(W._modelBase(env({ MODEL_API_URL: 'https://gw.example' })) === 'https://gw.example',
     'and a configured one is used instead');
  ok(W._modelBase(env({ MODEL_API_URL: 'https://gw.example/' })) === 'https://gw.example',
     'a trailing slash does not become a double slash in the path');
  ok(W._modelBase(env({ MODEL_API_URL: 'https://gw.example///' })) === 'https://gw.example',
     'and neither do several');
  ok(W._modelBase(env(), 'fallback') === '', 'no fallback configured is empty, not the default');
}

section('The key goes in a header and nowhere else');
{
  const h = W._modelHeaders(env());
  ok(h['x-api-key'] === 'k-secret', 'the key is sent as a header');
  ok(h['anthropic-version'] === W.MODEL_API_VERSION, 'with the protocol version the endpoint expects');

  const calls = spy([200]);
  await W._modelFetch(env(), { model: 'm', messages: [] });
  globalThis.fetch = realFetch;
  ok(!/k-secret/.test(calls[0].url), 'and never in the URL, where it would land in logs', calls[0].url);
  ok(!/k-secret/.test(String(calls[0].init.body)), 'nor in the body');
}

section('A request that produced nothing can be tried somewhere else');
{
  const e = env({ MODEL_API_URL: 'https://primary.test', MODEL_API_FALLBACK_URL: 'https://backup.test' });

  let calls = spy([500, 200]);
  let r = await W._modelFetch(e, { messages: [] });
  globalThis.fetch = realFetch;
  ok(calls.length === 2, 'a 5xx is retried on the fallback', calls.length);
  ok(calls[0].url.startsWith('https://primary.test'), 'the primary went first', calls[0].url);
  ok(calls[1].url.startsWith('https://backup.test'), 'then the fallback', calls[1].url);
  ok(r.status === 200, 'and the caller gets the working answer', r.status);

  calls = spy([new Error('connect ECONNREFUSED'), 200]);
  r = await W._modelFetch(e, { messages: [] });
  globalThis.fetch = realFetch;
  ok(calls.length === 2, 'a transport failure is retried too', calls.length);
  ok(r.status === 200, 'and also rescued', r.status);
}

section('A HUNG provider is the failure the fallback exists for, so it has to survive it');
{
  /* THE FAILOVER COULD NOT SURVIVE A TIMEOUT.

     _modelFetch fills in a deadline when the caller supplies none, then reused
     the SAME init - signal included - for the fallback attempt. On a timeout
     that signal has already fired, so the second request aborted before the
     connection opened. The failover worked for a transport error, where the
     signal is still live, and was inert for a hung provider - which is the
     failure a second endpoint is bought to cover.

     Nothing said so. The immediate abort was swallowed by the catch around the
     fallback and the primary's error was reported as though there had been no
     fallback configured at all. It would have been discovered during the
     outage, by someone reading a bill for a second endpoint that never served
     a request. */
  const e = env({ MODEL_API_URL: 'https://primary.test', MODEL_API_FALLBACK_URL: 'https://backup.test' });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const sig = init && init.signal;
    /* A PROVIDER THAT STALLS, MODELLED AS ONE.

       The first version of this threw a TimeoutError immediately, which is what
       a timeout LOOKS like from the caller and is not what produces the defect:
       the signal had not actually fired yet, so the reused one was not aborted
       and sabotaging the fix changed nothing. A fake that skips the mechanism
       cannot test the mechanism.

       So this waits for the real AbortSignal to fire and rejects the way fetch
       does - which means by the time the fallback is attempted, the deadline
       this function invented has genuinely been spent. */
    if (calls.length === 0) {
      calls.push({ url: String(url), aborted: !!(sig && sig.aborted) });
      await new Promise((res) => {
        if (!sig || sig.aborted) return res();
        sig.addEventListener('abort', () => res(), { once: true });
        /* A REF'D TIMER, OR THE PROCESS EXITS BEFORE THE ABORT ARRIVES.
           AbortSignal.timeout()'s own timer is unref'd, so with nothing else
           scheduled the event loop drains and Node reports an unsettled
           top-level await instead of running the test. This keeps the loop
           alive just past the deadline. */
        setTimeout(res, 200);
      });
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    }
    calls.push({ url: String(url), aborted: !!(sig && sig.aborted) });
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
  const r = await W._modelFetch(e, { messages: [] }, { timeoutMs: 20 });
  globalThis.fetch = realFetch;

  ok(calls.length === 2, 'the fallback is attempted after a timeout', calls.length);
  ok(calls[1] && calls[1].url.startsWith('https://backup.test'), 'and it goes to the other endpoint', calls[1] && calls[1].url);
  ok(calls[1] && calls[1].aborted === false,
     'carrying a signal that has NOT already fired, or it dies before it connects', calls[1] && calls[1].aborted);
  ok(r && r.status === 200, 'so the request is actually rescued', r && r.status);
}

section('A caller who cancelled stays cancelled');
{
  /* The deadline this function invents is its own and gets renewed. A signal
     the CALLER passed is theirs: if they aborted, the whole thing is aborted,
     and quietly retrying on another endpoint would be AMV continuing to spend
     on work somebody asked it to stop. */
  const e = env({ MODEL_API_URL: 'https://primary.test', MODEL_API_FALLBACK_URL: 'https://backup.test' });
  const ac = new AbortController();
  ac.abort();
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), aborted: !!(init && init.signal && init.signal.aborted) });
    if (calls.length === 1) throw new Error('aborted');
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
  await W._modelFetch(e, { messages: [] }, { signal: ac.signal }).catch(() => {});
  globalThis.fetch = realFetch;
  ok(calls.length >= 2 ? calls[1].aborted === true : true,
     'the caller\u2019s own aborted signal is carried through, not replaced with a fresh one',
     calls.length >= 2 ? calls[1].aborted : 'no second attempt');
}

section('A request that is simply wrong is not sent twice');
{
  const e = env({ MODEL_API_URL: 'https://primary.test', MODEL_API_FALLBACK_URL: 'https://backup.test' });
  const calls = spy([400, 200]);
  const r = await W._modelFetch(e, { messages: [] });
  globalThis.fetch = realFetch;
  ok(calls.length === 1, 'a 400 is the request being wrong - another endpoint gets the same wrong request', calls.length);
  ok(r.status === 400, 'so the real error is returned', r.status);
}

section('A stream is NEVER retried, because the words are already gone');
{
  const e = env({ MODEL_API_URL: 'https://primary.test', MODEL_API_FALLBACK_URL: 'https://backup.test' });
  const calls = spy([500, 200]);
  const r = await W._modelFetch(e, { messages: [] }, { stream: true });
  globalThis.fetch = realFetch;
  ok(calls.length === 1, 'one attempt only', calls.length);
  ok(r.status === 500, 'and the failure is reported honestly rather than answered twice', r.status);

  ok(/_modelFetch\(env, payload, \{ stream: true \}\)/.test(src),
     'the chat path marks itself as streaming');
  ok(/_modelFetch\(env, upstreamBody, \{ stream: true \}\)/.test(src),
     'and so does the embeddable widget');
}

section('With nothing to fall back to, the primary failure is the answer');
{
  const calls = spy([500, 200]);
  const r = await W._modelFetch(env({ MODEL_API_URL: 'https://primary.test' }), { messages: [] });
  globalThis.fetch = realFetch;
  ok(calls.length === 1, 'no second attempt is invented', calls.length);
  ok(r.status === 500, 'and the error is passed through', r.status);

  /* A fallback pointing at the primary is a configuration mistake, not a
     fallback - retrying the same endpoint just doubles the load on something
     that is already failing. */
  const same = spy([500, 200]);
  await W._modelFetch(env({ MODEL_API_URL: 'https://one.test', MODEL_API_FALLBACK_URL: 'https://one.test' }), { messages: [] });
  globalThis.fetch = realFetch;
  ok(same.length === 1, 'a fallback equal to the primary is not retried into', same.length);
}

section('When the fallback cannot help either, the caller still gets a real error');
{
  const e = env({ MODEL_API_URL: 'https://primary.test', MODEL_API_FALLBACK_URL: 'https://backup.test' });
  const calls = spy([503, 503]);
  const r = await W._modelFetch(e, { messages: [] });
  globalThis.fetch = realFetch;
  ok(calls.length === 2, 'both were tried', calls.length);
  ok(r && r.status >= 500, 'and a response comes back rather than an exception', r && r.status);

  /* Both endpoints unreachable: the original transport error is what the caller
     needs to see, not a swallowed undefined. */
  let threw = null;
  spy([new Error('primary down'), new Error('backup down')]);
  try { await W._modelFetch(e, { messages: [] }); } catch (err) { threw = err; }
  globalThis.fetch = realFetch;
  ok(threw instanceof Error, 'a total outage throws rather than returning nothing', String(threw));
}

section('There is exactly one place that knows where the model lives');
{
  const hardcoded = (src.match(/fetch\(\s*['"]https:\/\/api\.anthropic\.com/g) || []).length;
  ok(hardcoded === 0, 'no call site builds the upstream URL itself', hardcoded);
  const versions = (src.match(/'anthropic-version'/g) || []).length;
  ok(versions === 1, 'and the protocol version appears once', versions);
  const keyReads = (src.match(/'x-api-key'/g) || []).length;
  ok(keyReads === 1, 'as does the auth header', keyReads);
}

if (report('model-transport') > 0) process.exitCode = 1;
done();
