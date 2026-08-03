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
export { _spendClean, _spendLimits, _spendAllowed, _spendRecord, spendGet, spendSet,
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
  store.clear();
  await W.spendSet(req({ limits: { enabled: true, autoUnder: 10, perPurchase: 100, monthlyCap: 120 } }), env);
  await W._spendRecord(env, 'a@x.com', 100);

  const over = await W._spendAllowed(env, 'a@x.com', 50, 0);
  ok(over && over.code === 'over_monthly', 'spending past the month is refused', over);
  ok(/20\.00 is left/.test(over.need), 'saying exactly what is left', over.need);

  const under = await W._spendAllowed(env, 'a@x.com', 15, 0);
  ok(under === null, 'while what fits still goes through', under);
}

section('A refused purchase does not eat the month');
{
  store.clear();
  await W.spendSet(req({ limits: { enabled: true, autoUnder: 10, perPurchase: 20, monthlyCap: 100 } }), env);
  await W._spendAllowed(env, 'a@x.com', 500, 0);        // refused
  const d = await (await W.spendGet(new Request('https://x/v1/spend/limits', { method:'POST', body:'{}' }), env)).json();
  ok(d.spentThisMonth === 0, 'nothing was counted against a purchase that never happened', d.spentThisMonth);
  ok(d.remaining === 100, 'so the whole month is still available', d.remaining);
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
  ok(/_spendAllowed\(env, user\.email, declaredSpend, spendLimit\)/.test(b),
     'it checks against the stored limits', true);
  ok(/_spendRecord\(env, user\.email, declaredSpend\)/.test(b),
     'and records the spend so the monthly ceiling means something', true);
  ok(!/hardCap/.test(b),
     'the old client-supplied cap is gone rather than left alongside', true);
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
