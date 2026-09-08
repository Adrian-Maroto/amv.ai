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

  /* A Lab session as well. Lab never listed anything - `_buildRecentsHTML` was
     simply never called there - so a suite seeded with only dev and studio work
     could not have noticed. */
  _LAB.code = 'print("hi")';
  _sessFlush('lab'); _sessLeave('lab'); _resetToolState('lab');

  /* Said rather than left to the clock. Three saves in a row land inside the
     same millisecond, and a sort on equal keys is arbitrary - so the ordering
     assertion below would have been testing insertion order dressed up as
     recency. Real builds are minutes apart; this states that. */
  const now = Date.now();
  const at = { 'a snake game': now - 4 * 60000, 'a todo app': now - 3 * 60000,
               'a pricing page': now - 2 * 60000, 'print("hi")': now - 60000 };
  (_SESSIONS || []).forEach(x => { if (at[x.title] != null) x.updated = at[x.title]; });

  renderBuildView();
  await new Promise(r => setTimeout(r, 150));
});

/* The kind badge is gone. With one section listing only its own work it said
   the same word on every row, and the heading carries the name instead - so
   what a row has to show is what it is and when you last touched it. */
const home = () => page.evaluate(() => ({
  rows: [...document.querySelectorAll('.bld-recent')].map(b => ({
    title: b.querySelector('.bld-recent-t').textContent.trim(),
    when: b.querySelector('.bld-recent-w').textContent.trim(),
  })),
  heading: (document.querySelector('.bld-recents-h') || {}).textContent || '',
  heroShown: !!document.querySelector('.dev-shell.dev-blank'),
  homeBtn: !!document.getElementById('bld-home'),
  freshBar: !!document.querySelector('.build-bar-fresh'),
  newBtnBox: (() => {
    const b = document.querySelector('#dev-new, #studio-new, #lab-new');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  })(),
}));

/* Switching section is what the person does with the three buttons at the top,
   so the test does it the same way rather than by calling a renderer. */
const section_ = async (mode) => {
  await page.evaluate((m) => { setBuildMode(m); }, mode);
  await page.waitForTimeout(250);
};

section('Build opens on its own page, with what you made listed on it');
{
  await seed();
  const h = await home();
  ok(h.heroShown, 'the main page is what you land on', h.heroShown);
  ok(h.rows.length === 2, 'with this section\u2019s builds listed under it', h.rows);
  ok(h.rows.some(r => r.title === 'a todo app'), 'by name', h.rows.map(r => r.title));
  ok(h.rows.every(r => r.when), 'and when it was last touched', h.rows.map(r => r.when));
  ok(!h.homeBtn, 'with no way back offered, because you are already there', h.homeBtn);
}

section('Each section lists its own work and nobody else\u2019s');
{
  /* THE RULE THIS SUITE USED TO ASSERT THE OPPOSITE OF.

     One list for all three was a deliberate choice - "past builds" is how
     somebody thinks of them, said the comment - and the person who uses it
     disagreed: they came to Build to design something, and a column of
     half-finished code sessions under the design composer is somebody else's
     errand. Filtered per section, and the heading names the section rather
     than every row carrying a badge that says the same word. */
  const dev = await home();
  ok(dev.rows.length === 2 && dev.rows.every(r => r.title !== 'a pricing page'),
     'the app section shows the two apps and not the design', dev.rows.map(r => r.title));
  ok(/apps/i.test(dev.heading), 'under a heading that names it', dev.heading);

  await section_('design');
  const studio = await home();
  ok(studio.rows.length === 1 && studio.rows[0].title === 'a pricing page',
     'the design section shows the design and neither app', studio.rows.map(r => r.title));
  ok(/designs/i.test(studio.heading), 'under its own heading', studio.heading);

  await section_('lab');
  const lab = await home();
  ok(lab.rows.length === 1, 'and the code section lists code, which it never did before',
     lab.rows.map(r => r.title));
  ok(/code/i.test(lab.heading), 'under its own heading too', lab.heading);

  await section_('code');
}

section('A screen that is already new does not offer to make one');
{
  /* The New-session button next to the mode switcher cleared empty state and
     announced "New Dev session". Hidden exactly while there is nothing to start
     over from - a fact about the state, so it comes back the moment there is
     work, which the reachability suite checks separately. */
  const h = await home();
  ok(h.freshBar, 'the bar knows the surface is already fresh', h.freshBar);
  ok(h.newBtnBox && h.newBtnBox.w === 0 && h.newBtnBox.h === 0,
     'and the button that starts a new one is not on the screen', h.newBtnBox);
}

section('The newest is first, because that is the one you are looking for');
{
  const h = await home();
  ok(h.rows[0].title === 'a todo app', 'most recently touched at the top', h.rows.map(r => r.title));
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
  ok(back.rows === 2, 'with this section\u2019s builds still listed', back.rows);
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
