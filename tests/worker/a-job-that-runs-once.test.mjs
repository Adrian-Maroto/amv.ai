/* A JOB THAT RUNS ONCE, AT THE TIME SOMEBODY SAID.

   "Once" in Crew meant "now": there was no way to say "on Friday at 9, check
   whether the tickets are on sale" and have it happen with the laptop shut.
   A one-time job is the scheduler's own job with a time and no repeat, so
   what this proves is the part that is easy to get wrong around it:

     - it runs at its time, once, and then never again;
     - a run that fails, or cannot start because an account is not connected,
       is tried again shortly - not a day later, and not never - until a day
       has passed, and then it stops spending;
     - a finished one stops holding one of the plan's places, and cannot be
       "resumed" into running at some arbitrary time;
     - recurring jobs behave exactly as before. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'once.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { runDueAutomations, issueTokens, _autoNextAfter };
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'once@test.com';
const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  AMV_MODEL_KEY: 'k', AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k, v){ store.set(k, v); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
const ctx = { waitUntil(){}, passThroughOnException(){} };

store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
const pair = await W.issueTokens(env, ME, 'Once');
let ip = 1;
const post = async (path, body) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pair.token, Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.7.' + (ip++) },
    body: JSON.stringify(body) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const rec = () => JSON.parse(store.get('auto:' + ME) || '{"items":[],"results":[]}');
const put = (r) => store.set('auto:' + ME, JSON.stringify(r));

/* The model, answering or failing on demand, and counting how often it is asked. */
let modelCalls = 0, modelMode = 'ok';
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => {
  modelCalls++;
  if (modelMode === 'fail') return new Response(JSON.stringify({ error: { message: 'upstream down' } }), { status: 500 });
  return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Tickets go on sale at 10.' }], stop_reason: 'end_turn',
    usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200 });
};
/* A tick at a given instant, with the job's due time pulled to where the test
   wants it. Each tick gets a distinct due time, as real ones do, so the run
   lease (keyed on the due time) never mistakes two ticks for one. */
const tickAt = async (now) => { await W.runDueAutomations(env, now); return rec(); };

section('Created with a time, and refused without one');
{
  const at = Date.now() + 2 * 3600e3;
  const r = await post('/auto/create', { detail: 'Check whether the concert tickets are on sale', repeat: 'once', firstRunAt: at, approval: 'auto' });
  ok(r.status === 200 && r.d.item && r.d.item.repeat === 'once', 'a one-time job is created', r.status + ' ' + JSON.stringify(r.d).slice(0, 160));
  ok(r.d.item && r.d.item.next === at && r.d.item.onceAt === at, 'due at exactly the instant asked for', r.d.item && r.d.item.next);
  ok(r.d.item && !r.d.item.sched, 'with no calendar schedule, because it does not repeat');
  const bad = await post('/auto/create', { detail: 'Some time', repeat: 'once' });
  ok(bad.status === 400 && bad.d.code === 'once_needs_time', 'without a time it is refused, not run "in a day"', bad.status + ' ' + bad.d.code);
  const past = await post('/auto/create', { detail: 'Last year', repeat: 'once', firstRunAt: Date.now() - 86400e3 });
  ok(past.status === 400, 'and so is a time already gone', past.status);
}

section('It runs at its time, once, and is then finished');
{
  const r0 = rec(); const it0 = r0.items[0] || { next: Date.now() + 7200e3 };
  modelCalls = 0;
  let r = await tickAt(it0.next - 60e3);
  ok(modelCalls === 0 && r.items[0].active, 'a minute early, nothing runs', modelCalls);
  r = await tickAt(it0.next + 60e3);
  const it = r.items[0];
  ok(modelCalls > 0, 'at its time, it runs', modelCalls);
  ok(it.done === true && it.active === false, 'and is finished: done, and no longer active', { done: it.done, active: it.active });
  ok((r.results || []).some(x => x.autoId === it.id && /Tickets go on sale/.test(x.out || '')), 'with its result kept for the person');
  modelCalls = 0;
  await tickAt(it0.next + 2 * 86400e3);
  await tickAt(it0.next + 9 * 86400e3);
  ok(modelCalls === 0, 'and it never runs again - not the next day, not the next week', modelCalls);
}

