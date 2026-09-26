/* NOBODY CAN REACH ANOTHER PERSON'S ACCOUNT. FAMILY WORKS, END TO END.

   Two things, one screen.

   REMOVED: AMV used to let one account ask for access to another - read their
   email, send as them, change their calendar, spend on their account - granted
   by a code emailed to the account being reached, and exposed to chat and Crew
   as a connector. The owner removed it as a security risk. Here: the page no
   longer offers it anywhere, the module and the connector are gone, and a link
   mirror left in the browser is deleted on load. (The server refuses it too:
   `family` in the Worker suites.)

   FIXED: Family - a parent pays for a child's AMV and sets what it may spend -
   had no way to send an invitation from the page at all, and a child could
   only accept in the browser that sent it, so for a parent and a child, never.
   Now the parent's form sends it, and the child's list comes from the server.

   The server is stood in for at AMV_API._fetch, with real Response-shaped
   answers so the code under test takes the path each section names. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'U', email: 'u@x.com', ini: 'U' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('cookie-consent-banner')?.remove());

/* `serve(path, body)` decides every server answer for the pane. */
const openPane = (serveSrc) => page.evaluate(async (src) => {
  window.__calls = [];
  saveStr('amv_api_base', 'https://x.test'); saveStr('amv_api_token', 't');
  window.AMV_API.live = true; window.AMV_API.token = 't';
  window.AMV_API._fetch = async (path, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    window.__calls.push({ path, body });
    const fn = eval('(' + src + ')');
    const out = fn(path, body);
    return { ok: !out.error, status: out.error ? 400 : 200, json: async () => out };
  };
  _FAM_STATE = null; _FAM_PENDING = null; _FAM_UI.email = ''; _FAM_UI.say = '';
  S.settingsPane = 'family'; setTab('settings'); renderSetPane();
  await new Promise(r => setTimeout(r, 400));
  /* The Family pane itself, or nothing - reading whatever screen happens to be
     up would let "it says nothing about X" pass on the wrong screen. */
  const pane = document.getElementById('set-pane');
  const title = pane && pane.querySelector('.set-title');
  return (title && /Family/.test(title.textContent)) || (pane && /Family/.test(pane.textContent)) ? pane.textContent : 'NO FAMILY PANE';
}, serveSrc);

const PLAIN = `function(path){
  if(/family\\/get/.test(path)) return { ok:true, parentOf:null, childOf:null };
  if(/family\\/pending/.test(path)) return { ok:true, invitations:[] };
  if(/link\\/invite/.test(path)) return { ok:true, delivered:true, to:'kid@x.com' };
  return { ok:true };
}`;

section('Access to someone else’s account is offered nowhere');
{
  const txt = await openPane(PLAIN);
  ok(txt !== 'NO FAMILY PANE' && /Add someone to your family/.test(txt), 'the Family pane is open', txt.slice(0, 120));
  const r = await page.evaluate(() => ({
    scopeBoxes: document.querySelectorAll('input[name="mf-scope"]').length,
    module: typeof window.AMVFamily,
    connector: !!(window.AMVConnectors && AMVConnectors.get('family')),
  }));
  ok(!/Ask for access|Accounts you can act on|People who can act on yours|Read their email|Send email as them/i.test(txt),
     'the pane says nothing about reaching into another account', txt.slice(0, 200));
  ok(r.scopeBoxes === 0, 'there is nothing to tick', r);
  ok(r.module === 'undefined', 'the module that granted it is gone', r);
  ok(!r.connector, 'and chat and Crew have no connector to request it with', r);
}

section('A link copy left in this browser is deleted');
{
  await page.evaluate(() => localStorage.setItem('amv_links', JSON.stringify({ links: [{ id: 'L1', owner: 'a@x.com', grantee: 'u@x.com', scopes: ['email_view'], active: true }], invites: [] })));
  await page.reload();
  await page.waitForFunction(() => typeof window.setTab === 'function', null, { timeout: 15000 });
  ok(await page.evaluate(() => localStorage.getItem('amv_links') === null), 'gone on the next load', true);
}

section('A parent can send a family invitation from the page');
{
  await openPane(PLAIN);
  const bad = await page.evaluate(() => { document.getElementById('fam-inv-email').value = 'nope'; document.getElementById('fam-inv-send').click(); return { say: document.getElementById('fam-inv-say').textContent, calls: window.__calls.filter(c => /invite/.test(c.path)).length }; });
  ok(/email/i.test(bad.say) && bad.calls === 0, 'a malformed address is refused before anything is sent', bad);
  const r = await page.evaluate(async () => {
    document.getElementById('fam-inv-email').value = 'kid@x.com';
    document.getElementById('fam-inv-send').click();
    await new Promise(res => setTimeout(res, 300));
    const c = window.__calls.find(x => /link\/invite/.test(x.path));
    return { body: c && c.body, say: document.getElementById('fam-inv-say').textContent };
  });
  ok(r.body && r.body.owner === 'kid@x.com' && JSON.stringify(r.body.scopes) === '["family"]', 'it asks the server for a family invitation, and only that', r.body);
  ok(/Sent/.test(r.say) && /kid@x\.com/.test(r.say), 'and says it was sent once the server says so', r.say);
}

