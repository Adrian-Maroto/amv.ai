/* ══════════════════════════════════════════════════════════════════════
   CREW JOBS · APPROVALS · HANDOFF - per-user sync

   These features work locally in the browser; these endpoints persist them
   server-side so they sync across a user's devices (and, for handoff, reach
   another user). Stored per-user in KV under crewjobs:/approvals:/handoff:.
   ══════════════════════════════════════════════════════════════════════ */

async function crewJobs(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  if(request.method === 'POST'){
    const blocked = await guardAction(env, `crewjob:${user.email}`, 30, 500, 'job updates');
    if(blocked) return blocked;
    const { id, on } = await request.json().catch(()=>({}));
    if(!id) return json({ error:'id required' }, 400);
    /* AMV-033: one person with two tabs is two writers. The lock roster
       excused every one of these as "the caller's own record", which is true
       and is not the same as "one writer" - a phone and a laptop, or a retry
       landing beside the original, both read the record and both write it
       back, and the later one silently drops the earlier change. */
    await _withKind(env, 'crewjobs', user.email, (rec) => {
      rec.jobs = rec.jobs || {};
      rec.jobs[id] = { key:id, on_flag: !!on, updatedAt: Date.now() };
    }, { jobs:{} });
    return json({ ok:true });
  }
  const rec = (await DB.get(env, 'crewjobs', user.email)) || { jobs:{} };
  return json({ ok:true, jobs: Object.values(rec.jobs || {}) });
}

async function crewApprovals(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const rec = (await DB.get(env, 'approvals', user.email)) || { items:[] };
  return json({ ok:true, approvals: rec.items || [] });
}

/* Editing a pending approval before you approve it.

   The client has always sent this - fire and forget, `.catch(()=>{})` - and no
   route existed, so every edit 404'd silently and lived only in the browser
   that made it. Approving from a second device then sent the ORIGINAL.

   The patch is whitelisted rather than merged. An approval is a pending action
   against somebody's real accounts, so a caller must not be able to reach in
   and set fields the UI never offers - most of all anything that could make it
   approve itself. */
const APPROVAL_PATCH_KEYS = ['title', 'destination', 'recipients', 'scheduledAt', 'recurrence', 'from', 'result'];
const APPROVAL_ITEM_MAX = 64 * 1024;

async function crewApprovalEdit(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const blocked = await guardAction(env, 'apvedit:' + user.email, 60, 300, 'approval edits');
  if(blocked) return blocked;

  const body = await request.json().catch(()=>({}));
  const id = String(body.id || '');
  const patch = (body.patch && typeof body.patch === 'object') ? body.patch : null;
  if(!id) return json({ error:'id required' }, 400);
  if(!patch) return json({ error:'patch required' }, 400);

  const rec = (await DB.get(env, 'approvals', user.email)) || { items:[] };
  const item = (rec.items || []).find(a => a.id === id);
  /* Only your own queue is ever read, so there is no id here that could belong
     to somebody else - a wrong one is simply absent. */
  if(!item) return json({ error:'no such approval' }, 404);

  const next = Object.assign({}, item);
  for(const k of APPROVAL_PATCH_KEYS){
    if(!(k in patch)) continue;
    const v = patch[k];
    if(k === 'recipients'){ next[k] = Math.max(0, Math.min(100000, Math.floor(+v) || 0)); continue; }
    if(k === 'scheduledAt'){ next[k] = v ? String(v).slice(0, 40) : null; continue; }
    if(typeof v === 'string'){ next[k] = v.slice(0, 4000); continue; }
    next[k] = v;
  }
  /* A single approval must not be able to fill the record. Checked on the
     ASSEMBLED item, because the patch being small says nothing about the
     result of applying it. */
  if(JSON.stringify(next).length > APPROVAL_ITEM_MAX)
    return json({ error:'That edit is too large to save.', code:'too_big' }, 413);

  /* UNDER THE LOCK, because _enqueueApproval writes this same record whenever
     an autonomous run produces something to approve. Editing one read the
     queue, changed an entry and wrote the whole queue back - so an approval
     that arrived in between is erased by the edit, and the thing it was asking
     permission for silently never gets asked about again.

     Re-found inside the lock, not carried in from the read above: the entry
     may have been acted on while this request was being validated, and
     writing `next` over a decision somebody already made is the same lost
     write from the other direction. */
  const saved = await _withKind(env, 'approvals', user.email, (fresh) => {
    if(!fresh || !Array.isArray(fresh.items)) return null;
    const at = fresh.items.findIndex(a => a && a.id === id);
    if(at < 0) return null;
    fresh.items[at] = next;
    return next;
  }, { items: [] });
  if(!saved) return json({ error:'no such approval' }, 404);
  return json({ ok:true, approval: saved });
}

