/* THREE SURFACES SHOWED YOU A RESULT AND BUILT THE BAR ABOVE IT THREE WAYS.

   Measured before anything moved:

     Dev     tabs Preview|Code, then viewport, download, deploy, open external,
             with the status on the right.
     Lab     the word "Output" and a status. Nothing else.
     Studio  three fake window dots and a title, then viewport - and its code
             toggle was a BUTTON IN THE SIDE PANEL, next to a status that was
             also down there, describing a stage in a different pane.

   What is shared is the BAR, not the tabs. Dev has Preview|Code because Dev
   writes the code and has to show you both; Lab's code is already on screen in
   the editor beside the output, so giving Lab that tab would hand it a control
   that shows it what it is already looking at. One component with a left slot
   that takes tabs or a title and a right slot that takes a status and actions.

   Two things a person can see moved: Studio's code toggle joined the bar where
   Dev keeps its, and Studio's status moved next to the stage it describes.

   The last two sections are here because both are mistakes this change actually
   made and measurement caught:

     hiding the title on narrow screens left Lab with an EMPTY 44px strip,
     because the title is the only thing Lab's bar holds, and

     the new tab class was not enrolled in the tap-target rule the old
     `.dev-pt` and `.lab-pt` were in, so the tabs quietly lost their 40px
     minimum on a phone. A new class does not inherit a promise made to the
     one it replaces. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

const SETUP = {
  studio: `()=>{ setTab('studio'); _studioNewArtifact('T','page','b');
      _studioSetHTML('<h1>hi</h1>','b'); _studioShowCanvas('b'); _studioRenderPreview('<h1>hi</h1>'); }`,
  dev: `()=>{ _DEV.log=[{role:'sys',text:'x'}]; _devSetFile('index.html','<h1>hi</h1>','html');
      setTab('dev'); _devShowResult('<h1>hi</h1>','html',{html:'<h1>hi</h1>'}); }`,
  lab: `()=>{ _LAB.code='console.log(1)'; setTab('lab'); renderLabView(); }`,
};

async function measure(name, phone) {
  return page.evaluate(async ({ src, name, phone }) => {
    new Function('return (' + src + ')')()();
    await new Promise(r => setTimeout(r, 500));
    if (phone) { try { _mobileShowOutput(name); } catch (e) {} await new Promise(r => setTimeout(r, 400)); }
    const bar = document.querySelector('#vc .rb');
    if (!bar) return { none: true };
    const r = bar.getBoundingClientRect();
    const right = [...bar.querySelectorAll('*')]
      .reduce((a, e) => Math.max(a, e.getBoundingClientRect().right), 0);
    const tabs = [...bar.querySelectorAll('[role="tab"]')];
    const title = bar.querySelector('.rb-title');
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      overflow: Math.round(right - r.right),
      tabs: tabs.map(t => ({ label: t.textContent.trim(), h: Math.round(t.getBoundingClientRect().height) })),
      titleShown: !!(title && title.getBoundingClientRect().width > 1),
      /* Anything at all in the bar - a tab, a title, an action. An empty bar is
         the failure this catches. */
      hasContent: [...bar.querySelectorAll('*')].some(e => e.getBoundingClientRect().width > 1),
    };
  }, { src: SETUP[name], name, phone });
}

section('One component, above all three results');
{
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = {};
  for (const name of ['studio', 'dev', 'lab']) seen[name] = await measure(name, false);
  for (const name of ['studio', 'dev', 'lab']) {
    ok(!seen[name].none, name + ' has the shared bar', !seen[name].none);
    ok(seen[name].overflow <= 0, 'and nothing spills out of it on desktop', name + ' ' + seen[name].overflow);
  }
  ok(seen.dev.tabs.length === 2 && seen.studio.tabs.length === 2,
     'Dev and Studio both carry a Preview and a Code tab',
     JSON.stringify([seen.dev.tabs.map(t => t.label), seen.studio.tabs.map(t => t.label)]));
  ok(seen.lab.tabs.length === 0 && seen.lab.titleShown,
     'Lab carries a title instead, because its code is already on screen',
     JSON.stringify({ tabs: seen.lab.tabs.length, title: seen.lab.titleShown }));
}

section('Studio s two controls came up out of the side panel');
{
  const r = await page.evaluate(async (src) => {
    new Function('return (' + src + ')')()();
    await new Promise(s => setTimeout(s, 500));
    const bar = document.getElementById('studio-rb');
    const side = document.querySelector('#vc .studio-side');
    const code = document.getElementById('studio-code');
    const status = document.getElementById('studio-status');
    return {
      bar: !!bar, code: !!code, status: !!status,
      codeInBar: !!(bar && code && bar.contains(code)),
      statusInBar: !!(bar && status && bar.contains(status)),
      codeInSide: !!(side && code && side.contains(code)),
      statusInSide: !!(side && status && side.contains(status)),
    };
  }, SETUP.studio);
  ok(r.bar && r.code && r.status, 'the controls still exist, with the same ids', JSON.stringify(r));
  ok(r.codeInBar && !r.codeInSide, 'the code toggle is in the bar, where Dev keeps its', JSON.stringify(r));
  ok(r.statusInBar && !r.statusInSide,
     'and the status is beside the stage it describes, not in another pane', JSON.stringify(r));
}

section('It fits a phone, which none of the three had ever been asked');
{
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['studio', 'dev', 'lab']) {
    const m = await measure(name, true);
    ok(!m.none, name + ' still has a bar on a phone', !m.none);
    ok(m.overflow <= 0, 'and nothing spills off the screen', name + ' overflow ' + m.overflow);
    /* The regression this change actually made: hiding the title on narrow
       screens left Lab with an empty strip, because the title is all it has. */
    ok(m.hasContent, 'and the bar is not an empty strip', name + ' hasContent=' + m.hasContent);
  }
}

section('And the tabs are still big enough to hit');
{
  /* `.rb-tab` replaced `.dev-pt` and `.lab-pt`, which were enrolled in the rule
     giving everything interactive a 40px minimum on a phone. The new class was
     not, so the tabs shrank below it - invisibly, because they still looked
     right. */
  await page.setViewportSize({ width: 390, height: 844 });
  const m = await measure('dev', true);
  ok(m.tabs.length > 0, 'there are tabs to measure', m.tabs.length);
  ok(m.tabs.every(t => t.h >= 40),
     'every tab meets the 40px tap target the surface promises elsewhere',
     JSON.stringify(m.tabs));

  await page.setViewportSize({ width: 1440, height: 900 });
  const d = await measure('dev', false);
  ok(d.tabs.every(t => t.h >= 24),
     'and clears 24px on desktop, which is what WCAG 2.5.8 AA asks',
     JSON.stringify(d.tabs));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
