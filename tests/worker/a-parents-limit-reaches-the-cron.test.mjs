/* THE LIMIT A PARENT SETS HAS TO HOLD WHERE NOBODY IS WATCHING.

   A family cap is one number: "AMV may spend at most this much on my child's
   account each month". It bounded chat. It bounded images and video. It did
   not bound automations, and automations are the one thing that spends while
   the person who set the limit is asleep.

   The reason was structural rather than an oversight in any one place.
   _autoBudget took an ENTITLEMENT - plan and custom pricing - and a family cap
   does not live on the entitlement. It lives on the family record, because a
   parent has to be able to change it once rather than rewrite every child's
   entitlement and hope nothing is spending in between. So the automation
   ceiling was computed from the plan and could not see the cap even in
   principle: no amount of care at the call site would have found it.

   The fix passes the family in, and then asks the SAME _monthlyCeilingUSD that
   chat asks. One definition, so a cap cannot mean one thing to the screen
   somebody is looking at and another to the cron.

   What that has to mean, and is checked here:

     - a paid child under a tighter family cap runs to the CAP, not the plan;
     - a cap of zero really is zero, including for a free account whose one
       weekly job was previously outside all of this;
     - an account with no family is completely unaffected, because a fix that
       quietly lowers everybody else's ceiling is a worse bug than the one it
       fixes;
     - the ceiling the cron uses is the ceiling chat uses, for the same person;
     - and when it stops, the person is told which limit stopped them. "Monthly
       allowance reached" tells a child to upgrade, which will not help and is
       not theirs to do. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { functionBody, codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'parentcron.harness.mjs');
writeFileSync(harness, src + '\nexport { _autoBudget, _budgetFor, _monthlyCeilingUSD, _familyOf, FREE_AUTO_CEILING_USD, PLAN_LIMITS, _planPriceUSD, runDueAutomations };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
    },
  },
};

/* A family record with one child and a monthly cap, and the child's
   entitlement pointing at it - the shape _familyOf actually reads. */
function seedFamily(childEmail, monthlyUSD, plan) {
  store.clear();
  store.set('fam:f1', JSON.stringify({
    id: 'f1', parentEmail: 'parent@x.com',
    members: [{ email: childEmail, role: 'child', limits: { monthlyUSD } }],
  }));
  store.set('ent:' + childEmail, JSON.stringify({ plan, familyOf: 'f1' }));
}

const famOf = (email) => W._familyOf(env, email, null);

section('The family record really is where the cap lives');
{
  seedFamily('kid@x.com', 10, 'pro');
  const fam = await famOf('kid@x.com');
  ok(fam && fam.limits && fam.limits.monthlyUSD === 10,
     'a child in a family resolves to their limits', fam);
  store.set('ent:solo@x.com', JSON.stringify({ plan: 'pro' }));
  ok((await W._familyOf(env, 'solo@x.com', null)) === null,
     'and somebody with no family resolves to nothing, at no cost', true);
}

section('A paid child under a tighter cap runs to the CAP, not to the plan');
{
  seedFamily('kid@x.com', 5, 'pro');
  const fam = await famOf('kid@x.com');
  const withFamily = W._autoBudget({ plan: 'pro' }, fam);
  const without = W._autoBudget({ plan: 'pro' }, null);
  ok(without.ceiling > 5,
     'the plan on its own would have allowed more than the parent set', without.ceiling);
  ok(withFamily.ceiling === 5,
     'the automation ceiling is the number the parent chose', withFamily.ceiling);
  ok(withFamily.familyCapped === true,
     'and it knows it was the family limit that bound it', withFamily);
}

section('A cap LOOSER than the plan does not raise anything');
{
  /* A parent setting a generous number must not become a way to spend more
     than the plan pays for. The lower of the two wins, in both directions. */
  seedFamily('kid@x.com', 10000, 'pro');
  const fam = await famOf('kid@x.com');
  const b = W._autoBudget({ plan: 'pro' }, fam);
  const plain = W._autoBudget({ plan: 'pro' }, null);
  ok(b.ceiling === plain.ceiling, 'the plan backstop still holds', [b.ceiling, plain.ceiling]);
  ok(b.familyCapped === false, 'and nothing claims the family bound it', b);
}

section('A cap of zero really is zero, including for the free weekly job');
{
  /* The free tier has its own small ceiling that exists so its one weekly job
     can run at all. A parent switching paid compute OFF has to switch that off
     too, or "zero" means "nearly zero" and the whole control is a suggestion. */
  seedFamily('kid@x.com', 0, 'free');
  const fam = await famOf('kid@x.com');
  const b = W._autoBudget({ plan: 'free' }, fam);
  ok(W.FREE_AUTO_CEILING_USD > 0, 'a free account normally has a small ceiling', W.FREE_AUTO_CEILING_USD);
  ok(b.ceiling === 0, 'and zero from a parent overrides it', b.ceiling);

  seedFamily('kid@x.com', 0, 'pro');
  const famPro = await famOf('kid@x.com');
  ok(W._autoBudget({ plan: 'pro' }, famPro).ceiling === 0,
     'and a paid plan does not buy past it either', true);
}

