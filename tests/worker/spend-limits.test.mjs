/* SPENDING LIMITS, WHERE THEY CANNOT BE EDITED.

   The limits somebody sets - buy under this without asking, never more than this
   at once, never more than this a month - lived entirely in localStorage, and
   the browser agent enforced whatever `spendLimit` the client happened to send.
   So the ceiling was advisory. It protected the user from AMV misbehaving and
   not at all from a tampered or simply buggy client, and the only real bound was
   one global absolute cap shared by every account.

   The rule throughout: a bad value becomes ZERO, never "no limit". The whole
   failure being replaced is a missing or malformed number reading as
   permission. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'spend.harness.mjs');
writeFileSync(harness, src + `
export { _spendClean, _spendLimits, _spendAllowed, _spendReserve, _spendRelease, _spendRecord,
         spendGet, spendSet, _webIsMoney, _webSpendGate,
         WEB_ABSOLUTE_SPEND_CAP, SPEND_DEFAULTS, DB };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k, v){ store.set(k, String(v)); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys:[...store.keys()].filter(k=>k.startsWith(prefix||'')).map(name=>({name})), list_complete:true }; },
  },
};
W.__setRequireUser(async () => ({ email: 'a@x.com' }));
const req = (body) => new Request('https://x/v1/spend/set', { method:'POST', body: JSON.stringify(body || {}) });

section('A bad value is zero, never "no limit"');
{
  /* The exact shape of the bug this replaces: `amt > NaN` is false, so a
     malformed limit passed everything AND auto-approved it. */
  const bad = W._spendClean({ autoUnder: 'abc', perPurchase: null, monthlyCap: undefined });
  ok(bad.autoUnder === 0 && bad.perPurchase === 0 && bad.monthlyCap === 0,
     'nonsense collapses to zero', bad);
  const neg = W._spendClean({ autoUnder: -50, perPurchase: -1, monthlyCap: -999 });
  ok(neg.perPurchase === 0, 'and so does a negative', neg);
}

section('Limits that contradict each other are reconciled downwards');
{
  /* Believing you are protected by a number that can never apply is worse than
     having no number. */
  const c = W._spendClean({ autoUnder: 900, perPurchase: 100, monthlyCap: 50 });
  ok(c.perPurchase <= c.monthlyCap, 'a single purchase cannot exceed the month', c);
  ok(c.autoUnder <= c.perPurchase, 'and auto-buy cannot exceed a single purchase', c);
}

section('Nothing can be set above the absolute cap');
{
  const c = W._spendClean({ autoUnder: 1e9, perPurchase: 1e9, monthlyCap: 1e9 });
  ok(c.perPurchase <= W.WEB_ABSOLUTE_SPEND_CAP, 'a per-purchase limit is bounded', c.perPurchase);
  ok(c.monthlyCap <= 20000, 'and the monthly one', c.monthlyCap);
}

section('The off switch is on the side that cannot be edited');
{
  /* "Let AMV spend money for me" lived entirely in the browser. Somebody who
     had switched spending off - the control you reach for precisely when you do
     not trust this - was still permitted to spend by the server, which never
     knew. It is the strongest thing on the screen and it was the weakest thing
     in the product. */
  store.clear();
  const off = await W._spendAllowed(env, 'a@x.com', 5, 0);
  ok(off && off.code === 'spending_off',
     'an account that never turned spending on cannot spend, however small', off);

  await W.spendSet(req({ limits: { enabled: true, autoUnder: 10, perPurchase: 50, monthlyCap: 200 } }), env);
  ok(await W._spendAllowed(env, 'a@x.com', 5, 0) === null, 'turning it on lets a purchase through', true);

  await W.spendSet(req({ limits: { enabled: false, autoUnder: 10, perPurchase: 50, monthlyCap: 200 } }), env);
  const again = await W._spendAllowed(env, 'a@x.com', 5, 0);
  ok(again && again.code === 'spending_off', 'and turning it back off stops it again', again);
  ok(/switched off/.test(again.need) && /Settings/.test(again.message),
     'saying what is switched off and where to change it', again.need);
}