async function crewApprovalAct(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { id, action } = await request.json().catch(()=>({}));
  if(!id) return json({ error:'id required' }, 400);
  const rec = (await DB.get(env, 'approvals', user.email)) || { items:[] };
  const item = (rec.items || []).find(a => a.id === id);

  /* Not every approval on somebody's screen came from the server - some flows
     create one locally and never enqueue it. Nothing to resolve here is not an
     error, or the client would be told its own local item had failed. */
  if(!item) return json({ ok:true, action: action || 'resolved', found:false, delivered:null });

  /* Approving a held result is what DELIVERS it. This used to remove the item
     and return ok:true for approve and reject alike, so the screen said "Sent"
     and nothing was ever sent - the whole require-approval flow is "the
     finished work waits until you say go", and nothing was behind the go.
     Only an item the job asked to be EMAILED has anything to deliver; a
     review-only one is genuinely resolved by being read. */
  /* THE DEADLINE IS ENFORCED HERE, not on the screen that shows it. The client
     draws the countdown; the client is also the half an attacker or a stale tab
     controls, so the answer to "may this still go out" is given by the server
     or it is not given at all. */
  if(action === 'approve' && _apvExpired(item, Date.now())){
    const exp = _apvExpiresAt(item);
    audit(env, 'approval_expired', { by: user.email, action: 'approve', expiredAt: exp || null });
    return json({
      error: 'approval_expired',
      expiredAt: exp || null,
      message: exp
        ? 'This has been waiting since before it expired, so AMV did not send it. The facts in it may have moved on. Run the job again for a fresh one.'
        : 'AMV cannot tell how old this is, so it did not send it. Run the job again for a fresh one.',
    }, 409);
  }

  let delivered = null;
  if(action === 'approve' && item.actionType === 'send'){
    if(!env.EMAIL_API_KEY){
      delivered = false;                     // approved, but there is no way to send it
    } else {
      /* CLAIMED BEFORE THE SEND, because the send is the irreversible part.

         The removal below is inside a lock; the send was not. Two requests
         carrying the same approval id - a double press, a retry after a slow
         response, two tabs - both found the item, both sent, and both removed
         it and reported success. The person's draft went to their client
         twice, from the one flow whose entire premise is that they decide
         once. Measured, not reasoned about: two concurrent approvals produced
         two emails and two `delivered:true` answers.

         Released only on FAILURE, so a genuine retry can still send and a
         success cannot be repeated. Keyed per approval, or approving two
         things in the same second would drop the second one - a fix that
         breaks the feature is not a fix. */
      const sendKey = user.email + ':' + id;
      if(!(await _claimOnce(env, 'apvsend', sendKey, 3600))){
        /* Somebody else is delivering this one. Not an error and not a
           success: saying "sent" for a send this request did not make is the
           habit this whole handler exists to break. */
        audit(env, 'approval_duplicate', { by:user.email, id });
        return json({ ok:true, action:'approve', found:true, delivered:null, duplicate:true });
      }
      try{
        /* _sendEmail answers with a BOOLEAN, not a throw - a refused send comes
           back as false. Awaiting it and assuming success is the very defect
           this function is being fixed for, one layer down. */
        const wentOut = await _autoEmailResult(env, user.email,
          { kind:'task', detail: item.title, notify:'email' },
          (item.result && item.result.body) || item.preview || '');
        if(!wentOut){
          try{ await _releaseClaim(env, 'apvsend', sendKey); }catch(_){}
          return json({ error:'The email provider would not accept it, so nothing was sent.',
                        code:'send_failed' }, 502);
        }
        delivered = true;
      }catch(e){
        /* The item STAYS, and so does the right to try again - a claim kept
           after a failure is how a retry gets discarded as a duplicate of work
           that never happened. */
        try{ await _releaseClaim(env, 'apvsend', sendKey); }catch(_){}
        return json({ error:'Could not send it: ' + String((e && e.message) || e).slice(0,200),
                      code:'send_failed' }, 502);
      }
    }
  }

  /* AMV-206: the decision removes ONE item from the queue as it is inside the
     lock. Writing the whole list back from a copy read at the top of the request
     put every approval enqueued since then back in front of the person, or - the
     other way round - lost the decision they had just made. */
  await _withKind(env, 'approvals', user.email, (fresh) => {
    fresh.items = (fresh.items || []).filter(a => a.id !== id);   // approve/reject both resolve it
  }, { items: [] });
  /* WHAT THEY SAID, against the job that asked. Only for a card a job produced:
     a one-off draft has no rule to offer and counting it would put somebody's
     answer about one thing onto a job they were not thinking about. */
  if(item && item.fromJob){
    try{
      await _withAuto(env, _autoKey(user.email), (fresh) => {
        if(fresh) _tallyRecord(fresh, item.fromJob, action === 'approve' ? 'yes' : 'no');
      }, { items:[], results:[] });
    }catch(e){ /* the decision stands whether or not the tally did - this is a
                  convenience, and it must never be able to fail a real one. */ }
  }
  audit(env, 'approval_act', { by:user.email, action: action || 'resolved', delivered });
  return json({ ok:true, action: action || 'resolved', found:true, delivered });
}

