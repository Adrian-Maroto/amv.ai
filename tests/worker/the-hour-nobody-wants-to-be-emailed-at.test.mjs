/* THE BOUND WITH NO PRODUCER.

   The policy engine has understood quiet hours since it was written - it
   refuses with "It is your quiet hours, so I held this rather than acting".
   Nothing ever passed `in_quiet_hours: true`, so that branch had never once
   been taken. A bound nobody can set is the same defect as a setting nobody
   reads, from the other end.

   And it has to be enforced by the SERVER, because the hour this protects is
   exactly the hour AMV is closed. A quiet window the browser enforces does
   nothing on the night it was set for.

   Two things this suite is really about:

     - MIDNIGHT. 23 to 7 is the normal window and the one a naive range check
       gets wrong by covering nothing at all.
     - DAYLIGHT SAVING. Storing the window in UTC looks right and drifts by an
       hour twice a year, so somebody's quiet hours silently move when the
       clocks do. The zone is stored with the window and the hour is read in
       that zone. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'quiet.harness.mjs');
writeFileSync(harness, src + `
export { _quietNow, _quietEndsAt, _quietLocalHour, runDueAutomations, autoUpdate };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

/* A moment expressed as a wall clock in a named zone, so the assertions read
   as the time somebody would actually see. */
const at = (iso) => Date.parse(iso);
const LDN = 'Europe/London';

section('A window that crosses midnight is the normal case');
{
  const q = { from: 23, to: 7, tz: 'UTC' };
  ok(W._quietNow(q, at('2026-01-15T23:30:00Z')) === true, 'quiet at 23:30', true);
  ok(W._quietNow(q, at('2026-01-16T03:00:00Z')) === true, 'quiet at 03:00, the next day', true);
  ok(W._quietNow(q, at('2026-01-16T06:59:00Z')) === true, 'quiet at 06:59', true);
  ok(W._quietNow(q, at('2026-01-16T07:00:00Z')) === false,
     'and working again at 07:00 - the end is exclusive, or the window is an hour longer than it reads', true);
  ok(W._quietNow(q, at('2026-01-16T12:00:00Z')) === false, 'and plainly not quiet at noon', true);
}

section('A window inside one day works too');
{
  const q = { from: 9, to: 17, tz: 'UTC' };
  ok(W._quietNow(q, at('2026-01-15T12:00:00Z')) === true, 'quiet at noon', true);
  ok(W._quietNow(q, at('2026-01-15T08:59:00Z')) === false, 'not at 08:59', true);
  ok(W._quietNow(q, at('2026-01-15T17:00:00Z')) === false, 'not at 17:00', true);
}

section('The hour is the one on the clock where the person is');
{
  /* July: London is BST, an hour ahead of UTC. 22:30 UTC is 23:30 there, and
     a window stored in UTC would have missed it. */
  const q = { from: 23, to: 7, tz: LDN };
  ok(W._quietLocalHour(LDN, at('2026-07-15T22:30:00Z')) === 23,
     'a summer evening reads as 23:00 in London when it is 22:30 UTC', true);
  ok(W._quietNow(q, at('2026-07-15T22:30:00Z')) === true, 'so it is quiet', true);

  /* January: London is UTC. The same 22:30 is 22:30 there, and NOT quiet. */
  ok(W._quietLocalHour(LDN, at('2026-01-15T22:30:00Z')) === 22, 'and as 22:00 in winter', true);
  ok(W._quietNow(q, at('2026-01-15T22:30:00Z')) === false,
     'so the same instant is not quiet - which is the whole reason the zone is stored', true);
}

section('A window nobody set does not silence anything');
{
  ok(W._quietNow(null, Date.now()) === false, 'no window', true);
  ok(W._quietNow({}, Date.now()) === false, 'an empty one', true);
  ok(W._quietNow({ from: 23, to: 23, tz: 'UTC' }, at('2026-01-15T23:30:00Z')) === false,
     'and a zero-length one is no window - reading it as "always" would switch somebody off entirely', true);
  ok(W._quietNow({ from: -1, to: 40, tz: 'UTC' }, Date.now()) === false, 'nor do impossible hours', true);
}

