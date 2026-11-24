/* THE WORKSPACE SHOWS WHAT BROKE, AND WHAT IS NEXT (owner, Nov 24: "like a
   coding agent - the running text on the left, the preview, bugs and
   suggestions on the right").

   Problems come from the app itself: the preview frame passes each uncaught
   error, failed promise and console.error to AMV, which accepts them only
   from that frame and shows them as text. Next steps are asked for - they
   are AMV reading the project, which is a message - never invented. Held:
     · an error thrown by the running app is on the Problems tab, counted;
     · a message pretending to be one, from anywhere else, is not;
     · Fix this sends the error to AMV as the next message;
     · a new page starts with no problems;
     · Next steps shows nothing until asked, then three suggestions that each
       go into the box, and says what asking costs. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', viewport: { width: 1280, height: 860 } });
const { page, errors } = app;
await page.waitForTimeout(500);

const BROKEN = `<!doctype html><html><body><h1 id="h">app</h1><script>
  console.error('Could not load the scores');
  Promise.reject(new Error('fetch failed'));
  setTimeout(function(){ undefinedFunction(); }, 50);
</scr` + `ipt></body></html>`;

section('The running app reports what went wrong');
await page.evaluate((html) => {
  document.querySelectorAll('.cc-banner').forEach(b => b.remove());
  _DEV.log = [{ role: 'user', text: 'a scoreboard' }, { role: 'sys', text: 'built' }];
  _devSetFile('index.html', html, 'html');
  setTab('dev'); renderCodeView();
}, BROKEN);
await page.waitForFunction(() => (typeof _DEV !== 'undefined' && (_DEV.problems || []).length >= 3), null, { timeout: 10000 }).catch(() => {});
const p1 = await page.evaluate(() => ({ list: (_DEV.problems || []).map(p => p.m), tab: (document.getElementById('dev-tab-prob') || {}).textContent }));
ok(p1.list.some(m => /Could not load the scores/.test(m)), 'a console.error from the app', p1.list);
ok(p1.list.some(m => /fetch failed/.test(m)), 'a failed promise', p1.list);
ok(p1.list.some(m => /undefinedFunction/.test(m)), 'and an uncaught error', p1.list);
ok(/Problems \(3\)/.test(p1.tab || ''), 'the tab counts them', p1.tab);

section('Only the preview frame can report one');
await page.evaluate(() => { window.postMessage({ __amv: 'preview-error', m: 'forged from the page' }, '*'); });
await page.waitForTimeout(300);
ok(await page.evaluate(() => !(_DEV.problems || []).some(p => /forged/.test(p.m))), 'a message from anywhere else is ignored');

section('The Problems tab lists them, as text, each with Fix this');
await page.click('#dev-tab-prob');
await page.waitForTimeout(200);
const p2 = await page.evaluate(() => ({ shown: !document.getElementById('dev-prob-body').hidden,
  items: [...document.querySelectorAll('.dev-prob .dev-prob-m')].map(e => e.textContent),
  fixes: document.querySelectorAll('.dev-prob-fix').length, previewKept: !!document.querySelector('#dev-prev-body .dev-prev-frame') }));
ok(p2.shown && p2.items.length === 3 && p2.fixes === 3, 'three problems, each with Fix this', p2);
ok(p2.previewKept, 'and the app keeps running behind the tab', p2.previewKept);
const sent = await page.evaluate(() => { let said = null; _devSend = () => { said = document.getElementById('dev-msg').value; };
  [...document.querySelectorAll('.dev-prob')].find(li => /undefinedFunction/.test(li.textContent)).querySelector('.dev-prob-fix').click(); return said; });
ok(/Fix this error from the running preview/.test(sent || '') && /undefinedFunction/.test(sent || ''), 'Fix this sends the error to AMV', sent);

section('A new page starts with no problems');
await page.evaluate(() => { _devSetFile('index.html', '<!doctype html><p>fine</p>', 'html'); _devPaintPreview && document.querySelector('#dev-prev-body .dev-prev-frame') && _previewMount(document.getElementById('dev-prev-body'), '<!doctype html><p>fine</p>', 'dev-prev-frame'); });
await page.waitForTimeout(600);
const p3 = await page.evaluate(() => ({ n: (_DEV.problems || []).length, tab: document.getElementById('dev-tab-prob').textContent, body: document.getElementById('dev-prob-body').textContent }));
ok(p3.n === 0 && p3.tab === 'Problems', 'the list and the count are clear', p3);
ok(/No problems in the running preview/.test(p3.body), 'and it says so', p3.body);

section('Next steps: nothing until asked, then three that go into the box');
await page.click('#dev-tab-next');
await page.waitForTimeout(150);
const n1 = await page.evaluate(() => ({ items: document.querySelectorAll('.dev-next').length, note: (document.querySelector('.dev-side-note') || {}).textContent || '',
  btn: (document.getElementById('dev-next-ask') || {}).textContent || '' }));
ok(n1.items === 0 && /Suggest next steps/.test(n1.btn), 'only the button, before anybody asks', n1);
ok(/one message/.test(n1.note), 'which says what it costs', n1.note);
await page.evaluate(() => { aiComplete = async () => '["Add a dark mode toggle","Save scores between visits","Show the top three players"]'; });
await page.click('#dev-next-ask');
await page.waitForFunction(() => document.querySelectorAll('.dev-next').length === 3, null, { timeout: 5000 }).catch(() => {});
const n2 = await page.evaluate(() => [...document.querySelectorAll('.dev-next')].map(b => b.textContent));
ok(n2.length === 3 && n2[0] === 'Add a dark mode toggle', 'three suggestions, in order', n2);
await page.click('.dev-next >> nth=1');
ok(await page.evaluate(() => document.getElementById('dev-msg').value === 'Save scores between visits'), 'a suggestion goes into the box to edit or send');
await page.evaluate(() => { aiComplete = async () => { throw new Error('offline'); }; });
await page.click('#dev-next-ask');
await page.waitForTimeout(400);
ok(/could not suggest/.test(await page.evaluate(() => document.getElementById('dev-next-body').textContent)), 'a failure is said, not shown as no suggestions');

section('No JavaScript errors from AMV');
/* The app under test throws on purpose, inside its sandboxed frame; those are
   the problems this file is about. Anything else is AMV's own. */
const own = errors.filter(e => !/fetch failed|undefinedFunction|Could not load the scores/.test(String(e)));
ok(own.length === 0, 'zero uncaught errors from AMV itself', own);

report();
await app.close();
done();