async function handoffList(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const mine = (await DB.get(env, 'handoff', user.email)) || { incoming:[], sent:[] };
  return json({ ok:true, incoming: mine.incoming || [], sent: mine.sent || [] });
}

async function handoffCreate(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  // Cross-user write - guard against spamming another user's inbox.
  const blocked = await guardAction(env, `handoff:${user.email}`, 10, 100, 'handoffs');
  if(blocked) return blocked;
  const { title, context, to } = await request.json().catch(()=>({}));
  if(!title || !to) return json({ error:'title and recipient required' }, 400);
  const toEmail = String(to).toLowerCase().trim();
  const id = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  const entry = { id, from_email: user.email, to_email: toEmail,
                  title: String(title).slice(0,300), context: String(context||'').slice(0,5000),
                  status: 'pending', at: Date.now() };
  /* AMV-033: THE RECIPIENT'S INBOX HAS AS MANY WRITERS AS IT HAS SENDERS.

     The lock roster excused this handler because it "writes the SENDER's own
     copy". It writes both, and the second one is somebody else's record - an
     inbox every other sender appends to as well. Two people handing work to the
     same person at the same moment both read that inbox, both append, and the
     later write wins: one handoff is simply gone, and the sender who lost is
     told it was delivered.

     The sender's own record needs the lock too, for the same reason as
     everything else here: two tabs, or this and handoffAct at once. */
  /* AMV-SP-06: THE ONE THAT MATTERS FIRST, AND SUCCESS ONLY WHEN IT LANDED.

     These ran the other way round: the sender's own copy, then the recipient's
     inbox, then ok:true. If the second write failed the exception went to the
     top and the sender got a 500 - with their own "sent" list already saying
     they had sent it. So their screen shows a handoff that was delivered
     nowhere, and the honest thing for them to do about a 500 is send it again,
     which is how one lost handoff becomes two duplicates.

     Delivery first. A failure there means nothing was written anywhere and the
     error is true. */
  await _withKind(env, 'handoff', toEmail, (theirs) => {
    theirs.incoming = (theirs.incoming || []).concat(entry).slice(-100);
  }, { incoming:[], sent:[] });

  /* And the sender's own copy after, where a failure is survivable: the handoff
     HAS arrived, and the only thing missing is a line in the sender's history.
     Answering 500 here would be the worst of the options - it is not true, and
     it would have them send it a second time. */
  let recorded = true;
  try {
    await _withKind(env, 'handoff', user.email, (mine) => {
      mine.sent = (mine.sent || []).concat(entry).slice(-100);
    }, { incoming:[], sent:[] });
  } catch (e) {
    recorded = false;
    audit(env, 'handoff_sender_copy_failed', { by: user.email, to: toEmail, id });
  }
  return json({ ok:true, id, recorded,
    ...(recorded ? {} : { warning: 'It was delivered, but AMV could not add it to your own sent list. '
                                 + 'Do not send it again - they have it.' }) });
}

