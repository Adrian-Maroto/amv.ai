/* ANTI-ABUSE — the "DoorDash method" defense.
   The scam: pay, consume the compute (which costs real money the instant it's
   delivered), then claw the money back via chargeback or refund while keeping
   what you took. These tests prove AMV revokes access on a refund/chargeback,
   flags a PATTERN (not a one-off), blocks a flagged account from re-subscribing,
   and lets an admin clear a false positive. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'abuse.harness.mjs');
writeFileSync(harness, src +
  '\nexport { stripeWebhook, stripeCheckout, abuseList, abuseClear, _abuseRecord, _abuseStatus, getEntitlement, setEntitlement };' +
  '\nexport function __setRequireUser(fn){ requireUser = fn; }\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  ADMIN_TOKEN: 'admin-secret',
  STRIPE_SECRET_KEY: 'sk_test',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; }
  }
};

const ent = async (email) => {
  const e = store.get('ent:' + email.toLowerCase());
  return e ? JSON.parse(e) : { plan: 'free' };
};
const setPaid = async (email, plan = 'pro') => { await W.setEntitlement(env, email, plan, { source: 'stripe' }); };

/* ── A sole refund is fine; a chargeback is not ────────────────────────── */
section('A chargeback revokes access immediately and flags the account');

await setPaid('cheat@test.com', 'pro');
ok((await ent('cheat@test.com')).plan === 'pro', 'user starts on a paid plan');

await W._abuseRecord(env, 'cheat@test.com', 'dispute', { amount: 2000 });
// simulate what the webhook does alongside the record:
await W.setEntitlement(env, 'cheat@test.com', 'free', { disputed: true });

const s1 = await W._abuseStatus(env, 'cheat@test.com');
ok(s1.disputes === 1, 'the chargeback is recorded', s1.disputes);
ok(s1.blocked === true, 'ONE chargeback is enough to block — it is a fraud signal', s1.blocked);
ok((await ent('cheat@test.com')).plan === 'free', 'and paid access is revoked', (await ent('cheat@test.com')).plan);

section('A single refund does NOT block (support does legit refunds)');

await W._abuseRecord(env, 'honest@test.com', 'refund', { amount: 2000 });
const s2 = await W._abuseStatus(env, 'honest@test.com');
ok(s2.refunds === 1, 'the refund is recorded', s2.refunds);
ok(s2.blocked === false, 'a lone refund does not flag a legitimate customer', s2.blocked);

section('A PATTERN of refunds blocks the account');

for (let i = 0; i < 3; i++) await W._abuseRecord(env, 'farmer@test.com', 'refund', { amount: 500 });
const s3 = await W._abuseStatus(env, 'farmer@test.com');
ok(s3.refunds === 3, 'repeated refunds are counted', s3.refunds);
ok(s3.blocked === true, 'a refund pattern blocks the account', s3.blocked);

/* ── The loop-closer: a flagged account cannot just subscribe again ────── */
section('A flagged account cannot start a new subscription');

W.__setRequireUser(async () => ({ email: 'cheat@test.com' }));
const req = (body) => new Request('https://api.amv.dev/v1/stripe/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
});
let r = await W.stripeCheckout(req({ plan: 'pro' }), env);
ok(r.status === 403, 'checkout is refused for a flagged account (403)', r.status);
const d = await r.json();
ok(d.code === 'account_flagged', 'with an account_flagged code', d.code);

section('A clean account is NOT blocked by the abuse gate');

W.__setRequireUser(async () => ({ email: 'clean@test.com' }));
r = await W.stripeCheckout(req({ plan: 'pro' }), env);
const cd = await r.json().catch(() => ({}));
// A clean account gets PAST the abuse gate. It may still fail later for missing
// price config in this test env — what matters is it is NOT account_flagged.
ok(r.status !== 403 || cd.code !== 'account_flagged',
   'a clean account is not blocked as flagged', { status: r.status, code: cd.code });

/* ── Admin escape hatch for false positives ───────────────────────────── */
section('Admin can see flagged accounts and clear a false positive');

const adminReq = (body) => new Request('https://api.amv.dev/admin/abuse/list', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'admin-secret' },
  body: JSON.stringify(body || {})
});

r = await W.abuseList(adminReq({}), env);
let list = await r.json();
ok(list.ok && Array.isArray(list.flagged), 'the admin can list flagged accounts');
ok(list.blockedCount >= 2, 'it shows the blocked accounts', list.blockedCount);
ok(list.flagged.some(f => f.email === 'cheat@test.com' && f.blockedReason === 'chargeback'),
   'the chargeback account is shown with its reason');

r = await W.abuseClear(new Request('https://api.amv.dev/admin/abuse/clear', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'admin-secret' },
  body: JSON.stringify({ email: 'farmer@test.com' })
}), env);
ok((await r.json()).ok, 'admin clears a flag');
const s4 = await W._abuseStatus(env, 'farmer@test.com');
ok(s4.blocked === false, 'the account is no longer blocked after clearing', s4.blocked);

section('Abuse endpoints reject non-admins');

r = await W.abuseList(new Request('https://api.amv.dev/admin/abuse/list', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
}), env);
ok(r.status === 401, 'no admin token = no access to the abuse list', r.status);

r = await W.abuseClear(new Request('https://api.amv.dev/admin/abuse/clear', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'wrong' },
  body: JSON.stringify({ email: 'x@test.com' })
}), env);
ok(r.status === 401, 'a wrong admin token cannot clear flags', r.status);

/* ── The webhook itself, end to end (with a real signature) ────────────── */
section('The Stripe webhook handles a chargeback event end-to-end');

async function signStripe(secret, payload) {
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + payload));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${hex}`;
}

await setPaid('wh@test.com', 'pro');
store.set('custemail:cus_wh', 'wh@test.com');   // reverse map the webhook uses
const evt = JSON.stringify({
  type: 'charge.dispute.created',
  data: { object: { customer: 'cus_wh', charge: 'ch_1', amount: 2000, metadata: { email: 'wh@test.com' } } }
});
const sig = await signStripe('whsec_test', evt);
r = await W.stripeWebhook(new Request('https://api.amv.dev/v1/stripe/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig }, body: evt
}), env, { waitUntil() {} });
ok(r.status === 200, 'the webhook accepts the signed event', r.status);
ok((await ent('wh@test.com')).plan === 'free', 'the disputed account is downgraded to free');
const s5 = await W._abuseStatus(env, 'wh@test.com');
ok(s5.blocked === true, 'and flagged from the webhook path', s5.blocked);

section('A forged webhook is rejected');
r = await W.stripeWebhook(new Request('https://api.amv.dev/v1/stripe/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=deadbeef' }, body: evt
}), env, { waitUntil() {} });
ok(r.status === 400, 'a bad signature is refused — nobody can forge a refund event', r.status);

report();
done();