section('An invitation the server could not email is not called sent');
{
  await openPane(PLAIN.replace("delivered:true", "delivered:false"));
  const say = await page.evaluate(async () => {
    document.getElementById('fam-inv-email').value = 'kid@x.com';
    document.getElementById('fam-inv-send').click();
    await new Promise(res => setTimeout(res, 300));
    return document.getElementById('fam-inv-say').textContent;
  });
  ok(/did not go out/.test(say) && !/^Sent/.test(say), 'it says the email did not go out', say);
}

section('The answer survives the pane redrawing after Send');
{
  /* On a slow connection the pane's own requests can land after Send was
     pressed, and each one redraws it. The address and the answer must not be
     wiped by that - forced here by redrawing on purpose. */
  await openPane(PLAIN.replace("delivered:true", "delivered:false"));
  const r = await page.evaluate(async () => {
    const i = document.getElementById('fam-inv-email'); i.value = 'kid@x.com'; i.dispatchEvent(new Event('input'));
    document.getElementById('fam-inv-send').click();
    await new Promise(res => setTimeout(res, 200));
    _famRedraw(document.querySelector('[data-fam-pane]'));
    return { say: document.getElementById('fam-inv-say').textContent, email: document.getElementById('fam-inv-email').value };
  });
  ok(/did not go out/.test(r.say), 'the answer is still there after a redraw', r);
  ok(r.email === 'kid@x.com', 'and so is the address, so it can be sent again', r);
}

section('A child sees the invitation on their own device, and can join or decline');
{
  const PENDING = `function(path, body){
    if(/family\\/get/.test(path)) return { ok:true, parentOf:null, childOf:null };
    if(/family\\/pending/.test(path)) return { ok:true, invitations:[{ id:'fi_1', from:'mum@x.com', expiresAt: Date.now()+86400000 }] };
    if(/link\\/accept/.test(path)) return body.code === '123456' ? { ok:true, family:{ parent:'mum@x.com' } } : { error:'That code is not right. 4 attempts left.' };
    if(/family\\/decline/.test(path)) return { ok:true, declined:true };
    return { ok:true };
  }`;
  const txt = await openPane(PENDING);
  ok(/mum@x\.com wants to add you to their family/.test(txt), 'the invitation is shown, from the server, naming who asked', txt.slice(0, 240));
  ok(/could not see your conversations/.test(txt), 'and what joining does and does not mean', true);
  const wrong = await page.evaluate(async () => {
    document.getElementById('fam-code-fi_1').value = '000000';
    document.querySelector('[data-fam-accept="fi_1"]').click();
    await new Promise(res => setTimeout(res, 300));
    return document.querySelector('[data-fam-inv-say="fi_1"]').textContent;
  });
  ok(/not right/.test(wrong) && /have not joined/.test(wrong), 'a wrong code says so, and that nothing happened', wrong);
  const right = await page.evaluate(async () => {
    document.getElementById('fam-code-fi_1').value = '123456';
    document.querySelector('[data-fam-accept="fi_1"]').click();
    await new Promise(res => setTimeout(res, 300));
    const c = window.__calls.filter(x => /link\/accept/.test(x.path)).pop();
    return c && c.body;
  });
  ok(right && right.id === 'fi_1' && right.code === '123456', 'the right code is sent to the server with the invitation it belongs to', right);

  await openPane(PENDING);
  const dec = await page.evaluate(async () => {
    document.querySelector('[data-fam-decline="fi_1"]').click();
    await new Promise(res => setTimeout(res, 300));
    const c = window.__calls.filter(x => /family\/decline/.test(x.path)).pop();
    return c && c.body;
  });
  ok(dec && dec.id === 'fi_1', 'Decline tells the server which invitation', dec);
}

section('Someone already in a family is not offered to start one');
{
  const txt = await openPane(`function(path){
    if(/family\\/get/.test(path)) return { ok:true, parentOf:null, childOf:{ parent:'mum@x.com', limits:{ monthlyUSD:10 }, canSee:['x'], cannotSee:['y'] } };
    if(/family\\/pending/.test(path)) return { ok:true, invitations:[] };
    return { ok:true };
  }`);
  ok(/You are in mum@x\.com’s family/.test(txt), 'they see whose family they are in', txt.slice(0, 160));
  ok(!(await page.evaluate(() => !!document.getElementById('fam-inv-send'))), 'and no invitation form', true);
}

section('It fits on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await openPane(PLAIN);
  const bad = await overflowingElement(page);
  ok(!bad, 'nothing pushes the page sideways at 390px', bad);
  await page.setViewportSize({ width: 1280, height: 900 });
}

ok(errors.length === 0, 'no console errors along the way', errors.slice(0, 3));

await app.close();
if (report('account-access') > 0) process.exitCode = 1;
done();
