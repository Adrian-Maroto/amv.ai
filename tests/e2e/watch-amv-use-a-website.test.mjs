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

/* Each run's scripted answers, keyed by its goal, so a run still going in the
   background (the stopped one) cannot take another run's script. */
const scripts = new Map();
const outbound = makeOutbound();
outbound.on(/model\.example/, (_u, opts) => {
  const goal = (/USER GOAL: ([^\\\n"]+)/.exec(String(opts.body || '')) || [])[1] || '';
  const q = scripts.get(goal) || [];
  const d = q.length ? q.shift() : { verb: 'click', ref: 2, why: 'show more' };
  return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(d) }], stop_reason: 'end_turn',
    usage: { input_tokens: 3000, output_tokens: 60 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const B = { launched: 0, closed: 0, shots: 0, set: [], jar: [] };
const page = { u: 'about:blank',
  async setViewport(){}, async setRequestInterception(){}, on(){},
  async goto(u){ this.u = u; }, async url(){ return this.u; },
  async evaluate(x){ if (typeof x === 'string' && /getBoundingClientRect/.test(x)) return { url: this.u, title: 'Gym prices', text: 'Monthly prices.', captcha: false,
    elements: [{ ref: 1, tag: 'a', type: '', label: 'Prices' }, { ref: 2, tag: 'button', type: 'button', label: 'Show more' }] }; },
  async click(sel){ if (sel.includes('"1"')) B.jar = [{ name: 'sid', value: 'SESSION-SECRET-9c1d', domain: '.gyms.example.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: -1 }]; },
  async type(){}, async select(){}, keyboard: { async press(){} },
  async setCookie(...cs){ B.set.push(...cs); }, async cookies(){ return B.jar; },
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
  scripts.set('Find the cheapest gym price.', [{ verb: 'click', ref: 1, why: 'open prices' }, { verb: 'done', why: 'The cheapest is 29 a month.' }]);
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

section('Signed in once, still signed in next time - kept on this device, sealed');
{
  B.set = []; B.jar = [];
  scripts.set('Sign in and check my membership.', [{ verb: 'click', ref: 1, why: 'sign in' }, { verb: 'done', why: 'Signed in.' }]);
  const first = await P.evaluate(async () => {
    const d = await AMVConnectors.run('browser.do', { url: 'https://gyms.example.com/', goal: 'Sign in and check my membership.' });
    document.getElementById('wlv-stop').click();
    return { hasCookies: 'cookies' in d, said: JSON.stringify(d) };
  });
  ok(!first.hasCookies && !first.said.includes('SESSION-SECRET-9c1d'), 'the answer handed on carries no sign-in - nothing the chat or the model can see', first.said.slice(0, 120));
  const kept = await P.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('amv-webjar', 1); q.onsuccess = () => r(q.result); });
    const all = await new Promise(r => { const out = []; const c = db.transaction('kv').objectStore('kv').openCursor();
      c.onsuccess = () => { const cur = c.result; if (!cur) return r(out); out.push([cur.key, cur.value]); cur.continue(); }; });
    db.close();
    const raw = all.map(([k, v]) => k + ' ' + (v && v.ct ? new TextDecoder().decode(v.ct) : JSON.stringify(v))).join('\n');
    const key = all.find(([k]) => /^key:/.test(k));
    return { n: all.length, plain: raw.includes('SESSION-SECRET-9c1d'), jar: all.some(([k]) => /^jar:[0-9a-f]+:gyms\.example\.com$/.test(k)),
             extractable: key ? key[1].extractable : null, store: JSON.stringify(localStorage).includes('SESSION-SECRET') };
  });
  ok(kept.jar && !kept.plain && !kept.store, 'kept for gyms.example.com, sealed - the sign-in is nowhere on the device in readable form', kept);
  ok(kept.extractable === false, 'under a key that cannot be read out of this browser', kept.extractable);

  B.set = [];
  scripts.set('Check my membership.', [{ verb: 'done', why: 'Already signed in.' }]);
  await P.evaluate(async () => { await AMVConnectors.run('browser.do', { url: 'https://gyms.example.com/account', goal: 'Check my membership.' }); document.getElementById('wlv-stop').click(); });
  ok(B.set.some(c => c.name === 'sid' && c.value === 'SESSION-SECRET-9c1d'), 'the next run on that site is already signed in', B.set.map(c => c.name));

  B.set = [];
  scripts.set('Read the headlines.', [{ verb: 'done', why: 'Looked.' }]);
  await P.evaluate(async () => { await AMVConnectors.run('browser.do', { url: 'https://news.example.org/', goal: 'Read the headlines.' }); document.getElementById('wlv-stop').click(); });
  ok(B.set.length === 0, 'a run on another site carries none of it', B.set.map(c => c.domain));

  const other = await P.evaluate(async () => { const was = S.user.email; S.user.email = 'someone.else@example.com'; const j = await _webJarLoad('gyms.example.com'); S.user.email = was; return j.length; });
  ok(other === 0, 'and another account on the same device gets nothing', other);
}

section('Settings lists where AMV\u2019s browser is signed in, and Forget works');
{
  const listed = await P.evaluate(async () => {
    S.settingsPane = 'privacy'; setTab('settings');
    for (let i = 0; i < 40 && !document.querySelector('#wj-sites .wj-site'); i++) await new Promise(r => setTimeout(r, 100));
    return [...document.querySelectorAll('#wj-sites .wj-site')].map(x => x.textContent);
  });
  ok(listed.includes('gyms.example.com'), 'gyms.example.com is listed under Privacy', listed);
  await P.click('#wj-sites [data-wj-forget="gyms.example.com"]');
  await P.waitForTimeout(500);
  const after = await P.evaluate(async () => ({ shown: [...document.querySelectorAll('#wj-sites .wj-site')].map(x => x.textContent), jar: (await _webJarLoad('gyms.example.com')).length }));
  ok(after.jar === 0 && !after.shown.includes('gyms.example.com'), 'Forget removes it from the device and the list', after);
}

section('Erasing this device takes the browser sign-ins with it');
{
  B.set = []; B.jar = [];
  scripts.set('Sign in again.', [{ verb: 'click', ref: 1, why: 'sign in' }, { verb: 'done', why: 'Signed in.' }]);
  await P.evaluate(async () => { setTab('chat'); await AMVConnectors.run('browser.do', { url: 'https://gyms.example.com/', goal: 'Sign in again.' }); document.getElementById('wlv-stop').click(); });
  const before = await P.evaluate(async () => (await _webJarLoad('gyms.example.com')).length);
  await P.evaluate(() => eraseDeviceData());
  await P.waitForTimeout(500);
  const after = await P.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('amv-webjar', 1); q.onsuccess = () => r(q.result); });
    const keys = await new Promise(r => { const q = db.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => r(q.result); });
    db.close(); return keys;
  });
  ok(before > 0 && after.length === 0, 'kept before, and nothing of that account left after - not the key, not a record', { before, after });
}

ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 3));
await L.close();
if (report('watch-amv-use-a-website') > 0) process.exitCode = 1;
done();
