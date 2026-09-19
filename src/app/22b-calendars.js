/* ══════════════════════════════════════════════════════════════════════════
   THE CALENDAR SCREEN FOR EVERYBODY ELSE.

   Google and Outlook connect with a button because they have an OAuth flow to
   send somebody through. Every other calendar in the world publishes a LINK,
   and the only hard part of using one is finding it - which is a different
   problem and needs a different screen.

   So this is mostly instructions. The list of providers is not there to look
   comprehensive; each entry exists to turn "I don't know where to get that"
   into thirty seconds of clicking, and the generic entry is there because the
   calendar somebody actually has is usually not on any list.

   The link is never shown back. The server does not return it after it is
   stored and this never asks for it, so a shoulder-surfer, a screen share or
   a screenshot cannot take somebody's calendar with them.
   ══════════════════════════════════════════════════════════════════════════ */

function _calRow(f) {
  return '<div class="cf-row">'
    + '<div class="cf-b"><div class="cf-n">' + escH(f.label || f.host || 'Calendar') + '</div>'
      + '<div class="cf-h">' + escH(f.host || '') + '</div></div>'
    + '<button type="button" class="cf-x" data-cf-rm="' + escH(f.id) + '" '
      + 'aria-label="' + escH(T('Disconnect') + ' ' + (f.label || f.host || '')) + '">'
      + escH(T('Disconnect')) + '</button>'
  + '</div>';
}

