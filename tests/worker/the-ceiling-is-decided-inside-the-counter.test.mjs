/* THE CEILING IS DECIDED IN A PLACE NO TEST HAD EVER RUN.

   Every dollar limit in AMV ends at one `if` inside the AMVCounter Durable
   Object:

       if (next > body.cap) return json({ allowed: false, value: cur });

   That line is what stands between a customer and an unbounded bill, and
   between AMV and a daily spend it never agreed to. Eight suites are about
   money ceilings. All of them were driving a TEST DOUBLE.

   The double is honest about being one - `a-ceiling-that-twenty-requests-
   cannot-walk-through` opens its helper with "a counter that behaves like the
   Durable Object" - and it is the right tool for what that suite asks: given a
   counter that is correct, do the CALLERS compose correctly, do they reserve
   before they spend, do they settle the difference instead of charging twice.
   Those are real questions and it answers them well.

   But it means the sentence being tested was "the callers are right", and the
   sentence nobody tested was "the counter is right". Deleting the cap check
   from the real Durable Object broke no suite in this repository. Nor did
   letting a reservation be NEGATIVE, which does not merely bypass the ceiling -
   it hands the account free budget, because a negative booking lowers the
   total everybody else is measured against. Nor did removing the clamp that
   stops a refund driving the counter below zero, which is the same gift by a
   different door.

   The one suite that DOES construct the real object drives `claim` and
   `release` - and its single `reserve` call deliberately uses an env whose
   Durable Object is unreachable, so it exercises the FALLBACK inside
   `counter()` rather than this branch. A reasonable reader would have counted
   that as coverage of reserve. It is coverage of the opposite path.

   So this suite drives the real thing, for the ops that guard money, and
   asserts the two directions that matter at every boundary: what is refused,
   and that a refusal DID NOT BOOK. A ceiling that refuses the call and charges
   for it anyway is worse than no ceiling, because the money moves and the
   audit says it was stopped. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'realcounter.harness.mjs');
writeFileSync(harness, src + '\nexport { counter };\n');
const W = await import(harness + '?t=' + Date.now());

/* The REAL class. Storage is a Map because a Durable Object's storage is a
   key-value store with serialized access, which is what a Map under one
   awaited call gives - but every op below goes through `fetch`, so the code
   under test is the shipped code path, not a re-implementation of it. */
function mkDO() {
  const store = new Map();
  let alarms = 0;
  const state = { storage: {
    async get(k) { return store.has(k) ? store.get(k) : undefined; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async deleteAll() { store.clear(); },
    async setAlarm() { alarms++; },
  } };
  const obj = new W.AMVCounter(state, {});
  obj.__store = store;
  obj.__alarms = () => alarms;
  return obj;
}
/* ONE OP AT A TIME, BECAUSE THAT IS THE RUNTIME'S GUARANTEE AND THE CODE
   RELIES ON IT.

   A Durable Object does not run two events concurrently while storage is in
   flight - that is what makes a read-modify-write inside one handler safe, and
   the handler is written on that assumption. A Map-backed emulation does NOT
   give it for free: `await store.get()` yields to the microtask queue, so
   twenty overlapping fetches would all read the same value and all write 1
   back. That would be an artefact of the emulation, not a finding about AMV.

   So the queue below reproduces the guarantee rather than hiding its absence.
   Being straight about what that buys: the sequential assertions above are the
   ones testing the branch logic. The concurrent one tests that the handler's
   arithmetic is correct GIVEN serialized delivery - it is not a proof of
   atomicity in production, which belongs to the platform. It is here because
   the cap check and the increment must stay in the same handler; anything that
   moved the decision outside it would fail here. */
let queue = Promise.resolve();
const call = (obj, payload) => {
  const run = async () => JSON.parse(await (await obj.fetch(new Request('https://do/counter', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }))).text());
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
};
const valueOf = (obj) => call(obj, { op: 'get' }).then(r => r.value);

