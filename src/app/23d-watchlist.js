/* ══════════════════════════════════════════════════════════════════════════
   THINGS AMV IS WATCHING FOR A PRICE.

   "Buy this from this website when it is at 200." Two halves, and only one of
   them is new: watching a page and telling you what changed is what the
   scheduler already does, and buying inside a limit is what AMV Spend already
   does. What was missing is the thing in between - somewhere to say WHICH page
   and WHICH price, and have that become a real job rather than a note.

   SO EACH ENTRY IS A REAL SCHEDULED AUTOMATION. It goes to /auto/create, the
   same scheduler the cron walks, with the same plan gating and the same job
   limit as every other background job. A watch that lived only in this browser
   would stop the moment the tab closed, which is the opposite of what somebody
   asking for it wants.

   AND IT ASKS BEFORE IT BUYS. `approval:'require'` is not configurable here.
   The spending limits are a ceiling on what AMV may spend without asking; a
   standing instruction to buy something while nobody is looking is a different
   thing, and it is not one this screen is willing to create. AMV finds the
   price, stops, and shows you the purchase.
   ══════════════════════════════════════════════════════════════════════════ */

const WATCH_KEY = 'amv_watchlist';
const WATCH_MAX = 25;

function _watchAll(){
  try{ const l = load(WATCH_KEY); return Array.isArray(l) ? l : []; }catch(e){ return []; }
}
function _watchSave(l){ try{ store(WATCH_KEY, (l || []).slice(0, WATCH_MAX)); }catch(e){} }

/* The sentence the scheduler actually runs. Built from the fields rather than
   typed by somebody, so a watch cannot say one thing on this screen and
   another to the job. */
function _watchDetail(w){
  return 'Check ' + w.url + ' for the current price of ' + w.item
    + '. If it is at or below ' + _mfMoney(w.target) + ', stop and show me the purchase to approve'
    + ' - do not buy anything on your own. If it is above, say the price and do nothing.';
}

function _watchRow(w){
  return '<div class="wl-row">'
    + '<div class="wl-b">'
      + '<div class="wl-n">' + escH(w.item) + '</div>'
      + '<div class="wl-h">' + escH(T('at or below')) + ' <b>' + escH(_mfMoney(w.target)) + '</b>'
        + ' · ' + escH(w.host || w.url) + '</div>'
    + '</div>'
    + '<div class="wl-a">'
      + (w.jobId
          ? '<span class="wl-live">' + escH(T('Watching')) + '</span>'
          : '<span class="wl-local">' + escH(T('This device only')) + '</span>')
      + '<button type="button" class="wl-x" data-wl-rm="' + escH(w.id) + '"'
        + ' aria-label="' + escH(T('Stop watching') + ' ' + w.item) + '">' + escH(T('Stop')) + '</button>'
    + '</div>'
  + '</div>';
}

function watchlistHTML(){
  const l = _watchAll();
  return '<section class="spv-sec wl">'
    + '<h2 class="set-title">' + escH(T('Watching for a price')) + '</h2>'
    + '<div class="set-sub">' + escH(T('Tell AMV what to look for and the price you would pay. It checks every day, and when it finds it, it stops and shows you the purchase - it never buys on its own.')) + '</div>'
    + '<div class="wl-list" id="wl-list">'
      + (l.length ? l.map(_watchRow).join('')
         : '<p class="wl-none">' + escH(T('Nothing on the list yet.')) + '</p>')
    + '</div>'
    + '<div class="wl-add">'
      + '<label class="ml-f"><span>' + escH(T('What')) + '</span>'
        + '<input id="wl-item" type="text" maxlength="80" autocomplete="off" placeholder="' + escH(T('Noise-cancelling headphones')) + '"></label>'
      + '<label class="ml-f"><span>' + escH(T('Where')) + '</span>'
        + '<input id="wl-url" type="url" autocomplete="off" spellcheck="false" placeholder="https://…"></label>'
      + '<label class="ml-f wl-f-p"><span>' + escH(T('Buy at or below')) + '</span>'
        + '<input id="wl-target" type="number" min="1" step="1" inputmode="decimal" placeholder="200"></label>'
      + '<button class="btn bp" id="wl-go">' + escH(T('Watch this')) + '</button>'
    + '</div>'
    + '<div class="fam-say" id="wl-say" role="status" aria-live="polite"></div>'
  + '</section>';
}

