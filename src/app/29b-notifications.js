/* ============================================================
   NOTIFICATIONS - the bell in the top bar (owner, Nov 24: "anything that
   happened ... you're all caught up, unread, mark all as read").

   It invents nothing. Every row is something the server or this tab already
   holds: a Crew job's result, work somebody handed to you, an approval a job
   is waiting on, a security event on the account. The list lives in
   notifications.js (src/notify/), fetched ahead at idle and on the first press
   - what stays in the page is the bell, its number and the way to open it.
   ============================================================ */
function _notifView(){ return _lazyLoad('notifications.js', () => typeof window._notifOpenNow === 'function'); }
/* How many are unread. Crew results carry the server's own read flag; the
   rest are counted by the file once it has read them (_NOTIF_OTHER). */
var _NOTIF_OTHER = 0;
function _notifCount(){
  let n = 0;
  try{ n += (Array.isArray(_AUTO_RESULTS) ? _AUTO_RESULTS : []).filter(r => r && !r.read).length; }catch(e){}
  return n + (+_NOTIF_OTHER || 0);
}
function _notifPaint(){
  const b = $('notif-btn'); if(!b) return;
  const n = _notifCount(), dot = b.querySelector('.notif-n');
  b.hidden = !S.user;
  b.setAttribute('aria-label', n ? T('Notifications ({0} unread)').replace('{0}', n) : T('Notifications'));
  if(dot){ dot.hidden = !n; dot.textContent = n > 9 ? '9+' : String(n); }
}
function notifToggle(){
  _notifView().then(ok => {
    if(ok){ window._notifOpenNow(); return; }
    toast(T('That could not be loaded. Check your connection and try again.'), 'error');
  }).catch(e => { try{ console.error('AMV: notifications could not be opened', e); }catch(_){} });
}
