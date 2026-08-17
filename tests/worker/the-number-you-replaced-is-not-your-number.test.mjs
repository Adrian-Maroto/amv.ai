/* THE OLD PHONE STILL WORKED, AND THE SCREEN SAID IT DID NOT.

   Linking a phone writes two rows: `sms:user:<email>`, which is the number this
   account uses, and `sms:phone:<number>`, which is the row /sms/incoming reads
   to decide whose account a text belongs to. Changing your number overwrote the
   first and left the second exactly as it was.

   So the old number stayed linked. Not as a stale record nobody reads - as the
   authoritative one. Whoever has that handset can text AMV and be answered as
   you: spend your allowance, read what your assistant knows, ask it to do
   things on your behalf. And the reason people change a phone number is that
   they no longer control the old one. Lost it, sold it, left a shared family
   phone, left a job. AMV told them it was changed, and both of them worked.

   AND THE CODE THAT GUARDED IT (AMV-025). Three things:

   The verification code came from Math.random, which is a fast generator and
   not an unpredictable one - its state is recoverable from a few outputs, and
   the outputs are handed to whoever asks for a code. Ask three times for your
   own number and the next one sent to somebody else's is predictable.

   Nothing counted guesses. A six-digit code sounds like a million tries until
   there is no cap at all: it lives for ten minutes and the only limit was how
   fast requests could be sent.

   And "one account per number" was read at the top of the handler and enforced
   by a write at the bottom, so two accounts verifying the same number in the
   same minute both passed and the second write won - one number linked to two
   accounts, the loser's link silently gone. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'smsphone.harness.mjs');
writeFileSync(harness, src +
  '\nexport { smsRegister, issueTokens, _claimPhone, SMS_CODE_MAX_ATTEMPTS };\n');
const W = await import(harness + '?t=' + Date.now());

const TWILIO = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM_NUMBER: '+15550000000' };
const realFetch = globalThis.fetch;
let sentTexts = [];
globalThis.fetch = async () => { sentTexts.push(1); return { ok: true, status: 200, json: async () => ({}) }; };

function mkEnv() {
  const m = new Map(); const vals = new Map();
  return Object.assign({
    JWT_SECRET: 'x'.repeat(40),
    _map: m,
    AMV_KV: {
      _map: m,
      /* Real storage has latency, and without it two "concurrent" handlers here
         run one after the other - which makes a race test into a sequential one
         that passes on the race it was written for. */
      async get(k) { await new Promise(r => setTimeout(r, 1)); return m.has(k) ? m.get(k) : null; },
      async put(k, v) { await new Promise(r => setTimeout(r, 1)); m.set(k, String(v)); },
      async delete(k) { await new Promise(r => setTimeout(r, 1)); m.delete(k); },
      async list({ prefix } = {}) {
        return { keys: [...m.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'claim') { if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false })); vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true, owner: 'o' + Math.random() })); }
        if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ released: true })); }
        if (b.op === 'rateCheck') { const nx = cur + 1; vals.set(n, nx); return new Response(JSON.stringify({ allowed: nx <= (b.limit || 9999) })); }
        if (b.op === 'reserve') { const nx = cur + (b.amount || 0); if (nx > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur })); vals.set(n, nx); return new Response(JSON.stringify({ allowed: true, value: nx })); }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  }, TWILIO);
}
const tokFor = async (env, email) => (await W.issueTokens(env, email, 'U')).token;
const call = (env, body, token) => W.smsRegister(new Request('https://api.amv.dev/sms/register', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify(body),
}), env);
const read = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
const codeFor = (env, email, phone) => {
  const raw = env._map.get(`smsverify:${email}:${phone}`);
  return raw ? JSON.parse(raw).code : null;
};
/* Ask for a code and verify it, the way a person does. */
async function link(env, email, phone, token) {
  await read(await call(env, { phone }, token));
  return read(await call(env, { phone, code: codeFor(env, email, phone) }, token));
}

const A = '+15551110000', B = '+15552220000';

section('Linking a phone still works, which everything below is in service of');
{
  const env = mkEnv();
  const t = await tokFor(env, 'me@example.com');
  const pending = await read(await call(env, { phone: A }, t));
  ok(pending.body.pending === true, 'a code is sent and nothing is bound yet', pending.body);
  ok(!env._map.get(`sms:phone:${A}`), 'nothing is linked before the code is right', true);

  const done1 = await read(await call(env, { phone: A, code: codeFor(env, 'me@example.com', A) }, t));
  ok(done1.status === 200 && done1.body.verified === true, 'the right code links it', done1.body);
  ok(env._map.get(`sms:phone:${A}`) === 'me@example.com', 'and the inbound lookup points at them', env._map.get(`sms:phone:${A}`));
  ok(env._map.get('sms:user:me@example.com') === A, 'and the account points at the number', env._map.get('sms:user:me@example.com'));
}

