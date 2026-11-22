/* AN EMAIL THAT COULD NOT GO IS SENT LATER - OR SAID TO HAVE FAILED.

   Scale audit, Oct 26. A send that met a network fault or a busy provider
   was simply lost: no retry, nothing kept. Now:
     - a temporary failure is tried again at once, with the SAME idempotency
       key, so an unknown outcome cannot become two emails;
     - mail that can arrive late and still be right (a job's result, a
       message, a task, the owner's digest) waits in an outbox the five-minute
       tick retries on a growing schedule;
     - a sign-in code or password reset is never queued: it expires, and a
       late copy of an old code is confusion;
     - a permanent refusal is not retried;
     - after the last step it gives up and the operator is told;
     - the outbox is erased with the account. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'outbox.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _sendEmail, _outboxDrain, EMAIL_OUTBOX_BACKOFF_MS, queueHandler };\n');
const W = await import(harness + '?t=' + Date.now());

let plan = [], posts = [], alerts = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (/resend/.test(u)) {
    posts.push({ idem: (init.headers || {})['Idempotency-Key'], body: JSON.parse(init.body) });
    const next = plan.length ? plan.shift() : 200;
    if (next === 'net') throw new Error('network down');
    return new Response(next === 200 ? '{"id":"x"}' : '{"message":"busy"}', { status: next });
  }
  if (/alert/.test(u)) { alerts.push(JSON.parse(init.body || '{}')); return new Response('{}'); }
  return new Response('{}');
};
/* The store lists as the real one does: byte order, at most 1,000 a page,
   a cursor that resumes after the last key, and each key's metadata. */
const mkEnv = () => { const m = new Map(), md = new Map(); return { EMAIL_API_KEY: 're_test', RESET_EMAIL_FROM: 'AMV <hi@amv.test>', ALERT_WEBHOOK: 'https://alert.example/hook',
  AMV_KV: { _m: m, _md: md, async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, o) { m.set(k, String(v)); if (o && o.metadata) md.set(k, o.metadata); else md.delete(k); },
    async delete(k) { m.delete(k); md.delete(k); },
    async list({ prefix, limit, cursor } = {}) {
      const after = cursor ? Buffer.from(cursor, 'base64url').toString() : null;
      const all = [...m.keys()].filter(k => (!prefix || k.startsWith(prefix)) && (after === null || k > after)).sort();
      const n = Math.max(1, Math.min(1000, limit || 1000));
      const keys = all.slice(0, n).map(name => md.has(name) ? { name, metadata: md.get(name) } : { name });
      return all.length > n ? { keys, list_complete: false, cursor: Buffer.from(keys[n - 1].name).toString('base64url') } : { keys, list_complete: true };
    } } }; };
const outbox = (env) => [...env.AMV_KV._m.keys()].filter(k => k.startsWith('outbox:'));
const send = (env, cls) => W._sendEmail(env, 'ana@example.com', 'Your job finished', '<p>done</p>', 'done', cls);

section('A busy provider: tried again at once, with the same key');
{
  const env = mkEnv(); plan = [503, 200]; posts = [];
  ok(await send(env, 'auto') === true, 'the second try goes through and the send is reported sent');
  ok(posts.length === 2 && posts[0].idem && posts[0].idem === posts[1].idem, 'two posts, one idempotency key - one email at most', posts.map(p => p.idem));
  ok(outbox(env).length === 0, 'nothing is left waiting');
}

section('Still down: job mail waits in the outbox, and is not called sent');
{
  const env = mkEnv(); plan = ['net', 'net']; posts = [];
  ok(await send(env, 'auto') === false, 'the caller is told it did not go - now');
  const keys = outbox(env);
  ok(keys.length === 1 && keys[0].startsWith('outbox:ana@example.com:'), 'it is in the outbox, under the person\'s address', keys);
  const firstIdem = posts[0].idem;
  /* Not due yet: nothing is sent. */
  plan = []; posts = [];
  let r = await W._outboxDrain(env, Date.now());
  ok(r.sent === 0 && posts.length === 0, 'before its time, the tick leaves it', r);
  r = await W._outboxDrain(env, Date.now() + W.EMAIL_OUTBOX_BACKOFF_MS[0] + 1000);
  ok(r.sent === 1 && posts.length === 1 && posts[0].idem === firstIdem, 'when due, it is sent - with the key it was first tried with', { r, idem: posts[0] && posts[0].idem });
  ok(outbox(env).length === 0, 'and removed');
}

