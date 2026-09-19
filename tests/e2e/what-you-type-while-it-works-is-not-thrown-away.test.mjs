/* PRESSING ENTER WHILE AMV WAS BUILDING DID NOTHING AT ALL.

   `_devSend` opened with `if(_DEV.busy) return;`. No send, no queue, no
   message, and the words left sitting in the box looking like they had gone.
   Saying the next thing while watching a build is the most ordinary thing
   there is to do on this screen, and the product's answer was silence.

   A turn here can run for a minute and rewrite a project, so it is not
   interrupted just because somebody typed. The message waits, visibly, and
   goes the moment the turn ends. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

const openDev = () => page.evaluate(async () => {
  document.getElementById('ck')?.remove();
  _setPlan('ultra'); setTab('dev');
  await new Promise(x => setTimeout(x, 450));
  _DEV.queue = []; _DEV.busy = false;
  try { _devRenderQueue(); } catch (e) {}
});
const type = (t) => page.evaluate((v) => {
  const ta = document.getElementById('dev-msg');
  ta.value = v; ta.dispatchEvent(new Event('input', { bubbles: true }));
}, t);

await openDev();

section('While a turn is running, what you type is kept');
{
  const r = await page.evaluate(async () => {
    _DEV.busy = true; try { _devBusy(true, 'Building'); } catch (e) {}
    const ta = document.getElementById('dev-msg');
    ta.value = 'add a footer'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    await _devSend();
    await new Promise(x => setTimeout(x, 120));
    const host = document.getElementById('dev-queue');
    return { queued: _DEV.queue.slice(), shown: !host.hidden,
             box: ta.value, text: host.innerText || '' };
  });
  ok(r.queued.length === 1 && r.queued[0] === 'add a footer',
     'the message is queued rather than dropped', r.queued);
  ok(r.box === '', 'and the box is cleared, so it does not look unsent', JSON.stringify(r.box));
  ok(r.shown, 'the queue is visible - waiting silently would be the old bug again', r.shown);
  ok(/add a footer/.test(r.text), 'showing the words that are waiting', r.text.slice(0, 80));
  ok(/finishes/i.test(r.text), 'and saying when they will go', r.text.slice(0, 120));
}

section('A second thought does not replace the first');
{
  const r = await page.evaluate(async () => {
    const ta = document.getElementById('dev-msg');
    ta.value = 'and dark mode'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    await _devSend();
    await new Promise(x => setTimeout(x, 120));
    return { queued: _DEV.queue.slice(),
             rows: document.querySelectorAll('#dev-queue .dvq-item').length };
  });
  ok(r.queued.length === 2, 'both are waiting', r.queued);
  ok(r.queued[0] === 'add a footer' && r.queued[1] === 'and dark mode',
     'in the order they were typed', r.queued);
  ok(r.rows === 2, 'and both are on screen', r.rows);
}

section('One can be taken back without losing the other');
{
  const r = await page.evaluate(async () => {
    document.querySelector('#dev-queue [data-dvq="0"]').click();
    await new Promise(x => setTimeout(x, 120));
    return { queued: _DEV.queue.slice(),
             rows: document.querySelectorAll('#dev-queue .dvq-item').length };
  });
  ok(r.queued.length === 1 && r.queued[0] === 'and dark mode',
     'the one that was removed is gone and the other is not', r.queued);
  ok(r.rows === 1, 'and the screen agrees', r.rows);
}

section('When the turn ends, the queue goes');
{
  /* Through _devIdle, which is the one place that decides a turn is over -
     five call sites set the busy flag and a queue drained from four of them
     is a queue that hangs on the fifth. */
  const r = await page.evaluate(async () => {
    let sentWith = null;
    const real = window._devSend;
    window._devSend = async function () {
      sentWith = document.getElementById('dev-msg').value; _DEV.busy = false;
    };
    _devIdle();
    await new Promise(x => setTimeout(x, 200));
    window._devSend = real;
    const host = document.getElementById('dev-queue');
    return { sentWith, left: _DEV.queue.length, hidden: host.hidden };
  });
  ok(r.sentWith === 'and dark mode', 'the waiting message is what gets sent', r.sentWith);
  ok(r.left === 0, 'and it is no longer waiting', r.left);
  ok(r.hidden === true, 'so the queue takes itself off the screen', r.hidden);
}

section('Nothing is queued when nothing is running');
{
  /* The ordinary path must be untouched: not busy means send, not collect. */
  const r = await page.evaluate(async () => {
    _DEV.busy = false; _DEV.queue = []; _devRenderQueue();
    let called = false;
    const real = window._devSend;
    document.getElementById('dev-msg').value = 'build me a page';
    /* Call the real one and stop it at the first thing it does after the
       queue branch, so this measures WHICH branch was taken. */
    _DEV.atHome = true;
    await real.call(window).catch(() => {});
    called = true;
    return { called, queued: _DEV.queue.length, atHome: _DEV.atHome };
  });
  ok(r.queued === 0, 'an idle composer sends instead of queueing', r.queued);
  ok(r.atHome === false, 'and the turn really started', r);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
