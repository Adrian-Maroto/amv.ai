/* EXTRA USAGE IS PREPAID, SPENT ONLY PAST THE PLAN, AND CANNOT BE OVERSPENT.

   The money path for buying more when a plan runs out, driven through the
   Worker's own routes: a Stripe checkout for a pack, the signed webhook that
   credits it, chat requests that run on it once the plan's own limits are
   reached, and the refund and dispute that take it back. The counter
   serialises the way the real Durable Object does, so the concurrent burst
   below would walk past the balance if the booking were check-then-charge.

   - free accounts and family members cannot buy it; a paid plan can;
   - a pack's checkout is a one-time payment for exactly the pack's price;
   - a signed, paid webhook credits what Stripe says was paid - once, however
     many times it arrives; a forged one credits nothing;
   - with the plan's window full: no credit is a refusal, credit is an answer,
     and the answer is charged to the credit at the markup;
   - the same with the plan's monthly spending ceiling reached;
   - twenty requests at once cannot spend past the balance;
   - the anti-script message ceiling is never bought past;
   - a refund or a dispute on a pack takes the credit back and leaves the
     subscription alone. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'credit.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { DB, CREDIT_MARKUP, window5hKey, _periodKeyOf };\n');
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
    AMV_COUNTER: { idFromName: (n) => n, get: (n) => ({ fetch(_u, init) { return serialise(async () => {
      await Promise.resolve();
      const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
      const r = (o) => new Response(JSON.stringify(o));
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
      if (b.op === 'get') return r({ value: cur });
      return r({ allowed: true, value: cur });
    }); } }) },
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
const ask = (env, tok) => call(env, '/v1/messages', { model: 'amv-core', max_tokens: 1000, messages: [{ role: 'user', content: 'hi' }] }, tok);
const bal = async (env, tok) => (await j(await call(env, '/v1/credit', null, tok, 'GET'))).d;

section('Who can buy it');
{
  const env = mkEnv();
  const free = await account(env, 'free@example.com');
  const r = await j(await call(env, '/v1/credit/checkout', { usd: 10 }, free));
  ok(r.status === 402 && r.d.code === 'plan_required', 'a free account is told it comes with a paid plan', r.d);
  const pro = await account(env, 'pro@example.com', 'pro');
  const info = await bal(env, pro);
  ok(info.eligible === true && info.available === true && info.balance === 0 && info.packs.join() === '10,25,50', 'a paid plan sees the packs and a zero balance', info);
  const off = mkEnv({ STRIPE_SECRET_KEY: '' });
  const t2 = await account(off, 'pro2@example.com', 'pro');
  const o = await j(await call(off, '/v1/credit/checkout', { usd: 10 }, t2));
  ok(o.status === 503 && o.d.code === 'needs_service', 'without card payments switched on it says so', o.d);
}

const env = mkEnv();
const EMAIL = 'pat@example.com';
const tok = await account(env, EMAIL, 'pro');

section('A pack’s checkout is a one-time payment for exactly its price');
{
  const bad = await j(await call(env, '/v1/credit/checkout', { usd: 7 }, tok));
  ok(bad.status === 400 && bad.d.code === 'bad_pack', 'a made-up amount is refused', bad.d);
  stripeForms = [];
  const r = await j(await call(env, '/v1/credit/checkout', { usd: 25 }, tok));
  const f = stripeForms[0] || {};
  ok(r.status === 200 && /^https:\/\/checkout\.stripe\.test\//.test(r.d.url), 'it hands back Stripe’s page', r.d);
  ok(f.mode === 'payment' && f['line_items[0][price_data][unit_amount]'] === '2500' && f['metadata[kind]'] === 'usage_credit' && f['metadata[subject]'] === EMAIL,
     'one-time, $25, marked as extra usage for this account', f);
}

section('A paid, signed webhook credits what was paid - once');
{
  ok(await webhook(env, 'checkout.session.completed', paid(EMAIL, 25, 'pi_A'), { forge: true }) === 400, 'a forged one is refused');
  ok((await bal(env, tok)).balance === 0, 'and credits nothing');
  const unpaid = await webhook(env, 'checkout.session.completed', paid(EMAIL, 25, 'pi_V', { payment_status: 'unpaid' }));
  ok(unpaid === 200 && (await bal(env, tok)).balance === 0, 'a voucher nobody has paid yet credits nothing');
  ok(await webhook(env, 'checkout.session.completed', paid(EMAIL, 25, 'pi_A', { metadata: { kind: 'usage_credit', subject: EMAIL, email: EMAIL, usd: '5000' } })) === 200, 'the real one is accepted');
  ok((await bal(env, tok)).balance === 25, 'and credits $25 - Stripe’s total, not a number written into the session', (await bal(env, tok)).balance);
  await webhook(env, 'checkout.session.completed', paid(EMAIL, 25, 'pi_A'));
  await webhook(env, 'checkout.session.async_payment_succeeded', paid(EMAIL, 25, 'pi_A'));
  ok((await bal(env, tok)).balance === 25, 'the same payment arriving again, as another event, adds nothing', (await bal(env, tok)).balance);
}

const fill = (prefix) => { for (const k of [...env._vals.keys()]) if (k.startsWith(prefix)) env._vals.set(k, 1e9); };
const spentNow = () => env._vals.get('creditspent:' + EMAIL) || 0;

section('With the plan’s window full: credit answers, and pays at the markup');
{
  const first = await ask(env, tok); await first.text(); await ctx.settle();
  ok(first.status === 200 && spentNow() === 0, 'inside the plan nothing comes off the credit', spentNow());
  fill('msgs5h:');
  const before = spentNow();
  const cost0 = [...env._vals.entries()].filter(([k]) => k.startsWith('costtotal:')).reduce((n, [, v]) => n + v, 0);
  const r = await ask(env, tok); await r.text(); await ctx.settle();
  const cost1 = [...env._vals.entries()].filter(([k]) => k.startsWith('costtotal:')).reduce((n, [, v]) => n + v, 0);
  const charged = spentNow() - before, cost = cost1 - cost0;
  ok(r.status === 200, 'the message is answered', r.status);
  ok(cost > 0 && Math.abs(charged - cost * W.CREDIT_MARKUP) < 1e-6, 'and the credit is charged its cost times the markup', { charged, cost });
}

section('With the plan’s monthly ceiling reached: the same');
{
  for (const k of [...env._vals.keys()]) if (k.startsWith('msgs5h:')) env._vals.set(k, 0);
  fill('cost:');
  const before = spentNow();
  const r = await ask(env, tok); await r.text(); await ctx.settle();
  ok(r.status === 200 && spentNow() > before, 'answered on credit', { status: r.status, spent: spentNow() - before });
}

section('No credit: the plan’s refusal, as before');
{
  const env2 = mkEnv();
  const t = await account(env2, 'nocredit@example.com', 'pro');
  const r0 = await ask(env2, t); await r0.text(); await env2; await ctx.settle();
  for (const k of [...env2._vals.keys()]) if (k.startsWith('msgs5h:')) env2._vals.set(k, 1e9);
  const r = await j(await ask(env2, t));
  ok(r.status === 429 && r.d.code === 'quota_window', 'the window refusal stands', r.d);
}

section('Twenty at once cannot spend past the balance');
{
  const env3 = mkEnv();
  const t = await account(env3, 'burst@example.com', 'pro');
  await webhook(env3, 'checkout.session.completed', paid('burst@example.com', 10, 'pi_B'));
  env3._vals.set('creditspent:burst@example.com', 9.99);       // a cent left
  const r0 = await ask(env3, t); await r0.text(); await ctx.settle();
  for (const k of [...env3._vals.keys()]) if (k.startsWith('msgs5h:')) env3._vals.set(k, 1e9);
  /* A hundredth of a cent left: not enough for one message's booking, so
     every one of the twenty must be refused - and a booking that did not hold
     the line would let all twenty through. */
  env3._vals.set('creditspent:burst@example.com', 9.9999);
  const rs = await Promise.all(Array.from({ length: 20 }, () => ask(env3, t)));
  await Promise.all(rs.map(r => r.text().catch(() => '')));
  await ctx.settle();
  const spent = env3._vals.get('creditspent:burst@example.com');
  ok(rs.some(r => r.status === 429), 'some are refused once the credit cannot cover them', rs.map(r => r.status).join(','));
  ok(spent <= 10 + 1e-9, 'and the credit is never spent past what was paid', spent);
}

