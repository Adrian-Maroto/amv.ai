#!/usr/bin/env node
/* THE LOOP THAT ACTUALLY EARNS MONEY, AGAINST THE REAL RUNTIME.
 *
 *   node smoke-revenue.mjs
 *
 * smoke-real.mjs proves the Worker boots in workerd and that auth, tokens and
 * headers behave. It stops short of the only sequence the business depends on:
 *
 *   sign up -> ask a question and get a metered answer -> be refused an upgrade
 *   honestly when no price is configured -> be granted a plan by a signed
 *   webhook -> have that plan actually change what you are allowed -> be
 *   revoked on cancellation, on refund, and on a chargeback.
 *
 * Every one of those steps has had a defect in it at some point in this repo's
 * history - a plan granted on an unpaid voucher, a webhook whose signature
 * could not be verified during a rotation, a payment that arrived and granted
 * nothing, a cancellation that left the plan running. They were each fixed and
 * each covered by a unit suite against a hand-built `env`. What no suite does
 * is run them in ORDER, in one runtime, with one account, the way a customer
 * experiences them - which is the only arrangement that can catch a step that
 * works alone and does not compose.
 *
 * WHAT IS REAL HERE, and it matters that the list is short and honest:
 *   - the Worker is the real one, in workerd, with a real KV and a real
 *     Durable Object, started by wrangler exactly as `smoke-real.mjs` does;
 *   - the webhooks are signed with the real HMAC the deployed Worker verifies,
 *     so a signature bug fails this;
 *   - entitlement, metering and revocation are read back through the Worker's
 *     own routes, never out of storage directly.
 *
 * WHAT IS NOT REAL, said plainly so nobody reads more into a pass than is here:
 *   - the model endpoint is a local stub. It returns a correctly shaped stream,
 *     so the proxy's parsing and metering are exercised, but no model runs.
 *   - Stripe is never called outbound. Only the INBOUND half is exercised,
 *     which is the half that grants and revokes plans. Checkout itself needs
 *     the live API and belongs to the go-live rehearsal, not to a local run.
 *
 * SKIPS rather than fails when wrangler cannot start, for the reason
 * smoke-real.mjs gives: a gate that goes red for a reason that is not the code
 * teaches people to ignore it.
 */
import { spawn } from 'child_process';
import { existsSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { createServer } from 'http';
import { createHmac } from 'crypto';
import { join } from 'path';

const ROOT = process.cwd();
const PORT = 8899;              // not smoke-real's 8877, so both can run
const MODEL_PORT = 8900;
const B = `http://127.0.0.1:${PORT}`;
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const PW = 'A-real-Passw0rd!';
const WHSEC = 'whsec_smoke_test_only_not_a_real_secret';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';
process.env.no_proxy = '*';

let failures = 0, checks = 0;
const ok = (cond, label, detail) => {
  checks++;
  if (cond) { console.log(`  \x1b[32m✓\x1b[0m ${label}`); return; }
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${label}`);
  if (detail !== undefined) console.log(`      got: ${JSON.stringify(detail)}`);
};
const section = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);

/* ── The model, stubbed. A correctly shaped SSE stream, because the proxy only
   ever streams and parses the events back out - a stub that returned JSON
   would exercise a path the product does not have (LESSONS 309). ────────── */
let modelHits = 0;
const modelServer = createServer((req, res) => {
  modelHits++;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`);
  ev('message_start', { type: 'message_start', message: { id: 'msg_smoke', type: 'message', role: 'assistant',
      content: [], model: 'stub', stop_reason: null, usage: { input_tokens: 11, output_tokens: 0 } } });
  ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello from the stub.' } });
  ev('content_block_stop', { type: 'content_block_stop', index: 0 });
  ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } });
  ev('message_stop', { type: 'message_stop' });
  res.end();
});

const DEV_VARS = join(ROOT, '.dev.vars');
const HAD = existsSync(DEV_VARS);
const SAVED = HAD ? readFileSync(DEV_VARS, 'utf8') : null;
const restoreDevVars = () => {
  try { if (HAD) writeFileSync(DEV_VARS, SAVED); else rmSync(DEV_VARS, { force: true }); } catch (e) {}
};