section('A long outage: mail further down the alphabet is still reached');
{
  /* 1,200 emails to addresses that sort first, all waiting on their backoff,
     and one to an address near the end that is due. The tick used to read the
     first fifty keys and stop, so the due one was never tried. */
  const env = mkEnv(); const now = Date.now();
  for (let i = 0; i < 1200; i++) {
    const key = 'outbox:a' + String(i).padStart(5, '0') + '@example.com:' + i;
    await env.AMV_KV.put(key, JSON.stringify({ id: String(i), idem: 'amv-w' + i, to: 'a' + i + '@example.com', subject: 's', html: 'h', text: 't', cls: 'auto', attempts: 3, next: now + 3600000, at: now }), { metadata: { next: now + 3600000 } });
  }
  await env.AMV_KV.put('outbox:zed@example.com:z1', JSON.stringify({ id: 'z1', idem: 'amv-z1', to: 'zed@example.com', subject: 'Your job finished', html: 'h', text: 't', cls: 'auto', attempts: 2, next: now - 1000, at: now - 400000 }), { metadata: { next: now - 1000 } });
  /* And one written before keys carried their next try: it counts as due. */
  await env.AMV_KV.put('outbox:zoe@example.com:z2', JSON.stringify({ id: 'z2', idem: 'amv-z2', to: 'zoe@example.com', subject: 'A message', html: 'h', text: 't', cls: 'message', attempts: 2, next: now - 1000, at: now - 400000 }));
  plan = []; posts = [];
  const r = await W._outboxDrain(env, now);
  const to = posts.map(p => [].concat(p.body.to)[0]);
  ok(to.includes('zed@example.com'), 'the due email past the first page is sent', { r, to });
  ok(to.includes('zoe@example.com'), 'and one from before the metadata is tried too', to);
  ok(posts.length === 2 && r.waiting === 1200, 'while the 1,200 not yet due are passed over without a send', { posts: posts.length, waiting: r.waiting });
  ok(!env.AMV_KV._m.has('outbox:zed@example.com:z1'), 'and the sent one is gone from the outbox');
}

section('A retry keeps its next try on the key, so the next tick can pass it over');
{
  const env = mkEnv(); plan = ['net', 'net']; posts = [];
  await send(env, 'auto');
  const key = outbox(env)[0];
  ok(env.AMV_KV._md.get(key) && env.AMV_KV._md.get(key).next > Date.now(), 'the queued email carries its next try as metadata', env.AMV_KV._md.get(key));
  plan = [503]; posts = [];
  const later = Date.now() + W.EMAIL_OUTBOX_BACKOFF_MS[0] + 1000;
  await W._outboxDrain(env, later);
  const md = env.AMV_KV._md.get(key);
  ok(posts.length === 1 && md && md.next > later, 'and after a failed retry the key names the new time', md);
}

