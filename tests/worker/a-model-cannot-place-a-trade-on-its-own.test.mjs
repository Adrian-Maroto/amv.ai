/* THIS MOVES REAL MONEY ON A REGULATED VENUE.

   So the design is mostly about what AMV is not allowed to do, and the single
   load-bearing claim is this one: THE MODEL CANNOT TRADE.

   A trade is two requests. One QUOTES it; one EXECUTES a quote by its id. The
   quote is stored server-side with the exact market, side and size, expires in
   a minute, and can be spent once. So the model's reach ends at proposing
   terms nobody has seen, and the only thing that turns a proposal into a
   position is a person pressing a button beside the exact numbers.

   A confirmation dialog in the browser would not have achieved this. The model
   drives the browser, so anything the browser can do unaided the model can do
   unaided. The approval has to be something the SERVER requires and the client
   cannot mint - which is why it is a stored ticket and not a flag on a
   request.

   The rest is jurisdiction, which is not a disclaimer but the question of
   which venue may legally serve somebody at all, and caps, which are hard
   because a model that misreads a market must not be able to be wrong for
   more than a stated number of dollars. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'predict.harness.mjs');
writeFileSync(harness, src + `
export { predictMarkets, predictQuote, predictTrade, _predictVenuesFor,
         PREDICT_VENUES, PREDICT_MAX_TRADE_USD, PREDICT_MAX_DAY_USD, DB };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const mkEnv = (over) => Object.assign({
  JWT_SECRET: 'x'.repeat(40),
  KALSHI_API_KEY: 'k_test', POLYMARKET_API_KEY: 'p_test',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix } = {}) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true };
    },
  },
  AMV_COUNTER: {
    idFromName: (n) => ({ name: n }),
    get: (id) => ({
      async fetch(_u, init) {
        const b = JSON.parse(init.body); const k = 'c:' + id.name;
        const cur = store.get(k) || 0;
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'incr') { store.set(k, cur + b.amount); return new Response(JSON.stringify({ value: cur + b.amount })); }
        if (b.op === 'reserve') {
          if (cur + b.amount > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          store.set(k, cur + b.amount);
          return new Response(JSON.stringify({ allowed: true, value: cur + b.amount }));
        }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      },
    }),
  },
}, over || {});

W.__setRequireUser(async () => ({ email: 'trader@x.com', plan: 'pro' }));
const req = (url, body, country) => {
  const r = new Request('https://x' + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
    body: JSON.stringify(body || {}),
  });
  Object.defineProperty(r, 'cf', { value: { country: country || 'GB' } });
  return r;
};
async function adult(env) {
  store.clear();
  await W.DB.put(env, 'consent', 'trader@x.com', { birthYear: 1990, at: Date.now() });
}

/* Stand in for the venue. */
let sent = [];
let venueReply = { ok: true, status: 200, json: { order_id: 'o_1' } };
const keepFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  if (/kalshi|polymarket/.test(String(u))) {
    sent.push({ url: String(u), body: String((o && o.body) || '') });
    if (venueReply.throws) throw new Error('timeout');
    return new Response(JSON.stringify(venueReply.json), { status: venueReply.status });
  }
  return keepFetch(u, o);
};

section('A trade cannot be placed without an approval that the server issued');
{
  const env = mkEnv(); await adult(env);
  sent = [];
  /* Everything a model would need to describe a trade, sent straight to the
     execute route. If this worked, every guarantee in the file is decoration. */
  for (const body of [
    { venue: 'polymarket', market: 'ELECTION-2026', side: 'yes', usd: 50 },
    { quoteId: 'q_' + 'f'.repeat(32), venue: 'polymarket', market: 'X', side: 'yes', usd: 50 },
    { quoteId: 'not-a-real-id' },
    {},
  ]) {
    const r = await W.predictTrade(req('/v1/predict/trade', body), env);
    ok(r.status >= 400, 'refused: ' + JSON.stringify(body).slice(0, 60), r.status);
  }
  ok(sent.length === 0, 'and the venue was never called', sent.length);
}

