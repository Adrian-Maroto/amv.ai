/* REFERRALS - the growth loop, tested from the attacker's side first.

   A referral programme is trivial to write and trivial to steal from: the
   obvious version pays out on signup, and a farm of throwaway inboxes drains
   it in an afternoon. So most of this file is not "does the reward arrive" -
   it is the list of ways someone would try to mint rewards out of nothing, and
   the assertion that each one earns exactly zero. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'referrals.harness.mjs');
writeFileSync(harness, src + `
export { authSignup, getEntitlement, referralStatus, requireUser, effectiveLimits,
         _referralEnsure, _referralCapture, _referralMaybeConvert, _bonusTokens,
         _referralActive, counter, monthKey, DB, issueTokens,
         REFERRAL_REWARD_TOKENS, REFERRAL_MAX_CONVERSIONS, REFERRAL_QUALIFY_TOKENS,
         REFERRAL_MIN_AGE_MS, REFERRAL_DAY_CAP, PLAN_LIMITS };
`);
const W = await import(harness + '?t=' + Date.now());

function makeEnv() {
  const kv = new Map();
  return {
    _kv: kv,
    JWT_SECRET: 'test-secret-abcdefghijklmnopqrstuv',
    APP_URL: 'https://amv.example',
    AMV_KV: {
      get: async k => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })) }),
    },
  };
}

const req = (path, body, ip) => new Request('https://w' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(ip ? { 'CF-Connecting-IP': ip } : {}) },
  body: JSON.stringify(body || {}),
});
const authed = (path, token) => new Request('https://w' + path, { headers: { Authorization: 'Bearer ' + token } });

/* Create a real account through the real signup endpoint - captcha, honeypot,
   password hashing and all - so nothing here is testing a shortcut. */
async function signup(env, email, ip, ref) {
  const r = await W.authSignup(req('/auth/signup', { email, name: 'T', password: 'correct-horse-9', ref }, ip), env);
  const d = await r.json();
  if (!d.token) throw new Error('signup failed for ' + email + ': ' + JSON.stringify(d));
  return d.token;
}
async function codeOf(env, token) {
  return (await (await W.referralStatus(authed('/v1/referral', token), env)).json()).code;
}
/* Make an account look like one that has actually been used: a day old, and
   past the token floor. This is precisely what a farm cannot cheaply fake. */
async function makeReal(env, email, tokens = W.REFERRAL_QUALIFY_TOKENS) {
  const acct = await W.DB.get(env, 'acct', email);
  acct.createdAt = Date.now() - W.REFERRAL_MIN_AGE_MS - 60000;
  await W.DB.put(env, 'acct', email, acct);
  if (tokens) await W.counter(env, `usg:${email}:${W.monthKey()}`, { op: 'incr', amount: tokens });
}
const bonusOf = async (env, email) => W._bonusTokens((await W.DB.get(env, 'ent', email)) || {});
const openApp = (env, token) => W.getEntitlement(authed('/v1/entitlement', token), env);

section('Every account has a stable invite code, and it is its own');
{
  const env = makeEnv();
  const t = await signup(env, 'a@x.com', '1.1.1.1');
  const c1 = await codeOf(env, t);
  const c2 = await codeOf(env, t);
  ok(!!c1 && c1.length >= 8, 'a code is issued', c1);
  ok(c1 === c2, 'and it is the same code every time, so a shared link never dies', c2);
  ok(await env.AMV_KV.get('refcode:' + c1) === 'a@x.com', 'the reverse lookup resolves to its owner');

  const t2 = await signup(env, 'b@x.com', '2.2.2.2');
  ok((await codeOf(env, t2)) !== c1, 'a different account gets a different code');

  const st = await (await W.referralStatus(authed('/v1/referral', t), env)).json();
  ok(st.link === 'https://amv.example/?ref=' + c1, 'the link is a real URL to the real app', st.link);
}

section('A signup through an invite pays NOBODY yet');
{
  const env = makeEnv();
  const inviter = await signup(env, 'inviter@x.com', '1.1.1.1');
  const code = await codeOf(env, inviter);
  await signup(env, 'joiner@x.com', '9.9.9.9', code);

  ok(!!(await env.AMV_KV.get('refpend:joiner@x.com')), 'the invite is recorded as pending');
  await openApp(env, inviter);
  ok((await bonusOf(env, 'inviter@x.com')) === 0, 'the inviter has earned nothing from a bare signup');
  ok((await bonusOf(env, 'joiner@x.com')) === 0, 'and neither has the account that just signed up');
}

