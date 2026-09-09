/* ONE PROMISE, TWO ENFORCERS.

   "Don't run jobs overnight" is a single sentence on a single checkbox, and
   two entirely separate pieces of code have to keep it. The cron holds the
   jobs the account runs on the server. The browser tick, `_runDueAuto`, holds
   the ones that only exist in this device's storage - work scheduled before a
   backend was connected, or by a plan that cannot schedule server-side. That
   tick is the OTHER place an unattended run begins, and it did not know the
   window existed: somebody who ticked the box and left a laptop open still got
   the 3am run from the half of the system nobody had told.

   A bound that holds on one of the two paths is not a bound. So the fix is not
   only "the browser checks too" - it is that the two answers must be the SAME
   answer, which is a thing that has to be measured rather than assumed. Two
   implementations of one rule drift the moment somebody edits whichever file
   they had open; this repository has already paid for that lesson twice, with
   the approval card built in two places and the run budget the client counted
   differently from the server.

   So this suite runs both over the same table, in the same run, and compares
   them - the server's functions in node, the browser's in a real page. Then it
   drives the real tick to prove the answer is actually acted on. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'twoclocks.harness.mjs');
writeFileSync(harness, src + `
export { _quietNow, _quietEndsAt };
`);
const W = await import(harness + '?t=' + Date.now());

const app = await bootApp({ apiBase: '' });
const { page, errors } = app;

/* The window and the moment, written as somebody would say them. Deliberately
   picked to cover the cases each side could get wrong on its own: midnight,
   both edges, a half-hour offset zone, the two shapes of invalid window, and a
   zone name no machine can resolve. */
const CASES = [
  ['crossing midnight, inside',      { from: 23, to: 7, tz: 'UTC' },              '2026-01-15T23:30:00Z'],
  ['crossing midnight, small hours', { from: 23, to: 7, tz: 'UTC' },              '2026-01-16T03:00:00Z'],
  ['crossing midnight, the last minute', { from: 23, to: 7, tz: 'UTC' },          '2026-01-16T06:59:00Z'],
  ['crossing midnight, released',    { from: 23, to: 7, tz: 'UTC' },              '2026-01-16T07:00:00Z'],
  ['inside one day',                 { from: 9,  to: 17, tz: 'UTC' },             '2026-01-15T12:00:00Z'],
  ['inside one day, before',         { from: 9,  to: 17, tz: 'UTC' },             '2026-01-15T08:59:00Z'],
  ['London in July, an hour ahead',  { from: 23, to: 7, tz: 'Europe/London' },    '2026-07-15T22:30:00Z'],
  ['London in January, not',         { from: 23, to: 7, tz: 'Europe/London' },    '2026-01-15T22:30:00Z'],
  ['New York while London sleeps',   { from: 23, to: 7, tz: 'America/New_York' }, '2026-01-16T03:00:00Z'],
  ['a half-hour offset zone',        { from: 23, to: 7, tz: 'Asia/Kolkata' },     '2026-01-15T18:00:00Z'],
  ['a zero-length window',           { from: 3,  to: 3,  tz: 'UTC' },             '2026-01-15T03:30:00Z'],
  ['an hour that does not exist',    { from: 24, to: 7,  tz: 'UTC' },             '2026-01-15T03:00:00Z'],
  ['a window that is not numbers',   { from: 'x', to: 7, tz: 'UTC' },             '2026-01-15T03:00:00Z'],
  ['no window at all',               null,                                         '2026-01-16T03:00:00Z'],
  ['a zone no machine can resolve',  { from: 23, to: 7, tz: 'Nowhere/AtAll' },    '2026-01-16T03:00:00Z'],
];

section('The two enforcers give the same answer, case by case');
{
  const rows = CASES.map(([label, q, iso]) => [label, q, Date.parse(iso)]);
  const client = await page.evaluate((list) =>
    list.map(([label, q, ms]) => [label, _mcQuietNow(ms, q), _mcQuietEndsAt(ms, q)]), rows);
  let same = 0;
  for(let i = 0; i < rows.length; i++){
    const [label, q, ms] = rows[i];
    const s = W._quietNow(q, ms), sEnd = W._quietEndsAt(q, ms);
    const [, c, cEnd] = client[i];
    const agreed = (s === c) && (sEnd === cEnd);
    if(agreed) same++;
    ok(agreed, label + ': both say ' + (s ? 'quiet' : 'not quiet'),
       { server: s, client: c, serverEnds: sEnd, clientEnds: cEnd });
  }
  /* The comparison above passes vacuously if the table is empty or the page
     silently returned nothing, which is exactly the kind of probe that cannot
     fail. */
  ok(same === CASES.length && CASES.length >= 15,
     'and every case in the table was actually compared, not skipped', { same, of: CASES.length });
}

