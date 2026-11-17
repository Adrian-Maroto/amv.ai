/* A SYNC DOES NOT REBUILD THE SCREEN UNDER YOU (Nov 17).

   A pull from the account ended by repainting whatever screen was open, from
   scratch, every time - and a pull follows most pushes. So any save anywhere
   rebuilt Build, Crew or Spending under the person using it: a flash (the
   owner: "it auto opened Build an app for a second"), a lost scroll position,
   a prompt half typed into Build gone. Now:
     · a pull that brings nothing new leaves the screen exactly as it was -
       the same elements, not rebuilt;
     · one that brings something new does not touch a screen somebody is
       typing on;
     · in chat, new messages appear and the box keeps what is in it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;
/* The server's answer, as the pull will receive it: what is here already, or
   that plus one more. */
const arm = (extra) => page.evaluate((extra) => {
  AMVSync.enabled = () => true;
  const cur = { convs: JSON.parse(JSON.stringify(S.convs)), sessions: JSON.parse(JSON.stringify(_SESSIONS)) };
  if (extra === 'session') cur.sessions.push({ id: 'sess_remote', kind: 'dev', title: 'From the other computer', updated: Date.now(), state: { log: [{ role: 'user', r: 'u', c: 'x' }] } });
  if (extra === 'message') { const c = cur.convs.find(x => x.id === S.cur); c.msgs = (c.msgs || []).concat([{ r: 'u', c: 'Sent from my phone' }, { r: 'a', c: 'An answer that arrived by sync' }]); c.updated = Date.now(); }
  AMV_API.syncPull = async () => cur;
}, extra);

section('Nothing new: the screen is left exactly as it was');
for (const tab of ['build', 'crew', 'spend']) {
  await page.evaluate((t) => setTab(t), tab);
  ok(await page.evaluate((t) => S.tab === t, tab), tab + ' is the screen open', tab);
  await page.waitForTimeout(1200);
  await arm('');
  const r = await page.evaluate(async () => { const vc = document.getElementById('vc'); const first = vc.firstElementChild; first.dataset.__mark = '1';
    await AMVSync.pull(); return { same: vc.firstElementChild === first && first.dataset.__mark === '1' }; });
  ok(r.same, tab + ': not rebuilt', r);
}

section('Something new while typing in Build: the prompt survives');
{
  await page.evaluate(() => setTab('build'));
  await page.waitForTimeout(800);
  const box = await page.$('#dev-msg, #studio-in, .bld-input textarea, #vc textarea');
  await box.click(); await box.type('A landing page for my bakery');
  await arm('session');
  const r = await page.evaluate(async () => { await AMVSync.pull(); const t = document.activeElement; return { val: t && t.value, has: _SESSIONS.some(s => s.id === 'sess_remote') }; });
  ok(r.val === 'A landing page for my bakery', 'what was being typed is still there, with the cursor', r.val);
  ok(r.has, 'and the session from the other computer arrived', r.has);
}

section('In chat, a new message appears and the box keeps its text');
{
  await page.evaluate(() => { setTab('chat'); });
  await page.waitForTimeout(400);
  await page.fill('#mta', 'half a thought');
  await arm('message');
  const r = await page.evaluate(async () => { await AMVSync.pull(); return { box: document.getElementById('mta').value, shown: /arrived by sync/.test(document.getElementById('cm').textContent) }; });
  ok(r.shown, 'the message from the other device is on screen', r);
  ok(r.box === 'half a thought', 'and the box still holds what was typed', r.box);
}

section('Spending: the account\'s numbers arriving, the same as here, rebuild nothing');
{
  /* Opening Spending asked the account for the limits and, when they came,
     rebuilt the whole screen - a jump a moment after it appeared (the owner:
     "spending has lag"). Same numbers: nothing redrawn. */
  const r = await page.evaluate(async () => {
    /* An adult who has accepted the terms - the pane asks the account only
       for somebody who may use money features. */
    try { store('amv_consent', {}); AMVCompliance.accept(); AMVCompliance.setBirthYear(new Date().getFullYear() - 30); } catch (e) {}
    try{ _SPEND_PULLED = false; _SPEND_BUSY = false; }catch(e){}
    const realSB = AMVSpend.serverBacked, realPull = AMVSpend.pull;
    let pulls = 0;
    AMVSpend.serverBacked = () => true;
    /* The account answers a moment after the screen is drawn, as a real
       server does - the screen is marked before the answer lands. */
    AMVSpend.pull = () => { pulls++; return new Promise(r => setTimeout(r, 900)); };
    setTab('spend');
    await new Promise(r => setTimeout(r, 400));
    const vc = document.getElementById('vc'), first = vc.firstElementChild; first.dataset.__m = '1';
    const pane = document.getElementById('spv-limits'), inner = pane && pane.firstElementChild; if(inner) inner.dataset.__m = '1';
    await new Promise(r => setTimeout(r, 1400));
    AMVSpend.serverBacked = realSB; AMVSpend.pull = realPull;
    return { pulls, same: vc.firstElementChild === first && first.dataset.__m === '1', paneSame: !inner || (pane.firstElementChild === inner) };
  });
  ok(r.pulls >= 1, 'the account was asked', r.pulls);
  ok(r.same && r.paneSame, 'and the screen, limits included, stayed as it was', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
