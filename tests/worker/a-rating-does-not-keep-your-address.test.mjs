/* A RATING KEPT THE RATER'S ADDRESS SOMEWHERE ERASURE COULD NOT REACH.

   marketRate stored map[user.email] = stars into mkrate:<listingId>. That
   record is keyed by the LISTING - somebody else's listing - so it is not in
   PER_USER_KINDS and it could not be: erasing a rater's account cannot reach a
   record filed under a seller's item. The address outlived the deletion, with
   nothing anywhere able to find it.

   marketReview, the very next function in the file, already did this right and
   said why in its own comment: store a pseudonymous id, never the raw email,
   so a list can be shown publicly without leaking addresses. Same record shape,
   same reasoning, one function apart, and only one of them followed it. I fixed
   exactly this defect while building marketReport and did not think to look at
   the function above it.

   The second half of this file is about the register itself. SECURITY-SCAMS.md
   is a list of ~50 defences, each marked as implemented. It is the document
   somebody would be shown if they asked how AMV handles abuse, which makes an
   overstatement in it worse than a gap: it stops the check from being made.
   Item 24 claimed the page ships `default-src 'none'`. It ships 'self'. It
   also recorded a real limit - inline script was allowed, because the app used
   inline onclick attributes throughout - and that limit is now closed: the
   attributes are gone and the inline scripts are named by hash. So the item
   has been corrected twice, in opposite directions, and the checks below move
   with it. A register that understates a defence goes stale quietly; one that
   overstates it stops somebody making the check. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const register = readFileSync(join(ROOT, 'SECURITY-SCAMS.md'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'rate.harness.mjs');
writeFileSync(harness, src + '\nexport { _errHash };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv() {
  const m = new Map(); const vals = new Map();
  return {
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admintok', APP_URL: 'https://amv.test',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        const from = cursor ? +cursor : 0;
        const page = all.slice(from, from + (limit || 1000));
        return { keys: page, list_complete: from + page.length >= all.length, cursor: String(from + page.length) };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') {
          if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false }));
          vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true }));
        }
        if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, path, body, tok) => {
  const r = await call(env, path, body, tok);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const signup = async (env, email) =>
  (await (await call(env, '/auth/signup', { email, name: email.split('@')[0], password: 'A-real-Passw0rd!' })).json()).token;

const LISTING = { id: 'usr_x', title: 'A Thing', authorEmail: 'seller@example.com', price: 20, status: 'active', kind: 'prompt' };
/* Ownership is what marketRate gates on, and it is granted only by a completed
   purchase - which is also why a seller cannot rate their own listing: buying
   your own is refused, so the entitlement never exists. Set directly here so
   the rating path can be exercised without running a whole checkout. */
const own = (env, email) => env.AMV_KV._map.set(`entitleitem:${email}:usr_x`, '1');
const seed = (env) => env.AMV_KV._map.set('market:usr_x', JSON.stringify(LISTING));

section('A rating does not record who by, in a record erasure cannot reach');
{
  const env = mkEnv(); seed(env);
  const tok = await signup(env, 'rater@example.com'); own(env, 'rater@example.com');
  const r = await post(env, '/v1/market/rate', { id: 'usr_x', stars: 4 }, tok);
  ok(r.body.ok === true, 'the rating lands', r.body);
  const raw = env.AMV_KV._map.get('mkrate:usr_x');
  ok(!/rater@example\.com/.test(raw), 'and the address is not in it', raw);
  ok(/"[0-9a-f]{16}":\s*4/.test(raw), 'a one-way id is', raw);
  ok(r.body.rating === 4, 'while the number anybody actually reads is unchanged', r.body.rating);
}

section('One person still counts once');
{
  const env = mkEnv(); seed(env);
  const tok = await signup(env, 'rater@example.com'); own(env, 'rater@example.com');
  await post(env, '/v1/market/rate', { id: 'usr_x', stars: 5 }, tok);
  const r = await post(env, '/v1/market/rate', { id: 'usr_x', stars: 1 }, tok);
  ok(r.body.ratings === 1, 'a second rating replaces the first rather than stacking', r.body.ratings);
  ok(r.body.rating === 1, 'and the new one is what counts', r.body.rating);
}