section('The unreadable window fails OPEN on both sides');
{
  /* Deliberately the opposite direction from the approval deadline, which
     refuses when it cannot read the age. A job that stops running and says
     nothing is much harder to notice than one run at an awkward hour, so both
     sides fall towards the mistake somebody can see. */
  const ms = Date.parse('2026-01-16T03:00:00Z');
  const q = { from: 23, to: 7, tz: 'Nowhere/AtAll' };
  const c = await page.evaluate(([m, w]) => _mcQuietNow(m, w), [ms, q]);
  ok(W._quietNow(q, ms) === false, 'the server runs the job rather than silencing it', true);
  ok(c === false, 'and so does the browser', c);
}

/* A window that certainly covers this machine's current hour, and one that
   certainly does not - built from the clock rather than hardcoded, because the
   tick below reads the real `Date.now()`. */
const windows = await page.evaluate(() => {
  const h = new Date().getUTCHours();
  const w = (n) => (n + 24) % 24;
  return { now: { from: h, to: w(h + 2), tz: 'UTC' },
           later: { from: w(h + 3), to: w(h + 5), tz: 'UTC' } };
});

/* Seed one due local job and run the real tick once. Nothing is stubbed except
   the two branches the tick can take, which stand in as counters: the question
   is which branch it took, not what the branch then did. */
const tick = (quiet) => page.evaluate(([q]) => {
  const past = Date.now() - 60_000;
  window.__ran = 0; window.__asked = 0;
  window.runAutonomous = async () => { window.__ran++; };
  window._recurMakeApproval = async () => { window.__asked++; };
  window._aiBackendReady = () => true;
  saveStr('amv_autonomy_paused', '0');
  store('amv_auto_quiet', q);
  store('amv_autosched', [{
    id: 'j1', goal: 'send the overnight summary', sched: { cad: 'daily', hour: 3 },
    next: past, created: past, lastRun: null, approval: 'auto',
    scope: { run: 'every', until: null },
  }]);
  return _runDueAuto().then(() => {
    const t = (load('amv_autosched') || [])[0] || {};
    return { ran: window.__ran, asked: window.__asked, lastRun: t.lastRun,
             next: t.next, heldUntil: t.heldUntil || 0, now: Date.now() };
  });
}, [quiet]);

section('A job that comes due inside the window is held, not run');
{
  const r = await tick(windows.now);
  ok(r.ran === 0, 'nothing ran, so nothing was spent at the hour they asked to be left alone', r);
  ok(r.asked === 0, 'and nothing was drafted either - a draft costs money and lands in an inbox', r);
  ok(r.lastRun === null,
     'the job was not marked as having run, because it did not - holding is not running', r);
  ok(r.next > r.now,
     'and it is booked forward rather than left in the past, where it would fire the instant the window closed', r);
  ok(r.heldUntil > r.now && r.heldUntil === r.next,
     'the record says it was held and until when, so the row can say so instead of the schedule just looking wrong', r);
}

/* The morning after: the SAME record the previous tick held, with the window
   moved off it and the job due again. Deliberately not a fresh job - a fresh
   one carries no hold, so it could never show a hold that failed to clear. */
const tickAgain = (quiet) => page.evaluate(([q]) => {
  window.__ran = 0; window.__asked = 0;
  store('amv_auto_quiet', q);
  const list = load('amv_autosched') || [];
  if(list[0]) list[0].next = Date.now() - 60_000;
  store('amv_autosched', list);
  return _runDueAuto().then(() => {
    const t = (load('amv_autosched') || [])[0] || {};
    return { ran: window.__ran, lastRun: t.lastRun, heldUntil: t.heldUntil || 0, now: Date.now() };
  });
}, [quiet]);

section('The same job outside the window runs exactly as before');
{
  const held = await tick(windows.now);
  ok(held.heldUntil > 0, 'it starts from a job the window actually held', held);
  const r = await tickAgain(windows.later);
  ok(r.ran === 1, 'it ran', r);
  ok(r.lastRun !== null, 'and is marked as having run', r);
  ok(!r.heldUntil,
     'and the hold is cleared, so the row does not keep saying "held" about a job that has since run', r);
}

