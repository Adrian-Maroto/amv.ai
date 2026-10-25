/* EXTRA USAGE ASKS BEFORE IT IS SPENT - WHEN THAT IS WHAT THE PERSON CHOSE.

   Driven through the real page, the real API client and the real Worker, with
   $25 of extra usage on a Pro account whose five-hour window is full:
     on "Ask me first", the next message brings up a question with the balance
     on it; "Use it" sends that same message on credit and it is answered;
     the message after does not ask again - the yes holds until the limit
     comes back;
     on "Never use it", the out-of-usage card says the credit is there and
     set never to be used;
     and the choice is made in the Extra usage panel, which shows what the
     server saved. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { sessionOp } from '../lib/session-op.mjs';

const ev = (t, d) => 'event: ' + t + '\ndata: ' + JSON.stringify(d) + '\n\n';
const reply = (t) => ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } })
  + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })
  + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
  + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } })
  + ev('message_stop', { type: 'message_stop' });

let asked = 0;
const outbound = makeOutbound();
outbound.on(/model\.example/, () => { asked++; return new Response(reply('Answered on credit.'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }); });
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9248', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
  STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x',
  AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = o => new Response(JSON.stringify(o));
    { const so = sessionOp(vals, n, b); if (so) return r(so); }
    if (b.op === 'reserve') {
      if (b.cap != null && cur + b.amount > b.cap) return r({ allowed: false, value: cur });
      vals.set(n, cur + b.amount); return r({ allowed: true, value: vals.get(n) });
    }
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur });
  } }) },
});
const L = await bootLive({ env, outbound, port: 9248 });
const { page } = L;
const EMAIL = 'credit@example.com';
const spent = () => vals.get('creditspent:' + EMAIL) || 0;

async function say(t) {
  await page.waitForFunction(() => S.busy === false, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.evaluate((t) => {
    setTab('chat'); const box = document.getElementById('mta'); box.value = t;
    box.dispatchEvent(new Event('input', { bubbles: true })); sendMsg();
  }, t);
}
const settle = async () => {
  await page.waitForFunction(() => S.busy === false, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(400); await L.settle();
};
const setMode = (m) => page.evaluate(async (m) => (await (await AMV_API._fetch('/v1/credit/mode', { method: 'POST', body: JSON.stringify({ mode: m }) })).json()).mode, m);

section('A Pro account with $25 of extra usage and a full five-hour window');
{
  await page.evaluate(async (em) => {
    openAuth('signup'); await __amvAuthOpen();
    const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Credit'); type('#a-email', em); type('#a-pass', 'A-real-Passw0rd!');
    document.getElementById('auth-submit').click(); await __amvSignedIn();
  }, EMAIL);
  await env.AMV_KV.put('ent:' + EMAIL, JSON.stringify({ plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  await page.evaluate(async () => { try { await syncEntitlement(); } catch (e) {} });
  vals.set('creditbuy:' + EMAIL, 25);
  await say('first'); await settle();
  for (const k of [...vals.keys()]) if (k.startsWith('msgs5h:')) vals.set(k, 1e9);
  ok(await setMode('ask') === 'ask', 'set to ask first');
}

section('Ask first: a question with the balance, and "Use it" answers the same message');
{
  const before = asked, b0 = spent();
  await say('past the plan');
  const shown = await page.waitForSelector('#modal-ok', { timeout: 10000 }).then(() => true).catch(() => false);
  const text = shown ? await page.evaluate(() => (document.getElementById('modal-box') || {}).textContent || '') : '';
  ok(shown && /\$25\.00 of extra usage/.test(text) && /Use extra usage\?/.test(text), 'it asks, saying how much there is', text.slice(0, 200));
  ok(asked === before && spent() === b0, 'and nothing has been sent or spent while it asks', { asked: asked - before, spent: spent() - b0 });
  const okText = await page.evaluate(() => document.getElementById('modal-ok').textContent);
  ok(okText === 'Use it', 'the button says what it does', okText);
  await page.click('#modal-ok');
  await settle();
  const last = await page.evaluate(() => { const m = getMsgs(); return m[m.length - 1]; });
  ok(asked === before + 1 && spent() > b0, 'the message went, on credit', { asked: asked - before, spent: spent() - b0 });
  ok(last && /Answered on credit/.test(last.c || '') && !last._quota, 'and its answer is on screen, not an out-of-usage card', last && (last.c || '').slice(0, 60));
}

section('The yes holds: the next message does not ask again');
{
  const before = asked, b0 = spent();
  await say('and another');
  const shown = await page.waitForSelector('#modal-ok', { timeout: 2500 }).then(() => true).catch(() => false);
  await settle();
  ok(!shown && asked === before + 1 && spent() > b0, 'answered on credit with no second question', { shown, asked: asked - before });
}

section('Saying "Not now" sends nothing');
{
  await page.evaluate(() => { _creditConsent = null; });
  const before = asked, b0 = spent();
  await say('not this one');
  await page.waitForSelector('#modal-cancel', { timeout: 10000 }).catch(() => {});
  await page.click('#modal-cancel').catch(() => {});
  await settle();
  const last = await page.evaluate(() => { const m = getMsgs(); return m[m.length - 1]; });
  ok(asked === before && spent() === b0 && last && last._quota, 'nothing sent, nothing spent, and the out-of-usage card instead', { asked: asked - before, quota: last && last._quota });
  const btn = await page.evaluate(() => { const b = [...document.querySelectorAll('[data-action="credit-use"]')].pop(); return b ? b.textContent : ''; });
  ok(btn === 'Use extra usage', 'the card offers the credit that is waiting, not another purchase', btn);
  /* A person reads the card first; the page also refuses more than four
     requests in ten seconds (burstMax), and this run has sent several. */
  await page.waitForTimeout(10500);
  await page.click('[data-action="credit-use"]');
  await settle();
  const after = await page.evaluate(() => { const m = getMsgs(); return m[m.length - 1]; });
  ok(asked === before + 1 && spent() > b0 && after && /Answered on credit/.test(after.c || ''), 'changing their mind sends the same message on credit', { asked: asked - before });
}

