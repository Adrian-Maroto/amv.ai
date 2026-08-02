/* THE PARENT'S FAMILY PANEL.

   The controls underneath are enforced on the server - a monthly cap in the
   same backstop that protects the plan, buying refused at the purchase, taking
   money out refused at the withdrawal. This is the screen that lets a parent
   use them.

   Two things it has to get right, and they pull in opposite directions:

     - a parent has to be able to change a limit in one place, quickly
     - and BOTH sides have to be able to see, without reading anything long,
       that a parent cannot read their child's conversations

   The second is the one that decides whether a family trusts this at all, and
   it is the one that would quietly rot if nobody asserted it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Parent', email: 'p@x.com', ini: 'P' } });
const { page, errors } = app;

/* Drive the transport, so what is under test is the path a real request takes. */
const serve = (payload, opts = {}) => page.evaluate(([d, o]) => {
  window.__calls = [];
  Object.defineProperty(window.AMV_API, 'live', { get: () => true, configurable: true });
  window.AMV_API.token = 't';
  window.AMV_API._fetch = async (path, init) => {
    window.__calls.push({ path, body: init && init.body });
    if (o.fail) throw new Error('network down');
    if (path === '/v1/family/limits') {
      const sent = JSON.parse(init.body);
      /* The server bounds the number. The screen must show what was STORED, not
         what was typed. */
      const stored = Math.max(0, Math.min(500, +sent.limits.monthlyUSD || 0));
      return { json: async () => ({ ok: true, child: sent.child, limits: { ...sent.limits, monthlyUSD: stored } }) };
    }
    if (path === '/v1/family/remove') return { json: async () => ({ ok: true, members: [] }) };
    return { json: async () => d };
  };
  window.__FAM_RESET && window.__FAM_RESET();
  _FAM_STATE = null;
  S.settingsPane = 'family'; S.tab = 'settings';
  return setTab('settings');
}, [payload, opts]);

const settle = () => page.waitForFunction(
  () => /Your family|You are in/.test(document.getElementById('vc').textContent), { timeout: 15000 });
const view = () => page.evaluate(() => document.getElementById('vc').textContent);

const PARENT = {
  ok: true, childOf: null,
  parentOf: { id: 'f1', max: 5, members: [
    { email: 'kid@x.com', role: 'child', limits: { monthlyUSD: 5, marketplace: false, payouts: false } },
  ] },
};
const CHILD = {
  ok: true, parentOf: null,
  childOf: { parent: 'p@x.com', limits: { monthlyUSD: 5, marketplace: false, payouts: false },
    canSee: ['How much of the monthly limit you have used', 'Which limits they have set'],
    cannotSee: ['Your conversations', 'What you ask AMV', 'Anything AMV writes for you'] },
};

section('A parent sees who they carry, and what they can spend');
{
  await serve(PARENT);
  await settle();
  const t = await view();
  ok(/kid@x\.com/.test(t), 'the child is listed by account', /kid@x/.test(t));
  ok(/Monthly limit/.test(t), 'with the money control on the same screen');
  ok(/Can buy things/.test(t), 'and buying');
  ok(/Can take money out/.test(t), 'and taking money out');
  ok(/1 of 5 accounts used/.test(t), 'and how many places are left', t.match(/\d of \d accounts/));

  /* Counted PER endpoint. The pane makes two independent requests now - the
     family, and who can reach this account - and each reply re-renders, so a
     total count cannot tell "two different things were fetched" from "one thing
     was fetched twice". Per endpoint is the property that actually matters and
     is stricter than the total ever was: it caught a real re-issue where each
     reply restarted its sibling's request. */
  const byPath = await page.evaluate(() => {
    const n = {};
    window.__calls.forEach(c => { n[c.path] = (n[c.path] || 0) + 1; });
    return n;
  });
  ok(byPath['/v1/family/get'] === 1, 'the family is fetched once, not in a loop', byPath);
  ok(!Object.values(byPath).some(v => v > 1), 'and nothing else is either', byPath);
}

