/* THE CUSTOMER API.

   Everything an API needs already existed - metering, per-plan quotas, the
   monthly cost backstop, abuse controls. What was missing was a way to reach
   any of it without a browser session.

   The two things that decide whether an API key is safe: the store must never
   be able to show anyone the key, and revoking must actually stop it working.
   The second one is easy to get wrong in a way that looks fine on screen. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'apikeys.harness.mjs');
writeFileSync(harness, src + `
export { apiKeyCreate, apiKeyList, apiKeyRevoke, requireUser, effectiveLimits,
         setEntitlement, signToken, DB, API_KEY_MAX_PER_USER };
`);
const W = await import(harness + '?t=' + Date.now());

function makeEnv() {
  const kv = new Map();
  return { _kv: kv, JWT_SECRET: 'test-secret-abcdefghijklmnop',
    AMV_KV: { get: async k => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }) } };
}
const tokenFor = (env, email) => W.signToken({ email }, env.JWT_SECRET, 3600, env, 'access');
const post = (path, token, body) => new Request('https://w' + path,
  { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(body || {}) });
const withKey = (key) => new Request('https://w/v1/messages', { headers: { Authorization: 'Bearer ' + key } });

async function paidUser(env, email) {
  await W.setEntitlement(env, email, 'pro');
  return tokenFor(env, email);
}

section('A key belongs to an account, and spends that account');
{
  const env = makeEnv();
  const t = await paidUser(env, 'dev@x.com');
  const d = await (await W.apiKeyCreate(post('/v1/keys/create', t, { name: 'prod' }), env)).json();
  ok(d.ok && d.key.startsWith('amv_sk_'), 'a key is issued', d.key && d.key.slice(0, 10));

  const u = await W.requireUser(withKey(d.key), env);
  ok(u && u.email === 'dev@x.com', 'it resolves to the account that made it', u && u.email);
  ok(u.plan === 'pro', 'carrying that account\'s plan, so quotas apply unchanged', u.plan);
  ok(u.via === 'apikey', 'and it is marked as coming from a key');

  const lim = W.effectiveLimits(u);
  ok(lim.monthTokens > 0 && lim.dayTokens > 0, 'the same limits a browser session gets', lim.monthTokens);
}

section('The store cannot show anyone the key');
{
  const env = makeEnv();
  const t = await paidUser(env, 'dev@x.com');
  const d = await (await W.apiKeyCreate(post('/v1/keys/create', t, {}), env)).json();
  const dump = [...env._kv.entries()].map(([k, v]) => k + '=' + v).join('\n');
  ok(!dump.includes(d.key), 'the key itself is nowhere in storage', d.key.slice(0, 12));

  const list = await (await W.apiKeyList(post('/v1/keys/list', t), env)).json();
  const raw = JSON.stringify(list);
  ok(!raw.includes(d.key), 'and listing keys never returns one');
  ok(list.keys[0].last4 === d.key.slice(-4), 'only the last four, to recognise it', list.keys[0].last4);
  ok(!('hash' in list.keys[0]), 'not even the hash leaves the server', Object.keys(list.keys[0]));
  ok(/not stored and cannot be shown again/i.test(d.note), 'and the caller is told it is now or never');
}

section('Revoking actually stops it working');
{
  /* Marking the record revoked without removing what the request path reads
     would leave the key live - a revoke button that does nothing is worse than
     no revoke button, because it is believed. */
  const env = makeEnv();
  const t = await paidUser(env, 'dev@x.com');
  const d = await (await W.apiKeyCreate(post('/v1/keys/create', t, {}), env)).json();
  ok(!!(await W.requireUser(withKey(d.key), env)), 'it works before');

  await W.apiKeyRevoke(post('/v1/keys/revoke', t, { id: d.item.id }), env);
  ok((await W.requireUser(withKey(d.key), env)) === null, 'and is dead after');

  const list = await (await W.apiKeyList(post('/v1/keys/list', t), env)).json();
  ok(list.keys[0].revoked === true, 'the record says so too', list.keys[0].revoked);
}

