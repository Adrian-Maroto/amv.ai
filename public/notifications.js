/* NOTIFICATIONS - the list behind the bell (see 29b-notifications.js).

   Four sources, each read from where it already lives:
     · Crew results    - _AUTO_RESULTS, with the server's read flag; "Mark all
                         as read" tells the server (/auto/read), so a result
                         read here is read on every device.
     · Handed to you   - the Handoff inbox, from the server.
     · Waiting on you  - approvals a Crew job is holding for (this device).
     · Security        - the account's own event log, only the events worth a
                         second look (the toned ones on the Security screen).
   The last three have no read flag on the server, so they are read up to a
   moment kept on this device (amv_notif_seen) - which this list says, rather
   than pretending one device's "read" is everyone's.

   A source that could not be read is SAID, never shown as nothing new: "all
   caught up" is a claim, and it is only made when every source answered. */
(function(){
  const SEEN = 'amv_notif_seen', SEEN_IDS = 'amv_notif_seen_ids';
  const seenAt = () => +(loadStr(SEEN) || 0) || 0;
  /* Approvals carry no time, so the ones already looked at are kept by id. */
  const seenIds = () => { const v = load(SEEN_IDS); return new Set(Array.isArray(v) ? v : []); };
  let cache = { handoffs: null, activity: null, at: 0 }, failed = [];

  async function readServer(){
    failed = [];
    if(!(window.AMV_API && AMV_API.live && AMV_API.hasSession)) return;
    const jobs = [];
    jobs.push(AMV_API.listHandoff().then(d => { cache.handoffs = (d && d.incoming) || []; })
      .catch(() => { failed.push(T('Handed to you')); }));
    jobs.push(AMV_API.activity().then(d => { if(!d || !Array.isArray(d.events)) throw new Error('no log'); cache.activity = d.events; })
      .catch(() => { failed.push(T('Security')); }));
    if(typeof _autoRefresh === 'function' && !_AUTO_LOADED) jobs.push(_autoRefresh());
    await Promise.all(jobs);
    cache.at = Date.now();
  }

  function rows(){
    const out = [], seen = seenAt(), ids = seenIds();
    (Array.isArray(_AUTO_RESULTS) ? _AUTO_RESULTS : []).forEach(r => {
      if(!r) return;
      out.push({ at: +r.at || 0, unread: !r.read, kind: 'crew', icon: 'crew',
        title: T('Crew finished a job'), sub: _awaySnippet(r.detail || r.out || '', 110), go: 'crew' });
    });
    (cache.handoffs || []).forEach(h => {
      if(!h || h.status === 'done' || h.status === 'declined') return;
      out.push({ at: +h.at || 0, unread: (+h.at || 0) > seen, kind: 'handoff', icon: 'handoff',
        title: T('{0} handed you work').replace('{0}', String(h.from_email || T('Someone'))), sub: String(h.title || ''), go: 'handoff' });
    });
    (typeof _cwApprovals === 'function' ? _cwApprovals() : []).forEach(a => {
      if(!a || !a.id) return;
      /* Waiting on you sorts first: it is the only kind that stops work. */
      out.push({ at: Infinity, id: a.id, unread: !ids.has(a.id), kind: 'approval', icon: 'wait',
        title: T('A job is waiting for your OK'), sub: String(a.title || a.preview || ''), go: 'crew' });
    });
    (cache.activity || []).forEach(ev => {
      if(!ev || typeof _actLabel !== 'function') return;
      const l = _actLabel(ev); if(l.tone !== 'warn') return;
      out.push({ at: +ev.at || 0, unread: (+ev.at || 0) > seen, kind: 'security', icon: 'shield',
        title: T(l.text), sub: T('Not you? End every session from Security.'), go: 'security' });
    });
    return out.sort((a, b) => b.at - a.at).slice(0, 40);
  }

  function count(){
    try{ _NOTIF_OTHER = rows().filter(r => r.unread && r.kind !== 'crew').length; }catch(e){ _NOTIF_OTHER = 0; }
    _notifPaint();
  }

  const ICON = {
    crew: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
    handoff: '<path d="M5 9l-3 3 3 3"/><path d="M19 9l3 3-3 3"/><path d="M2 12h20"/>',
    wait: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    done: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'
  };
  const svg = k => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[k] || '') + '</svg>';

  function paint(panel, loading){
    const list = rows(), unread = list.filter(r => r.unread).length;
    const body = loading && !list.length
      ? '<div class="ntf-empty" role="status">' + escH(T('Loading…')) + '</div>'
      : list.length
        ? '<ul class="ntf-list">' + list.map((r, i) =>
            '<li><button type="button" class="ntf-row' + (r.unread ? ' unread' : '') + '" data-ntf="' + i + '">' +
              '<span class="ntf-ic ' + r.kind + '">' + svg(r.icon) + '</span>' +
              '<span class="ntf-tx"><span class="ntf-t">' + escH(r.title) + '</span>' +
              (r.sub ? '<span class="ntf-s">' + escH(r.sub) + '</span>' : '') +
              (r.at && r.at !== Infinity ? '<span class="ntf-w">' + escH(amvAgo(r.at, 'long')) + '</span>' : '') + '</span>' +
              (r.unread ? '<span class="ntf-dot" aria-label="' + escH(T('Unread')) + '"></span>' : '') +
            '</button></li>').join('') + '</ul>'
        : '';
    const caught = !loading && !unread && !failed.length;
    panel.innerHTML =
      '<div class="ntf-h"><h2 id="ntf-title">' + escH(T('Notifications')) + '</h2>' +
        '<button type="button" class="ntf-all" id="ntf-all"' + (unread ? '' : ' disabled') + '>' + escH(T('Mark all as read')) + '</button></div>' +
      (failed.length ? '<p class="ntf-warn" role="alert">' + escH(T('Could not check: {0}. What is below may not be everything.').replace('{0}', failed.join(', '))) + '</p>' : '') +
      (caught ? '<div class="ntf-caught">' + svg('done') + '<b>' + escH(T('You’re all caught up')) + '</b>' +
        '<span>' + escH(list.length ? T('Nothing new since you last looked.') : T('Results from Crew, work handed to you and security alerts appear here.')) + '</span></div>' : '') +
      body;
    panel.querySelectorAll('[data-ntf]').forEach(b => b.addEventListener('click', () => {
      const r = list[+b.getAttribute('data-ntf')]; if(!r) return;
      close();
      if(r.go === 'security'){ S.settingsPane = 'security'; setTab('settings'); return; }
      setTab(r.go);
    }));
    const all = panel.querySelector('#ntf-all');
    if(all) all.addEventListener('click', async () => {
      all.disabled = true;
      saveStr(SEEN, String(Date.now()));
      store(SEEN_IDS, list.filter(r => r.id).map(r => r.id).concat([...seenIds()]).slice(0, 300));
      if((Array.isArray(_AUTO_RESULTS) ? _AUTO_RESULTS : []).some(r => r && !r.read) && typeof _autoMarkRead === 'function') await _autoMarkRead();
      count(); paint(panel, false);
    });
  }

  let open = null;
  function close(){
    if(!open) return;
    open.panel.remove(); document.removeEventListener('pointerdown', open.out, true); document.removeEventListener('keydown', open.key, true);
    const b = $('notif-btn'); if(b){ b.setAttribute('aria-expanded', 'false'); b.focus(); }
    open = null;
  }
  window._notifOpenNow = function(){
    if(open){ close(); return; }
    const btn = $('notif-btn');
    const panel = document.createElement('div');
    panel.className = 'ntf-panel'; panel.id = 'ntf-panel';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'ntf-title');
    document.body.appendChild(panel);
    const out = e => { if(!panel.contains(e.target) && !(btn && btn.contains(e.target))) close(); };
    /* Escape is this list's: nothing behind it should also act on it. */
    const key = e => { if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', out, true); document.addEventListener('keydown', key, true);
    open = { panel, out, key };
    if(btn) btn.setAttribute('aria-expanded', 'true');
    paint(panel, true);
    readServer().then(() => { count(); if(open && open.panel === panel) paint(panel, false); });
    const first = panel.querySelector('button:not([disabled])'); if(first) first.focus();
  };
  /* Read once now (the file is fetched ahead at idle) so the number on the bell
     is right before anybody presses it. */
  window._notifRecount = count;
  window._notifRefresh = () => readServer().then(count, count);
  readServer().then(count, count);
})();
