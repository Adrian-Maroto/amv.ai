/* AN ACCOUNT COSTS MONEY, SO MAKING ONE HAS TO HAVE A CEILING.

   Every other auth route was bounded. Signing in was, because somebody
   guessing passwords is obvious. Resetting was, because it sends mail. Making
   an account - the one that creates a thing which then SPENDS - was not.

   And a free account is not free. It carries a real monthly token allowance and
   a weekly autonomous job that runs on a timer whether anybody is watching or
   not. So unlimited sign-ups is unlimited spend on AMV's card, without anybody
   having to attack anything clever. It also quietly ruins every number the
   owner steers by: conversion, activation, daily actives all stop describing
   people.

   The comment in that function said "we rely on the honeypot + rate limits".
   The honeypot was there. The rate limits were not. And the captcha does not
   cover it either - `_verifyCaptcha` returns true when TURNSTILE_SECRET is
   unset, which is the default, so a fresh deployment had nothing at all.

   The limit has to be per-caller, generous enough for a household or an office
   behind one address, and it must not become a global limit when the address
   is missing - which is how a rate limit turns into a denial of service
   written by the person adding it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'signup.harness.mjs');
writeFileSync(harness, src + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

/* A counter that really counts, because a rate limit tested against a stub that
   always allows is a rate limit tested against nothing. */
function mkEnv(extra) {
  const m = new Map(); const n = new Map();
  return Object.assign({
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: all.slice(0, limit || 1000), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body);
        const cur = n.get(x) || 0;
        if (b.op === 'rateCheck') {
          if (cur >= b.limit) return new Response(JSON.stringify({ allowed: false, count: cur }));
          n.set(x, cur + 1);
          return new Response(JSON.stringify({ allowed: true, count: cur + 1 }));
        }
        if (b.op === 'claim') { if (n.has('c:' + x)) return new Response(JSON.stringify({ claimed: false })); n.set('c:' + x, 1); return new Response(JSON.stringify({ claimed: true })); }
        if (b.op === 'release') { n.delete('c:' + x); return new Response(JSON.stringify({ ok: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  }, extra || {});
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const signup = async (env, email, ip) => {
  const r = await worker.fetch(new Request('https://api.amv.test/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ip === null ? {} : { 'CF-Connecting-IP': ip || '10.0.0.1' }) },
    body: JSON.stringify({ email, name: 'N', password: 'A-real-Passw0rd!' }),
  }), env, ctx);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

section('One person can make an account');
{
  const env = mkEnv();
  const r = await signup(env, 'first@example.com');
  ok(!!r.body.token, 'a normal sign-up works', r.body.error || 'ok');
}

section('A household behind one address is not punished');
{
  /* Several people on one office or family connection is ordinary. A limit that
     stops the third flatmate is a limit that costs more than it saves. */
  const env = mkEnv();
  let made = 0;
  for (let i = 0; i < 4; i++) {
    const r = await signup(env, 'house' + i + '@example.com', '20.0.0.7');
    if (r.body.token) made++;
  }
  ok(made === 4, 'four accounts from one address all go through', made);
}

section('But a farm is stopped');
{
  const env = mkEnv();
  let made = 0, blocked = 0;
  for (let i = 0; i < 30; i++) {
    const r = await signup(env, 'farm' + i + '@example.com', '90.0.0.1');
    if (r.body.token) made++;
    else if (r.status === 429) blocked++;
  }
  ok(blocked > 0, 'the run is cut off rather than absorbed', { made, blocked });
  ok(made < 30, 'not every attempt became an account that can spend', made);
  ok(made >= 5, 'and the cut-off is not so tight that it hits a real person', made);
}

section('One address running out does not stop everybody else');
{
  /* The failure this could introduce. If the key collapses to one bucket - or
     to the empty string when the address is missing - then five sign-ups a
     minute becomes the limit for the entire internet, and the rate limit is a
     denial of service written by the person adding it. */
  const env = mkEnv();
  for (let i = 0; i < 30; i++) await signup(env, 'flood' + i + '@example.com', '77.0.0.9');
  const other = await signup(env, 'elsewhere@example.com', '55.5.5.5');
  ok(!!other.body.token, 'somebody on a different address still gets in', other.body.error || 'ok');
}

section('And a caller with no address at all is bounded, not exempt');
{
  /* No CF-Connecting-IP is either a misconfigured deployment or somebody
     probing. Unbounded is the wrong answer to both. */
  const env = mkEnv();
  let made = 0, blocked = 0;
  for (let i = 0; i < 30; i++) {
    const r = await signup(env, 'anon' + i + '@example.com', null);
    if (r.body.token) made++; else if (r.status === 429) blocked++;
  }
  ok(blocked > 0, 'unidentifiable callers share a bucket rather than escaping the limit', { made, blocked });
}

section('The refusal is honest about what happened');
{
  const env = mkEnv();
  let last = null;
  for (let i = 0; i < 30; i++) last = await signup(env, 'msg' + i + '@example.com', '11.11.11.11');
  ok(last.status === 429, 'it is a rate limit, not a generic failure', last.status);
  ok(/too fast|limit/i.test(last.body.error || ''), 'and says so in words', last.body.error);
  ok(!/password|captcha|invalid/i.test(last.body.error || ''),
     'without blaming the person for something they did not get wrong', last.body.error);
}

section('Every auth route now has a ceiling');
{
  /* Stated as a list so a new auth route cannot quietly join without one. */
  const bodyOf = (fn) => {
    const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + fn + '\\s*\\('));
    if (!m) return '';
    const open = src.indexOf('{', m.index + m[0].length);
    const nexts = [src.indexOf('\nasync function ', open), src.indexOf('\nfunction ', open)].filter(i => i > 0);
    return src.slice(open, Math.min(...nexts));
  };
  const BOUNDED = /guardAction\(|limitAction\(|op:\s*'rateCheck'|_noteAuthFail/;
  const routes = ['authSignup', 'authLogin', 'authReset', 'authResetConfirm'];
  const loose = routes.filter(fn => !BOUNDED.test(bodyOf(fn)));
  ok(loose.length === 0, 'no way in is unbounded', loose);
}

globalThis.fetch = realFetch;
if (report('making-accounts-is-not-free') > 0) process.exitCode = 1;
done();
