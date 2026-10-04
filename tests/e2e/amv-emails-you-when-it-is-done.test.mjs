/* AMV EMAILS YOU WHEN IT IS DONE - IF YOU SAID YES, AND ONLY WHEN IT HELPS.

   Asked for: "make the option like get notified when AMV is done, and if they
   say yes then AMV sends them an email when done".

   Asked once, while an answer is still running. A yes is checked with the
   server first, so nobody agrees to mail this AMV cannot send. After that it
   emails when long work finishes while the person is away - not when they
   watched it, not when they pressed Stop - and says a failure is a failure.
   Settings -> Account turns it either way. The email itself, and who it goes
   to, are the server's (tests/worker/done-mail-says-nothing-anyone-chose). */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'T', email: 't@x.com', ini: 'T' } });
const { page, errors } = app;
await page.evaluate(() => {
  document.getElementById('cookie-consent-banner')?.remove();
  localStorage.removeItem('amv_done_mail'); saveStr('amv_done_mail', '');
  Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true });
  Object.defineProperty(AMV_API, 'hasSession', { configurable: true, get: () => true });
  window.__ready = true; window.__calls = [];
  AMV_API.notifyDone = async (b) => { window.__calls.push(b); return { ok: true, emailReady: window.__ready, sent: !b.probe }; };
  /* Time and attention, controlled: how long the turn took, and whether the
     person was looking when it ended. */
  window.__shift = 0; const real = Date.now; Date.now = () => real() + window.__shift;
  window.__away = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__away });
  document.hasFocus = () => !window.__away;
});

const turn = (o) => page.evaluate(async (o) => {
  window.__calls = []; window.__shift = 0; window.__away = false;
  S.busy = true; _doneMailStart('chat');
  window.__shift = o.ms; window.__away = !!o.away; S.busy = false;
  _doneMailFinish({ stopped: !!o.stopped, failed: !!o.failed });
  return window.__calls.filter(c => !c.probe);
}, o);

section('It asks once, while a long answer is still running');
{
  /* A conversation on screen, so the message box is docked at the bottom -
     where a prompt pinned near the bottom used to cover it. */
  await page.evaluate(() => { const m = getMsgs(); for (let i = 0; i < 4; i++) { m.push({ r: 'u', c: 'Q' + i }); m.push({ r: 'a', c: 'A long answer. '.repeat(40) }); } setMsgs(m); renderChatMsgs(); });
  await page.evaluate(() => { S.busy = true; _doneMailStart('chat'); });
  const early = await page.evaluate(() => !!document.getElementById('done-ask'));
  ok(!early, 'not the moment something starts', early);
  await page.waitForSelector('#done-ask', { timeout: 16000 });
  const t = await page.evaluate(() => document.getElementById('done-ask').textContent);
  ok(/email when AMV is done/i.test(t) && /Email me/.test(t) && /Not now/.test(t), 'but once it has run a while: Email me, or Not now', t);
  const pos = await page.evaluate(() => {
    const a = document.getElementById('done-ask').getBoundingClientRect(), m = document.getElementById('mta').getBoundingClientRect();
    return { clear: a.bottom <= m.top || a.top >= m.bottom, a: Math.round(a.bottom), m: Math.round(m.top) };
  });
  ok(pos.clear, 'and it never covers the message box', pos);
}

section('Yes is checked with the server before it is promised');
{
  const r = await page.evaluate(async () => {
    window.__calls = [];
    document.getElementById('done-ask-yes').click();
    await new Promise(r => setTimeout(r, 150));
    S.busy = false; _doneMailFinish({});
    return { probe: window.__calls.some(c => c.probe), pref: loadStr('amv_done_mail'), gone: !document.getElementById('done-ask') };
  });
  ok(r.probe && r.pref === '1' && r.gone, 'asked the server, saved the yes, and closed', r);
}

