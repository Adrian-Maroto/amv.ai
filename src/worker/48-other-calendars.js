/* ══════════════════════════════════════════════════════════════════════════
   CALENDARS THAT ARE NOT GOOGLE OR OUTLOOK.

   Calendar support was two providers, and both of them are the ones a
   particular kind of office uses. Everywhere else - iCloud on a phone, a
   Fastmail or Zoho account, a Nextcloud a co-op runs itself, Yandex across
   Russia and Central Asia, a university timetable, a league fixture list,
   national holidays - publishes a feed instead, and AMV could read none of it.
   Saying "connect your calendar" to somebody whose calendar is one of those
   is telling them the product is not for them.

   A SUBSCRIPTION, NOT A LOGIN, AND THAT IS THE RIGHT TRADE HERE. A feed URL
   is read-only by construction: it cannot create, move or delete anything,
   and losing it loses a view of somebody's week rather than control of it.
   What AMV does with a calendar is READ - the week ahead, what collides, what
   needs preparing - so read-only costs nothing it was using, and a password
   would buy write access nobody asked for at a far worse price if it leaked.

   The URL is a secret even so: for most providers it is unguessable and
   whoever holds it can see the calendar. So it is stored sealed with the same
   deployment key the mailbox passwords use, never returned to the browser
   after it is saved, and shown back only as the host it points at.
   ══════════════════════════════════════════════════════════════════════════ */

/* Where somebody finds the feed, per provider. Not a list of hosts to connect
   to - any of them can be typed by hand - but the instruction that turns "I
   don't know where to get that" into thirty seconds of clicking. */
const CAL_FEED_PROVIDERS = {
  icloud:    { name: 'Apple iCloud', flag: '🌍',
               how: 'On iCloud.com open Calendar, click the radio icon beside the calendar name, tick Public Calendar and copy the link. It starts webcal:// - paste it as it is.' },
  fastmail:  { name: 'Fastmail', flag: '🌍',
               how: 'In Fastmail go to Settings, Calendars, pick the calendar, then Sharing, and copy the secret address under Subscribe.' },
  nextcloud: { name: 'Nextcloud / ownCloud', flag: '🌍',
               how: 'Open Calendar, click the three dots beside the calendar, choose Copy subscription link. Works with any Nextcloud, including one you run yourself.' },
  yandex:    { name: 'Yandex Calendar (Яндекс Календарь)', flag: '🇷🇺',
               how: 'In Yandex Calendar open the calendar list, choose the calendar, then Export, and copy the iCal link.' },
  zoho:      { name: 'Zoho Calendar', flag: '🇮🇳',
               how: 'In Zoho Calendar go to Settings, My Calendars, pick the calendar, then Share, and copy the Private Address in iCal format.' },
  mailru:    { name: 'Mail.ru Calendar (Календарь Mail.ru)', flag: '🇷🇺',
               how: 'In Mail.ru Calendar open the calendar settings and copy the export link (ссылка для экспорта).' },
  proton:    { name: 'Proton Calendar', flag: '🇨🇭',
               how: 'In Proton Calendar go to Settings, Calendars, choose Share, and copy the link under Share with anyone.' },
  posteo:    { name: 'Posteo', flag: '🇩🇪',
               how: 'In Posteo open Calendar, then the calendar’s settings, and copy the published iCal address.' },
  generic:   { name: 'Any other calendar', flag: '🌍',
               how: 'Almost every calendar can publish a link ending in .ics - look for Export, Subscribe, Publish or "secret address". A university timetable, a fixture list or a holiday calendar works the same way.' },
};

const CAL_MAX_FEEDS = 8;
const CAL_MAX_ICS_BYTES = 2 * 1024 * 1024;

/* `webcal://` is the same URL over https and nothing else. Every Apple
   instruction in the world says to copy a webcal link, so refusing it would
   make the most common case look broken for a scheme difference. */
function _calNormalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (/^webcal:\/\//i.test(u)) u = 'https://' + u.slice(9);
  return u;
}

/* One line of an ICS file, unfolded and unescaped. The format wraps at 75
   octets with a leading space, so a summary longer than that arrives in
   pieces and reads as truncated unless it is put back together. */
function _icsUnfold(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}
function _icsValue(v) {
  return String(v || '').replace(/\\n/gi, ' ').replace(/\\,/g, ',')
                        .replace(/\;/g, ';').replace(/\\\\/g, '\\').trim();
}
/* ICS times come as 20260115T090000Z, as a floating local time, or as a bare
   date for an all-day event. Anything unparseable returns null and the event
   is dropped rather than dated to 1970 - a wrong date in a calendar is worse
   than a missing one, because it gets acted on. */
function _icsDate(v) {
  const raw = String(v || '').trim();
  let m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (m) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return Number.isFinite(t) ? t : null;
  }
  m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/* Events inside a window, from one feed's text. Bounded on purpose: a public
   holiday feed carries decades of entries and nobody asked for 2043. */
function _icsEvents(text, fromMs, toMs, limit) {
  const out = [];
  const body = _icsUnfold(text);
  const blocks = body.split('BEGIN:VEVENT').slice(1);
  for (const b of blocks) {
    const chunk = b.split('END:VEVENT')[0];
    const get = (k) => {
      const m = chunk.match(new RegExp('^' + k + '(?:;[^:\\n]*)?:(.*)$', 'mi'));
      return m ? _icsValue(m[1]) : '';
    };
    const start = _icsDate(get('DTSTART'));
    if (start === null) continue;                    // undated: dropped, never guessed
    if (start < fromMs || start > toMs) continue;
    const end = _icsDate(get('DTEND'));
    out.push({
      title: get('SUMMARY').slice(0, 200) || '(no title)',
      start, end: end === null ? null : end,
      location: get('LOCATION').slice(0, 200),
      allDay: /^\d{8}$/.test((chunk.match(/^DTSTART(?:;[^:\n]*)?:(.*)$/mi) || [, ''])[1].trim()),
    });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a.start - b.start);
}

