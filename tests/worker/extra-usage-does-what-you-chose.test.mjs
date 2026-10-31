/* EXTRA USAGE DOES WHAT THE PERSON CHOSE WHEN THE PLAN RUNS OUT.

   Buying a pack used to mean it was spent the moment a limit was reached,
   with nothing in between. Now each person chooses:
     auto - it carries on (what it always did, and still the default);
     ask  - nothing is spent until the app has asked and they said yes, for
            that request; the refusal says credit is waiting, so the app can
            ask instead of showing a dead end;
     stop - it is never spent; the refusal says so.
   An API key cannot answer a question, so for a key "ask" is "stop" - and a
   key cannot claim consent in its body. The choice is saved on the server,
   read back, and erased with the account. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';
import { sessionOp } from '../lib/session-op.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'creditmode.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { DB, CREDIT_MARKUP, _periodKeyOf };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const WHSEC = 'whsec_test_secret_for_this_suite';
const PW = 'A-real-Passw0rd!';
const realFetch = globalThis.fetch;
let stripeForms = [], sessionN = 0;
const sse = (outTok) => 'data: {"type":"message_start","message":{"usage":{"input_tokens":2000,"output_tokens":0}}}\n\n'
  + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'
  + `data: {"type":"message_delta","usage":{"output_tokens":${outTok}}}\n\n`
  + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (/model\.example/.test(u)) { await new Promise(r => setTimeout(r, 15)); return new Response(sse(400), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }); }
  if (u === 'https://api.stripe.com/v1/checkout/sessions') {
    stripeForms.push(Object.fromEntries(new URLSearchParams(String(init.body))));
    sessionN++;
    return new Response(JSON.stringify({ id: 'cs_test_' + sessionN, url: 'https://checkout.stripe.test/' + sessionN }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
};

function mkEnv(extra) {
  const m = new Map(), vals = new Map(), claims = new Set();
  let chain = Promise.resolve();
  const serialise = (fn) => (chain = chain.then(fn, fn));
  return Object.assign({
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example', JWT_SECRET: 'j'.repeat(40), ADMIN_TOKEN: 'a',
    APP_URL: 'https://amv.test', GLOBAL_DAILY_USD_CAP: '100000',
    STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WHSEC, _vals: vals,
    AMV_KV: { _map: m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
    AMV_COUNTER: withAuthOps({ idFromName: (n) => n, get: (n) => ({ fetch(_u, init) { return serialise(async () => {
      await Promise.resolve();
      const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
      const r = (o) => new Response(JSON.stringify(o));
      { const so = sessionOp(vals, n, b); if (so) return r(so); }
      if (b.op === 'reserve') {
        const amt = Number(b.amount);
        if (!Number.isFinite(amt) || amt < 0) return r({ allowed: false, value: cur });
        if (b.cap != null && cur + amt > b.cap) return r({ allowed: false, value: cur });
        vals.set(n, cur + amt); return r({ allowed: true, value: cur + amt });
      }
      if (b.op === 'incr') { vals.set(n, Math.max(0, cur + (b.amount || 0))); return r({ value: vals.get(n) }); }
      if (b.op === 'checkCap') return r({ allowed: b.cap == null || cur < b.cap, value: cur });
      if (b.op === 'rateCheck') { vals.set(n, cur + 1); return r({ allowed: true }); }
      if (b.op === 'claim') { if (claims.has(n)) return r({ claimed: false }); claims.add(n); return r({ claimed: true }); }
      if (b.op === 'release') { claims.delete(n); return r({ ok: true }); }
      if (b.op === 'clear') { vals.delete(n); return r({ ok: true }); }
      if (b.op === 'get') return r({ value: cur });
      return r({ allowed: true, value: cur });
    }); } }) }),
  }, extra || {});
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { const p = this._p || []; this._p = []; await Promise.all(p); } };
let ipN = 1;
const call = async (env, path, body, tok, method, headers) => {
  const r = await worker.fetch(new Request('https://api.amv.test' + path, { method: method || 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '41.0.0.' + (ipN++ % 200 + 1) }, tok ? { Authorization: 'Bearer ' + tok } : {}, headers || {}),
    body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body || {})) }), env, ctx);
  return r;
};
const j = async (r) => ({ status: r.status, d: await r.json().catch(() => ({})) });
async function account(env, email, plan) {
  const tok = (await (await call(env, '/auth/signup', { email, name: 'C', password: PW })).json()).token;
  if (plan) await W.DB.put(env, 'ent', email, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
async function signed(payload) {
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(WHSEC), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + payload));
  return 't=' + t + ',v1=' + [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}
let evN = 0;
async function webhook(env, type, object, opts = {}) {
  const payload = JSON.stringify({ id: opts.id || ('evt_' + (++evN)), type, created: Math.floor(Date.now() / 1000), data: { object } });
  const sig = opts.forge ? 't=' + Math.floor(Date.now() / 1000) + ',v1=' + '0'.repeat(64) : await signed(payload);
  const r = await call(env, '/v1/stripe/webhook', payload, null, 'POST', { 'Stripe-Signature': sig });
  return r.status;
}
const paid = (email, usd, pi, extra) => Object.assign({ id: 'cs_' + pi, object: 'checkout.session', payment_status: 'paid', status: 'complete',
  amount_total: usd * 100, currency: 'usd', payment_intent: pi, customer_email: email,
  metadata: { kind: 'usage_credit', subject: email, email } }, extra || {});

const ask = (env, tok, amv) => call(env, '/v1/messages', Object.assign({ model: 'amv-core', max_tokens: 1000, messages: [{ role: 'user', content: 'hi' }] }, amv ? { amv } : {}), tok);
const bal = async (env, tok) => (await j(await call(env, '/v1/credit', null, tok, 'GET'))).d;
const setMode = async (env, tok, mode) => j(await call(env, '/v1/credit/mode', { mode }, tok));

const env = mkEnv();
const EMAIL = 'pat@example.com';
const tok = await account(env, EMAIL, 'pro');
ok(await webhook(env, 'checkout.session.completed', paid(EMAIL, 25, 'pi_M')) === 200, 'a $25 pack is bought');
const spentNow = () => env._vals.get('creditspent:' + EMAIL) || 0;
const fill = () => { for (const k of [...env._vals.keys()]) if (k.startsWith('msgs5h:')) env._vals.set(k, 1e9); };
{ const r = await ask(env, tok); await r.text(); await ctx.settle(); }
fill();

section('Auto is the default, and carries on as it always did');
{
  ok((await bal(env, tok)).mode === 'auto', 'a new account is on auto', (await bal(env, tok)).mode);
  ok((await bal(env, tok)).modeChosen === false, 'and is said not to have chosen, so the purchase screen asks first', (await bal(env, tok)).modeChosen);
  const before = spentNow();
  const r = await ask(env, tok); await r.text(); await ctx.settle();
  ok(r.status === 200 && spentNow() > before, 'past the plan, the message is answered on credit', { status: r.status });
}

section('Ask: nothing is spent until the person says yes');
{
  const s = await setMode(env, tok, 'ask');
  ok(s.status === 200 && s.d.mode === 'ask' && (await bal(env, tok)).mode === 'ask', 'the choice is saved and read back', s.d);
  ok((await bal(env, tok)).modeChosen === true, 'and from then on it is a choice the person made', (await bal(env, tok)).modeChosen);
  const before = spentNow();
  const r = await j(await ask(env, tok));
  ok(r.status === 429 && r.d.code === 'quota_window', 'without a yes it is the plan’s own refusal', r.d.code);
  ok(r.d.credit && r.d.credit.held === 'ask' && r.d.credit.balance > 0, 'saying credit is waiting, and how much', r.d.credit);
  ok(spentNow() === before, 'and nothing came off the balance', spentNow() - before);
  const y = await ask(env, tok, { useCredit: true }); await y.text(); await ctx.settle();
  ok(y.status === 200 && spentNow() > before, 'with the yes it goes ahead on credit', { status: y.status });
}

section('Stop: it is never spent');
{
  await setMode(env, tok, 'stop');
  const before = spentNow();
  const r = await j(await ask(env, tok, { useCredit: true }));
  ok(r.status === 429 && r.d.credit && r.d.credit.held === 'stop', 'refused, saying the credit is set never to be used - even with a yes in the body', r.d.credit);
  ok(spentNow() === before, 'nothing spent', spentNow() - before);
}

section('An API key cannot say yes for anybody');
{
  await setMode(env, tok, 'ask');
  const key = (await j(await call(env, '/v1/keys/create', { name: 'k' }, tok))).d.key;
  ok(typeof key === 'string', 'a key is made');
  const before = spentNow();
  const r = await j(await ask(env, key, { useCredit: true }));
  ok(r.status === 429 && r.d.credit && r.d.credit.held === 'stop', 'for a key, ask means stop, whatever its body claims', r.d);
  ok(spentNow() === before, 'nothing spent', spentNow() - before);
  const m = await setMode(env, key, 'auto');
  ok(m.status === 401 && (await bal(env, tok)).mode === 'ask', 'and a key cannot change the setting', m.status);
}

section('Only the three choices are accepted');
{
  const r = await setMode(env, tok, 'always');
  ok(r.status === 400 && r.d.code === 'bad_mode' && (await bal(env, tok)).mode === 'ask', 'anything else is refused and changes nothing', r.d);
}

section('With no credit at all, nothing is said about it');
{
  const e2 = mkEnv();
  const t2 = await account(e2, 'none@example.com', 'pro');
  await setMode(e2, t2, 'ask');
  { const r = await ask(e2, t2); await r.text(); await ctx.settle(); }
  for (const k of [...e2._vals.keys()]) if (k.startsWith('msgs5h:')) e2._vals.set(k, 1e9);
  const r = await j(await ask(e2, t2));
  ok(r.status === 429 && !r.d.credit, 'a plain refusal - there is nothing to offer', r.d);
}

section('The choice leaves with the account');
{
  ok(env.AMV_KV._map.has('creditpref:' + EMAIL), 'it is stored for the account');
  const d = await call(env, '/auth/delete', { password: PW }, tok);
  ok(d.status === 200 && !env.AMV_KV._map.has('creditpref:' + EMAIL), 'and erased with it', d.status);
}

report('extra-usage-does-what-you-chose');
done();
