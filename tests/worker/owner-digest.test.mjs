/* THE WEEKLY OWNER DIGEST.

   Every figure in it already existed and was already correct. What did not
   exist was anything that looked at them on a schedule. A dashboard reports
   the state at the instant somebody remembers to open it; a digest reports the
   CHANGE without being asked, which is the difference between having metrics
   and being run by them.

   So the assertions here are mostly about the two ways a digest goes wrong: it
   invents a comparison it does not have, or it sends more than once. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'digest.harness.mjs');
writeFileSync(harness, src + `
export { runWeeklyDigest, adminDigest, _buildDigest, _digestSnapshot, _delta, _weekKey,
         _ownerMetrics, setEntitlement, counter, monthKey, DB };
`);
const W = await import(harness + '?t=' + Date.now());

function makeEnv(extra) {
  const kv = new Map();
  return Object.assign({
    _kv: kv,
    JWT_SECRET: 'test-secret-abcdefghijklmnop',
    ADMIN_TOKEN: 'admin-secret',
    OWNER_EMAIL: 'owner@amv.example',
    EMAIL_API_KEY: 'em-key',
    APP_URL: 'https://amv.example/',
    AMV_KV: {
      get: async k => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })) }),
    },
  }, extra || {});
}

/* Capture what would have been emailed instead of sending it. */
function captureMail() {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: init && init.body });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { sent, restore: () => { globalThis.fetch = real; } };
}

const spend = (env, email, amount) => W.counter(env, `cost:${email}:${W.monthKey()}`, { op: 'incr', amount });
async function seed(env) {
  await W.setEntitlement(env, 'pro1@x.com', 'pro');   await spend(env, 'pro1@x.com', 2.00);
  await W.setEntitlement(env, 'pro2@x.com', 'pro');   await spend(env, 'pro2@x.com', 3.50);
  await W.setEntitlement(env, 'free1@x.com', 'free'); await spend(env, 'free1@x.com', 0.80);
}
const adminReq = (q) => new Request('https://w/admin/digest' + (q || ''),
  { headers: { Authorization: 'Bearer admin-secret' } });

