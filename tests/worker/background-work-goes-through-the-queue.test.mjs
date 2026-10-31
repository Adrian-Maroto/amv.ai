/* BACKGROUND WORK GOES THROUGH THE QUEUE, WHEN THERE IS ONE.

   Oct 31 production audit, "Queue infrastructure": the cron tick runs every
   account with work due in turn inside one 25-second budget, which stops
   fitting as the population grows. With the AMV_JOBS queue bound
   (15a-job-queue.js), the tick sends one message per due account and each
   runs in a consumer of its own. What has to be true, against the Worker:
     - with no queue, nothing changes: the tick runs the job itself;
     - with a queue, the tick sends one message per due account and runs
       nothing itself; a second tick a moment later does not send it again;
     - the queue failing to take a message never costs a job: the tick runs
       that account itself, and says so to the operator;
     - the consumer runs the account's due job once - a message delivered
       twice does not run it twice;
     - the kill switch and a paused account stop the consumer too;
     - a run that throws is retried with a growing delay; one that reaches
       the dead-letter queue is alerted on and booked for the hourly sweep. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'jobqueue.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { runDueAutomations, issueTokens };
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'ada@test.com', TWO = 'cy@test.com';
const store = new Map();
const audits = [];
const origLog = console.log;
console.log = (...a) => { const s = a.join(' '); if (s.startsWith('AUDIT')) { try { audits.push(JSON.parse(s.slice(6))); } catch (e) {} return; } if (/^\[queue\]/.test(s)) return; origLog(...a); };
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  AMV_MODEL_KEY: 'k', AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k, v){ store.set(k, v); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
const ctx = { waitUntil(){}, passThroughOnException(){} };

for (const em of [ME, TWO]) store.set('ent:' + em, JSON.stringify({ plan: 'ultra' }));
const toks = { [ME]: await W.issueTokens(env, ME, 'Ada'), [TWO]: await W.issueTokens(env, TWO, 'Cy') };
let ip = 1;
const call = async (path, body, who = ME) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + toks[who].token, Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.7.' + (ip++) },
    body: JSON.stringify(body || {}) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const rec = (em) => JSON.parse(store.get('auto:' + em) || '{"items":[],"results":[]}');
const due = (em) => { const r = rec(em); r.items.forEach(i => { if (i.active) i.next = Date.now() - 1000; }); store.set('auto:' + em, JSON.stringify(r)); };

let modelCalls = 0;
globalThis.fetch = async () => {
  modelCalls++;
  return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Three things changed this week.' }], stop_reason: 'end_turn',
    usage: { input_tokens: 2000, output_tokens: 800 } }), { status: 200 });
};

/* The queue, standing in: it records every message, and can be told to
   refuse. Messages are handed to the consumer the way the provider does. */
const sent = [];
let refuse = false;
const QUEUE = { async sendBatch(msgs) { if (refuse) throw new Error('queue unavailable'); sent.push(...msgs.map(m => m.body)); } };
const message = (body, attempts = 1) => {
  const m = { body, attempts, acked: false, retried: null };
  m.ack = () => { m.acked = true; }; m.retry = (o) => { m.retried = o || {}; };
  return m;
};
const deliver = async (bodies, queue = 'amv-jobs', attempts = 1) => {
  const messages = bodies.map(b => message(b, attempts));
  await W.default.queue({ queue, messages }, env, ctx);
  return messages;
};

for (const em of [ME, TWO]) {
  const r = await call('/auto/create', { detail: 'Brief me on solar energy news', repeat: 'daily', approval: 'auto' }, em);
  if (r.status !== 200) origLog('create failed', r.status, JSON.stringify(r.d).slice(0, 200));
}

section('With no queue, nothing changes: the tick runs the work itself');
{
  due(ME); due(TWO); modelCalls = 0;
  const r = await W.runDueAutomations(env, Date.now());
  ok(modelCalls >= 2 && r.ran >= 2 && !r.enqueued, 'both accounts’ jobs ran in the tick', { modelCalls, r });
}