section('A failed run is tried again in half an hour, then stops after a day');
{
  const due = Date.now() + 3600e3;
  put({ items: [{ id: 'f1', detail: 'Look up whether the museum has announced new opening hours', repeat: 'once', interval: 86400e3, next: due, onceAt: due,
    kind: 'task', approval: 'auto', notify: 'app', active: true, runs: 0, uses: [], created: Date.now() }], results: [] });
  modelMode = 'fail';
  let r = await tickAt(due + 1000);
  let it = r.items[0];
  ok(it.active === true && !it.done, 'a failure does not finish it', { active: it.active, done: it.done });
  const gap = it.next - (due + 1000);
  ok(gap > 25 * 60e3 && gap <= 31 * 60e3, 'its next try is about half an hour later, not tomorrow', Math.round(gap / 60e3) + ' min');
  modelMode = 'ok';
  r = await tickAt(it.next + 1000);
  it = r.items[0];
  ok(it.done === true, 'and when the retry works, it is finished', it.done);

  /* A failure that goes on: after a day past its time, it gives up. */
  put({ items: [{ id: 'f2', detail: 'Look up whether the museum has announced new opening hours', repeat: 'once', interval: 86400e3, next: due, onceAt: due,
    kind: 'task', approval: 'auto', notify: 'app', active: true, runs: 0, uses: [], created: Date.now(), errors: 0 }], results: [] });
  ok(W._autoNextAfter({ repeat: 'once', onceAt: due, active: true }, due + 25 * 3600e3, 'failed') === 0, 'a day past its time, a failed one-time job is finished rather than retried');
}

section('Waiting on a connection is retried the same way, not dropped');
{
  const due = Date.now() + 3600e3;
  put({ items: [{ id: 'w1', detail: 'Summarise my inbox and tell me what needs a reply', repeat: 'once', interval: 86400e3, next: due, onceAt: due,
    kind: 'task', approval: 'auto', notify: 'app', active: true, runs: 0, uses: ['mail.read'], created: Date.now() }], results: [] });
  modelCalls = 0;
  const r = await tickAt(due + 1000);
  const it = r.items[0];
  ok(it.active === true && !it.done, 'a job waiting on a mailbox is not finished by waiting', { active: it.active, done: it.done, needs: it.lastNeeds });
  ok(it.next - (due + 1000) <= 31 * 60e3, 'it looks again in half an hour, so connecting the mailbox at 9:10 still gets it done', Math.round((it.next - due) / 60e3) + ' min');
}

section('A finished one-time job does not hold a place, and cannot be resumed');
{
  /* A Pro plan has five places. Five finished one-time jobs must not stop a
     sixth job being created. */
  store.set('ent:' + ME, JSON.stringify({ plan: 'pro' }));
  const finished = Array.from({ length: 5 }, (_, i) => ({ id: 'd' + i, detail: 'done ' + i, repeat: 'once', interval: 86400e3, next: 0,
    onceAt: Date.now() - 86400e3, kind: 'task', approval: 'auto', notify: 'app', active: false, done: true, runs: 1, uses: [] }));
  put({ items: finished, results: [] });
  const r = await post('/auto/create', { detail: 'A new daily check', repeat: 'daily', approval: 'require' });
  ok(r.status === 200, 'five finished one-time jobs leave all five places free', r.status + ' ' + (r.d.error || ''));
  const res = await post('/auto/update', { id: 'd0', action: 'resume' });
  ok(res.status === 409 && res.d.code === 'once_done', 'and resuming one that already ran is refused, saying why', res.status + ' ' + res.d.code);
  store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
}

section('A recurring job is exactly what it was');
{
  const due = Date.now() + 3600e3;
  put({ items: [{ id: 'r1', detail: 'Morning news briefing', repeat: 'daily', interval: 86400e3, next: due,
    kind: 'task', approval: 'auto', notify: 'app', active: true, runs: 0, uses: [], created: Date.now() }], results: [] });
  modelMode = 'ok';
  const r = await tickAt(due + 1000);
  const it = r.items[0];
  ok(it.active === true && !it.done, 'a daily job stays active after it runs');
  ok(it.next > due + 20 * 3600e3, 'and next runs about a day later', Math.round((it.next - due) / 3600e3) + 'h');
}

globalThis.fetch = realFetch;
if (report('a-job-that-runs-once') > 0) process.exitCode = 1;
done();
