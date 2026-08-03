/* DELETING AN ACCOUNT HAS TO REACH EVERYTHING.

   Erasure is the one operation where a miss is invisible: the account is gone
   from every screen, so nothing ever surfaces what stayed behind.

   Five things stayed behind. The worst was `fin` - a live access token to
   somebody's bank, still valid, still held, still connected at the aggregator
   against an account that no longer exists. Then `invsnap` (their real
   balances), `links` (grants that let other accounts act), and `fam` (a spend
   cap that would have gone on applying to children with nobody left able to
   lift it).

   The other half of the same question is backup: what a restore must be able to
   put back, and what it must never carry. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'erasure.harness.mjs');
writeFileSync(harness, src + `
export { authDeleteAccount, BACKUP_PREFIXES, BACKUP_NEVER, DB, _userFromApiKey, _apiKeyHash };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40), FINANCE_CLIENT_ID: 'cid', FINANCE_SECRET: 'sec',
  AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k, v){ store.set(k, String(v)); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys:[...store.keys()].filter(k=>k.startsWith(prefix||'')).map(name=>({name})), list_complete:true }; },
  },
};
W.__setRequireUser(async () => ({ email: 'gone@x.com' }));
const req = () => new Request('https://x/auth/delete', { method:'POST', body:'{}' });

const realFetch = globalThis.fetch;
let providerCalls = [];

const seed = async () => {
  store.clear();
  providerCalls = [];
  globalThis.fetch = async (url, init) => {
    providerCalls.push({ path: String(url).replace(/^https?:\/\/[^/]+/, ''), body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ removed: true }) };
  };
  await W.DB.put(env, 'acct', 'gone@x.com', { email:'gone@x.com' });
  await W.DB.put(env, 'ent', 'gone@x.com', { plan:'pro', familyOf:'parent@x.com' });
  await W.DB.put(env, 'fin', 'gone@x.com', { accessToken:'access-LIVE', itemId:'it-1' });
  await W.DB.put(env, 'finlink', 'gone@x.com', { token:'lt-1' });
  await W.DB.put(env, 'invsnap', 'gone@x.com', { at: Date.now(), total: 92000, accounts:[{ name:'Roth' }] });
  await W.DB.put(env, 'links', 'gone@x.com', { items:[{ id:'L1', owner:'gone@x.com', grantee:'other@x.com', active:true }] });
  await W.DB.put(env, 'links', 'other@x.com', { items:[{ id:'L1', owner:'gone@x.com', grantee:'other@x.com', active:true }] });
  await W.DB.put(env, 'fam', 'parent@x.com', { id:'F1', members:[{ email:'gone@x.com', role:'child' }, { email:'sib@x.com', role:'child' }] });
  await W.DB.put(env, 'fam', 'gone@x.com', { id:'F2', members:[{ email:'kid@x.com', role:'child' }] });
  await W.DB.put(env, 'ent', 'kid@x.com', { plan:'free', familyOf:'gone@x.com' });
};

section('The bank connection is ended at the provider, not just forgotten here');
{
  await seed();
  await W.authDeleteAccount(req(), env);
  const removed = providerCalls.find(c => c.path === '/item/remove');
  ok(!!removed, 'the aggregator is told to disconnect', providerCalls.map(c => c.path));
  ok(removed.body.access_token === 'access-LIVE', 'for the right item', removed.body.access_token);
}

section('Nothing financial is left behind');
{
  ok(!(await W.DB.get(env, 'fin', 'gone@x.com')), 'the access token is gone', true);
  ok(!(await W.DB.get(env, 'finlink', 'gone@x.com')), 'so is a half-finished link', true);
  ok(!(await W.DB.get(env, 'invsnap', 'gone@x.com')), 'and the record of their balances', true);
}

section('Access other people held is withdrawn on their side too');
{
  /* A link lives under BOTH rows. Deleting only this account's copy leaves the
     other party holding an active grant pointing at somebody who is gone. */
  ok(!(await W.DB.get(env, 'links', 'gone@x.com')), 'their own link row is gone', true);
  const other = await W.DB.get(env, 'links', 'other@x.com');
  ok(other && other.items.length === 0,
     'and the grant is removed from the other account as well', other && other.items);
}

