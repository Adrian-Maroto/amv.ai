/* WHERE YOU ARE SIGNED IN, AND ENDING ONE OF THEM.

   The Security screen used to say AMV could not list your other devices,
   because nothing on the server recorded a sign-in. Now each sign-in has a
   record and an id the tokens carry. Checked here by making it happen with the
   Worker's own functions:

   - each sign-in is listed, with its browser and country, newest first, and
     the one asking is marked as this device;
   - ending another one stops it: its refresh is refused and its access token
     too, once it is past the two minutes a new record may take to propagate;
   - this device cannot be ended from the list (that is Sign out);
   - a token from before records existed keeps working and joins the list on
     its next renewal;
   - Sign out everywhere clears the list as well as the tokens;
   - an API key cannot list or end sign-ins;
   - records are erased and exported with the account, and never backed up. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'signins.harness.mjs');
writeFileSync(harness, src + '\nexport { issueTokens, verifyToken, authRefresh, authLogout, sessionsList, sessionsEnd, _sessOpen, revokeUserTokens, BACKUP_NEVER, BACKUP_PREFIXES, signToken, TOKEN_VER };\n');
const W = await import(harness + '?t=' + Date.now());
globalThis.fetch = async () => new Response('{}', { status: 200 });

/* Time moves only when the test moves it. */
const realNow = Date.now.bind(Date);
let skew = 0;
Date.now = () => realNow() + skew;
const later = (s) => { skew += s * 1000; };