section('The account is what decides, not the request');
{
  store.clear();
  await W.spendSet(req({ limits: { enabled: true, autoUnder: 10, perPurchase: 50, monthlyCap: 200 } }), env);

  /* A client claiming a bigger allowance than the account holds is ignored -
     which is the entire point, because the client is the editable part. */
  const lying = await W._spendAllowed(env, 'a@x.com', 400, 5000);
  ok(lying && lying.code === 'over_limit', 'a forged higher limit does not raise the ceiling', lying);
  ok(/50\.00 single-purchase limit/.test(lying.need), 'the account\'s number is the one quoted', lying.need);

  /* A client asking for LESS is being more careful, and is honoured. */
  const careful = await W._spendAllowed(env, 'a@x.com', 30, 20);
  ok(careful && careful.code === 'over_limit', 'a smaller client limit still binds', careful);

  const fine = await W._spendAllowed(env, 'a@x.com', 30, 0);
  ok(fine === null, 'and a purchase inside the account limit goes through', fine);
}

section('The monthly ceiling is counted, not just displayed');
{
  /* The month moved from _spendAllowed to _spendReserve (AMV-036), because a
     ceiling that is READ and then, separately, incremented is one two runs walk
     through together. _spendAllowed still decides whether a purchase of this
     SIZE is permitted at all; _spendReserve is what books the money. */
  store.clear();
  await W.spendSet(req({ limits: { enabled: true, autoUnder: 10, perPurchase: 100, monthlyCap: 120 } }), env);
  const first = await W._spendReserve(env, 'a@x.com', 100, 0);
  ok(first.ok === true && first.reserved === 100, 'a purchase inside the month is booked', first);

  const over = await W._spendReserve(env, 'a@x.com', 50, 0);
  ok(over.refused && over.refused.code === 'over_monthly', 'spending past the month is refused', over);
  ok(/20\.00 is left/.test(over.refused.need), 'saying exactly what is left', over.refused.need);

  const under = await W._spendReserve(env, 'a@x.com', 15, 0);
  ok(under.ok === true, 'while what fits still goes through', under);

  /* And a refusal is not a booking: the refused $50 must not have moved the
     total, or a run refused twice would silently close the month. */
  const d = await (await W.spendGet(new Request('https://x/v1/spend/limits', { method:'POST', body:'{}' }), env)).json();
  ok(d.spentThisMonth === 115, 'a refusal counts nothing', d.spentThisMonth);
}

section('Twenty runs at once cannot walk through the same ceiling');
{
  /* The finding. This was a `get`, a compare, and later an `incr` - so two runs
     starting together both read the same total, both found room, and both went.
     On the one number a person sets specifically to stop AMV spending their
     money, and it needs a double-click rather than an attacker. */
  /* With the counter this really runs on. Without AMV_COUNTER bound, `counter`
     falls back to plain storage, and that fallback says in its own comment that
     it is the race the Durable Object exists to close - so asserting atomicity
     against it would be asserting it against a stub weaker than production, and
     would pass on nothing. This stub serialises the way the object does, and
     implements the same rule: deny when the RESULT would exceed the cap. */
  store.clear();
  let chain = Promise.resolve();
  const vals = new Map();
  const atomic = Object.assign({}, env, {
    AMV_COUNTER: { idFromName: (n) => n, get: (n) => ({ fetch(_u, init){
      return (chain = chain.then(async () => {
        await Promise.resolve();
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if(b.op === 'reserve'){
          const next = cur + Number(b.amount);
          if(!Number.isFinite(next) || next > b.cap) return new Response(JSON.stringify({ allowed:false, value:cur }));
          vals.set(n, next); return new Response(JSON.stringify({ allowed:true, value:next }));
        }
        if(b.op === 'incr'){ vals.set(n, cur + (b.amount||0)); return new Response(JSON.stringify({ value:vals.get(n) })); }
        return new Response(JSON.stringify({ value:cur, allowed:true }));
      })); } }) },
  });
  await W.spendSet(req({ limits: { enabled: true, autoUnder: 10, perPurchase: 50, monthlyCap: 100 } }), env);
  const rs = await Promise.all(Array.from({ length: 20 }, () => W._spendReserve(atomic, 'a@x.com', 25, 0)));
  const yes = rs.filter(r => r.ok).length;
  ok(yes === 4, 'exactly four $25 purchases fit under a $100 month', yes);
  ok(rs.filter(r => r.refused).length === 16, 'and the other sixteen are refused', rs.filter(r => r.refused).length);

  const d = await (await W.spendGet(new Request('https://x/v1/spend/limits', { method:'POST', body:'{}' }), atomic)).json();
  ok(d.spentThisMonth === 100, 'the month holds exactly the cap, not a penny over', d.spentThisMonth);
  ok(d.remaining === 0, 'with nothing left', d.remaining);
}

