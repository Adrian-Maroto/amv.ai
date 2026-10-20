/* A LOCKED API STILL ANSWERS THE WIDGET AND API KEYS.

   ALLOWED_ORIGIN locks the browser API to the deployment's own site, which is
   what lets it keep the session in an HttpOnly cookie. It used to lock out the
   two callers that are cross-site by design: every response was stamped "only
   <the site> may read this", so the website widget on a customer's site had
   its config and every answer refused by the visitor's browser, and a page
   calling with an API key was refused too (outside audit, 2026-10-20).

   Now, on a locked deployment:
   - a session route answers only the site, with credentials - a stranger's
     page still cannot read it;
   - the widget's routes answer as their handlers decide: the customer's site
     where the widget is allowed, and not a site where it is not;
   - a request carrying an API key is answered to anyone, never with
     credentials - and so is another page's preflight, which carries no key
     to look at yet;
   and an open deployment is unchanged. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'corslock.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());

const SITE = 'https://amv.example', THEIRS = 'https://theircompany.example', STRANGER = 'https://attacker-blog.example';
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}\n\n'
  + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Open 9 to 5."}}\n\ndata: {"type":"message_stop"}\n\n',
  { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
function mkEnv(extra) {
  const m = new Map();
  return Object.assign({ JWT_SECRET: 'j'.repeat(40), APP_URL: SITE, AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    AMV_KV: { async get(k){ return m.has(k) ? m.get(k) : null; }, async put(k, v){ m.set(k, v); }, async delete(k){ m.delete(k); },
      async list({ prefix } = {}){ return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  }, extra || {});
}
const ctx = { waitUntil(){}, passThroughOnException(){} };
const hit = async (env, method, path, { origin, auth, body } = {}) => {
  const r = await W.default.fetch(new Request('https://api.amv.example' + path, { method,
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...(auth ? { Authorization: 'Bearer ' + auth } : {}), 'CF-Connecting-IP': '20.0.0.1' },
    body: body ? JSON.stringify(body) : undefined }), env, ctx);
  return { status: r.status, acao: r.headers.get('Access-Control-Allow-Origin'), creds: r.headers.get('Access-Control-Allow-Credentials') };
};
async function seed(env) {
  const w = { key: 'pk_corswidget', owner: 'shop@example.com', enabled: true, model: 'amv-core', origins: ['theircompany.example'],
    dailyMsgCap: 0, dailySpendCapUSD: 0, maxOut: 256, systemPrompt: 'Answer about the shop.', title: 'Chat', greeting: 'Hi' };
  await W.DB.put(env, 'widget', w.key, w);
  await W.DB.put(env, 'widget_owner', w.owner, w);
  await W.DB.put(env, 'ent', w.owner, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
}
const chat = { key: 'pk_corswidget', messages: [{ role: 'user', content: 'hours?' }] };

section('Locked to the site: the session is the site’s alone');
const locked = mkEnv({ ALLOWED_ORIGIN: SITE });
await seed(locked);
{
  const r = await hit(locked, 'POST', '/v1/entitlement', { origin: STRANGER });
  ok(r.acao === SITE && r.creds === 'true', 'a session route names only the site, with credentials - a stranger’s page cannot read it', r);
  const t = await hit(locked, 'POST', '/v1/entitlement', { origin: STRANGER, auth: 'eyJhbGciOiJIUzI1NiJ9.e30.x' });
  ok(t.acao === SITE && t.creds === 'true', 'and a session token is not mistaken for an API key', t);
}

section('Locked: the widget still answers on the customer’s site');
{
  const cfg = await hit(locked, 'GET', '/v1/widget/config-public?k=pk_corswidget', { origin: THEIRS });
  ok(cfg.status === 200 && cfg.acao === THEIRS && !cfg.creds, 'its settings are readable by the customer’s page, without credentials', cfg);
  const c = await hit(locked, 'POST', '/v1/widget/chat', { origin: THEIRS, body: chat });
  ok(c.status === 200 && c.acao === THEIRS && !c.creds, 'and so is the answer', c);
  const s = await hit(locked, 'POST', '/v1/widget/chat', { origin: STRANGER, body: chat });
  ok(s.acao !== STRANGER, 'but not on a site the widget is not allowed on', s);
}

section('Locked: a request carrying an API key is answered to anyone, without credentials');
{
  const r = await hit(locked, 'POST', '/v1/messages', { origin: STRANGER, auth: 'amv_sk_' + 'x'.repeat(40), body: { model: 'amv-core', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] } });
  ok(r.acao === '*' && !r.creds, 'the key is the whole credential, so no cookie is ever involved', r);
}

section('Locked: a preflight asks before the key is sent, and is answered the same way');
{
  const pre = async (origin) => { const r = await W.default.fetch(new Request('https://api.amv.example/v1/messages', { method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } }), locked, ctx);
    return { acao: r.headers.get('Access-Control-Allow-Origin'), creds: r.headers.get('Access-Control-Allow-Credentials') }; };
  const s = await pre(STRANGER);
  ok(s.acao === '*' && !s.creds, 'another page’s preflight is answered without credentials, so its key can follow', s);
  const own = await pre(SITE);
  ok(own.acao === SITE && own.creds === 'true', 'and the site’s own preflight still carries its cookie', own);
}

section('Open: unchanged');
{
  const open = mkEnv();
  await seed(open);
  const r = await hit(open, 'POST', '/v1/entitlement', { origin: STRANGER });
  ok(r.acao === '*' && !r.creds, 'anyone, never with credentials - there is no cookie to borrow', r);
  const c = await hit(open, 'POST', '/v1/widget/chat', { origin: THEIRS, body: chat });
  ok(c.status === 200 && c.acao === THEIRS, 'and the widget answers as before', c);
}

globalThis.fetch = realFetch;
if (report('a-locked-api-still-answers-the-widget-and-keys') > 0) process.exitCode = 1;
done();