section('They stop being a member of a family they were carried in');
{
  const fam = await W.DB.get(env, 'fam', 'parent@x.com');
  const names = (fam.members || []).map(m => m.email);
  ok(names.indexOf('gone@x.com') < 0, 'their membership row is removed from the parent', names);
  ok(names.indexOf('sib@x.com') >= 0, 'without disturbing anybody else', names);
}

section('Children are not left capped by an account that no longer exists');
{
  /* The nastiest of the five: a spend limit set by a deleted parent, applying
     forever, with nobody left who could lift it. */
  const kid = await W.DB.get(env, 'ent', 'kid@x.com');
  ok(!kid.familyOf, 'the child is released from the deleted parent', kid);
  ok(!(await W.DB.get(env, 'fam', 'gone@x.com')), 'and the family record itself is gone', true);
}

section('A provider that cannot be reached does not stop the erasure');
{
  await seed();
  globalThis.fetch = async () => { throw new Error('network'); };
  const r = await W.authDeleteAccount(req(), env);
  const d = await r.json();
  ok(d.ok === true, 'deletion still succeeds', d);
  ok(!(await W.DB.get(env, 'fin', 'gone@x.com')),
     'and the credential is still removed from our side', true);
}

section('The subscription is cancelled, not just forgotten');
{
  /* The one failure here that costs a real person real money. Deleting the
     account used to drop the customer maps and stop, so the card kept being
     charged monthly for a product they no longer had - and with the reverse-map
     gone, the webhook for those charges could not resolve to anybody either. */
  await seed();
  const env2 = Object.assign({}, env, { STRIPE_SECRET_KEY: 'sk_test' });
  await env2.AMV_KV.put('stripecust:gone@x.com', 'cus_1');
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), method: (init && init.method) || 'GET' });
    if (/subscriptions\?/.test(String(url)))
      return { ok: true, json: async () => ({ data: [{ id: 'sub_1' }, { id: 'sub_2' }] }) };
    return { ok: true, json: async () => ({ removed: true }) };
  };
  await W.authDeleteAccount(req(), env2);

  const cancels = seen.filter(c => c.method === 'DELETE' && /\/subscriptions\//.test(c.url));
  ok(cancels.length === 2, 'every active subscription is cancelled', cancels.map(c => c.url));
  ok(cancels.some(c => /sub_1/.test(c.url)) && cancels.some(c => /sub_2/.test(c.url)),
     'by id, so none is missed', cancels.length);
}

section('A cancellation that fails reaches a human');
{
  /* The account row is about to disappear, so a silent failure here means a
     card being charged forever with nothing left pointing at the problem. */
  await seed();
  const env2 = Object.assign({}, env, { STRIPE_SECRET_KEY: 'sk_test' });
  await env2.AMV_KV.put('stripecust:gone@x.com', 'cus_1');
  const logged = [];
  const realLog = console.log; const realErr = console.error;
  console.log = (...a) => logged.push(a.join(' '));
  console.error = (...a) => logged.push(a.join(' '));
  globalThis.fetch = async (url, init) => {
    if (/subscriptions\?/.test(String(url)))
      return { ok: true, json: async () => ({ data: [{ id: 'sub_1' }] }) };
    if ((init && init.method) === 'DELETE') return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({}) };
  };
  const r = await W.authDeleteAccount(req(), env2);
  console.log = realLog; console.error = realErr;
  const d = await r.json();
  ok(d.ok === true, 'the erasure still completes', d);
  ok(logged.join('\n').indexOf('gone@x.com') >= 0,
     'and the failure is recorded against the account it concerns', logged.length);
}