section('A reservation that fits is booked, exactly');
{
  const c = mkDO();
  const a = await call(c, { op: 'reserve', amount: 3, cap: 10 });
  ok(a.allowed === true, 'a reservation under the cap is allowed', a.allowed);
  ok(a.value === 3, 'and the counter holds exactly what was booked', a.value);

  const b = await call(c, { op: 'reserve', amount: 4, cap: 10 });
  ok(b.allowed === true, 'a second one that still fits is allowed', b.allowed);
  ok(b.value === 7, 'and the total is the sum, not the latest', b.value);
}

section('A reservation landing exactly on the cap is allowed');
{
  /* The comment in the Worker says so explicitly - "reserving up to exactly the
     cap is allowed" - and it is the difference between a $10 ceiling meaning
     ten dollars and meaning nine-dollars-ninety-nine. */
  const c = mkDO();
  const r = await call(c, { op: 'reserve', amount: 10, cap: 10 });
  ok(r.allowed === true, 'the call that lands on the ceiling gets through', r.allowed);
  ok(r.value === 10, 'and the counter sits on it', r.value);

  const after = await call(c, { op: 'reserve', amount: 0.01, cap: 10 });
  ok(after.allowed === false, 'the next cent is refused', after.allowed);
  const stillTen = await valueOf(c);
  ok(stillTen === 10, 'and the refusal did not book the cent', stillTen);
}

section('A reservation that would exceed the cap is refused AND books nothing');
{
  /* AMV-017. The original refused only when the counter was ALREADY over,
     which let the last reservation overshoot by its own size - so a $10
     ceiling with $9.99 spent admitted a $40 call. Both halves are asserted,
     because a refusal that still increments is the worse failure: the bill
     grows and the response says it was stopped. */
  const c = mkDO();
  await call(c, { op: 'reserve', amount: 9.99, cap: 10 });
  const over = await call(c, { op: 'reserve', amount: 40, cap: 10 });
  ok(over.allowed === false, 'the call that would overshoot is refused', over.allowed);
  ok(over.value === 9.99, 'the reported value is what is still booked, not the attempt', over.value);
  const unchanged = await valueOf(c);
  ok(unchanged === 9.99, 'and nothing was added by the refusal', unchanged);
}

section('A NEGATIVE reservation is refused - it would hand out free budget');
{
  /* Not merely a bypass. `next = cur + amount` with a negative amount LOWERS
     the total every other caller is measured against, so one crafted
     reservation buys headroom for everybody on that counter. It has to be
     refused at the object, because the object is the only place that sees the
     arithmetic. */
  const c = mkDO();
  await call(c, { op: 'reserve', amount: 5, cap: 10 });
  const neg = await call(c, { op: 'reserve', amount: -100, cap: 10 });
  ok(neg.allowed === false, 'a negative reservation is refused', neg.allowed);
  const afterNeg = await valueOf(c);
  ok(afterNeg === 5, 'and the counter did not move', afterNeg);

  const tiny = await call(c, { op: 'reserve', amount: -0.01, cap: 10 });
  ok(tiny.allowed === false, 'so is a negative cent', tiny.allowed);
  const afterTiny = await valueOf(c);
  ok(afterTiny === 5, 'the counter still did not move', afterTiny);
}

section('Only a real, non-negative number can book anything');
{
  /* WHAT THE GUARD CAN ACTUALLY SEE, WHICH IS NOT WHAT IT LOOKS LIKE.

     The guard is `!Number.isFinite(amount) || amount < 0`, so the obvious test
     is to send NaN and Infinity. Neither can arrive. JSON has no
     representation for them - `JSON.stringify(NaN)` is the text `null` - and
     every caller reaches this object through a JSON body, so they become null
     on the way in. `Number(null)` is 0, and a zero booking is correct to
     allow.

     Nor is `Number()` narrow about the rest: '' and [] are also 0, and `true`
     is 1. So a handful of nonsense inputs are ALLOWED and book a small finite
     amount rather than being refused.

     That is safe, and the reason is the cap rather than the coercion: whatever
     `amount` becomes, it is still checked against the ceiling by the same
     branch, so the worst a coerced input can do is book its own tiny value
     inside a limit that already holds. The only coercion that would be
     dangerous is one producing a NEGATIVE number, because that lowers the
     total everybody else is measured against - and that is refused, above.

     Two earlier drafts of this section asserted refusals that do not happen,
     which would have reported a defect in code that is right. The assertions
     below are what the object actually guarantees, which is the useful
     sentence: nothing UNQUANTIFIABLE books, and nothing negative books. */
  const c = mkDO();
  for (const amount of ['lots', 'NaN', {}, undefined]) {
    const r = await call(c, { op: 'reserve', amount, cap: 10 });
    ok(r.allowed === false,
       JSON.stringify(amount === undefined ? 'absent' : amount) + ' cannot book', r.allowed);
  }
  const nothing = await valueOf(c);
  ok(nothing === 0, 'and none of the unquantifiable ones booked anything', nothing);

  /* Stated rather than left to be rediscovered, so a later reader does not
     "fix" these into refusals and break a caller that sends no amount. */
  const asNull = await call(c, { op: 'reserve', amount: null, cap: 10 });
  ok(asNull.allowed === true, 'a null amount is a zero booking, not an error', asNull.allowed);
  const afterNull = await valueOf(c);
  ok(afterNull === 0, 'and it books nothing', afterNull);
}