section('It emails only when long work finished while you were away');
{
  const away = await turn({ ms: 25000, away: true });
  ok(away.length === 1 && away[0].ok === true, 'long, and you had gone: one email, saying it is done', away);
  const watched = await turn({ ms: 25000, away: false });
  ok(watched.length === 0, 'long, but you were watching: nothing', watched);
  const quick = await turn({ ms: 4000, away: true });
  ok(quick.length === 0, 'away, but it took four seconds: nothing', quick);
  const stopped = await turn({ ms: 25000, away: true, stopped: true });
  ok(stopped.length === 0, 'you pressed Stop: nothing', stopped);
  const failed = await turn({ ms: 25000, away: true, failed: true });
  ok(failed.length === 1 && failed[0].ok === false, 'it failed while you were away: an email that says so', failed);
}

section('A real chat turn is what starts and ends it');
{
  const r = await page.evaluate(async () => {
    window.__calls = []; window.__shift = 0; window.__away = false;
    const orig = window._callAITurn;
    window._callAITurn = async () => { window.__shift = 30000; window.__away = true; };
    try { await _callAI([], {}); } finally { window._callAITurn = orig; }
    return window.__calls.filter(c => !c.probe);
  });
  ok(r.length === 1, 'the chat send path ends in the same check', r);
}

section('A Build run is watched the same way');
{
  const r = await page.evaluate(async () => {
    window.__calls = []; window.__shift = 0; window.__away = false;
    const orig = window._aiAgentLoopRun;
    window._aiAgentLoopRun = async () => { window.__shift = 30000; window.__away = true; return { text: '' }; };
    try { await aiAgentLoop({ stopped: () => false }); } finally { window._aiAgentLoopRun = orig; }
    const ended = window.__calls.filter(c => !c.probe);
    window.__calls = [];
    window._aiAgentLoopRun = async () => { window.__shift = 30000; window.__away = true; return { text: '' }; };
    try { await aiAgentLoop({ stopped: () => true }); } finally { window._aiAgentLoopRun = orig; }
    return { ended, stopped: window.__calls.filter(c => !c.probe) };
  });
  ok(r.ended.length === 1 && r.ended[0].kind === 'build', 'a long run that ended while you were away emails you', r.ended);
  ok(r.stopped.length === 0, 'and one you stopped does not', r.stopped);
}

section('No is final until Settings says otherwise, and Settings works both ways');
{
  const r = await page.evaluate(async () => {
    saveStr('amv_done_mail', '0'); window.__calls = [];
    S.settingsPane = 'account'; setTab('settings'); await new Promise(r => setTimeout(r, 400));
    const box = document.getElementById('acct-done-mail');
    const out = { present: !!box, checked: box && box.checked };
    box.click(); await new Promise(r => setTimeout(r, 200));
    out.onPref = loadStr('amv_done_mail'); out.probed = window.__calls.some(c => c.probe);
    box.click(); await new Promise(r => setTimeout(r, 200));
    out.offPref = loadStr('amv_done_mail');
    window.__ready = false; box.click(); await new Promise(r => setTimeout(r, 200));
    out.refusedPref = loadStr('amv_done_mail'); out.refusedChecked = box.checked;
    out.say = (document.getElementById('acct-done-msg') || {}).textContent || '';
    window.__ready = true; closeSettings();
    return out;
  });
  ok(r.present && r.checked === false, 'Settings -> Account has the switch, off after a No', r);
  ok(r.onPref === '1' && r.probed && r.offPref === '0', 'on (after asking the server) and off again', r);
  ok(r.refusedPref === '0' && r.refusedChecked === false && /cannot send email/i.test(r.say), 'and where this AMV cannot send email, it stays off and says why', r);
  const asked = await page.evaluate(async () => { saveStr('amv_done_mail', '0'); S.busy = true; _doneMailStart('chat'); await new Promise(r => setTimeout(r, 13000)); const a = !!document.getElementById('done-ask'); S.busy = false; _doneMailFinish({}); return a; });
  ok(!asked, 'after a No it does not ask again', asked);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
if (report('amv-emails-you-when-it-is-done') > 0) process.exitCode = 1;
done();
