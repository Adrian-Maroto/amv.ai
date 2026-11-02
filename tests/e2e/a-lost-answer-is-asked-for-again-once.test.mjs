/* A LOST ANSWER IS ASKED FOR AGAIN ONCE, UNDER THE SAME KEY (Nov 1 audit TASK-012).

   A write on a connected account carries one Idempotency-Key from the page.
   When the request got no answer at all - the connection dropped after the
   account may already have changed - the page asks once more with the SAME
   key, and the server (what-amv-did-can-be-taken-back) hands back the first
   answer instead of writing again. Any answer, even a refusal, is final. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

const run = (plan) => page.evaluate(async (plan) => {
  const bodies = [];
  const real = window.fetch;
  let n = 0;
  window.fetch = async (u, init) => {
    if (!/\/v1\/connect\/act/.test(String(u))) return real(u, init);
    bodies.push(JSON.parse(init.body));
    const step = plan[n++] || 'ok';
    if (step === 'drop') throw new TypeError('Failed to fetch');
    if (step === 'refuse') return new Response(JSON.stringify({ error: 'not_confirmed', message: 'Look first.' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ ok: true, result: { verified: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const live = AMV_API.live; AMV_API.live = true;
  const tok = AMV_API.token; AMV_API.token = AMV_API.token || 't';
  let out = null, err = null;
  try { out = await AMV_API.connectAct('slack.post', { channel: '#team', text: 'hi' }); } catch (e) { err = e.message; }
  window.fetch = real; AMV_API.live = live; AMV_API.token = tok;
  return { bodies, out, err };
}, plan);

section('An answer lost on the way back is asked for once more, with the same key');
{
  const r = await run(['drop', 'ok']);
  ok(r.bodies.length === 2, 'asked twice', r.bodies.length);
  const k = r.bodies[0] && r.bodies[0].idempotencyKey;
  ok(/^[A-Za-z0-9_-]{16,80}$/.test(k || '') && r.bodies[1].idempotencyKey === k, 'under one key the server accepts, the same both times', r.bodies.map(b => b.idempotencyKey));
  ok(r.out && r.out.ok === true && !r.err, 'and the second answer is the one used', r);
}

section('Any answer is final - a refusal is not asked again');
{
  const r = await run(['refuse']);
  ok(r.bodies.length === 1 && /Look first/.test(r.err || ''), 'one request, and the refusal said', r);
}

section('Two separate writes have separate keys');
{
  const a = await run(['ok']); const b = await run(['ok']);
  ok(a.bodies[0].idempotencyKey !== b.bodies[0].idempotencyKey, 'a new key for each write', [a.bodies[0].idempotencyKey, b.bodies[0].idempotencyKey]);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors);

await app.close();
if (report('a-lost-answer-is-asked-for-again-once') > 0) process.exitCode = 1;
done();
