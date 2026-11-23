/* SEE ALL KEEPS YOUR PLACE (Nov 23).

   The owner: pressing See the remaining (Developer tools, in Integrations)
   "sends me all the way" - you had to scroll back to find what you opened.
   The page was drawn again and its scroll restored to an old offset, so the
   topic moved by thousands of pixels when one above it was open. Now the
   topic's heading is where it was on the screen before and after, and the
   rest of its services appear under it. Crew's Show more likewise leaves the
   card you were looking at where it was. Measured, desktop and phone. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

for (const [w, h, label] of [[1280, 900, 'desktop'], [390, 844, 'phone']]) {
  const app = await bootApp({ tab: 'chat', viewport: { width: w, height: h }, user: { name: 'A', email: 'a@x.com', ini: 'A' } });
  const { page, errors } = app;
  section('Integrations, ' + label);
  await page.evaluate(() => { saveStr('amv_cw_country', 'US'); setTab('integrations'); });
  await page.waitForFunction(() => document.querySelector('.ss2[data-topic="email"] [data-app-more]'), null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  for (const topic of ['email', 'dev', 'money']) {
    const r = await page.evaluate(async (topic) => {
      const sec = () => document.querySelector('.ss2[data-topic="' + topic + '"]');
      const b = sec() && sec().querySelector('[data-app-more][aria-expanded="false"]'); if (!b) return { none: true };
      b.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 300));
      const before = sec().querySelector('h3').getBoundingClientRect().top, n0 = sec().querySelectorAll('.int-card').length;
      b.click(); await new Promise(r => setTimeout(r, 800));
      return { before: Math.round(before), after: Math.round(sec().querySelector('h3').getBoundingClientRect().top), n0, n1: sec().querySelectorAll('.int-card').length };
    }, topic);
    ok(!r.none && r.n1 > r.n0, `${topic}: See the remaining shows the rest of the topic`, r);
    ok(!r.none && Math.abs(r.after - r.before) <= 2, `${topic}: and the topic stays where it was on the screen` + (topic === 'email' ? '' : ' (with a topic above it already open)'), r);
  }
  section('Crew, ' + label);
  await page.evaluate(() => setTab('crew'));
  await page.waitForSelector('#cj-grid .cj-more', { timeout: 20000 });
  const c = await page.evaluate(async () => {
    const b = document.querySelector('#cj-grid .cj-more');
    b.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 300));
    const cards = [...document.querySelectorAll('#cj-grid .cj-card')], last = cards[cards.length - 1];
    const id = last.querySelector('[data-darg]').dataset.darg, t0 = last.getBoundingClientRect().top;
    b.click(); await new Promise(r => setTimeout(r, 700));
    const same = document.querySelector('#cj-grid [data-darg="' + id + '"]');
    return { n0: cards.length, n1: document.querySelectorAll('#cj-grid .cj-card').length, before: Math.round(t0), after: same ? Math.round(same.closest('.cj-card').getBoundingClientRect().top) : null };
  });
  ok(c.n1 > c.n0, 'Show more shows more jobs', c);
  ok(c.after !== null && Math.abs(c.after - c.before) <= 2, 'and the card you were looking at has not moved', c);
  const anchors = await page.evaluate(() => ['.cj-more', '.int-seemore'].map(s => { const e = document.querySelector(s); return e ? getComputedStyle(e).overflowAnchor : 'none'; }));
  ok(anchors.every(a => a === 'none'), 'a more button is never what the browser keeps in place', anchors);
  ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
  await app.close();
}
report(); done();
