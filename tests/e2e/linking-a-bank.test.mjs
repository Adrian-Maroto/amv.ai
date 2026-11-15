/* LINKING A BANK, ON SCREEN.

   This was the investing check-in. The owner removed investing (Nov 15) and
   kept linking a bank - what a Crew job or chat that reads a bank needs - so
   the dialog (openBankLink) is the link and nothing else. What this holds is
   unchanged: it cannot lie about somebody's money. Each "not yet" says which
   one it is, the sign-in happens at the bank, coming back is confirmed by the
   server, and a disconnect that failed never says it disconnected. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'U', email: 'u@x.com', ini: 'U' } });
const { page, errors } = app;

/* The pane is fetched the first time it is opened (invest.js). */
const open = () => page.evaluate(async () => {
  openBankLink();
  for (let i = 0; i < 100 && typeof window._renderInvestPaneNow !== 'function'; i++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 180));
  return document.getElementById('bank-pane').textContent;
});
const redraw = () => page.evaluate(async () => {
  if (!document.getElementById('bank-pane')) openBankLink();
  _renderInvestPane(document.getElementById('bank-pane'));
  await new Promise(r => setTimeout(r, 120));
  return document.getElementById('bank-pane').textContent;
});

section('It says which kind of "not yet" you are in');
{
  const t = await open();
  ok(/Not connected yet/.test(t), 'with no backend it names the backend', /Not connected/.test(t));
  const btn = await page.evaluate(() => !!document.getElementById('inv-link'));
  ok(!btn, 'and does not offer a link button that could not work', btn);
  const linked = await page.evaluate(async () => {
    saveStr('amv_api_base', 'https://x.test');
    _renderInvestPane(document.getElementById('bank-pane'));
    await new Promise(r => setTimeout(r, 120));
    return { t: document.getElementById('bank-pane').textContent, btn: !!document.getElementById('inv-link') };
  });
  ok(linked.btn && /Link a bank/.test(linked.t), 'with a backend it offers to link one', linked.t.slice(0, 120));
  ok(/never sees your username or password/i.test(linked.t),
     'saying where the sign-in actually happens, which is the thing people worry about');
}

section('What it is, before what it shows');
{
  const t = await redraw();
  ok(/can never move money/i.test(t), 'it states it cannot move money', t.slice(0, 160));
  ok(/read-only/i.test(t), 'and that what it holds is read-only', '');
  ok(!/invest/i.test(t), 'and nothing on it is about investing any more', (t.match(/.{0,30}invest.{0,30}/i) || [''])[0]);
}

section('Linking sends you to the institution, not to a form in our page');
{
  /* The sign-in happens on the provider's own page. That is what keeps the
     strict CSP intact and what makes "AMV never sees your username or
     password" true rather than a claim. */
  const r = await page.evaluate(async () => {
    saveStr('amv_api_base', 'https://x.test'); saveStr('amv_api_token', 't');
    saveStr('amv_fin_linked', '');
    const calls = []; let opened = '';
    window.fetchDeadline = async (url, init) => {
      calls.push(String(url));
      if (/link\/start/.test(url)) return { ok: true, json: async () => ({ ok: true, url: 'https://provider/hl/x' }) };
      return { ok: true, json: async () => ({ ok: true, ready: true, linked: false }) };
    };
    window.open = (u) => { opened = u; return null; };
    _renderInvestPane(document.getElementById('bank-pane'));
    await new Promise(r => setTimeout(r, 150));
    document.getElementById('inv-link').click();
    await new Promise(r => setTimeout(r, 250));
    return { calls, opened, said: document.getElementById('inv-link-say').textContent,
             done: !!document.getElementById('inv-link-done') };
  });
  ok(r.calls.some(u => /\/v1\/finance\/link\/start/.test(u)), 'the server is asked to start a link', r.calls);
  ok(r.opened === 'https://provider/hl/x', 'and the provider\'s page is opened', r.opened);
  ok(r.done, 'with a way to say you have finished', r.done);
  ok(!/linked/i.test(r.said) || /Continue/.test(r.said),
     'while nothing yet claims an account is connected', r.said);
}

