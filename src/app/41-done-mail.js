/* ============================================================
   EMAIL ME WHEN AMV IS DONE
   ============================================================
   Asked for: "make the option like get notified when AMV is done, and if
   they say yes then AMV sends them an email when done".

   Asked ONCE, and only at the moment it means something: an answer has been
   running long enough that somebody might go and do something else. Yes saves
   the choice; Not now saves that too, and Settings -> Account changes either.

   It emails only when it is useful: the work ran a while AND the person was
   not looking when it finished (the tab hidden, or the window not in front).
   Somebody who watched it finish does not need to be told. A Stop is not an
   ending worth an email; a failure is, said as a failure.

   Before agreeing, it asks the server whether this AMV can send email at all,
   so nobody is promised mail that will never come. What the email says, and
   to whom, the server decides - see notifyDone in the Worker. */
const DONE_MAIL_ASK_MS  = 12000;   // running this long, it is worth offering
const DONE_MAIL_LONG_MS = 20000;   // finished sooner than this, it was watched
let _doneTurn = null;

/* '1' yes, '0' no, '' never asked. */
function _doneMailPref(){ return loadStr('amv_done_mail') || ''; }
function _doneMailOn(){ return _doneMailPref() === '1'; }
function _doneMailPossible(){
  return !!(window.AMV_API && AMV_API.live && AMV_API.hasSession && S.user && S.user.email);
}
function _doneMailAway(){
  try{ return document.hidden || !document.hasFocus(); }catch(e){ return false; }
}

function _doneMailStart(kind){
  if(_doneTurn && _doneTurn.t) clearTimeout(_doneTurn.t);
  _doneTurn = { at: Date.now(), kind: kind || 'chat', t: 0 };
  if(!_doneMailPref() && _doneMailPossible()){
    const turn = _doneTurn;
    turn.t = setTimeout(() => { if(_doneTurn === turn) _doneMailAsk(); }, DONE_MAIL_ASK_MS);
  }
}

function _doneMailFinish(how){
  const turn = _doneTurn; _doneTurn = null;
  if(!turn) return;
  if(turn.t) clearTimeout(turn.t);
  _doneMailAskClose();
  how = how || {};
  if(how.stopped) return;                                   // they stopped it themselves
  if(!_doneMailOn() || !_doneMailPossible()) return;
  if(Date.now() - turn.at < DONE_MAIL_LONG_MS) return;      // short enough to have been watched
  if(!_doneMailAway()) return;                              // they are looking at it
  try{ AMV_API.notifyDone({ ok: !how.failed, kind: turn.kind }).catch(() => {}); }catch(e){}
}

function _doneMailAskClose(){ const el = $('done-ask'); if(el) el.remove(); }
function _doneMailAsk(){
  if($('done-ask') || _doneMailPref()) return;
  const el = document.createElement('div');
  el.id = 'done-ask'; el.className = 'done-ask';
  el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Email when done');
  el.innerHTML =
    '<span class="done-ask-t">This is taking a while. Want an email when AMV is done?</span>' +
    '<span class="done-ask-b">' +
      '<button type="button" class="btn bp" id="done-ask-yes">Email me</button>' +
      '<button type="button" class="btn bs" id="done-ask-no">Not now</button>' +
    '</span>';
  document.body.appendChild(el);
  on($('done-ask-no'), 'click', () => { saveStr('amv_done_mail', '0'); _doneMailAskClose(); });
  on($('done-ask-yes'), 'click', async () => {
    const r = await _doneMailSet(true);
    _doneMailAskClose();
    if(r.ok) toast('AMV will email ' + (S.user && S.user.email) + ' when long work finishes while you are away. Change it in Settings → Account.', 'success', 5000);
    else toast(r.why, 'info', 5000);
  });
}

/* Turning it on is checked with the server first; turning it off never is. */
async function _doneMailSet(want){
  if(!want){ saveStr('amv_done_mail', '0'); return { ok: true }; }
  if(!_doneMailPossible()) return { ok: false, why: 'Sign in first - the email goes to your account.' };
  try{
    const d = await AMV_API.notifyDone({ probe: true });
    if(!d || !d.emailReady) return { ok: false, why: 'This AMV cannot send email yet, so this stays off. Nothing else changes.' };
  }catch(e){ return { ok: false, why: 'AMV could not reach the server to check, so this stays off. Try again in a moment.' }; }
  saveStr('amv_done_mail', '1');
  return { ok: true };
}
try{ window._doneMailSet = _doneMailSet; window._doneMailStart = _doneMailStart; window._doneMailFinish = _doneMailFinish; }catch(e){}
