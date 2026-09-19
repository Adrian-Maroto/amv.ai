/* CALENDAR SUPPORT WAS TWO PROVIDERS, AND BOTH BELONG TO THE SAME OFFICE.

   iCloud on a phone, a Fastmail or Zoho account, a Nextcloud a co-op runs
   itself, Yandex across Russia and Central Asia, a university timetable, a
   fixture list, national holidays - AMV could read none of it. "Connect your
   calendar" to somebody whose calendar is one of those is telling them the
   product is not for them, which is most of the world.

   A SUBSCRIPTION RATHER THAN A LOGIN, and that is the right trade here. A feed
   is read-only by construction: it cannot create, move or delete anything, and
   losing it loses a VIEW of somebody's week rather than control of it. What
   AMV does with a calendar is read, so read-only costs nothing it was using,
   while a password would buy write access nobody asked for at a far worse
   price if it leaked.

   The URL is still a secret - for most providers it is unguessable and whoever
   holds it can see the calendar - and a user-supplied URL that the SERVER
   fetches is the textbook shape of an SSRF. Both of those are what this file
   is mostly about. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'cal.harness.mjs');
writeFileSync(harness, src + `
export { calFeedAdd, calFeedList, calFeedRemove, calEvents,
         _icsEvents, _icsDate, _icsUnfold, _calNormalizeUrl,
         CAL_FEED_PROVIDERS, CAL_MAX_FEEDS, DB };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  MAIL_CRED_KEY: 'Qx7-vast-entropy-here-9931-kkzp-4417',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix } = {}) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true };
    },
  },
};
W.__setRequireUser(async () => ({ email: 'owner@x.com', plan: 'pro' }));
const post = (url, body) => new Request('https://x' + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
  body: JSON.stringify(body || {}),
});

section('An internal address is refused, whatever shape it arrives in');
{
  /* The server fetches this URL. Every one of these is a real way people have
     reached a cloud metadata service or a private network from a product that
     accepted a link. */
  const nasty = [
    'http://localhost/cal.ics',
    'http://127.0.0.1/cal.ics',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::ffff:169.254.169.254]/x.ics',
    'http://10.0.0.5/private.ics',
    'http://192.168.1.1/cal.ics',
    'http://metadata.google.internal/x',
    'file:///etc/passwd',
    'gopher://x/1',
  ];
  for (const url of nasty) {
    store.clear();
    const r = await W.calFeedAdd(post('/v1/cal/feeds/add', { url }), env);
    ok(r.status === 400, 'refused: ' + url, r.status);
    const saved = await W.DB.get(env, 'cal', 'owner@x.com');
    ok(!saved || !(saved.feeds || []).length, 'and nothing was stored for it', url);
  }
}

section('An Apple link works, because every Apple instruction says webcal');
{
  /* Refusing webcal:// would make the single most common case look broken
     over a scheme difference. It is the same URL over https. */
  ok(W._calNormalizeUrl('webcal://p1.icloud.com/x.ics') === 'https://p1.icloud.com/x.ics',
     'webcal is read as https', W._calNormalizeUrl('webcal://p1.icloud.com/x.ics'));
  store.clear();
  const r = await W.calFeedAdd(post('/v1/cal/feeds/add', { url: 'webcal://p1.icloud.com/secret/x.ics', label: 'Home' }), env);
  ok(r.status === 200, 'and it is accepted', r.status);
}

section('The link is sealed, and never comes back out');
{
  store.clear();
  const secret = 'https://caldav.fastmail.com/feed/VERY-SECRET-TOKEN-123.ics';
  await W.calFeedAdd(post('/v1/cal/feeds/add', { url: secret, label: 'Work' }), env);

  /* Whoever holds this URL can read the calendar, so it is stored the way a
     mailbox password is - and the list has no reason to hand it back. */
  const raw = JSON.stringify([...store.entries()]);
  ok(raw.indexOf('VERY-SECRET-TOKEN-123') < 0,
     'the stored record does not contain the link in the clear', raw.slice(0, 120));

  const r = await W.calFeedList(new Request('https://x/v1/cal/feeds', { method: 'POST' }), env);
  const d = await r.json();
  ok(d.feeds.length === 1, 'the calendar is listed', d.feeds);
  ok(JSON.stringify(d).indexOf('VERY-SECRET-TOKEN-123') < 0,
     'and listing it does not return the link', JSON.stringify(d).slice(0, 160));
  ok(d.feeds[0].host === 'caldav.fastmail.com',
     'only the host, which is enough to tell one from another', d.feeds[0]);
  /* NAMED FIELDS, NOT "DOES NOT CONTAIN THE SECRET".

     Checking the plaintext is absent passes happily while the SEALED link is
     handed to the browser - which is a blob no browser needs, and material if
     the deployment key is ever exposed. The list should carry what the screen
     uses and nothing else, so that is what is asserted. */
  const keys = Object.keys(d.feeds[0]).sort();
  ok(JSON.stringify(keys) === JSON.stringify(['addedAt', 'host', 'id', 'label']),
     'the listing carries exactly what a screen needs, and no stored link', keys);
}