async function calFeedAdd(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in first', code: 'needs_auth' }, 401);
  const blocked = await guardAction(env, 'caladd:' + user.email, 20, 900, 'calendar subscriptions');
  if (blocked) return blocked;
  /* The URL is a secret for most providers, so it is sealed - and refusing to
     store one at all is the honest answer on a deployment that cannot. */
  if (!(await _mailCredKey(env))) {
    return json({ error: 'AMV cannot store a calendar link safely on this deployment yet, so it will not store one at all. MAIL_CRED_KEY has to be set first.',
                  code: 'needs_service' }, 503);
  }

  const body = await request.json().catch(() => ({}));
  const url = _calNormalizeUrl(body.url);
  const label = String(body.label || '').slice(0, 60);

  /* The SAME gate the browsing agent uses, rather than a second one written
     here. A user-supplied URL that the SERVER fetches is the textbook shape of
     an SSRF, and the difference between the two gates would be the hole. */
  const gate = _webHostAllowed(url);
  if (!gate.ok) return json({ error: gate.why, code: 'bad_url' }, 400);

  const rec = (await DB.get(env, 'cal', user.email)) || { feeds: [] };
  const feeds = Array.isArray(rec.feeds) ? rec.feeds : [];
  if (feeds.length >= CAL_MAX_FEEDS) {
    return json({ error: 'That is ' + CAL_MAX_FEEDS + ' calendars, which is as many as AMV reads. Remove one first.',
                  code: 'too_many' }, 400);
  }
  let host = ''; try { host = new URL(url).host; } catch (e) {}
  const id = 'cal_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  feeds.push({ id, label: label || host, host, url: await _mailEncrypt(env, url), addedAt: Date.now() });
  await DB.put(env, 'cal', user.email, { feeds });
  await _userEvent(env, request, user.email, 'calendar_subscribed', { host });
  audit(env, 'cal_feed_add', { by: user.email, host });
  /* The host, never the URL. It is a secret and it does not need to come back
     out of storage to be listed. */
  return json({ ok: true, feed: { id, label: label || host, host } });
}

async function calFeedList(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in first', code: 'needs_auth' }, 401);
  const rec = (await DB.get(env, 'cal', user.email)) || { feeds: [] };
  const feeds = (Array.isArray(rec.feeds) ? rec.feeds : [])
    .map((f) => ({ id: f.id, label: f.label, host: f.host, addedAt: f.addedAt || 0 }));
  return json({ ok: true, feeds, max: CAL_MAX_FEEDS, providers: CAL_FEED_PROVIDERS });
}

async function calFeedRemove(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in first', code: 'needs_auth' }, 401);
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  const rec = (await DB.get(env, 'cal', user.email)) || { feeds: [] };
  const feeds = (Array.isArray(rec.feeds) ? rec.feeds : []).filter((f) => f.id !== id);
  await DB.put(env, 'cal', user.email, { feeds });
  await _userEvent(env, request, user.email, 'calendar_unsubscribed', {});
  return json({ ok: true, feeds: feeds.map((f) => ({ id: f.id, label: f.label, host: f.host })) });
}

async function calEvents(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in first', code: 'needs_auth' }, 401);
  const blocked = await guardAction(env, 'calread:' + user.email, 60, 300, 'calendar reads');
  if (blocked) return blocked;

  const body = await request.json().catch(() => ({}));
  const days = Math.max(1, Math.min(90, Number(body.days) || 7));
  const from = Date.now();
  const to = from + days * 86400000;

  const rec = (await DB.get(env, 'cal', user.email)) || { feeds: [] };
  const feeds = Array.isArray(rec.feeds) ? rec.feeds : [];
  if (!feeds.length) return json({ ok: true, events: [], feeds: 0 });

  const events = [];
  const failed = [];
  for (const f of feeds) {
    let url = '';
    try { url = await _mailDecrypt(env, f.url); } catch (e) { url = ''; }
    if (!url) { failed.push({ label: f.label, why: 'the stored link could not be read' }); continue; }
    try {
      /* fetchGuarded, not fetch: it re-checks the gate on EVERY hop, so a feed
         that answers 302 to an internal address is stopped at the redirect
         rather than at the first URL - which is the hole the browsing agent
         already had and had to fix. */
      const r = await fetchGuarded(url, { method: 'GET', headers: { 'Accept': 'text/calendar' } }, 12000);
      if (r.blocked) { failed.push({ label: f.label, why: r.why }); continue; }
      if (!r.response || !r.response.ok) {
        failed.push({ label: f.label, why: 'the calendar answered ' + ((r.response && r.response.status) || 'nothing') });
        continue;
      }
      const text = (await r.response.text()).slice(0, CAL_MAX_ICS_BYTES);
      for (const e of _icsEvents(text, from, to, 200)) events.push(Object.assign({ calendar: f.label }, e));
    } catch (e) {
      failed.push({ label: f.label, why: 'it could not be reached just now' });
    }
  }
  events.sort((a, b) => a.start - b.start);
  /* `failed` is returned rather than swallowed. A week that is quietly missing
     one calendar looks like a free week, and somebody plans against it. */
  return json({ ok: true, events: events.slice(0, 500), feeds: feeds.length, failed });
}

