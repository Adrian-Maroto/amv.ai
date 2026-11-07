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
  const warn = st.restoreFailed && st.restoreFailed.unverified
      ? '<p class="brg-p brg-warn"><b>' + escH(T('Your saved workspace was kept without a checksum, so AMV cannot check it is intact.')) + '</b> ' + escH(T('It has not been unpacked. Use it anyway, put back one of the copies below, or start fresh - nothing is deleted.')) + '</p>'
        + '<div class="brg-acts"><button class="btn bs" type="button" id="brg-ws-trust">' + escH(T('Use it anyway')) + '</button> <button class="btn bs" type="button" id="brg-ws-fresh">' + escH(T('Start fresh')) + '</button></div>'
    : st.restoreFailed
      ? '<p class="brg-p brg-warn"><b>' + escH(T('Your saved workspace could not be put back.')) + '</b> ' + escH(T('The machine is not running anything until it is. Put back one of the copies below, or start fresh - the copy that failed is kept.')) + '</p>'
        + '<div class="brg-acts"><button class="btn bs" type="button" id="brg-ws-fresh">' + escH(T('Start fresh')) + '</button></div>'
    : st.unsavedHeld
      ? '<p class="brg-p brg-warn"><b>' + escH(T('Your workspace could not be saved.')) + '</b> ' + escH(T('AMV keeps the machine running so nothing is lost, and keeps trying. You can copy your work out of it now. Discarding stops the machine and loses everything since the last saved copy.')) + '</p>'
        + '<div class="brg-acts"><button class="btn bs" type="button" id="brg-ws-discard">' + escH(T('Discard unsaved work')) + '</button></div>'
    : st.lostUnsaved && st.lostUnsaved.chosen
      ? '<p class="brg-p brg-warn">' + escH(T('You discarded the work that could not be saved. The saved copies below are intact.')) + '</p>'
    : st.lostUnsaved
      ? '<p class="brg-p brg-warn"><b>' + escH(T('The last session could not be saved.')) + '</b> ' + escH(T('The workspace stopped after several tries, so work since the last saved copy was lost. The saved copies below are intact.')) + '</p>'
      : '';
  box.innerHTML = warn + '<p class="brg-p">' + escH(!d.current ? T('Nothing has been saved yet. The workspace is saved each time it goes to sleep.')
      : d.current.priorNotKept ? T('Saved {0}. The copy before it could not be kept, so it is not among the ones below.').replace('{0}', when(d.current.at))
      : T('Saved {0}. The five copies before it are kept.').replace('{0}', when(d.current.at))) + '</p>'
    + (rows ? '<ul class="brg-ws-list">' + rows + '</ul>' : '<p class="brg-p">' + escH(T('No earlier copies yet.')) + '</p>');
  const fresh = box.querySelector('#brg-ws-fresh');
  if(fresh) on(fresh, 'click', () => confirmModal(T('Start fresh?'), T('The workspace starts empty. The copy that could not be put back is kept with the saved copies, so you can try it again later.'), async () => {
    let r2, d2;
    try{ r2 = await AMV_API._fetch('/v1/computer/fresh', { method: 'POST', body: '{}' }); d2 = await r2.json().catch(() => null); }catch(e){ d2 = null; }
    if(r2 && r2.ok && d2 && d2.fresh) toast(T('The workspace starts fresh next time AMV uses it.'), 'success', 6000);
    else toast((d2 && d2.error) || T('That could not be done. Nothing changed.'), 'error', 7000);
    await _wsCopiesLoad(box);
  }, { confirm: T('Start fresh') }));
  const choice = (id, path, title, text, label, done, field) => {
    const el = box.querySelector(id);
    if(el) on(el, 'click', () => confirmModal(title, text, async () => {
      let r3, d3;
      try{ r3 = await AMV_API._fetch(path, { method: 'POST', body: '{}', timeout: 120000 }); d3 = await r3.json().catch(() => null); }catch(e){ d3 = null; }
      if(r3 && r3.ok && d3 && d3.saved) toast(T('It saved after all. Nothing was lost.'), 'success', 6000);
      else if(r3 && r3.ok && d3 && d3[field]) toast(done, 'success', 6000);
      else toast((d3 && d3.error) || T('That could not be done. Nothing changed.'), 'error', 7000);
      await _wsCopiesLoad(box);
    }, { confirm: label }));
  };
  choice('#brg-ws-discard', '/v1/computer/discard', T('Discard unsaved work?'), T('AMV tries to save once more. If that fails, the machine stops and everything since the last saved copy is lost. This cannot be undone.'), T('Discard unsaved work'), T('The unsaved work was discarded and the machine stopped.'), 'discarded');
  choice('#brg-ws-trust', '/v1/computer/trust', T('Use the unchecked copy?'), T('AMV cannot confirm this copy is intact. It is unpacked the next time the workspace starts, and saved again with a checksum.'), T('Use it anyway'), T('The copy is used the next time the workspace starts.'), 'trusted');
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
