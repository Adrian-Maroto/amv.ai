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
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _sendEmail, _outboxDrain, EMAIL_OUTBOX_BACKOFF_MS };\n');
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
const mkEnv = () => { const m = new Map(); return { EMAIL_API_KEY: 're_test', RESET_EMAIL_FROM: 'AMV <hi@amv.test>', ALERT_WEBHOOK: 'https://alert.example/hook',
  AMV_KV: { _m: m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, String(v)); }, async delete(k) { m.delete(k); },
    async list({ prefix, limit } = {}) { const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })); return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true }; } } }; };
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
