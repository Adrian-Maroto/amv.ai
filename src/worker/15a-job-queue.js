
/* ══════════════════════════════════════════════════════════════════════════
   BACKGROUND WORK THROUGH A QUEUE, WHEN ONE IS BOUND.

   The tick runs every account with work due one after another, inside one
   time budget (AUTO_TICK_BUDGET_MS). That holds while the due work fits in a
   tick; past that, accounts are left for the next tick - nothing is lost, but
   jobs arrive later and later as the population grows (auto_backlog says so).

   With the AMV_JOBS queue bound, the tick only decides WHO is due and sends
   one message per account; each account then runs in a consumer invocation of
   its own, in parallel, with retries, and a message that keeps failing lands
   on the dead-letter queue instead of being retried for ever. The work done
   per account is the same function either way (_autoRunAccount), so there is
   one set of rules for plans, holds, ceilings and leases.

   Nothing here changes behaviour until the owner binds the queue (see
   wrangler.toml). Every failure falls back to the tick running the account
   itself - a queue that cannot be reached must never be the reason a job did
   not run - and the per-run lease (`autorun` claims) still means a job that
   is somehow both queued and run inline runs once. */

/* NO ADDRESS IN A QUEUE MESSAGE (Nov 1 audit TASK-006, STATE-006). A message
   names its account by a sealed reference - AES-GCM under a key derived
   from JWT_SECRET - so what sits in the queue, its retries and its dead
   letters, says nothing about who it is for. Messages already in flight with
   a plain address are still read. */
/* Kept with the secret it was made from (Nov 8 audit QUEUE-013): a warm
   isolate that cached the key went on using it after the secret rotated. */
let _qKeyP = null, _qKeyFor = null;
function _qKey(env){
  if(!env || !env.JWT_SECRET) return null;
  if(!_qKeyP || _qKeyFor !== env.JWT_SECRET){
    _qKeyFor = env.JWT_SECRET;
    _qKeyP = crypto.subtle.digest('SHA-256', new TextEncoder().encode('amv-queue-ref\n' + env.JWT_SECRET))
      .then(h => crypto.subtle.importKey('raw', h, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']));
  }
  return _qKeyP;
}
async function _qSeal(env, text){
  const kp = _qKey(env); if(!kp) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await kp, new TextEncoder().encode(String(text)));
  return 'q1.' + _b64(iv) + '.' + _b64(ct);
}
async function _qOpen(env, ref){
  const p = String(ref || '').split('.');
  const kp = _qKey(env); if(!kp || p.length !== 3 || p[0] !== 'q1') return '';
  try{ return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _unb64(p[1]) }, await kp, _unb64(p[2]))); }catch(e){ return ''; }
}
/* What a message is for: its sealed reference, or (older messages) the address. */
async function _qWho(env, body){ return String((body && body.ref) ? await _qOpen(env, body.ref) : (body && body.email) || '').toLowerCase(); }

const AUTO_QUEUE_BATCH = 100;          // the provider's sendBatch ceiling
const AUTO_QUEUE_CLAIM_S = 5 * 60;     // one message per account per five minutes
const AUTO_QUEUE_RETRY_S = 60;         // first retry after a minute, then longer
/* How long one account's run may keep retrying a model call that failed
   for a moment. The tick shares 25 seconds across every account; a consumer
   runs one account and may run for minutes, so a provider hiccup gets the
   retries it deserves instead of a failed job. */
const AUTO_QUEUE_RUN_MS = 4 * 60 * 1000;

function _jobQueueOn(env){
  return !!(env && env.AMV_JOBS && typeof env.AMV_JOBS.sendBatch === 'function');
}

/* Sends one message per due account. Returns the accounts it could NOT hand
   to the queue, which the tick then runs inline as it always has. An account
   already sent in the last five minutes is skipped - its message is still on
   the queue or being worked - unless the claim cannot be read, in which case
   it is sent anyway: a duplicate costs a lease check, a missing one costs a
   job. */
async function _autoEnqueue(env, users, now){
  const unsent = [];
  const toSend = [];
  for(const u of users){
    let fresh = true;
    try{
      const c = await _claimOnceDetail(env, 'autoq', u.id + ':' + Math.floor(now / (AUTO_QUEUE_CLAIM_S * 1000)), AUTO_QUEUE_CLAIM_S);
      fresh = c.claimed || !!c.unavailable;
    }catch(e){ fresh = true; }
    if(fresh) toSend.push(u);
  }
  let sent = 0;
  for(let i = 0; i < toSend.length; i += AUTO_QUEUE_BATCH){
    const slice = toSend.slice(i, i + AUTO_QUEUE_BATCH);
    try{
      const bodies = [];
      for(const u of slice){ const ref = await _qSeal(env, u.id); bodies.push({ body: Object.assign(ref ? { ref } : { email: u.id }, { due: u.soonest || now, at: now }) }); }
      await env.AMV_JOBS.sendBatch(bodies);
      sent += slice.length;
    }catch(e){
      audit(env, 'auto_queue_send_failed', { count: slice.length, error: String((e && e.message) || e).slice(0, 160) });
      unsent.push(...slice);
    }
  }
  if(unsent.length){
    try{ await alertOnce(env, 'auto_queue_send',
      'Background work could not be handed to the job queue (' + unsent.length + ' accounts). The tick ran them itself, '
      + 'so nothing was skipped - but if this keeps happening the queue is down and the tick is back to running everything alone.', 60); }catch(e){}
  }
  return { sent, skipped: users.length - toSend.length, unsent };
}