section('Never use it: the card says the credit is there and set aside');
{
  ok(await setMode('stop') === 'stop', 'set to never');
  await page.evaluate(() => { _creditConsent = null; try { quotaUnlock(); } catch (e) {} });
  const before = asked;
  await say('one more');
  await settle();
  const card = await page.evaluate(() => { const c = [...document.querySelectorAll('.quota-card')].pop(); return c ? c.textContent : ''; });
  ok(asked === before && /set never to be used/.test(card) && /Plan & billing/.test(card), 'refused, and the card says why and where to change it', card.slice(0, 240));
}

section('The choice is made in the Extra usage panel, and shows what was saved');
{
  await page.evaluate(() => _creditOpen());
  await page.waitForSelector('input[name="cr-mode"]', { timeout: 15000 }).catch(() => {});
  const checked = await page.evaluate(() => (document.querySelector('input[name="cr-mode"]:checked') || {}).value);
  ok(checked === 'stop', 'it opens on the saved choice', checked);
  await page.click('input[name="cr-mode"][value="auto"]');
  await page.waitForFunction(() => /Saved/.test((document.getElementById('cr-mode-msg') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  const srv = await page.evaluate(async () => (await (await AMV_API._fetch('/v1/credit', { method: 'GET' })).json()).mode);
  ok(srv === 'auto', 'choosing another saves it on the server', srv);
  const opts = await page.evaluate(() => [...document.querySelectorAll('.cr-mode-opt')].map(l => Math.round(l.getBoundingClientRect().height)));
  ok(opts.length === 3 && opts.every(h => h >= 44), 'three choices, each a row big enough to hit', opts);
}

ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 3));
await L.close();
if (report('extra-usage-asks-before-it-is-spent') > 0) process.exitCode = 1;
done();
