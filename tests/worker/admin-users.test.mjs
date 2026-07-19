/* ADMIN USER LIST — full account detail, owner-only.
   Proves: owner-gated, returns every account with the rich fields (plan, spend,
   wallet, purchases, abuse flags, join date), and non-owners are refused. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'adminusers.harness.mjs');
writeFileSync(harness, src + '\nexport { adminUsers, issueTokens, setEntitlement, _abuseRecord };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = { JWT_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@test.com', AMV_KV: {
  async get(k){ return store.has(k)?store.get(k):null; },
  async put(k,v){ store.set(k,v); },
  async delete(k){ store.delete(k); },
  async list({prefix}){ return { keys:[...store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})), list_complete:true }; }
}};

// seed accounts
store.set('acct:owner@test.com', JSON.stringify({ email:'owner@test.com', name:'Owner', createdAt:1700000000000 }));
store.set('acct:alice@test.com', JSON.stringify({ email:'alice@test.com', name:'Alice', createdAt:1700000001000 }));
store.set('acct:bob@test.com', JSON.stringify({ email:'bob@test.com', name:'Bob', createdAt:1700000002000 }));
await W.setEntitlement(env, 'alice@test.com', 'pro');
store.set('wallet:alice@test.com', JSON.stringify({ balance: 42.5 }));
store.set('purchases:alice@test.com', JSON.stringify([{id:'x'},{id:'y'}]));
await W._abuseRecord(env, 'bob@test.com', 'dispute', {});  // flag bob

const reqAs = async (email) => {
  const pair = await W.issueTokens(env, email, 'N');
  return new Request('https://api.amv.dev/admin/users', { method:'GET', headers:{ Authorization:'Bearer '+pair.token } });
};

section('The user list is owner-only');
let r = await W.adminUsers(await reqAs('alice@test.com'), env);
ok(r.status === 403, 'a normal user cannot list all accounts', r.status);
r = await W.adminUsers(new Request('https://api.amv.dev/admin/users', { method:'GET' }), env);
ok(r.status === 401, 'no token → unauthorized', r.status);

section('The owner sees every account with full detail');
r = await W.adminUsers(await reqAs('owner@test.com'), env);
ok(r.status === 200, 'the owner can list accounts', r.status);
const d = await r.json();
ok(d.users.length === 3, 'all 3 accounts are returned', d.users.length);
const alice = d.users.find(u=>u.email==='alice@test.com');
ok(alice.plan === 'pro', "alice's plan is shown", alice.plan);
ok(alice.walletBalance === 42.5, "her wallet balance is shown", alice.walletBalance);
ok(alice.purchases === 2, 'her purchase count is shown', alice.purchases);
ok(typeof alice.monthCostUSD === 'number', 'her monthly AI cost is included', alice.monthCostUSD);
ok(alice.createdAt === 1700000001000, 'her join date is included');
const bob = d.users.find(u=>u.email==='bob@test.com');
ok(bob.flagged === true, 'a flagged account is marked flagged', bob.flagged);
ok(bob.disputes === 1, 'with its dispute count', bob.disputes);

section('Every account exposes its email (the core ask)');
ok(d.users.every(u=>u.email && u.email.includes('@')), 'every listed account has an email');

report();
done();
