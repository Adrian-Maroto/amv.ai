/* "No earnings yet - sell something to start."

   That was printed whenever the transaction list came back empty, and the list
   came back empty in three completely different situations: the seller really
   has not sold anything, the money history could not be READ, and - separately
   - the list is capped at 50 under a heading that says "Transaction history".

   The second one put that sentence directly underneath a lifetime-earnings
   figure on the same screen. Not just false: self-contradictory, on the screen
   somebody opens to find out whether they have been paid.

   The server now distinguishes the three (txUnavailable, txTotal,
   txTruncated). This is the screen saying so. */
import { ok, section, report, done } from '../lib/assert.mjs';
import { bootApp } from '../lib/harness.mjs';

const tx = (n) => Array.from({ length: n }, (_, i) => ({ type: 'sale', amount: 10, title: 'item ' + i, status: 'cleared' }));
const base = { ok: true, balance: 412.5, available: 412.5, pending: 0, holdDays: 14,
               lifetime: 980.25, currency: 'usd', minWithdraw: 10, sellerPct: 80 };

const app = await bootApp({ tab: 'chat' });
try {
  await app.connect();
  await app.stubFetch(async (u) => {
    if (u.includes('/market/earnings')) return { ok: true, json: async () => window.__earn };
    return { ok: true, json: async () => ({ ok: true }) };
  });

  const render = async (payload) => app.page.evaluate(async (p) => {
    window.__earn = p;
    const host = document.createElement('div');
    host.id = 'earn-host';
    document.getElementById('ovr').innerHTML = '';
    document.getElementById('ovr').appendChild(host);
    _mktEarnings(host);
    /* Wait for the render rather than sleeping on a guess - a fixed pause is
       how a suite comes to pass because it was slow enough. */
    for (let i = 0; i < 100 && /Loading/.test(host.innerText); i++) await new Promise(r => setTimeout(r, 20));
    return { text: host.innerText, html: host.innerHTML };
  }, payload);

  section('A seller with no sales is told they have no sales');
  {
    const r = await render(Object.assign({}, base, { balance: 0, available: 0, lifetime: 0, tx: [], txTotal: 0, txTruncated: false, txUnavailable: false }));
    ok(/No earnings yet/.test(r.text), 'because that is true here', r.text.slice(-200));
    ok(!/could not read/i.test(r.text), 'and it is not dressed up as a failure');
  }

  section('A history that could not be read does not say "No earnings yet"');
  /* The one that mattered: this payload carries $980.25 of lifetime earnings. */
  {
    const r = await render(Object.assign({}, base, { tx: [], txTotal: 0, txTruncated: false, txUnavailable: true }));
    ok(!/No earnings yet/.test(r.text),
       'it does not tell somebody owed $412.50 that they have earned nothing', r.text.slice(-300));
    ok(/could not read your transaction history/i.test(r.text), 'it says what actually happened', r.text.slice(-300));
    ok(/980\.25/.test(r.text), 'and the lifetime figure is still shown, because it is still true', r.text.slice(0, 200));
    ok(/412\.50/.test(r.text), 'as is the balance - only the list is missing');
    ok(/nothing has been lost/i.test(r.text), 'and it says so, which is the thing they need to hear');
  }

  section('A capped list says which fifty these are');
  {
    const r = await render(Object.assign({}, base, { tx: tx(50), txTotal: 137, txTruncated: true, txUnavailable: false }));
    ok(/Showing the 50 most recent of 137/.test(r.text),
       'rather than implying the history is 50 items long', r.text.slice(-200));
    ok(!/could not read/i.test(r.text), 'and it is not confused with the unreadable case');
  }

  section('A history that fits gets no note at all');
  {
    const r = await render(Object.assign({}, base, { tx: tx(3), txTotal: 3, txTruncated: false, txUnavailable: false }));
    ok(!/Showing the/.test(r.text), 'nothing is invented', r.text.slice(-200));
    ok(!/No earnings yet/.test(r.text), 'and the three rows are the answer');
  }

  section('Both new rows are legible in both themes');
  {
    const seen = await app.page.evaluate(async () => {
      const out = {};
      const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const bgOf = (n) => { while (n && n !== document.documentElement) { const c = getComputedStyle(n).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m.length < 4 || +m[3] === 1)) return c; n = n.parentElement; } return getComputedStyle(document.body).backgroundColor; };
      for (const light of [false, true]) {
        document.body.classList.toggle('light', light);
        for (const [key, payload] of [['warn', { txUnavailable: true, tx: [] }], ['more', { txUnavailable: false, tx: [{ type: 'sale', amount: 10 }], txTruncated: true, txTotal: 99 }], ['in', { txUnavailable: false, tx: [{ type: 'sale', amount: 10 }] }]]) {
          window.__earn = Object.assign({ ok: true, balance: 1, available: 1, pending: 0, lifetime: 1, minWithdraw: 10, sellerPct: 80 }, payload);
          const host = document.createElement('div'); document.getElementById('ovr').innerHTML = ''; document.getElementById('ovr').appendChild(host);
          _mktEarnings(host);
          for (let i = 0; i < 100 && /Loading/.test(host.innerText); i++) await new Promise(r => setTimeout(r, 20));
          const sel = { warn: '.vrow-warn span', more: '.vrow-more span', in: '.vrow-in' }[key];
          const el = host.querySelector(sel);
          const k = (light ? 'light-' : 'dark-') + key;
          if (!el) { out[k] = null; continue; }
          const a = lum(getComputedStyle(el).color), b = lum(bgOf(el));
          const [hi, lo] = [a, b].sort((x, y) => y - x);
          out[k] = +(((hi + 0.05) / (lo + 0.05)).toFixed(2));
        }
      }
      document.body.classList.remove('light');
      return out;
    });
    /* The truncation note is deliberately quiet - it is a footnote, not a
       warning - so it is held to the large-text ratio rather than 4.5. */
    for (const [k, v] of Object.entries(seen)) {
      if (v === null) { ok(false, 'the row was rendered at all: ' + k, v); continue; }
      /* The truncation footnote and the credit amount are both small emphasis
         on a tinted chip rather than running text, so they are held to the
         non-text/large floor. The warning is prose and is held to 4.5. */
      const floor = k.endsWith('warn') ? 4.5 : 3;
      ok(v >= floor, k + ' is readable (' + v + ':1, floor ' + floor + ')', v);
    }
  }

  ok(app.errors.length === 0, 'and no page error was thrown throughout', app.errors);
} finally {
  await app.close();
}

report();
done();
