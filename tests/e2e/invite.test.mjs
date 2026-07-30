/* THE INVITE SCREEN - the client half of the referral loop.

   The server decides everything of value here, so what this file checks is the
   part a growth screen usually gets wrong: that it captures a code without
   leaving it in the address bar, that it never invents a number the ledger has
   not agreed to, that it states the qualifying rule instead of implying an
   instant payout, and that it degrades honestly when there is no server. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'settings', user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;

const openPane = () => page.evaluate(() => { S.settingsPane = 'invite'; renderSetPane(); });
/* Stand in for the server. Every number on the screen has to come from here. */
/* `live` is a getter over the configured base URL, so a test server is a base
   URL - not an assignment to `live`, which would silently do nothing. */
const serve = data => page.evaluate(d => {
  AMV_API.base = 'https://api.test';
  AMV_API.referral = async () => d;
}, data);

const REAL = {
  ok: true, code: 'K7QW2M4X', link: 'https://amv.example/?ref=K7QW2M4X',
  rewards: [
    { at: Date.now() - 86400000, tokens: 100000, kind: 'invited', expiresAt: Date.now() + 89 * 86400000 },
    { at: Date.now() - 3600000, tokens: 100000, kind: 'joined', expiresAt: Date.now() + 90 * 86400000 },
  ],
  bonusTokens: 200000, perReferral: 100000, max: 5, windowDays: 90,
  qualifyTokens: 25000, minAgeHours: 24,
};

section('The screen is reachable, and searchable');
{
  const nav = await page.evaluate(() => [...document.querySelectorAll('.sn-btn')].map(b => b.dataset.sp));
  ok(nav.includes('invite'), 'Invite is in the settings navigation');
  const pal = await page.evaluate(() => _paletteCommands()
    .some(c => /invite|referral/i.test((c.label || '') + ' ' + (c.kw || ''))));
  ok(pal, 'and it can be jumped to from the command palette');
}

section('An invite code is taken out of the address bar, not left in it');
{
  const r = await page.evaluate(() => {
    const before = location.href;
    history.replaceState(null, '', location.pathname + '?ref=abc-K7QW2M4X&keep=1');
    _refCapture();
    const out = { stored: _refPending(), url: location.search };
    history.replaceState(null, '', before);
    return out;
  });
  ok(r.stored === 'ABCK7QW2M4X', 'the code is normalised and remembered', r.stored);
  ok(!/ref=/.test(r.url), 'and removed from the URL, so it cannot ride along in shared links', r.url);
  ok(/keep=1/.test(r.url), 'while everything else in the query string survives', r.url);
}

section('The signup request carries the code the visitor arrived with');
{
  const sent = await page.evaluate(() => {
    saveStr('amv_ref_code', 'K7QW2M4X');
    const f = _authBotFields();
    saveStr('amv_ref_code', '');
    return f;
  });
  ok(sent.ref === 'K7QW2M4X', 'the code is attached to signup so the server can attribute it', sent.ref);
  const none = await page.evaluate(() => { saveStr('amv_ref_code', ''); return _authBotFields(); });
  ok(none.ref === undefined, 'and nothing is sent when there was no invite');
}

section('Every number on the screen comes from the server');
{
  await serve(REAL);
  await openPane();
  await page.waitForSelector('#ref-link', { timeout: 4000 });
  const v = await page.evaluate(() => ({
    link: document.getElementById('ref-link').value,
    txt: document.querySelector('.set-pane').textContent,
    rows: document.querySelectorAll('.ref-row').length,
  }));
  ok(v.link === REAL.link, 'the link shown is the link the server issued', v.link);
  ok(v.rows === 2, 'each reward is listed', v.rows);
  ok(/2 \/ 5/.test(v.txt), 'against the ceiling, so the limit is never a surprise');
  ok(/\+200k/.test(v.txt), 'and the extra capacity is what the ledger says it is');
}