section('Both sides are told what a parent cannot see');
{
  const t = await view();
  ok(/You cannot see/.test(t), 'the parent is told plainly what is not theirs to read');
  ok(/Their conversations/.test(t), 'naming conversations specifically');

  const col = await page.evaluate(() => {
    const c = document.querySelector('.fam-cant');
    return c ? c.textContent : '';
  });
  ok(/conversation/i.test(col), 'in its own block rather than buried in a paragraph', col.slice(0, 60));

  /* And the child, in their own words from the server. */
  await serve(CHILD);
  await settle();
  const kid = await view();
  ok(/You are in p@x\.com’s family/.test(kid), 'the child is told whose family they are in', /You are in/.test(kid));
  ok(/Your conversations/.test(kid), 'and that their conversations are theirs');
  ok(/Only they can change these/.test(kid), 'and who to ask, which is the only action they have');
  const canEdit = await page.evaluate(() => !!document.querySelector('[data-fam-save]'));
  ok(!canEdit, 'a child is given no control that would not work if they used it', canEdit);
}

section('The account holder has a way out');
{
  /* Only the parent could end a membership. AMV cannot tell a parent from a
     stranger, and the consent step is one word in an email - so somebody who
     accepted an invitation they did not fully understand was capped, blocked
     from buying and blocked from withdrawing money they had earned, with no way
     out that did not mean abandoning the account. */
  await serve(CHILD);
  await settle();
  const there = await page.evaluate(() => !!document.getElementById('fam-leave'));
  ok(there, 'a member is shown how to leave');

  const t = await view();
  ok(/Leave this family/.test(t), 'in plain words');

  /* A failure must not look like it worked - somebody who believes they have
     left and has not is worse off than before they tried. */
  const failed = await page.evaluate(async () => {
    window.AMV_API.familyLeave = async () => { throw new Error('engine down'); };
    window.confirm = () => true;
    document.getElementById('fam-leave').click();
    await new Promise(r => setTimeout(r, 200));
    return { say: document.getElementById('fam-leave-say').textContent,
             stillThere: !!document.getElementById('fam-leave') };
  });
  ok(/still in the family/i.test(failed.say),
     'a failed attempt says so rather than looking like it worked', failed.say);
  ok(failed.stillThere, 'and the control is still there to try again');
}

section('Saving shows what the server stored, not what was typed');
{
  /* The server bounds the cap. A screen that echoed the typed number would
     quietly disagree with what is actually enforced - the worst kind of wrong,
     because it looks fine. */
  await serve(PARENT);
  await settle();
  const r = await page.evaluate(async () => {
    document.querySelector('.fam-cap').value = '99999';
    document.querySelector('[data-fam-save]').click();
    await new Promise(r => setTimeout(r, 200));
    return { shown: document.querySelector('.fam-cap').value,
             said: document.querySelector('.fam-say').textContent,
             sent: JSON.parse(window.__calls.find(c => c.path === '/v1/family/limits').body) };
  });
  ok(r.sent.limits.monthlyUSD === 99999, 'what was typed is what was sent', r.sent.limits.monthlyUSD);
  ok(r.shown === '500', 'but the field shows the bounded value the server kept', r.shown);
  ok(/Saved/.test(r.said) && /\$500/.test(r.said), 'and says so in the confirmation', r.said);
}

section('A failed save says nothing changed');
{
  await serve(PARENT);
  await settle();
  const said = await page.evaluate(async () => {
    window.AMV_API.familyLimits = async () => { throw new Error('nope'); };
    document.querySelector('[data-fam-save]').click();
    await new Promise(r => setTimeout(r, 200));
    return document.querySelector('.fam-say').textContent;
  });
  ok(/could not|nothing changed/i.test(said),
     'a failure is reported rather than looking like a save', said);
}

section('A dropped request does not invent an empty family');
{
  /* Answering a network failure with "you have nobody" would tell a parent
     their controls are gone. */
  await serve(PARENT, { fail: true });
  await page.waitForFunction(() => /Your family/.test(document.getElementById('vc').textContent), { timeout: 15000 });
  const t = await view();
  ok(!/kid@x\.com/.test(t), 'nothing is fabricated');
  ok(/Nobody is in your family yet|Add someone/.test(t),
     'and the screen still renders rather than breaking', t.slice(0, 0));
}

section('It works on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await serve(PARENT);
  await settle();
  const bad = await overflowingElement(page);
  ok(!bad, 'nothing pushes the page sideways at 390px', bad);

  const stacked = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('.fam-seen-col')];
    if (cols.length < 2) return false;
    return cols[0].getBoundingClientRect().bottom <= cols[1].getBoundingClientRect().top + 2;
  });
  ok(stacked, 'the can/cannot columns stack rather than shrinking to unreadable');
  await page.setViewportSize({ width: 1280, height: 900 });
}

ok(errors.length === 0, 'no console errors along the way', errors.slice(0, 3));

await app.close();
if (report('family-panel') > 0) process.exitCode = 1;
done();
