/* SIGN IN SOMEWHERE ELSE AND YOUR DEV PROJECTS ARE CHATS.

   A session record is {id, kind, title, updated, state}. _syncSessionList
   uploaded `tool: s.tool` - not a field on it - so every session went to the
   server carrying `undefined`, and the kind was simply absent from the copy
   the server kept.

   Nothing looked wrong on the device that made them, because _SESSIONS in
   memory was always right. It only showed on a second computer: Dev, Lab and
   Studio work came back with no kind, could not be drawn as any of those, and
   appeared as ordinary chats still carrying the names they had been given.

   This drives the real round trip - collect on one device, merge on another
   that has nothing - because the defect lives exactly in the gap between them
   and neither side alone shows it.

   The second half is the data already up there. Anything uploaded by the old
   build has no kind and never will, so the pull infers it from the shape of
   the state it carries. That is a guess, which is why it is only made when
   there is no kind to read. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

/* DEVICE ONE: make one of each, and take what would be uploaded. */
const one = await bootApp({});
const payload = await one.page.evaluate(() => {
  _STUDIO.artifacts = [{ id: 'a1', name: 'Poster', brief: 'gig poster', html: '<p>x</p>' }];
  _STUDIO.activeId = 'a1';
  _sessFlush('studio');
  _DEV.log = [{ role: 'user', content: 'todo app' }];
  _DEV.project = { 'app.js': 'x' };
  _sessFlush('dev');
  _LAB.code = 'print(1)';
  _sessFlush('lab');
  return _syncSessionList();
});
await one.close();

section('What leaves the device says what each thing is');
{
  ok(payload.length === 3, 'all three sessions are in the upload', payload.length);
  const kinds = payload.map(s => s.kind).sort();
  ok(kinds.join(',') === 'dev,lab,studio',
     'and each carries its kind - this is the field that was missing', kinds);
  ok(payload.every(s => s.state && Object.keys(s.state).length > 0),
     'with the work itself, not just a label', payload.map(s => Object.keys(s.state || {})));
}

const two = await bootApp({});
const { page } = two;

section('A new computer draws them as Recents, not as chats');
{
  const r = await page.evaluate(async (sessions) => {
    _SESSIONS.length = 0;
    /* Exactly what AMVSync.pull does with data.sessions. */
    const merged = _mergeById([], sessions);
    merged.forEach(x => { if (x && !x.kind) { const k = _sessKindOf(x); if (k) x.kind = k; } _SESSIONS.push(x); });
    try { renderHist(); } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
    const rows = [...document.querySelectorAll('#hist .hi')];
    return {
      kinds: _SESSIONS.map(s => s.kind).sort(),
      asSessions: rows.filter(e => !!e.dataset.sid).length,
      titles: _SESSIONS.map(s => s.title),
    };
  }, payload);
  ok(r.kinds.join(',') === 'dev,lab,studio',
     'every kind survived the trip', r.kinds);
  ok(r.asSessions === 3,
     'and Recents lists three SESSIONS - the bug was that these drew as chats',
     r.asSessions);
  ok(r.titles.indexOf('gig poster') >= 0,
     'keeping the names they were given', r.titles);
}

section('And the work opens, which is the point of keeping it');
{
  const r = await page.evaluate(async () => {
    const studio = _SESSIONS.find(s => s.kind === 'studio');
    _sessResume(studio.id);
    await new Promise(r => setTimeout(r, 300));
    return { arts: (_STUDIO.artifacts || []).length, name: (_STUDIO.artifacts[0] || {}).name };
  });
  ok(r.arts === 1, 'resuming a synced Studio session brings its work back', r);
  ok(r.name === 'Poster', 'the actual artifact, not an empty shell', r);
}

section('Records uploaded before the kind was sent are recovered, not lost');
{
  const r = await page.evaluate(async (sessions) => {
    _SESSIONS.length = 0;
    const merged = _mergeById([], sessions);
    merged.forEach(x => { if (x && !x.kind) { const k = _sessKindOf(x); if (k) x.kind = k; } _SESSIONS.push(x); });
    return _SESSIONS.map(s => ({ kind: s.kind, title: s.title }));
  }, payload.map(({ kind, tool, ...rest }) => rest));
  const kinds = r.map(x => x.kind).sort();
  ok(kinds.join(',') === 'dev,lab,studio',
     'a session with no kind is placed by what it contains', r);
  /* Only ever a fallback: a record that says what it is is believed. */
  const explicit = await page.evaluate(() =>
    _sessKindOf({ kind: 'dev', state: { artifacts: [] } }));
  ok(explicit === 'dev',
     'and a kind that IS present wins over the guess', explicit);
}

section('No JavaScript errors');
ok(two.errors.length === 0, 'zero uncaught page errors', two.errors.slice(0, 3));

await two.close();
report();
done();
