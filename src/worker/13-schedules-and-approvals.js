/* ══════════════════════════════════════════════════════════════════════
   A SCHEDULE IS A TIME ON SOMEBODY'S CLOCK, NOT AN INTERVAL.

   "Every day at 8" was stored as `repeat:'daily'` and nothing else. Each run
   then set the next one to `now + 24h` - and `now` is when the run happened,
   which is the five-minute tick plus however long the job took. So 8:00 ran
   at 8:03, then 8:06, then 8:09, a little later every morning, and a clock
   change moved it by an hour. Worse, the Crew box never sent the time at all:
   "every weekday at 7pm" became a job that ran every 24 hours from whenever it
   was created, and "every month on the 1st" became weekly. Only a copy kept in
   the browser knew the real time, and that only runs while AMV is open -
   which is the one thing a background job is for not needing.

   So the schedule is stored as what the person said - the hour and minute,
   which weekdays or which day of the month, and their time zone - and every
   next run is computed from it, on the person's own calendar. 8:00 is 8:00
   every day, in their zone, through the change to summer time and back.

   A job with no calendar schedule (every 10 minutes, hourly, or one made
   before this) keeps its original rhythm instead of drifting: the next run
   is the next slot of the schedule it started on, not `now + interval`. */
const SCHED_CADS = ['daily', 'weekly', 'monthly'];
function _tzOk(tz){
  const z = String(tz || '').trim().slice(0, 64);
  if(!z) return '';
  try{ new Intl.DateTimeFormat('en-US', { timeZone: z }); return z; }catch(e){ return ''; }
}
function _schedClean(sc, tzFallback){
  if(!sc || typeof sc !== 'object') return null;
  const cad = String(sc.cad || '').toLowerCase();
  if(SCHED_CADS.indexOf(cad) < 0) return null;
  const hour = Number(sc.hour), minute = sc.minute == null ? 0 : Number(sc.minute);
  if(!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const out = { cad, hour, minute, tz: _tzOk(sc.tz) || _tzOk(tzFallback) || 'UTC' };
  if(cad === 'weekly'){
    const days = [...new Set((Array.isArray(sc.days) ? sc.days : []).map(Number)
      .filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
    if(!days.length) return null;
    out.days = days;
  }
  if(cad === 'monthly'){
    const dom = Number(sc.dom);
    if(!Number.isInteger(dom) || dom < 1 || dom > 31) return null;
    out.dom = dom;
  }
  return out;
}
/* The calendar in a zone at an instant: date, time and weekday. */
function _zoneParts(tz, ms){
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
  const p = {}; for(const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: (+p.hour) % 24, mi: +p.minute,
           wd: { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[p.weekday] };
}
/* The instant the clock in `tz` reads that date and time. Corrected against
   the zone's own answer rather than computed from an offset, so a clock
   change between the guess and the answer is absorbed. A time that does not
   exist that day (the hour skipped in spring) lands just after the gap. */
function _zoneInstant(tz, y, mo, d, h, mi){
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let t = want;
  for(let k = 0; k < 3; k++){
    const p = _zoneParts(tz, t);
    const diff = want - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    if(!diff) return t;
    t += diff;
  }
  return t;
}
/* The first time after `afterMs` that the schedule is due. Walks the
   person's calendar a day at a time - bounded, so a schedule that somehow
   never matches still returns something. */
function _schedNextAt(sc, afterMs){
  const tz = sc.tz || 'UTC';
  const base = _zoneParts(tz, afterMs);
  for(let i = 0; i <= 62; i++){
    const day = new Date(Date.UTC(base.y, base.mo - 1, base.d + i));
    const y = day.getUTCFullYear(), mo = day.getUTCMonth() + 1, d = day.getUTCDate(), wd = day.getUTCDay();
    if(sc.cad === 'weekly' && sc.days.indexOf(wd) < 0) continue;
    /* "The 31st" in a thirty-day month is its last day, not a skipped month. */
    if(sc.cad === 'monthly' && d !== Math.min(sc.dom, new Date(Date.UTC(y, mo, 0)).getUTCDate())) continue;
    const t = _zoneInstant(tz, y, mo, d, sc.hour, sc.minute || 0);
    if(t > afterMs) return t;
  }
  return afterMs + AUTO_INTERVALS.daily;
}
/* A ONE-TIME JOB, AFTER ITS TIME HAS COME.

   It is finished once it has run (or, set to suggest, once it has said it is
   due). A run that failed, or could not start because an account it needs is
   not connected, is tried again every half hour - "Friday at 9" that fails at
   9:00 because a provider blinked should still happen at 9:30 - until a day
   after the time it was set for, and then it is finished too, with the reason
   in its results. Finished means inactive and marked done: kept, so the row
   can say it ran, and not counted against the plan's job limit. */
const AUTO_ONCE_RETRY_MS = 30 * 60e3;
const AUTO_ONCE_GRACE_MS = 24 * 3600e3;
function _autoLiveCount(items){ return (items || []).filter(x => x && !x.done).length; }
/* When a job that has just run - or been skipped, or failed - runs next.
   `how` matters only to a one-time job: 'ran', 'failed' or 'waiting'. */
function _autoNextAfter(item, now, how){
  if(item && item.repeat === 'once'){
    const due = Number(item.onceAt) || Number(item.next) || now;
    if(how === 'ran' || now - due >= AUTO_ONCE_GRACE_MS){ item.active = false; item.done = true; item.doneAt = now; return 0; }
    return now + AUTO_ONCE_RETRY_MS;
  }
  const sc = item && item.sched ? _schedClean(item.sched) : null;
  if(sc) return _schedNextAt(sc, now);
  const iv = Math.max(AUTO_MIN_INTERVAL, Number(item && item.interval) || AUTO_INTERVALS.daily);
  const due = Number(item && item.next);
  if(!Number.isFinite(due) || due <= 0 || due > now) return now + iv;
  /* The next slot of the rhythm it started on. A run that was late by more
     than one interval skips what it missed rather than firing them all. */
  return due + Math.ceil((now - due + 1) / iv) * iv;
}

/* Long enough for a real standing instruction, short enough that it cannot
   become a second prompt smuggled into every unattended run. */
const AUTO_STANDING_MAX = 1200;

async function autoUpdate(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const body = await request.json().catch(()=>({}));
  const id = String(body.id||'');
  const key = _autoKey(user.email);
  const rec = (await DB.get(env, 'auto', key)) || { items:[], results:[] };
  const items = rec.items||[];

  /* STANDING INSTRUCTIONS - how this person wants ALL their background work
     done, as opposed to what any one job is.

     "Make my crew think harder and research more before answering" is a
     sentence about every job, present and future, and there was nowhere to put
     it. Storing it per job would mean editing each one and would not reach the
     next one they create.

     Handled before the id lookup because it belongs to the person, not to an
     item - and it is only worth anything because runDueAutomations reads it
     into the system prompt. Without that it is a string in a database that
     changes nothing, which is exactly the shape of a feature that looks like
     it works. */
  if(body.action === 'standing'){
    const text = String(body.standing == null ? '' : body.standing).trim().slice(0, AUTO_STANDING_MAX);
    /* Under the lock the cron takes - see autoCreate. Only the two fields
       this action owns are touched, so a run in progress keeps everything it
       wrote. */
    await _withAuto(env, key, (fresh) => {
      if(!fresh) return;
      fresh.standing = text;
      fresh.standingAt = Date.now();
    }, { items:[], results:[] });
    audit(env, 'auto_standing_set', { by: user.email, len: text.length });
    return json({ ok:true, standing: text, appliesTo: items.length });
  }

  /* Quiet hours. Two integers and a zone, or nothing at all to switch it off.
     Validated here rather than trusted: an out-of-range hour that reached the
     record would silence a window nobody chose, and the tick reads this
     without a person present to notice. */
  if(body.action === 'quiet'){
    const q = body.quiet;
    let next = null;
    if(q && q.from != null && q.to != null){
      const from = Math.floor(Number(q.from)), to = Math.floor(Number(q.to));
      if(!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 23 || to < 0 || to > 23)
        return json({ error: 'Quiet hours must be two whole hours between 0 and 23.', code: 'bad_quiet' }, 400);
      if(from === to)
        return json({ error: 'A quiet window that starts and ends at the same hour is not a window. Turn it off instead.', code: 'bad_quiet' }, 400);
      next = { from, to, tz: String(q.tz || 'UTC').slice(0, QUIET_MAX_TZ) };
    }
    await _withAuto(env, key, (fresh) => { if(fresh) fresh.quiet = next; }, { items:[], results:[] });
    audit(env, 'auto_quiet_set', { by: user.email, on: !!next });
    return json({ ok:true, quiet: next });
  }

  /* WAS THAT RESULT WORTH TELLING ME ABOUT.

     Two buttons on a result, and the reason they are not analytics is that they
     buy the person something: a run of "not worth it" earns an offer to make
     the job quieter or stop it, and a run of "worth it" on a job AMV has been
     holding back earns an offer to undo that. A button whose only effect is a
     number on somebody else's dashboard costs a tap and returns nothing.

     Recorded against the JOB, and also onto the result itself so the button can
     show which way it was answered rather than resetting every time the screen
     redraws. Changing the answer is allowed - people are allowed to change
     their minds, and a first tap that cannot be corrected is a trap. */
  if(body.action === 'feel'){
    const resId = String(body.result || '');
    const said = body.said === 'up' ? 'up' : 'down';
    /* TWO FACTS, NOT ONE. The first version tracked only the job id and used
       "no job id" to mean "no such result" - so a result that exists but
       carries no job was written to and THEN reported as a 404. Telling
       somebody their tap failed after taking it is the plainest form of the
       thing this file is not allowed to do. */
    let found = false, jobId = '';
    await _withAuto(env, key, (fresh) => {
      if(!fresh) return;
      const r = (fresh.results || []).find(x => x && x.id === resId);
      if(!r) return;
      found = true;
      /* The same answer twice is one answer, not two. Without this a person
         tapping to confirm what they already said would push a streak over the
         line and be offered a change they never asked for. */
      if(r.feel === said) { jobId = String(r.autoId || ''); return; }
      r.feel = said;
      jobId = String(r.autoId || '');
      if(jobId) _feelRecord(fresh, jobId, said);
    }, { items:[], results:[] });
    if(!found) return json({ error: 'That result is not on this account any more.',
                             code: 'no_result' }, 404);
    /* Recorded on the result either way. A result with no job behind it cannot
       earn an offer - there is nothing to make quieter - but the answer is
       still theirs and the button still shows it. */
    if(jobId) audit(env, 'auto_result_feel', { by: user.email, job: jobId, said });
    return json({ ok: true, said });
  }

  /* ANSWERING AN OFFER. Accepting applies the change AND marks it offered;
     declining only marks it. Both are final - the flag is never cleared, so a
     "no" means AMV stops asking about this job rather than waiting a while and
     trying again, which is what "no" means everywhere else. */
  if(body.action === 'offer'){
    const jobId = String(body.job || '');
    const take = body.accept === true;
    let applied = '';
    await _withAuto(env, key, (fresh) => {
      if(!fresh) return;
      const it = (fresh.items || []).find(x => x && x.id === jobId);
      if(!it) return;
      const off = _offerFor(fresh, it);
      /* Re-derived under the lock rather than trusted from the request. A
         client that says "accept: make it autonomous" for a job that never
         earned the offer would otherwise be raising its own permissions. */
      if(!off) return;
      if(take){
        if(off.kind === 'auto'){ it.approval = 'auto'; applied = 'auto'; }
        else if(off.kind === 'pause'){ it.active = false; applied = 'pause'; }
        else if(off.kind === 'quiet'){ it.quietUnchanged = true; applied = 'quiet'; }
        else if(off.kind === 'inapp'){ it.notify = 'app'; applied = 'inapp'; }
        else if(off.kind === 'stop'){ it.active = false; applied = 'stop'; }
        else if(off.kind === 'unquiet'){ it.quietUnchanged = false; it.quietSince = 0; applied = 'unquiet'; }
      }
      /* Marked on the side the offer CAME FROM. Writing `tally.offered` for an
         offer earned by result feedback would silence the approval offers too,
         and somebody would never be asked the other question at all. */
      if(off.kind === 'inapp' || off.kind === 'stop' || off.kind === 'unquiet'){
        if(!fresh.feel || typeof fresh.feel !== 'object') fresh.feel = {};
        const fl = fresh.feel[jobId] || { up:0, down:0 };
        fl.offered = true;
        fresh.feel[jobId] = fl;
      } else {
        if(!fresh.tally || typeof fresh.tally !== 'object') fresh.tally = {};
        const t = fresh.tally[jobId] || { yes:0, no:0 };
        t.offered = true;
        fresh.tally[jobId] = t;
      }
    }, { items:[], results:[] });
    audit(env, 'auto_offer_answered', { by: user.email, job: jobId, accepted: take, applied });
    return json({ ok:true, applied: applied || null, accepted: take });
  }

  /* The never list. Whole addresses, `@domain`, or a bare domain; anything
     else is REFUSED and named, rather than stored as something AMV alone can
     interpret. A bound whose meaning is a guess is not a bound, and the person
     would find out it was a guess at the worst possible moment. */
  if(body.action === 'never'){
    const raw = Array.isArray(body.never) ? body.never.slice(0, NEVER_MAX) : [];
    const bad = raw.filter(x => String(x || '').trim() && !_neverNorm(x))
                   .map(x => String(x).trim().slice(0, 60));
    if(bad.length)
      return json({ error: 'AMV could not read ' + bad.join(', ')
                         + ' as an address or a domain. Use somebody@example.com, or example.com for everyone there.',
                    code: 'bad_never', rejected: bad }, 400);
    const list = [...new Set(raw.map(_neverNorm).filter(Boolean))].slice(0, NEVER_MAX);
    await _withAuto(env, key, (fresh) => { if(fresh) fresh.never = list; }, { items:[], results:[] });
    /* The COUNT is audited, not the entries. This list is somebody naming the
       people and institutions that matter most to them - an employer, a bank,
       an ex - and an audit log is the last place that belongs. */
    audit(env, 'auto_never_set', { by: user.email, count: list.length });
    return json({ ok:true, never: list });
  }

  /* THE CEILING - the highest level ANY of this account's background jobs may
     reach, now or in future.

     Handled before the id lookup because it belongs to the person rather than
     to any one job, and it is the control that makes "nothing sends on its own"
     something the system enforces instead of something they have to remember
     for every job they ever create. Lowering it takes effect on the next run of
     everything, including jobs somebody else on a family or team plan set up.

     Nothing is rewritten when it moves. Each job keeps the level it was given
     and the cron takes the lower of the two, so raising the ceiling later
     restores exactly what was configured rather than leaving everything
     flattened to whatever the strictest moment demanded. */
  if(body.action === 'ceiling'){
    const level = _autoApprovalOf(body.ceiling, null);
    if(!AUTO_APPROVALS.includes(body.ceiling)) return json({ error:'invalid level' }, 400);
    await _withAuto(env, key, (fresh) => {
      if(!fresh) return;
      fresh.ceiling = level;
      fresh.ceilingAt = Date.now();
    }, { items:[], results:[] });
    /* Worth an audit line: it is a security control, and lowering it is
       something somebody may need to prove happened. */
    audit(env, 'auto_ceiling_set', { by: user.email, level, jobs: items.length });
    return json({ ok:true, ceiling: level,
                  /* How many jobs this actually restrains right now, so the
                     confirmation is about their jobs rather than about a word. */
                  restrains: items.filter(x => AUTO_APPROVAL_RANK[_autoApprovalOf(x.approval,'require')] > AUTO_APPROVAL_RANK[level]).length,
                  items });
  }

  const i = items.findIndex(x=>x.id===id);
  if(i < 0) return json({ error:'not found' }, 404);

  if(body.action === 'delete') items.splice(i,1);
  else if(body.action === 'pause')  items[i].active = false;
  else if(body.action === 'resume' && items[i].done)
    return json({ error:'That one-time job has already run. Set up a new one for another time.', code:'once_done' }, 409);
  else if(body.action === 'resume'){ items[i].active = true;
    /* Back on its own clock: a job resumed at noon that runs at 8 next runs at
       8, not at noon tomorrow. */
    items[i].next = items[i].sched ? _autoNextAfter(items[i], Date.now()) : Date.now() + items[i].interval; }
  /* An explicit level, not a toggle. A toggle can only ever reach two of the
     three, so the screen could not express "suggest only" at all and the chat
     tool had to guess which way pressing it would go. A caller that sends no
     level still gets the old flip between require and auto, so nothing that
     already worked stops working. */
  else if(body.action === 'approval'){
    items[i].approval = AUTO_APPROVALS.includes(body.approval)
      ? body.approval
      : ((items[i].approval === 'auto') ? 'require' : 'auto');
  }
  /* Change what a job does or how often. Without this there was no way to edit
     a running job at all: the screen offered it, posted to a route that did not
     exist, and the server carried on with the old schedule. Deleting and
     recreating would lose the run history and the claim keys that stop a job
     double-firing, so it is edited in place. */
  else if(body.action === 'edit'){
    if(typeof body.detail === 'string'){
      const detail = body.detail.trim();
      if(!detail) return json({ error:'detail required' }, 400);
      if(detail.length > CREW_DETAIL_MAX) return _crewDetailTooLong();
      /* The same rule on the way in through the side door. A guard only on
         create is not a guard: edit writes to exactly the same field. */
      const _esec = _detailSecrets(detail);
      if(_esec.length){
        return json({ error:'credentials_in_detail', kinds:_esec,
          message:'AMV does not store passwords, card numbers or security codes. The job was not changed.' }, 400);
      }
      items[i].detail = detail;
    }
    if(body.repeat != null){
      const repeat = String(body.repeat).toLowerCase();
      if(!AUTO_INTERVALS[repeat]) return json({ error:'invalid repeat interval' }, 400);
      items[i].repeat = repeat;
      items[i].interval = AUTO_INTERVALS[repeat];
      /* Next run moves with the new interval rather than keeping a time the old
         cadence chose - otherwise "change it to weekly" still fires tomorrow. */
      items[i].next = Date.now() + items[i].interval;
      /* A new cadence with no new time drops the old calendar - "make it
         hourly" must not go on running at 8 every morning. */
      if(body.sched === undefined) delete items[i].sched;
    }
    /* A new time, days or zone. Sent together with repeat when both change,
       and applied after it, so "make it weekly on Mondays at 7" lands on
       Monday at 7 rather than a week from now. */
    if(body.sched !== undefined){
      if(body.sched === null){ delete items[i].sched; }
      else{
        const sc = _schedClean(body.sched, body.tz || (items[i].sched && items[i].sched.tz) || (request.cf && request.cf.timezone));
        if(!sc) return json({ error:'That schedule is not one AMV can keep - it needs a time, and the days or date it runs on.', code:'bad_schedule' }, 400);
        items[i].sched = sc;
        items[i].next = _schedNextAt(sc, Date.now());
      }
    }
    if(AUTO_APPROVALS.includes(body.approval)) items[i].approval = body.approval;
  }
  else return json({ error:'unknown action' }, 400);

  /* Under the lock, and the ITEM LIST only.

     The edits above were applied to a copy read at the top of this handler and
     the whole record was written back - so a result the cron produced while
     somebody was pressing "pause" is erased, and so is a `next` the run had
     just moved. Writing only `items` inside the lock leaves everything else on
     the record exactly as the tick left it.

     The list written is the one edited here, which is deliberate: an edit is a
     statement about the jobs this person was looking at. The cron only ever
     changes bookkeeping fields on items it ran, and takes the same lock to do
     it, so the two cannot interleave mid-write. */
  const saved = await _withAuto(env, key, (fresh) => {
    if(!fresh) return null;
    fresh.items = items;
    return items;
  }, { items:[], results:[] });
  return json({ ok:true, items: saved || items });
}

/* ---- mark results as read ---- */
async function autoClearResults(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const key = _autoKey(user.email);
  /* The cron writes this record under the lock while a run is in progress
     (AMV-205), so marking results read has to take it too - otherwise the copy
     read here is written back over whatever the tick produced in between, and
     a result that arrived while somebody was looking at the page disappears. */
  await _withAuto(env, key, (rec) => {
    if(!rec) return;
    (rec.results||[]).forEach(r=>{ r.read = true; });
  }, { items:[], results:[] });
  return json({ ok:true });
}

/* ---- Emergency pause: stop ALL of a user's autonomous work ----
   Sets a flag on the user's automation record; the cron honours it and
   skips every due run until the user resumes. Mirrors the Mission Control
   "Pause all autonomous" control. */
async function autoPause(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const key = _autoKey(user.email);
  /* AMV-205: PAUSE HAS TO ACTUALLY STOP THE WORK.

     The cron tick writes this same record back after every run. A pause landing
     while the tick held an earlier copy was written away, so the job the person
     stopped kept running unattended and kept spending. Pause is what people
     reach for when something is going wrong, so it failing silently is worse
     than not having it. */
  if(request.method === 'POST'){
    const body = await request.json().catch(()=>({}));
    const paused = !!body.paused;
    await _withAuto(env, key, (rec) => { rec.paused = paused; }, { items:[], results:[] });
    return json({ ok:true, paused });
  }
  const rec = (await DB.get(env, 'auto', key)) || { items:[], results:[] };
  return json({ ok:true, paused: !!rec.paused });
}

/* ---- Enqueue a finished scheduled-task result for the user's approval ----
   Require-approval automations stop before delivery: the completed work
   waits in the approval queue exactly like an interactive draft would. */
/* How often the job behind an approval runs, in the words the card shows.
   Derived from the record rather than stored, so a job whose cadence was
   edited does not leave an old label on the next thing it produces. */
function _autoScheduleLabel(item){
  const r = String((item && item.repeat) || '').toLowerCase();
  const named = { '10min': 'every 10 minutes', '30min': 'every 30 minutes',
                  hourly: 'hourly', daily: 'daily', weekly: 'weekly' };
  if(named[r]) return named[r];
  const ms = Number(item && item.interval) || 0;
  if(!ms) return '';
  for(const [k, v] of Object.entries(AUTO_INTERVALS)) if(v === ms) return named[k] || k;
  return '';
}

const AUTO_APPROVALS_MAX = 50;
/* AN APPROVAL THAT EXPIRES IS A DENIAL - ON THIS QUEUE TOO.

   AUTONOMY.md states that rule and the web-agent path enforces it: a ticket
   lives ten minutes, with a comment saying an old approval left in a tab is
   not a standing licence. THIS queue - the one holding finished work that
   SENDS EMAIL when approved - had no expiry of any kind. An item could sit for
   a month and go out on a click, carrying facts that were true when it was
   written.

   The doctrine was in one file and the enforcement in another, which is the
   failure this repository keeps finding in itself.

   Seven days. Short enough that the world has not moved on, long enough that a
   job running at 3am is still approvable after a weekend - a bound that breaks
   the feature is not a bound, it is a bug people work around.

   EXPIRY REFUSES, IT DOES NOT DELETE. The work stays visible and the recurring
   job will produce a fresh one; silently binning somebody's draft to enforce a
   deadline is a worse outcome than the deadline. Rejecting stays available for
   ever: you can always say no. */
const AUTO_APPROVAL_TTL_MS = 7 * 86400000;

/* An item written before this existed has no `expiresAt`, so it is derived
   from when it was ready. An item with NEITHER cannot be dated at all, and an
   undateable approval is treated as expired rather than as fresh: refusing
   costs one re-run, and the other direction sends something of unknown age. */
function _apvExpiresAt(item){
  const explicit = Number(item && item.expiresAt) || 0;
  if(explicit) return explicit;
  const ready = Number(item && item.readyAt) || 0;
  return ready ? ready + AUTO_APPROVAL_TTL_MS : 0;
}
function _apvExpired(item, now){
  const exp = _apvExpiresAt(item);
  return !exp || (Number(now) || Date.now()) > exp;
}
/* THE ID IS WHAT A DECISION IS AIMED AT.

   Approve and reject both address one item by this string, so two items
   sharing one means somebody's decision lands on the wrong piece of work -
   silently, and in the direction of acting on something they never saw. It
   used to be the millisecond plus four base-36 characters from Math.random:
   about 1.7 million values inside a millisecond, which is a coin flip nobody
   should be taking on the identifier that gates an action. Two enqueued in
   the same tick is not hypothetical - the cron runs a batch.

   `crypto.randomUUID` is available in the Workers runtime and is the right
   source for this. The timestamp prefix stays because it keeps the ids
   sortable and readable in an audit line; the uniqueness no longer rests on
   it. */
function _approvalId(now){ return _tickId('ap', now); }
/* The result records written beside them have exactly the same problem for
   exactly the same reason: `runDueAutomations` walks a batch of due items in
   one tick, so several are minted in the same millisecond by construction, and
   the id is what "mark read" and the timeline address. Same helper. */
function _resultId(now){ return _tickId('r', now); }
/* No separator between the two halves, deliberately. A hyphen made the id
   easier to read and broke an existing assertion that pulled the id out of a
   tool listing with `[a-z0-9]+` - which is the useful signal: something was
   already relying on these being one alphanumeric run, and every other id in
   this file is. Readability is not worth finding out later which consumer the
   other one was. */
function _tickId(prefix, now){
  return prefix + Number(now || Date.now()).toString(36) +
         crypto.randomUUID().replace(/-/g, '');
}
async function _enqueueApproval(env, email, item, out){
  const now = Date.now();
  /* AMV-206: the queue is one list on one record, written by an autonomous run
     on one side and by a person deciding on the other. Appended under the lock,
     or an enqueue lands on top of an approve and the decision is gone - which
     puts an item somebody rejected back in front of them, or loses it. */
  const entry = {
    id: _approvalId(now),
    icon: item.kind === 'research' ? '\uD83D\uDD0D' : '\u2709\uFE0F',
    title: String(item.detail || 'Scheduled task').slice(0,140),
    requesting: 'Review the finished result from your scheduled task before it goes out.',
    project: 'Autonomous',
    actionType: item.notify === 'email' ? 'send' : 'review',
    resultType: 'doc',
    result: { type:'doc', title: String(item.detail||'').slice(0,140), body: String(out||'').slice(0,8000) },
    preview: String(out||'').slice(0,4000),
    startedAt: now, readyAt: now, autoApprove: false,
    /* WHO GETS IT, ON THE PATH THAT MATTERS MOST.

       The same thing - "your running job prepared something, approve it" -
       is built in two places: here, when the cron ran while nobody was
       looking, and in `_recurMakeApproval` on the client when AMV happened
       to be open. The client one carried the recipient, the count, and which
       job it came from. This one carried none of it, so the card was poorer
       on exactly the occasion autonomy is FOR - the run you were not there
       for.

       The recipient is not a guess and cannot be one: `_autoEmailResult`
       takes the address from the account, so an autonomous send reaches the
       owner and nobody else. Saying so is reassurance rather than detail -
       "this goes to you" is the answer to the question somebody actually has
       when a machine offers to send something on their behalf. */
    destination: item.notify === 'email' ? String(email || '') : '',
    recipients: item.notify === 'email' ? 1 : null,
    fromJob: String(item.id || ''),
    jobSchedule: _autoScheduleLabel(item),
    /* Written down rather than derived, so the deadline a person was shown is
       the deadline that is enforced even if the default changes later. */
    expiresAt: now + AUTO_APPROVAL_TTL_MS,
    /* Whether this can be taken back, decided where the action is known rather
       than guessed on the screen. A sent email cannot be recalled; a result
       somebody only reads has nothing to undo. */
    reversible: item.notify !== 'email'
  };
  await _withKind(env, 'approvals', email, (rec) => {
    rec.items = (rec.items||[]).concat(entry).slice(-AUTO_APPROVALS_MAX);
  }, { items: [] });
}

/* ── A FIGURE NEVER WEARS ANOTHER CURRENCY'S SYMBOL ─────────────────────────

   This used to print a literal '$' in front of every number and append the
   currency code once, at the end of the first line. So somebody in Frankfurt
   read "Total: $12,345.00 EUR" - a sentence that contradicts itself - and then
   "Up $1,234.00" and "Pension: $9,000.00 (+$120.00)", which carried no currency
   at all and the wrong symbol. It is their pension, reported while they are
   asleep, in a currency that is not theirs.

   The page had it right the whole time: `_invMoney` formats the same numbers
   through Intl with the real currency. Two renderings of one set of figures
   disagreed, and the WRONG one was the one that leaves the building.

   THE CODE, NOT A SYMBOL. '$' belongs to the US, Canada, Australia, New
   Zealand, Hong Kong, Singapore and Mexico among others, and '¥' is both the
   yen and the yuan, so a symbol table trades one ambiguity for another. Written
   statements about money use the ISO code for exactly this reason, and it is
   unambiguous in every locale without any locale data. On EVERY figure, so no
   line is left bare.

   No Intl, for the reason the old comment gave and got right: this runs at the
   edge, where locale data is not something to bet a money figure on, and a
   formatter that throws takes the whole check-in down with it.

   The sign goes after the code. "-EUR 40.00" reads as a negative currency;
   "EUR -40.00" reads as a negative amount, which is what it is. */
const _ZERO_DECIMAL_CCY = new Set(['JPY','KRW','VND','CLP','ISK','XAF','XOF',
  'XPF','KMF','DJF','GNF','PYG','RWF','UGX','VUV','BIF']);
function _investMoney(n, cur){
  const code = String(cur || 'USD').toUpperCase().slice(0, 8);
  const v = Number(n) || 0;
  const neg = v < 0;
  /* A yen amount has no fractional part. "JPY 1,234.00" is not a sum of money
     anybody in Japan would recognise, and two decimal places invented for a
     currency that has none is a figure AMV made up. */
  const dp = _ZERO_DECIMAL_CCY.has(code) ? 0 : 2;
  const fixed = Math.abs(v).toFixed(dp);
  const dot = fixed.indexOf('.');
  const whole = dot < 0 ? fixed : fixed.slice(0, dot);
  const frac = dot < 0 ? '' : fixed.slice(dot);
  return code + ' ' + (neg ? '-' : '')
       + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + frac;
}

/* ---- Execute ONE automation against the real model ---- */
/* An investing check-in's words, built from the provider's numbers.

   Deliberately not written by a model. A scheduled check-in reports on somebody
   else's savings while they are asleep, and a model handed the goal text has no
   way to read an account - so it would either apologise every morning or make a
   figure up, and a made-up figure about someone's retirement is the worst thing
   this product could send. Every number below came from the institution or is
   absent. */
function _investText(r){
  if(!r || !r.ok){
    const why = (r && r.error) || 'Your accounts could not be read.';
    return 'Investment check-in\n\n' + why
      + '\n\nNo figures are shown because none could be read. Nothing here is estimated.';
  }
  const cur = r.currency || 'USD';
  const money = (n) => _investMoney(n, cur);
  let out = 'Investment check-in\n\nTotal: ' + money(r.total) + '\n';
  if(r.first){
    out += '\nThis is the first check-in, so there is nothing to compare it against yet. '
         + 'The next one will show what changed.\n';
  }else{
    const dir = r.direction === 'up' ? 'Up' : r.direction === 'down' ? 'Down' : 'Flat';
    out += '\n' + dir + ' ' + money(r.changeUSD)
         + (r.changePct == null ? '' : ' (' + r.changePct + '%)')
         + ' since the last check-in.\n';
    if(r.changePct == null && r.direction !== 'flat')
      out += 'No percentage is shown because the previous total was zero, and a percentage of zero is not a number.\n';
  }
  if((r.byAccount || []).length){
    out += '\nBy account:\n';
    for(const a of r.byAccount){
      out += '  - ' + a.name + ': ' + money(a.balance)
           + (a.isNew ? ' (new since the last check-in, so no change is shown)'
                      : ' (' + (a.change > 0 ? '+' : '') + money(a.change) + ')') + '\n';
    }
  }
  return out + '\nThis is information about your accounts, not financial advice. '
             + 'AMV can only read these accounts; it cannot buy, sell, or move anything.';
}

/* ── REAL ACCOUNT DATA, IN AN UNATTENDED RUN ─────────────────────────────────

   This is the part that makes the tab-closed promise true, and until it existed
   the rest of connected accounts was a vault with nothing drawing on it.

   Everything above stores and guards tokens. Nothing called connUse, so a
   perfectly built, perfectly encrypted, perfectly revocable connection did
   exactly nothing - the runner still only had the job's own text. That is the
   failure this product keeps having in a new place: correct at both ends and
   not joined in the middle.

   Bounded on purpose. A digest needs the shape of the inbox, not the inbox: it
   reads headers and snippets for a small number of recent messages, never full
   bodies, never attachments. That keeps the prompt small, the cost predictable,
   and the amount of somebody's private mail passing through a model as small as
   the job can be done with.

   And it NEVER silently degrades. If a capability was asked for and could not
   be read - not connected, autonomy paused, token revoked - the run is told so
   in the prompt, in words, and instructed to say it. An inbox digest that
   quietly reports on nothing looks identical to an inbox with nothing in it,
   which is how somebody misses a fortnight of mail believing AMV was watching. */
/* READ-ONLY, EVERY ONE OF THEM. There is no send, no write and no payment in
   this list, and that is the whole reason an unattended run is allowed to hold
   an account at all.

   `bank.read` is here because five jobs in the catalogue already said they
   needed a bank connection - Morning money summary, Unusual transaction
   alerts, Low balance warning, Budget pace, Credit watch - and the runner
   handed them nothing. Their prompts are written around real balances and real
   transactions, and each one honestly says "never state a balance you cannot
   read", so they did not lie; they simply could not work. A requirement stated
   in one layer with no data behind it in another is the failure this codebase
   keeps finding, and this was the largest remaining instance of it.

   It reads through the same aggregator token the investing check-in has read
   unattended since it was written, so no new class of access is created here -
   balances were already readable on a schedule, and this adds the transaction
   list beside them. */
const AUTO_USES_ALLOWED = ['mail.read', 'calendar.read', 'school.read', 'bank.read'];

/* WHAT A JOB PLAINLY NEEDS, READ OFF WHAT IT SAYS IT DOES.

   The permission gate already answers a question of this shape - it reads the
   detail and decides whether the account can cover it - and the RUNNER answers
   a different one, off `uses`. Two matchers for one question is how a job ends
   up passing the gate and then reading nothing, which is exactly what happened
   to every job created from chat.

   Deliberately narrow. Each entry names a scope an unattended run may actually
   hold (`AUTO_USES_ALLOWED`), so a detail about Drive derives nothing rather
   than deriving a calendar it never asked for - the run then reports what it
   could not see instead of quietly answering a different question. A suite
   drives this and the gate over one table and requires them to agree.

   BOTH APOSTROPHES. A phone autocorrects "what's on" to a curly one, so a
   matcher that knows only the straight ASCII form fails for most of the people
   typing it - and fails by deriving NOTHING, which is silent and is the exact
   failure this table exists to stop. Found by a test case written for the
   phrasing rather than for the regex. */
const AUTO_USES_FROM_TEXT = [
  [/\b(gmail|my e-?mails?|e-?mails? (?:i|from)|inbox|unread|mailbox|read (?:my )?(?:e-?mail|mail)|reply to)\b/i, 'mail.read'],
  [/\b(calendar|meetings?|appointments?|my (?:day|week|schedule)|diary|what(?:['’]| i)?s on)\b/i, 'calendar.read'],
  [/\b(canvas|classroom|assignments?|homework|coursework|my class(?:es)?|due (?:today|tomorrow|this week)|deadlines?)\b/i, 'school.read'],
  /* DELIBERATELY NO ROW FOR `bank.read`.

     Every other entry here is a phrase that can only mean one thing.
     "Spending", "my money" and "subscriptions" are not like that: they are the
     words people use for a question they expect answered from receipts as often
     as from a statement. A row here would mean a sentence typed into chat
     starts an unattended job that reads somebody's bank account, which is not
     a thing to infer from wording.

     So a bank read is only ever requested by a job that DECLARES it - the
     catalogue's `needs:'Bank connection'`, which the person saw on the card
     before they switched it on. Narrower than the others on purpose. */
];
function _autoUsesFromText(text){
  const s = String(text || '');
  const out = [];
  for(const [re, use] of AUTO_USES_FROM_TEXT)
    if(re.test(s) && AUTO_USES_ALLOWED.indexOf(use) >= 0 && out.indexOf(use) < 0) out.push(use);
  return out;
}
const AUTO_MAIL_MAX = 25;          // headers, not bodies
const AUTO_EVENTS_MAX = 20;
const AUTO_SNIPPET_MAX = 180;