section('With the day’s allowance used: the same');
{
  for (const k of [...env._vals.keys()]) if (k.startsWith('cost:')) env._vals.set(k, 0);
  const day = [...env._vals.keys()].find(k => /^usg:pat@example\.com:\d{4}-\d{2}-\d{2}$/.test(k));
  ok(!!day, 'the day’s token counter was found', day);
  env._vals.set(day, 1e9);
  const before = spentNow();
  const r = await ask(env, tok); await r.text(); await ctx.settle();
  ok(r.status === 200 && spentNow() > before, 'answered on credit', { status: r.status, spent: spentNow() - before });
  env._vals.set(day, 0);
}

section('The message ceiling that stops scripts is never bought past');
{
  for (const k of [...env._vals.keys()]) if (k.startsWith('cost:')) env._vals.set(k, 0);
  fill('msgs:');
  const r = await j(await ask(env, tok));
  ok(r.status === 429 && r.d.code === 'quota_messages', 'refused, credit or not', r.d);
  for (const k of [...env._vals.keys()]) if (k.startsWith('msgs:')) env._vals.set(k, 0);
}

section('A refund or a dispute on a pack takes the credit back, and leaves the plan');
{
  const before = (await bal(env, tok)).balance;
  ok(await webhook(env, 'charge.refunded', { id: 'ch_A', object: 'charge', payment_intent: 'pi_A', amount: 2500, amount_refunded: 1000, customer: 'cus_x' }) === 200, 'a partial refund is accepted');
  const after = (await bal(env, tok)).balance;
  ok(Math.abs((before - after) - 10) < 1e-6, 'and takes back exactly what was refunded', { before, after });
  const ent = await W.DB.get(env, 'ent', EMAIL);
  ok(ent.plan === 'pro', 'the subscription is untouched', ent.plan);
  await webhook(env, 'charge.dispute.created', { id: 'dp_A', object: 'dispute', payment_intent: 'pi_A', charge: 'ch_A', amount: 2500, customer: 'cus_x' });
  const ent2 = await W.DB.get(env, 'ent', EMAIL);
  const bought = env._vals.get('creditbuy:' + EMAIL) || 0;
  ok(bought === 0 && (await bal(env, tok)).balance === 0 && ent2.plan === 'pro', 'a dispute takes back the rest of the $25 - still not the plan', { bought, plan: ent2.plan });
}

if (report('extra-usage-is-prepaid-and-cannot-be-overspent') > 0) process.exitCode = 1;
done();
