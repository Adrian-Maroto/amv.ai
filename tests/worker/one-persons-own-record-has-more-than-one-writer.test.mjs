/* "THE CALLER'S OWN RECORD" IS NOT THE SAME CLAIM AS "ONE WRITER".

   Eight handlers read a record, changed it, and wrote it back with no lock.
   Every one of them was excused on the same reasoning: it is the caller's own
   record, so there is nobody to race.

   That is true about who OWNS the record and says nothing about how many
   writers it has. One person with a phone and a laptop is two. A
   double-submitted form is two. A retry landing beside the request it is
   retrying is two. In every case both read the same record, both apply their
   own change, and the later write puts back a copy that never saw the other -
   silently, with both callers told it worked.

   Three of the eight were wrong on their own terms as well.

   `apiKeyCreate` was excused because "the cap below refuses the second anyway".
   The cap is read inside the same window it is meant to close, so it refuses
   nothing - and the key that loses the race is worse than lost: its lookup row
   is written regardless, so it goes on authenticating while vanishing from the
   list that is the only way to revoke it.

   `handoffCreate` was excused as writing "the SENDER's own copy". It writes the
   recipient's inbox too, which every other sender appends to - so two people
   handing work to the same person at once lose one handoff, and the sender who
   lost is told it was delivered.

   `widgetConfigSave` was excused because "the only other writer is this same
   handler", which is the definition of the race rather than a reason there is
   not one.

   And two marketplace records are not the caller's at all: ratings are keyed by
   the LISTING and reviews by the SELLER, so their writers are every buyer.

   Each case here runs concurrently against storage that yields, because
   sequentially all eight look correct - which is why they were all still
   there. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ownrecord.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, API_KEY_MAX_PER_USER };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const PW = 'A-real-Passw0rd!';
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

/* Storage that yields before every read and every write, so a read-then-write
   really can be interleaved. A synchronous Map cannot lose a race by
   construction and would report all eight as already fixed. */
function mkEnv() {
  const m = new Map(); const vals = new Map();
  let chain = Promise.resolve();
  const serialise = (fn) => (chain = chain.then(fn, fn));
  return {
    JWT_SECRET: 'j', APP_URL: 'https://amv.test', _vals: vals,
    AMV_KV: {
      _map: m,
      async get(k) { await new Promise(r => setTimeout(r, 1)); return m.has(k) ? m.get(k) : null; },
      async put(k, v) { await new Promise(r => setTimeout(r, 1)); m.set(k, v); },
      async delete(k) { await new Promise(r => setTimeout(r, 1)); m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ fetch(_u, init) {
        return serialise(async () => {
          await Promise.resolve();
          const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
          if (b.op === 'claim') {
            if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false }));
            vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true, owner: 'o' + Math.random() }));
          }
          if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ released: true })); }
          if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
          if (b.op === 'rateCheck') { const nx = cur + 1; vals.set(n, nx); return new Response(JSON.stringify({ allowed: nx <= (b.limit || 9999) })); }
          return new Response(JSON.stringify({ allowed: true, value: cur }));
        });
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '7.7.7.7',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };

async function person(env, email, paid) {
  const tok = (await (await call(env, '/auth/signup', { email, name: 'P', password: PW })).json()).token;
  if (paid) await W.DB.put(env, 'ent', email, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}

section('Two API keys created at once do not lose one');
{
  /* The key that loses the race is worse than lost. Its lookup row is written
     either way, so it keeps authenticating - while being absent from the list
     that is the only way to revoke it. */
  const env = mkEnv();
  const tok = await person(env, 'keys@example.com', true);

  const rs = await Promise.all([
    post(env, '/v1/keys/create', { name: 'one' }, tok),
    post(env, '/v1/keys/create', { name: 'two' }, tok),
  ]);
  const made = rs.filter(r => r.body.ok);
  ok(made.length === 2, 'both are created', rs.map(r => r.status));

  const listed = (await post(env, '/v1/keys/list', {}, tok)).body.keys || [];
  ok(listed.length === 2, 'and BOTH are on the record, so both can be revoked', listed.map(k => k.name));

  /* Nothing authenticates that the owner cannot see. */
  const lookups = [...env.AMV_KV._map.keys()].filter(k => k.startsWith('apikey:'));
  ok(lookups.length === listed.length,
     'every live lookup row corresponds to a key the owner can see', { lookups: lookups.length, listed: listed.length });
}

section('And the cap holds against a burst');
{
  const env = mkEnv();
  const tok = await person(env, 'capped@example.com', true);
  const max = W.API_KEY_MAX_PER_USER;
  const rs = await Promise.all(Array.from({ length: max + 4 }, (_, i) => post(env, '/v1/keys/create', { name: 'k' + i }, tok)));
  const made = rs.filter(r => r.body.ok).length;
  ok(made <= max, 'no more keys are created than the cap allows', { made, max });
  const listed = (await post(env, '/v1/keys/list', {}, tok)).body.keys || [];
  ok(listed.length === made, 'and every one of them is listed', { listed: listed.length, made });
}

section('Two people handing work to the same person both arrive');
{
  /* The recipient's inbox has as many writers as it has senders. */
  const env = mkEnv();
  const a = await person(env, 'sender-a@example.com');
  const b = await person(env, 'sender-b@example.com');
  await person(env, 'busy@example.com');

  await Promise.all([
    post(env, '/api/handoff', { title: 'from A', to: 'busy@example.com' }, a),
    post(env, '/api/handoff', { title: 'from B', to: 'busy@example.com' }, b),
  ]);

  const inbox = (await W.DB.get(env, 'handoff', 'busy@example.com')) || { incoming: [] };
  ok((inbox.incoming || []).length === 2,
     'both handoffs are in the inbox', (inbox.incoming || []).map(h => h.title));
}

section('Two buyers reviewing one seller both get a review');
{
  const env = mkEnv();
  const seller = 'seller@example.com';
  await person(env, seller);
  const b1 = await person(env, 'buyer1@example.com');
  const b2 = await person(env, 'buyer2@example.com');

  /* Both own something of the seller's, which is what the handler requires. */
  await W.DB.put(env, 'market', 'usr_thing', { id: 'usr_thing', title: 'A thing', price: 10,
                                               authorEmail: seller, status: 'active' });
  for (const who of ['buyer1@example.com', 'buyer2@example.com']) {
    env.AMV_KV._map.set(`purchases:${who}`, JSON.stringify([{ id: 'usr_thing', at: Date.now() }]));
  }

  await Promise.all([
    post(env, '/v1/market/review', { seller, stars: 5, text: 'from buyer one' }, b1),
    post(env, '/v1/market/review', { seller, stars: 4, text: 'from buyer two' }, b2),
  ]);

  const list = JSON.parse(env.AMV_KV._map.get('mkreview:' + seller) || '[]');
  ok(list.length === 2, 'both reviews are stored', list.map(r => r.text));
  ok(new Set(list.map(r => r.byId)).size === 2, 'from two different reviewers', list.map(r => r.byId));
}

section('Two buyers rating one listing both count');
{
  const env = mkEnv();
  const seller = 'seller2@example.com';
  await person(env, seller);
  const b1 = await person(env, 'rater1@example.com');
  const b2 = await person(env, 'rater2@example.com');
  await W.DB.put(env, 'market', 'usr_rated', { id: 'usr_rated', title: 'Rated', price: 10,
                                               authorEmail: seller, status: 'active' });
  for (const who of ['rater1@example.com', 'rater2@example.com']) {
    env.AMV_KV._map.set(`entitleitem:${who}:usr_rated`, '1');
  }

  const rs = await Promise.all([
    post(env, '/v1/market/rate', { id: 'usr_rated', stars: 5 }, b1),
    post(env, '/v1/market/rate', { id: 'usr_rated', stars: 3 }, b2),
  ]);
  ok(rs.every(r => r.body.ok), 'both ratings are accepted', rs.map(r => r.status));

  const map = JSON.parse(env.AMV_KV._map.get('mkrate:usr_rated') || '{}');
  ok(Object.keys(map).length === 2, 'and both are counted', map);
  const listing = await W.DB.get(env, 'market', 'usr_rated');
  ok(listing.ratings === 2, 'the listing agrees with the record', listing.ratings);
}

section('Two widget saves do not undo each other');
{
  /* One person, two tabs. Each applies its own field; the later write used to
     put back a record that never saw the other. */
  const env = mkEnv();
  const tok = await person(env, 'widget@example.com', true);

  await Promise.all([
    post(env, '/v1/widget/save', { title: 'My assistant' }, tok),
    post(env, '/v1/widget/save', { dailySpendCapUSD: 7 }, tok),
  ]);

  const cfg = await W.DB.get(env, 'widget_owner', 'widget@example.com');
  ok(cfg && cfg.title === 'My assistant', 'the title survives', cfg && cfg.title);
  ok(cfg && cfg.dailySpendCapUSD === 7, 'and so does the spend cap', cfg && cfg.dailySpendCapUSD);

  /* And exactly one site key was minted, not two. */
  const pub = [...env.AMV_KV._map.keys()].filter(k => k.startsWith('widget:'));
  ok(pub.length === 1, 'one site key exists, not one per tab', pub);
  ok(pub[0] === 'widget:' + cfg.key, 'and the public copy is the owner’s copy', pub[0]);
}

section('Two support tickets from two tabs both survive');
{
  const env = mkEnv();
  const tok = await person(env, 'help@example.com');
  await Promise.all([
    post(env, '/v1/support', { text: 'the first problem I am having' }, tok),
    post(env, '/v1/support', { text: 'the second problem I am having' }, tok),
  ]);
  const rec = (await W.DB.get(env, 'support', 'help@example.com')) || { tickets: [] };
  ok((rec.tickets || []).length === 2,
     'somebody who asked for help twice has two tickets', (rec.tickets || []).length);
}

section('A birth year recorded once cannot be set twice');
{
  /* The comment on this rule says a limit anyone can raise by retyping it is
     not a limit. It was a read followed by a write, so retyping it twice at
     once was exactly how to raise it. */
  const env = mkEnv();
  const tok = await person(env, 'age@example.com');
  await Promise.all([
    post(env, '/v1/consent', { termsVersion: 'v1', birthYear: 1990 }, tok),
    post(env, '/v1/consent', { termsVersion: 'v1', birthYear: 2020 }, tok),
  ]);
  const rec = await W.DB.get(env, 'consent', 'age@example.com');
  ok(rec && [1990, 2020].includes(rec.birthYear), 'one of them was recorded', rec && rec.birthYear);

  /* And it cannot be changed afterwards, which is the rule. */
  const was = rec.birthYear;
  await post(env, '/v1/consent', { termsVersion: 'v2', birthYear: was === 1990 ? 2020 : 1990 }, tok);
  const after = await W.DB.get(env, 'consent', 'age@example.com');
  ok(after.birthYear === was, 'and it is not editable afterwards', { was, after: after.birthYear });
}

section('Every one of the eight takes the lock');
{
  /* The structural half, and the roster that excused them is the thing that
     had to change: an exemption whose reason has stopped being true is how a
     real bypass gets waved through later by inheriting somebody else's. */
  const roster = readFileSync(join(ROOT, 'tests', 'worker', 'a-lock-nobody-takes-is-not-a-lock.test.mjs'), 'utf8');
  const gone = ['apiKeyCreate', 'handoffCreate', 'handoffAct', 'widgetConfigSave',
                'crewJobs', 'supportSubmit', 'consentRecord', 'deployDelete'];
  const list = roster.slice(roster.indexOf('const NO_LOCK_NEEDED = {'), roster.indexOf('\n};', roster.indexOf('const NO_LOCK_NEEDED = {')));
  for (const fn of gone) {
    ok(!new RegExp('^\\s*' + fn + ':', 'm').test(list), fn + ' is no longer excused from locking', fn);
  }

  for (const [fn, kind] of [['apiKeyCreate', 'apikeys'], ['handoffCreate', 'handoff'],
                            ['handoffAct', 'handoff'], ['widgetConfigSave', 'widget_owner'],
                            ['crewJobs', 'crewjobs'], ['supportSubmit', 'support'],
                            ['consentRecord', 'consent'], ['deployDelete', 'sites']]) {
    const body = codeOnly(functionBody(src, fn));
    ok(new RegExp("_withKind\\(env, '" + kind + "'").test(body),
       fn + ' writes ' + kind + ' under the record lock', true);
  }

  /* And the two that are not the caller's record at all. */
  ok(/_withKV\(env, 'mkreview'/.test(codeOnly(functionBody(src, 'marketReview'))),
     'marketReview locks the seller’s review list', true);
  ok(/_withKV\(env, 'mkrate'/.test(codeOnly(functionBody(src, 'marketRate'))),
     'marketRate locks the listing’s rating map', true);
}

globalThis.fetch = realFetch;
if (report('one-persons-own-record-has-more-than-one-writer') > 0) process.exitCode = 1;
done();