section('A team does not keep a paid plan with nobody paying');
{
  /* The owner is the one who pays, and a team's plan is a cached copy of their
     entitlement. Deleting the owner used to leave elite sitting on the record
     with no lapse marker: every member kept a paid plan, free, permanently. */
  await seed();
  await W.DB.put(env, 'team', 'T1', { id:'T1', ownerEmail:'gone@x.com', plan:'elite',
    members:[{ email:'gone@x.com', role:'owner' }, { email:'mate@x.com', role:'member' }] });
  await env.AMV_KV.put('userteam:gone@x.com', 'T1');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  await W.authDeleteAccount(req(), env);

  const team = await W.DB.get(env, 'team', 'T1');
  ok(team, 'the team itself survives, because other people\'s work lives in it', !!team);
  ok(team.plan === 'free', 'but it stops being a paid team', team.plan);
  ok(team.ownerGone > 0, 'and records why', team.ownerGone);
  ok((team.members || []).some(m => m.email === 'mate@x.com'),
     'the remaining member keeps their place', (team.members || []).map(m => m.email));
  ok(!(team.members || []).some(m => m.email === 'gone@x.com'),
     'and the deleted owner is no longer listed', (team.members || []).map(m => m.email));
}

section('API keys do not outlive the account');
{
  /* A key resolves by hash to an email, and the request path never checks the
     account still exists. Neither the records nor the lookups were deleted, so
     every key a person had carried on authenticating after they closed their
     account - live credentials belonging to nobody. */
  await seed();
  await W.DB.put(env, 'apikeys', 'gone@x.com', { items: [
    { id:'k_1', name:'CI', hash:'h1' }, { id:'k_2', name:'Laptop', hash:'h2' } ] });
  await env.AMV_KV.put('apikey:h1', JSON.stringify({ email:'gone@x.com', id:'k_1' }));
  await env.AMV_KV.put('apikey:h2', JSON.stringify({ email:'gone@x.com', id:'k_2' }));
  globalThis.fetch = async () => ({ ok:true, json: async () => ({}) });
  await W.authDeleteAccount(req(), env);

  ok(!(await W.DB.get(env, 'apikeys', 'gone@x.com')), 'the key records are gone', true);
  ok(!(await env.AMV_KV.get('apikey:h1')), 'and the lookup the request path reads', true);
  ok(!(await env.AMV_KV.get('apikey:h2')), 'for every key, not just the first', true);
}

section('A key belonging to nobody does not authenticate');
{
  /* Defence in depth behind the deletion above. A key that authenticates on the
     strength of a lookup row alone is one orphaned record - a partial delete, a
     restore, a bug - away from being a live credential belonging to nobody. */
  store.clear();
  const hash = await W._apiKeyHash('amv_sk_orphan');
  await env.AMV_KV.put('apikey:' + hash, JSON.stringify({ email:'ghost@x.com', id:'k_9' }));
  await W.DB.put(env, 'apikeys', 'ghost@x.com', { items:[{ id:'k_9', name:'old', hash }] });
  // Deliberately NO acct row - the account is gone but the records lingered.
  const req2 = new Request('https://x/v1/messages', {
    method:'POST', headers:{ Authorization:'Bearer amv_sk_orphan' }, body:'{}' });
  const who = await W._userFromApiKey(req2, env);
  ok(who === null, 'the key resolves to nobody and is refused', who);

  await W.DB.put(env, 'acct', 'ghost@x.com', { email:'ghost@x.com' });
  const back = await W._userFromApiKey(req2, env);
  ok(back && back.email === 'ghost@x.com',
     'and the same key works again once there is a real account behind it', back && back.email);
}

section('Financial records are kept on purpose');
{
  /* Erasure does not override an invoice retention obligation, and deciding
     otherwise is a legal call rather than an engineering one. */
  await seed();
  await W.DB.put(env, 'billing', 'gone@x.com', { customerId:'cus_1', invoices:[1,2] });
  globalThis.fetch = async () => ({ ok:true, json: async () => ({}) });
  await W.authDeleteAccount(req(), env);
  ok(!!(await W.DB.get(env, 'billing', 'gone@x.com')),
     'billing survives, deliberately, until somebody decides how long', true);
}