function _watchSay(t, cls){
  const el = $('wl-say');
  if(el){ el.textContent = t || ''; el.className = 'fam-say' + (cls ? ' ' + cls : ''); }
}

function wireWatchlist(redraw){
  const again = typeof redraw === 'function' ? redraw : function(){};
  document.querySelectorAll('[data-wl-rm]').forEach(b => on(b, 'click', () => {
    const id = b.dataset.wlRm;
    const w = _watchAll().find(x => x.id === id);
    _watchSave(_watchAll().filter(x => x.id !== id));
    /* The job goes with it. A watch removed from this list while its
       automation keeps running is the worst of both: nothing on screen says
       it exists, and it still checks every day. */
    if(w && w.jobId){
      try{ _autoApi('/auto/update', { id: w.jobId, action: 'cancel' }); }catch(e){}
    }
    again();
  }));

  on($('wl-go'), 'click', async () => {
    const item = (($('wl-item') || {}).value || '').trim();
    const url = (($('wl-url') || {}).value || '').trim();
    const target = Number(($('wl-target') || {}).value || 0);
    if(!item){ _watchSay(T('Say what to look for.'), 'err'); return; }
    if(!/^https?:\/\/\S+\.\S+/i.test(url)){ _watchSay(T('That does not look like a web address.'), 'err'); return; }
    if(!(target > 0)){ _watchSay(T('Give the price you would pay.'), 'err'); return; }
    if(_watchAll().length >= WATCH_MAX){ _watchSay(T('That is as many as one account can watch.'), 'err'); return; }

    let host = '';
    try{ host = new URL(url).hostname.replace(/^www\./, ''); }catch(e){ host = ''; }
    const w = { id: 'w' + Date.now().toString(36), item, url, host, target, at: Date.now(), jobId: '' };

    const go = $('wl-go');
    if(go){ go.disabled = true; go.textContent = T('Setting it up…'); }
    /* THE JOB FIRST, THE LIST SECOND.

       Saved before the scheduler answered, this would show "Watching" for a
       job that was refused - by the plan limit, by the job cap, by there
       being no backend at all - and nothing would ever check the price. The
       entry records which of those happened instead. */
    let res = { ok: false, code: 'no_service' };
    try{
      if(typeof _mcScheduleServer === 'function'){
        res = await _mcScheduleServer({ goal: _watchDetail(w), freq: 'daily',
                                        kind: 'watch', approval: 'require' });
      }
    }catch(e){ res = { ok: false, code: 'failed', error: (e && e.message) || '' }; }
    if(res.ok) w.jobId = res.id || '';
    _watchSave([w].concat(_watchAll()));

    if(go){ go.disabled = false; go.textContent = T('Watch this'); }
    /* THE REDRAW FIRST, THE SENTENCE AFTER IT.

       Said before, the confirmation was written into an element the redraw
       then threw away - so a watch that worked perfectly reported nothing at
       all, which reads as the button having done nothing. */
    again();
    if(res.ok) _watchSay(T('Watching. AMV checks daily and will show you the purchase to approve.'), 'ok');
    else {
      /* Named, and not as a success. A watch that only runs while this tab is
         open is a different promise from one that runs every day, and saying
         so is the difference between a feature and a disappointment. */
      const why = (typeof _mcWhereItRuns === 'function') ? _mcWhereItRuns(res) : '';
      _watchSay(T('Saved, but AMV could not schedule it.') + (why || ' ' + ((res && res.error) || '')), 'err');
    }
  });
}
try{ window.watchlistHTML = watchlistHTML; window.wireWatchlist = wireWatchlist; }catch(e){}
