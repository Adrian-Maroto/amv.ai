
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

const AUTO_QUEUE_BATCH = 100;          // the provider's sendBatch ceiling
const AUTO_QUEUE_CLAIM_S = 5 * 60;     // one message per account per five minutes
const AUTO_QUEUE_RETRY_S = 60;         // first retry after a minute, then longer

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
      await env.AMV_JOBS.sendBatch(slice.map(u => ({ body: { email: u.id, due: u.soonest || now, at: now } })));
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
async function _autoQueueConsume(batch, env){
  let killed = false;
  try{ killed = (await env.AMV_KV.get('GLOBAL_KILL')) === '1'; }catch(e){ killed = true; }
  let off = false;
  try{ off = await _switchedOff(env, 'feature:automations'); }catch(e){ off = true; }
  for(const msg of (batch.messages || [])){
    const body = msg.body || {};
    const email = String(body.email || '').toLowerCase();
    if(!email){ msg.ack(); continue; }
    /* Stopped on purpose: acknowledged, not retried. The job keeps its place
       and its next run, and the first tick after the switch is back on sends
       it again - the same as the tick does when it is stopped. */
    if(killed || off){ msg.ack(); continue; }
    try{
      const rec = await DB.get(env, 'auto', email);
      if(!rec || rec.paused || !Array.isArray(rec.items) || !rec.items.length){ msg.ack(); continue; }
      const now = Date.now();
      const r = await _autoRunAccount(env, email, rec, now, now + AUTO_TICK_BUDGET_MS);
      if(r.ran || r.failed) console.log('[queue] automations', JSON.stringify({ email, ...r }));
      msg.ack();
    }catch(e){
      const n = Number(msg.attempts) || 1;
      audit(env, 'auto_queue_run_failed', { email, attempt: n, error: String((e && e.message) || e).slice(0, 160) });
      try{ await _workerError(env, 'queue.automations', e); }catch(_){}
      msg.retry({ delaySeconds: Math.min(AUTO_QUEUE_RETRY_S * n * n, 3600) });
    }
  }
}

/* THE DEAD-LETTER QUEUE: an account whose run failed every retry. Said once
   an hour to the operator, put on the record, and booked back into the
   due-work index so the hourly sweep tries it again - a dead letter is a job
   that needs looking at, never a job silently dropped. */
async function _autoQueueDead(batch, env){
  const emails = [];
  for(const msg of (batch.messages || [])){
    const email = String((msg.body && msg.body.email) || '').toLowerCase();
    if(email){
      emails.push(email);
      audit(env, 'auto_queue_dead', { email, attempts: Number(msg.attempts) || 0 });
      try{ await _autoBucketAdd(env, email, Date.now()); }catch(e){}
    }
    msg.ack();
  }
  if(emails.length){
    try{ await alertOnce(env, 'auto_queue_dead',
      'Background work for ' + emails.length + ' account(s) failed every retry and reached the dead-letter queue. '
      + 'Each is booked to be tried again on the hourly sweep; the errors are in the audit log as auto_queue_run_failed.', 60); }catch(e){}
  }
}

/* Which queue a batch came from: the dead-letter queue's name ends "-dead"
   (wrangler.toml). Anything else is the work queue. */
async function queueHandler(batch, env, ctx){
  _liveCtx = ctx;
  if(/-dead$/.test(String(batch.queue || ''))) return _autoQueueDead(batch, env);
  return _autoQueueConsume(batch, env);
}
