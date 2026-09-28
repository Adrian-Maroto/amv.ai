/* A SYNC NOBODY CAN ARBITRATE IS TOLD TO THE OPERATOR, ONCE, AND TOLD RIGHT.

   Without a D1 binding, a sync push is merged rather than arbitrated. That was
   reported as an error from every visitor's browser - one Sentry issue gaining
   an event per page load - and the advice it carried was "bind DB in
   wrangler.toml", the one step that must not be taken as written: DB.get reads
   D1 alone the moment it is bound, so every account still in KV would read as
   missing. Measured here by driving the real route: the operator is alerted,
   once for many pushes, and the alert warns against the dangerous step. */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = (await import(join(ROOT, 'amv-backend.js') + '?sync-told=' + Date.now())).default;
const outbound = makeOutbound();
outbound.on(/hooks\.example/, () => ({ ok: true }));
outbound.on(/resend|mail|sendgrid|postmark/i, () => ({ id: 'e1' }));
const env = makeEnv({ ALERT_WEBHOOK: 'https://hooks.example/amv' });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const call = async (path, body, token) => {
  const r = await worker.fetch(new Request('https://api.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body) }), env, ctx);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

section('A deployment with no D1 says so to the operator, once');
{
  const s = await call('/auth/signup', { email: 'kim@example.com', password: 'A-real-Passw0rd!', name: 'Kim' });
  ok(s.status === 200 && s.body.token, 'an account to sync for', s.status);
  const pushes = [];
  for (let i = 0; i < 5; i++) pushes.push(await call('/sync/push', { data: { memory: ['note ' + i] }, baseRev: 0 }, s.body.token));
  ok(pushes.every(p => p.status === 200 && p.body.ok && p.body.guarded === false), 'every push still saves, and says it was not arbitrated', pushes.map(p => p.status));
  const alerts = outbound.calls.filter(c => /hooks\.example/.test(c.url) && /arbitrated/.test(c.body));
  ok(alerts.length === 1, 'the operator is told once for five pushes, not five times', alerts.length);
  const text = alerts.map(a => a.body).join(' ');
  ok(/do NOT just bind/.test(text) && /read as missing/.test(text), 'and told not to bind D1 before a migration, because every account would read as missing', text.slice(0, 240));
}

report();
done();