section('Money held for a purchase that did not happen goes back');
{
  /* A run has a dozen ways to end without buying anything - blocked, refused
     for approval, capped on steps, thrown. Every one of them used to leave the
     amount counted, because it was recorded before the browser even launched. */
  store.clear();
  await W.spendSet(req({ limits: { enabled: true, autoUnder: 10, perPurchase: 60, monthlyCap: 100 } }), env);
  const held = await W._spendReserve(env, 'a@x.com', 60, 0);
  ok(held.ok === true, 'the money is held while the run happens', held);

  const blockedMeanwhile = await W._spendReserve(env, 'a@x.com', 60, 0);
  ok(blockedMeanwhile.refused, 'and while it is held nobody else can spend it', blockedMeanwhile.refused && blockedMeanwhile.refused.code);

  await W._spendRelease(env, 'a@x.com', 60);
  const d = await (await W.spendGet(new Request('https://x/v1/spend/limits', { method:'POST', body:'{}' }), env)).json();
  ok(d.spentThisMonth === 0, 'a run that bought nothing gives the month back', d.spentThisMonth);
  const after = await W._spendReserve(env, 'a@x.com', 60, 0);
  ok(after.ok === true, 'so the next run can use it', after);
}

section('A refused purchase does not eat the month');
{
  store.clear();
  await W.spendSet(req({ limits: { enabled: true, autoUnder: 10, perPurchase: 20, monthlyCap: 100 } }), env);
  await W._spendReserve(env, 'a@x.com', 500, 0);        // refused
  const d = await (await W.spendGet(new Request('https://x/v1/spend/limits', { method:'POST', body:'{}' }), env)).json();
  ok(d.spentThisMonth === 0, 'nothing was counted against a purchase that never happened', d.spentThisMonth);
  ok(d.remaining === 100, 'so the whole month is still available', d.remaining);
}

