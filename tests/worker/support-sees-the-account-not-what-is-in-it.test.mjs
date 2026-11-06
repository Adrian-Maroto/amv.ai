/* SUPPORT SEES THE ACCOUNT, NOT WHAT IS IN IT (Nov 1 audit OPS-001).

   A billing or account problem can be resolved from the plan, the usage, the
   sign-in methods and how many things there are - never from what somebody
   wrote. Through the real router:
     - only the operator's token reaches it, and a reason is required;
     - it answers with the account's shape and none of its content;
     - every look is written where the person sees it, with the reason,
       before anything is shown - and a look that cannot be recorded shows
       nothing;
     - the person reads that record, and nobody else's. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'support.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { issueTokens, DB };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map(); let failPut = false;
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', ADMIN_TOKEN: 'operator-token-0123456789', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  AMV_KV: { async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { if (failPut && k.startsWith('accesslog:')) throw new Error('down'); store.set(k, v); }, async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const ME = 'sam@test.com', OTHER = 'kim@test.com';
await W.DB.put(env, 'acct', ME, { email: ME, name: 'Sam', created: 1700000000000, pwHash: 'x', totp: { on: true } });
await W.DB.put(env, 'ent', ME, { plan: 'pro', source: 'stripe', renewedAt: Date.now() });
await W.DB.put(env, 'auto', ME, { items: [{ id: 'j1', detail: 'SECRET JOB TEXT about my divorce' }], results: [{ out: 'SECRET RESULT' }] });
await W.DB.put(env, 'lib', ME, { files: [{ id: 'f1', name: 'SECRET-medical.pdf' }] });
await W.DB.put(env, 'data', ME, { convs: [{ title: 'SECRET CHAT TITLE' }] });
await W.DB.put(env, 'acct', OTHER, { email: OTHER, created: 1 });
const mine = await W.issueTokens(env, ME, 'Sam'), theirs = await W.issueTokens(env, OTHER, 'Kim');
let ip = 1;
const admin = async (body, token = env.ADMIN_TOKEN) => { const r = await W.default.fetch(new Request('https://api.amv.test/admin/support/account', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token, Authorization: 'Bearer ' + token, 'CF-Connecting-IP': '5.5.5.' + (ip++) }, body: JSON.stringify(body) }), env, ctx); return { status: r.status, d: await r.json().catch(() => ({})) }; };
const access = async (tok) => { const r = await W.default.fetch(new Request('https://api.amv.test/v1/account/access', { headers: { Authorization: 'Bearer ' + tok, Origin: 'https://amv.test', 'CF-Connecting-IP': '5.5.6.' + (ip++) } }), env, ctx); return { status: r.status, d: await r.json().catch(() => ({})) }; };

section('Only the operator, and only with a reason');
{
  ok((await admin({ email: ME, reason: 'billing question about a double charge' }, 'wrong-token-xxxxxxxxxx')).status === 403, 'a wrong token is refused');
  const noWhy = await admin({ email: ME, reason: 'hi' });
  ok(noWhy.status === 400 && noWhy.d.code === 'reason_required', 'a look without a reason is refused', noWhy.d);
  ok(!store.has('accesslog:' + ME), 'and neither is recorded as a look');
}

section('The account, without anything in it');
{
  const r = await admin({ email: ME, reason: 'billing question about a double charge' });
  ok(r.status === 200 && r.d.account.plan.plan === 'pro' && r.d.account.counts.jobs === 1 && r.d.account.counts.files === 1 && r.d.account.signIn.authenticator === true,
    'plan, counts and sign-in methods are there', r.d.account);
  ok(!/SECRET/.test(JSON.stringify(r.d)), 'and no chat, file name, job text or result', JSON.stringify(r.d).slice(0, 200));
}

section('Every look is recorded where the person sees it, first');
{
  const a = await access(mine.token);
  ok(a.status === 200 && a.d.access.length === 1 && /double charge/.test(a.d.access[0].reason) && a.d.access[0].who === 'AMV support', 'the person sees who looked and why', a.d.access);
  const b = await access(theirs.token);
  ok(b.d.access.length === 0, 'and another person sees only their own record', b.d.access);
  failPut = true;
  const c = await admin({ email: ME, reason: 'second look at the double charge' });
  failPut = false;
  ok(c.status === 503 && !c.d.account, 'a look that cannot be recorded shows nothing', c.status);
}

section('Each look is its own record: two at once both stay, and none rewrites another (Nov 3 audit SUPPORT-001)');
{
  await Promise.all([admin({ email: ME, reason: 'look one at the same moment' }), admin({ email: ME, reason: 'look two at the same moment' })]);
  const a = await access(mine.token);
  ok(a.d.access.some(x => /look one/.test(x.reason)) && a.d.access.some(x => /look two/.test(x.reason)) && a.d.access.length === 3, 'two looks at the same moment are both recorded, beside the first', a.d.access.map(x => x.reason));
  const keys = [...store.keys()].filter(k => k.startsWith('accesslog:' + ME + ':'));
  ok(keys.length === 3 && keys.every(k => /:\d{13}-[0-9a-f]{8}$/.test(k)), 'one key a look, never one list written back', keys);
}

if (report('support-sees-the-account-not-what-is-in-it') > 0) process.exitCode = 1;
done();