section('With the job queue bound, a waiting email is tried when it is due, not at the next tick');
{
  const env = mkEnv(); const q = []; env.AMV_JOBS = { async sendBatch(msgs) { q.push(...msgs); } };
  plan = ['net', 'net']; posts = [];
  await send(env, 'done');
  const key = outbox(env)[0];
  ok(q.length === 1 && q[0].body.kind === 'outbox' && q[0].body.key === key && q[0].delaySeconds === W.EMAIL_OUTBOX_BACKOFF_MS[0] / 1000,
     'a message names the waiting email, due at its first retry', q);
  ok(Object.keys(q[0].body).sort().join() === 'key,kind', 'the message names the record and carries none of the mail - erasing the account erases the email', q[0].body);
  const msg = (body) => ({ body, attempts: 1, acked: false, retried: null, ack() { this.acked = true; }, retry(o) { this.retried = o; } });
  /* Early: the queue delivered before the email was due - booked again for the time left, nothing sent. */
  let m = msg(q[0].body); q.length = 0; posts = [];
  await W.queueHandler({ queue: 'amv-jobs', messages: [m] }, env);
  ok(m.acked && posts.length === 0 && q.length === 1 && q[0].delaySeconds > 0, 'not due yet: nothing sent, and booked for when it is', { posts: posts.length, q });
  /* Due, provider still down: retried on the queue at the next step, the record says so. */
  const rec = JSON.parse(env.AMV_KV._m.get(key)); rec.next = Date.now() - 1; env.AMV_KV._m.set(key, JSON.stringify(rec));
  m = msg({ kind: 'outbox', key }); q.length = 0; plan = [503];
  await W.queueHandler({ queue: 'amv-jobs', messages: [m] }, env);
  ok(m.acked && JSON.parse(env.AMV_KV._m.get(key)).attempts === 3 && q.length === 1 && q[0].delaySeconds === W.EMAIL_OUTBOX_BACKOFF_MS[1] / 1000,
     'still down: the next try is booked on the queue', q);
  /* Due, provider back: sent once, with the key it always had; the record is gone. */
  const r2 = JSON.parse(env.AMV_KV._m.get(key)); r2.next = Date.now() - 1; env.AMV_KV._m.set(key, JSON.stringify(r2));
  m = msg({ kind: 'outbox', key }); q.length = 0; plan = [200]; posts = [];
  await W.queueHandler({ queue: 'amv-jobs', messages: [m] }, env);
  ok(m.acked && posts.length === 1 && posts[0].idem === r2.idem && outbox(env).length === 0, 'back up: sent once, under the same idempotency key, and gone from the outbox');
  /* A pointer to an email that is gone (sent by the tick, or erased with the account) sends nothing. */
  m = msg({ kind: 'outbox', key }); posts = [];
  await W.queueHandler({ queue: 'amv-jobs', messages: [m] }, env);
  ok(m.acked && posts.length === 0, 'a message whose email is gone sends nothing');
  /* A pointer that died on the queue leaves the email where the tick will send it. */
  plan = ['net', 'net']; await send(env, 'done');
  const k2 = outbox(env)[0];
  m = msg({ kind: 'outbox', key: k2 });
  await W.queueHandler({ queue: 'amv-jobs-dead', messages: [m] }, env);
  ok(m.acked && outbox(env).includes(k2), 'a dead message loses nothing: the email is still waiting for the tick');
  /* Automations switched off does not hold mail somebody is owed. */
  env.AMV_KV._m.set('switch:feature:automations', JSON.stringify({ off: true }));
  const r3 = JSON.parse(env.AMV_KV._m.get(k2)); r3.next = Date.now() - 1; env.AMV_KV._m.set(k2, JSON.stringify(r3));
  m = msg({ kind: 'outbox', key: k2 }); plan = [200]; posts = [];
  await W.queueHandler({ queue: 'amv-jobs', messages: [m] }, env);
  ok(posts.length === 1 && !outbox(env).includes(k2), 'and mail is not new work: it goes even with automations paused');
}

section('A sign-in code is never queued');
{
  const env = mkEnv(); plan = ['net', 'net']; posts = [];
  ok(await send(env, 'signin') === false, 'it did not go, and says so');
  ok(outbox(env).length === 0, 'and nothing waits to deliver an expired code later');
  plan = [503, 503];
  await send(env, 'security');
  ok(outbox(env).length === 0, 'nor a password reset');
}

section('A permanent refusal is not retried');
{
  const env = mkEnv(); plan = [422]; posts = [];
  ok(await send(env, 'auto') === false && posts.length === 1, 'one try, no retry', posts.length);
  ok(outbox(env).length === 0, 'and nothing queued');
}

section('After the last step, it gives up - and the operator is told');
{
  const env = mkEnv(); plan = ['net', 'net']; posts = []; alerts = [];
  await send(env, 'task');
  let t = Date.now();
  let gaveUp = 0;
  for (let i = 0; i < 10 && outbox(env).length; i++) {
    t += 7 * 3600 * 1000;                      // past every backoff
    plan = ['net'];
    const r = await W._outboxDrain(env, t);
    gaveUp += r.gaveUp;
  }
  ok(gaveUp === 1 && outbox(env).length === 0, 'it stops trying after the last step', { gaveUp, left: outbox(env).length });
  ok(alerts.length >= 1, 'and the operator is alerted', alerts.length);
}

if (report('an-email-that-could-not-go-is-sent-later') > 0) process.exitCode = 1;
done();
