/* THE WAY TO GET AMV FREE WAS TO CHOOSE HOW YOU PAY.

   `automatic_payment_methods[enabled]=true` is on, and it is right that it is:
   iDEAL is how the Netherlands pays, BLIK is how Poland pays, PIX is universal
   in Brazil, and a card-only checkout quietly excludes most of the world AMV
   was translated for.

   Two of the methods it turns on do not move money when the checkout finishes.
   OXXO is a printed voucher the customer takes to a shop counter in Mexico and
   has three days to pay in cash. SEPA Direct Debit can take up to fourteen days
   and can still come back failed. For both, Stripe fires
   `checkout.session.completed` IMMEDIATELY, with `payment_status: 'unpaid'`,
   and then later either `async_payment_succeeded` or `async_payment_failed`.

   The webhook granted the plan on `completed` and never read payment_status.
   So: open checkout, choose OXXO, close the tab. Plan granted in full,
   instantly, on a voucher nobody ever takes to a shop. Repeatable from any
   account, in any country where those methods are enabled, and it does not
   look like abuse from the inside - it is the product working as written.

   The marketplace branch was worse than free. It called _creditSale on the same
   event, which credits the SELLER eighty percent - so AMV booked a real payout
   liability against money that had not arrived and was not going to.

   And the reconciliation sweep, the thing that exists to catch payments the
   webhook missed, asked `payment_status === 'paid' || status === 'complete'`.
   An unpaid session is 'complete' from the moment it is chosen, so the second
   half of that `or` granted every time the first half was false. The safety net
   had the same hole as the thing it was there to catch.

   None of this was in the external audit: the payments surface it reviewed was
   the one that existed before automatic_payment_methods was turned on.

   Below: nothing is granted until the money is there, the delayed success still
   grants exactly once, the failure closes cleanly, and a full-coupon session -
   where there IS no money to wait for - is not caught by the same net. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'delayedpay.harness.mjs');
writeFileSync(harness, src + '\nexport { _stripeSessionPaid, PEND_GIVEUP_MS, DB };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const SECRET = 'whsec_test_secret_value';
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv() {
  const m = new Map(); const vals = new Map();
  return {
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admintok', APP_URL: 'https://amv.test',
    STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_PRICE_PRO: 'price_pro',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        const from = cursor ? +cursor : 0;
        const page = all.slice(from, from + (limit || 1000));
        return { keys: page, list_complete: from + page.length >= all.length, cursor: String(from + page.length) };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'claim') {
          if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false }));
          vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true }));
        }
        if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}

const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };

async function sign(payload, t) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* A real signed Stripe event, so this exercises the whole path rather than the
   handler in isolation. */
