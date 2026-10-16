/* THE SCREENS THAT TAKE MONEY SPEAK THE PERSON'S LANGUAGE.

   The plans page, the upgrade window and Billing were rebuilt, and every new
   word on them shipped in English only - so somebody reading AMV in Spanish
   met English at exactly the moment they were deciding to pay, and without
   an engine key the machine fallback never runs to cover it.

   They are whole sentences with a slot for the name now ("Get {plan}"), not
   "Get" + " " + "Pro": word order is the language's, not English's, and
   Japanese puts the plan first.

   And one sentence was simply untrue: it said every paid plan ran the same
   engine, while Apex starts at Elite. The Pro card said the same thing in
   another way. Both are checked against the plan tiers, not against a copy. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('cookie-consent-banner')?.remove());

const switchTo = (code) => page.evaluate(async (c) => {
  saveStr('amv_lang', c);
  try { _translateUI(); } catch (e) {}
  for (let i = 0; i < 50 && !_i18nPackHave(c); i++) await new Promise(s => setTimeout(s, 100));
}, code);

const read = () => page.evaluate(async () => {
  _setPlan('free'); setTab('plans');
  await new Promise(s => setTimeout(s, 500));
  const vc = document.getElementById('vc');
  const plans = {
    title: (vc.querySelector('.pl2-t') || {}).textContent || '',
    sub: (vc.querySelector('.pl2-sub') || {}).textContent || '',
    ctas: [...vc.querySelectorAll('.pl2-card .pl2-cta')].map(b => b.textContent.trim()),
    per: (vc.querySelector('.pl2-per') || {}).textContent || '',
    fine: (vc.querySelector('.pl2-fine') || {}).textContent || '',
  };
  openUpgradeModal('smart');
  await new Promise(s => setTimeout(s, 250));
  const w = document.querySelector('#ovr .upg2');
  const modal = w ? {
    title: (w.querySelector('h2') || {}).textContent || '',
    line: (w.querySelector('.upg2-head p') || {}).textContent || '',
    btns: [...w.querySelectorAll('.upg2-card [data-upg]')].map(b => b.textContent.trim()),
  } : null;
  document.getElementById('upg-x')?.click();
  _setPlan('pro'); S.settingsPane = 'billing'; setTab('settings');
  await new Promise(s => setTimeout(s, 700));
  const root = document.getElementById('set-modal') || vc;
  const bill = {
    heads: [...root.querySelectorAll('.vi-bill h3')].map(h => h.textContent.trim()),
    change: (root.querySelector('.bill-change') || {}).textContent || '',
  };
  try { closeSettings(); } catch (e) {}
  _setPlan('free');
  return { plans, modal, bill };
});

section('In English, every slot is filled and the claims are true');
{
  const r = await read();
  ok(!/\{plan\}|\{model\}/.test(JSON.stringify(r)), 'no {placeholder} reaches the screen', r);
  ok(r.plans.ctas.includes('Get Pro'), 'the button still reads "Get Pro"', r.plans.ctas);
  ok(/^AMV Apex is included from Elite up\./.test(r.modal && r.modal.line), 'the window says which plan includes the engine', r.modal);
  const t = await page.evaluate(() => ({
    proHasApex: PLAN_TIERS.pro.models.indexOf('smart') >= 0,
    proCard: _planPitch('pro').feats.map(f => f[1]).join(' | '),
  }));
  ok(!t.proHasApex && !/same engine on every paid plan/i.test(r.plans.sub),
     'the plans page no longer says every paid plan runs the same engine', r.plans.sub);
  ok(!t.proHasApex && !/Apex/.test(t.proCard), 'and the Pro card does not offer Apex, which Pro does not include', t.proCard);
}

section('Every plan line is something the server does');
{
  const r = await page.evaluate(() => {
    const all = ['free', 'pro', 'elite', 'ultra'].map(k => { const p = _planPitch(k); return [p.anchor, p.reassure].concat(p.feats.map(f => f[1])).join(' | '); }).join(' || ');
    openPlanCompare('pro');
    const table = (document.querySelector('#ovr .pc-table') || {}).textContent || '';
    document.getElementById('pc-x')?.click();
    /* The custom plan has its own list, and "Priority speed" survived there
       after it was taken out of the table. */
    const custom = _cpInclFeatures(true).concat(_cpInclFeatures(false)).join(' | ');
    return { all: all + ' || ' + custom, table, ultraJobs: _autoMaxForPlan('ultra'), pro5h: PLAN_MESSAGES_5H.pro };
  });
  /* Each of these was on a plan card or in the table, and none of them is a
     thing AMV does: the five-hour window allows Pro about one message every
     eighteen seconds, the weekly top-engine count is a cap inside the month,
     and the server has no priority queue, per-plan context, faster hardware
     or early-release channel. */
  for (const [claim, re] of [['one every nine seconds', /nine seconds/i], ['the weekly cap comes "on top"', /on top/i],
                             ['Apex is first in the queue', /first in the queue/i], ['Ultra has the longest context', /longest context/i],
                             ['faster hardware', /fastest hardware|priority speed/i], ['early access', /early access/i],
                             ['making images or video', /images, video|image generation|video generation/i]])
    ok(!re.test(r.all) && !re.test(r.table), 'no longer claims ' + claim, (r.all.match(re) || r.table.match(re) || [''])[0]);
  ok(r.all.includes(r.ultraJobs + ' scheduled'), 'Ultra’s real difference is said in the server’s own number', r.ultraJobs);
}

