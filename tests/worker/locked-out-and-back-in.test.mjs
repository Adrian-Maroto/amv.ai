/* THE ONLY WAY BACK IN, FOR SOMEBODY WHO IS PAYING.

   A customer who cannot sign in is a customer who cancels. Password reset is
   the single path back, it is used by exactly the people most likely to be
   annoyed already, and it is the one flow nobody exercises in normal use - so
   it can be broken for months without anybody noticing until the person it
   fails is a paying one.

   It is also the most attackable thing in an auth system, because it hands out
   account access to whoever holds a string. So the cases split in two: it has
   to WORK, all the way to signing in with the new password, and it must not
   become a way to learn who has an account, to reuse a link, or to reach an
   account the link was never issued for.

   Driven through the worker's real router with a real email provider stub, so
   the token under test is the one that would really be emailed. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'lockout.harness.mjs');
writeFileSync(harness, src + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const USER = 'locked@example.com';
const OLD = 'Old-Passw0rd!99';
const NEW = 'Brand-New-Passw0rd!42';

function makeKV() {
  const m = new Map();
  return {
    _map: m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix, limit } = {}) {
      let keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
      if (limit) keys = keys.slice(0, limit);
      return { keys, list_complete: true };
    },
  };
}

/* Every email the worker tries to send, captured rather than sent. The LINK is
   what a real person would click, so it is what the cases below use. */
let sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  sent.push({ url: String(url), body: String((opts && opts.body) || '') });
  return { ok: true, status: 200, json: async () => ({ id: 'em_1' }) };
};
const linkFromEmail = () => {
  for (let i = sent.length - 1; i >= 0; i--) {
    const m = sent[i].body.match(/reset\?token=([A-Za-z0-9]+)/);
    if (m) return m[1];
  }
  return '';
};

let env, ctx;
function reset(extra) {
  sent = [];
  env = Object.assign({
    AMV_KV: makeKV(), JWT_SECRET: 'test-jwt-secret', APP_URL: 'https://amv.test',
    EMAIL_API_KEY: 'em-key', RESET_EMAIL_FROM: 'AMV <no-reply@amv.test>',
  }, extra || {});
  ctx = { waitUntil() {}, passThroughOnException() {} };
}
const call = (path, body, ip) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip || '5.5.5.5' },
  body: JSON.stringify(body || {}),
}), env, ctx);

async function signup(email, password) {
  const r = await call('/auth/signup', { email, name: 'Locked', password });
  return (await r.json().catch(() => ({}))).token || '';
}
const login = async (email, password) => {
  const r = await call('/auth/login', { email, password, provider: 'email' });
  return { status: r.status, d: await r.json().catch(() => ({})) };
};

section('Somebody locked out asks for a link, and one is really sent');
{
  reset();
  await signup(USER, OLD);
  const r = await call('/auth/reset', { email: USER });
  const d = await r.json();
  ok(r.status === 200 && d.ok === true, 'the request is accepted', d);
  ok(d.sent === true, 'and the answer says an email really went out', d.sent);
  ok(sent.length > 0, 'because one did', sent.length);
  ok(!!linkFromEmail(), 'carrying a link with a token in it', !!linkFromEmail());
  ok(sent.some(s => s.body.includes(USER)), 'addressed to them', true);
}

section('The link works, and they can sign in with the new password');
{
  /* The whole point. Everything else in this file is about the ways it must
     not work; this is the one case a customer actually lives. */
  const token = linkFromEmail();
  const r = await call('/auth/reset/confirm', { token, password: NEW });
  ok(r.status === 200, 'the new password is accepted', r.status);

  const good = await login(USER, NEW);
  ok(good.status === 200 && !!good.d.token, 'and they are back in', good.status);

  const stale = await login(USER, OLD);
  ok(stale.status >= 400, 'while the old password no longer works', stale.status);
}

section('A link is single use');
{
  /* A reset link lives in an inbox, and inboxes get read by other people,
     forwarded, and left signed in on shared machines. One use is the whole
     protection. */
  reset();
  await signup(USER, OLD);
  await call('/auth/reset', { email: USER });
  const token = linkFromEmail();
  const first = await call('/auth/reset/confirm', { token, password: NEW });
  ok(first.status === 200, 'the first use works', first.status);
  const second = await call('/auth/reset/confirm', { token, password: 'Another-Passw0rd!7' });
  ok(second.status >= 400, 'the second is refused', second.status);
  const still = await login(USER, NEW);
  ok(still.status === 200,
     'and the password is the one the FIRST use set, not the second', still.status);
}

section('A made-up token is refused, and says nothing useful');
{
  reset();
  await signup(USER, OLD);
  const r = await call('/auth/reset/confirm', { token: 'not-a-real-token-at-all', password: NEW });
  const d = await r.json();
  ok(r.status >= 400, 'it is refused', r.status);
  ok(!/not found|no such|unknown user/i.test(d.error || ''),
     'without confirming whether any account matched', d.error);
  const stillOld = await login(USER, OLD);
  ok(stillOld.status === 200, 'and nothing about the account changed', stillOld.status);
}

