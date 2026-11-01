/* ══ EARLIER COPIES OF THE CLOUD WORKSPACE (Oct 31 audit, item 33) ═══════

   Each time the cloud workspace is saved, the copy it replaces is kept; the
   five newest are kept (cloud/computer.mjs). This lists them on the cloud
   workspace card and puts one back on request. Putting one back keeps the
   copy in use first - including whatever is on the running machine - so it
   can itself be undone, and the machine restarts with the chosen copy. */
function _wsCopiesWire(root){
  root = root || document;
  const btn = root.querySelector('#brg-ws-ver'), box = root.querySelector('#brg-ws-vers');
  if(!btn || !box || btn._amv) return;
  btn._amv = 1;
  on(btn, 'click', async () => {
    if(!box.hidden){ box.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
    box.hidden = false; btn.setAttribute('aria-expanded', 'true');
    await _wsCopiesLoad(box);
  });
}
async function _wsCopiesLoad(box){
  box.innerHTML = '<p class="brg-p">' + escH(T('Loading saved copies\u2026')) + '</p>';
  let r, d;
  try{ r = await AMV_API._fetch('/v1/computer/versions', { method: 'POST', body: '{}' }); d = await r.json().catch(() => null); }
  catch(e){ d = null; }
  if(!r || !r.ok || !d){
    box.innerHTML = '<p class="brg-p brg-warn">' + escH((d && d.error) || T('The saved copies could not be loaded. Check your connection and try again.')) + '</p>';
    return;
  }
  const size = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const when = (iso) => { try{ const c = _lang(); return new Date(iso).toLocaleString(c && c !== 'en' && c !== 'auto' ? c : undefined, { dateStyle: 'medium', timeStyle: 'short' }); }catch(e){ return String(iso || ''); } };
  const rows = (d.versions || []).map(v => '<li class="brg-ws-row"><span>' + escH(when(v.at)) + ' \u00b7 ' + escH(size(v.bytes)) + '</span>'
    + '<button class="btn bs" type="button" data-ws-back="' + escH(v.id) + '">' + escH(T('Put back')) + '</button></li>').join('');
  const st = d.state || {};
  /* What went wrong, said first (Nov 1 audit COMP-001/002). */
  const warn = st.restoreFailed
      ? '<p class="brg-p brg-warn"><b>' + escH(T('Your saved workspace could not be put back.')) + '</b> ' + escH(T('The machine is not running anything until it is. Put back one of the copies below, or start fresh - the copy that failed is kept.')) + '</p>'
        + '<div class="brg-acts"><button class="btn bs" type="button" id="brg-ws-fresh">' + escH(T('Start fresh')) + '</button></div>'
    : st.lostUnsaved
      ? '<p class="brg-p brg-warn"><b>' + escH(T('The last session could not be saved.')) + '</b> ' + escH(T('The workspace stopped after several tries, so work since the last saved copy was lost. The saved copies below are intact.')) + '</p>'
      : '';
  box.innerHTML = warn + '<p class="brg-p">' + escH(d.current ? T('Saved {0}. The five copies before it are kept.').replace('{0}', when(d.current.at)) : T('Nothing has been saved yet. The workspace is saved each time it goes to sleep.')) + '</p>'
    + (rows ? '<ul class="brg-ws-list">' + rows + '</ul>' : '<p class="brg-p">' + escH(T('No earlier copies yet.')) + '</p>');
  const fresh = box.querySelector('#brg-ws-fresh');
  if(fresh) on(fresh, 'click', () => confirmModal(T('Start fresh?'), T('The workspace starts empty. The copy that could not be put back is kept with the saved copies, so you can try it again later.'), async () => {
    let r2, d2;
    try{ r2 = await AMV_API._fetch('/v1/computer/fresh', { method: 'POST', body: '{}' }); d2 = await r2.json().catch(() => null); }catch(e){ d2 = null; }
    if(r2 && r2.ok && d2 && d2.fresh) toast(T('The workspace starts fresh next time AMV uses it.'), 'success', 6000);
    else toast((d2 && d2.error) || T('That could not be done. Nothing changed.'), 'error', 7000);
    await _wsCopiesLoad(box);
  }, { confirm: T('Start fresh') }));
  box.querySelectorAll('[data-ws-back]').forEach(b => on(b, 'click', () => {
    const id = b.getAttribute('data-ws-back');
    confirmModal(T('Put this copy back?'), T('What is in the workspace now is kept as a saved copy first, and the workspace restarts with the one you chose.'), () => _wsCopiesPutBack(box, id), { confirm: T('Put back') });
  }));
}
async function _wsCopiesPutBack(box, id){
    box.querySelectorAll('button').forEach(x => x.disabled = true);
    let rr, dd;
    try{ rr = await AMV_API._fetch('/v1/computer/rollback', { method: 'POST', body: JSON.stringify({ id }), timeout: 180000 }); dd = await rr.json().catch(() => null); }
    catch(e){ dd = null; }
    if(rr && rr.ok && dd && dd.restored){ toast(T('That copy is back. The workspace starts with it next time AMV uses it.'), 'success', 6000); }
    else toast((dd && dd.error) || T('That copy could not be put back. Nothing changed.'), 'error', 7000);
    await _wsCopiesLoad(box);
}
