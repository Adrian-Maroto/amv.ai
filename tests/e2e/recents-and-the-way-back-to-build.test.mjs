/* THREE WAYS OF ARRIVING AT BUILD, AND THEY WERE ALL WRONG IN A DIFFERENT WAY.

   All three reported by the owner in one breath, and all three are navigation
   rather than layout - which is why a screenshot never caught any of them.

   OPENING A DESIGN FROM RECENTS WENT HOME. `_sessHasContent` saves a Studio
   session as soon as an artifact has html OR A BRIEF - right, because somebody
   who described a poster and had the generation fail has still done work worth
   keeping - but the canvas would only open for an artifact that had html. So a
   design saved at the moment it was described, or one whose generation never
   ran because the deployment has no model key, resumed straight past its own
   canvas onto the hero. The work was in Recents, loaded into memory, and
   invisible.

   PRESSING BUILD IN THE SIDEBAR DID NOT GO TO BUILD. `_buildMode` returns the
   section you were last in and all three hold a flag meaning "show me the work,
   not the list", so the entry re-opened whichever project was open and there
   was no route at all to the screen that lists them.

   LAB HAD NO WAY HOME AT ALL. Dev and Studio have had `atHome` since they were
   written; Lab's entry screen was defined purely by "there is no code", so the
   only way back to it was to delete the work.

   The fourth thing checked here is the one that broke while fixing the second:
   the reset belongs on the SIDEBAR BUTTON, not inside `setTab`. Every deep link
   and every `setBuildMode` call routes through setTab too, so putting it there
   sent Studio home a moment before it drew the canvas, and the canvas never
   appeared. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await page.evaluate(() => { saveStr('amv_plan', 'pro'); document.getElementById('ck')?.remove(); });

/* Put one session of each kind in Recents and hand back their ids. The save is
   debounced, so this waits for it rather than assuming. */
const ids = await page.evaluate(async () => {
  _DEV.log = [{ role: 'user', text: 'make a landing page' }]; _sessTouch('dev');
  _LAB.code = 'const a = 1;\n'.repeat(40); _sessTouch('lab');
  /* Deliberately WITHOUT html: a design described but never generated, which is
     every design on a deployment with no model key. */
  _STUDIO.artifacts = [{ id: 'a1', name: 'Design 1', type: 'page', html: '', brief: 'a poster', history: [] }];
  _STUDIO.activeId = 'a1'; _sessTouch('studio');
  await new Promise(r => setTimeout(r, 1600));
  const by = {};
  (_SESSIONS || []).forEach(s => { by[s.kind] = s.id; });
  return by;
});
ok(!!(ids.dev && ids.lab && ids.studio), 'a session of each kind is in Recents', JSON.stringify(ids));
await page.evaluate((i)=>{ window.__studioId = i; }, ids.studio);

const resume = (id) => page.evaluate(async (i) => {
  setTab('chat'); await new Promise(r => setTimeout(r, 250));
  _sessResume(i); await new Promise(r => setTimeout(r, 700));
  return { cls: (document.querySelector('#vc > *') || {}).className || '',
           exit: !!document.getElementById('bld-home'),
           status: (document.getElementById('studio-status') || {}).textContent || '' };
}, id);

/* The real button, because that is the thing being fixed. */
const pressSidebarBuild = () => page.evaluate(async () => {
  const b = document.querySelector('.snb[data-tab="build"], .sb-tool[data-tab="build"]');
  if (!b) return 'no button';
  b.click();
  await new Promise(r => setTimeout(r, 700));
  return (document.querySelector('#vc > *') || {}).className || '';
});

section('A design in Recents opens its canvas, even with nothing generated yet');
{
  const r = await resume(ids.studio);
  ok(/studio-canvas/.test(r.cls), 'it opens the canvas rather than the hero', r.cls);
  ok(/Nothing was generated/i.test(r.status),
     'and says plainly that there is no result yet', r.status.slice(0, 70));
  ok(r.exit, 'with a way back out of it', r.exit);
}

section('Arriving at Studio any other way still shows the starting screen');
{
  /* The narrow fix: resuming opens work in progress, navigating does not. The
     first attempt opened the canvas on every arrival, which turns the starting
     point into something you have to escape. */
  const r = await page.evaluate(async () => {
    buildHome(); setTab('build'); await new Promise(x => setTimeout(x, 300));
    setBuildMode('design'); await new Promise(x => setTimeout(x, 400));
    return { entry: !!document.querySelector('.dsn-wrap'),
             canvas: !!document.querySelector('.studio-canvas') };
  });
  ok(r.entry && !r.canvas, 'Studio opens on its starting screen', JSON.stringify(r));
}

section('Pressing Build in the sidebar goes to Build');
{
  for (const kind of ['dev', 'lab', 'studio']) {
    const opened = await resume(ids[kind]);
    ok(!/blank/.test(opened.cls), kind + ' opens its work', opened.cls);
    const after = await pressSidebarBuild();
    /* Each surface's own home: Dev and Lab say so with a class, Studio by
       rendering the hero wrap instead of the canvas. */
    const home = kind === 'studio' ? /bld-sv/.test(after) : /blank/.test(after);
    ok(home, 'and pressing Build from ' + kind + ' lands on the main screen', after);
  }
}

section('Going home does not destroy the work');
{
  const r = await page.evaluate(() => ({
    lab: (_LAB.code || '').length,
    dev: (_DEV.log || []).length,
    studio: (_STUDIO.artifacts || []).length,
    listed: (_SESSIONS || []).length,
  }));
  ok(r.lab > 0 && r.dev > 0 && r.studio > 0, 'every surface still holds what it had', JSON.stringify(r));
  ok(r.listed >= 3, 'and all three are still in Recents', String(r.listed));
}

section('A section switch is not a request to go home');
{
  /* The regression the third section's fix caused, pinned so it cannot come
     back: `setBuildMode` routes through `setTab('build')`, so a reset living
     inside setTab fires on every section change. */
  const r = await page.evaluate(async () => {
    _sessResume(window.__studioId); await new Promise(x => setTimeout(x, 600));
    setBuildMode('code'); await new Promise(x => setTimeout(x, 400));
    setBuildMode('design'); await new Promise(x => setTimeout(x, 500));
    return { canvas: !!document.querySelector('.studio-canvas') };
  });
  ok(r.canvas, 'switching away and back keeps the design open', JSON.stringify(r));
}

ok(errors.length === 0, 'and none of it raised a page error', errors.slice(0, 3).join(' | '));

await app.close();
if (report('recents-and-the-way-back-to-build') > 0) process.exitCode = 1;
done();