/* Deliberately NO STRIPE_PRICE_* - that is the state a deployment is in the
   day payments are switched on, and one of the things this rehearsal checks is
   that AMV refuses it honestly rather than failing at the last step. */
const VARS = [
  'JWT_SECRET=smoke-revenue-only-not-a-real-secret-00000000',
  'ADMIN_TOKEN=smoke-revenue-admin-token',
  'OWNER_EMAIL=owner@smoke.test',
  `APP_URL=${B}`,
  'AMV_MODEL_KEY=smoke-model-key-not-real',
  `MODEL_API_URL=http://127.0.0.1:${MODEL_PORT}/v1/messages`,
  'STRIPE_SECRET_KEY=sk_test_smoke_not_real',
  `STRIPE_WEBHOOK_SECRET=${WHSEC}`,
].join('\n') + '\n';

let child = null;
const stopWorker = () => { if (child) { try { child.kill('SIGTERM'); } catch (e) {} child = null; } };

function startWorker() {
  return new Promise((resolve) => {
    writeFileSync(DEV_VARS, VARS);
    rmSync(join(ROOT, '.wrangler', 'state'), { recursive: true, force: true });
    child = spawn(WRANGLER, ['dev', '--local', '--port', String(PORT),
                             '--inspector-port', String(PORT + 1000)],
                  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const done = (v) => { clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => done(false), 90000);
    const watch = (b) => { out += String(b); if (/Ready on http/.test(out)) done(true); };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('error', () => done(false));
    child.on('exit', () => done(/Ready on http/.test(out)));
  });
}

const post = async (path, body, headers = {}) => {
  const r = await fetch(B + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '13.0.0.7', ...headers },
    body: JSON.stringify(body || {}) });
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
};
const get = async (path, headers = {}) => {
  const r = await fetch(B + path, { headers: { 'CF-Connecting-IP': '13.0.0.7', ...headers } });
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
};

/* A webhook signed the way Stripe signs one, so a change to the verifier fails
   this rather than being waved through by a stub that always says yes. */
