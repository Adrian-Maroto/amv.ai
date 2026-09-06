/* EVERY MOBILE CHECK IN THIS REPOSITORY RAN AT 390x844.

   Forty-two of them. Three at 390x780, one each at 390x667, 360x740, 320x700
   and 320x568. So the tall phone is the tested phone, and a fault that only
   appears when the viewport is SHORT had nowhere to be caught.

   One was: `.offline-bar` sat on the close button of every dialog, but only
   below about 700px of height. At 390x844 the card starts at 143 and the bar
   ends at 59, so the whole class looked clean. At 390x620 - an iPhone SE and
   most small Androids - the close button is at 31, inside the bar, and the
   bar's own dismiss is 21px away, so aiming for one hits the other.

   That was found by accident. This is the instrument that finds the next one.

   WHAT IT ASSERTS, AND WHY IT IS WORDED CAREFULLY. Not "the buttons are on
   screen": a long dialog whose buttons are below the fold is fine as long as
   the dialog SCROLLS to them, and calling that broken is how a suite gets a
   reputation for crying wolf. LESSONS 380 has a retracted finding of exactly
   that shape. So the property is ANSWERABLE: every control either takes its
   own tap where it sits, or is reached by scrolling the dialog and takes it
   there. What must never happen is a control that cannot be reached at all,
   or one whose tap goes somewhere else.

   Driving the REAL dialogs, not a stand-in. A hand-rolled modal with a short
   body centres instead of overflowing, its card starts lower, and it clears
   every fixed surface on the page - which passes while testing nothing. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'T', email: 't@x.com', ini: 'T' } });
const { page, errors } = app;

/* The phones the tested one is not. 390x620 is where the status bar bug
   lived; 320x568 is the smallest screen still in real use. */
const SMALL = [[390, 620], [320, 568]];

/* The dialogs where being unable to press a button actually costs something:
   consent for an autonomous turn, a command on somebody's machine, a public
   deploy, a background job, a permanent forget, and sending finished work. */
const DIALOGS = [
  ['the whole-turn machine consent', () => _agentConsent('add a login page and run the tests')],
  ['a command on your computer', () => _confirmModelTool('run_command', { command: 'npm test && npm run build' })],
  ['publishing a page to the internet', () => _confirmModelTool('deploy_site', { title: 'My landing page' })],
  ['setting up a job that runs on a timer', () => _confirmModelTool('crew_add',
      { detail: 'Summarise anything new in my inbox and tell me what needs a reply.',
        repeat: 'daily', approval: 'auto' })],
  ['permanently forgetting something', () => _confirmModelTool('memory_forget', { text: 'my dietary preferences' })],
  ['approving and SENDING finished work', () => _confirmModelTool('approval_act', { action: 'approve' })],
  ['a connector acting on a real account', () => _confirmModelTool('mcp__gmail__send_email',
      { to: 'someone@example.com', subject: 'Invoice', body: 'The attached is due on Friday.' })],
];

/* Everything that can be on screen without the person doing anything. The
   status bar is the one that bit; the rest are here so the next one cannot
   hide behind "we only ever checked it on its own". */
const armSurfaces = () => page.evaluate(() => {
  try { localStorage.removeItem('amv_cookie_consent'); } catch (e) {}
  try { _showStatusBar('AMV cannot reach its backend from this network.', { sticky: true }); } catch (e) {}
});

const clearDialog = () => page.evaluate(() => {
  const o = document.getElementById('ovr');
  if (o) { o.innerHTML = ''; o.className = ''; }
});

/* Answerable, measured rather than inferred. A control passes if it takes its
   own tap where it is; if it does not, the dialog is scrolled to it and asked
   again. Only a control that fails BOTH is a finding. */
