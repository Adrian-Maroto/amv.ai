/* THE CAP COULD NOT SEE THE SPEND MOST LIKELY TO RUN AWAY.

   There is one daily spend ceiling, and it exists for the reason a ceiling
   always exists: a runaway bill kills a company faster than no customers do.

   It was checked in two places - chat and the widget - and the counter it reads
   was incremented in two places, the stream meter and the automation tick.
   Image generation and video generation, which called a paid provider and cost
   many times what a message costs, did neither. They never asked the ceiling
   for permission, and their cost never reached the number the ceiling reads.

   Those two features are gone. What they left behind is _spendGate - the one
   place a path asks both ceilings and books what it is about to spend - and
   the rule that a path added later must go through it. SMS is the caller that
   proves it still works, and SMS is also the path that had the same hole: it
   asked the ACCOUNT's monthly ceiling inline and never asked the day's, so the
   control that stops a runaway bill could not see the cheapest way to produce
   real concurrency against AMV.

   Three consequences, and the third is the quiet one:

     - the control could not stop the spend most able to run away;
     - the owner's daily spend figure understated the real bill;
     - per-account cost, and the list of accounts costing more than they pay,
       left out the accounts most likely to be on it.

   A number that is quietly wrong is worse than one that is missing, because
   somebody steers by it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { functionBody, codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ceiling.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, setEntitlement, todayKey, monthKey, FREE_TIER_CAP_SHARE, FREE_AUTO_CEILING_USD, _monthlyCeilingUSD, _spendGate, _releaseSpendGate, _periodKeyFor, _periodStartISO };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const CAP = 100;
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv() {
  const m = new Map(); const vals = new Map();
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    GLOBAL_DAILY_USD_CAP: String(CAP),
    _vals: vals,
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
        const b = JSON.parse(init.body); const cur = vals.get(x) || 0;
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: cur < b.cap, value: cur }));
        if (b.op === 'incr') { vals.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(x) })); }
        if (b.op === 'reserve') {
          const next = cur + (b.amount || 0);
          if (next > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          vals.set(x, next); return new Response(JSON.stringify({ allowed: true, value: next }));
        }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'rateCheck') { vals.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') { if (vals.has('c:' + x)) return new Response(JSON.stringify({ claimed: false })); vals.set('c:' + x, 1); return new Response(JSON.stringify({ claimed: true })); }
        if (b.op === 'release') { vals.delete('c:' + x); return new Response(JSON.stringify({ ok: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const PW = 'A-real-Passw0rd!';
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '70.0.0.' + Math.floor(Math.random() * 250),
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const signup = async (env, email) => (await (await call(env, '/auth/signup', { email, name: 'N', password: PW })).json()).token;

const spend = (env) => env._vals.get(`spend:${W.todayKey()}`) || 0;
const spendToday = (env, usd) => env._vals.set(`spend:${W.todayKey()}`, usd);
/* The gate is asked directly. Driving it through a handler was how this suite
   read when image generation existed and had a fixed published price; SMS, the
   caller that replaced it, needs a linked phone and a signed Twilio webhook to
   reach, and testing the ceiling through all of that would be testing Twilio.
   What has to be true is a property of the gate plus the fact that the paths
   that spend go through it, and both are asserted here. */
const principal = (email, plan, extra) =>
  Object.assign({ email, plan, billingSubject: email }, extra || {});
const USD = 0.02;

section('The gate books what it is about to allow, on both counters');
{
  const env = mkEnv();
  const before = spend(env);
  const book = {};
  const refused = await W._spendGate(env, principal('spender@example.com', 'ultra'), 'sms', USD, book);
  ok(refused === null, 'the call is allowed', refused && refused.status);
  ok(Math.abs(spend(env) - before - USD) < 1e-9, 'the day\u2019s spend went up by what it will cost', spend(env) - before);
  ok(Math.abs(book.global - USD) < 1e-9, 'and the caller is told what was booked globally', book.global);
  ok(Math.abs(book.account - USD) < 1e-9, 'and on the account, so it can settle the difference', book.account);
  ok(book.accountName.indexOf('spender@example.com') > 0,
     'against the account that spent it, so unit economics can see it', book.accountName);
}

section('Past the ceiling it refuses, and books nothing');
{
  const env = mkEnv();
  spendToday(env, CAP + 1);
  const book = {};
  const r = await W._spendGate(env, principal('over@example.com', 'ultra'), 'sms', USD, book);
  ok(r && r.status === 503, 'it is refused', r && r.status);
  const body = await r.json();
  ok(body.code === 'global_cap', 'by the ceiling, saying so', body.code);
  ok(book.global === 0, 'and nothing was booked against the day', book.global);
}

