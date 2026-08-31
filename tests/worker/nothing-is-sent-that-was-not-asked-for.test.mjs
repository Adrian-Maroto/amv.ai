/* THE ROUTES THAT SPEAK TO OTHER PEOPLE, AND HAD NO TEST AT ALL.

   Mapped every route in the table against every test file: 159 routes, and
   three that no test has ever mentioned. None of them was broken - each turned
   out to be authenticated and rate limited when read - but two of the three
   send messages to real people, which is the category where being wrong is
   not recoverable by pressing undo:

     /v1/telegram/send   sends a Telegram message
     /v1/mail/message    reads one message out of a connected mailbox

   An untested route is not a broken route. It is a route whose guards nobody
   has watched work, which is a different thing and a worse one to discover
   later. The property that matters here is not "it sends" - it is that it
   does NOT send when it should not, so every case below checks what reached
   the outside world, not only what the response said. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'outward.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());

/* Everything AMV tried to send, so "did not send" is a fact rather than an
   inference from a status code. */
let outbound = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  outbound.push(u);
  if (/api\.telegram\.org/.test(u)) {
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(url, opts);
};

const mkEnv = (extra) => {
  const m = new Map();
  return Object.assign({
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: { idFromName: n => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0, count: 1 })); } }) },
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    /* A bot token is stored encrypted, and without a key the connect route
       refuses to store one at all rather than keeping it in the clear - which
       is the right answer and is why a fixture without this key could never
       reach the sending path. */
    MAIL_CRED_KEY: 'a-long-enough-test-key-0123456789abcdef',
  }, extra || {});
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
const call = (env, path, body, tok) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '5.5.5.5',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const jsonOf = async (r) => { try { return await r.json(); } catch (e) { return {}; } };

const env = mkEnv();
const EMAIL = 'sender@example.com';
const PW = 'A-real-Passw0rd!';
const token = (await jsonOf(await call(env, '/auth/signup', { email: EMAIL, name: 'S', password: PW }))).token;

section('A stranger cannot make AMV send anything');
{
  outbound = [];
  const r = await call(env, '/v1/telegram/send', { text: 'hello' });
  ok(r.status === 401, 'an unauthenticated Telegram send is refused', r.status);
  ok(outbound.filter(u => /telegram/.test(u)).length === 0,
     'and nothing left the building', outbound);

  outbound = [];
  const m = await call(env, '/v1/mail/message', { uid: 1 });
  ok(m.status === 401, 'nor can a stranger read a message out of a mailbox', m.status);
  ok(outbound.length === 0, 'with no outbound call either', outbound);
}

section('An account with nothing connected is told so, and still sends nothing');
{
  outbound = [];
  const r = await call(env, '/v1/telegram/send', { text: 'hello' }, token);
  const b = await jsonOf(r);
  ok(r.status === 428, 'a send with no bot connected is refused', r.status);
  ok(b.code === 'tg_not_connected', 'and says which thing is missing', b.code);
  ok(outbound.filter(u => /telegram/.test(u)).length === 0,
     'nothing was sent on the way to finding that out', outbound);

  outbound = [];
  const m = await jsonOf(await call(env, '/v1/mail/message', { uid: 1 }, token));
  ok(m.code === 'mail_not_connected', 'and a mailbox that was never connected says the same', m.code);
}

section('An empty message is refused before anything is attempted');
{
  outbound = [];
  const r = await call(env, '/v1/telegram/send', { text: '   ' }, token);
  const b = await jsonOf(r);
  ok(r.status === 400 && b.code === 'bad_body', 'whitespace is not a message', b.code);
  ok(outbound.filter(u => /telegram/.test(u)).length === 0, 'and nothing was sent', outbound);

  const m = await jsonOf(await call(env, '/v1/mail/message', { uid: 0 }, token));
  ok(m.code === 'bad_uid', 'and a message read needs to name a message', m.code);
}

section('A connected account really does send, so the refusals above mean something');
{
  /* Without this the section above passes for a product that can never send
     at all, which is the failure mode of every negative-only test.

     Connected through the real route rather than by writing the record. A
     first draft put a made-up row straight into storage under a guessed kind
     with a plain-text token, and the send still refused - correctly, because
     the record lives under a different name and holds an ENCRYPTED secret.
     The fixture was wrong in two ways at once, and going through the door
     everybody else uses cannot drift from the format the way a hand-written
     row does. */
  const conn = await call(env, '/v1/telegram/connect',
    { token: '123456789:AAHc-Test_Token_Value_1234567890', chatId: '12345' }, token);
  ok(conn.status === 200, 'the bot connects', conn.status);
  outbound = [];
  const r = await call(env, '/v1/telegram/send', { text: 'the real message' }, token);
  const b = await jsonOf(r);
  ok(r.status === 200 && b.sent === true, 'a connected account sends', b);
  const hit = outbound.find(u => /api\.telegram\.org/.test(u)) || '';
  ok(!!hit, 'and it really reached Telegram', hit.slice(0, 60));
  ok(/12345/.test(hit) || /12345/.test(decodeURIComponent(hit)),
     'addressed to the chat that was connected, not somewhere else', hit.slice(0, 90));
}

section('The rate limit on an outward-facing route is real');
{
  /* Thirty a minute. A route that speaks to other people is the one worth
     capping, and a cap nobody has watched work is a cap in name only. */
  /* The cap is turned on AFTER the account exists and its bot is connected.
     A first draft built the environment with the counter already refusing
     everything, so the signup inside it was rate limited too - the send then
     answered 401 for want of a token, and the test read that as the cap
     working. A refusal for the wrong reason is not the refusal being tested. */
  const permissive = env.AMV_COUNTER;
  outbound = [];
  env.AMV_COUNTER = { idFromName: n => n, get: () => ({ async fetch(_u, init) {
    const p = JSON.parse((init && init.body) || '{}');
    if (p.op === 'rateCheck') return new Response(JSON.stringify({ allowed: false, count: 999 }));
    return new Response(JSON.stringify({ allowed: true, value: 0 }));
  } }) };
  const r = await call(env, '/v1/telegram/send', { text: 'flood' }, token);
  env.AMV_COUNTER = permissive;
  ok(r.status === 429, 'over the cap, the send is refused', r.status);
  ok(outbound.filter(u => /telegram/.test(u)).length === 0,
     'and the message does not go out anyway', outbound);
}

globalThis.fetch = realFetch;
if (report('nothing-is-sent-that-was-not-asked-for') > 0) process.exitCode = 1;
done();