section('A deployment that cannot store a secret refuses to store one');
{
  store.clear();
  const noKey = Object.assign({}, env, { MAIL_CRED_KEY: '' });
  const r = await W.calFeedAdd(post('/v1/cal/feeds/add', { url: 'https://example.com/x.ics' }), noKey);
  const d = await r.json();
  ok(r.status === 503 && d.code === 'needs_service',
     'it says it cannot rather than storing the link in the clear', d);
  const saved = await W.DB.get(noKey, 'cal', 'owner@x.com');
  ok(!saved, 'and stores nothing at all', saved);
}

section('Reading an ICS file gives back real events');
{
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART:20260115T090000Z',
    'DTEND:20260115T100000Z',
    'SUMMARY:Standup with the team',
    'LOCATION:Room 2',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20260116',
    'SUMMARY:Public holiday',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const from = Date.UTC(2026, 0, 14), to = Date.UTC(2026, 0, 20);
  const evs = W._icsEvents(ics, from, to, 50);
  ok(evs.length === 2, 'both events are found', evs.length);
  ok(evs[0].title === 'Standup with the team', 'with their titles', evs[0]);
  ok(evs[0].location === 'Room 2', 'and where they are', evs[0].location);
  ok(evs[1].allDay === true, 'an all-day event is marked as one', evs[1]);
  ok(evs[0].start < evs[1].start, 'in the order they happen', [evs[0].start, evs[1].start]);
}

section('A long title is put back together, not delivered in pieces');
{
  /* ICS wraps at 75 octets with a leading space. Unfolded wrongly, a summary
     arrives looking truncated and somebody reads half an appointment. */
  const folded = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20260115T090000Z\r\n'
    + 'SUMMARY:Quarterly planning session with the whole of the product\r\n  and design team\r\n'
    + 'END:VEVENT\r\nEND:VCALENDAR';
  const evs = W._icsEvents(folded, Date.UTC(2026, 0, 14), Date.UTC(2026, 0, 20), 10);
  ok(evs.length === 1, 'the event is found', evs.length);
  ok(/design team$/.test(evs[0].title), 'and its title is whole', evs[0].title);
}

section('An event with no readable date is dropped, never guessed');
{
  /* A wrong date in a calendar is worse than a missing one, because it gets
     acted on - somebody turns up, or does not. */
  const bad = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:not-a-date\r\nSUMMARY:Ghost\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const evs = W._icsEvents(bad, 0, Date.now() + 1e11, 10);
  ok(evs.length === 0, 'it does not appear at all', evs);
  ok(W._icsDate('rubbish') === null && W._icsDate('') === null,
     'and an unparseable time is null rather than 1970', true);
}

section('Only the window asked for comes back');
{
  /* A holiday feed carries decades. Nobody asked for 2043. */
  const many = ['BEGIN:VCALENDAR'];
  for (let y = 2026; y < 2040; y++) many.push('BEGIN:VEVENT', 'DTSTART:' + y + '0115T090000Z', 'SUMMARY:Y' + y, 'END:VEVENT');
  many.push('END:VCALENDAR');
  const evs = W._icsEvents(many.join('\r\n'), Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31), 500);
  ok(evs.length === 1, 'one year asked for, one year returned', evs.map(e => e.title));
}

section('A calendar that fails is reported, not quietly missing');
{
  /* A week silently missing one calendar looks like a free week, and somebody
     plans against it. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  /* THE WHOLE FUNCTION, NOT A GUESSED NUMBER OF CHARACTERS.

     This took a fixed 2600-character slice, which stopped before the final
     return - so it reported the failures as unreported when they are returned
     on the very next line. A window sized by guess is a test that fails on the
     length of a comment. Cut at the closing brace instead. */
  const start = code.indexOf('async function calEvents');
  let depth = 0, stop = start;
  for (let i = code.indexOf('{', start); i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) { stop = i; break; }
  }
  const fn = code.slice(start, stop + 1);
  ok(fn.length > 400 && /^async function calEvents/.test(fn), 'the whole function was taken', fn.length);
  ok(/failed\.push/.test(fn), 'failures are collected', true);
  ok(/failed\b/.test(fn.slice(fn.lastIndexOf('return json'))), 'and returned with the events', true);
  /* And the redirect hole is closed by using the guarded fetch, not fetch. */
  ok(/fetchGuarded\(/.test(fn), 'feeds are fetched through the guarded path', true);
  ok(!/await fetch\(/.test(fn), 'never through a bare fetch that checks one hop', true);
}

section('Every provider tells somebody where to find their link');
{
  const ps = W.CAL_FEED_PROVIDERS;
  ok(Object.keys(ps).length >= 6, 'there are real providers listed', Object.keys(ps));
  for (const [k, p] of Object.entries(ps)) {
    ok(p.name && p.how && p.how.length > 40,
       `[${k}] says where to click, not just that it is supported`, (p.how || '').slice(0, 60));
  }
  ok(!!ps.generic, 'and there is an answer for a calendar nobody listed', !!ps.generic);
}

if (report('a-calendar-that-is-not-google-or-outlook') > 0) process.exitCode = 1;
done();