section('THE FINDING: changing your number unlinks the old one');
{
  const env = mkEnv();
  const t = await tokFor(env, 'moved@example.com');
  await link(env, 'moved@example.com', A, t);
  ok(env._map.get(`sms:phone:${A}`) === 'moved@example.com', 'the first number is linked', true);

  const second = await link(env, 'moved@example.com', B, t);
  ok(second.status === 200 && second.body.verified === true, 'the new number is linked', second.body);
  ok(env._map.get(`sms:phone:${B}`) === 'moved@example.com', 'and the inbound lookup finds it', env._map.get(`sms:phone:${B}`));
  ok(env._map.get('sms:user:moved@example.com') === B, 'and the account points at the new one', env._map.get('sms:user:moved@example.com'));

  /* The whole point. Somebody with the old handset must be a stranger again. */
  ok(!env._map.get(`sms:phone:${A}`),
     'and the phone they no longer have is not linked to anything',
     env._map.get(`sms:phone:${A}`));
  ok(second.body.replaced === true, 'the answer says a number was replaced', second.body);
}

section('The old number stops being able to reach the account at all');
{
  /* Stated as the consequence rather than as the row, because the row is the
     mechanism and this is what it means: /sms/incoming reads sms:phone:<from>
     and answers as whoever it names. */
  const env = mkEnv();
  const t = await tokFor(env, 'switch@example.com');
  await link(env, 'switch@example.com', A, t);
  await link(env, 'switch@example.com', B, t);

  const whoIsOldPhone = env._map.get(`sms:phone:${A}`) || null;
  ok(whoIsOldPhone === null,
     'a text from the old handset belongs to nobody, so it is answered as a stranger', whoIsOldPhone);
  const whoIsNewPhone = env._map.get(`sms:phone:${B}`) || null;
  ok(whoIsNewPhone === 'switch@example.com', 'while the new one is them', whoIsNewPhone);
}

section('And it does not take somebody else’s number down with it');
{
  /* The obvious wrong fix: delete every row that mentions the old number. If
     the "old" number has since been claimed by somebody else, that unlinks a
     stranger's working phone. */
  const env = mkEnv();
  const mine = await tokFor(env, 'mine@example.com');
  const theirs = await tokFor(env, 'theirs@example.com');

  await link(env, 'mine@example.com', A, mine);
  /* Simulate the number genuinely changing hands: the first account gives it
     up, somebody else takes it. */
  env._map.delete(`sms:phone:${A}`);
  await link(env, 'theirs@example.com', A, theirs);
  ok(env._map.get(`sms:phone:${A}`) === 'theirs@example.com', 'the number now belongs to them', true);

  /* The first account moves to a new number. Its stale `sms:user` still says A. */
  await link(env, 'mine@example.com', B, mine);
  ok(env._map.get(`sms:phone:${A}`) === 'theirs@example.com',
     'and the other person’s link is untouched', env._map.get(`sms:phone:${A}`));
  ok(env._map.get(`sms:phone:${B}`) === 'mine@example.com', 'while the move still happened', true);
}

section('A code is worth five guesses, not a million');
{
  const env = mkEnv();
  const t = await tokFor(env, 'guessed@example.com');
  await read(await call(env, { phone: A }, t));
  const real = codeFor(env, 'guessed@example.com', A);

  const answers = [];
  for (let i = 0; i < 9; i++) answers.push(await read(await call(env, { phone: A, code: '000' + String(100 + i) }, t)));

  const spent = answers.filter(a => /attempt/.test(String(a.body.error || ''))).length;
  ok(spent === W.SMS_CODE_MAX_ATTEMPTS, 'five wrong guesses are counted', { spent, cap: W.SMS_CODE_MAX_ATTEMPTS });
  ok(answers[answers.length - 1].body.code === 'code_exhausted', 'and then it is over', answers[answers.length - 1].body);
  ok(answers[answers.length - 1].status === 429, 'said as a refusal to keep trying', answers[answers.length - 1].status);

  /* And the RIGHT code no longer works either, or the cap is decoration. */
  const late = await read(await call(env, { phone: A, code: real }, t));
  ok(late.status !== 200, 'the correct code is refused after the guesses ran out', late.status);
  ok(!env._map.get(`sms:phone:${A}`), 'so nothing was linked', env._map.get(`sms:phone:${A}`));
}

section('Guesses arriving together are still only five');
{
  /* AMV-018 on the reset code, again: a read, a compare, an increment and a
     write is four steps with three gaps, and guesses that arrive at once all
     read the same number and all decide they are under the limit. */
  const env = mkEnv();
  const t = await tokFor(env, 'burst@example.com');
  await read(await call(env, { phone: A }, t));

  const burst = await Promise.all(Array.from({ length: 20 },
    (_, i) => call(env, { phone: A, code: '11' + String(1000 + i) }, t).then(read)));
  const spent = burst.filter(a => /attempt/.test(String(a.body.error || ''))).length;
  ok(spent <= W.SMS_CODE_MAX_ATTEMPTS,
     'twenty at once still spend no more than the cap', { spent, cap: W.SMS_CODE_MAX_ATTEMPTS });
  ok(burst.some(a => a.body.code === 'code_exhausted'), 'and the rest are told it is over', true);
}

