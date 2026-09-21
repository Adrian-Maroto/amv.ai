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
  /* A batch with no id to key on is NOT the same batch as "never dismissed",
     even though both are the empty string. Comparing them directly hid the card
     outright for results that arrived without an id or a timestamp - work that
     really was done, silently never shown. An unkeyable batch shows. */
  const batch = _awayBatchId(unread);
  if(batch && _awayDismissed() === batch) return '';

  const items = unread.slice(-5).reverse().map(r => {
    const title = _awaySnippet(r.detail, 70) || 'Scheduled task';
    const body = _awaySnippet(r.out, 150);
    return '<div class="away-item" data-away-id="'+escH(String(r.id||''))+'">'+
      '<button class="away-head" type="button" data-away-open="'+escH(String(r.id||''))+'" aria-expanded="false">'+
        '<span class="away-t">'+escH(title)+'</span>'+
        '<span class="away-w">'+escH(_awayWhen(r.at))+'</span>'+
      '</button>'+
      (body ? '<div class="away-snip" data-no-i18n>'+escH(body)+(String(r.out||'').length > 150 ? '…' : '')+'</div>' : '')+
      '<div class="away-full" data-no-i18n hidden></div>'+
      (body ? '<button class="away-share" type="button" data-away-share="'+escH(String(r.id||''))+'">Share what it found</button>' : '')+
    '</div>';
  }).join('');

  const n = unread.length;
  /* AMV's own words, so they follow the user's language even though they sit
     inside the chat area's translation guard (AMV-093). The result bodies below
     are NOT marked - those are model output and stay exactly as written. */
  return '<div class="away-card" data-i18n role="region" aria-label="Work completed while you were away">'+
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

/* ── SHOWING SOMEBODY WHAT IT DID WHILE YOU SLEPT ───────────────────────────

   Asked for: cool things people can post about, that make somebody want to
   use the site.

   The thing worth posting already happens. AMV finds four subscriptions
   somebody forgot and puts a real number on them; it reads a night of mail and
   says six of fifty-eight needed you; it watches a supplier page and catches a
   lead time doubling before the quote goes out. What was missing is that all
   of it was PRIVATE. There was no way to show anyone, so the best moment in
   the product reached exactly one person, and the page that would have carried
   "Try AMV free" to their friends was never created.

   WHY THIS DOES NOT JUST CALL THE SHARE MODAL.

   Because that modal creates the public page the instant it opens - reasonable
   for a chat somebody is looking at, and wrong here. A background result can
   contain the contents of their inbox, their bank, their calendar: the whole
   point of Crew is that it went and read things. Publishing that before they
   have seen what is in it is the single worst thing this feature could do, and
   it would do it silently and irreversibly-ish, because a link can be revoked
   but a copy cannot.

   So nothing is created until they have read the actual text that would go
   public, in full, and pressed a button that says so. The warning names the
   real hazard rather than gesturing at privacy in general: this ran against
   your accounts, so look before you publish.

   After the confirmation it hands over to the ordinary share machinery, which
   already gets the rest right - off search engines by default, revocable from
   Settings, and the same copy, native-share and export buttons as anything
   else. Two flows for one thing would have drifted. */
function awayShare(id){
  const rec = (Array.isArray(_AUTO_RESULTS) ? _AUTO_RESULTS : []).find(r => String(r.id) === String(id));
  const out = (rec && rec.out) || '';
  if(!out){ try{ toast('This run produced nothing to share.', 'info'); }catch(e){} return; }
  const title = _awaySnippet(rec.detail, 70) || 'What AMV did on its own';
  const ovr = document.getElementById('ovr'); if(!ovr) return;
  /* WHICH OF THE TWO SHARES THIS WILL BE, decided here the same way the share
     itself decides it, because the sentence describing it has to be true.

     With a backend there is a hosted page: revocable from Settings, kept out
     of search, and a link that stops working when somebody wants it to. With
     no backend the fallback packs the whole result into the URL fragment -
     nothing is stored on a server, which sounds like the safer of the two and
     is the more dangerous one to be careless with. There is nothing to revoke.
     The content IS the link, so anybody who has it keeps it, and forwarding it
     forwards the text.

     Saying "this makes a public web page" in that case is simply false, and it
     is false in the direction that matters: it implies a page somebody could
     take down. So the copy switches, and so does the warning - "a link can be
     revoked later" is advice that does not apply and would be read as
     reassurance. */
  const hosted = !!(window.AMV_API && AMV_API.live && AMV_API.hasSession);
  ovr.innerHTML =
    '<div class="share-modal away-share-modal">' +
      '<div class="share-title">Share what AMV found</div>' +
      '<p class="share-sub">' + (hosted
        ? 'This makes a public web page. Nothing is created until you press the button below.'
        : 'This makes a link with the whole result packed inside it - nothing is stored on a server. '
          + 'Nothing is created until you press the button below.') + '</p>' +
      '<div class="away-share-warn">' +
        '<b>Read it first.</b> This ran against your own accounts, so the text below may name people, ' +
        'amounts, messages or dates you would not want in public. ' +
        (hosted
          ? 'A link can be revoked later; a copy somebody already took cannot.'
          : 'This kind of link carries the text itself, so there is nothing to revoke - '
            + 'anyone you send it to keeps it, and so does anyone they send it to.') +
      '</div>' +
      '<div class="away-share-prev" data-no-i18n>' +
        '<div class="away-share-prev-t">' + escH(title) + '</div>' +
        '<div class="away-share-prev-b">' + escH(out) + '</div>' +
      '</div>' +
      '<div class="share-actions">' +
        '<button class="btn bp" id="away-share-go">Create the link</button>' +
        '<button class="btn bs" id="away-share-no">Cancel</button>' +
      '</div>' +
    '</div>';
  ovr.classList.add('on');
  const no = document.getElementById('away-share-no');
  if(no) no.addEventListener('click', () => { try{ closeOvr(); }catch(e){ ovr.innerHTML=''; } });
  const go = document.getElementById('away-share-go');
  if(go) go.addEventListener('click', () => {
    go.disabled = true; go.textContent = 'Creating\u2026';
    /* Shaped as a one-turn conversation because that is what the share page
       renders, and what the hosted store holds. The instruction is the user
       side so the page says what was ASKED as well as what came back - a
       result with no question above it is half a story. */
    _openShareModal({ title: title, msgs: [
      { r:'u', c: String((rec && rec.detail) || title) },
      { r:'a', c: out },
    ] });
  });
}
try{ window.awayShare = awayShare; }catch(e){}

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

  el.querySelectorAll('[data-away-share]').forEach(b => b.addEventListener('click', () => {
    awayShare(b.dataset.awayShare);
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