section('The approved terms are the ones executed, not the ones resent');
{
  /* THE ATTACK THIS SHAPE EXISTS FOR. Somebody approves $5 on one market; the
     request that follows names $100 on another. If execution read the body,
     the approval would have been for a different trade than the one placed. */
  const env = mkEnv(); await adult(env);
  const q = await (await W.predictQuote(req('/v1/predict/quote',
    { venue: 'polymarket', market: 'RAIN-TOMORROW', side: 'yes', usd: 5 }), env)).json();
  ok(q.ok && q.quote && q.quote.id, 'a quote is issued', q.quote);

  sent = []; venueReply = { ok: true, status: 200, json: { order_id: 'o_9' } };
  const r = await W.predictTrade(req('/v1/predict/trade',
    { quoteId: q.quote.id, market: 'ELECTION-2026', side: 'no', usd: 100 }), env);
  const d = await r.json();
  ok(r.status === 200, 'the trade goes through', r.status);
  ok(d.placed.market === 'RAIN-TOMORROW' && d.placed.usd === 5 && d.placed.side === 'yes',
     'on the terms that were APPROVED, not the ones resent', d.placed);
  ok(sent.length === 1 && /RAIN-TOMORROW/.test(sent[0].body) && !/ELECTION/.test(sent[0].body),
     'and that is what reached the venue', sent[0] && sent[0].body);
}

section('An approval is spent once, and expires');
{
  const env = mkEnv(); await adult(env);
  const q = await (await W.predictQuote(req('/v1/predict/quote',
    { venue: 'polymarket', market: 'M1', side: 'yes', usd: 5 }), env)).json();
  sent = [];
  const first = await W.predictTrade(req('/v1/predict/trade', { quoteId: q.quote.id }), env);
  ok(first.status === 200, 'the first execution works', first.status);
  const second = await W.predictTrade(req('/v1/predict/trade', { quoteId: q.quote.id }), env);
  const d2 = await second.json();
  ok(second.status === 409 && d2.code === 'quote_expired',
     'the second is refused - a retry cannot double the position', d2);
  ok(sent.length === 1, 'and the venue was called exactly once', sent.length);
}

section('An approval belongs to the account that got it');
{
  const env = mkEnv(); await adult(env);
  const q = await (await W.predictQuote(req('/v1/predict/quote',
    { venue: 'polymarket', market: 'M2', side: 'yes', usd: 5 }), env)).json();
  /* THE OTHER ACCOUNT IS MADE FULLY ELIGIBLE FIRST, ON PURPOSE.

     Without a consent record it fails the age gate at 428 and the trade is
     refused - but by the wrong check, so this would have proved nothing about
     ownership. Written as `status >= 400` it would have passed happily with
     the ownership test deleted. Everything else about this account is in
     order, so the only thing left to refuse it is that the approval is not
     theirs. */
  await W.DB.put(env, 'consent', 'someone-else@x.com', { birthYear: 1990, at: Date.now() });
  W.__setRequireUser(async () => ({ email: 'someone-else@x.com', plan: 'pro' }));
  sent = [];
  const r = await W.predictTrade(req('/v1/predict/trade', { quoteId: q.quote.id }), env);
  const rd = await r.json();
  ok(r.status === 403 && rd.code === 'forbidden',
     'another account cannot spend it, and is refused for THAT reason', { status: r.status, code: rd.code });
  ok(sent.length === 0, 'and nothing was placed', sent.length);
  W.__setRequireUser(async () => ({ email: 'trader@x.com', plan: 'pro' }));
}

section('Where somebody is decides which venue, and the browser does not vote');
{
  /* Not a disclaimer. Polymarket blocks US persons on its main venue, and
     offering it to somebody there would be inviting them to break its terms on
     AMV's suggestion. */
  ok(W._predictVenuesFor('US').indexOf('polymarket') < 0, 'Polymarket is not offered in the US', W._predictVenuesFor('US'));
  ok(W._predictVenuesFor('US').indexOf('kalshi') >= 0, 'the regulated venue is', W._predictVenuesFor('US'));
  ok(W._predictVenuesFor('GB').indexOf('kalshi') < 0, 'and the US-only venue is not offered elsewhere', W._predictVenuesFor('GB'));

  const env = mkEnv(); await adult(env);
  sent = [];
  const r = await W.predictQuote(req('/v1/predict/quote',
    { venue: 'polymarket', market: 'M', side: 'yes', usd: 5 }, 'US'), env);
  const d = await r.json();
  ok(r.status === 403 && d.code === 'venue_blocked', 'a US request is refused at quote time', d);

  /* And again at EXECUTION, because somebody can move between the two. */
  const ok1 = await (await W.predictQuote(req('/v1/predict/quote',
    { venue: 'polymarket', market: 'M', side: 'yes', usd: 5 }, 'GB'), env)).json();
  const moved = await W.predictTrade(req('/v1/predict/trade', { quoteId: ok1.quote.id }, 'US'), env);
  ok(moved.status === 403, 'a quote taken abroad cannot be executed from the US', moved.status);
  ok(sent.length === 0, 'and no trade was placed at any point', sent.length);
}