section('Nobody outside a family is affected');
{
  /* The way this fix goes wrong is by lowering everybody's ceiling. Every plan
     is compared against what it was before the family was ever consulted. */
  /* Every plan the product actually sells, read from the source rather than
     typed here - a list of plan names in a test is one more thing that goes
     stale the day somebody adds a tier, and the plan it forgets is the one
     nobody checks. */
  const PLANS = Object.keys(W.PLAN_LIMITS);
  ok(PLANS.length >= 4 && PLANS.includes('free'), 'the plans were read', PLANS);
  for (const plan of PLANS) {
    /* An unpriced plan keeps the free automation ceiling; a priced one keeps
       the plan backstop. Both are what they were before families existed. */
    const before = W._planPriceUSD(plan) > 0
      ? W._monthlyCeilingUSD({ plan })
      : W.FREE_AUTO_CEILING_USD;
    const now = W._autoBudget({ plan }, null).ceiling;
    ok(now === before, plan + ': the ceiling is exactly what it always was', { plan, before, now });
    ok(W._autoBudget({ plan }, null).familyCapped === false,
       plan + ': and nothing is marked as family-capped', plan);
  }
}

section('The cron and the screen agree, because they ask the same function');
{
  /* Two ceilings that happen to match today is not the property. The property
     is that there is one of them. */
  seedFamily('kid@x.com', 7, 'pro');
  const fam = await famOf('kid@x.com');
  const interactive = W._monthlyCeilingUSD({ plan: 'pro', family: fam });
  const scheduled = W._autoBudget({ plan: 'pro' }, fam).ceiling;
  ok(interactive === scheduled,
     'the same person gets the same number whether they type it or schedule it',
     { interactive, scheduled });

  const budget = codeOnly(functionBody(src, '_autoBudget'));
  ok(/_monthlyCeilingUSD\(/.test(budget),
     'and the automation budget asks the shared ceiling rather than keeping a copy', true);
  ok(!/\*\s*0\.45/.test(budget) || /planPrice \* 0\.45/.test(budget),
     'the 45% backstop is not re-derived somewhere it can drift from', budget.slice(0, 200));
}

section('_budgetFor passes the family through on the request path too');
{
  /* The request path already has the family on the user - requireUser resolved
     it - so this must not go to storage again, and must not drop it. */
  const b = await W._budgetFor(env, {
    email: 'kid@x.com', plan: 'pro',
    family: { id: 'f1', parent: 'parent@x.com', limits: { monthlyUSD: 3 } },
  });
  ok(b.ceiling === 3, 'creating an automation sees the cap immediately', b);

  /* And when the plan is missing it falls back to storage, family and all. */
  seedFamily('kid@x.com', 4, 'pro');
  const b2 = await W._budgetFor(env, { email: 'kid@x.com' });
  ok(b2.ceiling === 4, 'and the fallback read resolves the family too', b2);
}

section('When it stops, the person is told which limit stopped them');
{
  const cron = codeOnly(functionBody(src, 'runDueAutomations'));
  ok(/_familyOf\(env, email, ent\)/.test(cron),
     'the cron resolves the family, since it runs outside requireUser', true);
  ok(/_autoBudget\(\{ plan: sub\.plan, custom: sub\.customCfg \}, fam\)/.test(cron),
     'and hands it to the budget', true);
  ok(/budget\.familyCapped/.test(cron),
     'the refusal distinguishes a family cap from a plan allowance', true);

  /* RUN it, rather than reading it. A source grep for `budget.familyCapped`
     passes on `false && budget.familyCapped`, which is exactly the shape a
     careless edit leaves behind - and then every child is told to upgrade
     again with the check still green. */
  const errorFor = async (monthlyUSD, plan) => {
    seedFamily('kid@x.com', monthlyUSD, plan);
    if (monthlyUSD == null) { store.clear(); store.set('ent:kid@x.com', JSON.stringify({ plan })); }
    /* Already over whatever the ceiling turns out to be. */
    store.set('ctr:cost:kid@x.com:' + new Date().toISOString().slice(0, 7), '9999');
    store.set('auto:kid@x.com', JSON.stringify({
      items: [{ id: 'a1', active: true, next: 1, detail: 'do a thing', repeat: 'daily', kind: 'task', approval: 'require' }],
    }));
    await W.runDueAutomations(env);
    const rec = JSON.parse(store.get('auto:kid@x.com'));
    return (rec.items[0] || {}).lastError || '';
  };

  const capped = await errorFor(1, 'pro');
  ok(/whoever manages your family can raise it/.test(capped),
     'a family-capped child is told who can actually change it', capped);
  /* And somebody with no family still gets the plain answer - a paying adult
     who runs out has no family to ask, and telling them to is worse than
     saying nothing. */
  const plain = await errorFor(null, 'pro');
  ok(plain === 'monthly allowance reached',
     'while somebody with no family gets the plain answer', plain);
  ok(capped !== plain, 'and the two are not the same sentence', { capped, plain });
}

if (report('a-parents-limit-reaches-the-cron') > 0) process.exitCode = 1;
done();
