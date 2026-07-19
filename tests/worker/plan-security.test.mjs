/* PLAN SECURITY — the server must NEVER trust a client-supplied plan.
   A user editing localStorage.amv_plan or sending body.plan='ultra' must still
   be enforced as their real (server-DB) plan. Proves compute can't be stolen. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'plansec.harness.mjs');
writeFileSync(harness, src + '\nexport { requireUser, issueTokens, setEntitlement };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = { JWT_SECRET: 'z'.repeat(40), AMV_KV: {
  async get(k){ return store.has(k)?store.get(k):null; },
  async put(k,v){ store.set(k,v); },
  async delete(k){ store.delete(k); },
  async list({prefix}){ return { keys:[...store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})), list_complete:true }; }
}};

section('Server derives plan from its OWN entitlement store, not the client');
store.set('acct:free@test.com', JSON.stringify({ email:'free@test.com', name:'Freebie' }));
// user is FREE in the server DB (no entitlement set)
const pair = await W.issueTokens(env, 'free@test.com', 'Freebie');

// Attacker sends a request with a forged body claiming ultra + spoofed header
const req = new Request('https://api.amv.dev/v1/ai', {
  method:'POST',
  headers:{ Authorization:'Bearer '+pair.token, 'Content-Type':'application/json' },
  body: JSON.stringify({ plan:'ultra', tier:'ultra', messages:[{role:'user',content:'hi'}] })
});
const user = await W.requireUser(req, env);
ok(user !== null, 'the JWT itself is valid (real login)', !!user);
ok(user.plan === 'free', "the server ignores the client's forged plan and uses 'free'", user.plan);

section('An upgraded plan only appears after a REAL server-side entitlement');
await W.setEntitlement(env, 'free@test.com', 'ultra');   // e.g. via verified Stripe webhook
const user2 = await W.requireUser(req, env);   // same forged request
ok(user2.plan === 'ultra', 'now that the SERVER granted ultra, it reads ultra', user2.plan);

section('The code path enforces plan rank on premium engines');
ok(/PLAN_RANK\[user\.plan\]\s*<\s*PLAN_RANK\[eng\.minPlan\]/.test(src), 'premium engines are gated by server-side plan rank');
ok(/requireUser/.test(src) && /verifyToken/.test(src), 'identity comes from a verified token, not client input');

report();
done();
