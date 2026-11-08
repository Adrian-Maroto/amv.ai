/* THE BETA LETS IN ONLY WHO WAS INVITED (owner yes, Nov 7).

   With SIGNUP_INVITE_ONLY=1 a new account needs an owner's invite code or an
   existing person's referral code; off, sign-up is open as before. Signing
   in to an existing account is never gated. Driven through the real routes. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'beta.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _referralEnsure };\n');
const W = await import(harness + '?t=' + Date.now());
const quiet = console.log; console.log = (...a) => { if (String(a[0]).startsWith('AUDIT')) return; quiet(...a); };

const m = new Map(), vals = new Map();
const env = {
  JWT_SECRET: 'j'.repeat(40), ADMIN_TOKEN: 'admin-secret-token-value', APP_URL: 'https://amv.test',
  AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, String(v)); }, async delete(k) { m.delete(k); },
    async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: withAuthOps({ idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body || '{}'); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { if (cur + (b.amount || 0) > b.cap) return r({ allowed: false, value: cur }); vals.set(n, cur + (b.amount || 0)); return r({ allowed: true, value: vals.get(n) }); }
    if (b.op === 'claim') { if (vals.get(n)) return r({ claimed: false }); vals.set(n, 1); return r({ claimed: true, owner: n }); }
    if (b.op === 'release') { vals.delete(n); return r({ ok: true }); }
    if (b.op === 'incr') { vals.set(n, cur + Number(b.amount || 0)); return r({ value: vals.get(n) }); }
    return r({ allowed: true, value: cur, count: 1 });
  } }) }),
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
let ip = 1;
const call = async (path, body, headers) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.7.0.' + (ip++ % 200 + 1), ...(headers || {}) }, body: JSON.stringify(body || {}) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const PW = 'a long enough passphrase';
const signup = (email, ref) => call('/auth/signup', { email, name: 'N', password: PW, ...(ref ? { ref } : {}) });

section('Off: sign-up is open, as before');
{
  const r = await signup('open@example.com');
  ok(r.status === 200 && r.d.token, 'no code needed', r.status);
}

section('On: a new account needs an invite');
env.SIGNUP_INVITE_ONLY = '1';
{
  const r = await signup('nocode@example.com');
  ok(r.status === 403 && r.d.code === 'invite_required' && !m.has('acct:nocode@example.com'), 'no code: refused, nothing made', r.d.code);
  ok((await signup('bogus@example.com', 'NOTACODE1')).d.code === 'invite_required', 'a made-up code: refused');
  const login = await call('/auth/login', { email: 'open@example.com', password: PW });
  ok(login.status === 200 && login.d.token, 'signing in to an account that exists is not affected', login.status);
}

section('The owner makes invite links; each is good for its uses');
{
  ok((await call('/admin/invites', { count: 2, uses: 1 })).status === 403, 'only the owner can make them');
  const made = await call('/admin/invites', { count: 2, uses: 1 }, { Authorization: 'Bearer admin-secret-token-value' });
  ok(made.status === 200 && made.d.codes.length === 2 && made.d.links[0] === 'https://amv.test/?ref=' + made.d.codes[0], 'two codes, as links the page already understands', made.d);
  const c = made.d.codes[0];
  ok((await signup('first@example.com', c)).status === 200, 'the first person in with it gets an account');
  ok((await signup('second@example.com', c)).d.code === 'invite_required', 'a one-use code does not let a second person in');
}

section('Anybody in the beta can bring somebody in, and is credited');
{
  const code = await W._referralEnsure(env, 'open@example.com');
  const r = await signup('friend@example.com', code);
  ok(r.status === 200 && r.d.token, 'an existing person’s referral code is an invite', r.status);
}

section('A use is spent only on an account that was made (Nov 8 audit)');
{
  const made = await call('/admin/invites', { count: 1, uses: 1 }, { Authorization: 'Bearer admin-secret-token-value' });
  const c = made.d.codes[0];
  ok((await signup('not-an-email', c)).status === 400, 'a sign-up refused for a typo is refused');
  ok((await call('/auth/signup', { email: 'weak@example.com', name: 'N', password: 'short', ref: c })).status === 400, 'and one with a password too weak');
  ok((await signup('first@example.com', c)).status === 409, 'and one for an address that already has an account');
  const r = await signup('real@example.com', c);
  ok(r.status === 200 && r.d.token, 'none of them used the one-use code: the real sign-up after them gets in', r.status);
  ok((await signup('third@example.com', c)).d.code === 'invite_required', 'and the code is then spent', vals.get('betainvuse:' + c));
}

section('An invite ends on its date, can be revoked, and is listed with what is spent (Nov 8 audit BETA-002)');
{
  const A = { Authorization: 'Bearer admin-secret-token-value' };
  const made = await call('/admin/invites', { count: 2, uses: 3, days: 7 }, A);
  ok(made.d.expires > Date.now() + 6 * 86400000 && made.d.expires < Date.now() + 8 * 86400000, 'made with the date it ends', made.d.expires);
  const [live, gone] = made.d.codes;
  ok((await signup('dated@example.com', live)).status === 200, 'it lets somebody in before then');
  const rv = await call('/admin/invites/revoke', { code: gone }, A);
  ok(rv.status === 200 && rv.d.revoked, 'the owner revokes one');
  ok((await signup('late@example.com', gone)).d.code === 'invite_required', 'and it lets nobody else in');
  ok((await call('/admin/invites/revoke', { code: gone })).status === 403, 'only the owner can revoke');
  const rec = JSON.parse(m.get('betainv:' + live)); rec.exp = Date.now() - 1000; m.set('betainv:' + live, JSON.stringify(rec));
  ok((await signup('expired@example.com', live)).d.code === 'invite_required', 'past its date it lets nobody in');
  const r = await W.default.fetch(new Request('https://api.amv.test/admin/invites/list', { method: 'POST', body: '{}', headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.7.9.9' }, A) }), env, ctx);
  const d = await r.json();
  const a = (d.invites || []).find(x => x.code === live), b = (d.invites || []).find(x => x.code === gone);
  ok(a && a.used === 1 && a.uses === 3 && !a.open && b && b.revoked && !b.open, 'the list says how much each has been used and whether it is still open', { a, b });
}

section('Google and passkey sign-up are gated too');
{
  const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  ok(/_inviteOnly\(env\) && !\(await DB\.get\(env, 'acct', em\)\)\) \? await _inviteHold\(env, body\.ref, 'google'\)/.test(src)
    && /if\(inv\) await inv\.done\(!!fed\.created\)/.test(src), 'a first Google sign-in asks for the invite, and hands it back unless an account was made');
  ok(/await _inviteHold\(env, body\.ref, 'passkey'\)/.test(src) && /if\(inv\) await inv\.done\(created\);\s*if\(!created\)\{ await _pkCredUnreserve/.test(src), 'and a passkey sign-up, the same way');
}

console.log = quiet;
if (report('the-beta-lets-in-only-who-was-invited') > 0) process.exitCode = 1;
done();
