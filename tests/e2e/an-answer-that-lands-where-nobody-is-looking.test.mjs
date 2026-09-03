/* THE BUTTON WORKED. THE ANSWER WENT SOMEWHERE ELSE.

   "Preview this week" on the founder dashboard said Loading and, from the
   owner's side, never did anything. The endpoint is not the problem - driven
   against the real Worker it answers 200 in under a fifth of a second with a
   complete digest.

   `_wireDigestCard` captured its output element once, when the card was wired:

       const out = $('fd-digest-out');
       const say = (t, kind) => { if(out){ ... } };

   The business tab re-renders itself with `el.innerHTML = ...` - on a stats
   refresh, or on leaving the tab and coming back. That detaches the captured
   node and puts a fresh empty one in its place. A preview in flight across a
   re-render therefore wrote its answer into the detached node: the request
   succeeded, the digest was built, and it landed on an element no longer in
   the document. Nothing appears. Nothing errors. The control looks dead.

   The same function was already careful about exactly this hazard for the
   admin token - "Read at click time, not captured when the card was built" -
   because the operator may correct the token after the card exists. The
   element had the identical problem and no guard.

   Elements are looked up when they are written to, which is the only time the
   answer is known to be about the page that is actually on screen. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '' });
const { page, errors } = app;
const BASE = 'https://amv-e2e.workers.dev';

const DIGEST = { ok: true, preview: true, week: '2026-08-31',
                 subject: 'AMV weekly: 0 signups, $200 MRR',
                 text: 'Signups this week: 0\nMRR: $200' };

/* Held open so the test can re-render the card while the request is in flight,
   which is the whole scenario. */
let release = null;
/* Reassigned per request, so releasing before the NEXT request has reached the
   handler would call the previous one - a race that made this file flaky
   before it made it useful. `arrived()` waits for the handler to hand over a
   fresh one. */
const arrived = async () => { for (let i = 0; i < 200 && !release; i++) await new Promise(r => setTimeout(r, 25)); return !!release; };
const hold = () => { const f = release; release = null; f(); };
await page.route('**/admin/digest*', async route => {
  await new Promise(r => { release = r; });
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DIGEST) });
});

async function mountCard() {
  await page.evaluate((base) => {
    AMV_API.base = base;
    localStorage.setItem('amv_api_base', base);
    let host = document.getElementById('amv-test-host');
    if (!host) { host = document.createElement('div'); host.id = 'amv-test-host'; document.body.appendChild(host); }
    host.innerHTML = '<input id="fd-token" value="test-admin-token">' + _digestCardHTML();
    _wireDigestCard();
  }, BASE);
}

section('The digest card answers onto the page that is actually on screen');
{
  await mountCard();
  await page.evaluate(() => document.getElementById('fd-digest-preview').click());
  await page.waitForFunction(() =>
    (document.getElementById('fd-digest-out') || {}).textContent === 'Loading…');
  ok(true, 'the click is acknowledged with Loading');

  /* The re-render that was losing the answer: same markup, brand new nodes. */
  const swapped = await page.evaluate(() => {
    const before = document.getElementById('fd-digest-out');
    const host = document.getElementById('amv-test-host');
    host.innerHTML = '<input id="fd-token" value="test-admin-token">' + _digestCardHTML();
    const after = document.getElementById('fd-digest-out');
    return { replaced: before !== after, nowEmpty: after.textContent === '' };
  });
  ok(swapped.replaced, 'the card is re-rendered, replacing the output node', swapped);
  ok(swapped.nowEmpty, 'so the visible one starts empty', swapped);

  ok(await arrived(), 'the request reached the server');
  hold();
  await page.waitForFunction(() =>
    /AMV weekly/.test((document.getElementById('fd-digest-out') || {}).textContent || ''),
    null, { timeout: 8000 }).catch(() => {});

  const landed = await page.evaluate(() => {
    const out = document.getElementById('fd-digest-out');
    return { text: (out.textContent || '').slice(0, 80), attached: document.body.contains(out) };
  });
  ok(/AMV weekly/.test(landed.text),
     'the digest arrives on the node that is in the document', landed);
  ok(landed.attached, 'and that node really is the one on screen', landed.attached);
  ok(/MRR/.test(landed.text), 'with the figures, which is what was asked for', landed.text);
}

section('And the ordinary case, where nothing moved, still works');
{
  await mountCard();
  const p = page.evaluate(() => document.getElementById('fd-digest-preview').click());
  await page.waitForFunction(() =>
    (document.getElementById('fd-digest-out') || {}).textContent === 'Loading…');
  ok(await arrived(), 'the second request reaches the server too');
  hold();
  await p;
  await page.waitForFunction(() =>
    /AMV weekly/.test((document.getElementById('fd-digest-out') || {}).textContent || ''),
    null, { timeout: 8000 });
  const t = await page.evaluate(() => document.getElementById('fd-digest-out').textContent);
  ok(/AMV weekly/.test(t) && /MRR/.test(t), 'the preview shows the digest', t.slice(0, 80));
}

section('A failure is reported on the visible node too');
{
  await page.unroute('**/admin/digest*');
  await page.route('**/admin/digest*', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"metrics unavailable"}' }));
  await mountCard();
  await page.evaluate(() => document.getElementById('fd-digest-preview').click());
  await page.waitForFunction(() =>
    /Could not build/.test((document.getElementById('fd-digest-out') || {}).textContent || ''),
    null, { timeout: 8000 });
  const t = await page.evaluate(() => document.getElementById('fd-digest-out').textContent);
  ok(/metrics unavailable/.test(t), 'and says what the server said', t.slice(0, 90));
  ok(!/Loading/.test(t), 'rather than sitting on Loading for ever', t.slice(0, 90));
}

ok(errors.length === 0, 'no console errors', errors);

await app.close();
if (report('an-answer-that-lands-where-nobody-is-looking') > 0) process.exitCode = 1;
done();