section('The reward lands only once the invited account is genuinely used');
{
  const env = makeEnv();
  const inviter = await signup(env, 'inviter@x.com', '1.1.1.1');
  const code = await codeOf(env, inviter);
  const joiner = await signup(env, 'joiner@x.com', '9.9.9.9', code);

  // Old enough, but has not used AMV at all.
  await makeReal(env, 'joiner@x.com', 0);
  await openApp(env, joiner);
  ok((await bonusOf(env, 'inviter@x.com')) === 0, 'age alone earns nothing');
  ok(!!(await env.AMV_KV.get('refpend:joiner@x.com')), 'and the invite stays pending rather than being burned');

  // Now they have actually used it.
  await W.counter(env, `usg:joiner@x.com:${W.monthKey()}`, { op: 'incr', amount: W.REFERRAL_QUALIFY_TOKENS });
  const d = await (await openApp(env, joiner)).json();
  ok((await bonusOf(env, 'inviter@x.com')) === W.REFERRAL_REWARD_TOKENS, 'now the inviter is paid');
  ok((await bonusOf(env, 'joiner@x.com')) === W.REFERRAL_REWARD_TOKENS, 'and so is the person who joined');
  ok(d.referralEarned === W.REFERRAL_REWARD_TOKENS, 'the app is told, so it can say so', d.referralEarned);
  ok(!(await env.AMV_KV.get('refpend:joiner@x.com')), 'the invite is consumed');

  // The single most valuable assertion in this file.
  await openApp(env, joiner); await openApp(env, joiner);
  ok((await bonusOf(env, 'inviter@x.com')) === W.REFERRAL_REWARD_TOKENS, 'reopening the app cannot pay it again');
}

section('A reward is extra monthly capacity, and nothing else');
{
  const env = makeEnv();
  const base = W.PLAN_LIMITS.free;
  const plain = W.effectiveLimits({ plan: 'free', bonusTokens: 0 });
  const withBonus = W.effectiveLimits({ plan: 'free', bonusTokens: W.REFERRAL_REWARD_TOKENS });
  ok(plain.monthTokens === base.monthTokens, 'no bonus changes nothing');
  ok(withBonus.monthTokens === base.monthTokens + W.REFERRAL_REWARD_TOKENS, 'the bonus is added to the month');
  ok(withBonus.dayTokens === base.dayTokens, 'but NOT to the day - an invite buys more days, not one huge one');
  ok(withBonus.imagesDay === base.imagesDay && withBonus.videosMonth === base.videosMonth,
     'and it buys no images or video, which are the expensive things');

  const absurd = W.effectiveLimits({ plan: 'free', bonusTokens: 99999999999 });
  ok(absurd.monthTokens === base.monthTokens + W.REFERRAL_MAX_CONVERSIONS * W.REFERRAL_REWARD_TOKENS,
     'a corrupted entitlement cannot mint unlimited allowance - the ceiling is enforced at read time',
     absurd.monthTokens);
  ok(W.effectiveLimits({ plan: 'free', bonusTokens: -500000 }).monthTokens === base.monthTokens,
     'and a negative bonus cannot take allowance away either');
}

section('FARMING: you cannot invite yourself');
{
  const env = makeEnv();
  const t = await signup(env, 'solo@x.com', '1.1.1.1');
  const code = await codeOf(env, t);
  await W._referralCapture(env, req('/x', {}, '1.1.1.1'), 'solo@x.com', code);
  ok(!(await env.AMV_KV.get('refpend:solo@x.com')), 'a self-referral is not even recorded');
}

section('FARMING: invites from your own machine earn nothing');
{
  const env = makeEnv();
  const inviter = await signup(env, 'farmer@x.com', '5.5.5.5');
  const code = await codeOf(env, inviter);
  const burner = await signup(env, 'burner@x.com', '5.5.5.5', code);   // same network
  await makeReal(env, 'burner@x.com');
  await openApp(env, burner);

  ok((await bonusOf(env, 'farmer@x.com')) === 0, 'the farmer is paid nothing');
  ok((await bonusOf(env, 'burner@x.com')) === 0, 'and so is the throwaway account');
  const abuse = await W.DB.get(env, 'abuse', 'farmer@x.com');
  ok(!!abuse && abuse.events.some(e => e.kind === 'referral_same_device'),
     'the attempt is written to the abuse ledger, so a pattern becomes visible');
  ok(!(await env.AMV_KV.get('refpend:burner@x.com')), 'and the invite is burned, not left to retry');
}

section('FARMING: the signup network is never stored, only compared');
{
  const env = makeEnv();
  await signup(env, 'priv@x.com', '203.0.113.77');
  const acct = await W.DB.get(env, 'acct', 'priv@x.com');
  ok(!!acct.sipHash, 'a fingerprint is stored');
  ok(!JSON.stringify(acct).includes('203.0.113.77'), 'but the address itself appears nowhere in the record');
  ok(!/\d+\.\d+\.\d+\.\d+/.test(acct.sipHash), 'the fingerprint is not an address in disguise', acct.sipHash);

  const env2 = makeEnv();
  env2.JWT_SECRET = 'a-completely-different-server-key';
  await signup(env2, 'priv@x.com', '203.0.113.77');
  const other = await W.DB.get(env2, 'acct', 'priv@x.com');
  ok(other.sipHash !== acct.sipHash, 'and it is keyed, so it cannot be looked up from a rainbow table of IPs');
}