const probe = (h) => page.evaluate((h) => {
  const desc = el => el ? (el.tagName + '.' + String(el.className || '').split(' ')[0]
                           + (el.id ? '#' + el.id : '')) : 'nothing';
  const owns = (b) => {
    const r = b.getBoundingClientRect();
    if (r.top < 0 || r.bottom > h) return { ok: false, why: 'off screen', took: null };
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: !!(t && (t === b || b.contains(t))), why: 'covered', took: desc(t) };
  };
  const out = [];
  const ov = document.querySelector('#ovr .ov');
  for (const b of document.querySelectorAll('#ovr button')) {
    const r0 = b.getBoundingClientRect();
    if (r0.width < 1 || r0.height < 1) continue;
    const label = (b.textContent || '').trim().slice(0, 16) || b.id || '(unlabelled)';
    let a = owns(b);
    if (!a.ok) {
      /* Scrolling is a legitimate way to reach a control. Asked for, then
         re-measured - never assumed to have worked. */
      try { b.scrollIntoView({ block: 'center' }); } catch (e) {}
      a = owns(b);
      a.neededScroll = true;
    }
    out.push({ label, ok: a.ok, why: a.why, took: a.took, neededScroll: !!a.neededScroll });
  }
  return { controls: out, scrollable: ov ? getComputedStyle(ov).overflowY : null };
}, h);

for (const [w, h] of SMALL) {
  section('At ' + w + 'x' + h + ', every dialog can still be answered');
  await page.setViewportSize({ width: w, height: h });
  await page.evaluate(() => {
    window.BRIDGE = { connected: true, folder: 'my-app' };
    window.BRIDGE_TOOLS = [{ name: 'run_command' }];
    window.MCP = window.MCP || { servers: [], live: {} };
    MCP.live = { gmail: { tools: [{ name: 'send_email' }], info: {} } };
  });

  for (const [what, open] of DIALOGS) {
    await clearDialog();
    await armSurfaces();
    const opened = await page.evaluate((src) => {
      try { (new Function('return (' + src + ')'))()(); } catch (e) { return String(e && e.message); }
      return true;
    }, open.toString());
    await page.waitForTimeout(420);

    const r = await probe(h);
    const bad = r.controls.filter(c => !c.ok);
    ok(opened === true && r.controls.length > 0,
       what + ': the dialog opens with controls on it', { opened, n: r.controls.length });
    ok(bad.length === 0,
       what + ': every control takes its own tap', bad.slice(0, 3));
    /* A control that needed scrolling is not a failure, but it IS worth
       seeing in the transcript - it is the difference between a dialog that
       fits and one that only just works. */
    const scrolled = r.controls.filter(c => c.neededScroll).map(c => c.label);
    ok(true, what + ': ' + (scrolled.length ? 'reached after scrolling: ' + scrolled.join(', ')
                                            : 'all of it fits without scrolling'), scrolled.length);
  }
  await clearDialog();
}

section('And a dialog too long to fit is scrollable rather than trapped');
{
  /* The other half of "answerable". A dialog that overflows and cannot scroll
     has no way out but Escape, and Escape is not discoverable. This drives a
     deliberately absurd body - longer than anything the product produces - to
     prove the container behaves when one does. */
  await page.setViewportSize({ width: 320, height: 568 });
  await clearDialog();
  /* NOT RETURNED. `page.evaluate` awaits a promise the page hands back, and
     `_showModalAsync` resolves only when somebody answers the dialog - so
     returning it waits for a click that this line is what makes possible.
     The suite hung until the runner killed it, with the section header
     printed and no assertion under it. Every other open in this file dodged
     it by returning `true`; this one did not, which is why it is written
     down rather than quietly fixed. */
  await page.evaluate(() => {
    _showModalAsync({
      title: 'A very long question',
      body: ('AMV will work on this by itself until it is done. ').repeat(60),
      okText: 'Go ahead', cancelText: 'Stop' });
    return true;
  });
  await page.waitForTimeout(400);
  const r = await probe(568);
  ok(r.scrollable === 'auto' || r.scrollable === 'scroll',
     'the dialog container scrolls', r.scrollable);
  ok(r.controls.some(c => c.neededScroll),
     'this body really is long enough to push a control out of view', 
     r.controls.filter(c => c.neededScroll).length);
  ok(r.controls.every(c => c.ok),
     'and every control is reachable once it is scrolled to', r.controls.filter(c => !c.ok));
  await clearDialog();
}

section('Nothing broke');
ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));

await app.close();
if (report('a-dialog-is-answerable-on-a-small-phone') > 0) process.exitCode = 1;
done();
