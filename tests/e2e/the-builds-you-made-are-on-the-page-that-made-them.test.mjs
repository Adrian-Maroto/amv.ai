/* THE WORK WAS SAVED AND LISTED NOWHERE YOU WOULD LOOK FOR IT.

   Build has saved a session per project since it existed. The only place they
   appeared was the sidebar history, interleaved with chats and sorted by time,
   so finding last night's project meant recognising an auto-generated title
   among the day's conversations. On the surface that made them, they did not
   appear at all.

   And there was no way out of a project. Dev had two states - no work, and the
   work - so the only control that left a project was the one that starts a new
   one, which does not take you back to the list, it replaces what you had.
   Studio has had `atHome` for exactly this since it was built; Dev never did.

   What is asserted here is the loop somebody actually does: arrive, see what
   they made, open one, come back out, open another, and find the first still
   whole. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '' });
const { page, errors } = app;

/* Two finished builds and one design, saved the way real ones are. */
const seed = () => page.evaluate(async () => {
  S.tab = 'dev';
  _DEV.log = [{ role: 'user', text: 'a snake game' }];
  _DEV.project = { 'index.html': { content: '<h1>snake</h1>' } };
  _sessFlush('dev'); _sessLeave('dev'); _resetToolState('dev');

  _DEV.log = [{ role: 'user', text: 'a todo app' }];
  _DEV.project = { 'app.js': { content: 'todo' } };
  _sessFlush('dev'); _sessLeave('dev'); _resetToolState('dev');

  _STUDIO.artifacts = [{ id: 'a1', brief: 'a pricing page', html: '<div>price</div>' }];
  _STUDIO.activeId = 'a1';
  _sessFlush('studio'); _sessLeave('studio'); _resetToolState('studio');

  /* Said rather than left to the clock. Three saves in a row land inside the
     same millisecond, and a sort on equal keys is arbitrary - so the ordering
     assertion below would have been testing insertion order dressed up as
     recency. Real builds are minutes apart; this states that. */
  const now = Date.now();
  const at = { 'a snake game': now - 3 * 60000, 'a todo app': now - 2 * 60000, 'a pricing page': now - 60000 };
  (_SESSIONS || []).forEach(x => { if (at[x.title] != null) x.updated = at[x.title]; });

  renderBuildView();
  await new Promise(r => setTimeout(r, 150));
});

const home = () => page.evaluate(() => ({
  rows: [...document.querySelectorAll('.bld-recent')].map(b => ({
    kind: b.querySelector('.bld-recent-k').textContent.trim(),
    title: b.querySelector('.bld-recent-t').textContent.trim(),
    when: b.querySelector('.bld-recent-w').textContent.trim(),
  })),
  heroShown: !!document.querySelector('.dev-shell.dev-blank'),
  homeBtn: !!document.getElementById('bld-home'),
}));

section('Build opens on its own page, with what you made listed on it');
{
  await seed();
  const h = await home();
  ok(h.heroShown, 'the main page is what you land on', h.heroShown);
  ok(h.rows.length === 3, 'and every build is listed under it', h.rows);
  ok(h.rows.some(r => r.title === 'a todo app'), 'by name', h.rows.map(r => r.title));
  ok(h.rows.every(r => r.when), 'and when it was last touched', h.rows.map(r => r.when));
  ok(!h.homeBtn, 'with no way back offered, because you are already there', h.homeBtn);
}

section('The list says which kind each one is');
{
  /* One list rather than one per mode: "past builds" is how somebody thinks of
     them, and _sessResume navigates to whichever surface a session belongs to.
     The badge is what stops that being a surprise. */
  const h = await home();
  const kinds = h.rows.map(r => r.kind);
  ok(kinds.filter(k => k === 'App').length === 2, 'two apps', kinds);
  ok(kinds.includes('Design'), 'and the design, from the same list', kinds);
}

section('The newest is first, because that is the one you are looking for');
{
  const h = await home();
  ok(h.rows[0].title === 'a pricing page', 'most recently touched at the top', h.rows.map(r => r.title));
}