section('It states the qualifying rule rather than implying an instant payout');
{
  const txt = await page.evaluate(() => document.querySelector('.set-pane').textContent);
  ok(/25k tokens/.test(txt) && /24 hours/.test(txt), 'the real conditions are on the page', txt.slice(0, 40));
  ok(/never money|not money|never money or a plan/i.test(txt), 'and it says the reward is not money');
  ok(!/instant|immediately|right away/i.test(txt), 'nothing promises an immediate reward');
}

section('A brand new account is not shown a fake tally');
{
  await serve({ ...REAL, rewards: [], bonusTokens: 0 });
  await openPane();
  await page.waitForSelector('#ref-link', { timeout: 4000 });
  const v = await page.evaluate(() => ({
    txt: document.querySelector('.set-pane').textContent,
    rows: document.querySelectorAll('.ref-row').length,
  }));
  ok(v.rows === 0, 'no rewards are listed');
  ok(/No rewards yet/.test(v.txt), 'the empty state is stated plainly');
  ok(/0 \/ 5/.test(v.txt), 'and the count is honestly zero');
}

section('At the ceiling, it says so');
{
  await serve({ ...REAL, rewards: Array.from({ length: 5 }, (_, i) => ({ at: Date.now(), tokens: 100000, kind: 'invited', expiresAt: Date.now() + 90 * 86400000 })), bonusTokens: 500000 });
  await openPane();
  await page.waitForSelector('.ref-cap', { timeout: 4000 });
  const txt = await page.evaluate(() => document.querySelector('.ref-cap').textContent);
  ok(/maximum/.test(txt), 'the user is told they are at the maximum rather than left inviting for nothing', txt);
  ok(/expire/.test(txt), 'and how it becomes possible again');
}

section('No server, no invented link');
{
  await page.evaluate(() => { AMV_API.base = ''; });
  await openPane();
  const txt = await page.evaluate(() => document.querySelector('.set-pane').textContent);
  ok(/Sign in/.test(txt), 'it explains what is needed instead of showing a dead code', txt.slice(0, 90));
  ok(!/ref=/.test(txt), 'and never fabricates a link');
  await page.evaluate(() => { AMV_API.base = 'https://api.test'; AMV_API.referral = async () => { throw new Error('offline'); }; });
  await openPane();
  await page.waitForFunction(() => /online|server/i.test(document.querySelector('.set-pane').textContent), { timeout: 4000 });
  const off = await page.evaluate(() => document.querySelector('.set-pane').textContent);
  ok(/could not reach|online/i.test(off), 'a failed request says so rather than showing an empty box', off.slice(0, 90));
}

section('It works on a phone, and by keyboard');
{
  await serve(REAL);
  await page.setViewportSize({ width: 390, height: 844 });
  await openPane();
  await page.waitForSelector('#ref-link', { timeout: 4000 });
  const m = await page.evaluate(() => {
    const f = document.getElementById('ref-link');
    const r = f.getBoundingClientRect();
    const label = document.querySelector('label[for="ref-link"]');
    return {
      inView: r.right <= window.innerWidth + 1 && r.width > 100,
      overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      labelled: !!label && label.textContent.length > 0,
      readonly: f.readOnly,
      live: document.getElementById('ref-say').getAttribute('aria-live'),
    };
  });
  ok(m.inView, 'the link field fits the screen');
  ok(m.overflow, 'and the page does not scroll sideways');
  ok(m.labelled, 'the field has a real label for screen readers');
  ok(m.readonly, 'and cannot be edited into something misleading');
  ok(m.live === 'polite', 'the copy result is announced, not only shown');
  await page.setViewportSize({ width: 1280, height: 900 });
}

section('Copy tells the truth when the browser blocks it');
{
  await openPane();
  await page.waitForSelector('#ref-copy', { timeout: 4000 });
  const said = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
    document.getElementById('ref-copy').click();
    await new Promise(r => setTimeout(r, 150));
    return { msg: document.getElementById('ref-say').textContent, focused: document.activeElement.id };
  });
  ok(/blocked/i.test(said.msg), 'a blocked copy is reported, not silently swallowed', said.msg);
  ok(said.focused === 'ref-link', 'and the link is selected so it can still be copied by hand');
}

ok(errors.length === 0, 'no console errors on the invite screen', errors.slice(0, 3));
report('invite');
done();