section('A restore can put back what cannot be re-derived');
{
  const p = W.BACKUP_PREFIXES;
  ['consent:', 'apikeys:', 'fam:', 'links:', 'approvals:', 'billing:'].forEach(k => {
    ok(p.indexOf(k) >= 0, k + ' is backed up', k);
  });
}

section('A backup never carries a bank credential');
{
  /* An admin-exported JSON is the last place a live access token to somebody's
     financial institution should exist. A restore leaving accounts unlinked is
     the correct trade. */
  const p = W.BACKUP_PREFIXES;
  ok(p.indexOf('fin:') < 0, 'the access token is not exported', true);
  ok(p.indexOf('finlink:') < 0, 'nor a pending link session', true);
  ok(p.indexOf('invsnap:') < 0, 'nor a record of real balances', true);
  /* Membership, not a magic count. Asserting the length made every FUTURE
     deliberate exclusion fail this test, which would push the next person to
     leave one out rather than write it down - the opposite of the point. The
     stronger property, that every durable kind is in exactly one of the two
     lists, is enforced in backup-covers-everything. */
  ok(Array.isArray(W.BACKUP_NEVER)
     && ['fin:','finlink:','invsnap:'].every(k => W.BACKUP_NEVER.indexOf(k) >= 0),
     'and the omission is written down as a decision rather than left to look like an oversight',
     W.BACKUP_NEVER);
  W.BACKUP_NEVER.forEach(k => ok(p.indexOf(k) < 0, k + ' really is excluded', k));
}

globalThis.fetch = realFetch;
section('A connected Google account does not outlive the account');
{
  /* Connecting Google leaves a LONG-LIVED refresh token on the server - the
     browser only ever gets a short one, deliberately. Nothing erased it, so
     closing an account left a standing grant to somebody's mail and calendar
     belonging to a user who no longer exists, revocable by nobody.

     Erasure already reaches outside this worker to disconnect the bank. The
     same has to be true here or it is not erasure. */
  /* This suite shares one store and one env; the section clears what it needs
     rather than building a second fixture that could drift from the real one. */
  store.clear();
  const env2 = env;
  const revoked = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    revoked.push({ url: String(url), body: String((opts && opts.body) || '') });
    return new Response('{}', { status: 200 });
  };

  await W.DB.put(env2, 'acct', 'gone@x.com', { email:'gone@x.com' });
  await W.DB.put(env2, 'goauth', 'gone@x.com', { refreshToken:'1//long-lived-refresh', scope:'gmail' });

  W.__setRequireUser(async () => ({ email:'gone@x.com' }));
  await W.authDeleteAccount(new Request('https://w/auth/delete',
    { method:'POST', body: JSON.stringify({ confirm:'DELETE' }) }), env2);

  globalThis.fetch = priorFetch;

  const hit = revoked.find(r => /oauth2\.googleapis\.com\/revoke/.test(r.url));
  ok(!!hit, 'the refresh token is revoked at Google, not just dropped here', revoked.map(r=>r.url));
  ok(hit && /1%2F%2Flong-lived-refresh|1\/\/long-lived-refresh/.test(hit.body),
     'and it is THAT account\'s token being revoked', hit && hit.body);
  ok(!(await W.DB.get(env2, 'goauth', 'gone@x.com')),
     'and our copy is gone too', await W.DB.get(env2, 'goauth', 'gone@x.com'));
}

section('Spending limits do not outlive the account either');
{
  store.clear();
  const env3 = env;
  await W.DB.put(env3, 'acct', 'gone2@x.com', { email:'gone2@x.com' });
  await W.DB.put(env3, 'spendlimits', 'gone2@x.com', { enabled:true, perPurchase:100 });
  W.__setRequireUser(async () => ({ email:'gone2@x.com' }));
  await W.authDeleteAccount(new Request('https://w/auth/delete',
    { method:'POST', body: JSON.stringify({ confirm:'DELETE' }) }), env3);
  ok(!(await W.DB.get(env3, 'spendlimits', 'gone2@x.com')),
     'the limits record is erased with everything else', true);
}

if (report('erasure') > 0) process.exitCode = 1;
done();
