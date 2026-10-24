/* A PASSKEY, OR A SECOND STEP, GUARDS THE ACCOUNT.

   Passkeys, an authenticator app and recovery codes (73-passkeys-and-mfa.js),
   driven through the Worker's own routes with a real authenticator - real
   keys, real CBOR, real signatures, from tests/lib/fake-authenticator.mjs:

   - a passkey is added only with proof it is them, and only one made on this
     site, by this origin, with a fingerprint or PIN, from a challenge issued
     for this account and spent once;
   - it signs in with nothing else, and refuses a copied key, a wrong origin,
     a tampered signature and a reused challenge;
   - an API key can change none of it;
   - with an authenticator app on, a password on a new device is not enough:
     the code is, once; a recovery code is, once; Google is not a way round;
   - the last way into an account cannot be removed;
   - a new password must be 15 characters, or 8 with a second factor. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { makeAuthenticator } from '../lib/fake-authenticator.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'passkeys.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, _totpAt, _b32enc, issueTokens };\n');
const W = await import(harness + '?t=' + Date.now());

const ORIGIN = 'https://amv.test', RP = 'amv.test';
const m = new Map(), vals = new Map();
const env = {
  JWT_SECRET: 'j'.repeat(40), APP_URL: ORIGIN, CONNECT_KEY: 'c'.repeat(44),
  AMV_KV: { async get(k){ return m.has(k) ? m.get(k) : null; }, async put(k, v){ m.set(k, v); }, async delete(k){ m.delete(k); },
    async list({ prefix } = {}){ return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init){
    const b = JSON.parse(init.body || '{}'); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
    if (b.op === 'clear') return new Response(JSON.stringify({ ok: true }));   // lifetime totals, erased with the account
    /* One object per name, as the Durable Object is: a claim is taken once. */
    if (b.op === 'claim'){ if (vals.get(n)) return r({ claimed: false }); vals.set(n, 1); return r({ claimed: true, owner: n }); }
    if (b.op === 'release'){ vals.delete(n); return r({ ok: true }); }
    if (b.op === 'incr'){ vals.set(n, cur + Number(b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur, count: 1 });
  } }) },
};
const ctx = { waitUntil(){}, passThroughOnException(){} };
let ip = 1;
const call = async (path, body, tok, headers) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.9.0.' + (ip++ % 200 + 1), ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...(headers || {}) },
    body: JSON.stringify(body || {}) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const PW = 'correct horse battery staple';
const ME = 'rosa@example.com';

section('A new password stands alone, so it must be long');
{
  const short = await call('/auth/signup', { email: 'short@example.com', name: 'S', password: 'Tr0ub4dor&3x' });
  ok(short.status === 400 && short.d.code === 'password_too_short' && short.d.min === 15, '12 characters is refused for an account with nothing else guarding it', [short.status, short.d.code, short.d.min]);
  const long = await call('/auth/signup', { email: ME, name: 'Rosa', password: PW });
  ok(long.status === 200 && !!long.d.token, 'a 28-character phrase is accepted', long.status);
}
let tok = (await call('/auth/login', { email: ME, password: PW })).d.token;

