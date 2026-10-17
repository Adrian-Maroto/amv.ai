/* WATCH AMV USE A WEBSITE - EVERY STEP, WITH A PICTURE - AND STOP IT.

   The web agent runs in a hosted browser on AMV's servers. Asked for in live
   mode it streams each step; the page shows them in a panel (web-live.js) with
   the latest picture of the page and a Stop button. Driven in a real browser,
   through the real connector and the real Worker; the hosted browser is a
   stand-in (an object with `launch`, see _webLaunch) and so is the model.

   The test backend hands the page each response whole, so the steps arrive
   together here; the server half, where the stream really is a stream and a
   run nobody watches ends, is a-web-run-is-watched-and-paid-for. What this
   adds is what the person sees, and what pressing Stop does on their side. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

let decisions = [];
const outbound = makeOutbound();
outbound.on(/model\.example/, () => {
  const d = decisions.length ? decisions.shift() : { verb: 'click', ref: 2, why: 'show more' };
  return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(d) }], stop_reason: 'end_turn',
    usage: { input_tokens: 3000, output_tokens: 60 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const B = { launched: 0, closed: 0, shots: 0 };
const page = { u: 'about:blank',
  async setViewport(){}, async setRequestInterception(){}, on(){},
  async goto(u){ this.u = u; }, async url(){ return this.u; },
  async evaluate(x){ if (typeof x === 'string' && /getBoundingClientRect/.test(x)) return { url: this.u, title: 'Gym prices', text: 'Monthly prices.', captcha: false,
    elements: [{ ref: 1, tag: 'a', type: '', label: 'Prices' }, { ref: 2, tag: 'button', type: 'button', label: 'Show more' }] }; },
  async click(){}, async type(){}, async select(){}, keyboard: { async press(){} },
  /* A real (1x1) JPEG, so the picture in the panel actually decodes. */
  async screenshot(){ B.shots++; return '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='; } };

const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9187', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
  BROWSER: { async launch(){ B.launched++; return { async newPage(){ return page; }, async close(){ B.closed++; } }; } },
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body);
      const cur = vals.get(n) || 0;
      if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) })); }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      return new Response(JSON.stringify({ allowed: true, ok: true, value: cur }));
    } }),
  },
});
const L = await bootLive({ env, outbound, port: 9187 });
const P = L.page;
const EMAIL = 'watcher@example.com';

await P.evaluate(async ([em, pw]) => {
  openAuth('signup'); await __amvAuthOpen();
  const type = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  type('#a-name', 'Watch Er'); type('#a-email', em); type('#a-pass', pw);
  document.getElementById('auth-submit').click(); await __amvSignedIn();
}, [EMAIL, 'A-real-Passw0rd!']);
await env.AMV_KV.put('ent:' + EMAIL, JSON.stringify({ plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));

section('A run is shown step by step, with the page, and ends with the answer');
{
  decisions = [{ verb: 'click', ref: 1, why: 'open prices' }, { verb: 'done', why: 'The cheapest is 29 a month.' }];
  const r = await P.evaluate(async () => {
    try { const d = await AMVConnectors.run('browser.do', { url: 'https://gyms.example.com/', goal: 'Find the cheapest gym price.' }); return { ok: true, d }; }
    catch (e) { return { ok: false, msg: e.message, code: e.code }; }
  });
  ok(r.ok && /29 a month/.test(r.d.result), 'the connector returns the answer', r);
  const panel = await P.evaluate(() => {
    const el = document.getElementById('wlv'); if (!el) return null;
    const img = el.querySelector('#wlv-img');
    return { label: el.getAttribute('aria-label'), host: el.querySelector('#wlv-host').textContent, now: el.querySelector('#wlv-now').textContent,
             img: img && !img.hidden && /^blob:/.test(img.src), alt: img && img.alt, live: el.querySelector('#wlv-now').getAttribute('aria-live'),
             done: el.classList.contains('done'), btn: el.querySelector('#wlv-stop').textContent };
  });
  ok(panel && panel.label === 'AMV’s browser' && panel.host === 'gyms.example.com', 'a panel says which site AMV is on', panel);
  ok(panel && panel.img && /Clicked/.test(panel.alt), 'with a picture of the page after the last step, described for screen readers', panel && panel.alt);
  ok(panel && /29 a month/.test(panel.now) && panel.live === 'polite' && panel.done && panel.btn === 'Close', 'ending on the answer, announced, with Close', panel);
  ok(L.hit(/\/v1\/browser\/run/).length === 1 && B.closed >= 1, 'one run, on the server, and the browser was closed', { runs: L.hit(/\/v1\/browser\/run/).length, closed: B.closed });
  const leaked = await P.evaluate(() => JSON.stringify(localStorage).includes('/9j/') || JSON.stringify(getMsgs()).includes('/9j/'));
  ok(!leaked, 'the pictures are in the panel only - not saved, not in the chat', leaked);
  await P.click('#wlv-stop');
  ok(await P.evaluate(() => !document.getElementById('wlv')), 'Close removes it');
}

section('Stop, pressed before anything arrives, ends it in plain words');
{
  decisions = [];
  const r = await P.evaluate(async () => {
    const p = AMVConnectors.run('browser.do', { url: 'https://gyms.example.com/', goal: 'Keep looking.' });
    await new Promise(res => { const t = setInterval(() => { if (document.getElementById('wlv-stop')) { clearInterval(t); res(); } }, 20); });
    document.getElementById('wlv-stop').click();
    try { await p; return { threw: false }; } catch (e) { return { threw: true, msg: e.message, code: e.code }; }
  });
  ok(r.threw && r.code === 'stopped' && /Stopped\. Nothing more was done on the page\./.test(r.msg), 'it says it stopped and that nothing more was done - not a raw error', r);
  const shown = await P.evaluate(() => (document.getElementById('wlv-now') || {}).textContent || '');
  ok(/Nothing more was done/.test(shown), 'and the panel says so too', shown);
}

ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 3));
await L.close();
if (report('watch-amv-use-a-website') > 0) process.exitCode = 1;
done();
