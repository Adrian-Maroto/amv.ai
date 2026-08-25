/* THE CONTROLS A WORRIED PERSON REACHES FOR - AND TWO CLAIMS I GOT WRONG.

   This file exists because of a sweep that produced three findings about the
   Security pane and dialogs. One was real. Two were not, and both are recorded
   here because the tests below are the ones that caught them.

   WRONG 1: "Sign out everywhere renders nowhere." It renders in Settings,
   Account, and always did. The scan behind the claim stripped block comments
   before counting references, and this codebase is full of regexes and URLs in
   strings, so a stray sequence opened a fake comment that swallowed the single
   call site which disproved it. Acting on it added a second copy of the block -
   two elements sharing id="signout-others".

   WRONG 2: "No dialog traps focus, and Escape closes only six." Both were
   already handled globally, forty lines below where I added them again: a Tab
   trap using the same _ovrFocusables list, and an Escape that closes any open
   overlay. I duplicated both. The file's own comment said "There is a Tab trap"
   and I did not read it.

   Both were caught the same way: sabotage the thing you claim to have fixed and
   watch the test not care. The trap test still passed with my trap disabled,
   because the real one underneath was doing the work all along.

   So what these tests assert now is the BEHAVIOUR a person depends on, without
   claiming credit for who implemented it: the emergency control is reachable, a
   keyboard can leave any dialog, focus cannot escape one, there is a way past
   the shell, and nothing announces itself as "button". Those hold whether the
   code behind them is mine or was already there, which is the only property
   worth testing. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Adrian', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());

section('The control the Security pane names is on the Security pane');
{
  const r = await page.evaluate(async () => {
    setTab('settings');
    await new Promise(s => setTimeout(s, 400));
    if (typeof renderSetPane === 'function') renderSetPane();
    await new Promise(s => setTimeout(s, 400));
    const btn = document.getElementById('signout-others');
    return {
      present: !!btn,
      label: btn ? btn.textContent.trim() : null,
      named: /Sign out everywhere/.test(document.body.innerText),
      /* The honest line beside it: AMV cannot list other devices, and saying so
         beats a fabricated list of one row built from the user agent. */
      honest: /cannot list your other devices/i.test(document.body.innerText),
    };
  });
  ok(r.present, 'the sign-out-everywhere button renders');
  ok(r.label === 'Sign out everywhere', 'and says what it does', r.label);
  ok(r.named, 'the pane still names it in the guidance');
  ok(r.honest, 'and does not pretend to enumerate other devices');
}

section('It is wired to the one implementation that really revokes');
{
  const src = await page.evaluate(() => (document.getElementById('amv-app-code') || {}).textContent || '');
  ok(/_actSignOutEverywhere/.test(src), 'the real implementation is in the bundle');
  /* Two correct implementations is one that drifts. The handler delegates
     rather than repeating the call. */
  const calls = (src.match(/_actSignOutEverywhere\s*\(/g) || []).length;
  ok(calls >= 2, 'and it is called rather than reimplemented beside itself', calls);
}
section('A keyboard can get out of any dialog');
{
  /* The promise from showConfirmAsync settles when somebody presses a button.
     Nothing in a test does, so awaiting one hangs the page and takes the whole
     file down with it rather than failing - which is exactly what the first
     three versions of this did. It is created, used, and abandoned on purpose:
     the dialog is what is under test, not its answer. */
  const esc = await page.evaluate(async () => {
    closeOvr();
    const p = showConfirmAsync('Does escape work?'); void p;
    await new Promise(s => setTimeout(s, 250));
    const ovr = document.getElementById('ovr');
    const openBefore = !!ovr.children.length;
    ovr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(s => setTimeout(s, 250));
    return { openBefore, openAfter: !!ovr.children.length };
  });
  ok(esc.openBefore, 'a dialog opens');
  ok(!esc.openAfter, 'and Escape closes it', JSON.stringify(esc));
}

section('And cannot tab out of one into the page behind it');
{
  const r = await page.evaluate(async () => {
    closeOvr();
    const p = showConfirmAsync('Trapped?'); void p;
    await new Promise(s => setTimeout(s, 250));
    const ovr = document.getElementById('ovr');
    const f = _ovrFocusables(ovr);
    if (f.length < 2) { ovr.innerHTML = ''; return { count: f.length }; }
    const last = f[f.length - 1], first = f[0];
    last.focus();
    ovr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await new Promise(s => setTimeout(s, 120));
    const wrappedForward = document.activeElement === first;
    first.focus();
    ovr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    await new Promise(s => setTimeout(s, 120));
    const wrappedBack = document.activeElement === last;
    ovr.innerHTML = '';
    return { count: f.length, wrappedForward, wrappedBack };
  });
  ok(r.count >= 2, 'the dialog has focusable controls', r.count);
  ok(r.wrappedForward, 'tab from the last control returns to the first');
  ok(r.wrappedBack, 'and shift-tab from the first returns to the last');
}


section('A keyboard reaches the content without walking the whole shell');
{
  const r = await page.evaluate(async () => {
    const a = document.querySelector('.skip-link');
    if (!a) return { present: false };
    const hidden = a.getBoundingClientRect();
    a.focus();
    await new Promise(s => setTimeout(s, 350));
    const shown = a.getBoundingClientRect();
    return {
      present: true, href: a.getAttribute('href'),
      target: !!document.querySelector(a.getAttribute('href')),
      hiddenTop: Math.round(hidden.top), shownTop: Math.round(shown.top),
    };
  });
  ok(r.present, 'there is a skip link');
  ok(r.target, 'pointing at something that exists', r.href);
  ok(r.hiddenTop < 0, 'out of the way until it is needed', r.hiddenTop);
  ok(r.shownTop >= 0, 'and visible the moment it is focused', r.shownTop);
}

section('Destructive actions do not use the browser’s own dialog');
{
  /* Native confirm blocks the page, cannot be styled, is suppressible, and on a
     phone reads like something the site did not write. */
  const src = await page.evaluate(() => (document.getElementById('amv-app-code') || {}).textContent || '');
  const natives = (src.match(/if\(!confirm\(/g) || []).length;
  ok(natives === 0, 'no destructive action is guarded by native confirm()', natives);
}

section('Nothing announces itself as just "button"');
{
  const bad = await page.evaluate(async () => {
    const seen = [];
    for (const tab of ['chat', 'settings', 'crew', 'plans']) {
      setTab(tab);
      await new Promise(s => setTimeout(s, 300));
      [...document.querySelectorAll('button')].forEach(b => {
        const t = (b.textContent || '').trim();
        if (t.length <= 2 && !b.getAttribute('aria-label') && !b.getAttribute('title'))
          seen.push(tab + ':' + (b.className || '(no class)') + ':' + JSON.stringify(t));
      });
    }
    return [...new Set(seen)];
  });
  ok(bad.length === 0, 'every icon-only button carries an accessible name', bad.slice(0, 6));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
