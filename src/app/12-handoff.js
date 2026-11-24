/* ============================================================
   HANDOFF  - pass any task/chat/draft to another user or to Crew.
   They get full context, continue or approve, and pass it back.
   Stored per-account; recipient sees it in their own Handoff inbox.
   (Live cross-user delivery activates with the server backend; this
   is the full UX + local record.)
   ============================================================ */
/* HANDOFF'S SCREEN LIVES IN handoff-view.js (src/handoff/), fetched when it is
   first drawn - it is a screen only some people open, and the page has a
   weight ceiling every visitor pays for. What stays here is what the rest of
   the app calls, and each is a no-op unless handed-over work is on this
   device (a chat or design with `ho`), so nobody who never uses Handoff ever
   downloads it. */
function renderHandoffView(){ _lazyScreen('handoff-view.js', renderHandoffView, 'renderHandoffView', 'Handoff'); }
function _hoView(){ return _lazyLoad('handoff-view.js', () => typeof window._hoPushSoon === 'function'); }
function _hoHasLinked(){
  return (S.convs||[]).some(c => c && c.ho) || ((typeof _SESSIONS !== 'undefined' && _SESSIONS) || []).some(x => x && x.ho);
}
/* The inbox and sent lists, from the server - when Handoff is opened. */
function _handoffSyncLive(){
  if(!(window.AMV_API && AMV_API.live)) return;
  _hoView().then(ok => { if(ok) return window._hoSyncNow(); })
    .catch(e => { try{ console.error('AMV: handoffs could not be refreshed', e); }catch(_){} });
}
/* Save back what changed in handed-over work (called when the history redraws). */
function _hoSchedulePush(now){
  if(!(window.AMV_API && AMV_API.live) || !_hoHasLinked()) return;
  _hoView().then(ok => { if(ok) window._hoPushSoon(now); })
    .catch(e => { try{ console.error('AMV: handed-over work could not be saved back', e); }catch(_){} });
}
/* Bring in what the other person did, when a linked chat or design opens. */
function _hoPullInto(localId){
  if(!(window.AMV_API && AMV_API.live)) return;
  const linked = (S.convs||[]).some(c => c && c.id === localId && c.ho)
    || ((typeof _SESSIONS !== 'undefined' && _SESSIONS) || []).some(x => x && x.id === localId && x.ho);
  if(!linked) return;
  _hoView().then(ok => { if(ok) return window._hoPullIntoNow(localId); })
    .catch(e => { try{ console.error('AMV: handed-over work could not be refreshed', e); }catch(_){} });
}