section('FARMING: one code cannot mint an unlimited number of signups a day');
{
  const env = makeEnv();
  const t = await signup(env, 'bulk@x.com', '1.1.1.1');
  const code = await codeOf(env, t);
  for (let i = 0; i < W.REFERRAL_DAY_CAP; i++) {
    await W._referralCapture(env, req('/x', {}, '7.7.7.' + i), `v${i}@x.com`, code);
  }
  ok(!!(await env.AMV_KV.get('refpend:v0@x.com')), 'signups inside the daily cap are recorded');
  await W._referralCapture(env, req('/x', {}, '8.8.8.8'), 'over@x.com', code);
  ok(!(await env.AMV_KV.get('refpend:over@x.com')), 'the one past the cap earns nothing');
  const abuse = await W.DB.get(env, 'abuse', 'bulk@x.com');
  ok(!!abuse && abuse.events.some(e => e.kind === 'referral_velocity'), 'and the velocity is flagged');
}

section('FARMING: an account flagged for abuse stops earning');
{
  const env = makeEnv();
  const inviter = await signup(env, 'bad@x.com', '1.1.1.1');
  const code = await codeOf(env, inviter);
  const joiner = await signup(env, 'ok@x.com', '9.9.9.9', code);
  await W.DB.put(env, 'abuse', 'bad@x.com', { email: 'bad@x.com', blocked: true, events: [] });
  await makeReal(env, 'ok@x.com');
  await openApp(env, joiner);
  ok((await bonusOf(env, 'bad@x.com')) === 0, 'a blocked account earns nothing more');
}

section('There is a hard ceiling on what any account can hold');
{
  const env = makeEnv();
  const inviter = await signup(env, 'pop@x.com', '1.1.1.1');
  const code = await codeOf(env, inviter);
  for (let i = 0; i < W.REFERRAL_MAX_CONVERSIONS + 3; i++) {
    const email = `f${i}@x.com`;
    const tok = await signup(env, email, '4.4.4.' + i, code);
    await makeReal(env, email);
    await openApp(env, tok);
  }
  const ent = await W.DB.get(env, 'ent', 'pop@x.com');
  ok(W._referralActive(ent).length === W.REFERRAL_MAX_CONVERSIONS,
     'exactly the maximum number of rewards is held', W._referralActive(ent).length);
  ok((await bonusOf(env, 'pop@x.com')) === W.REFERRAL_MAX_CONVERSIONS * W.REFERRAL_REWARD_TOKENS,
     'so the exposure per account is a known, bounded number');
}

section('Rewards expire, so the free tier does not inflate forever');
{
  const env = makeEnv();
  await W.DB.put(env, 'ent', 'old@x.com', { plan: 'free', refBonus: [
    { at: Date.now() - 200 * 86400000, tokens: W.REFERRAL_REWARD_TOKENS },   // long past its window
    { at: Date.now() - 5 * 86400000,   tokens: W.REFERRAL_REWARD_TOKENS },
  ] });
  ok((await bonusOf(env, 'old@x.com')) === W.REFERRAL_REWARD_TOKENS, 'only the live reward counts');
}

section('A bad invite code never breaks a signup');
{
  const env = makeEnv();
  const t = await signup(env, 'new@x.com', '1.1.1.1', 'NOTACODE99');
  ok(!!t, 'the account is created regardless');
  ok(!(await env.AMV_KV.get('refpend:new@x.com')), 'and nothing is credited to a code that does not exist');
  const t2 = await signup(env, 'new2@x.com', '1.1.1.1', '<script>alert(1)</script>');
  ok(!!t2, 'a hostile code is harmless too');
}

section('The invite page does not disclose who joined');
{
  const env = makeEnv();
  const inviter = await signup(env, 'host@x.com', '1.1.1.1');
  const code = await codeOf(env, inviter);
  const joiner = await signup(env, 'guest@x.com', '9.9.9.9', code);
  await makeReal(env, 'guest@x.com');
  await openApp(env, joiner);
  const body = await (await W.referralStatus(authed('/v1/referral', inviter), env)).text();
  ok(body.includes('"bonusTokens"'), 'the inviter sees what they earned');
  ok(!body.includes('guest@x.com'), 'but not the address of the person who accepted the invite');
}

section('Referrals require a signed-in account');
{
  const env = makeEnv();
  const r = await W.referralStatus(new Request('https://w/v1/referral'), env);
  ok(r.status === 401, 'an anonymous caller cannot fish for codes', r.status);
}

report('referrals');
done();
