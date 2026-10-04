/* THE UPGRADE CARD IS RATIONED.

   Asked for: "add this from time to time" - a centred card offering the next
   plan by the engine it unlocks. "From time to time" is the part that keeps
   people: an upgrade prompt that is not rationed is the reason they leave.

   So: only on Free or Pro, only once somebody has had real answers, only
   right after one lands on the chat screen with nothing else open, at most
   once a week, a fortnight after "Not now", and never over their work. Its
   figures are the plans page's own, and its button is the plans page's
   checkout, monthly or yearly. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'T', email: 't@x.com', ini: 'T' } });
const { page, errors } = app;
await page.evaluate(() => {
  document.getElementById('cookie-consent-banner')?.remove();
  ['amv_upn_answers', 'amv_upn_shown', 'amv_upn_next', 'amv_upn_cycle'].forEach(k => saveStr(k, ''));
  _setPlan('free'); setTab('chat');
});
const shown = () => page.evaluate(() => !!document.getElementById('upn-bg'));
const answer = (n) => page.evaluate(async (n) => { for (let i = 0; i < n; i++) _upnAnswered(); await new Promise(r => setTimeout(r, 1700)); }, n);

section('Not before somebody has had real answers');
{
  await answer(5);
  ok(!(await shown()), 'five answers in: nothing', await shown());
  await answer(1);
  ok(await shown(), 'after the sixth: the card', await shown());
  const t = await page.evaluate(() => document.querySelector('.upn').textContent);
  ok(/Use AMV Forge with AMV Pro/.test(t), 'Free is offered Pro, by the engine it unlocks', t.slice(0, 60));
  ok(t.includes(Number(100000).toLocaleString()) && t.includes(Number(3000).toLocaleString()), 'with the plans page’s own figures', t);
  ok(!/Claude|Anthropic|Opus|Fable|Sonnet|Haiku/.test(t), 'and nothing but AMV names on it', t);
}

section('Its button is the plans page checkout, monthly or yearly');
{
  const r = await page.evaluate(async () => {
    const calls = []; const orig = window.openCheckout;
    window.openCheckout = (...a) => calls.push(a);
    const m = document.getElementById('upn-go').textContent;
    document.querySelector('[data-upn-cycle="year"]').click();
    const y = document.getElementById('upn-go').textContent;
    document.getElementById('upn-go').click();
    window.openCheckout = orig;
    document.querySelector('[data-upn-cycle]'); saveStr('amv_upn_cycle', '');
    closeOvr();
    return { m, y, calls };
  });
  ok(/Upgrade to Pro for \$15\/month/.test(r.m), 'monthly says the monthly price', r.m);
  ok(/billed yearly/.test(r.y) && !/\$/.test(r.y), 'yearly invents no figure', r.y);
  ok(r.calls.length === 1 && r.calls[0][0] === 'pro' && r.calls[0][2] === 'year', 'and opens checkout for Pro, yearly', r.calls);
}

section('Once a week at most, and a fortnight after Not now');
{
  await answer(3);
  ok(!(await shown()), 'the next answers do not bring it back', await shown());
  const r = await page.evaluate(async () => {
    saveStr('amv_upn_next', '0'); _upnAnswered(); await new Promise(r => setTimeout(r, 1700));
    const was = !!document.getElementById('upn-bg');
    document.getElementById('upn-later').click();
    return { was, days: Math.round((+loadStr('amv_upn_next') - Date.now()) / 864e5), open: !!document.getElementById('upn-bg') };
  });
  ok(r.was && !r.open && r.days === 14, 'Not now closes it and waits two weeks', r);
}

section('Never over their work, and never above its offer');
{
  const r = await page.evaluate(async () => {
    const out = {};
    const tryIt = async () => { saveStr('amv_upn_next', '0'); _upnAnswered(); await new Promise(r => setTimeout(r, 1700)); const s = !!document.getElementById('upn-bg'); closeOvr(); return s; };
    S.busy = true; out.busy = await tryIt(); S.busy = false;
    setTab('crew'); out.otherTab = await tryIt(); setTab('chat');
    S.settingsPane = 'account'; setTab('settings'); await new Promise(r => setTimeout(r, 200)); out.settings = await tryIt(); closeSettings();
    _setPlan('elite'); out.elite = await tryIt();
    _setPlan('pro'); saveStr('amv_upn_next', '0'); _upnAnswered(); await new Promise(r => setTimeout(r, 1700));
    out.proOffer = (document.querySelector('.upn-h') || {}).textContent || '';
    closeOvr(); _setPlan('free');
    return out;
  });
  ok(!r.busy && !r.otherTab && !r.settings, 'not while AMV is working, off the chat screen, or over Settings', r);
  ok(!r.elite, 'not on Elite - there is nothing to offer', r.elite);
  ok(/Use AMV Apex with AMV Elite/.test(r.proOffer), 'Pro is offered Elite, for Apex', r.proOffer);
}

section('It closes on X and on Esc, and stops after a few showings');
{
  const r = await page.evaluate(async () => {
    openUpgradeNudge(); document.getElementById('upn-x').click();
    const x = !!document.getElementById('upn-bg');
    openUpgradeNudge(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const esc = !!document.getElementById('upn-bg');
    saveStr('amv_upn_shown', '6'); saveStr('amv_upn_next', '0'); _upnAnswered(); await new Promise(r => setTimeout(r, 1700));
    return { x, esc, capped: !!document.getElementById('upn-bg') };
  });
  ok(!r.x && !r.esc, 'X and Esc both close it', r);
  ok(!r.capped, 'and after six showings it is not shown again', r);
}

section('A real chat answer is what counts');
{
  const r = await page.evaluate(async () => {
    saveStr('amv_upn_answers', '0'); saveStr('amv_upn_shown', '0'); saveStr('amv_upn_next', '0');
    const orig = window._callAITurn;
    window._callAITurn = async () => { const m = getMsgs(); m.push({ r: 'a', c: 'ok' }); setMsgs(m); };
    try { await _callAI([], {}); } finally { window._callAITurn = orig; }
    const n = +loadStr('amv_upn_answers');
    window._callAITurn = async () => { const m = getMsgs(); m.push({ r: 'a', c: '', _error: 'x' }); setMsgs(m); };
    try { await _callAI([], {}); } finally { window._callAITurn = orig; }
    return { afterGood: n, afterError: +loadStr('amv_upn_answers') };
  });
  ok(r.afterGood === 1 && r.afterError === 1, 'an answer counts; a failed one does not', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
if (report('the-upgrade-card-is-rationed') > 0) process.exitCode = 1;
done();
