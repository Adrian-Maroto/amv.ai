/* CONNECTED ACCOUNTS HOLD THEIR PLACE (Nov 17, the owner: "integrations
   glitches"; "make the page look better for the connected accounts").

   The section was hidden until the server answered, then appeared and pushed
   everything under it down while somebody was reading. Now:
     · while the list loads, as many cards as there were last time hold the
       place (a count kept on the device - nothing about which accounts);
     · when the accounts land, what is below does not move;
     · each account is a card: what it may do in words, when it was last used,
       Disconnect as a quiet link, and a broken one offers Reconnect. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;
const ITEMS = [
  { id: 'c1', provider: 'google', name: 'Google', scopes: ['mail.read', 'calendar.read'], unattended: true, at: Date.now() - 864e6, lastUsed: Date.now() - 72e5, lastJob: 'Daily inbox digest' },
  { id: 'c2', provider: 'github', name: 'GitHub', scopes: ['repo.read'], unattended: false, at: Date.now() - 1728e5, lastUsed: 0, broken: true },
];

section('The first visit learns how many; the next one holds that many places');
{
  await page.evaluate((items) => {
    try{ Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true }); }catch(e){}
    AMV_API.connectList = async () => ({ configured: true, items });
    setTab('integrations');
  }, ITEMS);
  await page.waitForSelector('#conn-sec:not([hidden]) .conn-grid .conn-row:not(.conn-skel)', { timeout: 15000 });
  ok(await page.evaluate(() => loadStr('amv_conn_n')) === '2', 'it keeps the count, and only the count', await page.evaluate(() => loadStr('amv_conn_n')));
  const card = await page.evaluate(() => { const r = [...document.querySelectorAll('#conn-sec .conn-row')]; const t = (e, s) => (e.querySelector(s) || {}).textContent || '';
    return r.map(x => ({ can: t(x, '.conn-can'), used: t(x, '.conn-used'), re: !!x.querySelector('[data-dact="connAdd"]'), x: !!x.querySelector('.conn-x[data-dact="connRemove"]') })); });
  ok(/read your mail/.test(card[0].can) && /Last used/.test(card[0].used) && /Daily inbox digest/.test(card[0].used), 'a card says what it may do and when it was last used, by which job', card[0]);
  ok(card.every(c => c.x) && card[1].re && !card[0].re, 'Disconnect on each, Reconnect only on the broken one', card.map(c => [c.x, c.re]));

  /* A fresh visit, the server slow to answer, the same accounts as last time
     - the usual case. The page remembered the height they took at this width,
     so it holds that much, not a guess at how many lines each card wraps to. */
  const r = await page.evaluate(async (items) => {
    _connState = { state: 'idle', data: null, err: '' }; _connTried = '';
    let release; AMV_API.connectList = () => new Promise(res => { release = () => res({ configured: true, items }); });
    setTab('chat'); setTab('integrations');
    await new Promise(r => setTimeout(r, 300));
    const below = () => { const e = document.querySelector('.conn-machine') || document.querySelector('.int-catalog'); return e ? Math.round(e.getBoundingClientRect().top + window.scrollY) : null; };
    const held = { shown: !document.getElementById('conn-sec').hidden, skel: document.querySelectorAll('#conn-sec .conn-skel').length, at: below() };
    release && release(); await new Promise(r => setTimeout(r, 500));
    return { held, after: below(), cards: document.querySelectorAll('#conn-sec .conn-row:not(.conn-skel)').length };
  }, ITEMS);
  ok(r.held.shown && r.held.skel === 2, 'while it loads, two places are held', r.held);
  ok(r.cards === 2 && Math.abs(r.after - r.held.at) <= 16, 'and when the accounts land, what is below barely moves', { before: r.held.at, after: r.after });
}

section('On a phone, and in another language');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const out = await page.evaluate(() => [...document.querySelectorAll('#conn-sec .conn-row:not(.conn-skel)')].map(c => {
    const r = c.getBoundingClientRect(); const x = c.querySelector('.conn-x').getBoundingClientRect();
    return { card: [Math.round(r.left), Math.round(r.right)], x: [Math.round(x.left), Math.round(x.right)] }; }));
  ok(out.length === 2 && out.every(o => o.x[0] >= o.card[0] && o.x[1] <= o.card[1] && o.x[1] - o.x[0] < 140), 'Disconnect is a link inside its card, never wider than it', out);
  /* "2h ago" written by hand was English in all seventeen languages. */
  const es = await page.evaluate(() => { const was = document.documentElement.lang; document.documentElement.lang = 'es';
    try{ return _connAgo(Date.now() - 72e5) + ' | ' + _connAgo(Date.now() - 864e5); } finally { document.documentElement.lang = was; } });
  ok(/hace 2 h/.test(es) && /ayer/.test(es) && !/ago/.test(es), 'when it was used is said in the screen\'s own language', es);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
