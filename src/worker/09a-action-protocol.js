/* =====================================================================
   THE ACTION PROTOCOL - what every write on somebody's account goes through.

     proposal -> permission -> execution -> verification -> receipt
              -> undo (or the honest reason there is none) -> audit

   The proposal and the permission are the page's and the grant's: a write is
   asked in the browser before the request is made, and the server refuses
   without the capability (connUse). This file owns the second half, which is
   the half that decides what AMV is allowed to SAY afterwards.

   VERIFICATION. Each action reads its own result back from the provider and
   answers `verified` - only the action knows what to read. The decision about
   that answer is made here, once: true is done, null is "requested, could not
   be checked", false is a failure whatever the status code said, and no answer
   at all is refused as done.

   UNDO. Every write either declares how it is taken back - a compensation that
   is itself read back - or says, in a sentence a person can act on, why it
   cannot be. A write that does neither does not load: the Worker throws at
   start, so an action added later without thinking about this cannot ship.
   "Send" has no undo and says so; that is an answer. Silence is not.

   The undo is a signed ticket, not a stored record. It names the account, the
   action and the one thing that was made, expires, and dies with the account's
   sessions when somebody signs out everywhere. It can only take back what AMV
   itself did: there is no shape of ticket that deletes an event AMV did not
   create, because the ticket is minted here from the provider's own answer and
   nothing outside can forge one.
   ===================================================================== */
const ACT_UNDO_TTL_MS = 24 * 60 * 60 * 1000;
/* The biggest thing a ticket carries is a sheet's earlier values. Past this
   the write still happens and is still verified; it is just not offered back,
   and the receipt says to use the sheet's version history instead. */
const ACT_UNDO_REF_MAX = 6000;

/* What is wrong with a registry of actions, in words. Empty is lawful. */
function _actContractProblems(reg){
  const out = [];
  for (const [name, a] of Object.entries(reg || {})) {
    if (!a || typeof a.run !== 'function') { out.push(name + ' has no run'); continue; }
    if (!a.writes) continue;
    const u = a.undo;
    const hasUndo = !!(u && typeof u.run === 'function' && typeof u.ref === 'function' && u.label);
    const says = typeof a.irreversible === 'string' && a.irreversible.trim().length > 10;
    if (!hasUndo && !says) out.push(name + ' writes, and neither declares an undo nor says why it has none');
    if (hasUndo && says) out.push(name + ' declares an undo and also says it cannot be undone');
  }
  return out;
}

/* The receipt for one write: what happened, as checked, and how to take it
   back. Never throws - a receipt that cannot be made leaves the action done
   and reported, without the offer. */
async function _actReceipt(env, email, name, spec, args, result){
  const v = result && typeof result === 'object' ? result.verified : undefined;
  const rec = { action: name, status: v === true ? 'done' : 'unconfirmed', at: Date.now(), undo: null, irreversible: null };
  if (spec.irreversible) { rec.irreversible = spec.irreversible; return rec; }
  try {
    const ref = spec.undo.ref(result, args);
    if (!ref) { rec.irreversible = spec.undo.none || 'This one cannot be taken back from AMV.'; return rec; }
    if (JSON.stringify(ref).length > ACT_UNDO_REF_MAX) {
      rec.irreversible = spec.undo.tooBig || 'This was too large to take back from AMV.';
      return rec;
    }
    const epoch = await _tokenEpoch(env, email);
    const token = await signToken({ email, act: name, ref }, env.JWT_SECRET, { typ: 'undo', ttlMs: ACT_UNDO_TTL_MS, epoch });
    rec.undo = { token, label: spec.undo.label, until: Date.now() + ACT_UNDO_TTL_MS };
  } catch (e) {
    audit(env, 'action_receipt_failed', { by: email, action: name, error: String((e && e.message) || e).slice(0, 80) });
  }
  return rec;
}

/* A result as the browser sees it. What only the server needed - an earlier
   copy of somebody's cells, a full commit id - is a field starting with `_`,
   and it goes in the ticket or nowhere, on every path: the failure answer
   included, which is the one that is easy to forget. */
function _actShown(result){
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  return Object.fromEntries(Object.entries(result).filter(([k]) => !k.startsWith('_')));
}

/* POST /v1/connect/undo { token } -> take back one thing AMV did. */
async function connUndo(request, env){
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  { const k = _refuseApiKey(user, 'take back an action on a connected account'); if (k) return k; }
  if (!connConfigured(env)) return json({ error: 'not_configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const t = await verifyToken(String(body.token || ''), env.JWT_SECRET, env, 'undo');
  /* Expired, forged, revoked and somebody else's all read the same: a ticket
     that does not take anything back. Which one it was is nobody's business
     but the log's. */
  if (!t || String(t.email || '').toLowerCase() !== String(user.email).toLowerCase()) {
    if (t) audit(env, 'undo_wrong_account', { by: user.email });
    return json({ error: 'undo_expired', message: 'That can no longer be undone from AMV. Change it in the account itself.' }, 410);
  }
  const name = String(t.act || '');
  const spec = CONN_ACTIONS[name];
  if (!spec || !spec.undo) return json({ error: 'undo_expired', message: 'That can no longer be undone from AMV. Change it in the account itself.' }, 410);

  const blocked = await guardAction(env, 'connact:w:' + user.email, 10, 100, 'actions on your connected accounts');
  if (blocked) return blocked;
  const got = await connUse(env, user.email, spec.undo.need || spec.need, 'undo:' + name, { attended: true });
  if (!got.ok) return json({ error: got.code, message: 'That connection cannot take this back right now. Change it in the account itself.' }, 409);

  let v;
  try { v = await spec.undo.run(got.token, t.ref || {}); }
  catch (e) {
    audit(env, 'action_undo_failed', { by: user.email, action: name, error: String((e && e.message) || e).slice(0, 120) });
    return json({ error: 'undo_failed', message: 'That could not be undone. Nothing else was changed.' }, 502);
  }
  /* Somebody (or something) changed it after AMV did. Putting AMV's "before"
     back now would throw their work away, so it is refused and said. */
  if (v === 'moved') {
    audit(env, 'action_undo_refused', { by: user.email, action: name });
    return json({ error: 'changed_since', message: 'It has been changed since AMV did it, so AMV left it alone. Change it in the account itself.' }, 409);
  }
  if (v === false) {
    audit(env, 'action_undo_not_confirmed', { by: user.email, action: name });
    return json({ error: 'not_confirmed', message: 'The account said yes, but when AMV checked, it was still there. Look in the account.' }, 502);
  }
  audit(env, 'action_undone', { by: user.email, action: name, verified: v === true });
  return json({ ok: true, action: name, undone: true, verified: v === true ? true : null,
    message: v === true ? 'Undone.' : 'Asked to undo it, but AMV could not check afterwards. Look in the account.' });
}

/* Checked when the Worker starts. A write without an answer to "and how is
   this taken back?" is a write that does not ship. */
{
  const p = _actContractProblems(CONN_ACTIONS);
  if (p.length) throw new Error('Action contract broken: ' + p.join('; '));
}