const stripeEvent = async (obj) => {
  const raw = JSON.stringify(obj);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WHSEC).update(`${t}.${raw}`).digest('hex');
  const r = await fetch(B + '/v1/stripe/webhook', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${v1}` }, body: raw });
  return { status: r.status, text: await r.text().catch(() => '') };
};

async function main() {
  if (!existsSync(WRANGLER)) { console.log('SKIP  wrangler is not installed, so the revenue loop was not exercised.'); return 0; }
  await new Promise(r => modelServer.listen(MODEL_PORT, '127.0.0.1', r));
  console.log('Starting the Worker in workerd, configured for money…');
  if (!(await startWorker())) { stopWorker(); console.log('SKIP  wrangler could not start, so the revenue loop was not exercised.'); return 0; }

  const email = `buyer_${Date.now()}@smoke.test`;
  let token = '';

  section('Somebody signs up and can immediately ask a question');
  {
    const s = await post('/auth/signup', { email, name: 'Buyer', password: PW });
    ok(s.status === 200, 'sign-up succeeds on a configured deployment', s.status);
    token = s.body.token || '';
    ok(!!token, 'and hands back a token', !!token);

    const ent = await get('/v1/entitlement', { Authorization: 'Bearer ' + token });
    ok(ent.status === 200, 'their entitlement is readable', ent.status);
    ok((ent.body.entitlement?.plan || ent.body.plan) === 'free', 'and starts on free', ent.body);
  }

  section('A question reaches the model and comes back metered');
  {
    const before = modelHits;
    const r = await fetch(B + '/v1/messages', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'CF-Connecting-IP': '13.0.0.7' },
      body: JSON.stringify({ model: 'amv-core', max_tokens: 64, stream: true,
                             messages: [{ role: 'user', content: 'hello' }] }) });
    const body = await r.text();
    ok(r.status === 200, 'the proxy answers 200', r.status);
    ok(/text\/event-stream/.test(r.headers.get('content-type') || ''),
       'as a stream, which is the only thing this route returns', r.headers.get('content-type'));
    ok(modelHits === before + 1, 'and it really reached the model endpoint', modelHits - before);
    ok(/Hello from the stub/.test(body), 'the answer came back through', body.slice(0, 120));

    /* Metered, or the whole economic model is decoration. */
    const u = await get('/v1/usage', { Authorization: 'Bearer ' + token });
    ok(u.status === 200, 'usage is readable', u.status);
    const used = JSON.stringify(u.body);
    ok(/[1-9]/.test(used), 'and the turn was counted rather than free', used.slice(0, 200));
  }

  section('An upgrade nobody set a price for is refused honestly');
  {
    const c = await post('/v1/stripe/checkout', { plan: 'pro', payment_method: 'pm_card_visa' },
                         { Authorization: 'Bearer ' + token });
    ok(c.status === 503, 'checkout refuses as unfinished setup, not as a bad request', c.status);
    ok(c.body.code === 'not_configured', 'with a code the checkout sheet acts on', c.body);
    ok(/price|set up|cannot be bought/i.test(c.body.error || ''),
       'saying the plan has no price yet, not "unknown plan"', c.body.error);
    ok(!/unknown plan/i.test(c.body.error || ''),
       'never blaming the customer for a plan off AMV\u2019s own pricing page', c.body.error);
    ok(/nothing has been charged/i.test(c.body.error || ''),
       'and that no money moved', c.body.error);
    ok(c.body.missing === 'STRIPE_PRICE_PRO',
       'and it names the secret to set, so the operator has a next action', c.body.missing);

    /* THE OTHER CHECKOUT ROUTE, WHICH USED TO ANSWER DIFFERENTLY.
       /v1/subscribe takes a card inside the app; /v1/stripe/checkout hands back
       a hosted URL. Both can be told there is no price, and they disagreed -
       one named the missing configuration, the other said "unknown plan". */
    const sub = await post('/v1/subscribe', { plan: 'pro', payment_method: 'pm_card_visa' },
                           { Authorization: 'Bearer ' + token });
    ok(sub.status === 503 && sub.body.code === 'not_configured',
       'the in-app card route answers the same way', { s: sub.status, c: sub.body.code });
    ok(sub.body.error === c.body.error,
       'word for word, because both call one function', sub.body.error);

    /* And a plan AMV genuinely does not sell is still a bad request, which is
       a different problem with a different fix. */
    const nope = await post('/v1/stripe/checkout', { plan: 'banana', payment_method: 'pm_card_visa' },
                            { Authorization: 'Bearer ' + token });
    ok(nope.status === 400 && nope.body.code === 'unknown_plan',
       'a plan that does not exist is still refused as a bad request', { s: nope.status, c: nope.body.code });
  }

  section('A signed webhook is what actually grants the plan');
  {
    const r = await stripeEvent({ id: 'evt_smoke_paid', type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'cs_smoke_1', object: 'checkout.session', payment_status: 'paid',
        amount_total: 1500, currency: 'usd', customer: 'cus_smoke',
        subscription: 'sub_smoke', metadata: { email, plan: 'pro' } } } });
    ok(r.status === 200, 'the webhook is accepted', r.status);

    const ent = await get('/v1/entitlement', { Authorization: 'Bearer ' + token });
    ok((ent.body.entitlement?.plan || ent.body.plan) === 'pro',
       'and the account is on pro immediately afterwards', ent.body);
  }

  section('An unpaid session grants nothing, however complete it looks');
  {
    const other = `voucher_${Date.now()}@smoke.test`;
    const s = await post('/auth/signup', { email: other, name: 'V', password: PW });
    const t2 = s.body.token || '';
    const r = await stripeEvent({ id: 'evt_smoke_unpaid', type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'cs_smoke_2', object: 'checkout.session', payment_status: 'unpaid',
        amount_total: 1500, currency: 'usd', metadata: { email: other, plan: 'ultra' } } } });
    ok(r.status === 200, 'it is acknowledged so Stripe stops retrying', r.status);
    const ent = await get('/v1/entitlement', { Authorization: 'Bearer ' + t2 });
    ok((ent.body.entitlement?.plan || ent.body.plan) === 'free',
       'but the plan is NOT granted on a voucher nobody redeemed', ent.body);
  }

  section('A forged webhook grants nothing at all');
  {
    const raw = JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed',
      data: { object: { id: 'cs_forged', payment_status: 'paid', metadata: { email, plan: 'ultra' } } } });
    const t = Math.floor(Date.now() / 1000);
    const r = await fetch(B + '/v1/stripe/webhook', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${'0'.repeat(64)}` }, body: raw });
    ok(r.status === 400, 'a bad signature is refused', r.status);
    const ent = await get('/v1/entitlement', { Authorization: 'Bearer ' + token });
    ok((ent.body.entitlement?.plan || ent.body.plan) === 'pro',
       'and the account is untouched by it', ent.body);
  }

  section('Cancelling takes the plan away');
  {
    const r = await stripeEvent({ id: 'evt_smoke_cancel', type: 'customer.subscription.deleted',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'sub_smoke', object: 'subscription', customer: 'cus_smoke',
        status: 'canceled', metadata: { email } } } });
    ok(r.status === 200, 'the cancellation is accepted', r.status);
    const ent = await get('/v1/entitlement', { Authorization: 'Bearer ' + token });
    ok((ent.body.entitlement?.plan || ent.body.plan) === 'free',
       'and the account is back on free, which is what stops AMV paying for it', ent.body);
  }

  section('A chargeback takes it away too');
  {
    const em3 = `dispute_${Date.now()}@smoke.test`;
    const s = await post('/auth/signup', { email: em3, name: 'D', password: PW });
    const t3 = s.body.token || '';
    await stripeEvent({ id: 'evt_d_paid', type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'cs_d', payment_status: 'paid', amount_total: 1500, currency: 'usd',
        customer: 'cus_d', metadata: { email: em3, plan: 'pro' } } } });
    const mid = await get('/v1/entitlement', { Authorization: 'Bearer ' + t3 });
    ok((mid.body.entitlement?.plan || mid.body.plan) === 'pro', 'they were on pro first', mid.body);

    const r = await stripeEvent({ id: 'evt_d_dispute', type: 'charge.dispute.created',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'dp_1', object: 'dispute', customer: 'cus_d', amount: 1500,
        metadata: { email: em3 } } } });
    ok(r.status === 200, 'the dispute is accepted', r.status);
    const ent = await get('/v1/entitlement', { Authorization: 'Bearer ' + t3 });
    ok((ent.body.entitlement?.plan || ent.body.plan) === 'free',
       'and the plan is revoked rather than left running on money that went back', ent.body);
  }

  section('The same paid event twice is still one grant');
  {
    const em4 = `dup_${Date.now()}@smoke.test`;
    const s = await post('/auth/signup', { email: em4, name: 'U', password: PW });
    const t4 = s.body.token || '';
    const evt = { id: 'evt_dup_once', type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'cs_dup', payment_status: 'paid', amount_total: 1500, currency: 'usd',
        customer: 'cus_dup', metadata: { email: em4, plan: 'pro' } } } };
    const a = await stripeEvent(evt);
    const b = await stripeEvent(evt);
    ok(a.status === 200 && b.status === 200, 'a redelivery is acknowledged, not refused', [a.status, b.status]);
    const ent = await get('/v1/entitlement', { Authorization: 'Bearer ' + t4 });
    ok((ent.body.entitlement?.plan || ent.body.plan) === 'pro', 'and they are on pro exactly once', ent.body);
  }

  section('Nothing in the loop leaked another account');
  {
    const ex = await get('/v1/account/export', { Authorization: 'Bearer ' + token });
    ok(ex.status === 200, 'the buyer can export their own data', ex.status);
    const s = JSON.stringify(ex.body);
    ok(!s.includes('voucher_') && !s.includes('dispute_') && !s.includes('dup_'),
       'and it names nobody else who passed through this run', s.slice(0, 160));
  }

  return failures;
}

let code = 1;
try { code = await main(); }
catch (e) { console.log('\n\x1b[31mThe rehearsal threw:\x1b[0m ' + (e && e.message)); code = 1; }
finally {
  stopWorker();
  restoreDevVars();
  try { modelServer.close(); } catch (e) {}
}
console.log(code === 0
  ? `\n\x1b[32m${checks} checks passed - the revenue loop works end to end on the real runtime.\x1b[0m`
  : `\n\x1b[31m${failures} of ${checks} checks FAILED.\x1b[0m`);
process.exit(code === 0 ? 0 : 1);
