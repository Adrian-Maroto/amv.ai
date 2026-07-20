/* BOT PROTECTION on auth — honeypot + optional Turnstile CAPTCHA.
   Proves: a filled honeypot is rejected (bot), signup/login work normally with
   no captcha configured (honest degradation), and when TURNSTILE_SECRET is set a
   missing/invalid token is rejected while a valid one passes. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'captcha.harness.mjs');
writeFileSync(harness, src + '\nexport { authSignup, authLogin, _verifyCaptcha };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const baseEnv = { JWT_SECRET: 'x'.repeat(40), AMV_KV: {
  async get(k){ return store.has(k)?store.get(k):null; },
  async put(k,v){ store.set(k,v); },
  async delete(k){ store.delete(k); },
  async list({prefix}){ return { keys:[...store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})), list_complete:true }; }
}};
const req = (body) => new Request('https://x',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

/* ── Honeypot ─────────────────────────────────────────────────────────────── */
section('A filled honeypot is treated as a bot and blocked');
store.clear();
let r = await W.authSignup(req({ email:'bot@x.com', name:'Bot', password:'Str0ngPass!88', company:'Acme Inc' }), baseEnv);
ok(r.status === 400, 'signup with a filled honeypot is rejected', r.status);
ok(!store.has('acct:bot@x.com'), 'and no account is created for the bot');

r = await W.authLogin(req({ email:'bot@x.com', password:'Str0ngPass!88', website:'http://spam' }), baseEnv);
ok(r.status === 400, 'login with a filled honeypot is rejected', r.status);

/* ── Honest degradation with no captcha configured ───────────────────────── */
section('With no TURNSTILE_SECRET, real signup/login still work');
store.clear();
r = await W.authSignup(req({ email:'real@x.com', name:'Real', password:'Str0ngPass!88' }), baseEnv);
ok(r.status === 200, 'a normal signup succeeds when captcha is not configured', r.status);
ok(store.has('acct:real@x.com'), 'the real account is created');

r = await W.authLogin(req({ email:'real@x.com', password:'Str0ngPass!88', provider:'email' }), baseEnv);
ok(r.status === 200, 'and they can log in', r.status);

/* ── Turnstile enforced when configured ──────────────────────────────────── */
section('When TURNSTILE_SECRET is set, a token is required and verified');
const capEnv = { ...baseEnv, TURNSTILE_SECRET: 'secret' };
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if(String(url).includes('siteverify')){
    const body = String(opts.body);
    // treat token "good" as valid, anything else invalid
    return { ok:true, status:200, json: async () => ({ success: /response=good/.test(body) }) };
  }
  return origFetch(url, opts);
};

store.clear();
r = await W.authSignup(req({ email:'nocap@x.com', name:'N', password:'Str0ngPass!88' }), capEnv);
ok(r.status === 400, 'signup with NO captcha token is rejected when captcha is on', r.status);

r = await W.authSignup(req({ email:'badcap@x.com', name:'N', password:'Str0ngPass!88', captchaToken:'bad' }), capEnv);
ok(r.status === 400, 'an INVALID captcha token is rejected', r.status);

r = await W.authSignup(req({ email:'goodcap@x.com', name:'N', password:'Str0ngPass!88', captchaToken:'good' }), capEnv);
ok(r.status === 200, 'a VALID captcha token lets a real user through', r.status);
ok(store.has('acct:goodcap@x.com'), 'and the account is created');

section('_verifyCaptcha helper: unset secret passes, set+missing fails');
ok(await W._verifyCaptcha(baseEnv, null, req({})) === true, 'no secret configured → passes (do not block before setup)');
ok(await W._verifyCaptcha(capEnv, null, req({})) === false, 'secret set + no token → fails');

globalThis.fetch = origFetch;
report();
done();
