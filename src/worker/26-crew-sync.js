     looking like the whole is worse than one that shows nothing: the operator
     concludes there is no more abuse. */
  return json({ ok:true, flagged: rows, blockedCount: rows.filter(r=>r.blocked).length,
                truncated, note: truncated
                  ? 'This is not everything. More flagged accounts exist than this screen scanned.' : null });
}

/* POST /admin/abuse/clear - lift a flag (a genuine refund that got caught).
   Admin-only. */
async function abuseClear(request, env){
  const body = await request.json().catch(()=>({}));
  { const g = await _adminGate(request, env, 'abuse.clear', 60, 2000); if (g) return g; }
  const email = String(body.email||'').toLowerCase();
  if(!email) return json({ error:'email required' }, 400);
  const rec = await DB.get(env, 'abuse', email);
  if(!rec) return json({ error:'not found' }, 404);
  /* Same mismatch: abuse records are written through DB, so clearing one has to
     go through DB or the flag survives on D1 and the account stays marked. */
  /* AMV-SP-07: THE FLAG THAT DOES THE BLOCKING IS ON THE OTHER RECORD.

     Two things are true at once about a blocked account: an `abuse` record
     saying why, and `ent.blocked`, which is the fast copy every request
     actually reads. Clearing the flag propagated to both. DELETING the record
     did not - it removed the abuse row and left ent.blocked exactly where it
     was.

     So the outcome of "remove" was the worst available: the account stays
     refused everywhere, and the record that explained why is gone. The operator
     is looking at a screen with nothing on it while the customer cannot use
     anything, and there is no longer any evidence to work back from. Removing
     is the STRONGER of the two operator actions, and it did less. */
  let unblocked = true;
  const liftEntBlock = async () => {
    try {
      await _withEnt(env, email, (e) => {
        if (!e) return;
        delete e.blocked; delete e.blockedReason; delete e.blockedAt;
      });
    } catch (e) {
      unblocked = false;
      audit(env, 'abuse_unblock_not_propagated', { email, error: String((e && e.message) || e) });
    }
  };

  if(body.remove){
    /* The entitlement first. If it fails, the abuse record is still there to
       explain the block - which is the recoverable order to fail in. */
    await liftEntBlock();
    if(!unblocked){
      return json({ error: 'AMV could not lift the block on that account, so it did not delete the record explaining it either. '
                         + 'Nothing was changed - try again in a moment.',
                    code: 'unblock_failed' }, 503);
    }
    await DB.del(env, 'abuse', email);
  }
  else {
    /* UNDER THE LOCK EVERY OTHER WRITER TAKES.
       A dispute arriving from Stripe writes this record through _withKind. An
       operator clearing a flag read it, edited it and wrote it back raw - so a
       chargeback landing in that window is erased by the clear, and the account
       is unmarked with the dispute never recorded. That is money, and it is the
       lock's whole purpose. Re-read inside it rather than trusting the copy
       fetched above. */
    await _withKind(env, 'abuse', email, (fresh) => {
      if(!fresh) return;
      fresh.blocked = false;
      fresh.clearedAt = Date.now();
    }, null);
    /* And on the entitlement, or the account stays refused everywhere that
       reads the fast copy while the operator is looking at a cleared flag. */
    await liftEntBlock();
  }
  audit(env, 'abuse_cleared', { email, removed: !!body.remove, unblocked });
  /* Said rather than assumed. An operator who has just cleared a flag needs to
     know whether the person can actually use the product again, and a bare
     ok:true answers a different question. */
  return json({ ok:true, unblocked,
    ...(unblocked ? {} : { warning: 'The abuse record was cleared, but the block on the account could not be lifted. '
                                  + 'They are still refused - clear it again in a moment.' }) });
}

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
