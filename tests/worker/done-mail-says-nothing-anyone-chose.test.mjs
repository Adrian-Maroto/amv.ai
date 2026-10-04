/* "EMAIL ME WHEN AMV IS DONE" SAYS NOTHING ANYBODY CHOSE.

   Asked for: "get notified when AMV is done - if they say yes, AMV sends them
   an email when done". The page asks; this route sends.

   Signing up does not prove you own the address, so any email AMV sends on
   request can be aimed at a stranger by creating an account in their name.
   So this route takes no recipient (the account's own address, always), sends
   one fixed message (nothing from the request reaches the email - not a
   title, not a word), and has its own daily budget per address. Each of those
   is checked here by trying to break it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'donemail.harness.mjs');
writeFileSync(harness, src + '\nexport { EMAIL_DAY_CAP };\n');
const W = await import(harness + '?t=' + Date.now());

const PW = 'A-real-Passw0rd!';
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url && url.url ? url.url : url);
  if (/api\.resend\.com/.test(u)) { sent.push(JSON.parse(String(opts.body || '{}'))); return new Response('{"id":"x"}', { status: 200 }); }
  return new Response('{}', { status: 200 });
};

function mkEnv(extra) {
  const m = new Map(); const vals = new Map();
  return Object.assign({
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
    },
    AMV_COUNTER: { idFromName: (n) => n, get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
      if (b.op === 'reserve') {
        if (b.cap != null && cur + Number(b.amount) > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
        vals.set(n, cur + Number(b.amount)); return new Response(JSON.stringify({ allowed: true, value: cur + Number(b.amount) }));
      }
      if (b.op === 'rateCheck') return new Response(JSON.stringify({ allowed: true }));
      return new Response(JSON.stringify({ allowed: true, value: cur }));
    } }) },
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
  }, extra || {});
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
let ip = 10;
const req = (env, path, body, tok) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '44.44.44.' + (ip++ % 250),
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const jsonOf = async (r) => { try { return await r.json(); } catch (e) { return {}; } };
const signup = async (env, email) => (await jsonOf(await req(env, '/auth/signup', { email, name: 'X', password: PW }))).token;

section('It needs an account');
{
  const env = mkEnv({ EMAIL_API_KEY: 'k' });
  const r = await req(env, '/v1/notify/done', { ok: true });
  ok(r.status === 401, 'no account, no email', r.status);
  ok(sent.length === 0, 'and nothing was sent', sent.length);
}

section('Asking whether it can work says so, and sends nothing');
{
  const off = mkEnv({});
  const t1 = await signup(off, 'a@example.com');
  const p1 = await jsonOf(await req(off, '/v1/notify/done', { probe: true }, t1));
  ok(p1.ok && p1.emailReady === false && !p1.sent, 'with no email provider: not ready', p1);
  const n1 = await jsonOf(await req(off, '/v1/notify/done', { ok: true }, t1));
  ok(n1.sent === false, 'and a send is refused rather than pretended', n1);
  const on = mkEnv({ EMAIL_API_KEY: 'k' });
  const t2 = await signup(on, 'b@example.com');
  const before = sent.length;
  const p2 = await jsonOf(await req(on, '/v1/notify/done', { probe: true }, t2));
  ok(p2.emailReady === true && sent.length === before, 'with one: ready, and the question itself mails nobody', { p2, mailed: sent.length - before });
}

section('It goes to the account, says a fixed thing, and nothing the caller sent');
{
  const env = mkEnv({ EMAIL_API_KEY: 'k' });
  const tok = await signup(env, 'owner@example.com');
  sent.length = 0;
  const evil = 'BUY CHEAP <a href="https://evil.example">click</a>';
  const r = await jsonOf(await req(env, '/v1/notify/done',
    { ok: true, title: evil, to: 'victim@example.com', subject: evil, text: evil, kind: evil }, tok));
  ok(r.sent === true && sent.length === 1, 'one email', { r, n: sent.length });
  const m = sent[0] || {};
  ok(JSON.stringify(m.to) === JSON.stringify(['owner@example.com']), 'to the account’s own address - a "to" in the request is ignored', m.to);
  ok(m.subject === 'AMV is done', 'with the fixed subject', m.subject);
  const all = JSON.stringify(m);
  ok(!/BUY CHEAP|evil\.example|victim/.test(all), 'and not one word of what the caller sent', all.slice(0, 200));
  sent.length = 0;
  await req(env, '/v1/notify/done', { ok: false }, tok);
  ok((sent[0] || {}).subject === 'AMV stopped before it finished', 'a failure is said as a failure', (sent[0] || {}).subject);
}

section('It has its own daily budget per address');
{
  const env = mkEnv({ EMAIL_API_KEY: 'k' });
  const tok = await signup(env, 'many@example.com');
  sent.length = 0;
  const cap = W.EMAIL_DAY_CAP.done;
  ok(cap > 0 && cap <= 30, 'a small, declared cap', cap);
  let last = null;
  for (let i = 0; i < cap + 5; i++) last = await jsonOf(await req(env, '/v1/notify/done', { ok: true }, tok));
  ok(sent.length === cap, 'exactly the cap is sent, however many times it is asked', { sent: sent.length, cap });
  ok(last && last.sent === false, 'and the rest are refused', last);
}

globalThis.fetch = realFetch;
report();
done();