async function openCalendarFeeds() {
  const r = $('ovr'); if (!r) return;
  r.innerHTML = _ovShell({ id: 'cf', wide: true, eyebrow: 'Calendars',
                           title: 'Connect any calendar',
                           body: '<p class="mu">' + escH(T('Loading…')) + '</p>' });
  _ovWire('cf');

  let d = null;
  try { d = await AMV_API.calFeeds(); } catch (e) { d = null; }
  const b = $('cf-body'); if (!b) return;
  if (!d) {
    b.innerHTML = '<div class="ml-err">' + escH(T('Could not reach AMV just now. Try again in a moment.')) + '</div>';
    return;
  }

  const provs = d.providers || {};
  b.innerHTML =
    '<p class="mu cf-intro">' + escH(T('AMV reads your week from a calendar link. It is read-only - AMV can see what is scheduled and can never move, change or delete anything.')) + '</p>'
    + '<div class="cf-list" id="cf-list">'
      + ((d.feeds || []).length ? d.feeds.map(_calRow).join('')
         : '<p class="mu cf-none">' + escH(T('No calendars connected yet.')) + '</p>')
    + '</div>'
    + '<label class="ml-f cf-add"><span>' + escH(T('Calendar link')) + '</span>'
      + '<input id="cf-url" type="url" autocomplete="off" spellcheck="false" placeholder="https://…/calendar.ics">'
    + '</label>'
    + '<label class="ml-f"><span>' + escH(T('What to call it')) + '</span>'
      + '<input id="cf-label" type="text" autocomplete="off" maxlength="60" placeholder="' + escH(T('Work, Family, Fixtures…')) + '">'
    + '</label>'
    + '<button class="btn bp" id="cf-go">' + escH(T('Connect calendar')) + '</button>'
    + '<div class="fam-say" id="cf-say" role="status" aria-live="polite"></div>'
    + '<div class="cf-week" id="cf-week"></div>'
    + '<div class="cf-help"><div class="cf-help-t">' + escH(T('Where to find your link')) + '</div>'
      + Object.keys(provs).map(k =>
          '<details class="cf-p"><summary>' + escH(provs[k].flag || '') + ' ' + escH(provs[k].name || k) + '</summary>'
          + '<p>' + escH(provs[k].how || '') + '</p></details>').join('')
    + '</div>';

  const say = (t, cls) => { const el = $('cf-say'); if (el) { el.textContent = t || ''; el.className = 'fam-say' + (cls ? ' ' + cls : ''); } };

  /* WHAT AMV CAN NOW SEE, SHOWN IMMEDIATELY.

     A calendar link is a long opaque string that somebody copied from another
     screen, and the ways it can be wrong are all silent: the wrong calendar,
     an expired secret, a link that needs a login, a feed with nothing in it.
     Without this, none of that surfaces until some other feature quietly
     returns an empty week - and an empty week reads as a free week.

     So the week is read back and shown. It is the same call everything else
     uses, so if this looks right the rest works, and if it looks wrong it is
     wrong now rather than in a fortnight. */
  const showWeek = async () => {
    const z = $('cf-week'); if (!z) return;
    z.innerHTML = '<p class="mu cf-wk-load">' + escH(T('Reading your week\u2026')) + '</p>';
    const w = await calendarWeek(7);
    if (!w.feeds) { z.innerHTML = ''; return; }
    const fmt = (ms, allDay) => {
      try {
        const d = new Date(ms);
        return allDay
          ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
          : d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short',
                                          hour: 'numeric', minute: '2-digit' });
      } catch (e) { return ''; }
    };
    const rows = (w.events || []).slice(0, 12).map(e =>
      '<div class="cf-ev"><span class="cf-ev-w">' + escH(fmt(e.start, e.allDay)) + '</span>'
      + '<span class="cf-ev-t">' + escH(e.title || '') + '</span>'
      + (e.calendar ? '<span class="cf-ev-c">' + escH(e.calendar) + '</span>' : '') + '</div>').join('');
    /* A calendar that failed is named. Folding it into "nothing this week"
       would be the exact lie this whole screen exists to avoid. */
    const bad = (w.failed || []).map(f =>
      '<p class="cf-wk-bad">' + escH((f.label || 'A calendar') + ': ' + (f.why || 'could not be read')) + '</p>').join('');
    z.innerHTML = '<div class="cf-wk-t">' + escH(T('What AMV can see')) + '</div>'
      + (rows || '<p class="mu cf-wk-none">' + escH(T('Nothing scheduled in the next seven days. If that is a surprise, the link may point at the wrong calendar.')) + '</p>')
      + bad;
  };

  const wireRemoves = () => {
    document.querySelectorAll('[data-cf-rm]').forEach(btn => on(btn, 'click', async () => {
      const id = btn.dataset.cfRm;
      btn.disabled = true;
      try {
        const res = await AMV_API.calFeedRemove(id);
        const list = $('cf-list');
        if (list) list.innerHTML = (res.feeds || []).length
          ? res.feeds.map(_calRow).join('')
          : '<p class="mu cf-none">' + escH(T('No calendars connected yet.')) + '</p>';
        wireRemoves();
        say(T('Disconnected.'), 'ok');
        showWeek();
      } catch (e) { btn.disabled = false; say((e && e.message) || T('Could not remove that calendar.'), 'err'); }
    }));
  };
  wireRemoves();
  if ((d.feeds || []).length) showWeek();

  on($('cf-go'), 'click', async () => {
    const url = ($('cf-url') || {}).value || '';
    const label = ($('cf-label') || {}).value || '';
    if (!url.trim()) { say(T('Paste the calendar link first.'), 'err'); return; }
    const go = $('cf-go');
    if (go) { go.disabled = true; go.textContent = T('Connecting…'); }
    try {
      await AMV_API.calFeedAdd(url, label);
      /* Re-read rather than append what was typed: the server decides what is
         stored and what it is called, and a screen that shows its own guess
         is a screen that can disagree with the truth. */
      const fresh = await AMV_API.calFeeds();
      const list = $('cf-list');
      if (list) list.innerHTML = (fresh.feeds || []).map(_calRow).join('');
      wireRemoves();
      const u = $('cf-url'); if (u) u.value = '';
      const l = $('cf-label'); if (l) l.value = '';
      say(T('Connected. AMV can read this calendar from now on.'), 'ok');
      showWeek();
    } catch (e) {
      say((e && e.message) || T('Could not add that calendar.'), 'err');
    } finally { if (go) { go.disabled = false; go.textContent = T('Connect calendar'); } }
  });
}
try { window.openCalendarFeeds = openCalendarFeeds; } catch (e) {}

/* The week, from every connected calendar at once. Used by the everyday jobs
   and by anything that needs to know what somebody has on. */
async function calendarWeek(days) {
  try {
    const d = await AMV_API.calEvents(days || 7);
    return { events: (d && d.events) || [], failed: (d && d.failed) || [], feeds: (d && d.feeds) || 0 };
  } catch (e) {
    /* A failure is reported, never returned as an empty week: an empty week
       reads as a free week, and somebody plans against it. */
    return { events: [], failed: [{ label: 'AMV', why: (e && e.message) || 'could not be reached' }], feeds: 0, error: true };
  }
}
try { window.calendarWeek = calendarWeek; } catch (e) {}
