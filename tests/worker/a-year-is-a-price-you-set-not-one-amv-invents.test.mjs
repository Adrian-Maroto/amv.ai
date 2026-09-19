/* YEARLY BILLING, WITHOUT AMV EVER STATING AN AMOUNT OF ITS OWN.

   A yearly plan is not a discount this codebase applies - it is a second
   recurring price created once in Stripe, and the only thing that changes here
   is WHICH price id the checkout session opens with. That is the whole design
   decision: if AMV computed a yearly figure, the page and the charge would be
   two numbers maintained in two places, which is the drift this repository
   keeps finding. The amount somebody pays is the amount on the price the
   operator created.

   Two halves have to agree or a yearly subscriber pays and gets nothing. The
   checkout must open the YEARLY price, and the webhook - the only thing in the
   product that turns money into access - must recognise that price as the same
   plan. It matches by price id, so a price it has never heard of is a plan it
   cannot grant. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'yearly.harness.mjs');
writeFileSync(harness, src + `
export { stripeCheckout, _stripePriceId, PLAN_FROM_PRICE, publicConfig, DB, issueTokens };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const baseEnv = {
  JWT_SECRET: 'x'.repeat(40),
  STRIPE_SECRET_KEY: 'sk_test_x',
  APP_URL: 'https://amv.test',
  STRIPE_PRICE_PRO: 'price_pro_m',
  STRIPE_PRICE_ELITE: 'price_elite_m',
  STRIPE_PRICE_ULTRA: 'price_ultra_m',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix } = {}) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true };
    },
  },
};
const withYear = Object.assign({}, baseEnv, {
  STRIPE_PRICE_PRO_YEAR: 'price_pro_y',
  STRIPE_PRICE_ELITE_YEAR: 'price_elite_y',
  STRIPE_PRICE_ULTRA_YEAR: 'price_ultra_y',
});
W.__setRequireUser(async () => ({ email: 'buyer@x.com', plan: 'free' }));
await W.DB.put(baseEnv, 'consent', 'buyer@x.com', { birthYear: 1990, at: Date.now() });

const post = (body) => new Request('https://x/v1/stripe/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
  body: JSON.stringify(body || {}),
});

/* Stand in for Stripe and record what price the session was opened with. */
let sent = [];
const keepFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  if (/checkout\/sessions$/.test(String(u))) {
    sent.push(String((o && o.body) || ''));
    return new Response(JSON.stringify({ id: 'cs_1', url: 'https://pay.test/s' }), { status: 200 });
  }
  return keepFetch(u, o);
};

try {
  section('Which price a cycle opens');
  {
    ok(W._stripePriceId(withYear, 'pro') === 'price_pro_m',
       'no cycle is a month, because that is what the product has always sold', true);
    ok(W._stripePriceId(withYear, 'pro', 'month') === 'price_pro_m', 'month is the month price', true);
    ok(W._stripePriceId(withYear, 'pro', 'year') === 'price_pro_y', 'year is the year price', true);
    /* A cycle arrives from a browser. It picks between configured prices and
       can never name an amount, so the worst a bad value does is sell monthly. */
    ok(W._stripePriceId(withYear, 'pro', 'YEAR ') === 'price_pro_m',
       'anything that is not exactly "year" is a month', true);
    ok(W._stripePriceId(withYear, 'pro', '../../etc') === 'price_pro_m',
       'including something somebody made up', true);
  }

  section('Checkout opens the yearly price when yearly is asked for');
  {
    sent = [];
    const r = await W.stripeCheckout(post({ plan: 'pro', cycle: 'year' }), withYear);
    ok(r.status === 200, 'the session is created', r.status);
    ok(sent.length === 1 && /price_pro_y/.test(sent[0]),
       'with the YEARLY price id', (sent[0] || '').slice(0, 120));
    ok(!/price_pro_m/.test(sent[0] || ''), 'and not the monthly one', true);
  }

  section('And the monthly one otherwise, unchanged');
  {
    sent = [];
    const r = await W.stripeCheckout(post({ plan: 'pro' }), withYear);
    ok(r.status === 200, 'still works with no cycle at all', r.status);
    ok(/price_pro_m/.test(sent[0] || ''), 'opening the monthly price', (sent[0] || '').slice(0, 120));
  }

  section('A deployment with no yearly price says so, and sells monthly');
  {
    /* The refusal that matters: this plan IS sold here, just not by the year.
       "Unknown plan" would send somebody looking for a mistake they did not
       make - the reasoning the monthly refusal already uses, one field over. */
    sent = [];
    const r = await W.stripeCheckout(post({ plan: 'pro', cycle: 'year' }), baseEnv);
    const d = await r.json().catch(() => ({}));
    ok(r.status === 503, 'yearly is refused as a configuration gap, not a bad request', r.status);
    ok(d.code === 'not_configured', 'said as one', d.code);
    ok(d.secret === 'STRIPE_PRICE_PRO_YEAR', 'naming the exact secret to set', d.secret);
    ok(sent.length === 0, 'and Stripe was never asked, so nothing was charged', sent.length);

    const m = await W.stripeCheckout(post({ plan: 'pro' }), baseEnv);
    ok(m.status === 200, 'while monthly on the same deployment is untouched', m.status);
  }

  section('The webhook recognises a yearly price as the same plan');
  {
    /* THE HALF THAT WOULD LOSE SOMEBODY'S MONEY. The webhook is the only thing
       that turns money into access and it matches on price id. A yearly price
       missing from this map is a customer who paid for a year and stayed free. */
    const map = W.PLAN_FROM_PRICE(withYear);
    ok(map['price_pro_y'] === 'pro', 'the yearly Pro price grants Pro', map['price_pro_y']);
    ok(map['price_elite_y'] === 'elite', 'and Elite grants Elite', map['price_elite_y']);
    ok(map['price_ultra_y'] === 'ultra', 'and Ultra grants Ultra', map['price_ultra_y']);
    ok(map['price_pro_m'] === 'pro', 'with the monthly prices still mapped', map['price_pro_m']);
  }

  section('The page is only offered the choice where it works');
  {
    const read = async (env) => {
      const r = await W.publicConfig(new Request('https://x/v1/public-config', {
        headers: { 'CF-Connecting-IP': '1.1.1.' + Math.floor(Math.random() * 250) } }), env);
      return await r.json().catch(() => ({}));
    };
    const withY = await read(withYear);
    ok(Array.isArray(withY.yearlyPlans) && withY.yearlyPlans.includes('pro'),
       'a deployment that sells yearly says which plans', withY.yearlyPlans);
    const noY = await read(baseEnv);
    ok(!noY.yearlyPlans,
       'and one that does not says nothing, so no toggle is drawn', noY.yearlyPlans);
    /* The names, never the ids: the page needs to know the option exists. */
    ok(!JSON.stringify(withY).includes('price_pro_y'),
       'without handing out the price ids', JSON.stringify(withY).slice(0, 120));
  }
} finally {
  globalThis.fetch = keepFetch;
}

report();
done();