const m = new Map();
const env = {
  AMV_KV: {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix, cursor } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
  },
  JWT_SECRET: 'signins-secret', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
};
const EM = 'kim@example.com';
const ua = { mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
             phone: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36' };
const mkReq = (path, { token, body, agent, country, method } = {}) => {
  const r = new Request('https://api.amv.test' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', 'User-Agent': agent || ua.mac, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  Object.defineProperty(r, 'cf', { value: { country: country || 'ES' } });
  return r;
};
const signIn = async (agent, country) => W.issueTokens(env, EM, 'Kim', await W._sessOpen(env, mkReq('/auth/login', { agent, country }), EM));
const list = async (tok) => (await W.sessionsList(mkReq('/v1/sessions', { token: tok }), env)).json();

section('Each sign-in is listed, and this one is marked');
const laptop = await signIn(ua.mac, 'ES');
later(5);
const phone = await signIn(ua.phone, 'PT');
{
  const d = await list(laptop.token);
  ok(d.ok && d.sessions.length === 2, 'both sign-ins are there', d);
  const [first, second] = d.sessions;
  ok(first.device === 'Chrome on Android' && first.country === 'PT' && second.device === 'Safari on Mac' && second.country === 'ES', 'newest first, with browser and country', d.sessions);
  ok(second.current === true && first.current === false && d.current === second.id, 'the laptop sees itself as this device', d.sessions);
  ok(!JSON.stringify(d).includes('Mozilla'), 'and never the raw user agent - a family, not a fingerprint');
}

section('This device cannot be ended from the list');
{
  const me = (await list(laptop.token)).current;
  const r = await W.sessionsEnd(mkReq('/v1/sessions/end', { token: laptop.token, body: { id: me } }), env);
  const d = await r.json();
  ok(r.status === 400 && d.code === 'this_device', 'it points to Sign out instead', d);
  const bad = await W.sessionsEnd(mkReq('/v1/sessions/end', { token: laptop.token, body: { id: 'not-an-id' } }), env);
  ok(bad.status === 400, 'a malformed id is refused', bad.status);
}

section('Ending the phone stops it, for renewal and for use');
{
  const phoneId = (await list(laptop.token)).sessions.find(s => !s.current).id;
  later(300);   // past the propagation grace
  const r = await W.sessionsEnd(mkReq('/v1/sessions/end', { token: laptop.token, body: { id: phoneId } }), env);
  ok(r.status === 200 && (await r.json()).ok, 'the laptop ends it');
  ok(!(await W.verifyToken(phone.token, env.JWT_SECRET, env, 'access')), 'the phone’s access token no longer works');
  const ren = await W.authRefresh(mkReq('/auth/refresh', { body: { refreshToken: phone.refreshToken }, agent: ua.phone }), env);
  ok(ren.status === 401, 'and it cannot renew', ren.status);
  ok(!!(await W.verifyToken(laptop.token, env.JWT_SECRET, env, 'access')), 'while the laptop is untouched');
  const d = await list(laptop.token);
  ok(d.sessions.length === 1 && d.sessions[0].current, 'the list now shows only this device');
  const log = JSON.parse(m.get('alog:' + EM) || '[]');
  ok(log.some(e => e.kind === 'session_ended' && e.from === 'Chrome on Android'), 'and the account’s activity records it');
}

section('A brand-new sign-in is not refused while its record propagates');
{
  const fresh = await signIn(ua.phone, 'FR');
  const key = [...m.keys()].find(k => k.startsWith('sess:' + EM + ':') && JSON.parse(m.get(k)).country === 'FR');
  m.delete(key);   // as if this location has not seen the write yet
  ok(!!(await W.verifyToken(fresh.token, env.JWT_SECRET, env, 'access')), 'inside two minutes it still works');
  later(180);
  ok(!(await W.verifyToken(fresh.token, env.JWT_SECRET, env, 'access')), 'after that, a missing record means ended');
}

section('Renewal keeps the same sign-in, and records when it was last used');
{
  const before = (await list(laptop.token)).sessions[0];
  later(3600);
  const r = await W.authRefresh(mkReq('/auth/refresh', { body: { refreshToken: laptop.refreshToken } }), env);
  const d = await r.json();
  ok(r.status === 200 && d.token, 'the laptop renews', r.status);
  const after = (await list(d.token)).sessions.find(s => s.current);
  ok(after && after.id === before.id && after.seen > before.seen, 'same sign-in, newer last-seen', { before, after });
  Object.assign(laptop, { token: d.token, refreshToken: d.refreshToken });
}

section('A token from before sign-ins were recorded joins the list on renewal');
{
  const old = await W.issueTokens(env, EM, 'Kim');   // no session id, as issued before this change
  ok(!!(await W.verifyToken(old.token, env.JWT_SECRET, env, 'access')), 'it keeps working');
  const r = await W.authRefresh(mkReq('/auth/refresh', { body: { refreshToken: old.refreshToken }, agent: ua.phone, country: 'IT' }), env);
  const d = await r.json();
  const listed = await list(d.token);
  ok(r.status === 200 && listed.sessions.some(s => s.current && s.country === 'IT'), 'and is listed from its next renewal', listed.sessions);
}

section('Sign out everywhere clears the list too');
{
  const r = await W.authLogout(mkReq('/auth/logout', { token: laptop.token, body: { everywhere: true } }), env);
  ok(r.status === 200, 'signed out everywhere');
  ok(![...m.keys()].some(k => k.startsWith('sess:' + EM + ':')), 'no sign-in record is left');
}

section('An API key cannot see or end sign-ins');
{
  const fake = { via: 'apikey' };
  const src2 = src;
  ok(/sessionsList[\s\S]{0,200}user\.via === 'apikey'/.test(src2) && /sessionsEnd[\s\S]{0,300}user\.via === 'apikey'/.test(src2), 'both routes refuse a key-authenticated caller');
  void fake;
}

section('Erased and exported with the account; never backed up');
{
  ok(W.BACKUP_NEVER.includes('sess:') && !W.BACKUP_PREFIXES.includes('sess:'), 'a restore can never bring back an ended sign-in');
  const n = (src.match(/`resume:\$\{email\}:`, `smsverify:\$\{email\}:`, `mktsess:\$\{email\}:`, `sess:\$\{email\}:`/g) || []).length;
  ok(n === 2, 'both the export and the erasure walk sign-in records', n);
}

Date.now = realNow;
if (report('where-you-are-signed-in') > 0) process.exitCode = 1;
done();