section('A purchase with no budget behind it is refused outright');
{
  /* The other half of AMV-036: `spendAmount` comes from the CLIENT, and a
     client that simply left it out got the age gate and nothing else - then the
     agent was free to click "Place order", because the approval gate asks
     whether the user approved the RUN, not whether any budget covers the
     purchase. The whole spending control was optional to the caller.

     Money-shaped is narrower than irreversible: sending a message cannot be
     undone and costs nothing. */
  [['Place order', true], ['Pay now', true], ['Buy it now', true], ['Complete checkout', true],
   ['Subscribe', true], ['Withdraw funds', true], ['Book this room', true], ['Donate', true],
   ['Send message', false], ['Publish post', false], ['Delete account', false],
   ['Submit application', false]].forEach(([label, money]) => {
    ok(W._webIsMoney('click', label, '') === money,
       '"' + label + '" is ' + (money ? '' : 'not ') + 'a purchase', label);
  });
  ok(W._webIsMoney('scroll', 'Buy now', '') === false,
     'and scrolling past a Buy button is not one either');

  /* And the gate itself, which is what the run consults. */
  const noBudget = W._webSpendGate('click', 'Place order', '', 0);
  ok(noBudget.ok === false, 'a purchase with nothing held is refused', noBudget);
  ok(noBudget.code === 'spend_undeclared', 'with a code the app can act on', noBudget.code);

  const withBudget = W._webSpendGate('click', 'Place order', '', 40);
  ok(withBudget.ok === true, 'and goes through when money is held for it', withBudget);
  ok(withBudget.money === true, 'and counts as the purchase, so the hold is kept', withBudget.money);

  const free = W._webSpendGate('click', 'Send message', '', 0);
  ok(free.ok === true && free.money === false,
     'while something that costs nothing needs no budget and keeps no hold', free);
  ok(W._webSpendGate('click', 'Place order', '', '') .ok === false,
     'a budget that is not a number is not a budget');
  ok(W._webSpendGate('click', 'Place order', '', -5).ok === false,
     'and neither is a negative one');
}

section('The browser agent asks the account, not the caller');
{
  const fn = (name) => {
    const at = src.indexOf('async function ' + name);
    const rest = src.slice(at + 1);
    const ends = [rest.indexOf('\nasync function '), rest.indexOf('\nfunction ')].filter(x => x >= 0);
    return ends.length ? src.slice(at, at + 1 + Math.min(...ends)) : src.slice(at);
  };
  const b = fn('browserRun');
  ok(/_spendReserve\(env, user\.email, declaredSpend, spendLimit\)/.test(b),
     'it books against the stored limits', true);
  ok(!/hardCap/.test(b),
     'the old client-supplied cap is gone rather than left alongside', true);

  /* AMV-036 ordering, which is the whole of the second half. The month was
     charged and THEN the code discovered there was no browser binding, or no
     driver, or no model key, and answered 503 - with the amount already
     counted. A deployment missing a binding could burn a whole allowance on
     runs that never opened a page. */
  const iBrowser = b.indexOf('if(!env.BROWSER)');
  const iKey = b.indexOf('if(!_modelKey(env))');
  const iReserve = b.indexOf('_spendReserve(env, user.email');
  ok(iBrowser > -1 && iBrowser < iReserve,
     'nothing is booked until there is a browser to run it', { browser: iBrowser, reserve: iReserve });
  ok(iKey > -1 && iKey < iReserve,
     'nor until there is a key to drive it', { key: iKey, reserve: iReserve });

  /* And it is given back on every way out, from one place, so no branch can
     forget it. */
  ok(/finally\{/.test(b) || /finally \{/.test(b), 'the run has a single exit for the money', true);
  ok(/if\(!spentHere\)/.test(b), 'which keeps it only when a purchase really happened', true);
  ok(/releaseHeld\(\)/.test(b), 'and hands it back otherwise', true);
  ok(/_webSpendGate\(v\.verb, target \? target\.label : '', a\.text, heldSpend\)/.test(b),
     'and every step is put to the money gate before it runs', true);
  ok(/if\(!money\.ok\)\{/.test(b), 'which the run obeys', true);
}

section('Limits are readable, so the screen can show what really applies');
{
  store.clear();
  const d = await (await W.spendGet(new Request('https://x/v1/spend/limits', { method:'POST', body:'{}' }), env)).json();
  ok(d.ok === true, 'they can be read', d.ok);
  ok(d.limits.perPurchase === W.SPEND_DEFAULTS.perPurchase,
     'an account that never set any gets the defaults', d.limits);
  ok(d.absoluteCap === W.WEB_ABSOLUTE_SPEND_CAP,
     'and the hard ceiling nobody can raise is stated', d.absoluteCap);
}

if (report('spend-limits') > 0) process.exitCode = 1;
done();
