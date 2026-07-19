/* SMS SECURITY (AMV-033).

   AMV-033  a phone could be linked to an account with NO verification (unsolicited
            SMS + hijack of a victim's number), and inbound webhooks FAILED OPEN
            when TWILIO_AUTH_TOKEN was unset (forged requests ran the AI agent). */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'sms-security.harness.mjs');
writeFileSync(harness, src + '\nexport { smsRegister, smsIncoming, issueTokens };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const twilio = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM_NUMBER: '+15550000000' };
const mkEnv = (extra = {}) => ({
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
  },
  ...extra,
});
const tok = async (env, email) => (await W.issueTokens(env, email, 'U')).token;
const jreq = (body, token) => new Request('https://api.amv.dev/sms/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
const jget = async (r) => { try { return await r.json(); } catch { return {}; } };

/* ── AMV-033: binding requires a verified one-time code ─────────────────── */
section('AMV-033: phone binding requires SMS verification');
{
  store.clear();
  const env = mkEnv(twilio);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });   // stub Twilio send
  const aliceTok = await tok(env, 'alice@x.com');
  // step 1: no code -> a verification code is sent, nothing is bound yet
  let r = await W.smsRegister(jreq({ phone: '+15551234567' }, aliceTok), env);
  let d = await jget(r);
  ok(d.pending === true, 'step 1 sends a code and does not bind (pending)');
  const vkeys = [...store.keys()].filter(k => k.startsWith('smsverify:'));
  ok(vkeys.length === 1, 'a verification code was stored');
  ok(![...store.keys()].some(k => k.startsWith('sms:phone:')), 'the phone is NOT linked before verification');
  const code = store.get(vkeys[0]);
  // step 2 wrong code -> rejected
  r = await W.smsRegister(jreq({ phone: '+15551234567', code: '000000' }, aliceTok), env);
  ok(r.status === 401, 'a wrong code is rejected');
  // step 2 correct code -> bound
  r = await W.smsRegister(jreq({ phone: '+15551234567', code }, aliceTok), env);
  d = await jget(r);
  ok(r.status === 200 && d.verified === true, 'the correct code binds the phone');
  ok([...store.keys()].some(k => k.startsWith('sms:phone:')), 'the phone is now linked');
  globalThis.fetch = realFetch;
}

/* ── AMV-033: a number already linked to another account can't be taken ─── */
section('AMV-033: one account per phone (no hijack)');
{
  const env = mkEnv(twilio);
  const malloryTok = await tok(env, 'mallory@x.com');
  const r = await W.smsRegister(jreq({ phone: '+15551234567' }, malloryTok), env);
  ok(r.status === 409, "another account cannot start linking someone else's already-linked number");
}

/* ── AMV-033: inbound webhook fails closed without a Twilio token ───────── */
section('AMV-033: inbound SMS webhook fails closed');
{
  const form = new URLSearchParams({ From: '+15551234567', Body: 'hello' });
  const smsReq = () => new Request('https://api.amv.dev/sms/incoming', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  // no TWILIO_AUTH_TOKEN -> reject (do not run the agent on an unauthenticated request)
  let r = await W.smsIncoming(smsReq(), mkEnv({}));
  ok(r.status === 403, 'an inbound webhook with no Twilio token configured is rejected (fail closed)', r.status);
  // token set but no/invalid signature -> reject
  r = await W.smsIncoming(smsReq(), mkEnv(twilio));
  ok(r.status === 403, 'an inbound webhook with an invalid signature is rejected', r.status);
}

if (report() > 0) process.exitCode = 1;
done();