section('The code is unguessable, not merely random-looking');
{
  /* Math.random is a fast generator, not an unpredictable one. This cannot
     prove unpredictability from outputs - no test can - so it checks the two
     things that are checkable: that the generator in use is the cryptographic
     one, and that its output is not obviously degenerate. */
  const gen = codeOnly(functionBody(src, 'smsRegister') || '');
  ok(!/Math\.random/.test(gen), 'the verification code does not come from Math.random', true);
  ok(/_sixDigitCode\(\)/.test(gen), 'it comes from the same source the reset codes use', true);
  const six = codeOnly(functionBody(src, '_sixDigitCode') || '');
  ok(/crypto\.getRandomValues/.test(six), 'and that source is the cryptographic one', true);

  const env = mkEnv();
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const t = await tokFor(env, 'r' + i + '@example.com');
    await read(await call(env, { phone: '+1555' + String(3000000 + i) }, t));
    seen.add(codeFor(env, 'r' + i + '@example.com', '+1555' + String(3000000 + i)));
  }
  ok(seen.size >= 38, 'forty codes are forty different codes', seen.size);
  ok([...seen].every(c => /^\d{6}$/.test(c)), 'and every one is six digits', [...seen][0]);
}

section('Two accounts cannot both claim the same number');
{
  /* The check was at the top of the handler and the write was at the bottom.
     Both verify, both pass, the later write wins - and the loser's link is gone
     while the winner can text as them. */
  const env = mkEnv();
  const one = await tokFor(env, 'one@example.com');
  const two = await tokFor(env, 'two@example.com');
  await read(await call(env, { phone: A }, one));
  await read(await call(env, { phone: A }, two));
  const c1 = codeFor(env, 'one@example.com', A);
  const c2 = codeFor(env, 'two@example.com', A);
  ok(!!c1 && !!c2, 'both were sent a code, which is fine - a number can be typed by anybody', true);

  const [r1, r2] = await Promise.all([
    call(env, { phone: A, code: c1 }, one).then(read),
    call(env, { phone: A, code: c2 }, two).then(read),
  ]);
  const won = [r1, r2].filter(r => r.status === 200).length;
  ok(won === 1, 'exactly one of them gets the number', { one: r1.status, two: r2.status });
  const owner = env._map.get(`sms:phone:${A}`);
  ok(owner === 'one@example.com' || owner === 'two@example.com', 'and it belongs to a real account', owner);

  const loser = [r1, r2].find(r => r.status !== 200);
  ok(loser.status === 409, 'the other is told it is taken', loser.status);
  ok(/already linked/i.test(loser.body.error || ''), 'in words', loser.body.error);

  /* And the loser's own account is not left pointing at a number that answers
     as somebody else. */
  const loserEmail = owner === 'one@example.com' ? 'two@example.com' : 'one@example.com';
  ok(env._map.get(`sms:user:${loserEmail}`) !== A,
     'and the account that lost is not left claiming it', env._map.get(`sms:user:${loserEmail}`));
}

section('The claim is one row, decided where it is written');
{
  const claim = codeOnly(functionBody(src, '_claimPhone') || '');
  ok(claim.length > 100, 'the claim was read', claim.length);
  ok(/_withRecord\(env, 'smsphone'/.test(claim), 'it takes a lock', true);
  ok((claim.match(/AMV_KV\.put/g) || []).length === 1,
     'and writes exactly one row, so there is no second copy to disagree with it',
     (claim.match(/AMV_KV\.put/g) || []).length);

  const reg = codeOnly(functionBody(src, 'smsRegister') || '');
  ok(/_claimPhone\(env, phone, email\)/.test(reg), 'the handler claims rather than overwrites', true);
  ok(!/AMV_KV\.put\(`sms:phone:/.test(reg), 'and does not write that row itself', true);
  ok(/AMV_KV\.delete\(`sms:phone:\$\{previous\}`\)/.test(reg), 'the previous number is unlinked', true);
  const iClaim = reg.indexOf('_claimPhone');
  const iDrop = reg.indexOf('sms:phone:${previous}');
  ok(iClaim > -1 && iClaim < iDrop,
     'after the new one is safely claimed, so a failure between them leaves them reachable rather than locked out',
     { claim: iClaim, drop: iDrop });
}

globalThis.fetch = realFetch;
if (report('the-number-you-replaced-is-not-your-number') > 0) process.exitCode = 1;
done();