section('The caps are hard, and checked before anything is placed');
{
  const env = mkEnv(); await adult(env);
  sent = [];
  const big = await W.predictQuote(req('/v1/predict/quote',
    { venue: 'polymarket', market: 'M', side: 'yes', usd: W.PREDICT_MAX_TRADE_USD + 1 }), env);
  const bd = await big.json();
  ok(big.status === 400 && bd.code === 'over_trade_cap', 'one trade cannot exceed the per-trade cap', bd);

  /* And the day adds up. */
  let placed = 0;
  for (let i = 0; i < 10; i++) {
    const q = await (await W.predictQuote(req('/v1/predict/quote',
      { venue: 'polymarket', market: 'M' + i, side: 'yes', usd: 50 }), env)).json();
    if (!q.ok) break;
    const t = await W.predictTrade(req('/v1/predict/trade', { quoteId: q.quote.id }), env);
    if (t.status === 200) placed += 50; else break;
  }
  ok(placed <= W.PREDICT_MAX_DAY_USD, 'the day stops at the daily cap', '$' + placed);
  ok(sent.length * 50 <= W.PREDICT_MAX_DAY_USD, 'and no more than that reached the venue', sent.length);
}

section('A deployment with no key attempts nothing');
{
  const env = mkEnv({ KALSHI_API_KEY: '', POLYMARKET_API_KEY: '' });
  await adult(env);
  sent = [];
  const r = await W.predictQuote(req('/v1/predict/quote',
    { venue: 'polymarket', market: 'M', side: 'yes', usd: 5 }), env);
  const d = await r.json();
  ok(r.status === 503 && d.code === 'needs_service',
     'it says the venue is not connected rather than failing', d);
  ok(/Nothing was attempted/i.test(d.error), 'and says plainly that nothing was attempted', d.error);
  ok(sent.length === 0, 'because nothing was', sent.length);
}

section('Money means adult, on the same gate the checkout uses');
{
  const env = mkEnv();
  store.clear();                                   // no consent record at all
  const r = await W.predictQuote(req('/v1/predict/quote',
    { venue: 'polymarket', market: 'M', side: 'yes', usd: 5 }), env);
  ok(r.status === 428, 'an account that has not confirmed its age is asked first', r.status);

  await W.DB.put(env, 'consent', 'trader@x.com', { birthYear: new Date().getUTCFullYear() - 15, at: Date.now() });
  const r2 = await W.predictQuote(req('/v1/predict/quote',
    { venue: 'polymarket', market: 'M', side: 'yes', usd: 5 }), env);
  ok(r2.status === 403, 'and a minor is refused', r2.status);
}

section('A venue that does not answer is not reported as "nothing happened"');
{
  /* The request may have arrived. Saying nothing was placed would be a guess
     about somebody's money, and the wrong guess makes them trade twice. */
  const env = mkEnv(); await adult(env);
  const q = await (await W.predictQuote(req('/v1/predict/quote',
    { venue: 'polymarket', market: 'M', side: 'yes', usd: 5 }), env)).json();
  sent = []; venueReply = { throws: true };
  const r = await W.predictTrade(req('/v1/predict/trade', { quoteId: q.quote.id }), env);
  const d = await r.json();
  venueReply = { ok: true, status: 200, json: { order_id: 'o_1' } };
  ok(r.status === 504 && d.code === 'venue_timeout', 'it reports that it cannot tell', d.code);
  ok(/cannot tell whether/i.test(d.error), 'in those words', d.error);
  ok(/[Cc]heck your positions/.test(d.error), 'and says what to do about it', d.error);
}

globalThis.fetch = keepFetch;
if (report('a-model-cannot-place-a-trade-on-its-own') > 0) process.exitCode = 1;
done();
