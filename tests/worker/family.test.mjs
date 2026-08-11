/* FAMILY - a parent's account carrying a child's, the way a phone plan does.

   What was here before was a consent flow: an account could ask another for
   named permissions, a code was emailed, the grant was recorded. All of that
   was real. None of it was CONSULTED - no endpoint anywhere read a link record
   before allowing anything, so the permissions were text. That is the whole
   reason this file exists: every assertion below is about a control BITING at
   the point money or access would actually move.

   Three controls, each wired to a real code path:
     - a monthly dollar cap, in the same backstop that protects the plan
     - buying in the marketplace, refused at the purchase
     - taking money out, refused at the withdrawal

   And one guarantee in the other direction, which is the reason a family would
   trust it at all: a parent cannot read their child's conversations. Not hidden
   in the UI - there is no endpoint, no scope, and no stored copy. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'family.harness.mjs');
writeFileSync(harness, src + `
export { familyGet, familySetLimits, familyRemove, familyLeave, linkInvite, linkAccept,
         marketBuy, marketWithdraw, requireUser, setEntitlement, issueTokens,
         _familyOf, _familyLimitsOf, _monthlyCeilingUSD, DB, FAMILY_DEFAULTS, FAMILY_MAX_CHILDREN };
`);
const W = await import(harness + '?t=' + Date.now());

/* Money endpoints now require a recorded adult age - an account that has never
   been asked is refused with age_required, which is a prompt rather than a
   verdict. Production accounts answer it once; fixtures have to say it too. */
async function _adult(env, email){
  await W.DB.put(env, 'consent', String(email).toLowerCase(),
    { birthYear: new Date().getUTCFullYear() - 30, ageSetAt: Date.now(), history: [] });
}

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40), EMAIL_API_KEY: 'em', STRIPE_SECRET_KEY: 'sk_test',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }; },
  },
};
const tok = async (email) => (await W.issueTokens(env, email, email.split('@')[0])).token;
const req = (body, token, url = 'https://api.amv.dev/x') => new Request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify(body || {}),
});
const jget = async (r) => { try { return await r.json(); } catch { return {}; } };

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 'cs_1', url: 'https://pay.test' }) });

const parentTok = await tok('parent@x.com');
const kidTok = await tok('kid@x.com');
/* Age is answered once by everybody who touches money; these suites are about
   the FAMILY rules, so the age question is settled up front and out of the way. */
for(const who of ['kid@x.com','solo@x.com','parent@x.com']) await _adult(env, who);
await W.setEntitlement(env, 'parent@x.com', 'elite');

section('A child joins only by confirming in their own inbox');
{
  /* A parent cannot put somebody in their family by typing an address. The code
     is generated on the server and emailed to the account being added, and only
     that account can redeem it. */
  const inv = await W.linkInvite(req({ owner: 'kid@x.com', id: 'i1', scopes: ['family'] }, parentTok), env);
  ok(inv.status === 200, 'the invitation is accepted for sending', inv.status);

  const stored = await W.DB.get(env, 'link', 'kid@x.com|i1');
  ok(!!stored && stored.code, 'a code exists server-side');
  ok(!JSON.stringify(await jget(inv)).includes(String(stored.code)),
     'and is never returned to whoever asked for it');

  /* Somebody else holding the code cannot redeem it - the record is keyed by
     the account being added. */
  const otherTok = await tok('stranger@x.com');
  const stolen = await W.linkAccept(req({ id: 'i1', code: stored.code }, otherTok), env);
  ok(stolen.status === 404, 'a third party cannot redeem it even with the code', stolen.status);

  const okRes = await W.linkAccept(req({ id: 'i1', code: stored.code }, kidTok), env);
  const d = await jget(okRes);
  ok(okRes.status === 200 && d.family, 'the child themselves can', d);
  ok(d.family.parent === 'parent@x.com', 'and lands in that parent’s family', d.family.parent);
}

section('The defaults are the safe ones');
{
  const fam = await W._familyOf(env, 'kid@x.com');
  ok(!!fam, 'the child resolves to a family', fam);
  ok(fam.limits.marketplace === false, 'buying is off until a parent turns it on');
  ok(fam.limits.payouts === false, 'so is taking money out');
  ok(fam.limits.monthlyUSD === W.FAMILY_DEFAULTS.monthlyUSD,
     'and there is a real monthly ceiling from the first minute', fam.limits.monthlyUSD);
}

