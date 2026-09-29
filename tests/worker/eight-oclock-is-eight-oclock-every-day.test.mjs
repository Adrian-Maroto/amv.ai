/* EIGHT O'CLOCK IS EIGHT O'CLOCK, EVERY DAY, WITH NOTHING OPEN.

   The whole point of Crew: work that happens on its own - overnight, at 8
   every morning, every Monday - on AMV's servers, with the person's computer
   off and AMV closed. No browser, no bridge, no Chrome.

   What was wrong, measured before the fix:
   - Each run set the next one to `now + 24h`, and `now` is when the run
     happened: the five-minute tick plus the run's own length. So 8:00 ran at
     8:03, then 8:06, then 8:09, later every morning.
   - A clock change moved it by an hour, because nothing knew the person's
     zone.
   - The Crew box and the chat tool never sent the time at all. "Every day at
     8am" became "every 24 hours from whenever it was created", "every weekday"
     became once a week, and "the 1st of the month" became weekly.

   Here the real scheduler (`runDueAutomations`, what the cron calls) runs a
   week of mornings with a clock moved by hand, late by a few minutes each
   time the way the tick really is, across the night the clocks go back. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'eightoclock.harness.mjs');
writeFileSync(harness, src + `
export { autoCreate, autoUpdate, runDueAutomations, _schedNextAt, _autoNextAfter, _zoneParts };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'owner@test.com';
const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', AMV_KV: {
  async get(k){ return store.has(k) ? store.get(k) : null; },
  async put(k, v){ store.set(k, v); },
  async delete(k){ store.delete(k); },
  async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
} };
W.__setRequireUser(async () => ({ email: ME, plan: 'ultra' }));

/* The clock, moved by hand. */
const realNow = Date.now;
let NOW = Date.parse('2026-10-20T15:00:00Z');
Date.now = () => NOW;
process.on('exit', () => { Date.now = realNow; });

/* The engine, answering every run. */
let calls = 0;
globalThis.fetch = async () => { calls++;
  return new Response(JSON.stringify({ content: [{ text: 'Today’s quote.' }], usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200 }); };

/* What a wall clock in a zone reads at an instant, as "Mon 08:00". */
const local = (tz, ms) => {
  const p = W._zoneParts(tz, ms);
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][p.wd] + ' ' + String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0');
};
const create = async (body, cf) => {
  const req = new Request('https://x/auto/create', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ detail: 'quote of the day', kind: 'task', approval: 'auto', notify: 'app' }, body)) });
  if (cf) Object.defineProperty(req, 'cf', { value: cf });
  const r = await W.autoCreate(req, env);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const job = () => (JSON.parse(store.get('auto:' + ME) || '{}').items || [])[0] || {};
/* One tick of the cron, the way production sees it: some minutes after the
   job was due, and the run itself takes a while. */
const tick = async (lateMin) => {
  NOW = job().next + lateMin * 60000;
  await W.runDueAutomations(env);
};

section('"Every day at 8" runs at 8 on their clock, from the server, for a week');
{
  store.clear(); store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
  NOW = Date.parse('2026-10-20T15:00:00Z');   // Tuesday, 17:00 in Madrid
  const MAD = 'Europe/Madrid';
  const c = await create({ repeat: 'daily', sched: { cad: 'daily', hour: 8, minute: 0 }, tz: MAD });
  ok(c.status === 200 && c.d.item && c.d.item.sched && c.d.item.sched.tz === MAD, 'it is created with the time and the zone', c.d.item && c.d.item.sched);
  ok(local(MAD, job().next) === 'Wed 08:00', 'the first run is tomorrow at 08:00 in Madrid', local(MAD, job().next));

  const seen = [];
  const before = calls;
  for (let day = 0; day < 7; day++) {
    await tick(3 + day);            // the tick is late, and later each day
    seen.push(local(MAD, job().next));
  }
  ok(calls - before === 7, 'it ran every one of the seven mornings, with nothing open', calls - before);
  ok(job().runs === 7, 'and counted them', job().runs);
  ok(seen.every(s => /08:00$/.test(s)), 'every next run is exactly 08:00 - no creep from a late tick', seen);
  ok(seen.join() === 'Thu 08:00,Fri 08:00,Sat 08:00,Sun 08:00,Mon 08:00,Tue 08:00,Wed 08:00',
     'on consecutive days, straight through the night the clocks went back (25 October)', seen);
  const utcHours = [];
  { let t = Date.parse('2026-10-24T06:00:00Z'); utcHours.push(new Date(W._schedNextAt({ cad: 'daily', hour: 8, minute: 0, tz: MAD }, t)).toISOString().slice(11, 16)); }
  ok(utcHours[0] === '07:00', 'after the change, 08:00 in Madrid is 07:00 UTC, not 06:00 - the zone decides, not a fixed offset', utcHours);
}

section('"Every weekday at 7:30pm" skips the weekend');
{
  const NY = 'America/New_York';
  const sc = { cad: 'weekly', days: [1, 2, 3, 4, 5], hour: 19, minute: 30, tz: NY };
  const fri = Date.parse('2026-10-23T23:31:00Z');   // Friday 19:31 in New York
  ok(local(NY, W._schedNextAt(sc, fri)) === 'Mon 19:30', 'from Friday evening the next run is Monday 19:30', local(NY, W._schedNextAt(sc, fri)));
}

