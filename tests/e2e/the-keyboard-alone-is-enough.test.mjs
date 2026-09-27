/* USING AMV WITHOUT A MOUSE.

   The last major surface with no coverage. Not "are there aria labels" - that is
   already checked elsewhere - but the four things a keyboard user actually needs:

     1. Tab reaches every control, and you can SEE where you are.
     2. Tab never lands somewhere scrolled off the screen.
     3. A dialog takes focus when it opens and does not let Tab wander out
        behind it, which is the failure that strands somebody completely.
     4. Escape closes it, and focus goes back where it came from.

   Swept before writing this, and the product passed all four: 151 stops across
   four tabs, every one with a visible ring, none off-screen, and 14 of 14
   dialogs correct. Which is exactly when the instrument deserves suspicion, so
   the focus trap was disabled on purpose and this reported `trapped=NO` on six
   dialogs. It is measuring something.

   Two instrument bugs were fixed on the way, both worth naming because both
   produced a confident wrong answer:

   - The first walk identified each stop by class and text. Icon-only buttons
     share a class and have no text, so the walk decided it had wrapped after two
     stops and reported chat as having two focusable controls. Identity has to be
     the element, not what it looks like.
   - The second walk marked visited elements but never cleared the marks, and the
     sidebar persists across tabs - so every walk after the first broke on its
     opening stop and reported zero. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Ada', email: 'ada@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => document.getElementById('ck')?.remove());

const describe = () => page.evaluate(() => {
  const e = document.activeElement;
  if (!e || e === document.body) return { none: true };
  const cs = getComputedStyle(e);
  const b = e.getBoundingClientRect();
  const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)
    || (cs.boxShadow && cs.boxShadow !== 'none');
  return {
    tag: e.tagName, cls: (e.className || '').toString().slice(0, 26),
    txt: (e.textContent || '').trim().slice(0, 18), ring,
    onScreen: b.top >= -2 && b.bottom <= window.innerHeight + 2 && b.width > 0,
  };
});

section('You can see where you are, on every tab');
{
  let total = 0;
  const blind = [], lost = [];
  for (const tab of ['chat', 'plans', 'settings', 'market']) {
    await page.evaluate(t => setTab(t), tab);
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      document.querySelectorAll('[data-__kbdseen]').forEach(e => { delete e.dataset.__kbdseen; });
      (document.getElementById('vc') || document.body).focus();
    });
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press('Tab');
      const d = await describe();
      if (d.none) continue;
      const fresh = await page.evaluate(() => {
        const e = document.activeElement;
        if (!e || e === document.body || e.dataset.__kbdseen) return false;
        e.dataset.__kbdseen = '1'; return true;
      });
      if (!fresh) break;                       // tabbed all the way round
      total++;
      if (!d.ring) blind.push(tab + ' ' + (d.cls || d.tag) + ' "' + d.txt + '"');
      if (!d.onScreen) lost.push(tab + ' ' + (d.cls || d.tag) + ' "' + d.txt + '"');
    }
  }
  ok(total > 100, 'there is a real product to tab through', total + ' stops');
  ok(blind.length === 0, 'every stop shows a visible focus indicator', blind.slice(0, 5));
  ok(lost.length === 0, 'and none of them is scrolled off the screen', lost.slice(0, 5));
}

section('A dialog takes focus, keeps it, and gives it back');
{
  const OPENERS = ['_openSettingsPicker', 'openCommandPalette', 'openShortcutSheet', 'openTerms',
    'openPrivacy', '_confirmDeleteAccount', 'openHandoffManager', 'openDNA', 'createWorkspaceModal',
    'createPromptModal', 'openJobHunt', 'openCowork', 'openTripPlanner', '_devConnectVSCode'];
  const noFocus = [], leaked = [], noEscape = [], noRestore = [];
  let tested = 0;

  for (const fn of OPENERS) {
    await page.evaluate(() => { const r = document.getElementById('ovr'); if (r) r.innerHTML = ''; });
    await page.waitForTimeout(120);
    const opened = await page.evaluate(async (f) => {
      if (typeof window[f] !== 'function') return { skip: true };
      const trigger = document.querySelector('#sb button, #vc button');
      if (trigger) trigger.focus();
      window.__before = document.activeElement;
      try { await window[f](); } catch (e) { return { skip: true }; }
      await new Promise(s => setTimeout(s, 420));
      const dlg = document.getElementById('ovr')?.firstElementChild;
      if (!dlg) return { skip: true };
      return { ok: true, movedIn: dlg.contains(document.activeElement) };
    }, fn);
    if (opened.skip) continue;
    tested++;
    if (!opened.movedIn) noFocus.push(fn);

    let escaped = false;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => {
        const d = document.getElementById('ovr')?.firstElementChild;
        return !!(d && document.activeElement && !d.contains(document.activeElement));
      })) { escaped = true; break; }
    }
    if (escaped) leaked.push(fn);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(320);
    const after = await page.evaluate(() => ({
      stillOpen: !!document.getElementById('ovr')?.firstElementChild,
      restored: document.activeElement === window.__before,
    }));
    if (after.stillOpen) noEscape.push(fn);
    if (!after.restored) noRestore.push(fn);
  }

  ok(tested >= 10, 'a real set of dialogs was driven', tested);
  ok(noFocus.length === 0, 'each one moves focus into itself when it opens', noFocus);
  ok(leaked.length === 0, 'and Tab does not wander out behind it', leaked);
  ok(noEscape.length === 0, 'Escape closes it', noEscape);
  ok(noRestore.length === 0, 'and focus goes back where it came from', noRestore);
}

section('A dialog says it is a dialog, and what it is about');
{
  /* Focus went in and Tab stayed inside, but most dialogs had no role, so a
     screen reader announced a button called "Close" and nothing else. Among
     them was the one that asks before AMV acts on a connected account. Two
     kinds are checked: the shared one that prompt uses, and one built by hand
     with no markup of its own. */
  const r = await page.evaluate(async () => {
    const read = () => {
      const d = document.querySelector('#ovr [role=dialog], #ovr [role=alertdialog]');
      const lab = d && d.getAttribute('aria-labelledby');
      return { role: d && d.getAttribute('role'), modal: d && d.getAttribute('aria-modal'),
               label: lab ? ((document.getElementById(lab) || {}).textContent || '').trim() : '' };
    };
    _confirmModelTool('mcp__api-slack__request', { method: 'POST', path: 'chat.postMessage', body: { channel: '#team', text: 'hi' } });
    await new Promise(res => setTimeout(res, 150));
    const consent = read(); closeOvr();
    document.getElementById('ovr').innerHTML = '<div class="ov"><div class="ob"><h2>Rename project</h2><input><button>Save</button></div></div>';
    await new Promise(res => setTimeout(res, 50));
    const plain = read(); closeOvr();
    confirmModal('Delete this?', 'It cannot be undone.', 'Delete');
    await new Promise(res => setTimeout(res, 100));
    const destructive = read(); closeOvr();
    return { consent, plain, destructive };
  });
  ok(r.consent.role === 'dialog' && r.consent.modal === 'true' && r.consent.label.length > 0,
     'the prompt before acting on a connected account is a named, modal dialog', r.consent);
  ok(r.plain.role === 'dialog' && r.plain.label === 'Rename project',
     'and so is a dialog nobody marked up, named after its heading', r.plain);
  ok(r.destructive.role === 'alertdialog', 'while one that already says what it is keeps its own role', r.destructive);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