section('And addresses already stored are converted rather than left');
{
  /* The migration is the point: a fix that only protects future raters leaves
     every existing address exactly where it was. The keys ARE the addresses and
     the hash is a pure function of one, so an old map can be converted here
     without knowing whose entries they are. */
  const env = mkEnv(); seed(env);
  env.AMV_KV._map.set('mkrate:usr_x', JSON.stringify({ 'old1@example.com': 5, 'old2@example.com': 3 }));
  const tok = await signup(env, 'rater@example.com'); own(env, 'rater@example.com');
  const r = await post(env, '/v1/market/rate', { id: 'usr_x', stars: 4 }, tok);
  const raw = env.AMV_KV._map.get('mkrate:usr_x');
  ok(!/@example\.com/.test(raw), 'no address survives the next write to that record', raw);
  ok(Object.keys(JSON.parse(raw)).length === 3, 'and every rating is still counted', Object.keys(JSON.parse(raw)));
  ok(r.body.rating === 4, 'with the average intact: (5+3+4)/3', r.body.rating);
  ok(Object.keys(JSON.parse(raw)).every(k => /^[0-9a-f]{16}$/.test(k)),
     'every key is a hash, old and new alike', Object.keys(JSON.parse(raw)));
}

section('A hashed key is not re-hashed on the next write');
{
  /* Migrating an already-migrated key would change it, which would turn one
     person into two and let somebody rate twice. */
  const env = mkEnv(); seed(env);
  const a = await signup(env, 'rater@example.com'); own(env, 'rater@example.com');
  await post(env, '/v1/market/rate', { id: 'usr_x', stars: 5 }, a);
  const first = Object.keys(JSON.parse(env.AMV_KV._map.get('mkrate:usr_x')));
  await post(env, '/v1/market/rate', { id: 'usr_x', stars: 2 }, a);
  const second = Object.keys(JSON.parse(env.AMV_KV._map.get('mkrate:usr_x')));
  ok(first.length === 1 && second.length === 1, 'still one rater', { first, second });
  ok(first[0] === second[0], 'and the same id, so a rehash cannot split one person into two', { first, second });
}

