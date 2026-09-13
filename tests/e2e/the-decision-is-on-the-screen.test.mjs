/* YOU CANNOT DECIDE WITH A BUTTON YOU CANNOT SEE.

   Measured on Money leak detector at 1280x900: the panel was 792px tall
   holding 863px of content, and "Turn it on" was the last thing in it. So the
   screen whose entire purpose is deciding whether to run a job opened with the
   decision 71px below the bottom, under a raw 90-word instruction, two warning
   boxes and two footnotes. Nothing was broken and nothing said so - it simply
   asked somebody to scroll past the source code of a thing in order to find
   out they were allowed to want it.

   The panel is two parts now: one that scrolls and one that does not. What is
   pinned here is that the action is in the part that does not, whatever the
   job's own text weighs - checked against the LONGEST job in the catalogue,
   because a panel that fits the short ones was never the problem.

   And the instruction is still the whole instruction. Moving it behind a
   disclosure is only defensible while it is still there and still complete, so
   that is checked too: opened, it matches the job's own prompt exactly. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'crew' });
const page = app.page;
await page.evaluate(() => { saveStr('amv_plan', 'pro'); document.getElementById('ck')?.remove(); });

/* The heaviest job there is, so this measures the worst case rather than a
   convenient one. */
const worst = await page.evaluate(() => {
  const j = (_cwJobs() || []).slice()
    .sort((a, b) => ((b.prompt || '') + (b.desc || '')).length - ((a.prompt || '') + (a.desc || '')).length)[0];
  return { id: j.id, title: j.title, prompt: j.prompt || '' };
});
ok(worst.prompt.length > 400, 'the job used here really is a long one', String(worst.prompt.length));

section('The decision is on the screen when the panel opens');
{
  const r = await page.evaluate(async (id) => {
    cwPeek(id);
    await new Promise(x => setTimeout(x, 300));
    const panel = document.querySelector('.cwp');
    const go = document.getElementById('cwp-go');
    const pr = panel.getBoundingClientRect(), gr = go.getBoundingClientRect();
    const scroller = document.querySelector('.cwp-scroll');
    return {
      label: go.textContent.trim(),
      inside: gr.bottom <= pr.bottom + 1 && gr.top >= pr.top,
      onScreen: gr.bottom <= window.innerHeight && gr.top >= 0,
      /* The body really is longer than the window - otherwise "it fits" would
         be true of any layout and this file would prove nothing. */
      overflows: scroller.scrollHeight - scroller.clientHeight,
    };
  }, worst.id);
  ok(/turn it on/i.test(r.label), 'the action says what it does', r.label);
  ok(r.overflows > 0, 'the job’s own text is longer than the panel', String(r.overflows));
  ok(r.inside, 'and the action is still inside the panel', JSON.stringify(r));
  ok(r.onScreen, 'and inside the window, without scrolling first', JSON.stringify(r));
}

section('Scrolling the body does not take the decision away');
{
  const r = await page.evaluate(async () => {
    const scroller = document.querySelector('.cwp-scroll');
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise(x => setTimeout(x, 120));
    const panel = document.querySelector('.cwp');
    const gr = document.getElementById('cwp-go').getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    return { moved: scroller.scrollTop > 0, inside: gr.bottom <= pr.bottom + 1 && gr.top >= pr.top };
  });
  ok(r.moved, 'the body scrolled', r.moved);
  ok(r.inside, 'and the action did not move with it', r.inside);
}

section('The exact instruction is still the exact instruction');
{
  const r = await page.evaluate(async (expected) => {
    const d = document.querySelector('.cwp-more');
    const before = !!(d && d.open);
    if (d) d.open = true;
    await new Promise(x => setTimeout(x, 80));
    const pre = document.querySelector('.cwp-prompt');
    return { exists: !!d, closedFirst: !before, text: pre ? pre.textContent : '', same: !!pre && pre.textContent === expected };
  }, worst.prompt);
  ok(r.exists, 'it is behind a disclosure');
  ok(r.closedFirst, 'which starts closed, so the page opens readable');
  ok(r.same, 'and holds the job’s real instruction, whole and unedited',
     r.text.slice(0, 60) + ' … vs … ' + worst.prompt.slice(0, 60));
}

section('The facts are one list, not scattered through the page');
{
  const r = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.cwp-facts dt')].map(e => e.textContent.trim());
    return { labels, lists: document.querySelectorAll('.cwp-facts').length };
  });
  ok(r.lists === 1, 'one list', String(r.lists));
  ok(r.labels.includes('How often') && r.labels.includes('Where it runs'),
     'saying how often it runs and where', r.labels.join(' | '));
  await page.evaluate(() => closeOvr());
}

section('It works on a phone too');
{
  await page.setViewportSize({ width: 390, height: 844 });
  const r = await page.evaluate(async (id) => {
    cwPeek(id);
    await new Promise(x => setTimeout(x, 300));
    const panel = document.querySelector('.cwp');
    const gr = document.getElementById('cwp-go').getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    closeOvr();
    return { onScreen: gr.bottom <= window.innerHeight && gr.top >= 0,
             inside: gr.bottom <= pr.bottom + 1,
             wide: Math.round(pr.width) <= window.innerWidth };
  }, worst.id);
  ok(r.onScreen && r.inside, 'the action is on a 390px screen as well', JSON.stringify(r));
  ok(r.wide, 'and the panel fits across it', JSON.stringify(r));
}

await app.close();
if (report('the-decision-is-on-the-screen') > 0) process.exitCode = 1;
done();