section('Buying is refused at the purchase, not in a settings screen');
{
  await env.AMV_KV.put('market:usr_thing', JSON.stringify({
    id: 'usr_thing', title: 'A thing', kind: 'prompt', price: 9,
    authorEmail: 'seller@x.com', status: 'active', sales: 0 }));

  const blocked = await W.marketBuy(req({ id: 'usr_thing' }, kidTok), env);
  const bd = await jget(blocked);
  ok(blocked.status === 403, 'the child cannot buy', blocked.status);
  ok(bd.code === 'family_blocked', 'with a code the app can act on', bd.code);
  ok(/manages your family/.test(bd.error), 'and is told who can change it', bd.error);

  /* And an ordinary account is untouched by any of this. */
  const soloTok = await tok('solo@x.com');
  const allowed = await W.marketBuy(req({ id: 'usr_thing' }, soloTok), env);
  ok(allowed.status !== 403, 'somebody not in a family is unaffected', allowed.status);

  await W.familySetLimits(req({ child: 'kid@x.com', limits: { monthlyUSD: 5, marketplace: true, payouts: false } }, parentTok), env);
  const now = await W.marketBuy(req({ id: 'usr_thing' }, kidTok), env);
  ok(now.status !== 403, 'and the parent turning it on really turns it on', now.status);
}

section('Taking money out is refused at the withdrawal');
{
  const blocked = await W.marketWithdraw(req({}, kidTok), env);
  const bd = await jget(blocked);
  ok(blocked.status === 403, 'a child cannot withdraw', blocked.status);
  ok(bd.code === 'family_blocked', 'with the same code', bd.code);
}

section('The money cap is the LOWER of the two, and zero means zero');
{
  /* The parent can spend less on a child than the plan allows. They can never
     spend more, whatever the plan is or who pays for it. */
  /* Asked of the FUNCTION, not of the source text. These matched the exact
     spelling of the arithmetic while it lived inline in the chat handler, so
     they failed the day it moved into a shared helper - which was a correct
     refactor that made the same rule bind image, video, SMS and the widget as
     well. A rule written against a spelling fails on a fix and passes on a
     regression that keeps the words (LESSONS #203). */
  const ceil = W._monthlyCeilingUSD;
  ok(typeof ceil === 'function', 'there is one ceiling function to ask', typeof ceil);

  ok(ceil({ plan: 'ultra', family: { limits: { monthlyUSD: 5 } } }) === 5,
     'the smaller ceiling is the one that applies', ceil({ plan: 'ultra', family: { limits: { monthlyUSD: 5 } } }));
  ok(ceil({ plan: 'pro' }) > 0 && ceil({ plan: 'pro' }) === ceil({ plan: 'pro', family: { limits: {} } }),
     'and an account with no family limit is unaffected by any of it', ceil({ plan: 'pro' }));
  ok(ceil({ plan: 'free', family: { limits: { monthlyUSD: 0 } } }) === 0,
     'a cap still applies on a plan that has no ceiling of its own - otherwise zero would mean unlimited',
     ceil({ plan: 'free', family: { limits: { monthlyUSD: 0 } } }));
  ok(ceil({ plan: 'free' }) === null,
     'while a free account with no cap at all has no dollar ceiling to hit', ceil({ plan: 'free' }));
  ok(/code: 'family_cap'/.test(src),
     'and hitting it is reported as a family limit, not as a plan limit');
  ok(/whoever manages your family can raise it/i.test(src),
     'because "upgrade for more" is not an action a child can take');
}

section('A parent cannot read their child’s conversations');
{
  /* The reason a family would trust this at all. Not hidden in the UI - there
     is no endpoint, no scope, and no stored copy. */
  const d = await jget(await W.familyGet(req({}, parentTok), env));
  ok(d.parentOf && d.parentOf.members.length === 1, 'a parent sees who is in the family', d.parentOf);
  const asText = JSON.stringify(d);
  ok(!/convs|messages|transcript|chatlog/i.test(asText),
     'and nothing resembling conversation content comes back', asText.slice(0, 120));

  const kid = await jget(await W.familyGet(req({}, kidTok), env));
  ok(kid.childOf, 'the child is told they are in a family', kid.childOf);
  ok(kid.childOf.cannotSee.some(x => /conversation/i.test(x)),
     'in words, including that conversations are not visible', kid.childOf.cannotSee);
  ok(kid.childOf.canSee.every(x => !/conversation|message/i.test(x)),
     'and what IS visible names only limits and usage', kid.childOf.canSee);

  /* The strongest form of the promise: no route exists that would serve it. */
  ok(!/family\/(convs|messages|chats|transcripts)/.test(src),
     'there is no route that would return a child’s conversations');
}