/* THE CONSUMER: one message is one account. Read fresh - the record may have
   changed since the tick looked - and run under the same switches as the
   tick: the kill switch and the automations switch stop it, a paused account
   runs nothing. A failure is retried with a growing delay; after the queue's
   max_retries the provider moves it to the dead-letter queue (below). */
/* STOPPED MEANS STOPPED FROM THE NEXT JOB, NOT THE NEXT BATCH (Nov 7 audit
   QUEUE-015). The pause and the automations switch were read once when a
   batch arrived, so a pause pressed while it ran let every account after it
   in that batch run anyway. Read again before each account here, and before
   each job inside a run (_autoRunAccount). Unknown is stopped. */
async function _autoStopNow(env){
  try{ if((await env.AMV_KV.get('GLOBAL_KILL')) === '1') return true; }catch(e){ return true; }
  try{ return !!(await _switchedOff(env, 'feature:automations')); }catch(e){ return true; }
}
async function _autoQueueConsume(batch, env){
  /* Nothing in a batch changes anything while a restore has writes off, or
     while that cannot be asked (Nov 8 audit DR-016): each message waits and
     comes back, except the queue's own probe, which writes only its stamp. */
  /* Asked again for every message (Nov 8 verified audit R17): a restore
     switched on between two of them holds the rest. */
  try{ for(const msg of (batch.messages || [])){
    const st = await _writesState(env);
    if(st.paused && !(msg.body && msg.body.kind === 'synth')){ msg.retry({ delaySeconds: 120 }); continue; }
    _bgAdmit(st.gen);
    const body = msg.body || {};
    /* A waiting email (61-owner-digest.js). Not stopped by the automations
       switch: it is mail somebody is owed, not new work. */
    /* The hourly capability check's probe (85-synthetics.js): proof the
       queue delivers, stamped with when it arrived. Never stopped by a
       switch - it does no work and spends nothing. */
    if(body.kind === 'synth'){
      try{ await env.AMV_KV.put(SYNTH_QUEUE_KEY, JSON.stringify({ sent: +body.at || 0, got: Date.now() }), { expirationTtl: 3 * 86400 }); }
      catch(e){ audit(env, 'synth_queue_unrecorded', {}); }
      msg.ack(); continue;
    }
    if(body.kind === 'outbox'){
      try{ await _outboxConsume(env, msg); }
      catch(e){ if(!(e && e.code === 'writes_paused')) audit(env, 'outbox_queue_failed', { error: String((e && e.message) || e).slice(0, 160) }); msg.retry({ delaySeconds: e && e.code === 'writes_paused' ? 120 : 300 }); }
      continue;
    }
    const email = await _qWho(env, body);
    if(!email){ msg.ack(); continue; }
    /* Stopped on purpose: acknowledged, not retried. The job keeps its place
       and its next run, and the first tick after the switch is back on sends
       it again - the same as the tick does when it is stopped. */
    if(await _autoStopNow(env)){ msg.ack(); continue; }
    try{
      const rec = await DB.get(env, 'auto', email);
      if(!rec || rec.paused || !Array.isArray(rec.items) || !rec.items.length){ msg.ack(); continue; }
      const now = Date.now();
      const r = await _autoRunAccount(env, email, rec, now, now + AUTO_QUEUE_RUN_MS);
      if(r.ran || r.failed) console.log('[queue] automations', JSON.stringify({ email, ...r }));
      msg.ack();
    }catch(e){
      /* Held by a restore that began while it ran: not the job's failure. */
      if(e && e.code === 'writes_paused'){ msg.retry({ delaySeconds: 120 }); continue; }
      const n = Number(msg.attempts) || 1;
      audit(env, 'auto_queue_run_failed', { email, attempt: n, error: String((e && e.message) || e).slice(0, 160) });
      try{ await _workerError(env, 'queue.automations', e); }catch(_){}
      msg.retry({ delaySeconds: Math.min(AUTO_QUEUE_RETRY_S * n * n, 3600) });
    }
  } } finally { _bgAdmitEnd(); }
}

/* THE DEAD-LETTER QUEUE: an account whose run failed every retry.

   ONE MORE CHANCE, THEN QUARANTINE (Nov 1 audit TASK-005). Every dead letter
   used to be booked straight back into the due-work index, so a job that
   fails the same way every time - a poison job - failed for ever, an hour at
   a time, spending a retry budget each round. A dead letter is not always
   the job's fault, though: a provider outage dead-letters healthy accounts
   too. So the first dead letter in a day is booked back once (`autodead:`,
   a day); a second within that day puts the account in quarantine
   (`autoquar:`, no expiry): its background work does not run - wherever it
   is reached from, the queue or the hourly sweep - until an operator
   releases it (POST /admin/auto/release). Said to the operator, on the
   record, never silently dropped. */
