/* A STOLEN COPY OF THE STORE CANNOT BE GUESSED AGAINST (Oct 31 audit, item
   18: password hashing; src/worker/30-accounts-and-sync.js, the pepper).

   Driven through the Worker's own sign-up, sign-in, operator reset and
   delete-account routes:
     - with no PASSWORD_PEPPER nothing changes: plain PBKDF2, and sign-in works;
     - once it is set, an existing password still signs in and is moved to
       the peppered form at that sign-in - and the stored hash is then NOT
       what PBKDF2 of the right password gives, which is the whole point: an
       offline guess against a stolen record needs the secret;
     - a new account and a reset password are peppered from the start;
     - a wrong password is still wrong;
     - rotating (old value in PASSWORD_PEPPER_PREVIOUS) keeps everybody able
       to sign in and moves each record to the new key;
     - a record whose key is in neither secret fails CLOSED, and the owner is
       told;
     - deleting an account checks the password the same way. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'pepper.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, _hashPassword };\n');
const W = await import(harness + '?t=' + Date.now());
const alerts = [];
globalThis.fetch = async (u, init) => { if (String(u).startsWith('https://alerts.example')) alerts.push(String((init && init.body) || '')); return new Response('{}', { status: 200 }); };

const m = new Map(), vals = new Map();
const env = {
  JWT_SECRET: 'j'.repeat(40), APP_URL: 'https://amv.test', ADMIN_TOKEN: 'a'.repeat(40), ALERT_WEBHOOK: 'https://alerts.example/hook',
  AMV_KV: { async get(k){ return m.has(k) ? m.get(k) : null; }, async put(k, v){ m.set(k, v); }, async delete(k){ m.delete(k); },
    async list({ prefix } = {}){ return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: withAuthOps({ idFromName: n => n, get: n => ({ async fetch(_u, init){
    const b = JSON.parse(init.body || '{}'); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
    if (b.op === 'clear') return r({ ok: true });
    if (b.op === 'claim'){ if (vals.get(n)) return r({ claimed: false }); vals.set(n, 1); return r({ claimed: true, owner: n }); }
    if (b.op === 'release'){ vals.delete(n); return r({ ok: true }); }
    if (b.op === 'incr'){ vals.set(n, cur + Number(b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur, count: 1 });
  } }) }),
};
const ctx = { waitUntil(){}, passThroughOnException(){} };
let ip = 1;
const call = async (path, body, tok, headers) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.2.' + (ip++ % 200 + 1), ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...(headers || {}) },
    body: JSON.stringify(body || {}) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const PW = 'correct horse battery staple';
const acct = async (e) => JSON.parse(m.get('acct:' + e) || 'null') || await W.DB.get(env, 'acct', e);
const plain = async (a, pw) => W._hashPassword(pw, a.salt, a.pwIter);
const login = (email, password) => call('/auth/login', { email, password });
const P1 = 'p'.repeat(40), P2 = 'q'.repeat(40);

section('With no pepper set, nothing changes');
{
  const s = await call('/auth/signup', { email: 'ana@example.com', name: 'Ana', password: PW });
  ok(s.status === 200 && s.d.token, 'sign-up works', s);
  const a = await acct('ana@example.com');
  ok(!a.pwPep && a.pwHash === await plain(a, PW), 'the record is plain PBKDF2 and names no pepper');
  ok((await login('ana@example.com', PW)).status === 200, 'and sign-in works');
}

section('Once it is set, an existing password still signs in and moves to the peppered form');
{
  env.PASSWORD_PEPPER = P1;
  const r = await login('ana@example.com', PW);
  ok(r.status === 200, 'the old password signs in', r.status);
  const a = await acct('ana@example.com');
  ok(/^[0-9a-f]{12}$/.test(a.pwPep || '') && a.pwAlgo === 'pbkdf2-sha256+hmac', 'the record now names its pepper', a.pwPep);
  ok(a.pwHash !== await plain(a, PW), 'and its hash is NOT what PBKDF2 of the right password gives - a stolen copy cannot be guessed against without the secret');
  ok(!JSON.stringify(a).includes(P1), 'the secret itself is nowhere in the record');
  ok((await login('ana@example.com', PW)).status === 200, 'it signs in again in its new form');
  ok((await login('ana@example.com', 'wrong horse battery staple')).status === 401, 'a wrong password is still wrong');
}

section('A new account, and a reset password, are peppered from the start');
{
  await call('/auth/signup', { email: 'ben@example.com', name: 'Ben', password: PW });
  const b = await acct('ben@example.com');
  ok(b.pwPep && b.pwHash !== await plain(b, PW), 'a new account', b.pwAlgo);
  ok((await login('ben@example.com', PW)).status === 200, 'and it signs in');
  const NEW = 'a different long passphrase';
  const adm = { 'X-Admin-Token': env.ADMIN_TOKEN, Authorization: 'Bearer ' + env.ADMIN_TOKEN };
  const r = await call('/auth/admin-reset', { email: 'ben@example.com', password: NEW }, null, adm);
  ok(r.status === 200, 'the operator resets it', r);
  const b2 = await acct('ben@example.com');
  ok(b2.pwPep && b2.pwHash !== await plain(b2, NEW), 'the reset password is peppered');
  ok((await login('ben@example.com', NEW)).status === 200 && (await login('ben@example.com', PW)).status === 401, 'the new one signs in and the old one does not');
}

section('Rotating keeps everybody signed in and moves each record to the new key');
{
  const before = (await acct('ana@example.com')).pwPep;
  env.PASSWORD_PEPPER_PREVIOUS = P1; env.PASSWORD_PEPPER = P2;
  ok((await login('ana@example.com', PW)).status === 200, 'a record made with the old key signs in');
  const after = (await acct('ana@example.com')).pwPep;
  ok(after && after !== before, 'and now names the new key', { before, after });
  delete env.PASSWORD_PEPPER_PREVIOUS;
  ok((await login('ana@example.com', PW)).status === 200, 'and keeps working once the old key is gone');
}

section('A record whose key is in neither secret fails closed, and says so');
{
  // ben's record is under P1, which is now in neither secret
  const r = await login('ben@example.com', 'a different long passphrase');
  ok(r.status === 401, 'the right password is refused rather than checked without its key', r.status);
  ok(alerts.some(a => /PASSWORD_PEPPER_PREVIOUS/.test(a)), 'and the owner is alerted, told how to fix it', alerts);
  env.PASSWORD_PEPPER_PREVIOUS = P1;
  ok((await login('ben@example.com', 'a different long passphrase')).status === 200, 'putting the old value back as PREVIOUS lets it in again');
  delete env.PASSWORD_PEPPER_PREVIOUS;
}

section('Deleting an account checks the password the same way');
{
  const tok = (await login('ana@example.com', PW)).d.token;
  const no = await call('/auth/delete', { password: 'wrong horse battery staple' }, tok);
  ok(no.d.code === 'reauth_failed', 'a wrong password is refused', no.d);
  const yes = await call('/auth/delete', { password: PW }, tok);
  ok(yes.d.code !== 'reauth_failed' && yes.d.code !== 'reauth_required', 'the right one, peppered, is accepted', yes.d);
}

report();
done();
