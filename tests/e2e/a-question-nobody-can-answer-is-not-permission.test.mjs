/* THE GUARD THAT SKIPPED ASKING, IN EXACTLY THE CASE IT WAS WRITTEN FOR.

   Fourteen destructive actions were written one of these two ways:

       if(typeof confirm !== 'function' || confirm(msg)) go();
       if(typeof confirm === 'function' && !confirm(msg)) return;

   Read the first: no confirm, so the left side is true, so `go()` runs. Read the
   second: no confirm, so the && is false, so it does NOT return - and falls
   through to the action. Both PROCEED when there is nothing to ask with. The
   line put there to make somebody think twice was the line that skipped the
   question: leaving a team, revoking an API key, disconnecting a bank account,
   rejecting a payout, signing every device out.

   That is not a theoretical branch. A page inside a sandboxed frame gets a
   window.confirm that returns without drawing anything, and an embedded or
   half-rendered context may have no overlay for AMV's own dialog either. Those
   are the conditions the fallback existed for, and the conditions it failed in.

   A question nobody can answer is not permission. The order is AMV's dialog,
   then the browser's, then refuse and say so - and this suite holds that line
   from both ends: it must not proceed unasked, and it must not hang instead. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = await bootApp({ tab: 'settings', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

section('No destructive action is guarded by a shape that proceeds without asking');
{
  const bad = [];
  for (const f of readdirSync(join(ROOT, 'src', 'app')).filter(n => n.endsWith('.js'))) {
    const src = readFileSync(join(ROOT, 'src', 'app', f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    src.split('\n').forEach((line, i) => {
      if (/typeof\s+confirm\s*!==\s*'function'\s*\|\|/.test(line) ||
          /typeof\s+confirm\s*===\s*'function'\s*&&\s*!/.test(line))
        bad.push(f + ':' + (i + 1));
    });
  }
  ok(bad.length === 0,
     'neither fail-open shape survives anywhere in the sources', bad.join(', '));
}

section('With nothing to ask with, it refuses - it does not proceed');
{
  const r = await page.evaluate(async () => {
    /* Both routes removed: no overlay to draw into, and no browser dialog. */
    const ovr = document.getElementById('ovr');
    const parent = ovr.parentNode, next = ovr.nextSibling;
    const realConfirm = window.confirm, realToast = window.toast;
    const toasts = [];
    window.toast = m => toasts.push(String(m));
    try { delete window.confirm; } catch (e) {}
    if (typeof window.confirm === 'function') window.confirm = undefined;
    parent.removeChild(ovr);

    let answer = 'never settled';
    const raced = await Promise.race([
      _askDestructive('Delete everything?', 'This cannot be undone.', 'Delete')
        .then(v => { answer = v; return 'settled'; }),
      new Promise(r2 => setTimeout(() => r2('hung'), 1200)),
    ]);

    parent.insertBefore(ovr, next);
    window.confirm = realConfirm; window.toast = realToast;
    return { raced, answer, toasts };
  });
  ok(r.raced === 'settled', 'it answers rather than hanging', r.raced);
  ok(r.answer === false, 'and the answer is no', String(r.answer));
  ok(r.toasts.some(t => /nothing was changed/i.test(t)),
     'and it says nothing was changed, so a dead tap is not a mystery',
     r.toasts.join(' | '));
}

section('Escape settles it, because the key handler cannot know about the promise');
{
  /* Cancel, the backdrop and the close button all resolve in their own
     handlers. Escape does not - it goes through the global keydown listener,
     which takes the overlay down knowing nothing about this promise. A dialog
     that trusted only its own buttons would leave the caller awaiting forever,
     holding a disabled button, which is a worse failure than the one fixed. */
  const r = await page.evaluate(async () => {
    const p = _askDestructive('Revoke this key?', 'It cannot be restored.', 'Revoke');
    await new Promise(r2 => setTimeout(r2, 120));
    const opened = !!document.getElementById('cfm-yes');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const raced = await Promise.race([
      p.then(v => 'settled:' + v),
      new Promise(r2 => setTimeout(() => r2('hung'), 1200)),
    ]);
    return { opened, raced };
  });
  ok(r.opened, 'the dialog opened', r.opened);
  ok(r.raced === 'settled:false', 'and Escape answers no rather than hanging', r.raced);
}

section('Continue is a yes, which is less obvious than it looks');
{
  /* The dialog watches the overlay leaving to catch Escape - and pressing
     Continue ALSO takes the overlay down. The mutation record is queued as a
     microtask, so if the yes were deferred at all the watcher would win the
     race and read a confirmation as a cancel. It settles synchronously in its
     own handler for that reason, and this is the assertion that would catch it
     regressing. */
  const r = await page.evaluate(async () => {
    const p = _askDestructive('Leave the team?', 'You lose the shared library.', 'Leave');
    await new Promise(r2 => setTimeout(r2, 120));
    const yes = document.getElementById('cfm-yes');
    const label = yes ? yes.textContent : '';
    if (yes) yes.click();
    const raced = await Promise.race([
      p.then(v => 'settled:' + v),
      new Promise(r2 => setTimeout(() => r2('hung'), 1200)),
    ]);
    return { raced, label };
  });
  ok(r.label === 'Leave', 'the confirm button is labelled with the action, not "OK"', r.label);
  ok(r.raced === 'settled:true', 'and pressing it is read as yes', r.raced);
}

section('Cancel is what has the focus, and the danger is coloured');
{
  const r = await page.evaluate(async () => {
    const p = _askDestructive('Disconnect this account?', 'History is deleted.', 'Disconnect');
    await new Promise(r2 => setTimeout(r2, 150));
    const yes = document.getElementById('cfm-yes'), no = document.getElementById('cfm-no');
    const out = {
      focused: document.activeElement === no,
      yesDestructive: yes.classList.contains('bd2'),
      role: document.querySelector('[role="alertdialog"]') ? 'alertdialog' : '',
      body: (document.querySelector('.ob-sub') || {}).textContent || '',
    };
    no.click();
    await p;
    return out;
  });
  ok(r.focused, 'Cancel holds the focus, so a habitual Enter destroys nothing', r.focused);
  ok(r.yesDestructive, 'the confirming button is coloured as destructive', r.yesDestructive);
  ok(r.role === 'alertdialog', 'and it is announced as an alert dialog', r.role);
  ok(/history is deleted/i.test(r.body),
     'with room for the second line the browser box could never show', r.body.slice(0, 50));
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3));
if (report('a-question-nobody-can-answer-is-not-permission') > 0) process.exitCode = 1;
done();
await app.close();
