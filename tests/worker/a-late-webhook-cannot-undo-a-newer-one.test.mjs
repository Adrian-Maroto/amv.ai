/* THE ORDER THEY ARRIVE IN IS NOT THE ORDER THEY HAPPENED IN.

   Stripe and PayPal both deliver webhooks at least once, with no ordering
   guarantee, and both retry a failed delivery for days. Nothing here knew which
   event was newer, so the last one to land won - whatever it said.

   The sequence that costs money: a cancellation is delivered and applied, and
   then an earlier "still active" event, retried after its first delivery
   failed, arrives behind it. The cancelled customer is back on a paid plan,
   free, until somebody happens to look. Nothing errors; the audit trail shows a
   grant, because a grant is what happened.

   It cuts the other way too. A late cancellation landing after an upgrade
   somebody has just paid for takes away what they bought, and that is a support
   ticket from a customer who did everything right.

   What must not be broken in closing it: an admin edit, a referral bonus and a
   team seat change have no event behind them - they are a person or a rule
   deciding NOW - and must always apply. And two processors' clocks are not one
   timeline, so nothing is compared across them. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'evtorder.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, setEntitlement, _planOf };\n');
const W = await import(harness + '?t=' + Date.now());

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv() {
  const m = new Map(); const n = new Map();
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: all.slice(0, limit || 1000), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = n.get(x) || 0;
        if (b.op === 'claim') { if (n.has('c:' + x)) return new Response(JSON.stringify({ claimed: false })); n.set('c:' + x, 1); return new Response(JSON.stringify({ claimed: true })); }
        if (b.op === 'release') { n.delete('c:' + x); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'incr') { n.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: n.get(x) })); }
        if (b.op === 'rateCheck') { n.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const EMAIL = 'payer@example.com';
const planOf = async (env) => W._planOf(await W.DB.get(env, 'ent', EMAIL) || {});

const T0 = Date.parse('2026-08-09T12:00:00Z');
const EARLIER = T0;
const LATER = T0 + 60000;

section('A cancellation is not undone by a retried older event');
{
  /* The one that costs money. The cancel happened at 12:01 and the "still
     active" at 12:00, but the active one is the one that was retried and so
     lands second. */
  const env = mkEnv();
  await W.setEntitlement(env, EMAIL, 'ultra', { source: 'stripe', eventAt: EARLIER - 60000 });
  await W.setEntitlement(env, EMAIL, 'free', { source: 'stripe', canceled: true, eventAt: LATER });
  ok(await planOf(env) === 'free', 'the cancellation applied', await planOf(env));

  await W.setEntitlement(env, EMAIL, 'ultra', { source: 'stripe', eventAt: EARLIER });
  ok(await planOf(env) === 'free',
     'and the stale event that arrived after it did not put them back on a paid plan',
     await planOf(env));
}

section('And an upgrade is not undone by a late cancellation either');
{
  /* The other direction. Somebody paid, and a cancellation from before the
     upgrade arrives afterwards. Taking away what they just bought is the same
     defect wearing the other face. */
  const env = mkEnv();
  await W.setEntitlement(env, EMAIL, 'free', { source: 'stripe', canceled: true, eventAt: EARLIER });
  await W.setEntitlement(env, EMAIL, 'ultra', { source: 'stripe', eventAt: LATER });
  await W.setEntitlement(env, EMAIL, 'free', { source: 'stripe', canceled: true, eventAt: EARLIER });
  ok(await planOf(env) === 'ultra', 'they still have the plan they paid for', await planOf(env));
}

section('A newer event still applies, or nothing would ever change again');
{
  /* The failure this could introduce: a guard so eager that a real cancellation
     stops working and AMV serves cancelled customers for ever. */
  const env = mkEnv();
  await W.setEntitlement(env, EMAIL, 'ultra', { source: 'stripe', eventAt: EARLIER });
  await W.setEntitlement(env, EMAIL, 'free', { source: 'stripe', canceled: true, eventAt: LATER });
  ok(await planOf(env) === 'free', 'a genuinely later cancellation still lands', await planOf(env));
}

section('Two events at the very same moment do not deadlock into nothing');
{
  const env = mkEnv();
  await W.setEntitlement(env, EMAIL, 'pro', { source: 'stripe', eventAt: T0 });
  await W.setEntitlement(env, EMAIL, 'ultra', { source: 'stripe', eventAt: T0 });
  ok(await planOf(env) === 'ultra',
     'an event with the same timestamp is applied, not discarded', await planOf(env));
}

