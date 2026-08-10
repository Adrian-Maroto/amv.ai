/* THE POLICY SAID REPORTS WERE REVIEWED BY A TEAM. THERE WAS NO TEAM, NO
   REVIEW, AND NO REPORT.

   The marketplace policy screen carried this line, in the product, to buyers:

       "Buyers can report any listing; reports are reviewed by our team."

   What existed was a dialog called _mktReport that nothing anywhere opened -
   no button, no menu, no keyboard path - and which, if anything HAD opened it,
   wrote the complaint into the reporter's own localStorage. The only person
   who could ever read it was the person complaining. There was no route on the
   Worker at all. Then it said "our review team will look at this listing".

   That is the worst shape a safety promise can take. Somebody sees a scam,
   goes to the trouble of reporting it, is thanked, and nobody has been told.
   For a marketplace that takes payments and pays sellers out, the published
   policy is also the thing an operator gets held to.

   The same screen also said higher-risk listings were "published but held for
   review". The publish path returns 422 and stores nothing, so no listing has
   ever been published-and-held; there was no such state and no queue.

   So this file asks the only question worth asking about a safety feature:
   does what somebody says actually reach the person who can act on it. Every
   step is exercised against the real handler - the storage is faked, the
   report is filed, the count is checked, the hiding is checked, and the
   operator's screen is asked what it can see. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'report.harness.mjs');
writeFileSync(harness, src + '\nexport { REPORT_AUTOHIDE };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

/* Nothing here talks to a real third party. */
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

