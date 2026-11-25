/* A FAMILY PLAN COVERS ITS FAMILY, AND NO ONE ELSE (owner, Nov 25: $30 a
   month, the payer and up to five people they invite, Pro's capability each,
   ONE allowance of twice Pro's shared by them all).

   It is money, so every claim is checked on the object every limit reads -
   the principal _principalOf builds, the one the quotas are keyed by:
     · the payer is on Family, drawing on the family's counter;
     · a member listed in the family is on Family too, on the SAME counter;
     · the pool is twice Pro's (month, messages, top-engine week), the burst
       controls are each person's;
     · Family buys Pro-grade capability, no more;
     · cover ends at once - member removed, payer cancelled or lapsed - with
       nothing to clean up;
     · somebody merely pointing at a family they are not listed in gets
       nothing; a member with a better plan of their own keeps it;
     · Family can be bought only where its price is set, and a webhook for the
       Family price grants Family. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'familyplan.' + process.pid + '.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _principalOf, _baseLimits, PLAN_LIMITS, _planRankOf, PLAN_RANK, _planUnsellable, _stripePriceId, PLAN_FROM_PRICE, _planPriceUSD, _autoMaxFor };\n');
const W = await import(harness + '?t=' + Date.now());

function mkEnv(extra) {
  const m = new Map();
  return Object.assign({ JWT_SECRET: 'j',
    AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } }, extra || {});
}
const PAYER = 'payer@example.com', KID = 'kid@example.com', SIB = 'sib@example.com', STRANGER = 'x@example.com';
async function family(env, payerPlan) {
  await W.DB.put(env, 'ent', PAYER, { plan: payerPlan, renewedAt: 1000, updatedAt: Date.now() });
  await W.DB.put(env, 'fam', PAYER, { id: 'fam_' + PAYER, parentEmail: PAYER,
    members: [{ email: KID, role: 'child', limits: { monthlyUSD: 5 } }, { email: SIB, role: 'child', limits: { monthlyUSD: 8 } }] });
  await W.DB.put(env, 'ent', KID, { plan: 'free', familyOf: PAYER });
  await W.DB.put(env, 'ent', SIB, { plan: 'free', familyOf: PAYER });
}
const P = (env, em) => W._principalOf(env, em, null, {});

section('The payer and every member draw on one family allowance');
{
  const env = mkEnv(); await family(env, 'family');
  const p = await P(env, PAYER), k = await P(env, KID), s = await P(env, SIB);
  ok(p.plan === 'family' && p.billingSubject === 'family:' + PAYER, 'the payer is on Family, on the family counter', p);
  ok(k.plan === 'family' && k.billingSubject === 'family:' + PAYER, 'a member is on Family, on the same counter', k);
  ok(s.billingSubject === k.billingSubject, 'and so is every other member');
  ok(k.billingRenewedAt === 1000, 'measured over the payer’s billing period', k.billingRenewedAt);
  ok(k.family && k.family.limits && k.family.limits.monthlyUSD === 5, 'the parent’s per-member cap still applies on top', k.family);
}

section('Twice Pro’s allowance, shared; bursts are each person’s');
{
  const L = W._baseLimits({ plan: 'family' }), pro = W.PLAN_LIMITS.pro;
  ok(L.monthTokens === pro.monthTokens * 2 && L.monthMessages === pro.monthMessages * 2 && L.topMessagesWeek === pro.topMessagesWeek * 2,
     'month, messages and the top-engine week are twice Pro’s', L);
  ok(L.rpm === pro.rpm && L.messages5h === pro.messages5h, 'the per-minute and five-hour bursts are Pro’s, per person', L);
  ok(W._planRankOf('family') === W.PLAN_RANK.pro, 'Family buys Pro-grade capability, no more');
  ok(W._planPriceUSD('family') === 30, 'priced at $30 for the cost ceiling', W._planPriceUSD('family'));
  ok(W._autoMaxFor('family') === W._autoMaxFor('pro'), 'Crew jobs as Pro');
}

section('Cover ends the moment the family or the payment does');
{
  const env = mkEnv(); await family(env, 'family');
  const fam = await W.DB.get(env, 'fam', PAYER);
  fam.members = fam.members.filter(m => m.email !== KID); await W.DB.put(env, 'fam', PAYER, fam);
  const k = await P(env, KID);
  ok(k.plan === 'free' && k.billingSubject === KID, 'a member removed from the family is back on their own plan', k);
  ok((await P(env, SIB)).plan === 'family', 'while the rest of the family is still covered');
  await W.DB.put(env, 'ent', PAYER, { plan: 'free', updatedAt: Date.now() });
  ok((await P(env, SIB)).plan === 'free', 'the payer cancels: nobody is covered any more');
  await W.DB.put(env, 'ent', PAYER, { plan: 'family', pastDueSince: Date.now() - 400 * 864e5 });
  ok((await P(env, SIB)).plan === 'free', 'the payer’s payment lapses past grace: nobody is covered');
  await W.DB.put(env, 'ent', PAYER, { plan: 'pro', updatedAt: Date.now() });
  ok((await P(env, SIB)).plan === 'free', 'the payer moves to Pro: Pro is theirs alone');
}

section('Nobody joins a family by claiming to');
{
  const env = mkEnv(); await family(env, 'family');
  await W.DB.put(env, 'ent', STRANGER, { plan: 'free', familyOf: PAYER });
  const x = await P(env, STRANGER);
  ok(x.plan === 'free' && x.billingSubject === STRANGER, 'an account not listed in the family gets nothing from it', x);
  await W.DB.put(env, 'ent', KID, { plan: 'elite', familyOf: PAYER });
  const k = await P(env, KID);
  ok(k.plan === 'elite' && k.billingSubject === KID, 'a member with a better plan of their own keeps it', k);
}

section('Bought only where its price is set; the webhook grants it');
{
  const none = mkEnv();
  const r = W._planUnsellable('family');
  ok(r && r.status === 503, 'with no price, buying Family is refused as not set up, nothing charged', r && r.status);
  const d = await r.json();
  ok(d.missing === 'STRIPE_PRICE_FAMILY', 'and the refusal names the price to set', d);
  ok(W._stripePriceId(none, 'family') === null, 'there is no price to open checkout with');
  const env = mkEnv({ STRIPE_PRICE_FAMILY: 'price_fam' });
  ok(W._stripePriceId(env, 'family') === 'price_fam', 'with the price set, checkout opens with it');
  ok(W.PLAN_FROM_PRICE(env)['price_fam'] === 'family', 'and a payment for that price grants Family');
}

report();
done();
