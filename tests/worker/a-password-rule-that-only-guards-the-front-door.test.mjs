/* THE RULE WAS ON THE DOOR NOBODY USES TO GET IN.

   AMV refused `password123` at signup. It did not refuse it at the password
   RESET, or at the admin reset - both of those checked the length and stopped.
   So the rule was defeated by the easier route: a reset link needs an email you
   can receive, not an account you already have. Somebody who wanted a weak
   password simply signed up with a strong one and reset it, and somebody whose
   account was being taken over got no protection at the exact moment the
   attacker was choosing the new credential.

   That is the shape of this class of bug and it is why the fix is not "add two
   lines to two more routes". Every path that SETS a password already calls one
   function, because it has to bound the length before hashing. The strength
   rules live in that function now, so the fourth route somebody writes gets
   them without knowing they exist.

   This file therefore asserts the rules through EVERY DOOR, by calling the real
   handlers rather than the predicate - a predicate that returns true while no
   route consults it is precisely what was wrong before. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'password.harness.mjs');
writeFileSync(harness, src + `
export { authSignup, authResetConfirm, authAdminReset,
         _passwordProblem, _isCommonPassword, _passwordIsPersonal, DB };
export function __setAdminGate(fn){ _adminGate = fn; }
`);
const W = await import(harness + '?t=' + Date.now());
W.__setAdminGate(async () => null);          // the admin is who they say they are

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix } = {}) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true };
    },
  },
};
const req = (url, body) => new Request('https://x' + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
  body: JSON.stringify(body || {}),
});

/* An account, and a live reset token pointing at it. Rebuilt per case so a
   consumed token or a rate limit cannot leak between them. */
const EMAIL = 'jessica.morgan@example.com';
async function seed() {
  store.clear();
  await W.DB.put(env, 'acct', EMAIL, { email: EMAIL, name: 'Jessica Morgan', createdAt: 1000, pwHash: 'x', salt: 'y' });
  store.set('reset:tok_live', JSON.stringify({ email: EMAIL, at: Date.now() }));
}

/* The three doors, each returning just the status and the refusal code. */
const doors = {
  async signup(pw) {
    await seed();
    const r = await W.authSignup(req('/auth/signup', { email: 'newcomer@example.com', name: 'New Comer', password: pw }), env);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  },
  async reset(pw) {
    await seed();
    const r = await W.authResetConfirm(req('/auth/reset/confirm', { token: 'tok_live', password: pw }), env);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  },
  async adminReset(pw) {
    await seed();
    const r = await W.authAdminReset(req('/auth/admin-reset', { email: EMAIL, password: pw }), env);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  },
};
const NAMES = Object.keys(doors);

section('A commonly guessed password is refused at every door, not just signup');
{
  /* `password123` was accepted by two of these three for as long as the rule
     lived in one handler. */
  for (const d of NAMES) {
    const r = await doors[d]('password123');
    ok(r.status === 400 && r.body.code === 'password_too_common',
       `[${d}] refuses the password the front door already refused`, r);
  }
}

section('And so are the shapes people actually choose');
{
  const weak = {
    'a word with a year on it': 'monkey2024',
    'a word with a bang on it': 'dragon!!',
    'the same word spelled in digits': 'p4ssw0rd',
    'a walk along the keyboard': 'qwertyuiop',
    'the same walk backwards': 'poiuytrewq',
    'one character, many times': 'aaaaaaaa',
    'the product name and a number': 'amv12345',
  };
  for (const [why, pw] of Object.entries(weak)) {
    /* Through a real door, and through the RESET door specifically, because
       that is the one that had nothing. */
    const r = await doors.reset(pw);
    ok(r.status === 400 && r.body.code === 'password_too_common', why + ': ' + pw, r);
  }
}

section('Your own address is not a password, whichever door you set it at');
{
  /* It survives every rule above - `jessicamorgan` is nobody's idea of a
     common password - and it is the first thing tried by anybody holding the
     address, which is whoever is attacking the account. */
  for (const pw of ['jessica.morgan', 'jessicamorgan', 'Jessica.Morgan99', EMAIL]) {
    const r = await doors.reset(pw);
    ok(r.status === 400 && r.body.code === 'password_is_personal',
       'the reset refuses ' + pw, r);
  }
  const a = await doors.adminReset(EMAIL);
  ok(a.status === 400 && a.body.code === 'password_is_personal',
     'and an operator cannot reset an account to its own address', a);
  const s = await doors.signup('newcomer');
  ok(s.status === 400 && s.body.code === 'password_is_personal',
     'nor can somebody sign up with their own address as the password', s);
}

section('A good password still gets through every door');
{
  /* THE HALF THAT MATTERS AS MUCH. A rule nobody can satisfy is an outage,
     and a base list long enough to catch every weak password would refuse
     real ones - a passphrase that happens to contain a listed word is a good
     password and has to stay one. */
  const good = ['correct horse battery staple', 'Tr0ubad0ur&3xile', 'my horse likes dragons',
                'quiet-lamp-river-97', 'Vanishing.Point.1987'];
  for (const pw of good) {
    for (const d of NAMES) {
      const r = await doors[d](pw);
      ok(r.status !== 400 || !/password_/.test(r.body.code || ''),
         `[${d}] accepts a real password: ${pw}`, { status: r.status, code: r.body.code });
    }
  }
}

section('The length rules did not move when the strength rules arrived');
{
  for (const d of NAMES) {
    const short = await doors[d]('Ab3!x');
    ok(short.status === 400 && short.body.code === 'password_too_short',
       `[${d}] still refuses something too short`, short);
    const long = await doors[d]('V' + 'q'.repeat(600));
    ok(long.status === 400 && long.body.code === 'password_too_long',
       `[${d}] still refuses something absurdly long, before hashing it`, long);
  }
}

section('Signing in is never held to a rule about strength');
{
  /* A strength rule applied at the door somebody ENTERS by locks out every
     account whose password predates the rule - a rule change turning into an
     outage for the people least able to explain it. The gate is only reachable
     from the set paths, and the read-side bound is about length alone. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const login = code.slice(code.indexOf('async function authLogin'), code.indexOf('async function authLogin') + 3000);
  ok(login.length > 100, 'the sign-in handler was found', login.length);
  ok(!/_passwordProblem\s*\(/.test(login) && !/_isCommonPassword\s*\(/.test(login),
     'it asks neither strength question', true);
  ok(/_passwordTooLong\s*\(/.test(login),
     'only the length bound that protects the server from hashing a weapon', true);
}

section('Every path that sets a password goes through the one gate');
{
  /* The structural claim, which is the one that survives the next route being
     written. Read from source: a handler that hashes a new password without
     asking the gate first is the defect this file is about, in its next form. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const setters = ['authSignup', 'authResetConfirm', 'authAdminReset'];
  for (const fn of setters) {
    const at = code.indexOf('function ' + fn);
    ok(at > 0, fn + ' exists', at);
    const body = code.slice(at, code.indexOf('\n}', at));
    const gate = body.indexOf('_passwordProblem(');
    const hash = body.indexOf('_hashPassword(');
    ok(gate > 0, fn + ' asks the gate', gate);
    ok(hash < 0 || gate < hash,
       fn + ' asks it BEFORE spending the hash, so a refusal costs nothing', { gate, hash });
  }
  /* And nothing calls the retired name, which would be a route quietly on the
     old rules. */
  ok(!/_passwordLengthProblem\s*\(/.test(code),
     'no route is still calling the length-only gate', true);
}

if (report('a-password-rule-that-only-guards-the-front-door') > 0) process.exitCode = 1;
done();
