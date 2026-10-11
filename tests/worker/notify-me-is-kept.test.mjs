/* NOTIFY ME IS KEPT.

   Somebody presses Notify me on an app AMV cannot connect yet. When it can,
   the operator presses one button and each of them is told - by email, once.

   - only the operator can send it, and only with email really set up;
   - the app's name must be a plain name - it goes in front of the people who
     asked for it;
   - everybody who asked for THAT app is emailed, and nobody else;
   - a send that went through takes the person off the list; one that failed
     keeps them on it, and the next press reaches them;
   - a second press never emails anybody twice. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, '..', '..', 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'notifyme.harness.mjs');
writeFileSync(harness, src + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

/* The email provider: records each send, and refuses the addresses listed. */
const mails = []; let refuse = new Set();
globalThis.fetch = async (url, init) => {
  if (/api\.resend\.com/.test(String(url))) {
    const b = JSON.parse(init.body); const to = b.to[0];
    if (refuse.has(to)) return { ok: false, status: 500, text: async () => 'down', json: async () => ({}) };
    mails.push({ to, subject: b.subject, html: b.html, text: b.text });
    return { ok: true, status: 200, text: async () => '', json: async () => ({ id: 'm' }) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv(extra) {
  const m = new Map(), vals = new Map();
  return Object.assign({
    JWT_SECRET: 'j', ADMIN_TOKEN: 'the-admin-token-value', APP_URL: 'https://amv.test',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).sort().map(name => ({ name }));
        const from = cursor ? +cursor : 0; const page = all.slice(from, from + (limit || 1000));
        return { keys: page, list_complete: from + page.length >= all.length, cursor: String(from + page.length) };
      },
    },
    AMV_COUNTER: { idFromName: (n) => n, get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
      if (b.op === 'reserve') { if (b.cap != null && cur + b.amount > b.cap) return r({ allowed: false, value: cur }); vals.set(n, cur + b.amount); return r({ allowed: true, value: cur + b.amount }); }
      if (b.op === 'claim') { if (vals.has('c:' + n)) return r({ claimed: false }); vals.set('c:' + n, 1); return r({ claimed: true, owner: 'o' }); }
      if (b.op === 'release') { vals.delete('c:' + n); return r({ ok: true }); }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return r({ value: vals.get(n) }); }
      return r({ allowed: true, value: cur });
    } }) },
  }, extra || {});
}
const ctx = { waitUntil(p) { if (p) Promise.resolve(p).catch(() => {}); }, passThroughOnException() {} };
const tell = async (env, body, tok = 'the-admin-token-value') => {
  const r = await worker.fetch(new Request('https://api.amv.test/v1/admin/waitlist/notify', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '7.7.7.7', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) }), env, ctx);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const asked = (env, slug, email) => env.AMV_KV.put(`waitlist:app-${slug}:${email}`, JSON.stringify({ email, product: 'app-' + slug, ts: 1 }));

section('Only the operator, and only when email can really reach people');
{
  const env = mkEnv();
  await asked(env, 'notion', 'ann@example.com');
  const stranger = await tell(env, { app: 'notion', name: 'Notion' }, 'wrong-token');
  ok(stranger.status === 403 && mails.length === 0, 'a wrong token is refused and nobody is emailed', stranger.status);
  const noMail = await tell(env, { app: 'notion', name: 'Notion' });
  ok(noMail.status === 503 && noMail.body.code === 'needs_service' && mails.length === 0, 'without email set up it says so, and sends nothing', noMail.body);
  const env2 = mkEnv({ EMAIL_API_KEY: 'k', RESET_EMAIL_FROM: 'AMV <hi@amv.test>' });
  const markup = await tell(env2, { app: 'notion', name: '<img src=x>Notion' });
  ok(markup.status === 400 && mails.length === 0, 'a name with markup in it is refused', markup.status);
  const badSlug = await tell(env2, { app: '../notion', name: 'Notion' });
  ok(badSlug.status === 400, 'and so is anything but a plain app slug', badSlug.status);
}

section('Everybody who asked for that app is told, once; failures wait for the next press');
{
  const env = mkEnv({ EMAIL_API_KEY: 'k', RESET_EMAIL_FROM: 'AMV <hi@amv.test>' });
  for (const e of ['ann@example.com', 'ben@example.com', 'cat@example.com']) await asked(env, 'notion', e);
  await asked(env, 'linear', 'dan@example.com');
  mails.length = 0; refuse = new Set(['cat@example.com']);
  const first = await tell(env, { app: 'notion', name: 'Notion' });
  ok(first.body.ok && first.body.sent === 2 && first.body.failed === 1, 'two told, one could not be reached', first.body);
  ok(mails.every(m => /Notion/.test(m.subject) && /#\/integrations/.test(m.html) && /only email about it/.test(m.text)), 'each says what connects, where, and that it is the only email', mails.map(m => m.subject));
  ok(!mails.some(m => m.to === 'dan@example.com'), 'somebody who asked for a different app is not emailed');
  const left = [...env.AMV_KV._map.keys()].filter(k => k.startsWith('waitlist:app-notion:'));
  ok(left.length === 1 && left[0].endsWith('cat@example.com'), 'those told are off the list; the one not reached is still on it', left);

  mails.length = 0; refuse = new Set();
  const second = await tell(env, { app: 'notion', name: 'Notion' });
  ok(second.body.sent === 1 && mails.length === 1 && mails[0].to === 'cat@example.com', 'the next press reaches only the one who was missed', { sent: second.body.sent, to: mails.map(m => m.to) });

  mails.length = 0;
  await asked(env, 'notion', 'ann@example.com');   /* asked again after being told */
  const third = await tell(env, { app: 'notion', name: 'Notion' });
  ok(mails.length === 0 && third.body.sent === 0, 'and nobody is ever emailed twice about the same app', { sent: third.body.sent, mails: mails.length });
}

report('notify-me-is-kept');
done();