section('Coming back is confirmed by the server, never assumed');
{
  /* The browser cannot know whether a session completed, and must not guess:
     this flag decides whether AMV starts reading somebody's accounts. */
  const r = await page.evaluate(async () => {
    window.fetchDeadline = async (url) => {
      if (/link\/finish/.test(url)) return { ok: false, json: async () => ({ ok: false, code: 'not_finished', error: 'x' }) };
      return { ok: true, json: async () => ({ ok: true, ready: true, linked: false }) };
    };
    document.getElementById('inv-link-done').click();
    await new Promise(r => setTimeout(r, 250));
    return { said: document.getElementById('inv-link-say').textContent, flag: loadStr('amv_fin_linked') };
  });
  ok(/not completed/.test(r.said), 'an abandoned link says exactly that', r.said);
  ok(!/^1$/.test(r.flag || ''), 'and nothing is marked as linked', r.flag);
}

section('A completed link is what turns the screen on');
{
  const r = await page.evaluate(async () => {
    window.fetchDeadline = async (url) => {
      if (/link\/finish/.test(url)) return { ok: true, json: async () => ({ ok: true, linked: true }) };
      return { ok: true, json: async () => ({ ok: true, ready: true, linked: true }) };
    };
    document.getElementById('inv-link-done').click();
    await new Promise(r => setTimeout(r, 300));
    return { flag: loadStr('amv_fin_linked'), text: document.getElementById('bank-pane').textContent,
             unlink: !!document.getElementById('inv-unlink') };
  });
  ok(r.flag === '1', 'the bank is recorded as linked', r.flag);
  ok(/Your bank is linked/.test(r.text) && r.unlink, 'and the dialog says so, with Disconnect beside it', r);
}

section('Disconnecting is as easy as connecting was');
{
  const r = await page.evaluate(async () => {
    const calls = [];
    window.__answerConfirm(true);
    window.fetchDeadline = async (url) => {
      calls.push(String(url));
      if (/unlink/.test(url)) return { ok: true, json: async () => ({ ok: true, unlinked: true }) };
      return { ok: true, json: async () => ({ ok: true, ready: true, linked: false }) };
    };
    document.getElementById('inv-unlink').click();
    await new Promise(r => setTimeout(r, 300));
    return { calls, flag: loadStr('amv_fin_linked'), link: !!document.getElementById('inv-link') };
  });
  ok(r.calls.some(u => /\/v1\/finance\/unlink/.test(u)), 'the server is told to disconnect', r.calls);
  ok(r.flag !== '1', 'the account is no longer treated as linked', r.flag);
  ok(r.link, 'and the pane offers to link one again', r.link);
}

section('A failed disconnect does not say it disconnected');
{
  const r = await page.evaluate(async () => {
    saveStr('amv_fin_linked', '1');
    /* Re-armed rather than relying on the observer installed further up: it
       does still answer this one, and a test that passes because of a leftover
       from an earlier section is a test that breaks when somebody reorders them. */
    window.__answerConfirm(true);
    window.fetchDeadline = async (url) => {
      if (/unlink/.test(url)) return { ok: false, json: async () => ({ error: 'engine down' }) };
      return { ok: true, json: async () => ({ ok: true, ready: true, linked: true }) };
    };
    _renderInvestPane(document.getElementById('bank-pane'));
    await new Promise(r => setTimeout(r, 200));
    document.getElementById('inv-unlink').click();
    await new Promise(r => setTimeout(r, 300));
    return { said: document.getElementById('inv-say').textContent, flag: loadStr('amv_fin_linked') };
  });
  ok(/still connected/.test(r.said), 'it says the account is still connected', r.said);
  ok(r.flag === '1', 'and the screen keeps showing what is actually true', r.flag);
}

section('Not switched on is said as itself, not as a failure');
{
  const r = await page.evaluate(async () => {
    saveStr('amv_fin_linked', '');
    window.fetchDeadline = async (url) => {
      if (/link\/start/.test(url)) return { ok: false, json: async () => ({ code: 'needs_service', error: 'not on' }) };
      return { ok: true, json: async () => ({ ok: true, ready: false, linked: false }) };
    };
    _renderInvestPane(document.getElementById('bank-pane'));
    await new Promise(r => setTimeout(r, 200));
    document.getElementById('inv-link').click();
    await new Promise(r => setTimeout(r, 250));
    return document.getElementById('inv-link-say').textContent;
  });
  ok(/not switched on/.test(r), 'the operator not having configured it is its own message', r);
  ok(/nothing was started/i.test(r), 'and nothing is claimed to have happened', r);
}

section('It fits on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await redraw();
  const bad = await overflowingElement(page);
  ok(!bad, 'nothing pushes the page sideways at 390px', bad);
  await page.setViewportSize({ width: 1280, height: 900 });
}

ok(errors.length === 0, 'no console errors along the way', errors.slice(0, 3));

await app.close();
if (report('linking-a-bank') > 0) process.exitCode = 1;
done();