section('The account holder can always get out');
{
  /* Only the parent could end a membership. That is defensible for an actual
     parent and dangerous for AMV, which cannot tell a parent from a stranger -
     the consent step is one word in an email. Somebody who accepted an
     invitation they did not fully understand was capped, blocked from buying
     and blocked from withdrawing money they had EARNED, permanently.

     It is not a hole in parental control either: a minor who wants out can open
     a new account in a minute, so the lock was never holding anyone. All it did
     was make the abuse case unfixable. */
  const inv = await W.linkInvite(req({ owner: 'trapped@x.com', id: 'i9', scopes: ['family'] }, parentTok), env);
  const rec = await W.DB.get(env, 'link', 'trapped@x.com|i9');
  const trappedTok = await tok('trapped@x.com');
  await W.linkAccept(req({ id: 'i9', code: rec.code }, trappedTok), env);
  ok(!!(await W._familyOf(env, 'trapped@x.com')), 'they are in the family');

  const out = await W.familyLeave(req({}, trappedTok), env);
  ok(out.status === 200, 'and they can leave on their own', out.status);
  ok((await W._familyOf(env, 'trapped@x.com')) === null, 'so they are out');

  const ent = await W.DB.get(env, 'ent', 'trapped@x.com');
  ok(!ent.familyOf, 'with the marker every check reads gone, so the limits stop applying');

  const fam = await W.DB.get(env, 'fam', 'parent@x.com');
  ok(!(fam.members || []).some(m => m.email === 'trapped@x.com'),
     'and the family no longer lists them');

  const again = await W.familyLeave(req({}, trappedTok), env);
  ok(again.status === 404, 'leaving twice is not an error worth inventing state for', again.status);

  const solo = await W.familyLeave(req({}, await tok('nobody2@x.com')), env);
  ok(solo.status === 404, 'and somebody in no family is told so plainly', solo.status);
}

section('The invitation says what it actually does');
{
  /* "is asking to access your AMV account for: family" tells the reader
     nothing about what they are agreeing to. They are deciding whether to hand
     somebody control of their money settings, so the email says that. */
  ok(/wants to add you to their AMV family/.test(src), 'it names what is being asked');
  ok(/how much AMV may spend on your account each month/.test(src), 'and the spending control');
  ok(/whether you can withdraw money you earn/.test(src), 'and the one that touches money they earned');
  ok(/CANNOT read your conversations/.test(src), 'along with the limit on what they get to see');
  ok(/You can leave at any time/.test(src), 'and that it is reversible, which is the thing that makes it safe to accept');
  ok(/wants to manage what your AMV account can spend/.test(src),
     'and the subject line says it before the email is even opened');
}

section('Removing a child lifts the limits with them');
{
  const r = await W.familyRemove(req({ child: 'kid@x.com' }, parentTok), env);
  ok(r.status === 200, 'a parent can remove somebody', r.status);
  ok((await W._familyOf(env, 'kid@x.com')) === null, 'and they are no longer in a family');

  const ent = await W.DB.get(env, 'ent', 'kid@x.com');
  ok(!ent.familyOf, 'the marker every check reads is gone too - a limit that outlives the family is one nobody can lift');

  const buy = await W.marketBuy(req({ id: 'usr_thing' }, kidTok), env);
  ok(buy.status !== 403, 'so the controls really stop applying', buy.status);
}