section('"The 31st of every month" is the last day of a shorter one');
{
  const TYO = 'Asia/Tokyo';
  const sc = { cad: 'monthly', dom: 31, hour: 9, minute: 0, tz: TYO };
  const jan31 = Date.parse('2027-01-31T00:05:00Z');   // Jan 31 09:05 in Tokyo, just after the run
  const next = W._schedNextAt(sc, jan31);
  const p = W._zoneParts(TYO, next);
  ok(p.mo === 2 && p.d === 28 && p.h === 9, 'the next is 28 February at 09:00, not skipped to March', p);
}

section('A job made before this - no calendar - stops creeping too');
{
  store.clear(); store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
  const due = Date.parse('2026-10-20T08:00:00Z');
  store.set('auto:' + ME, JSON.stringify({ items: [{ id: 'old', detail: 'quote of the day', repeat: 'daily', interval: 86400000,
    next: due, kind: 'task', approval: 'auto', notify: 'app', active: true, runs: 0, uses: [] }], results: [] }));
  NOW = due + 4 * 60000;
  await W.runDueAutomations(env);
  ok(job().next === due + 86400000, 'run at 08:04, its next run is 08:00 tomorrow, not 08:04', new Date(job().next).toISOString());
  NOW = due + 3 * 86400000 + 60000;   // the tick was down for two days
  await W.runDueAutomations(env);
  ok(job().next === due + 4 * 86400000, 'and after an outage it resumes on its slot rather than firing what it missed', new Date(job().next).toISOString());
}

section('The zone comes from their device, else from their network');
{
  store.clear(); store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
  NOW = Date.parse('2026-10-20T15:00:00Z');
  const c = await create({ repeat: 'daily', sched: { cad: 'daily', hour: 7, minute: 15 } }, { timezone: 'Asia/Kolkata', country: 'IN' });
  ok(c.d.item && c.d.item.sched.tz === 'Asia/Kolkata', 'no zone sent: the network’s is used', c.d.item && c.d.item.sched);
  ok(local('Asia/Kolkata', job().next) === 'Wed 07:15', 'and 07:15 there is when it runs', local('Asia/Kolkata', job().next));
  store.clear(); store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
  const bad = await create({ repeat: 'daily', sched: { cad: 'daily', hour: 7, minute: 15 }, tz: 'Not/AZone' }, { timezone: 'Europe/Paris' });
  ok(bad.d.item && bad.d.item.sched.tz === 'Europe/Paris', 'a zone that does not exist is not trusted', bad.d.item && bad.d.item.sched);
}

section('A first run given as a moment becomes a time of day');
{
  store.clear(); store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
  NOW = Date.parse('2026-10-20T15:00:00Z');
  const first = Date.parse('2026-10-21T06:00:00Z');   // 08:00 in Madrid
  const c = await create({ repeat: 'daily', firstRunAt: first, tz: 'Europe/Madrid' });
  ok(c.d.item && c.d.item.sched && c.d.item.sched.hour === 8 && c.d.item.sched.minute === 0,
     'a catalogue job asked for "tomorrow at 8" keeps 8 every day after', c.d.item && c.d.item.sched);
}

section('A free account is told scheduling is part of Pro, before anything is stored');
{
  /* The owner's standing decision: work that runs on its own is a paid
     capability. Asserted here so a schedule never slips past it. */
  store.clear();
  W.__setRequireUser(async () => ({ email: ME, plan: 'free' }));
  NOW = Date.parse('2026-10-20T15:00:00Z');
  const c = await create({ repeat: 'daily', sched: { cad: 'daily', hour: 8, minute: 0 }, tz: 'Europe/Madrid' });
  ok(c.status === 402 && c.d.code === 'plan_required' && !store.get('auto:' + ME),
     'refused with the plan named, and no job is kept', { status: c.status, code: c.d.code });
  W.__setRequireUser(async () => ({ email: ME, plan: 'ultra' }));
}

section('Changing a job keeps or drops the calendar as asked');
{
  store.clear(); store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
  NOW = Date.parse('2026-10-20T15:00:00Z');
  await create({ repeat: 'daily', sched: { cad: 'daily', hour: 8, minute: 0 }, tz: 'Europe/Madrid' });
  const edit = async (body) => { const r = await W.autoUpdate(new Request('https://x/auto/update', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ id: job().id, action: 'edit' }, body)) }), env);
    return { status: r.status, d: await r.json().catch(() => ({})) }; };
  const moved = await edit({ sched: { cad: 'daily', hour: 6, minute: 45 } });
  ok(moved.status === 200 && local('Europe/Madrid', job().next) === 'Wed 06:45', '"move it to 6:45" runs at 06:45 in their zone', local('Europe/Madrid', job().next));
  const bad = await edit({ sched: { cad: 'daily', hour: 25 } });
  ok(bad.status === 400 && bad.d.code === 'bad_schedule', 'a time that does not exist is refused, not guessed', bad);
  await edit({ repeat: 'hourly' });
  ok(!job().sched, '"make it hourly" drops the 06:45 calendar rather than running at 06:45 anyway', job().sched);
}

Date.now = realNow;
if (report('eight-oclock-is-eight-oclock-every-day') > 0) process.exitCode = 1;
done();