section('Being refused does not also cost them their own allowance');
{
  /* The account reservation is taken FIRST. Refusing at the day's ceiling
     without giving it back would mean somebody turned away for capacity also
     lost part of the allowance their plan includes - charged for work that
     never ran, by the control that stopped it running. */
  const env = mkEnv();
  spendToday(env, CAP + 1);
  const user = principal('refunded@example.com', 'ultra');
  const key = `cost:refunded@example.com:${W._periodKeyFor(null, 'ultra', null)}`;
  const before = env._vals.get(key) || 0;
  const book = {};
  await W._spendGate(env, user, 'sms', USD, book);
  const after = env._vals.get(key) || 0;
  ok(Math.abs(after - before) < 1e-9, 'the account allowance is given back', { before, after });
  ok(book.account === 0, 'and the caller is not told it holds one', book.account);
}

section('On a busy day it is the free tier that stops, not the customer');
{
  /* Turning away somebody who has paid is a refund, then a chargeback, then a
     review. Above the free share and below the whole ceiling, free stops. */
  const env = mkEnv();
  spendToday(env, CAP * W.FREE_TIER_CAP_SHARE + 1);

  const a = await W._spendGate(env, principal('freehand@example.com', 'free'), 'sms', USD, {});
  ok(a && a.status === 503, 'the free account is turned away', a && a.status);
  const ab = await a.json();
  ok(ab.code === 'free_capacity', 'and told which kind of busy this is', ab.code);
  ok(/free accounts/i.test(ab.error || ''), 'in words that are true and worth knowing', ab.error);

  const b = await W._spendGate(env, principal('paidhand@example.com', 'ultra'), 'sms', USD, {});
  ok(b === null, 'while somebody who paid still gets through', b && b.status);
}

section('A reservation that is handed back leaves nothing behind');
{
  /* The work did not happen, so neither counter should still be holding money
     for it. Both halves, because releasing only the account half is the shape
     that leaves the day's ceiling creeping up on failures nobody was charged
     for - and a ceiling that rises without spend refuses real customers. */
  const env = mkEnv();
  const user = principal('failed@example.com', 'ultra');
  const key = `cost:failed@example.com:${W._periodKeyFor(null, 'ultra', null)}`;
  const book = {};
  await W._spendGate(env, user, 'sms', USD, book);
  await W._releaseSpendGate(env, book);
  ok(Math.abs((env._vals.get(key) || 0)) < 1e-9, 'the account holds nothing', env._vals.get(key));
  ok(Math.abs(spend(env)) < 1e-9, 'and neither does the day', spend(env));
}

section('A free account is not left to the global share alone');
{
  /* _monthlyCeiling answers null for a free account - there is no plan
     backstop and no family limit - so the account half of the gate does not
     run and the only thing left is the free share of the DAY'S ceiling. That
     is a budget for every free account at once, not for one of them. A caller
     with its own free-tier ceiling passes it in, or routing that caller
     through the shared gate would be a downgrade for exactly the accounts
     that pay nothing. SMS is that caller. */
  const env = mkEnv();
  const user = principal('texter@example.com', 'free');
  const opts = { fallbackCeilingUSD: W.FREE_AUTO_CEILING_USD };
  let allowed = 0, refusedCode = '';
  for (let i = 0; i < 40 && !refusedCode; i++) {
    const r = await W._spendGate(env, user, 'sms', USD, {}, opts);
    if (r) refusedCode = (await r.json()).code || 'refused'; else allowed++;
  }
  ok(refusedCode !== '', 'a free account texting in a loop is eventually stopped', { allowed, refusedCode });
  ok(allowed * USD <= W.FREE_AUTO_CEILING_USD + USD,
     'at its own free monthly ceiling, not at the whole free share of the day',
     { spent: +(allowed * USD).toFixed(4), ceiling: W.FREE_AUTO_CEILING_USD });
  ok(spend(env) < CAP * W.FREE_TIER_CAP_SHARE,
     'which is far below the day\u2019s free share, so one number cannot drain it', spend(env));
  /* And without the fallback the same account is NOT bounded by an account
     ceiling - which is what makes passing it a real decision rather than
     decoration. */
  const env2 = mkEnv();
  const r2 = await W._spendGate(env2, principal('nofallback@example.com', 'free'), 'sms', 5, {});
  ok(r2 === null, 'while a free caller that passes none has no account ceiling at all', r2 && r2.status);
}