section('Only the parent of that family can change anything');
{
  const inv2 = await W.linkInvite(req({ owner: 'kid2@x.com', id: 'i2', scopes: ['family'] }, parentTok), env);
  const rec = await W.DB.get(env, 'link', 'kid2@x.com|i2');
  await W.linkAccept(req({ id: 'i2', code: rec.code }, await tok('kid2@x.com')), env);

  const outsider = await tok('outsider@x.com');
  const nope = await W.familySetLimits(req({ child: 'kid2@x.com', limits: { monthlyUSD: 500, marketplace: true, payouts: true } }, outsider), env);
  ok(nope.status === 404, 'somebody outside cannot raise a child’s limits', nope.status);

  const kid2 = await W._familyOf(env, 'kid2@x.com');
  ok(kid2.limits.payouts === false, 'and the limits are untouched', kid2.limits);

  const self = await W.familySetLimits(req({ child: 'kid2@x.com', limits: { monthlyUSD: 500, marketplace: true, payouts: true } }, await tok('kid2@x.com')), env);
  ok(self.status === 404, 'and a child cannot lift their own', self.status);
}

section('The numbers a parent sets are bounded');
{
  await W.familySetLimits(req({ child: 'kid2@x.com', limits: { monthlyUSD: 99999 } }, parentTok), env);
  let f = await W._familyOf(env, 'kid2@x.com');
  ok(f.limits.monthlyUSD <= 500, 'an absurd cap is bounded rather than stored', f.limits.monthlyUSD);

  await W.familySetLimits(req({ child: 'kid2@x.com', limits: { monthlyUSD: -20 } }, parentTok), env);
  f = await W._familyOf(env, 'kid2@x.com');
  ok(f.limits.monthlyUSD === 0, 'and a negative one becomes zero, which is a real setting', f.limits.monthlyUSD);
  ok(W.FAMILY_MAX_CHILDREN > 0 && /kids\.length >= FAMILY_MAX_CHILDREN/.test(src),
     'and a family cannot grow without limit', W.FAMILY_MAX_CHILDREN);
}

globalThis.fetch = realFetch;
section('A family you do not manage is not yours to break up');
{
  /* familyRemove loaded the CALLER's family, filtered the named address out of
     it - harmless if they were never in it - and then unconditionally deleted
     familyOf from that person's entitlement. That marker is what every parental
     limit reads.

     So anybody willing to create a family of their own could name somebody
     else's child and free them from their parent's spending controls, and write
     a "left the family" line into that person's security log on the way past.
     The one screen built for parents, undone by naming an email. */
  store.clear();
  await W.DB.put(env, 'fam', 'parent@x.com', { members:[{ email:'kid@x.com', limits:{ payouts:false } }] });
  await W.DB.put(env, 'ent', 'kid@x.com', { plan:'free', familyOf:'parent@x.com' });
  await W.DB.put(env, 'fam', 'stranger@x.com', { members:[] });   // also manages A family

  const r = await W.familyRemove(req({ child:'kid@x.com' }, await tok('stranger@x.com')), env);
  ok(r.status === 404, 'a stranger cannot remove somebody else\'s child', r.status);
  ok((await jget(r)).code === 'not_in_family', 'and is told why', true);

  const stillTied = await W.DB.get(env, 'ent', 'kid@x.com');
  ok(stillTied.familyOf === 'parent@x.com', 'the child is still tied to their real parent', stillTied.familyOf);
  ok(((await W.DB.get(env, 'fam', 'parent@x.com')).members || []).length === 1,
     'and still in their family', true);

  /* The actual parent can still do it, which is the point of the feature. */
  const r2 = await W.familyRemove(req({ child:'kid@x.com' }, await tok('parent@x.com')), env);
  ok(r2.status === 200, 'the real parent still can', r2.status);
  ok(!(await W.DB.get(env, 'ent', 'kid@x.com')).familyOf,
     'and the marker is cleared, so the limits lift', true);
}

section('A half-broken family record can still be repaired by its parent');
{
  /* Authorised from EITHER side: their row in your family, or their entitlement
     pointing back at you. Refusing when one side is missing would leave a parent
     unable to lift a limit nobody else can. */
  store.clear();
  await W.DB.put(env, 'fam', 'parent@x.com', { members:[] });          // row lost
  await W.DB.put(env, 'ent', 'kid@x.com', { plan:'free', familyOf:'parent@x.com' });
  const r = await W.familyRemove(req({ child:'kid@x.com' }, await tok('parent@x.com')), env);
  ok(r.status === 200, 'the parent the marker names can still remove them', r.status);
  ok(!(await W.DB.get(env, 'ent', 'kid@x.com')).familyOf, 'and the limit lifts', true);
}

if (report('family') > 0) process.exitCode = 1;
done();