section('No window means no change to what already worked');
{
  const r = await tick(null);
  ok(r.ran === 1, 'an account that never set quiet hours is untouched by any of this', r);
}

section('The window belongs to the account, not to the device it was typed on');
{
  /* Somebody sets quiet hours on their phone. The browser tick that has to
     honour them is a laptop tab. If each browser only obeyed what was typed
     into it, the setting would hold on one device and not the other - which is
     the same "enforced in one of the two places" failure as the tick itself,
     one layer up. */
  const read = (d) => page.evaluate(([resp]) => {
    window._autoApi = async () => resp;
    return _autoRefresh().then(() => _mcQuiet());
  }, [d]);

  const set = await read({ items: [], results: [], quiet: { from: 1, to: 5, tz: 'UTC' } });
  ok(set && set.from === 1 && set.to === 5,
     'a window set elsewhere arrives on this device and starts holding its jobs', set);

  const off = await read({ items: [], results: [], quiet: null });
  ok(off === null,
     'and switching it off elsewhere switches it off here - a stale window would silence jobs nobody is silencing', off);

  await read({ items: [], results: [], quiet: { from: 22, to: 6, tz: 'UTC' } });
  const kept = await page.evaluate(() => {
    window._autoApi = async () => ({ items: [], results: [] });   /* an older server */
    return _autoRefresh().then(() => _mcQuiet());
  });
  ok(kept && kept.from === 22,
     'a response with no quiet field at all is an older server, not an instruction to forget the window', kept);
}

section('And the screen says the job was held, rather than just looking wrong');
{
  /* Without this, the only evidence a person has is a "next" time that moved,
     which reads as the schedule being broken rather than as the setting doing
     exactly what they asked. The record carrying `heldUntil` is worth nothing
     if nothing renders it - that is the same defect as a setting nobody reads,
     from the other end. */
  const row = await page.evaluate(([held]) => {
    saveStr('amv_plan', 'pro');
    const past = Date.now() - 60_000;
    store('amv_autosched', [{
      id: 'j2', goal: 'send the overnight summary', sched: { cad: 'daily', hour: 3 },
      next: held, created: past, lastRun: null, approval: 'auto', heldUntil: held,
    }]);
    renderCrewView();
    const el = document.querySelector('#mc-sched .mc-sched-row');
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null;
  }, [Date.now() + 3600_000]);
  ok(row !== null, 'the held job has a row on the screen', row);
  ok(/Held until your quiet hours end/i.test(row),
     'and the row says so in words, not by a time silently moving', row);

  const gone = await page.evaluate(() => {
    const list = load('amv_autosched') || [];
    list[0].heldUntil = Date.now() - 60_000;   /* the window has since closed */
    store('amv_autosched', list);
    renderCrewView();
    const el = document.querySelector('#mc-sched .mc-sched-row');
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null;
  });
  ok(gone !== null && !/Held until/i.test(gone),
     'and stops saying it once the window has passed, rather than sticking there', gone);
}

section('The jobs the CRON holds say it on their rows too');
{
  /* The server-run jobs are the ones quiet hours were built for - the cron
     holds them at the hour nobody is watching - so their rows are the ones
     that most need to explain a "next" time that moved. They are drawn by a
     different builder from the local rows above, which is exactly why this is
     asserted separately rather than assumed from the other one passing. */
  const row = await page.evaluate(([held]) => {
    saveStr('amv_plan', 'pro');
    window._autoApi = async () => ({ items: [{
      id: 'srv1', detail: 'Nightly inbox summary', repeat: 'daily', kind: 'task',
      approval: 'auto', active: true, next: held, heldUntil: held, runs: 3,
    }], results: [], quiet: { from: 23, to: 7, tz: 'UTC' } });
    return _autoRefresh().then(() => {
      renderCrewView();
      const el = document.querySelector('#mc-sched .mc-sched-row');
      return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null;
    });
  }, [Date.now() + 3600_000]);
  ok(row !== null, 'the server job has a row', row);
  ok(/Held until your quiet hours end/i.test(row),
     'and it says it was held, on the path where nobody was watching it happen', row);
}

ok(errors.length === 0, 'and the page logged no errors doing it', errors);
report(); done(app);