section('Asking about an address that has no account looks identical');
{
  /* Otherwise this is a way to test whether somebody has an account here -
     which for a product people may not want to be seen using is its own
     disclosure, and for everybody else is a list for credential stuffing. */
  reset();
  await signup(USER, OLD);
  const known = await call('/auth/reset', { email: USER });
  const unknown = await call('/auth/reset', { email: 'nobody-at-all@example.com' });
  const kd = await known.json(), ud = await unknown.json();
  ok(known.status === unknown.status, 'the same status either way', { known: known.status, unknown: unknown.status });
  ok(kd.ok === ud.ok, 'and the same shape of answer', { kd, ud });
  ok(!('exists' in ud) && !/no account|not registered/i.test(JSON.stringify(ud)),
     'nothing in it says whether the account exists', ud);
}

section('The reset never carries the password anywhere');
{
  reset();
  await signup(USER, OLD);
  await call('/auth/reset', { email: USER });
  const all = JSON.stringify(sent);
  ok(!all.includes(OLD), 'the old password is not in the email', !all.includes(OLD));
  const token = linkFromEmail();
  await call('/auth/reset/confirm', { token, password: NEW });
  const stored = JSON.stringify([...env.AMV_KV._map.values()]);
  ok(!stored.includes(NEW),
     'and the new one is nowhere in storage, only its hash', !stored.includes(NEW));
}

section('With no email provider it says so, instead of pretending');
{
  /* The state a fresh deployment is in. Answering "check your inbox" when no
     inbox will ever receive anything leaves somebody waiting for a message
     that cannot arrive, and the operator with no idea it is happening. */
  reset({ EMAIL_API_KEY: '' });
  await signup(USER, OLD);
  const r = await call('/auth/reset', { email: USER });
  const d = await r.json();
  ok(d.ok === true, 'the request still succeeds, so it cannot be used to probe', d.ok);
  ok(d.sent === false,
     'but it does NOT claim an email was sent', d.sent);
  ok(sent.length === 0, 'and none was', sent.length);
}

section('It is rate limited, because it sends mail to whoever is named');
{
  /* An unauthenticated route that causes an email to a third party is a
     mail-bombing tool with somebody else's return address on it. */
  /* TWO limits, proven separately, because a flood from one address on one IP
     is stopped by either of them and a single assertion cannot tell which is
     doing the work. Deleting the per-address limit left that version passing
     on the per-IP one alone. */

  /* Burying ONE person: every request from a different address, so only the
     per-EMAIL limit can stop it. This is the shape that actually happens - a
     script with a proxy pool aimed at somebody's inbox. */
  reset();
  await signup(USER, OLD);
  let refusedPerson = 0;
  for (let i = 0; i < 12; i++) {
    const r = await call('/auth/reset', { email: USER }, '10.0.0.' + i);
    if (r.status === 429) refusedPerson++;
  }
  ok(refusedPerson > 0,
     'one person cannot be buried in reset emails from a spread of addresses', refusedPerson);
  ok(sent.length < 12, 'so most of them were never sent', sent.length);

  /* Working through a LIST: every request a different address, all from one
     caller, so only the per-IP limit can stop it. Nobody here has an account,
     which is the point - the route must not become a way to mail strangers. */
  reset();
  let refusedList = 0;
  for (let i = 0; i < 40; i++) {
    const r = await call('/auth/reset', { email: `victim${i}@elsewhere.test` }, '7.7.7.7');
    if (r.status === 429) refusedList++;
  }
  ok(refusedList > 0,
     'and one caller cannot work through a list of strangers', refusedList);
}

section('But a real person asking twice is not treated as an attack');
{
  /* The limit that protects the route must not break it. Somebody whose first
     email was slow asks again within a minute, every time, and a reset flow
     that refuses the second attempt has locked out the exact person it exists
     to let back in. */
  reset();
  await signup(USER, OLD);
  const first = await call('/auth/reset', { email: USER }, '4.4.4.4');
  const second = await call('/auth/reset', { email: USER }, '4.4.4.4');
  ok(first.status === 200, 'the first request works', first.status);
  ok(second.status === 200, 'and so does asking again', second.status);
  ok(sent.length === 2, 'both emails really went out', sent.length);

  /* And a shared office or a phone network is many people behind one address,
     so the per-IP allowance has to be looser than the per-person one. */
  reset();
  for (const who of ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']) {
    await signup(who, OLD);
    const r = await call('/auth/reset', { email: who }, '8.8.8.8');
    if (r.status !== 200) { ok(false, 'four colleagues behind one address all get through', who); break; }
  }
  ok(sent.length === 4, 'four different people on one connection are all served', sent.length);
}

globalThis.fetch = realFetch;
if (report('locked-out-and-back-in') > 0) process.exitCode = 1;
done();