section('The two records that name a person agree with each other');
{
  /* The defect was that they did not: reviews hashed, ratings did not, one
     function apart. */
  const rate = src.slice(src.indexOf('async function marketRate('), src.indexOf('async function marketReview('));
  const review = src.slice(src.indexOf('async function marketReview('));
  ok(/_errHash\(/.test(rate), 'ratings store a hashed id', true);
  ok(/_errHash\(/.test(review.slice(0, 3000)), 'and so do reviews', true);
  /* Matched as CODE, not as prose. The first version matched `map[user.email]`
     anywhere in the slice and failed on the comment explaining what the old
     code did - and the second version stripped only lines starting with a
     comment marker, which misses the body of a block comment whose
     continuation lines start with plain text. A check that cannot tell a
     defect from a sentence about a defect will block the fix. */
  const codeOnly = rate.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/map\[\s*user\.email\s*\]\s*=/.test(codeOnly),
     'nothing keys a public aggregate by address any more', true);
}

section('The scam register describes the CSP that actually ships');
{
  /* A register that overstates a defence is worse than one that omits it: it
     stops somebody making the check. */
  const shipped = (html.match(/default-src ([^;"]*)/) || [])[1] || '';
  ok(/'self'/.test(shipped), 'the page ships default-src self', shipped.trim());

  const item24 = (register.match(/^24\..*$/m) || [''])[0];
  ok(item24.length > 0, 'item 24 was found', item24.slice(0, 60));
  ok(!/default-src\s*`?'none'/.test(item24),
     'and no longer claims a policy the page has never shipped', item24.slice(0, 200));
  ok(/default-src/.test(item24) && /'self'/.test(item24),
     'it names the one that is really there', true);
  /* This used to require the register to ADMIT that script-src allowed inline.
     It does not any more, so the check flips with the fact: the register must
     not still be claiming a limit that was closed, and the shipped page must
     really be the stricter one. A register that understates a defence goes
     stale quietly; one that overstates it stops somebody making the check. */
  /* Out of the policy, not out of the file: a comment above the meta tag
     mentions the header, and searching the whole file finds the comment first.
     That is what a decoy costs - the assertion reads something nobody serves. */
  const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([\s\S]*?)">/) || [, ''])[1];
  const shippedScript = (csp.match(/(?:^|\s)script-src\s+([^;]*)/) || [])[1] || '';
  ok(shippedScript.length > 20 && !/'unsafe-inline'/.test(shippedScript),
     'the page really does refuse inline script now', shippedScript.slice(0, 70));
  ok(/no longer carries/.test(item24) || /does not carry/.test(item24),
     'and the register records it as closed rather than as an open limit', item24.slice(0, 240));
  ok(/style-src/.test(item24) && /unsafe-inline/.test(item24),
     'it names the one that IS still open - inline styles - rather than dropping the caveat entirely',
     true);
}

section('And the register is not claiming that limit away elsewhere');
{
  const wrong = [...register.matchAll(/default-src\s*`?'none'/g)].length;
  ok(wrong === 0, 'nothing anywhere in the register claims default-src none', wrong);
}


section('Every external link drops the referrer as well as the opener');
{
  /* Register item 45 said external links carry rel="noopener noreferrer".
     Sixteen of eighteen carried noopener alone. The tab-nabbing defence the
     item is NAMED for was genuinely in place - noopener is the one that stops
     window.opener - but the destination still learned which AMV page somebody
     came from, and a shared-artifact or deployed-site URL is not a thing to
     hand to whatever they clicked through to. */
  const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const opener = (bundle.match(/rel="noopener"/g) || []).length;
  const both   = (bundle.match(/rel="noopener noreferrer"/g) || []).length;
  ok(both > 10, 'external links carry both', both);
  ok(opener === 0, 'and none carries noopener alone any more', opener);

  const item45 = (register.match(/^45\..*$/m) || [''])[0];
  ok(/noreferrer/.test(item45), 'the register still claims it', item45.slice(0, 80));
}

section('The register describes the SSRF gate that actually exists');
{
  /* It claimed only public http(s) passes, which was true of the first hop and
     false across a redirect until that was fixed. The claim is true now; the
     item says WHY, because "only public passes" is exactly what somebody would
     read and not re-check. */
  const item53 = (register.match(/^53\..*$/m) || [''])[0];
  ok(/every hop/i.test(item53), 'it names the property that makes it true', item53.slice(0, 120));
  ok(/redirect/i.test(item53) && /Authorization/.test(item53),
     'including the redirect and the credential that used to travel with it', true);
}

section('And the register has no mojibake in it');
{
  /* A stray thorn in "per-minute/per-day" - trivial, and this is a document
     somebody may be shown when they ask how AMV handles abuse. */
  const junk = (register.match(/[\u00fe\u00c3\u00ef\ufffd]/g) || []);
  ok(junk.length === 0, 'no stray characters', junk.slice(0, 5));
}


section('The register does not defend a risk by denying the feature exists');
{
  /* Item 10 said referral farming was safe because "no cash/credit referral
     program exists, so there's nothing to farm". One exists: both sides of a
     conversion get REFERRAL_REWARD_TOKENS. The reasoning given was therefore
     void, while the protections that DO bound it - a cap on active rewards, a
     TTL, an audit line when a grant is refused, and the fact that the reward is
     tokens rather than money - went unwritten. That is the worst version: the
     defence is real and the document points somewhere else, so nobody checks
     the numbers that matter. */
  ok(/REFERRAL_REWARD_TOKENS\s*=\s*\d+/.test(src), 'the reward exists in the code', true);
  const item10 = (register.match(/^10\..*$/m) || [''])[0];
  ok(!/no cash\/credit referral program exists/i.test(item10),
     'and the register no longer denies it', item10.slice(0, 120));
  ok(/REFERRAL_MAX_CONVERSIONS/.test(item10) && /REFERRAL_BONUS_TTL_MS/.test(item10),
     'it names the two bounds that actually limit farming', item10.slice(0, 200));
  ok(/token/i.test(item10) && /(cash|withdraw)/i.test(item10),
     'and says the reward cannot become money, which is why this is spend and not loss', true);

  /* The numbers in the document are the numbers in the code. A register that
     quotes a constant is a register that goes stale the day somebody tunes it. */
  const constOf = (n) => { const m = src.match(new RegExp(n + '\\s*=\\s*(\\d+)')); return m ? m[1] : null; };
  const maxConv = constOf('REFERRAL_MAX_CONVERSIONS');
  const reward  = constOf('REFERRAL_REWARD_TOKENS');
  ok(maxConv && item10.includes('(' + maxConv + ')'),
     'the cap quoted in the register matches the code', { code: maxConv, item: item10.slice(0, 200) });
  ok(reward && item10.includes(Number(reward).toLocaleString('en-US')),
     'and so does the reward size', { code: reward });
}

section('An error message does not send somebody to a screen that is not there');
{
  /* "Add a payment method to buy it" named an action AMV has no screen for -
     cards live at Stripe and are taken during checkout, and the one function
     that used to open a payment sheet was itself reachable from nothing. A
     sentence pointing at a door that does not exist is the same dead end as a
     button that does nothing. */
  const bundle2 = readFileSync(join(ROOT, 'app.js'), 'utf8');
  ok(!/Add a payment method to buy it/.test(bundle2),
     'the message no longer names a screen that does not exist', true);
  ok(/Paid items go through secure checkout/.test(bundle2),
     'and says what really has to happen instead', true);
}


section('A defence that is not built says so');
{
  /* Item 51 listed "(server) KYC" beside two things that really are built.
     There is no identity check anywhere in the code. Naming an absent control
     in a list of present ones is how an operator ends up believing a gate is
     there - and this is the payout path, where believing it costs money. */
  /* This used to assert there was no KYC at all, which was true when it was
     written and is the wrong question now. There is a threshold and a hook;
     what there is NOT is anything that verifies a person. The assertion that
     matters is that nothing marks somebody verified on the strength of
     nothing - a fake verification is worse than none, because it converts a
     queue entry into a released payout. */
  const kycFn = src.slice(src.indexOf('async function _kycState'), src.indexOf('async function _payoutRisk'));
  ok(/PAYOUT_KYC_THRESHOLD_USD/.test(src), 'a threshold exists', true);
  ok(!/verified:\s*true/.test(kycFn),
     'and nothing in the identity path marks anybody verified by itself', true);
  ok(/_kycState\(/.test(src.slice(src.indexOf('async function _payoutRisk'))),
     'the payout decision consults it rather than assuming', true);
  const item51 = (register.match(/^51\..*$/m) || [''])[0];
  ok(/[Ss]till not built/i.test(item51), 'and the register says so plainly', item51.slice(0, 140));
  ok(/MARKET_MIN_WITHDRAW/.test(item51) && /PAYOUT_HOLD_DAYS/.test(item51),
     'while naming the ones that are', true);
  ok(/PAYOUT_RESERVE_PCT/.test(item51) && /120/.test(item51),
     'including the reserve, which is what now covers the dispute window the hold does not reach', item51.slice(0, 300));
  ok(/_payoutRisk/.test(item51),
     'and the scoring that decides which payouts a person ever sees', true);
}

section('The anti-phishing rule is one that is actually true');
{
  /* Item 52 said AMV never asks for keys in-product. It does: a student pastes
     a Canvas access token, and the Connectors list takes a GitHub token and a
     Slack webhook. Teaching "if it asks for a key it is not us" to somebody
     using a product that asks for keys is worse than teaching nothing - it is
     the exact heuristic a fake-support scammer wants them to hold. */
  const bundle3 = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const asksForTokens = /paste the token from Canvas/.test(bundle3);
  ok(asksForTokens, 'the app really does ask for a third-party token', asksForTokens);

  const item52 = (register.match(/^52\..*$/m) || [''])[0];
  ok(!/never asks for passwords\/keys in-product/.test(item52),
     'so the register no longer claims otherwise', item52.slice(0, 120));
  ok(/never asks for your AMV password/i.test(item52),
     'and states the rule that does hold', item52.slice(0, 140));
  ok(/outside the app/i.test(item52),
     'plus the one that catches the actual attack: no credential is ever requested outside the app', true);

  /* And the supporting fact has to stay true: a token somebody pastes is
     masked going in and never comes back out. */
  ok(/id="schc-tok"[^>]*type="password"/.test(bundle3),
     'the token field is masked', true);
  const connect = src.slice(src.indexOf('async function schoolConnect('), src.indexOf('async function schoolConnect(') + 3000);
  /* Matched as a PROPERTY, not as the word. The first version matched
     json({ ... token ... }) and fired on the error message "that does not look
     like a Canvas access token" - the third time this session a check has
     confused a defect with a sentence describing one. What must not happen is
     the value being returned, which means `token:` as a key. */
  const returnsToken = /json\(\s*\{[^)]*\btoken\s*:/.test(connect);
  ok(!returnsToken, 'and no response hands a stored token back', returnsToken);

  /* Nor does the record that holds it get read back by any route. */
  const workFn = src.slice(src.indexOf('async function schoolWork('), src.indexOf('async function schoolWork(') + 2000);
  ok(!/\btoken\s*:/.test(workFn), 'the work list carries no credential either', true);
}

if (report('a-rating-does-not-keep-your-address') > 0) process.exitCode = 1;
done();