section('The first digest does not invent a week to compare against');
{
  const env = makeEnv(); await seed(env);
  const m = await W._ownerMetrics(env);
  ok(!!m, 'the metrics come from the same endpoint the dashboard uses');
  const d = W._buildDigest(m, null);
  ok(/nothing to compare/i.test(d.html), 'it says there is no previous week');
  ok(!/\(\+|\(-/.test(d.text), 'and shows no deltas at all', d.text.slice(0, 120));
  ok(d.text.includes('MRR: $30.00'), 'the figures themselves are still there', d.text.match(/MRR:[^\n]*/)[0]);
}

section('The second one reports the change, which is the point of it');
{
  const env = makeEnv(); await seed(env);
  const m = await W._ownerMetrics(env);
  const first = W._buildDigest(m, null);

  await W.setEntitlement(env, 'pro3@x.com', 'pro');
  const m2 = await W._ownerMetrics(env);
  const second = W._buildDigest(m2, first.snapshot);

  ok(/Paying accounts: 3 \(\+1\)/.test(second.text), 'a gain is shown with its direction', second.text.match(/Paying accounts:[^\n]*/)[0]);
  ok(/MRR: \$45\.00 \(\+\$15\.00\)/.test(second.text), 'in money where it is money', second.text.match(/MRR:[^\n]*/)[0]);
  ok(/Compared with the week before/.test(second.html), 'and the email says what it is comparing to');
}

section('A number that did not move says so, rather than looking like news');
{
  const env = makeEnv(); await seed(env);
  const m = await W._ownerMetrics(env);
  const a = W._buildDigest(m, null);
  const b = W._buildDigest(m, a.snapshot);
  ok(/no change/.test(b.text), 'an unchanged figure is marked as unchanged', b.text.match(/MRR:[^\n]*/)[0]);
}

section('It only raises what the numbers actually say');
{
  const clean = makeEnv(); await seed(clean);
  const d1 = W._buildDigest(await W._ownerMetrics(clean), null);
  ok(d1.flags.every(f => !/kill switch/i.test(f)), 'no kill-switch warning when it is off', d1.flags);
  ok(/Nothing needs a decision/.test(d1.text) || d1.flags.length > 0, 'and it is explicit either way');

  const risky = makeEnv(); await seed(risky);
  // A failed card, and one account that costs more than it pays.
  const ent = await W.DB.get(risky, 'ent', 'pro1@x.com');
  ent.pastDueSince = Date.now();
  await W.DB.put(risky, 'ent', 'pro1@x.com', ent);
  await W.setEntitlement(risky, 'whale@x.com', 'pro'); await spend(risky, 'whale@x.com', 90);
  await risky.AMV_KV.put('GLOBAL_KILL', '1');

  const d2 = W._buildDigest(await W._ownerMetrics(risky), null);
  const all = d2.flags.join(' | ');
  ok(/MRR is on cards that failed/.test(all), 'money at risk is raised', all);
  ok(/costs? more than it pays/.test(all), 'so is an account losing money', all);
  ok(/kill switch is ON/.test(all), 'and a product nobody can use is the first thing you would want told', all);
}

section('It sends once a week, however often the cron fires');
{
  const env = makeEnv(); await seed(env);
  const mail = captureMail();
  try {
    const a = await W.runWeeklyDigest(env);
    const b = await W.runWeeklyDigest(env);
    const c = await W.runWeeklyDigest(env);
    ok(a.sent === true, 'the first tick of the week sends', a);
    ok(b.sent === false && /already sent/.test(b.reason), 'the next one does not', b);
    ok(c.sent === false, 'nor any after that', c);
    ok(mail.sent.length === 1, 'exactly one email left the building', mail.sent.length);
  } finally { mail.restore(); }
}

section('Nothing configured means nothing happens, and it says why');
{
  for (const [missing, patch] of [
    ['OWNER_EMAIL', { OWNER_EMAIL: '' }],
    ['email provider', { EMAIL_API_KEY: '' }],
    ['ADMIN_TOKEN', { ADMIN_TOKEN: '' }],
  ]) {
    const env = makeEnv(patch); await seed(env);
    const mail = captureMail();
    let r;
    try { r = await W.runWeeklyDigest(env); } finally { mail.restore(); }
    ok(r.sent === false, 'with no ' + missing + ' it does not send', r);
    ok(typeof r.reason === 'string' && r.reason.length > 0, 'and the reason is stated in the log, not swallowed', r.reason);
    ok(mail.sent.length === 0, 'no request went out', mail.sent.length);
  }
}

section('A failed send does not become the baseline for next week');
{
  /* If the email fails and we had already stored the snapshot, the next digest
     would compare against a week nobody ever saw - and quietly under-report the
     change. */
  const env = makeEnv(); await seed(env);
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('provider down'); };
  let r;
  try { r = await W.runWeeklyDigest(env); } finally { globalThis.fetch = real; }
  ok(r.sent === false && /delivery failed/.test(r.reason), 'a rejected send is reported as one', r);
  ok(!(await env.AMV_KV.get('digestsnap')), 'and no snapshot is stored');

  /* And the week is given back, so one provider hiccup does not silently cost
     a whole digest - the next tick tries again. */
  const mail = captureMail();
  let again;
  try { again = await W.runWeeklyDigest(env); } finally { mail.restore(); }
  ok(again.sent === true, 'the next tick retries and succeeds', again);
  ok(mail.sent.length === 1, 'delivering exactly one email', mail.sent.length);
}

section('The preview is admin-only, and changes nothing');
{
  const env = makeEnv(); await seed(env);
  const anon = await W.adminDigest(new Request('https://w/admin/digest'), env);
  ok(anon.status === 403, 'an unauthenticated caller gets nothing', anon.status);

  const mail = captureMail();
  let d;
  try { d = await (await W.adminDigest(adminReq(), env)).json(); } finally { mail.restore(); }
  ok(d.preview === true, 'the default is a preview');
  ok(mail.sent.length === 0, 'which sends no email - opening a URL must not mail the owner', mail.sent.length);
  ok(typeof d.subject === 'string' && d.subject.includes('MRR'), 'it shows exactly what would be sent', d.subject);
  ok(!(await env.AMV_KV.get('digestsnap')), 'and stores no baseline');
}

section('Sending on demand takes an explicit flag');
{
  const env = makeEnv(); await seed(env);
  const mail = captureMail();
  let r;
  try { r = await (await W.adminDigest(adminReq('?send=1'), env)).json(); } finally { mail.restore(); }
  ok(r.ok === true && r.sent === true, 'send=1 really sends', r);
  ok(mail.sent.length === 1, 'once', mail.sent.length);
  ok(!!(await env.AMV_KV.get('digestsnap')), 'and now there is a baseline for next week');
}

section('The week key belongs to the week, not to when the cron fired');
{
  const mon = W._weekKey(Date.UTC(2026, 0, 5, 0, 30));    // Monday
  const wed = W._weekKey(Date.UTC(2026, 0, 7, 23, 59));   // Wednesday, same week
  const nextMon = W._weekKey(Date.UTC(2026, 0, 12, 6, 0));
  ok(mon === wed, 'two ticks in the same week share a key', [mon, wed]);
  ok(mon !== nextMon, 'and the next week gets its own', [mon, nextMon]);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(mon), 'it is a plain date', mon);
}

