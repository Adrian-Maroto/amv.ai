/* FOUR NUMBERS AND ONE DOOR, EACH WRONG IN THE DIRECTION THAT DOES NOT COMPLAIN.

   A number that is missing gets chased. A number that is quietly short gets
   believed, and every decision made on top of it is made on the short version.
   All four of these were short, and none of them said so.

     the month's cost   Chat books three counters: the daily ceiling, the
                        account's cost, and costtotal - the platform total the
                        founder dashboard reports and every margin on that
                        screen is derived from. _recordSpend, the only thing
                        that books image and video, booked the first two. So
                        the dearest call in the product, video at half a dollar
                        a go, never reached the profit figure. The ceiling had
                        this same blindness and it was fixed there; it stayed
                        here, where it is least visible, because a ceiling that
                        is too low announces itself and a cost that is too low
                        does not.

     the daily ceiling  _spendGate caught any counter error and returned null.
                        Failing open is the right call - refusing everybody
                        turns one unhappy component into a total outage - but
                        it failed open in silence: no audit, no alert, nothing
                        anywhere saying the one control that stops a runaway
                        bill was switched off. An operator would find out from
                        the invoice.

     a revoked session  _tokenEpoch caught any storage error and returned 0.
                        verifyToken compares the token's epoch to what comes
                        back, so while that read was failing, every token
                        issued before the first revocation matched and
                        verified. The two things that increment that epoch are
                        a password reset and signing out everywhere - so the
                        window it failed open in is exactly the window after a
                        compromise.

     what is owed       adminPayouts scanned until it held 5000 records, then
                        sorted by time and showed 500. KV lists in KEY order,
                        so the 5000 were an arbitrary slice; `owed` - the money
                        taken from sellers' balances that has not reached them,
                        the platform's liability - was summed over that slice
                        and under-reported without saying so.

   Exercised, not read. The counters are faked so the totals can be counted,
   the storage is made to throw so the fail-open paths actually run, and the
   answers are inspected for what they claim. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ownernumbers.harness.mjs');
writeFileSync(harness, src + '\nexport { _recordSpend, _spendGate, _tokenEpoch, verifyToken, adminPayouts, ADMIN_PAYOUT_SCAN_MAX, counter };\n');
const W = await import(harness + '?t=' + Date.now());

/* The Worker's counter() reaches a Durable Object bound as AMV_COUNTER, and
   the counter's NAME is what it derives the object id from - the payload
   carries only the operation. So the stub captures the name at idFromName and
   answers the op, which lets every increment be counted rather than inferred.

   counter() also swallows a DO failure and falls back to KV, which is a real
   behaviour and not one to stub around: to make a call genuinely unreachable,
   BOTH have to be unavailable, and that is what the blind-ceiling section
   below arranges. */
function counters() {
  const booked = [];
  const vals = new Map();
  let pending = '';
  const binding = {
    idFromName: (name) => { pending = name; return { name }; },
    get: (id) => ({
      fetch: async (_u, init) => {
        const name = id.name || pending;
        const op = JSON.parse(init.body);
        let r;
        if (op.op === 'incr') { booked.push({ name, amount: op.amount }); vals.set(name, (vals.get(name) || 0) + op.amount); r = { value: vals.get(name) }; }
        else if (op.op === 'checkCap') r = { allowed: (vals.get(name) || 0) < op.cap, value: vals.get(name) || 0 };
        else r = { value: vals.get(name) || 0 };
        return { ok: true, json: async () => r };
      },
    }),
  };
  return { booked, vals, binding, total: (re) => booked.filter(b => re.test(b.name)).reduce((n, b) => n + b.amount, 0) };
}

const KV_QUIET = { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) };
const envWith = (extra = {}) => Object.assign({ AMV_KV: KV_QUIET }, extra);

section('Image and video reach every counter chat reaches');
{
  const c = counters();
  await W._recordSpend(envWith({ AMV_COUNTER: c.binding }), 'someone@example.com', 0.5, 'video');
  const names = c.booked.map(b => b.name);
  ok(names.some(n => /^spend:/.test(n)), 'the daily ceiling is booked', names);
  ok(names.some(n => /^cost:someone@example\.com:/.test(n)), 'and the account it belongs to', names);
  ok(names.some(n => /^costtotal:/.test(n)),
     'AND the platform total the owner reads - the one that was missing', names);
  ok(c.total(/^costtotal:/) === 0.5,
     'for the full amount, not a share of it', c.total(/^costtotal:/));
}

section('So a month of video shows up in the month’s cost');
{
  /* The shape of the bug, priced. Ten videos and ten images is $5.40 of real
     provider spend; the owner's screen used to report $0.00 of it. */
  const c = counters();
  const env = envWith({ AMV_COUNTER: c.binding });
  for (let i = 0; i < 10; i++) await W._recordSpend(env, 'a@x.com', 0.50, 'video');
  for (let i = 0; i < 10; i++) await W._recordSpend(env, 'a@x.com', 0.04, 'image');
  const shown = c.total(/^costtotal:/);
  ok(Math.abs(shown - 5.40) < 0.001, 'the owner sees all of it', shown);
  ok(Math.abs(c.total(/^spend:/) - 5.40) < 0.001, 'and so does the ceiling', c.total(/^spend:/));
}

