/* SMS SECURITY (AMV-033).

   AMV-033  a phone could be linked to an account with NO verification (unsolicited
            SMS + hijack of a victim's number), and inbound webhooks FAILED OPEN
            when TWILIO_AUTH_TOKEN was unset (forged requests ran the AI agent). */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'sms-security.harness.mjs');
writeFileSync(harness, src + '\nexport { smsRegister, smsIncoming, issueTokens, setEntitlement, counter, monthKey, FREE_AUTO_CEILING_USD };\n');
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
  /* Stored as a record now rather than a bare string, because the attempt
     counter has to live somewhere (AMV-025). */
  const code = JSON.parse(store.get(vkeys[0])).code;
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

/* A free account still spends real money on every inbound message: each one
   runs an agent turn. The ceiling was skipped entirely when the plan price was
   zero, which is precisely the case that had no other dollar bound - only 200
   messages a day per number, each of them a model call. */
section('Texting has a dollar ceiling on every plan, including the free one');
{
  store.clear();
  const env = mkEnv(twilio);
  await W.setEntitlement(env, 'freebie@x.com', 'free');
  await env.AMV_KV.put('sms:phone:+15559990000', 'freebie@x.com');

  /* Push the account past what the free plan covers, then send. A signed
     request is not needed to prove the ceiling holds - it is needed to get
     past the signature check - so this drives the counter directly and
     asserts the guard reads it. */
  await W.counter(env, `cost:freebie@x.com:${W.monthKey()}`,
    { op: 'incr', amount: W.FREE_AUTO_CEILING_USD * 4, ttlMs: 86400000 });
  const spent = (await W.counter(env, `cost:freebie@x.com:${W.monthKey()}`, { op: 'get' })).value;
  ok(spent > W.FREE_AUTO_CEILING_USD, 'the free account is over what its plan covers', spent);

  const cap = await W.counter(env, `cost:freebie@x.com:${W.monthKey()}`,
    { op: 'checkCap', cap: W.FREE_AUTO_CEILING_USD });
  ok(cap.allowed === false, 'so the ceiling the handler checks refuses it', cap);

  ok(W.FREE_AUTO_CEILING_USD > 0,
     'and a free ceiling is a real number rather than zero, so one text still works', W.FREE_AUTO_CEILING_USD);

  const srcTxt = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  ok(!/if \(price > 0\) \{\s*\n\s*const capRes/.test(srcTxt),
     'the handler no longer skips the check when the plan price is zero');
  /* THE PROPERTY, NOT THE SPELLING. This matched the literal text of the
     arithmetic while it lived inline in the chat handler, and again when SMS
     kept its own copy. Both moves - into _monthlyCeiling, then into _spendGate
     - broke the match while the backstop being guarded was untouched. A rule
     written against a spelling fails on a correct fix and passes on a
     regression that keeps the words (LESSONS #203). So it is asked of the
     handler and then of what the handler delegates to. */
  const smsFn = codeOnly(functionBody(srcTxt, 'smsIncoming'));
  ok(/_spendGate\(env, user, 'sms'/.test(smsFn),
     'it asks the shared gate instead - the same one every other spending path uses', true);
  ok(/fallbackCeilingUSD: FREE_AUTO_CEILING_USD/.test(smsFn),
     'with the free ceiling as the fallback when there is no plan or family limit at all', true);
  const gate = codeOnly(functionBody(srcTxt, '_spendGate'));
  ok(/_monthlyCeiling\(user\)/.test(gate),
     'and that gate reads the shared ceiling, so a parent\u2019s limit reaches a text message', true);
  ok(/cost:\$\{user\.billingSubject \|\| user\.email\}/.test(gate),
     'and charges it to the account or team that is actually paying', true);
}

if (report() > 0) process.exitCode = 1;
done();