const _autoQuarKey = (who) => { const email = String(who || '').toLowerCase(); return `autoquar:${email}`; };
const _autoDeadKey = (who) => { const email = String(who || '').toLowerCase(); return `autodead:${email}`; };
/* Not known is held (Nov 8 audit QUEUE-017): a quarantine that cannot be
   read is treated as in force for this run, so work that failed twice is
   never run again just because the store did not answer. It is tried
   again on the next tick. */
/* HELD WHERE EVERY REGION SEES IT AT ONCE (Nov 8 audit QUEUE-016). The
   quarantine was only a KV record, which another region can miss for up to
   a minute - long enough to run poisoned work again. It is now also a mark
   in the account's strongly consistent object, set with the record and
   cleared with it, and either one holds the run. */
const _autoQuarName = (email) => 'autoquar:' + String(email || '').toLowerCase();
async function _autoQuarantined(env, email){
  try{
    /* strict: an object that cannot be asked is a hold, never the KV
       fallback's zero (Nov 8 verified audit R10). */
    if(env.AMV_COUNTER){ const r = await counter(env, _autoQuarName(email), { op: 'get', strict: true }); if(!r || r.unavailable || typeof r.value === 'undefined') return true; if(+(r.value || 0) > 0) return true; }
    return !!(await env.AMV_KV.get(_autoQuarKey(email)));
  }
  catch(e){ audit(env, 'auto_quarantine_unknown', { email }); return true; }
}
/* POST /admin/auto/release { email }: the operator's replay, after looking. */
async function autoQuarantineRelease(request, env){
  const gate = await _adminGate(request, env, 'autorelease', 10, 200);
  if(gate) return gate;
  let body = {}; try{ body = await request.json(); }catch(e){ body = {}; }
  const email = String(body.email || '').toLowerCase().trim();
  if(!email) return json({ error: 'Name the account: { email }.', code: 'bad_request' }, 400);
  const held = await _autoQuarantined(env, email);
  if(!held) return json({ error: 'That account is not in quarantine.', code: 'not_quarantined' }, 404);
  if(env.AMV_COUNTER) await counter(env, _autoQuarName(email), { op: 'clear' });
  await env.AMV_KV.delete(_autoQuarKey(email));
  await env.AMV_KV.delete(_autoDeadKey(email));
  await _autoBucketAdd(env, email, Date.now());
  audit(env, 'auto_quarantine_released', { email });
  return json({ ok: true, released: email });
}
async function _autoQueueDead(batch, env){
  const emails = [], quarantined = [];
  for(const msg of (batch.messages || [])){
    /* A dead email pointer: the record is still in the outbox, and the tick
       sends it - nothing more to do here. */
    if(msg.body && msg.body.kind === 'outbox'){ audit(env, 'outbox_queue_dead', {}); msg.ack(); continue; }
    const email = await _qWho(env, msg.body);
    if(email){
      audit(env, 'auto_queue_dead', { email, attempts: Number(msg.attempts) || 0 });
      let before = null; try{ before = await env.AMV_KV.get(_autoDeadKey(email)); }catch(e){ before = null; }
      if(before){
        try{ if(env.AMV_COUNTER) await counter(env, _autoQuarName(email), { op: 'incr', amount: 1, keep: true }); }catch(e){ audit(env, 'auto_quarantine_mark_failed', { email }); }
        try{ await env.AMV_KV.put(_autoQuarKey(email), JSON.stringify({ at: Date.now(), attempts: Number(msg.attempts) || 0 })); }catch(e){}
        audit(env, 'auto_quarantined', { email });
        quarantined.push(email);
      } else {
        emails.push(email);
        try{ await env.AMV_KV.put(_autoDeadKey(email), String(Date.now()), { expirationTtl: 86400 }); }catch(e){}
        try{ await _autoBucketAdd(env, email, Date.now()); }catch(e){}
      }
    }
    msg.ack();
  }
  if(quarantined.length){
    try{ await alertOnce(env, 'auto_quarantined',
      'Background work for ' + quarantined.length + ' account(s) reached the dead-letter queue twice in a day and is in quarantine: it will not run again until released '
      + '(POST /admin/auto/release { email }). The errors are in the audit log as auto_queue_run_failed.', 60); }catch(e){}
  }
  if(emails.length){
    try{ await alertOnce(env, 'auto_queue_dead',
      'Background work for ' + emails.length + ' account(s) failed every retry and reached the dead-letter queue. '
      + 'Each is booked to be tried once more; a second failure within a day puts it in quarantine. The errors are in the audit log as auto_queue_run_failed.', 60); }catch(e){}
  }
}

/* Which queue a batch came from: the dead-letter queue's name ends "-dead"
   (wrangler.toml). Anything else is the work queue. */
async function queueHandler(batch, env, ctx){
  _liveCtx = ctx;
  if(/-dead$/.test(String(batch.queue || ''))) return _autoQueueDead(batch, env);
  return _autoQueueConsume(batch, env);
}
