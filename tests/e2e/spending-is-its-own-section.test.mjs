/* SPENDING HAS ITS OWN TAB; UPGRADE IS THE PLANS AND NOTHING ELSE.

   The screen that decides how much money AMV may spend for you. Everything
   behind it was already right - the limits are held on the account, the
   monthly ceiling is counted through the atomic counter, every number is
   re-checked on the server before a purchase. What kept being wrong was where
   it lived: appended to the bottom of Plan & usage (its heading 1798px down a
   3698px pane), then a Settings row, then a page that Upgrade opened with the
   plans at the very bottom.

   The owner's call: "Remove this from upgrade plan" - and Spending keeps its
   own tab, shortened. So Upgrade is the plans, centred; Spending is the money
   AMV may spend for you; the long explanations are one tap away; and the
   consent step is never folded. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await page.evaluate(() => {
  document.getElementById('cookie-consent-banner')?.remove();
  S.user = { name: 'Owner', email: 'owner@amv.test', ini: 'O', provider: 'email' };
  store('amv_user', S.user);
});

section('Upgrade opens the plans, and nothing about Spending');
{
  const v = await page.evaluate(async () => {
    setTab('plans');
    await new Promise(r => setTimeout(r, 400));
    const t = document.getElementById('vc').innerText;
    const head = document.querySelector('.pln-head');
    const cards = document.querySelectorAll('.pln-v .pg > *').length;
    return { t, cards, centred: head ? getComputedStyle(head.parentElement).textAlign : '' };
  });
  ok(v.cards >= 3, 'the plan cards are there', v.cards);
  ok(!/Everywhere your money goes|Money AMV can spend|Buy without asking|Investing|Your responsibility/i.test(v.t),
     'and none of the Spending page is - this was the complaint', v.t.slice(0, 200));
  ok(v.centred === 'center', 'centred', v.centred);
}

section('Every plan’s detail is centred');
{
  for (const plan of ['pro', 'elite', 'ultra']) {
    const v = await page.evaluate(async (p) => {
      try { _upgradeFor = p; } catch (e) {}
      setTab('upgrade');
      await new Promise(r => setTimeout(r, 300));
      const u = document.querySelector('.upg');
      const vc = document.getElementById('vc').getBoundingClientRect();
      const head = document.querySelector('.upg-head');
      if (!u || !head) return null;
      const r = u.getBoundingClientRect();
      return { align: getComputedStyle(u).textAlign,
               offCentre: Math.round(Math.abs((r.left + r.right) / 2 - (vc.left + vc.right) / 2)),
               title: (document.querySelector('.upg-t') || {}).textContent };
    }, plan);
    ok(v && v.align === 'center' && v.offCentre <= 24, plan + ': the detail sits on the centre line', v);
  }
}

section('Spending is its own tab, and is only Spending');
{
  const v = await page.evaluate(async () => {
    setTab('spend');
    await new Promise(r => setTimeout(r, 500));
    const vc = document.getElementById('vc');
    const t = vc.innerText;
    return {
      title: (vc.querySelector('.spv-t') || {}).textContent,
      plans: vc.querySelectorAll('.pg .plan, .pg > *').length,
      planBlock: /Your plan, and what it gives you|Upgrade your plan|How the limit actually works/i.test(t),
      whatFolded: (() => { const d = vc.querySelector('details.mf-what'); return !!d && !d.open; })(),
      gate: /Before AMV can spend anything/i.test(t),
      gateFolded: !!(vc.querySelector('.mf-gate') && vc.querySelector('.mf-gate').closest('details')),
      purchases: /AMV has not bought anything for you/i.test(t),
      chars: t.length,
      rail: !!document.querySelector('.sb-tool[data-tab="spend"]'),
    };
  });
  ok(v.title === 'Spending', 'titled Spending', v.title);
  ok(v.rail, 'with its own entry in the side menu', v.rail);
  ok(!v.planBlock && v.plans === 0, 'no plan block and no plan grid on it', v);
  ok(v.whatFolded, 'the explanation of what it is folded behind one line', v.whatFolded);
  ok(v.gate && !v.gateFolded, 'while the consent step stays in plain sight - a decision is never folded', v);
  ok(v.purchases, 'and purchases, with an honest empty state');
}

section('An old address for Spending opens the tab');
{
  const v = await page.evaluate(async () => {
    S.settingsPane = 'spending'; setTab('settings');
    await new Promise(r => setTimeout(r, 400));
    return { tab: S.tab, rows: [...document.querySelectorAll('.sn-btn')].map(b => b.dataset.sp) };
  });
  ok(v.tab === 'spend', 'a link to the Spending setting lands on the Spending tab, not on Account', v.tab);
}

section('The limits live in exactly one place');
{
  const v = await page.evaluate(async () => {
    S.settingsPane = 'billing'; setTab('settings');
    await new Promise(r => setTimeout(r, 700));
    return { caps: document.querySelectorAll('#mf-cap').length, usage: !!document.getElementById('set-sec-usage') };
  });
  ok(v.caps === 0, 'Plan & billing holds no second copy of the spending limits', v.caps);
  ok(v.usage, 'while usage is still part of the plan screen');
}

section('Both work on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  for (const t of ['plans', 'spend']) {
    await page.evaluate(async (tab) => { setTab(tab); await new Promise(r => setTimeout(r, 400)); }, t);
    const bad = await overflowingElement(page);
    ok(!bad, t + ': nothing pushes the page sideways at 390px', bad);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