/* Storage and the atomic counter, modelled rather than waved through: a claim
   that never releases makes every write after the first refuse, which is its
   own lesson (#195), and a stub that answers every op with {allowed:true}
   returns no `claimed` field - so taking a lock would appear to FAIL and every
   report would 503 while this file still looked like it was testing reports. */
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
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '55.55.55.55',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, path, body, tok) => {
  const r = await call(env, path, body, tok);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const get = async (env, path, tok) => {
  const r = await worker.fetch(new Request('https://api.amv.test' + path, {
    headers: tok ? { Authorization: 'Bearer ' + tok } : {},
  }), env, ctx);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const PW = 'A-real-Passw0rd!';
const signup = async (env, email) =>
  (await (await call(env, '/auth/signup', { email, name: email.split('@')[0], password: PW })).json()).token;

/* The listing being reported, written straight into storage in the shape the
   publish path produces. */
const LISTING = { id: 'usr_abc', title: 'Definitely Not A Scam', authorEmail: 'seller@example.com',
                  author: 'seller', price: 20, status: 'active', kind: 'prompt', ts: Date.now() };
const seedListing = (env) => { env.AMV_KV._map.set('market:usr_abc', JSON.stringify(LISTING)); };

section('The policy no longer describes something that does not exist');
{
  /* Checked against the shipped bundle, because the promise is what visitors
     read. The old line said reports "are reviewed by our team" while nothing
     could send one; the other said listings are "held for review" while the
     publish path refuses them outright. */
  ok(!/published but held for review/i.test(bundle),
     'nothing claims a held-for-review state that has never existed', true);
  const claimsReporting = /report a listing|report any listing|can report/i.test(bundle);
  ok(claimsReporting, 'reporting is still offered, because it is real now', claimsReporting);
}

section('There is a way to say it, on every listing');
{
  ok(/data-mk-report=/.test(bundle),
     'a report control is rendered on the card, not only defined somewhere', true);
  ok(/_mktReport\(b\.dataset\.mkReport/.test(bundle),
     'and it is wired to the dialog rather than being a button that does nothing', true);
  ok(/\/v1\/market\/report/.test(bundle),
     'the dialog posts to the server', true);
  ok(!/store\(\s*['"]amv_mkt_reports/.test(bundle),
     'and no longer writes the complaint into the reporter’s own browser', true);
}

section('A report is filed where somebody else can read it');
{
  const env = mkEnv(); seedListing(env);
  const tok = await signup(env, 'buyer1@example.com');
  const r = await post(env, '/v1/market/report', { id: 'usr_abc', reason: 'scam', note: 'took my money' }, tok);
  ok(r.body.ok === true, 'the report is accepted', r.body);
  ok(r.body.count === 1, 'and counted', r.body.count);
  const stored = [...env.AMV_KV._map.keys()].filter(k => k.startsWith('mktreport:'));
  ok(stored.length === 1, 'a durable record exists on the server', stored);
  const rec = JSON.parse(env.AMV_KV._map.get(stored[0]));
  ok(rec.seller === 'seller@example.com', 'naming the seller it is about', rec.seller);
  ok(rec.reports[0].note === 'took my money', 'and carrying what was actually said', rec.reports[0].note);
}

section('And it does not carry the reporter’s address into somebody else’s record');
{
  const env = mkEnv(); seedListing(env);
  const tok = await signup(env, 'buyer1@example.com');
  await post(env, '/v1/market/report', { id: 'usr_abc', reason: 'scam' }, tok);
  const raw = env.AMV_KV._map.get([...env.AMV_KV._map.keys()].find(k => k.startsWith('mktreport:')));
  ok(!/buyer1@example\.com/.test(raw),
     'the email is not in the record - this is keyed by the LISTING, so it sits outside the reporter’s own erasure scope',
     raw.slice(0, 220));
  ok(/"by":"[0-9a-f]{16}"/.test(raw), 'a one-way id is, which is all the dedup ever needed', raw.slice(0, 220));
}

section('One person reporting twice is one person');
{
  const env = mkEnv(); seedListing(env);
  const tok = await signup(env, 'buyer1@example.com');
  await post(env, '/v1/market/report', { id: 'usr_abc', reason: 'scam', note: 'first' }, tok);
  const r = await post(env, '/v1/market/report', { id: 'usr_abc', reason: 'broken', note: 'actually this' }, tok);
  ok(r.body.count === 1, 'the count is people, not clicks - the only version worth acting on', r.body.count);
  const rec = JSON.parse(env.AMV_KV._map.get([...env.AMV_KV._map.keys()].find(k => k.startsWith('mktreport:'))));
  ok(rec.reports[0].note === 'actually this', 'and a second report updates what they said', rec.reports[0].note);
}

section('Enough different people and the listing comes down while it is looked at');
{
  const env = mkEnv(); seedListing(env);
  let last;
  for (let i = 0; i < W.REPORT_AUTOHIDE; i++) {
    const tok = await signup(env, 'buyer' + i + '@example.com');
    last = (await post(env, '/v1/market/report', { id: 'usr_abc', reason: 'scam' }, tok)).body;
  }
  ok(last.count === W.REPORT_AUTOHIDE, 'the threshold is reached', last.count);
  ok(last.hidden === true, 'and the listing is hidden', last.hidden);
  const listing = JSON.parse(env.AMV_KV._map.get('market:usr_abc'));
  ok(listing.hidden === true, 'in the record, not only in the answer', listing.hidden);
  ok(listing.hiddenReason === 'reported',
     'saying why, so an operator can tell this from a seller unlisting their own work', listing.hiddenReason);
  ok(listing.title === LISTING.title,
     'hidden and not deleted - the seller keeps the work and a person decides', listing.title);
  ok(/hidden/i.test(last.message || ''), 'and the reporter is told what actually happened', last.message);

  /* And it really leaves the public catalogue, which is the point of hiding. */
  const pub = await get(env, '/v1/market/list');
  ok(!(pub.body.items || []).some(x => x.id === 'usr_abc'),
     'a hidden listing is gone from what shoppers see', (pub.body.items || []).map(x => x.id));
}

section('Below the threshold nothing is hidden, so this is not a heckler’s veto');
{
  const env = mkEnv(); seedListing(env);
  const tok = await signup(env, 'one@example.com');
  const r = await post(env, '/v1/market/report', { id: 'usr_abc', reason: 'scam' }, tok);
  ok(r.body.hidden !== true, 'one person cannot take a listing down', r.body);
  ok(JSON.parse(env.AMV_KV._map.get('market:usr_abc')).hidden !== true, 'the listing is untouched', true);
}

section('What cannot be reported');
{
  const env = mkEnv(); seedListing(env);
  const seller = await signup(env, 'seller@example.com');
  const own = await post(env, '/v1/market/report', { id: 'usr_abc', reason: 'scam' }, seller);
  ok(!own.body.ok, 'your own listing', own.body.error);

  const buyer = await signup(env, 'buyer1@example.com');
  const gone = await post(env, '/v1/market/report', { id: 'usr_missing', reason: 'scam' }, buyer);
  ok(!gone.body.ok, 'a listing that does not exist', gone.body.error);

  const bogus = await post(env, '/v1/market/report', { id: 'usr_abc', reason: 'because-i-said-so' }, buyer);
  ok(!bogus.body.ok, 'and a reason that is not one of the offered ones', bogus.body.error);

  const anon = await post(env, '/v1/market/report', { id: 'usr_abc', reason: 'scam' });
  ok(anon.status === 401, 'signing in is required, so a report has somebody behind it', anon.status);
}

section('The operator can actually see them');
{
  const env = mkEnv(); seedListing(env);
  for (let i = 0; i < 2; i++) {
    const tok = await signup(env, 'buyer' + i + '@example.com');
    await post(env, '/v1/market/report', { id: 'usr_abc', reason: 'scam', note: 'note ' + i }, tok);
  }
  const d = (await get(env, '/admin/reports', 'admintok')).body;
  ok(d.ok === true, 'the operator screen answers', d.ok);
  ok(d.openCount === 1, 'with the listing that was reported', d.openCount);
  ok(d.reports[0].count === 2, 'and how many different people said so', d.reports[0].count);
  ok(d.reports[0].seller === 'seller@example.com', 'and who sells it', d.reports[0].seller);
  ok((d.reports[0].notes || []).length > 0, 'and what they wrote', d.reports[0].notes);

  const nope = await get(env, '/admin/reports', 'wrong-token');
  ok(nope.status === 403, 'and nobody else can', nope.status);
}

section('And a screen exists that asks for it');
{
  /* The route existed for about ten minutes with nothing calling it, which is
     this batch's own defect committed one layer up. */
  ok(/\/admin\/reports/.test(bundle), 'the founder dashboard asks the route', true);
  ok(/_loadReports\(\)/.test(bundle), 'and the card is loaded, not merely defined', true);
}

if (report('a-report-reaches-somebody') > 0) process.exitCode = 1;
done();