section('Opening one gives you the project back');
{
  const r = await page.evaluate(async () => {
    const row = [...document.querySelectorAll('.bld-recent')]
      .find(b => b.querySelector('.bld-recent-t').textContent.trim() === 'a snake game');
    row.click();
    await new Promise(r => setTimeout(r, 300));
    return { files: Object.keys(_DEV.project || {}), log: (_DEV.log || []).length,
             heroShown: !!document.querySelector('.dev-shell.dev-blank'),
             homeBtn: !!document.getElementById('bld-home') };
  });
  ok(r.files.includes('index.html'), 'the files are there', r.files);
  ok(r.log === 1, 'and the conversation that made them', r.log);
  ok(!r.heroShown, 'the main page gives way to the work', r.heroShown);
  ok(r.homeBtn, 'and a way back out appears', r.homeBtn);
}

section('And you can always get back out, and into another one');
{
  /* THE ASSERTION THE WHOLE THING IS FOR. Without a way home, a build is a
     one-way door: the only control that left it started a new project. */
  const back = await page.evaluate(async () => {
    document.getElementById('bld-home').click();
    await new Promise(r => setTimeout(r, 300));
    return { heroShown: !!document.querySelector('.dev-shell.dev-blank'),
             rows: document.querySelectorAll('.bld-recent').length,
             stillHeld: Object.keys(_DEV.project || {}).length };
  });
  ok(back.heroShown, 'the main page comes back', back);
  ok(back.rows === 3, 'with the builds still listed', back.rows);
  ok(back.stillHeld === 1,
     'and leaving a build does not discard it - it is a door, not a bin', back.stillHeld);

  const second = await page.evaluate(async () => {
    const row = [...document.querySelectorAll('.bld-recent')]
      .find(b => b.querySelector('.bld-recent-t').textContent.trim() === 'a todo app');
    row.click();
    await new Promise(r => setTimeout(r, 300));
    return { files: Object.keys(_DEV.project || {}) };
  });
  ok(second.files.includes('app.js'), 'and the next one opens', second.files);
}

section('Going home does not throw the first one away');
{
  const r = await page.evaluate(async () => {
    document.getElementById('bld-home').click();
    await new Promise(r => setTimeout(r, 250));
    const row = [...document.querySelectorAll('.bld-recent')]
      .find(b => b.querySelector('.bld-recent-t').textContent.trim() === 'a snake game');
    row.click();
    await new Promise(r => setTimeout(r, 300));
    return { files: Object.keys(_DEV.project || {}) };
  });
  ok(r.files.includes('index.html'), 'the first build reopens intact', r.files);
}

section('Asking for something takes you out of the home page');
{
  /* The flag has to clear itself on use, or the hero would sit over the answer. */
  const r = await page.evaluate(async () => {
    _DEV.atHome = true; renderBuildView();
    await new Promise(r => setTimeout(r, 150));
    const wasHome = !!document.querySelector('.dev-shell.dev-blank');
    _DEV.atHome = false;
    _DEV.log.push({ role: 'user', text: 'now change it' });
    try { _devRenderLog(); } catch (e) {}
    await new Promise(r => setTimeout(r, 150));
    return { wasHome, nowHome: !!document.querySelector('.dev-shell.dev-blank') };
  });
  ok(r.wasHome, 'home is showing beforehand', r);
  ok(!r.nowHome, 'and the work replaces it once there is work', r);
}

section('A first visit is a hero and a composer, not an empty heading');
{
  const r = await page.evaluate(async () => {
    _SESSIONS.length = 0;
    _resetToolState('dev');
    renderBuildView();
    await new Promise(r => setTimeout(r, 150));
    return { list: document.querySelectorAll('.bld-recents').length,
             heroShown: !!document.querySelector('.dev-shell.dev-blank') };
  });
  ok(r.list === 0, 'nothing is drawn when there is nothing to list', r);
  ok(r.heroShown, 'and the main page is still what you get', r);
}

ok(errors.length === 0, 'no console errors', errors);

await app.close();
if (report('the-builds-you-made-are-on-the-page-that-made-them') > 0) process.exitCode = 1;
done();
