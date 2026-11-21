/* A JOB CHANGE SAYS ONLY WHAT IS KNOWN (Build 16 audit D16-03, Nov 21).

   Pausing, resuming or removing a background job that failed used to say
   "It is still running" when AMV was not even connected - including for a
   paused job being resumed - and "unchanged" when the answer was simply
   lost, though the change may well have landed. Now: not connected is
   "nothing was changed"; a refusal is "unchanged"; no answer is "could not
   confirm", and the job is read back. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page, errors } = app;
await page.evaluate(async () => {
  setTab('crew');
  for (let i = 0; i < 100 && typeof window.mcServerJob !== 'function'; i++) await new Promise(r => setTimeout(r, 50));
  window.__toasts = []; const t = window.toast; window.toast = (m, k) => { window.__toasts.push(String(m)); };
  window.__refreshed = 0; window._autoRefresh = async () => { window.__refreshed++; };
});
const change = (fail, action = 'resume') => page.evaluate(async ({ fail, action }) => {
  window.__toasts = []; window.__refreshed = 0;
  window._autoApi = async () => { if (fail === 'nc') throw new Error('not-connected');
    if (fail === 'net') throw new TypeError('Failed to fetch');
    const e = new Error(fail === '409' ? 'That job was changed elsewhere.' : 'Server error'); e.status = fail === '409' ? 409 : 502; throw e; };
  await mcServerJob('job1|' + action);
  return { toasts: window.__toasts, refreshed: window.__refreshed };
}, { fail, action });

section('Not connected');
{
  const r = await change('nc', 'resume');
  ok(r.toasts.some(t => /nothing was changed/.test(t)) && !r.toasts.some(t => /still running/.test(t)), 'nothing was changed - and no claim that a paused job is running', r.toasts);
}

section('Refused by the server');
{
  const r = await change('409', 'pause');
  ok(r.toasts.some(t => /unchanged/.test(t)), 'a refusal is unchanged', r.toasts);
}

section('No answer, or the server failing');
{
  for (const f of ['net', '502']) {
    const r = await change(f, 'pause');
    ok(r.toasts.some(t => /could not confirm/.test(t)) && !r.toasts.some(t => /unchanged/.test(t)), f + ': it does not claim either way', r.toasts);
    ok(r.refreshed === 1, f + ': and the job is read back', r.refreshed);
  }
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