section('And SMS really goes through it, rather than keeping its own copy');
{
  /* The defect this file exists for was a path nobody had put inside the
     ceiling. SMS was the last one: it asked the account\u2019s monthly ceiling
     inline and never asked the day\u2019s, so the control that stops a runaway
     bill could not see the cheapest way to make AMV spend in parallel. */
  const sms = codeOnly(functionBody(src, 'smsIncoming') || '');
  ok(sms.length > 1000, 'the SMS handler was found', sms.length);
  ok(/_spendGate\(env, user, 'sms'/.test(sms),
     'SMS asks the shared gate', true);
  ok(/fallbackCeilingUSD: FREE_AUTO_CEILING_USD/.test(sms),
     'passing its own free-tier ceiling, so a free number is still bounded', true);
  ok(!/_reserveUSD\(/.test(sms),
     'and no longer reserves against a ceiling it worked out itself', true);
  ok(/_releaseSpendGate\(env, smsBook\)/.test(sms),
     'and gives both reservations back when the turn produced nothing', true);
}

section('Every path that calls a paid provider goes through the one gate');
{
  /* Stated as a source rule, because the defect was not a wrong number - it was
     a path nobody had put inside the ceiling, and the next one added would be
     outside it for the same reason. */
  const gated = ['aiProxy', 'widgetChat', 'smsIncoming', 'runDueAutomations'];
  const missing = gated.filter(fn => {
    const m = src.match(new RegExp('async function ' + fn + '\\s*\\('));
    if (!m) return true;
    const nexts = [src.indexOf('\nasync function ', m.index + 10), src.indexOf('\nfunction ', m.index + 10)].filter(i => i > 0);
    const body = src.slice(m.index, Math.min(...nexts));
    return !/_spendGate\(|GLOBAL_DAILY_USD_CAP|_globalSpendCap|spend:\$\{todayKey/.test(body);
  });
  ok(missing.length === 0, 'no spending path is outside the day’s ceiling', missing);
}

globalThis.fetch = realFetch;
/* ── A PARENT'S LIMIT IS A LIMIT ON EVERYTHING, NOT ON CHAT ──────────────────

   The ceiling that stops chat was written inside the chat handler, so it bound
   chat and nothing else. Image and video were bounded by a plan COUNT - so
   many images a day - and a count is not a dollar limit. A parent who set $10
   a month had a child who stopped at $10 of conversation and could then run
   the plan's whole daily image allowance every day, and video at fifty cents
   a call, indefinitely.

   Same shape as the defect this file was written for, one level down: there
   the DAILY ceiling was blind to the two most expensive calls, here the
   PER-ACCOUNT one was. Both because the rule lived where one path could see
   it. There is one definition now and both paths ask it. */
section('The account ceiling binds every spending path, not only chat');
{
  /* DERIVED, not named. This asserted the literal `_monthlyCeilingUSD`, so a
     rename would have failed it for the wrong reason - and, worse, a rename
     that split the helper in two could have satisfied it while chat and media
     quietly asked DIFFERENT functions again, which is the defect this file
     exists for. What matters is that both paths reach the SAME one. */
  const gate = functionBody(src, '_spendGate');
  const CEIL = /_monthlyCeiling(?:USD)?\(/g;
  const gateAsks = [...new Set((gate.match(CEIL) || []))];
  ok(gateAsks.length === 1,
     'the shared gate asks for this account’s ceiling, from one helper', gateAsks);
  ok(/family_cap/.test(gate),
     'and can refuse for the family limit specifically, so the message names the person who can change it', true);

  /* One definition, not two that drift. The whole reason this was missed is
     that the rule existed in exactly one handler. */
  const defs = (src.match(/function _monthlyCeilingUSD\(/g) || []).length;
  ok(defs === 1, 'the ceiling is defined once', defs);
  /* Both ends of this window are CODE. The far end used to be the comment
     `// 4) GLOBAL SPEND CAP`, so renumbering or rewording a section heading
     moved the boundary - and if the heading were deleted, indexOf returns -1,
     slice() reads to the end of the string and the window silently becomes
     everything before the start marker instead of the chat path. */
  /* The chat path is aiProxy, so that is what is read.

     The window here used to run from the FIRST `const costName = ...` in the
     file to the comment `// 4) GLOBAL SPEND CAP`. The first of those is in
     _spendGate, seven thousand lines earlier, so the window was most of the
     Worker and the assertion below passed on any mention of the helper
     anywhere in it. A window that large is not a window. */
  const chat = codeOnly(functionBody(src, 'aiProxy'));
  ok(chat.length > 2000, 'the chat handler was found', chat.length);
  const chatAsks = [...new Set((chat.match(CEIL) || []))];
  ok(chatAsks.length === 1, 'and chat asks one too', chatAsks);
  ok(chatAsks[0] === gateAsks[0],
     'and it is the same helper, which is the whole point',
     { chat: chatAsks[0], gate: gateAsks[0] });

  /* And that helper is the one holding the rule, not a wrapper that forwards
     to a second copy. */
  const body = codeOnly(functionBody(src, '_monthlyCeiling'));
  ok(/0\.45/.test(body), 'and that helper is where the plan share is decided', true);
  ok(!/planPriceUSD\(user\.plan[^)]*\) \* 0\.45/.test(chat),
     'rather than keeping its own copy of the arithmetic', true);
}

section('A cap of zero really is zero');
{
  /* A parent switching paid compute off has to mean it - including for the
     calls that never consulted them before. */
  const child = { email: 'kid@x.com', plan: 'pro', family: { limits: { monthlyUSD: 0 } } };
  const ceiling = W._monthlyCeilingUSD(child);
  ok(ceiling === 0, 'zero survives as zero rather than falling back to the plan', ceiling);

  /* THE CASE THAT ACTUALLY BREAKS, and the first version of this section
     missed it. On a paid plan the plan's own backstop is above zero, so a
     falsy-vs-null slip in the guard is hidden by it - a sabotage swapping
     `familyCapUSD == null` for `!familyCapUSD` passed. On the FREE plan there
     is no backstop, so the same slip returns "no ceiling at all": a parent who
     switched paid compute off for a child would have switched off the limit
     instead. Zero and absent are different answers and the free child is where
     the difference shows. */
  const freeChild = { email: 'kid2@x.com', plan: 'free', family: { limits: { monthlyUSD: 0 } } };
  const freeCeiling = W._monthlyCeilingUSD(freeChild);
  ok(freeCeiling === 0,
     'a free child with the cap set to zero has a ceiling of zero, not none', freeCeiling);
  ok(freeCeiling !== null,
     'and null would mean unlimited, which is the opposite of what the parent asked for', freeCeiling);

  const adult = { email: 'a@x.com', plan: 'pro' };
  ok((W._monthlyCeilingUSD ? W._monthlyCeilingUSD(adult) : 1) > 0,
     'while an ordinary account still gets the plan backstop', W._monthlyCeilingUSD && W._monthlyCeilingUSD(adult));

  const lower = { email: 'k@x.com', plan: 'ultra', family: { limits: { monthlyUSD: 5 } } };
  ok((W._monthlyCeilingUSD ? W._monthlyCeilingUSD(lower) : 0) === 5,
     'and the lower of the two wins - a parent can spend less than the plan allows, never more',
     W._monthlyCeilingUSD && W._monthlyCeilingUSD(lower));
}

section('And the widget spends the owner’s money against the owner’s ceiling');
{
  /* The widget was bounded by three things, none of them this one: a per-widget
     message cap, a per-widget daily spend cap the owner sets and which defaults
     to unlimited, and the owner's TOKEN allowance. Tokens are a count. The
     dollar ceiling that stops chat, image, video and SMS was never asked, so a
     widget belonging to a capped account ran past the limit somebody set. */
  /* The whole handler, not a fixed number of characters from its start. The
     window used to be 9000, which is a guess about how long the function is -
     it drifted past the line it was looking for the moment the handler grew,
     and reported the ceiling as missing when it was three lines further down.
     A check that fails when unrelated code moves is a check people learn to
     edit rather than believe. */
  const wc = functionBody(src, 'widgetChat');
  ok(wc.length > 2000, 'the widget handler was read in full', wc.length);
  ok(/_monthlyCeilingUSD\(ownerUser\)/.test(wc),
     'the widget asks the same ceiling as every other spending path', true);
  ok(/cost:\$\{ownerSubject\}/.test(wc),
     'against the OWNER’s billing subject, since it is their money whoever is typing', true);

  /* AND THAT THE COUNTER IT ASKS IS THE COUNTER IT FEEDS.

     Checking `cost:<owner>` was only ever half of it. The metering handed
     meterStream `costName: wSpendName` - the per-widget tally - so the owner's
     account counter was read before every turn and written by none of them. The
     ceiling was real, keyed correctly, and unreachable: a widget could run for
     ever against a limit that never moved.

     Same shape as the SMS ceiling and the wash-trading signal, and invisible
     for the same reason - a number that never rises looks exactly like an
     account that has not spent anything. */
  ok(/acctCostName: ownerCostName/.test(wc),
     'and the owner’s ledger is what the turn is metered into, not only checked', true);
  const meter = functionBody(src, 'meterStream');
  ok(/if \(acctCostName\)/.test(meter) && /counter\(env, acctCostName, \{ op: 'incr'/.test(meter),
     'which the metering really increments', true);
  ok(/_familyOf\(env, ownerEmail/.test(wc),
     'and the owner’s family limits are resolved, so a parent’s cap reaches a widget their child deployed', true);
  ok(/unavailable right now/.test(wc),
     'a stranger on somebody else’s website is told nothing about that person’s billing', true);
}

if (report('the-ceiling-covers-what-costs-most') > 0) process.exitCode = 1;
done();