section('With a queue, the tick sends one message per due account and runs nothing itself');
{
  env.AMV_JOBS = QUEUE;
  due(ME); due(TWO); modelCalls = 0; sent.length = 0;
  const r = await W.runDueAutomations(env, Date.now() + 10);
  ok(modelCalls === 0 && r.ran === 0, 'the tick spent nothing', { modelCalls, ran: r.ran });
  ok(sent.length === 2 && new Set(sent.map(b => b.email)).size === 2 && r.enqueued === 2, 'one message for each account', sent);
  const again = await W.runDueAutomations(env, Date.now() + 20);
  ok(sent.length === 2 && !again.enqueued, 'a second tick a moment later does not send them again', sent.length);
}

section('The consumer runs the account’s due job, once');
{
  modelCalls = 0;
  const msgs = await deliver([sent.find(b => b.email === ME)]);
  ok(modelCalls >= 1 && msgs[0].acked, 'the job ran and the message was acknowledged', { modelCalls, acked: msgs[0].acked });
  ok(rec(ME).items[0].next > Date.now() && rec(ME).results.length >= 2, 'its next run moved on, and its result is kept', rec(ME).items[0].next);
  modelCalls = 0;
  const twice = await deliver([sent.find(b => b.email === ME)]);
  ok(modelCalls === 0 && twice[0].acked, 'the same message delivered again runs nothing', modelCalls);
}

section('The kill switch and a paused account stop the consumer too');
{
  store.set('GLOBAL_KILL', '1'); modelCalls = 0;
  const k = await deliver([sent.find(b => b.email === TWO)]);
  ok(modelCalls === 0 && k[0].acked && !k[0].retried, 'killed: nothing runs, and it is not retried', { modelCalls });
  ok(rec(TWO).items[0].next <= Date.now(), 'and the job keeps its place for after', rec(TWO).items[0].next);
  store.delete('GLOBAL_KILL');
  const r = rec(TWO); r.paused = true; store.set('auto:' + TWO, JSON.stringify(r)); modelCalls = 0;
  const p = await deliver([{ email: TWO }]);
  ok(modelCalls === 0 && p[0].acked, 'a paused account runs nothing', modelCalls);
  r.paused = false; store.set('auto:' + TWO, JSON.stringify(r));
}

section('A queue that will not take the message never costs a job');
{
  refuse = true; due(TWO); modelCalls = 0; audits.length = 0;
  const r = await W.runDueAutomations(env, Date.now() + 10 * 60 * 1000);
  ok(modelCalls >= 1 && r.ran >= 1, 'the tick ran the account itself', { modelCalls, r });
  ok(audits.some(a => a.event === 'auto_queue_send_failed'), 'and it is on the record that the queue refused', audits.map(a => a.event));
  refuse = false;
}

section('A run that throws is retried, later each time; a dead letter is booked for the sweep');
{
  const realGet = env.AMV_KV.get;
  env.AMV_KV.get = async (k) => { if (k === 'auto:' + ME) throw new Error('store hiccup'); return realGet(k); };
  const first = await deliver([{ email: ME }], 'amv-jobs', 1);
  const third = await deliver([{ email: ME }], 'amv-jobs', 3);
  env.AMV_KV.get = realGet;
  ok(!first[0].acked && first[0].retried && first[0].retried.delaySeconds > 0, 'not acknowledged: retried with a delay', first[0].retried);
  ok(third[0].retried.delaySeconds > first[0].retried.delaySeconds, 'and a longer one each attempt', [first[0].retried.delaySeconds, third[0].retried.delaySeconds]);
  audits.length = 0;
  /* The due-work index (duehour:<hour>) emptied first, so what is in it
     afterwards was put there by the dead letter. */
  for (const k of [...store.keys()]) if (k.startsWith('duehour:')) store.delete(k);
  const dead = await deliver([{ email: ME }], 'amv-jobs-dead', 5);
  ok(dead[0].acked && audits.some(a => a.event === 'auto_queue_dead' && a.email === ME), 'the dead letter is acknowledged and on the record', audits.map(a => a.event));
  const booked = [...store.keys()].filter(k => k.startsWith('duehour:') && String(store.get(k)).includes(ME));
  ok(booked.length >= 1, 'and the account is booked into the due-work index for the next sweep', booked);
}

console.log = origLog;
if (report('background-work-goes-through-the-queue') > 0) process.exitCode = 1;
done();
