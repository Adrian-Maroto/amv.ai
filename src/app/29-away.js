/* ============================================================
   AMV-083  WHILE YOU WERE AWAY.

   The background half of AMV already worked. Automations ran on the server on
   their own schedule, produced real answers, and stored them. What happened
   next was a toast that vanished in six seconds and a small number on a nav
   item. So the one thing that makes a product worth returning to - it did
   something for you while you were gone - was the least visible thing in it.

   That asymmetry is the whole retention problem. A user who opens AMV and sees
   work already done comes back tomorrow. A user who opens AMV, sees an empty
   chat box, and has to go looking in a tab called Tasks to discover there was
   a reason to come back, does not.

   So the results are put where the user already is, with the answer readable
   in place. No navigation, no hunting.

   What it refuses to do:
     - It never marks anything read just by rendering. Something that
       disappears because it scrolled past was never delivered.
     - It never appears when there is nothing unread, and never fabricates a
       count. No results, no card.
     - It never appears when the results could not be loaded - a card that says
       "nothing new" because the network failed is a lie.
     - Dismissing says exactly what it does, because it marks every listed
       result read, not only the one that was opened.
   ============================================================ */

/* Dismissed batches, so a card the user has closed does not come back on the
   next render. Keyed by the newest result in the batch: a genuinely NEW result
   makes a new batch, which should appear. */
const AWAY_DISMISS_KEY = 'amv_away_seen';
function _awayDismissed(){ try{ return loadStr(AWAY_DISMISS_KEY) || ''; }catch(e){ return ''; } }
function _awayBatchId(unread){
  return unread.length ? String(unread[unread.length - 1].id || unread[unread.length - 1].at || '') : '';
}

function _awayUnread(){
  try{
    if(!Array.isArray(_AUTO_RESULTS)) return [];
    return _AUTO_RESULTS.filter(r => r && !r.read).sort((a, b) => (a.at || 0) - (b.at || 0));
  }catch(e){ return []; }
}

function _awayWhen(ts){
  const diff = Date.now() - (+ts || 0);
  if(diff < 3600000) return Math.max(1, Math.floor(diff / 60000)) + ' min ago';
  if(diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  try{ return new Date(ts).toLocaleString(undefined, { weekday:'short', hour:'numeric', minute:'2-digit' }); }
  catch(e){ return ''; }
}

/* The opening of the answer, enough to know whether it is worth reading now.
   Markdown markers are stripped rather than rendered - this is a preview line,
   not a document. */
function _awaySnippet(text, n){
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n || 150);
}

function _awayCardHTML(){
  const unread = _awayUnread();
  if(!unread.length) return '';
  if(_awayDismissed() === _awayBatchId(unread)) return '';

  const items = unread.slice(-5).reverse().map(r => {
    const title = _awaySnippet(r.detail, 70) || 'Scheduled task';
    const body = _awaySnippet(r.out, 150);
    return '<div class="away-item" data-away-id="'+escH(String(r.id||''))+'">'+
      '<button class="away-head" type="button" data-away-open="'+escH(String(r.id||''))+'" aria-expanded="false">'+
        '<span class="away-t">'+escH(title)+'</span>'+
        '<span class="away-w">'+escH(_awayWhen(r.at))+'</span>'+
      '</button>'+
      (body ? '<div class="away-snip">'+escH(body)+(String(r.out||'').length > 150 ? '…' : '')+'</div>' : '')+
      '<div class="away-full" hidden></div>'+
    '</div>';
  }).join('');

  const n = unread.length;
  return '<div class="away-card" role="region" aria-label="Work completed while you were away">'+
    '<div class="away-top">'+
      '<div class="away-h">While you were away</div>'+
      '<div class="away-sub">AMV finished '+n+' scheduled '+(n === 1 ? 'task' : 'tasks')+' on its own.</div>'+
    '</div>'+
    '<div class="away-list">'+items+'</div>'+
    (unread.length > 5 ? '<div class="away-more">'+(unread.length - 5)+' more in Tasks.</div>' : '')+
    '<div class="away-acts">'+
      '<button class="btn bs" type="button" data-away-tasks="1">Open Tasks</button>'+
      '<button class="btn bs" type="button" data-away-dismiss="1">Mark all as read</button>'+
    '</div>'+
  '</div>';
}

/* Wire a rendered card. Called with the container the card was rendered into,
   so it works from the empty home screen and from a conversation alike. */
function _wireAwayCard(root){
  const el = root || document;

  el.querySelectorAll('[data-away-open]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.awayOpen;
    const item = btn.closest('.away-item');
    const full = item && item.querySelector('.away-full');
    const snip = item && item.querySelector('.away-snip');
    if(!full) return;
    const open = !full.hidden;
    if(open){
      full.hidden = true; full.innerHTML = '';
      if(snip) snip.hidden = false;
      btn.setAttribute('aria-expanded', 'false');
      return;
    }
    const rec = (Array.isArray(_AUTO_RESULTS) ? _AUTO_RESULTS : []).find(r => String(r.id) === String(id));
    /* Render through the same markdown path as a chat answer, so a scheduled
       result reads exactly like one AMV just wrote. */
    const out = (rec && rec.out) || '';
    full.innerHTML = out
      ? (typeof md === 'function' ? md(out) : '<p>' + escH(out) + '</p>')
      : '<p class="away-empty">This run produced no output.</p>';
    full.hidden = false;
    if(snip) snip.hidden = true;
    btn.setAttribute('aria-expanded', 'true');
  }));

  el.querySelectorAll('[data-away-tasks]').forEach(b => b.addEventListener('click', () => {
    try{ S.tab = 'tasks'; setTab('tasks'); }catch(e){
      try{ S.tab = 'automation'; setTab('automation'); }catch(_){}
    }
  }));

  el.querySelectorAll('[data-away-dismiss]').forEach(b => b.addEventListener('click', async () => {
    /* Remember the batch locally FIRST, so the card goes away immediately even
       if the server call fails - and mark it read on the server, which is what
       makes it stay gone on the user's other devices. */
    try{ saveStr(AWAY_DISMISS_KEY, _awayBatchId(_awayUnread())); }catch(e){}
    const card = b.closest('.away-card'); if(card) card.remove();
    try{ if(typeof _autoMarkRead === 'function') await _autoMarkRead(); }catch(e){}
  }));
}
try{ window._awayCardHTML=_awayCardHTML; window._wireAwayCard=_wireAwayCard; window._awayUnread=_awayUnread; }catch(e){}
