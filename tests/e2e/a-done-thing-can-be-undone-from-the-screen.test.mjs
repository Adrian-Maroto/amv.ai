/* A DONE THING CAN BE UNDONE FROM THE SCREEN.

   The server's receipt carries a signed ticket for taking a write back. The
   person gets it as a notice with an Undo button; the model gets a sentence
   about it and never the ticket, because taking something back is the
   person's click, not a tool call. A write that cannot be undone offers no
   button and the model is told why. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

const run = (answer, undoAnswer) => page.evaluate(async ({ answer, undoAnswer }) => {
  window.__undone = null;
  Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true });
  AMV_API.connectAct = async () => JSON.parse(JSON.stringify(answer));
  AMV_API.connectUndo = async (t) => { window.__undone = t; if (undoAnswer.error) throw new Error(undoAnswer.message); return undoAnswer; };
  document.querySelectorAll('#toast-wrap .toast').forEach(t => t.remove());
  const r = await _connActRun('calendar.create', { title: 'Lunch' });
  return { r, toasts: [...document.querySelectorAll('#toast-wrap .toast')].map(t => t.textContent) };
}, { answer, undoAnswer });

const TICKET = 'header.payload.sig';
const done_ = { ok: true, action: 'calendar.create', result: { created: true, id: 'e1', verified: true },
  receipt: { action: 'calendar.create', status: 'done', undo: { token: TICKET, label: 'Delete the event', until: Date.now() + 864e5 }, irreversible: null } };

section('An event that can be taken back offers Undo, and the model is told without being handed the ticket');
{
  const x = await run(done_, { ok: true, undone: true, verified: true });
  ok(x.toasts.some(t => /Event added to your calendar/.test(t) && /Undo/.test(t)), 'the notice says what was done, with Undo', x.toasts);
  ok(/undo this from the notice/.test(x.r.undo || '') && /Delete the event/.test(x.r.undo), 'the model hears that the person can undo it, and how', x.r.undo);
  ok(!JSON.stringify(x.r).includes(TICKET), 'and the ticket is nowhere in what the model gets', x.r);
  await page.click('#toast-wrap .toast-btn');
  await page.waitForFunction(() => [...document.querySelectorAll('#toast-wrap .toast')].some(t => /Undone/.test(t.textContent)), null, { timeout: 5000 }).catch(() => {});
  const after = await page.evaluate(() => ({ t: window.__undone, toasts: [...document.querySelectorAll('#toast-wrap .toast')].map(t => t.textContent) }));
  ok(after.t === TICKET, 'pressing Undo sends that ticket back', after.t);
  ok(after.toasts.some(t => /Undone/.test(t)), 'and says it is undone once the server checked', after.toasts);
}

section('An undo the server could not take back says so instead of "Undone"');
{
  await run(done_, { error: true, message: 'It has been changed since AMV did it, so AMV left it alone. Change it in the account itself.' });
  await page.click('#toast-wrap .toast-btn');
  await page.waitForFunction(() => [...document.querySelectorAll('#toast-wrap .toast')].some(t => /changed since/.test(t.textContent)), null, { timeout: 5000 }).catch(() => {});
  const toasts = await page.evaluate(() => [...document.querySelectorAll('#toast-wrap .toast')].map(t => t.textContent));
  ok(toasts.some(t => /changed since AMV did it/.test(t)) && !toasts.some(t => /^\W*Undone/.test(t)), 'the server’s reason, not a success', toasts);
}

section('Sent mail offers no Undo, and the model is told it cannot be called back');
{
  const x = await run({ ok: true, action: 'gmail.send', result: { sent: true, id: 'm1', verified: true },
    receipt: { action: 'gmail.send', status: 'done', undo: null, irreversible: 'Sent mail cannot be called back. If it went to the wrong person, write to them.' } }, {});
  ok(!x.toasts.some(t => /Undo/.test(t)), 'no button that pretends', x.toasts);
  ok(/cannot be undone/.test(x.r.undo || '') && /called back/.test(x.r.undo), 'and the model has the reason to pass on', x.r.undo);
}

section('A page published for the first time can be taken down from the notice; an update offers nothing');
{
  const x = await page.evaluate(async () => {
    const real = window._autoApi, calls = [];
    window._autoApi = async (path, body) => { calls.push([path, body]);
      if (path === '/deploy') return body.slug === 'old-page'
        ? { ok: true, slug: 'old-page', url: 'https://x/s/old-page', verified: true, receipt: { status: 'done', undo: null, irreversible: 'The earlier version of this page is not kept.' } }
        : { ok: true, slug: 'new-page', url: 'https://x/s/new-page', verified: true, receipt: { status: 'done', undo: { label: 'Take the page down', slug: 'new-page' } } };
      return { ok: true }; };
    const toasts = () => [...document.querySelectorAll('#toast-wrap .toast')].map(t => t.textContent);
    try{
      document.querySelectorAll('#toast-wrap .toast').forEach(t => t.remove());
      await _deployApi('/deploy', { html: '<p>u</p>', title: 'Old', slug: 'old-page' });
      const afterUpdate = toasts();
      await _deployApi('/deploy', { html: '<p>n</p>', title: 'New' });
      const afterNew = toasts();
      document.querySelector('#toast-wrap .toast-btn').click();
      await new Promise(r => setTimeout(r, 300));
      return { afterUpdate, afterNew, calls, end: toasts() };
    } finally { window._autoApi = real; }
  });
  ok(!x.afterUpdate.some(t => /Undo/.test(t)), 'an update shows no Undo', x.afterUpdate);
  ok(x.afterNew.some(t => /Page published/.test(t) && /Undo/.test(t)), 'a first publish does', x.afterNew);
  ok(x.calls.some(c => c[0] === '/deploy/delete' && c[1].slug === 'new-page'), 'and Undo takes that page down, by its own name', x.calls);
  ok(x.end.some(t => /Page taken down/.test(t)), 'and says so', x.end);
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('a-done-thing-can-be-undone-from-the-screen') > 0) process.exitCode = 1;
done();