section('An admin edit is a person deciding now, and always applies');
{
  /* No event is behind it, so there is nothing to be older than. A guard that
     let a stale webhook block the owner from fixing an account by hand would be
     worse than the bug. */
  const env = mkEnv();
  await W.setEntitlement(env, EMAIL, 'free', { source: 'stripe', canceled: true, eventAt: LATER });
  await W.setEntitlement(env, EMAIL, 'ultra', { source: 'admin' });
  ok(await planOf(env) === 'ultra', 'the owner can still put somebody on a plan', await planOf(env));

  /* And it does not move the marker, so a webhook newer than the last real
     event still lands afterwards. */
  await W.setEntitlement(env, EMAIL, 'free', { source: 'stripe', canceled: true, eventAt: LATER + 60000 });
  ok(await planOf(env) === 'free', 'and a later processor event is still honoured', await planOf(env));
}

section('A referral bonus and a seat change are not webhooks either');
{
  const env = mkEnv();
  await W.setEntitlement(env, EMAIL, 'ultra', { source: 'stripe', eventAt: LATER });
  await W.setEntitlement(env, EMAIL, 'ultra', { source: 'referral', refBonus: 1000 });
  const ent = await W.DB.get(env, 'ent', EMAIL);
  ok((ent || {}).refBonus === 1000, 'a bonus with no event behind it applies', (ent || {}).refBonus);
}

section('The reconciliation sweep can still fix an account');
{
  /* The sweep exists precisely for accounts a webhook never reached: it reads
     the live subscription from the processor and writes what it finds. There is
     no event behind that - it is AMV asking "what is true now" - so it carries
     no timestamp, and a guard that blocked it would disable the one thing that
     repairs a customer whose webhook was lost. Which is the failure the whole
     ordering guard exists to avoid, arrived at from the other side. */
  const env = mkEnv();
  await W.setEntitlement(env, EMAIL, 'free', { source: 'stripe', canceled: true, eventAt: LATER + 3600000 });
  await W.setEntitlement(env, EMAIL, 'ultra', { source: 'stripe' });   // no eventAt: the sweep
  ok(await planOf(env) === 'ultra',
     'a live re-read of the subscription still grants the plan', await planOf(env));
}

section('One processor is not measured against another’s clock');
{
  /* Stripe's timestamps and PayPal's are two different timelines. Comparing
     them would let a PayPal event be discarded for being "older" than a Stripe
     one that has nothing to do with it. */
  const env = mkEnv();
  await W.setEntitlement(env, EMAIL, 'free', { source: 'stripe', canceled: true, eventAt: LATER + 3600000 });
  await W.setEntitlement(env, EMAIL, 'ultra', { source: 'paypal', eventAt: EARLIER });
  ok(await planOf(env) === 'ultra',
     'a PayPal event is judged against PayPal events only', await planOf(env));
}

section('The marker is on the record, so it survives the next write');
{
  const env = mkEnv();
  await W.setEntitlement(env, EMAIL, 'ultra', { source: 'stripe', eventAt: LATER });
  await W.setEntitlement(env, EMAIL, 'ultra', { source: 'admin' });      // no event
  const ent = await W.DB.get(env, 'ent', EMAIL);
  ok(+ent.lastEventAt === LATER, 'the last event applied is remembered', ent.lastEventAt);
  ok(ent.lastEventSrc === 'stripe', 'along with whose event it was', ent.lastEventSrc);
  ok(ent.eventAt === undefined, 'and the incoming field is not left lying on the record', ent.eventAt);
}

section('Every webhook write carries the event’s own time');
{
  /* A source rule: a handler added later that forgets to pass it would silently
     be back to last-writer-wins, and nothing else would notice. */
  const bodyOf = (fn) => {
    const m = src.match(new RegExp('async function ' + fn + '\\s*\\('));
    if (!m) return '';
    const nexts = [src.indexOf('\nasync function ', m.index + 10), src.indexOf('\nfunction ', m.index + 10)].filter(i => i > 0);
    return src.slice(m.index, Math.min(...nexts));
  };
  for (const fn of ['stripeWebhook', 'paypalWebhook']) {
    const body = bodyOf(fn);
    ok(!!body, fn + ' was found', !!body);
    const calls = [...body.matchAll(/setEntitlement\([^;]*?\);/gs)].map(m => m[0]);
    ok(calls.length > 0, fn + ' grants entitlements', calls.length);
    const blind = calls.filter(c => !/eventAt/.test(c));
    ok(blind.length === 0,
       'every entitlement write in ' + fn + ' says when the event happened',
       blind.map(c => c.slice(0, 70)));
  }
}

globalThis.fetch = realFetch;
if (report('a-late-webhook-cannot-undo-a-newer-one') > 0) process.exitCode = 1;
done();
