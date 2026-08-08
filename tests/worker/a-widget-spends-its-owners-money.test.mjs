/* A CANCELLED CUSTOMER'S WIDGET WENT ON SPENDING AMV'S MONEY FOR EVER.

   The embeddable widget is the only part of AMV that runs on somebody else's
   website, answering people who have no account here. It was metered against
   a synthetic user:

       user: { email: 'widget:' + key, plan: 'widget' },
       limits: { dayTokens: Infinity, monthTokens: Infinity },

   so a widget's spend came out of nobody's allowance. The only ceilings were
   the ones its OWNER sets: a $5/day default they can raise, and a message cap
   where 0 means no limit. Nothing anywhere read the owner's entitlement.

   So: sign up, embed a widget, cancel your subscription - and your site keeps
   serving visitors, on AMV's model budget, indefinitely. There is no plan gate
   on creating a widget either, so the same was true of a Free account that had
   never paid anything at all.

   It now reserves against the owner's real allowance before the model is
   called, which is the only thing that stops spend rather than recording it.
   A paying customer notices nothing. Somebody who has stopped paying gets the
   free allowance, which is the honest answer to what a free account gets, and
   _planOf is what applies a lapsed subscription so a past-due account degrades
   on the same clock as everything else.

   The other half is the one this file also had to cover: it must keep WORKING
   for the customer who is paying. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'widgetown.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, widgetChat, PLAN_LIMITS };\n');
const W = await import(harness + '?t=' + Date.now());

const KEY = 'pk_widgettest';
const OWNER = 'siteowner@example.com';

let calls = [];
const realFetch = globalThis.fetch;
const sse = () => 'data: {"type":"message_start","message":{"usage":{"input_tokens":50,"output_tokens":0}}}\n\n'
                + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n'
                + 'data: {"type":"message_delta","usage":{"output_tokens":50}}\n\n'
                + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), key: (opts && opts.headers && opts.headers['x-api-key']) });
  return new Response(sse(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

/* Counters that behave like the Durable Object: reserve refuses past the cap. */
function mkEnv(extra) {
  const m = new Map();
  const vals = new Map();
  calls = [];
  return Object.assign({
    AMV_MODEL_KEY: 'test-model-key',
    MODEL_API_URL: 'https://model.example',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) {
        return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body);
        const cur = vals.get(n) || 0;
        if (b.op === 'reserve') {
          const cap = b.cap;
          if (cap != null && cap !== Infinity && cur + b.amount > cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          vals.set(n, cur + b.amount);
          return new Response(JSON.stringify({ allowed: true, value: cur + b.amount }));
        }
        if (b.op === 'incr') { vals.set(n, Math.max(0, cur + b.amount)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: b.cap == null || cur < b.cap, value: cur }));
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: cur + 1 <= (b.limit || 999) })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
    _vals: vals,
  }, extra || {});
}

async function seedWidget(env, cfg) {
  const w = Object.assign({
    key: KEY, owner: OWNER, enabled: true, model: 'amv-core',
    origins: [], dailyMsgCap: 0, dailySpendCapUSD: 0, maxOut: 512,
    systemPrompt: 'be helpful', title: 'Chat', greeting: 'hi',
  }, cfg || {});
  await W.DB.put(env, 'widget', KEY, w);
  await W.DB.put(env, 'widget_owner', OWNER, w);
}
const setPlan = (env, plan, extra) =>
  W.DB.put(env, 'ent', OWNER, Object.assign({ plan, updatedAt: Date.now() }, extra || {}));

const ask = (env) => W.widgetChat(new Request('https://api.amv.dev/v1/widget/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Origin': 'https://customer-site.example', 'CF-Connecting-IP': '3.3.3.3' },
  body: JSON.stringify({ key: KEY, messages: [{ role: 'user', content: 'hello there' }] }),
}), env, { waitUntil() {}, passThroughOnException() {} });

section('A paying owner’s widget answers visitors, as it always did');
{
  const env = mkEnv();
  await seedWidget(env);
  await setPlan(env, 'ultra');
  const r = await ask(env);
  ok(r.status === 200, 'the visitor gets an answer', r.status);
  ok(calls.length === 1, 'and the model was really called', calls.length);
  ok(calls[0].key === 'test-model-key', 'with the key, which stays on the server', !!calls[0].key);
}

section('The spend comes out of the OWNER’s allowance now');
{
  /* It came out of nobody's. Without this a widget is an unmetered hole in
     whatever plan its owner is on. */
  const env = mkEnv();
  await seedWidget(env);
  await setPlan(env, 'ultra');
  await ask(env);
  const spent = [...env._vals.keys()].filter(k => /^usg:siteowner@example\.com:/.test(k));
  ok(spent.length >= 1,
     'the turn is reserved against the owner’s own usage counters', spent);
  ok((env._vals.get(spent[0]) || 0) > 0, 'and really consumed some of it', env._vals.get(spent[0]));
}