section('The digest never carries a secret');
{
  const env = makeEnv({ ADMIN_TOKEN: 'admin-secret', EMAIL_API_KEY: 'super-secret-email-key' });
  await seed(env);
  const mail = captureMail();
  try { await W.runWeeklyDigest(env); } finally { mail.restore(); }
  const body = mail.sent.map(s => s.body).join('');
  ok(!body.includes('super-secret-email-key'), 'the email provider key is not in the message');
  ok(!body.includes('admin-secret'), 'and neither is the admin token');
}

section('The digest carries what is waiting on a person');
{
  /* The support inbox and the abuse review are routes behind the admin token
     with no screen calling either - the dashboard's moderation card still says
     "pending". A customer complaint is stored correctly and read by nobody
     unless somebody remembers to curl an endpoint, and an unanswered support
     ticket is churn that never explains itself. The digest already arrives
     without being asked for, so it is where this belongs. */
  const env = makeEnv(); await seed(env);
  const m = await W._ownerMetrics(env);
  const withWaiting = Object.assign({}, m, { waiting: { support: 3, supportOldestDays: 6, flagged: 2 } });
  const all = W._buildDigest(withWaiting, null).flags.join(' | ');
  ok(/3 support messages are waiting/.test(all), 'unanswered support is flagged', all.slice(0, 180));
  ok(/oldest for 6 days/.test(all), 'with how long the oldest has waited', all.slice(0, 220));
  ok(/only thing that will tell you/.test(all), 'and says nothing else will tell them', true);
  ok(/2 accounts are blocked/.test(all), 'blocked accounts are flagged too', all.slice(0, 300));
}

section('And invents nothing when nothing is waiting');
{
  const env = makeEnv(); await seed(env);
  const m = await W._ownerMetrics(env);
  const quiet = Object.assign({}, m, { waiting: { support: 0, supportOldestDays: 0, flagged: 0 } });
  const all = W._buildDigest(quiet, null).flags.join(' | ');
  ok(!/waiting for a reply/.test(all), 'no invented urgency', all.slice(0, 140));
  ok(!/blocked for chargeback/.test(all), 'and no invented abuse', all.slice(0, 140));
}

section('The count comes from the real records, not from a caller');
{
  /* _ownerMetrics gathers it itself, so the digest cannot be handed a
     comfortable number by whoever calls it. */
  const env = makeEnv(); await seed(env);
  await W.DB.put(env, 'support', 'cust@x.com', { tickets: [
    { id: 't1', at: Date.now() - 3 * 86400000, msg: 'my plan did not apply' },
    { id: 't2', at: Date.now(), msg: 'second' }] });
  await W.DB.put(env, 'abuse', 'bad@x.com', { email: 'bad@x.com', blocked: true, disputes: 2 });
  const m2 = await W._ownerMetrics(env);
  ok(m2.waiting && m2.waiting.support === 2, 'it counted the real open tickets', m2.waiting);
  ok(m2.waiting.supportOldestDays >= 3, 'and how long the oldest has waited', m2.waiting.supportOldestDays);
  ok(m2.waiting.flagged === 1, 'and the blocked accounts', m2.waiting.flagged);
}

report('owner-digest');
done();
