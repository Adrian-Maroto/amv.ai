/* ACCOUNT DELETION — the "right to erasure" the privacy policy promises.
   Proves: deleting an account purges ALL of that user's data across every
   prefix, revokes their tokens, only ever deletes the CALLER (not others), and
   requires auth. A false "delete my data" button is a legal + trust problem, so
   this must actually erase. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'del.harness.mjs');
writeFileSync(harness, src +
  '\nexport { authDeleteAccount, verifyToken, issueTokens };' +
  '\nexport function __setRequireUser(fn){ requireUser = fn; }\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = { JWT_SECRET: 'x'.repeat(40), AMV_KV: {
  async get(k){ return store.has(k)?store.get(k):null; },
  async put(k,v){ store.set(k,v); },
  async delete(k){ store.delete(k); },
  async list({prefix}){ return { keys:[...store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})), list_complete:true }; }
}};

let asUser = null;
W.__setRequireUser(async () => asUser ? { email: asUser } : null);
const req = () => new Request('https://x', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });

/* seed two users' data */
function seed(){
  store.clear();
  for(const email of ['alice@test.com','bob@test.com']){
    store.set(`acct:${email}`, JSON.stringify({ email }));
    store.set(`ent:${email}`, JSON.stringify({ plan:'pro' }));
    store.set(`data:${email}`, JSON.stringify({ chats:['secret'] }));
    store.set(`auto:${email}`, JSON.stringify({ items:[{id:'a1'}] }));
    store.set(`handoff:${email}`, JSON.stringify({ incoming:[] }));
    store.set(`wallet:${email}`, JSON.stringify({ credits:100 }));
  }
}

section('Deleting an account requires auth');
seed();
asUser = null;
let r = await W.authDeleteAccount(req(), env);
ok(r.status === 401, 'no auth → 401 (cannot delete without signing in)', r.status);

section('Deleting purges ALL of the caller\'s data');
asUser = 'alice@test.com';
r = await W.authDeleteAccount(req(), env);
ok((await r.json()).ok, 'the delete succeeds');
// Everything personal is gone. The only thing intentionally kept is the tiny
// token-revocation marker (tokepoch) — a bare integer, no personal data — which
// must survive so any still-circulating tokens stay dead.
const aliceLeft = [...store.keys()].filter(k => k.includes('alice@test.com'));
const onlyEpoch = aliceLeft.every(k => k.startsWith('tokepoch:'));
ok(aliceLeft.length === 0 || onlyEpoch, 'no personal data remains (only the token-revocation marker may persist)', aliceLeft);
ok(!store.has('acct:alice@test.com') && !store.has('data:alice@test.com'), 'the account + chats are definitely gone');

section('Deleting one account does NOT touch anyone else');
const bobLeft = [...store.keys()].filter(k => k.includes('bob@test.com'));
ok(bobLeft.length === 6, "bob's data is fully intact — you can only delete YOURSELF", bobLeft.length);

section('After deletion, the account record is truly gone');
ok(!store.has('acct:alice@test.com'), 'the account record is removed');
ok(!store.has('ent:alice@test.com'), 'the subscription record is removed');
ok(!store.has('data:alice@test.com'), 'the chats/synced data are removed');
ok(!store.has('auto:alice@test.com'), 'the automations are removed');

section('Tokens are revoked on deletion (sessions die)');
// revokeUserTokens bumps the epoch; a token issued BEFORE deletion must stop working
seed();
asUser = 'carl@test.com';
store.set('acct:carl@test.com', JSON.stringify({ email:'carl@test.com' }));
const pair = await W.issueTokens(env, 'carl@test.com', 'Carl');
ok(await W.verifyToken(pair.token, env.JWT_SECRET, env, 'access'), 'carl has a working token before deletion');
await W.authDeleteAccount(req(), env);
const stillValid = await W.verifyToken(pair.token, env.JWT_SECRET, env, 'access');
ok(stillValid === null, 'after deletion, the old token no longer authenticates', stillValid);

report();
done();