section('A key cannot reach another account');
{
  const env = makeEnv();
  const a = await paidUser(env, 'a@x.com');
  await paidUser(env, 'b@x.com');
  const d = await (await W.apiKeyCreate(post('/v1/keys/create', a, {}), env)).json();
  const u = await W.requireUser(withKey(d.key), env);
  ok(u.email === 'a@x.com', 'it is only ever its own account', u.email);

  const bToken = await tokenFor(env, 'b@x.com');
  const steal = await W.apiKeyRevoke(post('/v1/keys/revoke', bToken, { id: d.item.id }), env);
  ok(steal.status === 404, 'and nobody else can revoke it', steal.status);
  ok(!!(await W.requireUser(withKey(d.key), env)), 'so it still works');
}

section('A made-up or malformed key is simply nobody');
{
  const env = makeEnv();
  ok((await W.requireUser(withKey('amv_sk_deadbeef'), env)) === null, 'an invented key resolves to nothing');
  ok((await W.requireUser(withKey('not-a-key'), env)) === null, 'and so does junk');
  const noAuth = await W.requireUser(new Request('https://w/v1/messages'), env);
  ok(noAuth === null, 'as does no credential at all');
}

section('A lapsed plan cannot mint one, and an existing key follows the plan down');
{
  const env = makeEnv();
  const t = await paidUser(env, 'lapse@x.com');
  const d = await (await W.apiKeyCreate(post('/v1/keys/create', t, {}), env)).json();

  const ent = await W.DB.get(env, 'ent', 'lapse@x.com');
  ent.pastDueSince = Date.now() - 60 * 86400000;
  await W.DB.put(env, 'ent', 'lapse@x.com', ent);

  const u = await W.requireUser(withKey(d.key), env);
  ok(u.plan === 'free', 'the key now spends a free plan, not the one that stopped paying', u.plan);

  const again = await W.apiKeyCreate(post('/v1/keys/create', t, {}), env);
  ok(again.status === 402, 'and no new key can be made', again.status);
}

section('Free accounts are told, not silently refused');
{
  const env = makeEnv();
  const t = await tokenFor(env, 'free@x.com');
  const r = await W.apiKeyCreate(post('/v1/keys/create', t, {}), env);
  const d = await r.json();
  ok(r.status === 402, 'an API key is part of a paid plan', r.status);
  ok(d.code === 'plan_required', 'with a code the app can act on', d.code);
  ok(/Upgrade/.test(d.error), 'and an offer rather than a wall', d.error);
}

section('There is a ceiling on keys');
{
  const env = makeEnv();
  const t = await paidUser(env, 'many@x.com');
  /* Seeded rather than created in a loop: creating keys is ALSO rate limited
     (five a minute), so a loop hits that bound first and would test the wrong
     one. Both exist on purpose - this isolates the ceiling. */
  await W.DB.put(env, 'apikeys', 'many@x.com', {
    items: Array.from({ length: W.API_KEY_MAX_PER_USER },
      (_, i) => ({ id: 'k_seed' + i, name: 'seed', last4: '0000', created: Date.now(), calls: 0 })),
  });
  const over = await W.apiKeyCreate(post('/v1/keys/create', t, {}), env);
  ok(over.status === 429, 'past the maximum it refuses', over.status);
  ok(/Revoke one/i.test((await over.json()).error), 'and says how to make room');

  // A revoked key does not count against the ceiling - otherwise rotating a key
  // would permanently cost you a slot.
  const rec = await W.DB.get(env, 'apikeys', 'many@x.com');
  rec.items[0].revoked = Date.now();
  await W.DB.put(env, 'apikeys', 'many@x.com', rec);
  const after = await W.apiKeyCreate(post('/v1/keys/create', t, {}), env);
  ok(after.status === 200, 'and revoking one makes room again', after.status);
}

report('api-keys');
done();