async function handoffAct(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  /* This writes a status onto the SENDER's record too, so it is rate limited
     exactly like handoffCreate, which is the other bounded cross-user write in
     this feature. */
  const blockedAct = await guardAction(env, `handoffact:${user.email}`, 30, 100, 'handoff updates');
  if(blockedAct) return blockedAct;
  const { id, action } = await request.json().catch(()=>({}));
  if(!id) return json({ error:'id required' }, 400);
  /* AMV-033: read and written under the lock, so a status set here cannot be
     lost to a handoff arriving in the same inbox at the same moment. The entry
     is found inside it too - deciding on a copy read beforehand is the same
     race with an extra step. */
  const status = action === 'done' ? 'done' : 'seen';
  let entry = null;
  await _withKind(env, 'handoff', user.email, (mine) => {
    entry = (mine.incoming || []).find(h => h.id === id) || null;
    if (!entry) return;
    mine.incoming = (mine.incoming || []).map(h => h.id === id ? { ...h, status } : h);
  }, { incoming:[], sent:[] });
  if(!entry) return json({ error:'not found' }, 404);

  /* And on the SENDER's copy. Only the recipient's own record was updated, so
     the person who handed the work over went on seeing "waiting on them" for
     ever - including after it was finished. A handoff is a thing between two
     people; marking it done on one side only is half a feature, and the half
     that is missing is the half the sender is watching. */
  const from = String(entry.from_email || '').toLowerCase();
  let notified = true;
  if(from && from !== user.email){
    try{
      /* AMV-033: and this one is unambiguously somebody else's record - the
         sender's, which every person they have ever handed work to writes a
         status into. Read-append-write here loses one of two status updates
         landing together, and the one lost reads as work still waiting. */
      await _withKind(env, 'handoff', from, (theirs) => {
        theirs.sent = (theirs.sent || []).map(h => (h.id === id ? { ...h, status } : h));
      }, { incoming:[], sent:[] });
    }catch(e){
      /* AMV-SP-06: the recipient's own record IS already correct, which is why
         this is not an error - but it is not nothing either. The sender is the
         person watching this status, and the whole point of updating their copy
         is that they stop waiting. Swallowed, it leaves them waiting for ever
         with both sides reporting success. */
      notified = false;
      audit(env, 'handoff_status_not_propagated', { by: user.email, to: from, id, status });
    }
  }
  return json({ ok:true, status, notified,
    ...(notified ? {} : { warning: 'Your side is updated. AMV could not update theirs, so they may still see this as waiting - '
                                 + 'tell them, or set it again in a moment.' }) });
}

