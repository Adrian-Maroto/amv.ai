/* YOU ARE OUT OF USAGE ONLY WHEN THE SERVER SAYS SO - AND THE METER IS ITS METER.

   The page kept a token tally of its own (AMVUsage), against a cap it worked
   out for itself - a third of the daily allowance per five hours - and locked
   the composer when that tally ran out. For a signed-in account it never
   matched the server: the server's five-hour limit counts messages, its
   windows sit on another clock, and it is per account where the tally was per
   device. A Pro customer in a long chat, re-sending a large conversation each
   turn, was stopped by a number no server had set while most of their real
   allowance was untouched. The sidebar showed the same invented percentage.

   Driven through the real page, the real API client and the real Worker:

   - a device tally far past its own cap does not stop a signed-in account;
   - the sidebar shows the server's meter - the one nearest to refusing - with
     when it comes back;
   - when the server does refuse, the chat stops, with the server's reset time;
   - a deployment with no server keeps the local guard, because it is the
     only one there is. */
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
outbound.on(/model\.example/, () => { asked++; return new Response(reply('Answered.'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }); });
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9244', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
  AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = o => new Response(JSON.stringify(o));
    { const so = sessionOp(vals, n, b); if (so) return r(so); }
    if (b.op === 'reserve') {
      if (b.cap != null && cur + b.amount > b.cap) return r({ allowed: false, value: cur });
      vals.set(n, cur + b.amount); return r({ allowed: true, value: vals.get(n) });
    }
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'release') { vals.set(n, Math.max(0, cur - (b.amount || 0))); return r({ value: vals.get(n) }); }
    return r({ allowed: true, value: cur });
  } }) },
});
const L = await bootLive({ env, outbound, port: 9244 });
const { page } = L;
const EMAIL = 'meter@example.com';

async function say(t) {
  await page.evaluate(async (t) => {
    setTab('chat'); await new Promise(x => setTimeout(x, 200));
    const box = document.getElementById('mta'); box.value = t;
    box.dispatchEvent(new Event('input', { bubbles: true })); sendMsg();
  }, t);
  await page.waitForFunction(() => S.busy === true, null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => S.busy === false, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500); await L.settle();
}
const quotaCard = () => page.evaluate(() => getMsgs().some(m => m._quota));

section('Signed in on Pro');
{
  await page.evaluate(async (em) => {
    openAuth('signup'); await __amvAuthOpen();
    const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Meter'); type('#a-email', em); type('#a-pass', 'A-real-Passw0rd!');
    document.getElementById('auth-submit').click(); await __amvSignedIn();
  }, EMAIL);
  await env.AMV_KV.put('ent:' + EMAIL, JSON.stringify({ plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  await page.evaluate(async () => { try { await syncEntitlement(); } catch (e) {} });
  ok(await page.evaluate(() => _usageServerOwned()), 'the page knows the server counts this account');
}

section('A device tally far past its own cap does not stop a signed-in account');
{
  /* What a long chat did to the tally: many times the cap the page made up. */
  await page.evaluate(() => { const s = AMVUsage.status(); AMVUsage.record(s.cap * 3); AEGIS._saveUsage(Object.assign(AEGIS.usage(), { inTok: 10e9 })); });
  ok(await page.evaluate(() => AMVUsage.status().remaining === 0), 'the device tally says it is out', true);
  const before = asked;
  await say('still there?');
  ok(asked === before + 1, 'the message went to the engine anyway, because the server had not refused it', asked - before);
  ok(!(await quotaCard()) && !(await page.evaluate(() => quotaLocked())), 'and nothing on the page claims the allowance ran out', true);
  ok(await page.evaluate(() => _budgetGuard(6000).ok), 'a multi-step run is not stopped by the tally either', true);
}

section('The sidebar is the server’s meter: the one nearest to refusing, with when it comes back');
{
  /* Nine tenths of today's tokens spent, on the server's own counter. */
  const day = new Date().toISOString().slice(0, 10);
  const dayKey = [...vals.keys()].find(k => k.startsWith('usg:' + EMAIL + ':' + day)) || ('usg:' + EMAIL + ':' + day);
  const limit = await page.evaluate(async () => (await _srvUsageRefresh(true)).day.limit);
  vals.set(dayKey, Math.round(limit * 0.9));
  await page.evaluate(async () => { await _srvUsageRefresh(true); _renderSbUsage(); });
  const sb = await page.evaluate(() => { const el = document.getElementById('sb-usage'); return el ? { shown: el.style.display !== 'none', text: el.innerText } : null; });
  const want = await page.evaluate(() => { const d = _srvUsage; return Math.min(100, Math.round(d.day.used / d.day.limit * 100)); });
  ok(sb && sb.shown && /Today/.test(sb.text) && want === 90 && sb.text.includes(want + '%'), 'it shows Today at the server’s figure', sb && sb.text);
  ok(sb && /Resets in \d+ (hour|minute)/.test(sb.text), 'and when today comes back', sb && sb.text);
  ok(sb && /Upgrade for more/.test(sb.text), 'near the limit, it offers more', sb && sb.text);
}

section('When the server refuses, the chat stops with the server’s reset time');
{
  const day = new Date().toISOString().slice(0, 10);
  const dayKey = [...vals.keys()].find(k => k.startsWith('usg:' + EMAIL + ':' + day));
  vals.set(dayKey, 10e9);
  const before = asked;
  await say('one more');
  ok(asked === before, 'the engine was not asked', asked - before);
  const card = await page.evaluate(() => { const m = getMsgs().find(x => x._quota); return m ? m._resetAt : 0; });
  const midnight = (() => { const n = new Date(); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1); })();
  ok(card === midnight, 'the out-of-usage card counts down to the server’s own reset, the next UTC midnight', [card, midnight]);
}

section('The usage screen shows every meter and when each comes back');
{
  await page.evaluate(() => { S.settingsPane = 'billing'; setTab('settings'); });
  await page.evaluate(() => { const h = document.createElement('div'); h.id = 'srv-usage'; document.body.appendChild(h); _paintServerUsage(); });
  await page.waitForFunction(() => /This month/.test((document.getElementById('srv-usage') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  const t = await page.evaluate(() => document.getElementById('srv-usage').innerText);
  ok(/This month/.test(t) && /5-hour window/.test(t) && /Today/.test(t) && /Top engine this week/.test(t), 'the month, the five-hour window, today and the top engine', t.slice(0, 300));
  ok((t.match(/Resets/g) || []).length >= 4, 'each with when it comes back', (t.match(/Resets[^\n]*/g) || []).join(' | '));
  ok(!/rolling/i.test(t), 'and nothing calls a fixed window rolling', true);
}

section('Signed out on a deployment with no server, the device guard is still the guard');
{
  const local = await page.evaluate(() => {
    /* No server: the address the page would reach is empty. */
    Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => false });
    try { return { owned: _usageServerOwned(), guard: _budgetGuard(6000).ok }; }
    finally { delete AMV_API.live; }
  });
  ok(local.owned === false && local.guard === false, 'with nothing else to count, the device tally still stops a run', local);
}

ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 3));
await L.close();
if (report('you-are-out-only-when-the-server-says-so') > 0) process.exitCode = 1;
done();
