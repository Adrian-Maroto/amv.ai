/* LOOK AT CHAT FOR TEN SECONDS, COME BACK, AND YOUR PROJECT IS GONE FROM THE
   SCREEN.

   Reported as: leaving Build for chat and returning means having to find what
   you were working on again. The cause was explicit rather than accidental -
   setTab, on leaving a workspace tool, ran

       _sessLeave(prev);        // save it, and clear the active pointer
       _resetToolState(prev);   // and wipe the tool back to defaults

   under a comment saying "the next visit starts fresh". True, and not what
   somebody glancing at another screen wants. The work was never lost - it is in
   Recents - but it had to be recognised by title and reopened, which for the
   thing you were in the middle of is a strange thing to ask.

   Lab was already exempt, with a comment saying leaving and coming back keeps
   your code and only the "+" button or a page refresh starts fresh. That is the
   right rule; there was never a reason it stopped at Lab.

   The other half of the request - "only if you close the tab" - needs nothing
   built: none of this survives in memory, so a refresh lands on the main page
   on its own. What DID need building is the save for closing the tab, which is
   the section at the bottom. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '' });
const { page, errors } = app;

/* A project in Dev, the way a turn leaves one. */
const seedDev = () => page.evaluate(() => {
  S.tab = 'dev';
  _DEV.log = [{ role: 'user', text: 'build me a snake game' }];
  _DEV.project = { 'index.html': { content: '<h1>snake</h1>' } };
  _DEV.activePath = 'index.html';
  _DEV.curCode = '<h1>snake</h1>';
  try { _sessTouch('dev'); } catch (e) {}
});

const devState = () => page.evaluate(() => ({
  logLen: (_DEV.log || []).length,
  files: Object.keys(_DEV.project || {}),
  active: _DEV.activePath || '',
  sessions: (_SESSIONS || []).filter(s => s.kind === 'dev').length,
  activeId: (window._activeSessionPeek ? _activeSessionPeek('dev') : ''),
}));

section('Going to chat and back keeps the project you were on');
{
  await seedDev();
  await page.waitForTimeout(900);          // let the 700ms debounce write it
  const before = await devState();
  ok(before.logLen === 1 && before.files.length === 1, 'a project is open in Build', before);

  await page.evaluate(() => setTab('chat'));
  await page.waitForTimeout(200);
  await page.evaluate(() => setTab('dev'));
  await page.waitForTimeout(200);

  const after = await devState();
  ok(after.logLen === 1, 'the conversation is still there', after);
  ok(after.files.length === 1 && after.files[0] === 'index.html',
     'and so are the files', after.files);
  ok(after.active === 'index.html', 'and the file that was open', after.active);
}

section('And it is the same build, not a copy of it');
{
  /* Clearing the active pointer did not only lose your place - it meant the
     next edit started a SECOND session, so a morning of stepping in and out
     left Recents holding several partial copies of one project. */
  const n = await page.evaluate(() => (_SESSIONS || []).filter(s => s.kind === 'dev').length);
  await page.evaluate(() => {
    _DEV.log.push({ role: 'user', text: 'add a score counter' });
    try { _sessTouch('dev'); } catch (e) {}
  });
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => (_SESSIONS || []).filter(s => s.kind === 'dev').length);
  ok(after === n, 'carrying on after a detour updates the same build', { before: n, after });
}

section('Starting a new build still starts a new one');
{
  /* The distinction that matters: "I looked at something else" versus "I am
     done with this". The explicit control still leaves and resets. */
  const before = await page.evaluate(() => (_SESSIONS || []).filter(s => s.kind === 'dev').length);
  await page.evaluate(() => {
    _sessLeave('dev');
    _sessNew('dev');
    _resetToolState('dev');
  });
  const cleared = await devState();
  ok(cleared.logLen === 0 && cleared.files.length === 0,
     'the tool is empty afterwards, which is what the control promises', cleared);

  await page.evaluate(() => {
    _DEV.log = [{ role: 'user', text: 'a totally different thing' }];
    _DEV.project = { 'app.js': { content: 'x' } };
    try { _sessTouch('dev'); } catch (e) {}
  });
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => (_SESSIONS || []).filter(s => s.kind === 'dev').length);
  ok(after === before + 1, 'and the next work is a separate build', { before, after });
}

section('A past build can be reopened, and the one you left is still there');
{
  const r = await page.evaluate(async () => {
    const devs = (_SESSIONS || []).filter(s => s.kind === 'dev')
      .slice().sort((a, b) => (a.updated || 0) - (b.updated || 0));
    const first = devs[0];
    _sessResume(first.id);
    await new Promise(r => setTimeout(r, 200));
    return { resumedFiles: Object.keys(_DEV.project || {}),
             stillThere: (_SESSIONS || []).filter(s => s.kind === 'dev').length };
  });
  ok(r.resumedFiles.includes('index.html'), 'the older build opens with its files', r);
  ok(r.stillThere >= 2, 'and nothing was consumed by opening it', r);
}

section('Closing the tab saves what was just changed');
{
  /* The save that was missing. _sessTouch debounces at 700ms and _sessFlush ran
     only on a tab switch, so a change made in the last fraction of a second
     before closing went nowhere - silently, with no way afterwards to tell
     which edit did not survive. */
  const r = await page.evaluate(async () => {
    /* The record being WRITTEN is the active one, which the section above left
       pointed at the resumed older build - not whichever was updated last. The
       first version of this looked up the latter and reported a lost change
       that had been saved correctly, which would have been a fine way to
       "fix" a bug that was not there. */
    const id = _activeSession.dev;
    _DEV.log.push({ role: 'user', text: 'one last thing typed before closing' });
    try { _sessTouch('dev'); } catch (e) {}
    /* No wait: this is the moment the tab goes away, inside the debounce. */
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    await new Promise(r => setTimeout(r, 100));
    const rec = (_SESSIONS || []).find(s => s.id === id);
    return { id, found: !!rec,
             saved: JSON.stringify(rec && rec.state || {}).includes('one last thing typed') };
  });
  ok(r.saved, 'the change is written before the page goes', r);
}

section('It flushes every tool, not only the one on screen');
{
  /* State is kept across tab switches now, so work can be sitting in a tool
     nobody is looking at when the tab closes. */
  const r = await page.evaluate(async () => {
    S.tab = 'chat';
    _LAB.code = 'console.log("lab work nobody is looking at")';
    const before = (_SESSIONS || []).filter(s => s.kind === 'lab').length;
    window.dispatchEvent(new Event('pagehide'));
    await new Promise(r => setTimeout(r, 100));
    const labs = (_SESSIONS || []).filter(s => s.kind === 'lab');
    return { before, after: labs.length,
             holds: labs.some(s => JSON.stringify(s.state || {}).includes('nobody is looking')) };
  });
  ok(r.holds, 'Lab work is written too, from a chat tab', r);
}

ok(errors.length === 0, 'no console errors', errors);

await app.close();
if (report('a-glance-at-chat-is-not-finishing') > 0) process.exitCode = 1;
done();