section('Concurrent reservations cannot walk through the ceiling together');
{
  /* The race the Durable Object exists to close, driven against the real one.
     Twenty callers each asking for 1 against a cap of 10: exactly ten may pass,
     whatever order they arrive in, because the compare and the increment happen
     together inside one serialized object. */
  const c = mkDO();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => call(c, { op: 'reserve', amount: 1, cap: 10 })));
  const allowed = results.filter(r => r.allowed).length;
  ok(allowed === 10, 'exactly ten of twenty concurrent reservations are allowed', allowed);
  const landed = await valueOf(c);
  ok(landed === 10, 'and the counter lands on the cap, not past it', landed);
}

section('A cap of zero admits nothing');
{
  const c = mkDO();
  const r = await call(c, { op: 'reserve', amount: 0.01, cap: 0 });
  ok(r.allowed === false, 'a zero ceiling refuses a cent', r.allowed);
  const zero = await valueOf(c);
  ok(zero === 0, 'and books nothing', zero);
  const z = await call(c, { op: 'reserve', amount: 0, cap: 0 });
  ok(z.allowed === true, 'a zero-cost call is not refused by a zero ceiling', z.allowed);
}

section('A refund cannot drive the counter below zero');
{
  /* `Math.max(0, ...)` in incr. Without it a refund larger than what was spent
     leaves a NEGATIVE total, and a negative total is free budget for everybody
     measured against that counter - the same gift as the negative reservation,
     through the other door. Release paths are best-effort and never throw, so
     a double release is a thing that really happens. */
  const c = mkDO();
  await call(c, { op: 'incr', amount: 5 });
  const back = await call(c, { op: 'incr', amount: -3 });
  ok(back.value === 2, 'an ordinary refund subtracts', back.value);

  const past = await call(c, { op: 'incr', amount: -100 });
  ok(past.value === 0, 'a refund past zero clamps at zero', past.value);
  const stored = await valueOf(c);
  ok(stored === 0, 'and the stored value is zero, not negative', stored);

  const again = await call(c, { op: 'incr', amount: -100 });
  ok(again.value === 0, 'and again, so a double release cannot go negative', again.value);

  const up = await call(c, { op: 'incr', amount: 1 });
  ok(up.value === 1, 'the counter still counts up from zero afterwards', up.value);
}

section('The ceiling reads the value a reservation left behind');
{
  /* The reservation and the ceiling have to be looking at the same number, or
     the booking is invisible to the thing it exists to inform. */
  const c = mkDO();
  await call(c, { op: 'reserve', amount: 7, cap: 10 });
  const under = await call(c, { op: 'checkCap', cap: 10 });
  ok(under.allowed === true, 'a ceiling above the booked total still allows', under.allowed);
  const at = await call(c, { op: 'checkCap', cap: 7 });
  ok(at.allowed === false, 'a ceiling the booking has reached refuses', at.allowed);
  ok(at.value === 7, 'and reports the booked total', at.value);
}

if (report('the-ceiling-is-decided-inside-the-counter') > 0) process.exitCode = 1;
done();