section('An unreadable zone does not silence either');
{
  /* The fallback runs the OTHER WAY from the approval deadline, on purpose.
     An unreadable expiry refuses, because sending something of unknown age is
     worse than a re-run. An unreadable quiet window does not silence, because
     a job that stops running and says nothing is far harder to notice than one
     email at an awkward hour. Fall towards the mistake somebody can see. */
  ok(W._quietLocalHour('Not/AZone', Date.now()) === null, 'the zone is rejected rather than guessed', true);
  ok(W._quietNow({ from: 23, to: 7, tz: 'Not/AZone' }, at('2026-01-15T23:30:00Z')) === false,
     'so the job runs rather than going silently missing', true);
}

section('The end of the window is a real time');
{
  const q = { from: 23, to: 7, tz: 'UTC' };
  const end = W._quietEndsAt(q, at('2026-01-15T23:30:00Z'));
  ok(W._quietNow(q, end) === false, 'it lands outside the window', new Date(end).toISOString());
  ok(end > at('2026-01-16T06:00:00Z') && end <= at('2026-01-16T08:00:00Z'),
     'and close to when the window actually ends, not a day later', new Date(end).toISOString());
}

section('The tick holds a due job instead of running it');
{
  const EMAIL = 'sleeper@test.com';
  const store = new Map();
  const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k, v){ store.set(k, v); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
  } };
  let modelCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { modelCalls++; return new Response(JSON.stringify({ content:[{text:'x'}], usage:{} }), { status: 200 }); };

  const due = Date.now() - 60000;
  /* A 23-hour window that starts at the hour this suite is running, so it
     always covers "now" whatever time of day that is - the alternative is a
     test that passes at 2am and fails at 2pm. `from: 0, to: 23` looks like it
     covers the day and leaves 23:00 uncovered, which is exactly that flake. */
  const h = new Date().getUTCHours();
  await env.AMV_KV.put('auto:' + EMAIL, JSON.stringify({
    quiet: { from: h, to: (h + 23) % 24, tz: 'UTC' },
    items: [{ id:'q1', detail:'nightly note', repeat:'daily', interval:86400000,
              next: due, kind:'task', approval:'auto', notify:'app', active:true, runs:0 }],
    results: [] }));

  await W.runDueAutomations(env);
  ok(modelCalls === 0, 'nothing ran, so nothing was spent at 3am', modelCalls);

  const after = JSON.parse(store.get('auto:' + EMAIL)).items[0];
  ok(after.next > Date.now(),
     'and it is booked for later rather than left in the past, where it would fire the moment the window closed', after.next);
  ok(after.heldUntil === after.next,
     'the record says it was held and until when, so the row can say so rather than going quiet about going quiet',
     after.heldUntil);
  /* NOT `lastError`. The screen prefixes that field with "Last run:", and a
     held job did not have a run - and writing there would also have destroyed
     a real error recorded the last time it did. */
  ok(!/quiet/i.test(String(after.lastError || '')),
     'and it does not describe the deferral as the outcome of a run', after.lastError);
  ok((after.runs || 0) === 0, 'and it does not count as a run', after);

  /* The morning after: the window is gone and the same record comes due. */
  const rec2 = JSON.parse(store.get('auto:' + EMAIL));
  rec2.quiet = null; rec2.items[0].next = Date.now() - 60000;
  await env.AMV_KV.put('auto:' + EMAIL, JSON.stringify(rec2));
  await W.runDueAutomations(env);
  const later = JSON.parse(store.get('auto:' + EMAIL)).items[0];
  ok((later.runs || 0) === 1, 'it runs once the window has gone', later.runs);
  ok(!later.heldUntil,
     'and the hold is cleared, so the row stops calling a job that has since run "held"', later.heldUntil);

  globalThis.fetch = realFetch;
}

if (report('the-hour-nobody-wants-to-be-emailed-at') > 0) process.exitCode = 1;
done();
