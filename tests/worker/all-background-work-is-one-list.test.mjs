/* ALL BACKGROUND WORK IS ONE LIST, AND STOPS ONE WAY (Nov 1 audit TASK-008).

   Crew jobs, tasks in steps, agents' jobs, webhook-started jobs and batches
   of API requests each had their own list and their own stop. /v1/tasks is
   one view over all of them - one status vocabulary, the budget, the latest
   evidence - and /v1/tasks/cancel stops any of them with one meaning:
   nothing more runs, nothing more is spent, what it produced is kept. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'tasks.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { issueTokens, runDueAutomations, DB };\n');
const W = await import(harness + '?t=' + Date.now());

const ME = 'tia@test.com', OTHER = 'ole@test.com';
const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test', AMV_MODEL_KEY: 'k',
  AMV_KV: { async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' })); store.set('ent:' + OTHER, JSON.stringify({ plan: 'ultra' }));
const mine = await W.issueTokens(env, ME, 'Tia'), theirs = await W.issueTokens(env, OTHER, 'Ole');
let ip = 1;
const call = async (path, body, token = mine.token) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.7.' + (ip++) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Result.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200 });

const daily = await call('/auto/create', { detail: 'Brief me daily', repeat: 'daily', approval: 'auto' });
const steps = await call('/auto/create', { approval: 'auto', steps: [{ title: 'A', detail: 'Do A' }, { title: 'B', detail: 'Do B', after: 0 }] });
await call('/auto/update', { action: 'budget', id: daily.d.item.id, budgetUSD: 3 });

section('One list, one vocabulary');
{
  const r = await call('/v1/tasks');
  ok(r.status === 200 && Array.isArray(r.d.tasks) && r.d.tasks.length === 3, 'every job and every step is in it', r.d.tasks && r.d.tasks.map(t => t.id));
  ok(r.d.tasks.every(t => r.d.statuses.includes(t.status) && /^(job|batch):/.test(t.id) && 'budget' in t && 'evidence' in t && typeof t.cancellable === 'boolean'), 'each in the same shape and status words', r.d.tasks);
  const d = r.d.tasks.find(t => t.id === 'job:' + daily.d.item.id);
  ok(d.kind === 'job' && d.status === 'scheduled' && d.budget && d.budget.usd === 3 && d.budget.leftUSD === 3, 'a job: scheduled, with its budget', d);
  const b = r.d.tasks.find(t => t.kind === 'step' && t.status === 'waiting');
  ok(b && b.group === steps.d.group, 'a step that waits says so, and which task it belongs to', b);
  const theirsList = await call('/v1/tasks', undefined, theirs.token);
  ok(theirsList.d.tasks.length === 0, 'nobody else sees them', theirsList.d.tasks.length);
}

section('Stopping one: nothing more runs, what it made is kept');
{
  const first = steps.d.items[0].id, second = steps.d.items[1].id;
  const notMine = await call('/v1/tasks/cancel', { id: 'job:' + first }, theirs.token);
  ok(notMine.status === 404, 'another account cannot stop it', notMine.status);
  const c = await call('/v1/tasks/cancel', { id: 'job:' + first });
  ok(c.status === 200 && c.d.task.status === 'cancelled' && !c.d.task.cancellable, 'a step is stopped and says cancelled', c.d.task);
  const after = (await call('/v1/tasks')).d.tasks;
  const b = after.find(t => t.id === 'job:' + second);
  ok(b && b.status !== 'waiting' && /cancelled/.test(b.why || ''), 'and the step that waited on it is cancelled with it, saying why', b);
  let calls = 0; const real = globalThis.fetch; globalThis.fetch = async (...a) => { calls++; return real(...a); };
  const rec = JSON.parse(store.get('auto:' + ME)); rec.items.forEach(i => { if (i.next) i.next = Date.now() - 1000; }); store.set('auto:' + ME, JSON.stringify(rec));
  const d = await call('/v1/tasks/cancel', { id: 'job:' + daily.d.item.id });
  ok(d.status === 200 && d.d.task.status === 'paused', 'a repeating job is switched off, so it can be resumed', d.d.task && d.d.task.status);
  await W.runDueAutomations(env, Date.now());
  globalThis.fetch = real;
  ok(calls === 0, 'and after stopping, nothing runs and nothing is spent', calls);
  const again = await call('/v1/tasks/cancel', { id: 'job:' + first });
  ok(again.status === 409 && again.d.code === 'already_finished', 'stopping something already finished says so', again.status);
  const bad = await call('/v1/tasks/cancel', { id: 'nonsense' });
  ok(bad.status === 404, 'an id that is no task is refused', bad.status);
}

section('Batches of API requests are in the same list, and Stop works on them');
{
  /* A running batch (two waiting, one done), a finished one, and somebody
     else's - which this account must neither see nor stop. */
  const now = Date.now();
  const mk = (id, owner, status, items) => ({ id, owner, status, created: now - 60000, expiresAt: now + 864e5, items, ...(status === 'ended' ? { endedAt: now - 1000 } : {}) });
  const run = 'batch_' + 'a'.repeat(24), fin = 'batch_' + 'b'.repeat(24), other = 'batch_' + 'c'.repeat(24);
  await W.DB.put(env, 'batch', run, mk(run, ME, 'in_progress', [{ state: 'pending' }, { state: 'running' }, { state: 'done', result: 'succeeded' }]));
  await W.DB.put(env, 'batch', fin, mk(fin, ME, 'ended', [{ state: 'done', result: 'succeeded' }, { state: 'done', result: 'errored' }]));
  await W.DB.put(env, 'batch', other, mk(other, OTHER, 'in_progress', [{ state: 'pending' }]));
  await W.DB.put(env, 'batchidx', ME, [{ id: run }, { id: fin }, { id: other }]);
  const list = (await call('/v1/tasks')).d.tasks.filter(t => t.kind === 'batch');
  const r = list.find(t => t.id === 'batch:' + run), f = list.find(t => t.id === 'batch:' + fin);
  ok(list.length === 2 && !list.some(t => t.id === 'batch:' + other), 'both of mine are listed, and nobody else’s - even one named in my index', list.map(t => t.id));
  ok(r && r.status === 'running' && r.cancellable && r.title === '3 requests' && r.evidence.counts.processing === 2, 'a running batch says so, with what is still waiting', r);
  ok(f && f.status === 'done' && !f.cancellable && f.evidence.counts.errored === 1, 'a finished one is done, cannot be stopped, and says what failed', f);
  const stop = await call('/v1/tasks/cancel', { id: 'batch:' + run });
  ok(stop.status === 200 && stop.d.task.status === 'canceling' && !stop.d.task.cancellable, 'Stop turns a running batch to canceling', stop.d.task);
  const theirs = await call('/v1/tasks/cancel', { id: 'batch:' + other });
  ok(theirs.status === 404 && (await W.DB.get(env, 'batch', other)).status === 'in_progress', 'somebody else’s batch is not found, and keeps running', theirs.status);
}

if (report('all-background-work-is-one-list') > 0) process.exitCode = 1;
done();
