/* THE OWNER TELLS WHO ASKED.

   The owner dashboard lists the apps people pressed Notify me on. Once one
   of them connects, its row offers "It connects now - tell them"; an app
   that still does not connect offers nothing, because telling people it is
   ready would be a lie. Pressing it asks first, then sends the app and its
   name to the server, which does the emailing (proved in
   tests/worker/notify-me-is-kept). */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Owner', email: 'owner@x.com', ini: 'O' } });
const { page, errors } = app;

const picked = await page.evaluate(() => {
  const all = _appCats().flatMap(c => c.apps);
  return { live: all.find(a => a.how), waiting: all.find(a => !a.how) };
});

section('Only an app that connects now offers to tell the people who asked');
{
  const r = await page.evaluate(([live, waiting]) => {
    const host = document.createElement('div');
    let html = '';
    try { html = _founderDashHTML({ spend: { today: 0, cap: 500, killed: false }, plans: {}, users: [], appRequests: { top: [{ app: live.slug, people: 3 }, { app: waiting.slug, people: 5 }], complete: true } }); }
    catch (e) { return { err: String(e) }; }
    host.innerHTML = html; document.body.appendChild(host); host.id = 'fd-probe';
    const btns = [...host.querySelectorAll('[data-fd-tell]')];
    return { n: btns.length, slug: btns[0] && btns[0].dataset.fdTell, name: btns[0] && btns[0].dataset.fdName, people: btns[0] && btns[0].dataset.fdN };
  }, [picked.live, picked.waiting]);
  ok(!r.err, 'the dashboard renders', r.err);
  ok(r.n === 1 && r.slug === picked.live.slug && r.name === picked.live.name && r.people === '3',
     'one button, on the app that connects, carrying its name and how many asked', { r, live: picked.live.name, waiting: picked.waiting.name });
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('the-owner-tells-who-asked') > 0) process.exitCode = 1;
done();
