/* "BUY THIS FROM THIS WEBSITE WHEN IT IS AT 200."

   Two halves, and only one is new. Watching a page and reporting what changed
   is what the scheduler already does; buying inside a ceiling is what the
   spending limits already do. What was missing is the thing between them -
   somewhere to say WHICH page and WHICH price, and have that become a real job
   rather than a note in a browser.

   THE TWO THINGS THIS HOLDS, AND BOTH ARE ABOUT MONEY:

   IT IS A REAL SCHEDULED JOB. Saved only in this browser, a watch stops the
   moment the tab closes - which is the opposite of what somebody asking for it
   wants, and it would show "Watching" while nothing watched. So it goes to
   /auto/create, the scheduler the cron walks, and the entry records whether
   that succeeded. A refusal says so rather than showing the same badge.

   AND IT NEVER BUYS ON ITS OWN. `approval:'require'` is not a setting on this
   screen. The spending limits are a ceiling on what AMV may spend WITHOUT
   ASKING, for something a job you started needs right now; a standing
   instruction to buy while nobody is looking is a different thing entirely.
   The instruction sent to the scheduler says so in words, because the model
   reads that sentence and not this comment. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const BASE = 'https://backend.example.workers.dev';
const app = await bootApp({ apiBase: BASE, user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

let created = null, cancelled = null, refuse = false;
await page.route('**/auto/create**', (r) => {
  created = JSON.parse(r.request().postData() || '{}');
  return refuse
    ? r.fulfill({ status: 200, contentType: 'application/json',
                  body: JSON.stringify({ error: 'no service', code: 'needs_service' }) })
    : r.fulfill({ status: 200, contentType: 'application/json',
                  body: JSON.stringify({ ok: true, item: { id: 'job_1' } }) });
});
await page.route('**/auto/update**', (r) => {
  cancelled = JSON.parse(r.request().postData() || '{}');
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
});
await page.route('**/v1/connect/list**', (r) => r.fulfill({ status: 200,
  contentType: 'application/json', body: JSON.stringify({ ok: true, providers: [], items: [] }) }));

const open = () => page.evaluate((b) => {
  saveStr('amv_api_base', b); saveStr('amv_api_token', 'tok');
  saveStr('amv_token_exp', String(Date.now() + 3e6)); saveStr('amv_plan', 'pro');
  setTab('spend');
}, BASE);

const addWatch = (item, url, price) => page.evaluate(async (o) => {
  document.getElementById('wl-item').value = o.item;
  document.getElementById('wl-url').value = o.url;
  document.getElementById('wl-target').value = String(o.price);
  document.getElementById('wl-go').click();
  await new Promise(r => setTimeout(r, 1500));
  return {
    say: (document.getElementById('wl-say') || {}).textContent || '',
    rows: [...document.querySelectorAll('.wl-row .wl-n')].map(e => e.textContent),
    live: !!document.querySelector('.wl-live'),
    local: !!document.querySelector('.wl-local'),
    stored: load('amv_watchlist') || [],
  };
}, { item, url, price });

await open();
await page.waitForTimeout(800);

section('A watch becomes a job the server runs');
{
  const r = await addWatch('Noise-cancelling headphones', 'https://shop.example.com/hp', 200);
  ok(r.rows.length === 1, 'it is on the list', r.rows);
  ok(!!created, 'and the scheduler was actually called', !!created);
  ok(created.repeat === 'daily', 'on a schedule', created.repeat);
  ok((r.stored[0] || {}).jobId === 'job_1',
     'with the job it created recorded against it', r.stored[0]);
  ok(r.live && !r.local, 'and it says it is watching', { live: r.live, local: r.local });
  ok(/watching/i.test(r.say), 'and says so where somebody can read it', r.say);
}

section('The instruction it schedules cannot be read as permission to buy');
{
  const d = String(created.detail || '');
  ok(d.indexOf('https://shop.example.com/hp') >= 0, 'it names the page', d.slice(0, 80));
  ok(/200/.test(d), 'and the price', d.slice(0, 120));
  ok(created.approval === 'require',
     'approval is required, which is not a setting on this screen', created.approval);
  /* The words matter as much as the flag: the model reads the instruction. */
  ok(/do not buy/i.test(d) && /approve/i.test(d),
     'and the instruction itself says to stop and show the purchase',
     d.slice(-120));
}

section('A refusal is reported as a refusal, not as a watch');
{
  refuse = true;
  const r = await addWatch('A second thing', 'https://shop.example.com/two', 50);
  ok(r.rows.length === 2, 'it is still saved', r.rows);
  ok(r.local, 'but badged as this device only, not as watching', { live: r.live, local: r.local });
  ok(!/^Watching\./i.test(r.say) && r.say.length > 0,
     'and the sentence does not claim it is scheduled', r.say);
  ok(!(r.stored[0] || {}).jobId, 'with no job id it does not have', r.stored[0]);
  refuse = false;
}

section('Stopping a watch stops the job too');
{
  const before = await page.evaluate(() => (load('amv_watchlist') || [])
    .find(w => w.jobId) || null);
  ok(!!before, 'there is a watch with a job behind it', before);
  const r = await page.evaluate(async (id) => {
    const b = document.querySelector('[data-wl-rm="' + id + '"]');
    b.click();
    await new Promise(res => setTimeout(res, 900));
    return { rows: [...document.querySelectorAll('.wl-row .wl-n')].map(e => e.textContent),
             stored: (load('amv_watchlist') || []).map(w => w.id) };
  }, before.id);
  ok(r.stored.indexOf(before.id) < 0, 'it leaves the list', r.stored);
  /* THE PART THAT WOULD OTHERWISE BE INVISIBLE: a watch removed from the
     screen while its job keeps running is the worst of both - nothing says it
     exists and it still checks every day. */
  ok(cancelled && cancelled.id === before.jobId && cancelled.action === 'cancel',
     'and the job behind it is cancelled rather than left running', cancelled);
}

ok(errors.length === 0, 'and none of it raised an error', errors);
await app.close();
process.exit(report() === 0 ? (done(), 0) : 1);