section('A ceiling that cannot be enforced says so');
{
  /* No Durable Object AND storage that throws: the call really cannot be made,
     which is the condition the fail-open path exists for. */
  const audits = [];
  const env = { AMV_KV: { get: async () => { throw new Error('KV unavailable'); },
                          put: async () => { throw new Error('KV unavailable'); } } };
  const realLog = console.log;
  console.log = (...a) => { audits.push(String(a[0] || '') + ' ' + JSON.stringify(a[1] || '')); };
  const paid = await W._spendGate(env, { email: 'p@x.com', plan: 'ultra' }, 'video');
  const free = await W._spendGate(env, { email: 'f@x.com', plan: 'free' }, 'video');
  console.log = realLog;

  ok(paid === null, 'paid work still goes ahead, because a blind counter is not a reason to refuse a customer', paid);
  const freeBody = free ? await free.json() : null;
  ok(free !== null && freeBody && freeBody.code === 'free_capacity',
     'free work stops while nobody can count, so the unbounded window costs the least it can', freeBody);
  ok(audits.some(a => /spend_gate_blind/.test(a)),
     'and it is written down rather than passing in silence', audits.slice(0, 2));
}

section('A storage failure does not hand back a revoked session');
{
  const badEnv = { AMV_KV: { get: async () => { throw new Error('KV unavailable'); } } };
  let threw = false;
  try { await W._tokenEpoch(badEnv, 'a@x.com'); } catch (e) { threw = true; }
  ok(threw, 'a failed read is an error, not the answer zero', threw);

  /* And the caller refuses on it rather than letting the throw escape as a
     500 or, worse, being caught somewhere that treats it as "no revocation on
     record". verifyToken already wraps its work, so the throw lands as "not a
     valid token" - which is the safe answer. */
  const verdict = await W.verifyToken('not.a.token', 'secret', badEnv);
  ok(verdict === null, 'and a token checked while storage is failing is refused', verdict);

  /* The other direction, so this is not just asserting that everything fails:
     a healthy read still returns the number it read. */
  const good = await W._tokenEpoch({ AMV_KV: { get: async () => '7' } }, 'a@x.com');
  ok(good === 7, 'while a read that worked returns what it found', good);
}

section('A payout total that had to stop early admits it');
{
  /* More records than the scan will read. Every one of them is pending, so a
     complete answer would be much larger than the truncated one - which is
     the whole point: the direction of the error makes the business look like
     it owes less than it does. */
  const N = W.ADMIN_PAYOUT_SCAN_MAX + 1500;
  const keys = Array.from({ length: N }, (_, i) => ({ name: 'withdraw:' + String(i).padStart(6, '0') }));
  let served = 0;
  const env = envWith({
    ADMIN_TOKEN: 'tok',
    AMV_KV: {
      list: async ({ cursor }) => {
        const from = +(cursor || 0);
        const slice = keys.slice(from, from + 1000);
        const next = from + slice.length;
        return { keys: slice, list_complete: next >= keys.length, cursor: String(next) };
      },
      get: async () => { served++; return JSON.stringify({ amount: 10, status: 'pending', ts: served }); },
      put: async () => {}, delete: async () => {},
    },
  });
  const req = new Request('https://x/admin/payouts', { headers: { Authorization: 'Bearer tok' } });
  const res = await W.adminPayouts(req, env);
  const d = await res.json();

  ok(d.truncated === true, 'the answer says the scan stopped short', d.truncated);
  ok(typeof d.note === 'string' && /floor|more/i.test(d.note),
     'in words, not only as a flag - a screen has to be able to show it', d.note);
  ok(d.scanned >= W.ADMIN_PAYOUT_SCAN_MAX,
     'and says how much it did read', { scanned: d.scanned, limit: W.ADMIN_PAYOUT_SCAN_MAX });
  ok(d.owed > 0, 'the liability it can see is still reported', d.owed);
  ok(d.owed < N * 10,
     'and it is genuinely short of the truth, which is exactly why saying so matters',
     { reported: d.owed, actual: N * 10 });
}

section('A complete scan does not cry truncation');
{
  /* The other half. A flag that is always set is the same as no flag. */
  const keys = Array.from({ length: 12 }, (_, i) => ({ name: 'withdraw:' + i }));
  const env = envWith({
    ADMIN_TOKEN: 'tok',
    AMV_KV: {
      list: async () => ({ keys, list_complete: true }),
      get: async () => JSON.stringify({ amount: 7, status: 'pending', ts: 1 }),
      put: async () => {}, delete: async () => {},
    },
  });
  const res = await W.adminPayouts(new Request('https://x/admin/payouts', { headers: { Authorization: 'Bearer tok' } }), env);
  const d = await res.json();
  ok(d.truncated === false, 'a scan that read everything says so', d.truncated);
  ok(d.note === undefined, 'and carries no warning it does not need', d.note);
  ok(d.owed === 84, 'while the total is simply right', d.owed);
}

if (report('the-numbers-the-owner-reads-are-the-whole-bill') > 0) process.exitCode = 1;
done();