section('A passkey is added only with proof, and only one made here, for this account');
const auth = await makeAuthenticator();
{
  const noProof = await call('/auth/passkey/options', { purpose: 'register' }, tok);
  ok(noProof.status === 403 && noProof.d.code === 'stepup_failed' && noProof.d.can.password, 'a session alone cannot add one to an account with a password', [noProof.status, noProof.d.code]);
  const wrongPw = await call('/auth/passkey/options', { purpose: 'register', proof: { password: 'not it at all, sorry' } }, tok);
  ok(wrongPw.status === 403, 'nor can a wrong password', wrongPw.status);

  /* API keys are a paid-plan feature; the account gets one so the key exists. */
  await W.DB.put(env, 'ent', ME, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  const keyMade = await call('/v1/keys/create', { name: 'k' }, tok);
  const apiKey = keyMade.d.key || '';
  ok(/^amv_/.test(apiKey), 'an API key for this account exists', [keyMade.status, keyMade.d.code]);
  const byKey = await call('/auth/passkey/options', { purpose: 'register', proof: { password: PW } }, null, { Authorization: 'Bearer ' + apiKey });
  ok(byKey.status === 401, 'an API key cannot add one, even with the password', byKey.status);
  const stepNoSession = await call('/auth/passkey/options', { purpose: 'stepup' });
  ok(stepNoSession.status === 401, 'nor can anybody without a session ask for a proof challenge', stepNoSession.status);

  const opt = await call('/auth/passkey/options', { purpose: 'register', proof: { password: PW } }, tok);
  ok(opt.status === 200 && opt.d.publicKey.rp.id === RP && opt.d.publicKey.authenticatorSelection.userVerification === 'required', 'with the password: options for this site, fingerprint or PIN required', opt.d.publicKey && opt.d.publicKey.rp);

  const evil = await auth.create({ challenge: opt.d.publicKey.challenge, origin: 'https://amv-login.example', rpId: RP });
  const r1 = await call('/auth/passkey/register', { cid: opt.d.cid, credential: evil }, tok);
  ok(r1.status === 400, 'one made on another origin is refused', r1.status);
  const again = await call('/auth/passkey/register', { cid: opt.d.cid, credential: await auth.create({ challenge: opt.d.publicKey.challenge, origin: ORIGIN, rpId: RP }) }, tok);
  ok(again.status === 400 && again.d.code === 'passkey_expired', 'and its challenge is spent - it cannot be tried again', [again.status, again.d.code]);

  const o2 = await call('/auth/passkey/options', { purpose: 'register', proof: { password: PW } }, tok);
  const noUv = await call('/auth/passkey/register', { cid: o2.d.cid, credential: await auth.create({ challenge: o2.d.publicKey.challenge, origin: ORIGIN, rpId: RP, uv: false }) }, tok);
  ok(noUv.status === 400 && /fingerprint, face or PIN/.test(noUv.d.error), 'one made without a fingerprint or PIN is refused, and says why', noUv.d.error);

  const o3 = await call('/auth/passkey/options', { purpose: 'register', proof: { password: PW } }, tok);
  const good = await call('/auth/passkey/register', { cid: o3.d.cid, name: 'Rosa’s phone', credential: await auth.create({ challenge: o3.d.publicKey.challenge, origin: ORIGIN, rpId: RP }) }, tok);
  ok(good.status === 200 && good.d.security.passkeys.length === 1 && good.d.security.passkeys[0].name === 'Rosa’s phone', 'a real one is added', good.d.security);
  const stored = JSON.stringify(await W.DB.get(env, 'acct', ME));
  ok(!/"d"\s*:/.test(stored), 'and only its public key is kept', true);
}

section('A passkey signs in with nothing else');
{
  const o = await call('/auth/passkey/options', { purpose: 'signin' });
  ok(o.status === 200 && o.d.publicKey.rpId === RP && o.d.publicKey.userVerification === 'required', 'sign-in options need no account and no password', o.d.publicKey);
  const g = await auth.get({ challenge: o.d.publicKey.challenge, origin: ORIGIN, rpId: RP });
  const s = await call('/auth/passkey/signin', { cid: o.d.cid, credential: g });
  ok(s.status === 200 && !!s.d.token, 'it signs in', s.status);
  const replay = await call('/auth/passkey/signin', { cid: o.d.cid, credential: g });
  ok(replay.status === 401 && !replay.d.token, 'the same answer replayed does not', replay.status);

  const bad = async (over, label) => {
    const oo = await call('/auth/passkey/options', { purpose: 'signin' });
    const gg = await auth.get({ challenge: oo.d.publicKey.challenge, origin: ORIGIN, rpId: RP, ...over });
    const rr = await call('/auth/passkey/signin', { cid: oo.d.cid, credential: gg });
    ok(rr.status === 401 && !rr.d.token, label, rr.status);
  };
  await bad({ origin: 'https://amv-login.example' }, 'a page on another origin cannot use it');
  await bad({ rpId: 'amv-login.example' }, 'nor a site with another name');
  await bad({ tamper: true }, 'a tampered signature does not sign in');
  await bad({ uv: false }, 'nor one without the fingerprint or PIN');
  await bad({ countOverride: 1 }, 'a counter that went backwards - a copied key - does not');
  const stranger = await makeAuthenticator();
  const os = await call('/auth/passkey/options', { purpose: 'signin' });
  const ss = await call('/auth/passkey/signin', { cid: os.d.cid, credential: await stranger.get({ challenge: os.d.publicKey.challenge, origin: ORIGIN, rpId: RP }) });
  ok(ss.status === 401, 'a passkey no account has signs nobody in', ss.status);
  /* A challenge a stranger's passkey was tried with is spent too: the owner's
     passkey cannot be used with it afterwards. */
  const reuse = await call('/auth/passkey/signin', { cid: os.d.cid, credential: await auth.get({ challenge: os.d.publicKey.challenge, origin: ORIGIN, rpId: RP }) });
  ok(reuse.status === 401, 'and the challenge it was tried with is spent', reuse.status);
}

section('A passkey that keeps no counter cannot use one challenge twice at once');
{
  /* Synced passkeys (iCloud Keychain, Google Password Manager) send a counter
     of 0 every time, so the counter check cannot stop a replay - the one-time
     challenge is all there is. Two sign-ins racing with the same answer: one. */
  const synced = await makeAuthenticator();
  const o0 = await call('/auth/passkey/options', { purpose: 'register', proof: { password: PW } }, tok);
  await call('/auth/passkey/register', { cid: o0.d.cid, name: 'Synced', credential: await synced.create({ challenge: o0.d.publicKey.challenge, origin: ORIGIN, rpId: RP }) }, tok);
  const o = await call('/auth/passkey/options', { purpose: 'signin' });
  const g = await synced.get({ challenge: o.d.publicKey.challenge, origin: ORIGIN, rpId: RP, countOverride: 0 });
  const both = await Promise.all([call('/auth/passkey/signin', { cid: o.d.cid, credential: g }), call('/auth/passkey/signin', { cid: o.d.cid, credential: g })]);
  ok(both.filter(r => r.status === 200).length === 1, 'exactly one of two simultaneous uses signs in', both.map(r => r.status));
}

section('Without the Durable Object, a challenge is still spent once - and still usable once');
{
  /* Where claims fall back to storage they are written as kind:id. The first
     version claimed under the challenge's own key, found the challenge there,
     and refused every passkey on such a deployment; the stand-in object above
     hid it. So this runs with no object at all. */
  const keep = env.AMV_COUNTER; delete env.AMV_COUNTER;
  const o = await call('/auth/passkey/options', { purpose: 'signin' });
  const g = await auth.get({ challenge: o.d.publicKey.challenge, origin: ORIGIN, rpId: RP });
  const s1 = await call('/auth/passkey/signin', { cid: o.d.cid, credential: g });
  const s2 = await call('/auth/passkey/signin', { cid: o.d.cid, credential: g });
  env.AMV_COUNTER = keep;
  ok(s1.status === 200 && !!s1.d.token, 'it signs in', s1.status);
  ok(s2.status === 401, 'and the same challenge a second time does not', s2.status);
}

section('An authenticator app: a password on a new device is no longer enough');
let secret = '';
const code = async (offset = 0) => W._totpAt(secret, Math.floor(Date.now() / 30000) + offset);
{
  const st = await call('/auth/totp/start', { proof: { password: PW } }, tok);
  secret = st.d.secret;
  ok(st.status === 200 && /^[A-Z2-7]{32}$/.test(secret) && /^otpauth:\/\/totp\/AMV%3Arosa%40example\.com\?secret=/.test(st.d.uri), 'a secret and the link an authenticator app reads', st.d.uri);
  ok((await call('/auth/totp/confirm', { code: '000000' }, tok)).status === 400, 'it is not on until a code from the app proves it was saved');
  const on = await call('/auth/totp/confirm', { code: await code(0) }, tok);
  ok(on.status === 200 && on.d.recovery.length === 10 && on.d.security.totp, 'on, with ten recovery codes shown once', on.d.recovery && on.d.recovery.length);
  const raw = JSON.stringify(await W.DB.get(env, 'acct', ME));
  ok(!raw.includes(secret) && !raw.includes(on.d.recovery[0]), 'neither the secret nor a recovery code is stored as itself', true);
  globalThis.__rc = on.d.recovery;

  const pw = await call('/auth/login', { email: ME, password: PW });
  ok(pw.status === 200 && pw.d.needsMfa && !pw.d.token, 'the right password on a new device asks for the code instead of signing in', pw.d);
  const wrong = await call('/auth/login/mfa', { challenge: pw.d.challenge, code: '123456' });
  ok(wrong.status === 401 && !wrong.d.token, 'a wrong code does not', wrong.status);
  /* The step after the one that turned it on: that one is spent. The same
     code is sent from two sign-ins at the same moment - one of them wins. */
  const used = await code(1);
  const pwB = await call('/auth/login', { email: ME, password: PW });
  const pair = await Promise.all([call('/auth/login/mfa', { challenge: pw.d.challenge, code: used }), call('/auth/login/mfa', { challenge: pwB.d.challenge, code: used })]);
  const right = pair.find(r => r.status === 200) || pair[0];
  ok(right.status === 200 && !!right.d.token, 'the code does', pair.map(r => r.status));
  ok(pair.filter(r => r.status === 200).length === 1, 'and one code sent twice at once signs in once', pair.map(r => r.status));
  const pw2 = await call('/auth/login', { email: ME, password: PW });
  const reuse = await call('/auth/login/mfa', { challenge: pw2.d.challenge, code: used });
  ok(reuse.status === 401, 'the same code a second time does not - it was spent', reuse.status);
  const rc = await call('/auth/login/mfa', { challenge: pw2.d.challenge, recovery: globalThis.__rc[0].toLowerCase() });
  ok(rc.status === 200 && !!rc.d.token, 'a recovery code does, typed however', rc.status);
  const pw3 = await call('/auth/login', { email: ME, password: PW });
  ok((await call('/auth/login/mfa', { challenge: pw3.d.challenge, recovery: globalThis.__rc[0] })).status === 401, 'once', true);
  let locked = null;
  for (let i = 0; i < 6; i++) locked = await call('/auth/login/mfa', { challenge: pw3.d.challenge, code: '00000' + i });
  ok(locked.status === 429, 'five wrong tries end that sign-in', locked.status);
  tok = right.d.token;
}

section('Turning it off, or anything else, needs proof; the last way in stays');
{
  const off = await call('/auth/totp/disable', {}, tok);
  ok(off.status === 403, 'a session alone cannot turn the app off', off.status);
  const acct = await W.DB.get(env, 'acct', ME);
  const pkId = acct.passkeys[0].id;
  const rm = await call('/auth/passkey/remove', { id: pkId }, tok);
  ok(rm.status === 403, 'nor remove a passkey', rm.status);

  /* A passkey as the proof. */
  const so = await call('/auth/passkey/options', { purpose: 'stepup' }, tok);
  const assertion = await auth.get({ challenge: so.d.publicKey.challenge, origin: ORIGIN, rpId: RP });
  const rm2 = await call('/auth/passkey/remove', { id: pkId, proof: { passkey: { cid: so.d.cid, credential: assertion } } }, tok);
  ok(rm2.status === 200 && !rm2.d.security.passkeys.some(k => k.id === pkId), 'with the passkey as proof, it is removed', rm2.status);
  ok(!m.has('pkcred:' + pkId), 'and it signs nobody in afterwards', true);

}

section('The last way into an account is never removed');
{
  /* An account with no password and no Google sign-in - only a passkey. Its
     first factor needs only the session (there is nothing to prove with yet);
     removing that passkey, even with the passkey itself as proof, is refused. */
  await W.DB.put(env, 'acct', 'solo@example.com', { email: 'solo@example.com', name: 'Solo', provider: 'passkey', createdAt: Date.now() });
  const soloTok = (await W.issueTokens(env, 'solo@example.com', 'Solo', '')).token;
  const key = await makeAuthenticator({ kind: 'rsa' });
  const o = await call('/auth/passkey/options', { purpose: 'register' }, soloTok);
  ok(o.status === 200, 'with nothing to prove with yet, the first factor needs only the session', o.status);
  const reg = await call('/auth/passkey/register', { cid: o.d.cid, name: 'Laptop', credential: await key.create({ challenge: o.d.publicKey.challenge, origin: ORIGIN, rpId: RP }) }, soloTok);
  ok(reg.status === 200, 'an RSA passkey (Windows Hello) is accepted too', reg.status);
  const o2 = await call('/auth/passkey/options', { purpose: 'register' }, soloTok);
  ok(o2.status === 403, 'and from then on, adding another needs proof', o2.status);
  const so = await call('/auth/passkey/options', { purpose: 'stepup' }, soloTok);
  const id = reg.d.security.passkeys[0].id;
  const rm = await call('/auth/passkey/remove', { id, proof: { passkey: { cid: so.d.cid, credential: await key.get({ challenge: so.d.publicKey.challenge, origin: ORIGIN, rpId: RP }) } } }, soloTok);
  ok(rm.status === 409 && rm.d.code === 'last_way_in', 'its only passkey is not removed, even with the passkey as proof', [rm.status, rm.d.code]);

  /* Deleting the account takes its passkeys with it: the index that lets a
     passkey find its account goes too, or a deleted person's key would keep
     resolving to their address. */
  const half = await call('/auth/delete', { confirmEmail: 'solo@example.com' }, soloTok);
  ok(half.status === 401 && half.d.need === 'second' && half.d.can.passkey, 'deleting it asks for the passkey too: the session and the address are not enough', [half.status, half.d.need]);
  ok(m.has('pkcred:' + id), 'and nothing is deleted on that request', true);
  const ds = await call('/auth/passkey/options', { purpose: 'stepup' }, soloTok);
  const del = await call('/auth/delete', { confirmEmail: 'solo@example.com', passkey: { cid: ds.d.cid,
    credential: await key.get({ challenge: ds.d.publicKey.challenge, origin: ORIGIN, rpId: RP }) } }, soloTok);
  ok(del.status === 200, 'with the passkey, the account is deleted', [del.status, del.d.error]);
  ok(!m.has('pkcred:' + id), 'and its passkey no longer points at it', true);
  const oo = await call('/auth/passkey/options', { purpose: 'signin' });
  const after = await call('/auth/passkey/signin', { cid: oo.d.cid, credential: await key.get({ challenge: oo.d.publicKey.challenge, origin: ORIGIN, rpId: RP }) });
  ok(after.status === 401 && !after.d.token, 'and it signs nobody in', after.status);
}

section('A new password with a second factor on the account may be shorter');
{
  env.ADMIN_TOKEN = 'admin-secret-for-this-suite-only-0123456789';
  const adm = { 'X-Admin-Token': env.ADMIN_TOKEN, Authorization: 'Bearer ' + env.ADMIN_TOKEN };
  await call('/auth/signup', { email: 'plain@example.com', name: 'Plain', password: 'a long enough passphrase' });
  const alone = await call('/auth/admin-reset', { email: 'plain@example.com', password: 'Nine ch4rs!' }, null, adm);
  ok(alone.status === 400 && alone.d.min === 15, 'an account with only a password needs 15', [alone.status, alone.d.code]);
  const guarded = await call('/auth/admin-reset', { email: ME, password: 'Nine ch4rs!' }, null, adm);
  ok(guarded.status === 200, 'one with an authenticator app may have 8 or more', [guarded.status, guarded.d.error]);
}

section('Google is not a way round the second step');
{
  /* Google vouches for the address; the authenticator app is still asked for
     on a device that has not proved itself. Last in this file, because Google
     vouching for an address nobody confirmed also ends its password sessions
     (the squatter rule in _federatedAccount) - as it should. */
  env.GOOGLE_CLIENT_ID = 'amv-test-client';
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init) => String(u).startsWith('https://oauth2.googleapis.com/tokeninfo')
    ? new Response(JSON.stringify({ aud: 'amv-test-client', iss: 'accounts.google.com', email: ME, email_verified: 'true', name: 'Rosa', exp: String(Math.floor(Date.now() / 1000) + 600) }), { status: 200 })
    : real(u, init);
  const g = await call('/auth/google', { credential: 'x'.repeat(40) });
  ok(g.status === 200 && g.d.needsMfa && !g.d.token, 'a Google sign-in asks for the app\u2019s code too', [g.status, !!g.d.token]);
  const fin = await call('/auth/login/mfa', { challenge: g.d.challenge, recovery: globalThis.__rc[1] });
  ok(fin.status === 200 && !!fin.d.token, 'and a recovery code finishes it', fin.status);
  globalThis.fetch = real; delete env.GOOGLE_CLIENT_ID;
}

if (report('a-passkey-or-a-second-step-guards-the-account') > 0) process.exitCode = 1;
done();