async function send(env, type, object) {
  const body = JSON.stringify({ id: 'evt_' + Math.random().toString(36).slice(2), type,
                                created: Math.floor(Date.now() / 1000), data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = await sign(body, t);
  const r = await worker.fetch(new Request('https://api.amv.test/v1/stripe/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` },
    body,
  }), env, ctx);
  await ctx.settle();
  return { status: r.status, text: await r.text().catch(() => '') };
}

const planOf = async (env, email) => {
  const e = await W.DB.get(env, 'ent', email);
  return e ? (e.plan || 'free') : 'none';
};

/* An OXXO / SEPA session as Stripe really sends it the moment it is chosen. */
const unpaidSession = (over) => Object.assign({
  id: 'cs_delayed_1', payment_status: 'unpaid', status: 'complete',
  customer: 'cus_1', subscription: 'sub_1', amount_total: 2000, currency: 'usd',
  client_reference_id: 'buyer@example.com',
  metadata: { email: 'buyer@example.com', plan: 'pro' },
}, over || {});

section('THE FINDING: a completed session that nobody has paid for grants nothing');
{
  const env = mkEnv();
  const r = await send(env, 'checkout.session.completed', unpaidSession());
  ok(r.status === 200,
     'the event is acknowledged, so Stripe stops retrying a delivery that was fine', r.status);
  ok(await planOf(env, 'buyer@example.com') === 'none',
     'and no plan is granted on an unpaid voucher', await planOf(env, 'buyer@example.com'));
}

section('And the money is still being watched for');
{
  /* The pending row is what the reconciliation sweep reads. Closing it here
     would mean a lost async event is never noticed - somebody pays and gets
     nothing, which is worse than not being paid. */
  const env = mkEnv();
  await W.DB.put(env, 'paypending', 'cs_delayed_1',
                 { at: Date.now(), provider: 'stripe', kind: 'plan', email: 'buyer@example.com', plan: 'pro' });
  await send(env, 'checkout.session.completed', unpaidSession());
  const still = await W.DB.get(env, 'paypending', 'cs_delayed_1');
  ok(!!still, 'the pending row is left open for the sweep', !!still);
}

section('When the money arrives, the plan is granted');
{
  const env = mkEnv();
  await send(env, 'checkout.session.completed', unpaidSession());
  ok(await planOf(env, 'buyer@example.com') === 'none', 'still nothing after the voucher was issued');

  await send(env, 'checkout.session.async_payment_succeeded',
             unpaidSession({ payment_status: 'paid' }));
  ok(await planOf(env, 'buyer@example.com') === 'pro',
     'and the plan appears when the cash is actually paid', await planOf(env, 'buyer@example.com'));

  const closed = await W.DB.get(env, 'paypending', 'cs_delayed_1');
  ok(!closed, 'with the pending row closed', !closed);
}

section('When it does not arrive, nothing is granted and nothing is left hanging');
{
  const env = mkEnv();
  await W.DB.put(env, 'paypending', 'cs_delayed_1',
                 { at: Date.now(), provider: 'stripe', kind: 'plan', email: 'buyer@example.com', plan: 'pro' });
  await send(env, 'checkout.session.completed', unpaidSession());
  const r = await send(env, 'checkout.session.async_payment_failed', unpaidSession());
  ok(r.status === 200, 'the failure is acknowledged', r.status);
  ok(await planOf(env, 'buyer@example.com') === 'none',
     'no plan was ever granted, so there is none to take away', await planOf(env, 'buyer@example.com'));
  const row = await W.DB.get(env, 'paypending', 'cs_delayed_1');
  ok(!row, 'and the sweep stops asking about a session that will never be paid', !row);
}

section('A seller is not credited for a sale nobody paid for');
{
  /* Worse than free: _creditSale books the seller their eighty percent, so an
     unpaid marketplace checkout created a real payout liability out of nothing. */
  const env = mkEnv();
  await send(env, 'checkout.session.completed', unpaidSession({
    id: 'cs_market_1',
    metadata: { kind: 'market_purchase', itemId: 'usr_x', buyer: 'buyer@example.com', seller: 'seller@example.com' },
  }));
  const wallet = await W.DB.get(env, 'wallet', 'seller@example.com');
  const bal = wallet ? (wallet.balance || wallet.available || 0) : 0;
  ok(!bal, 'the seller is owed nothing until the buyer has actually paid', wallet);
}

section('A card payment is untouched, and so is a session with nothing to pay');
{
  /* The trade that would make this a bad fix: refusing to grant a real payment.
     'no_payment_required' is a full-coupon or trial session - Stripe saying
     there is no money coming, rather than not yet. */
  const env = mkEnv();
  await send(env, 'checkout.session.completed', unpaidSession({ payment_status: 'paid' }));
  ok(await planOf(env, 'buyer@example.com') === 'pro', 'a card checkout grants immediately');

  const env2 = mkEnv();
  await send(env2, 'checkout.session.completed',
             unpaidSession({ payment_status: 'no_payment_required', client_reference_id: 'free@example.com',
                             metadata: { email: 'free@example.com', plan: 'pro' } }));
  ok(await planOf(env2, 'free@example.com') === 'pro',
     'and a hundred-percent coupon is not left waiting for money that is not coming');
}

section('The predicate says what it means, everywhere it is asked');
{
  ok(W._stripeSessionPaid({ payment_status: 'paid' }) === true, 'paid is paid');
  ok(W._stripeSessionPaid({ payment_status: 'no_payment_required' }) === true, 'nothing to pay is paid');
  ok(W._stripeSessionPaid({ payment_status: 'unpaid' }) === false, 'unpaid is not');
  ok(W._stripeSessionPaid({ status: 'complete' }) === false,
     'and neither is a session that only says it is COMPLETE - the whole defect in one line');
  ok(W._stripeSessionPaid({}) === false, 'nor one that does not say');

  /* The sweep is the safety net and had the same hole. Checked on the code, so
     the `||` cannot come back in the place nobody looks at. */
  const code = codeOnly(src);
  ok(!/payment_status === 'paid' \|\| d\.status === 'complete'/.test(code),
     'the reconciliation sweep no longer treats complete as paid', true);
  ok((code.match(/_stripeSessionPaid\(/g) || []).length >= 3,
     'both the webhook and the sweep ask the same question', (code.match(/_stripeSessionPaid\(/g) || []).length);
}

section('And AMV waits as long as the slowest method actually takes');
{
  /* The pending row is dropped after this long. It was 24 hours, under a
     comment saying an unpaid session is never coming back - true of cards, and
     false the moment a voucher with a three-day window was on offer. Set
     shorter than the method takes, the safety net is gone precisely when the
     payment is still real. */
  const days = W.PEND_GIVEUP_MS / (24 * 60 * 60 * 1000);
  ok(days >= 14, 'the pending window covers a SEPA debit, which can take fourteen days', days);
}

section('The operator is told to subscribe to the events AMV listens for');
{
  /* Six of the ten handled events were missing from the setup notes, including
     async_payment_succeeded - so an operator who followed them exactly would
     have had a customer pay by voucher and never be granted anything, with the
     handler sitting right there unable to fire. */
  const handled = new Set();
  const at = src.indexOf('const evtAt = (+evt.created');
  for (const m of src.slice(at, at + 16000).matchAll(/type === '([a-z_]+\.[a-z_.]+)'/g)) handled.add(m[1]);
  ok(handled.size >= 8, 'the handled Stripe events were found', handled.size);
  const undocumented = [...handled].filter(e => !src.includes('   ' + e) && !src.includes(e + ' ')).sort();
  const missing = [...handled].filter(e => src.split(e).length < 3).sort();
  ok(missing.length === 0,
     'every event the code handles is named in the setup notes as well', missing);
}

if (report('a-voucher-nobody-paid-is-not-a-payment') > 0) process.exitCode = 1;
done();