section('An owner who has spent their allowance stops, however their caps are set');
{
  /* dailyMsgCap and dailySpendCapUSD are both 0 here, which the product treats
     as NO LIMIT - exactly the configuration that made this unbounded. The
     owner's plan allowance is what stops it now. */
  const env = mkEnv();
  await seedWidget(env, { dailyMsgCap: 0, dailySpendCapUSD: 0 });
  await setPlan(env, 'free');
  const cap = W.PLAN_LIMITS.free.dayTokens;
  env._vals.set(`usg:${OWNER}:${new Date().toISOString().slice(0, 10)}`, cap);
  const r = await ask(env);
  ok(r.status === 429, 'the visitor is turned away', r.status);
  ok(calls.length === 0, 'and the model is never called, so it costs nothing', calls.length);
  const body = await r.json();
  ok(!/plan|billing|subscription|owner/i.test(body.error || ''),
     'without telling a stranger anything about the owner’s billing', body.error);
}

section('A cancelled subscription bounds the widget the same day it lapses');
{
  /* The failure this file is named for. pastDueSince past the grace window is
     what _planOf turns into "free", so the widget degrades on exactly the same
     clock as everything else the account has - no separate rule to forget. */
  const env = mkEnv();
  await seedWidget(env, { dailyMsgCap: 0, dailySpendCapUSD: 0 });
  await setPlan(env, 'ultra', { pastDueSince: Date.now() - 40 * 86400000 });

  /* Spend to just past the FREE allowance. On the old code this was Infinity
     and would have sailed through; on the sold plan (ultra) it is nowhere
     near the limit, so only the lapse can be what stops it. */
  env._vals.set(`usg:${OWNER}:${new Date().toISOString().slice(0, 10)}`, W.PLAN_LIMITS.free.dayTokens);
  const r = await ask(env);
  ok(r.status === 429,
     'a lapsed account’s widget is held to the free allowance', r.status);
  ok(calls.length === 0, 'and stops costing AMV money', calls.length);
}

section('While the same usage on the plan they are paying for goes through');
{
  /* The other half, and the one that would be a support call: the bound must
     not fire on somebody who is current. */
  const env = mkEnv();
  await seedWidget(env, { dailyMsgCap: 0, dailySpendCapUSD: 0 });
  await setPlan(env, 'ultra');
  env._vals.set(`usg:${OWNER}:${new Date().toISOString().slice(0, 10)}`, W.PLAN_LIMITS.free.dayTokens);
  const r = await ask(env);
  ok(r.status === 200, 'a paying owner is unaffected by the free limit', r.status);
  ok(calls.length === 1, 'and their visitors keep getting answers', calls.length);
}

section('With no model key it refuses instead of calling out with an empty one');
{
  /* The guard aiProxy gained and this path had not. It reserved the caps and
     then sent `x-api-key: ''`, so a visitor on a customer's own website waited
     for a round trip that could not succeed. */
  const env = mkEnv({ AMV_MODEL_KEY: '' });
  await seedWidget(env);
  await setPlan(env, 'ultra');
  const r = await ask(env);
  ok(r.status === 503, 'the turn is refused', r.status);
  ok(calls.length === 0, 'and nothing goes out with an empty key', calls.length);
  const body = await r.json();
  ok(!/key|AMV_MODEL_KEY|configur/i.test(body.error || ''),
     'the visitor is not shown AMV’s configuration problem', body.error);
}

section('A turn refused AFTER the reservation gives it back');
{
  /* The reservation is taken before the model is called, so every later exit
     has to release it or a widget eats its owner's allowance for answers
     nobody ever received - which over a provider outage is the whole day's.

     The GLOBAL spend cap is deliberately the one used here: it is checked
     AFTER the owner reservation, so there is really something to give back.
     An earlier version of this case tripped the widget's own spend cap, which
     is checked BEFORE the reservation - so nothing had been taken, and the
     assertion passed no matter what the refund did. Deleting refundOwner did
     not fail it, which is how I found out. */
  const env = mkEnv({ GLOBAL_DAILY_USD_CAP: '1' });
  await seedWidget(env, { dailyMsgCap: 0, dailySpendCapUSD: 0 });
  await setPlan(env, 'ultra');
  const day = new Date().toISOString().slice(0, 10);
  const dayKey = `usg:${OWNER}:${day}`;
  env._vals.set(dayKey, 500);
  env._vals.set(`spend:${day}`, 5);            // already past the global cap

  const r = await ask(env);
  ok(r.status === 503, 'the platform-wide cap turns it away', r.status);
  ok(calls.length === 0, 'the model is not called', calls.length);
  ok((env._vals.get(dayKey) || 0) === 500,
     'and the owner’s allowance is exactly where it was', env._vals.get(dayKey));
}

section('The synthetic user with infinite limits is gone from the source');
{
  const chat = src.slice(src.indexOf('async function widgetChat'), src.indexOf('async function widgetChat') + 9000);
  ok(!/plan: 'widget'/.test(chat),
     'no stand-in account is billed instead of a person', true);
  ok(!/dayTokens: Infinity/.test(chat),
     'and nothing is metered against an infinite allowance', true);
  ok(/_planOf\(ownerEnt\)/.test(chat),
     'the owner’s effective plan is what applies', true);
}

globalThis.fetch = realFetch;
if (report('a-widget-spends-its-owners-money') > 0) process.exitCode = 1;
done();