section('How the limit works names the engines the plan really has');
{
  /* It told Pro that "Forge and Apex" are counted weekly - Pro has no Apex -
     and that the monthly total is "one every nine seconds" on every plan. */
  const band = await page.evaluate(() => {
    const out = {};
    for (const p of ['pro', 'elite', 'ultra']) { _setPlan(p); const d = document.createElement('div'); d.innerHTML = _usageShapeBand(); out[p] = d.textContent; }
    _setPlan('free');
    return out;
  });
  ok(!/Apex/.test(band.pro) && /Forge is the expensive one/.test(band.pro), 'Pro is told about Forge, the one it has', band.pro);
  ok(/Forge and Apex/.test(band.elite) && /Forge and Apex/.test(band.ultra), 'Elite and Ultra about both', [band.elite.length, band.ultra.length]);
  ok(/about 7 a minute/.test(band.pro) && /about 21 a minute/.test(band.elite) && /about 69 a minute/.test(band.ultra),
     'and each monthly total in its own plan\'s numbers', [band.pro, band.elite, band.ultra].map(t => (t.match(/about \d+ a minute/) || [''])[0]));
  ok(!/nine seconds/.test(Object.values(band).join(' ')), 'with no fixed figure left over');
}

section('In Spanish, the money screens are Spanish');
{
  await switchTo('es');
  const r = await read();
  ok(r.plans.title === 'Mejora tu plan', 'the plans heading', r.plans.title);
  ok(r.plans.ctas.includes('Obtener Pro'), 'the button, with the plan in its slot', r.plans.ctas);
  ok(r.plans.per === '/ mes' && /dólares/.test(r.plans.fine), 'the price unit and the fine print', [r.plans.per, r.plans.fine]);
  ok(/^Mejora tu plan para usar AMV Apex$/.test(r.modal && r.modal.title), 'the upgrade window', r.modal);
  ok(r.modal.btns.includes('Obtener Elite'), 'and its buttons', r.modal.btns);
  ok(['Pago', 'Facturas', 'Cancelación'].every(h => r.bill.heads.includes(h)), 'Billing’s sections', r.bill.heads);
  ok(r.bill.change === 'Cambiar plan', 'and its plan button', r.bill.change);
  ok(!/\{plan\}|\{model\}/.test(JSON.stringify(r)), 'no {placeholder} reaches the screen');
  const cards = await page.evaluate(async () => {
    setTab('plans'); await new Promise(x => setTimeout(x, 400));
    const pro = document.querySelector('#vc .pl2-card[data-plan="pro"]');
    return { line: (pro.querySelector('.pl2-line') || {}).textContent || '', feats: [...pro.querySelectorAll('.pl2-feats li')].map(e => e.textContent) };
  });
  ok(/primer nivel/.test(cards.line), 'the card’s own line is Spanish', cards.line);
  ok(cards.feats.some(f => /mensajes al mes/.test(f)) && cards.feats.some(f => /Hasta \d+ mensajes de Forge/.test(f)),
     'and so is what it includes, with the numbers in their places', cards.feats);
  ok(!cards.feats.some(f => /\{[a-z]+\}/.test(f)), 'with no slot left unfilled', cards.feats);
}

section('In Japanese, the plan name goes where Japanese puts it');
{
  await switchTo('ja');
  const r = await read();
  ok(r.plans.ctas.includes('Proにする'), 'the plan comes first, not "Get" first', r.plans.ctas);
  ok(/AMV Apex/.test(r.modal.title) && /アップグレード/.test(r.modal.title), 'the window title', r.modal.title);
}

section('In German, the longest of them, nothing spills off a phone');
{
  await switchTo('de');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => { _setPlan('free'); setTab('plans'); await new Promise(s => setTimeout(s, 500)); });
  ok((await overflowingElement(page)) === null, 'the plans page fits', await overflowingElement(page));
  await page.evaluate(async () => { openUpgradeModal('smart'); await new Promise(s => setTimeout(s, 250)); });
  const m = await page.evaluate(() => { const b = document.querySelector('#ovr .upg2').getBoundingClientRect(); return { l: b.left, r: b.right, vw: innerWidth }; });
  ok(m.l >= 0 && m.r <= m.vw, 'the upgrade window fits', m);
  await page.evaluate(() => document.getElementById('upg-x')?.click());
  await page.setViewportSize({ width: 1280, height: 900 });
  await switchTo('en');
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('the-plans-speak-your-language') > 0) process.exitCode = 1;
done();
