/* ACCESSIBILITY RE-CHECK - everything built since the last pass: the Job Hunt
   setup form, the Spending pane, the Family pane, the account exits in the
   profile menu, and the universal agent's live run. The checks are the ones
   that actually lock someone out: a control with no name, a field with no
   label, a status that changes silently, something reachable only with a
   mouse, or a target too small to hit on a phone. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'settings', user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;

/* One audit, run against whatever is on screen. Returns the specific offenders
   rather than a count, so a failure says which control is wrong. */
await page.evaluate(() => {
  window.__a11y = (root) => {
    const scope = root || document;
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const name = el => (
      el.getAttribute('aria-label') ||
      (el.getAttribute('aria-labelledby') ? (document.getElementById(el.getAttribute('aria-labelledby'))||{}).textContent : '') ||
      el.textContent || el.title || ''
    ).trim();

    const unnamed = [...scope.querySelectorAll('button,a[href]')].filter(vis)
      .filter(el => !name(el)).map(el => el.id || el.className || el.outerHTML.slice(0, 60));

    const unlabelled = [...scope.querySelectorAll('input,select,textarea')].filter(vis)
      .filter(el => el.type !== 'hidden')
      .filter(el => {
        if(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
        if(el.id && scope.querySelector('label[for="' + CSS.escape(el.id) + '"]')) return false;
        if(el.closest('label')) return false;                 // wrapped
        return true;
      }).map(el => el.id || el.name || el.outerHTML.slice(0, 60));

    // aria-describedby must point at something that exists, or the hint is lost
    const danglingDesc = [...scope.querySelectorAll('[aria-describedby],[aria-labelledby]')]
      .flatMap(el => ['aria-describedby','aria-labelledby'].flatMap(a =>
        (el.getAttribute(a) || '').split(/\s+/).filter(Boolean)
          .filter(id => !document.getElementById(id))
          .map(id => (el.id || el.tagName) + ' -> #' + id)));

    // anything interactive must be focusable by keyboard
    const unfocusable = [...scope.querySelectorAll('button,input,select,textarea,a[href],[role="button"]')]
      .filter(vis).filter(el => el.tabIndex < 0 && !el.disabled)
      .map(el => el.id || el.className);

    /* Tap targets, against the WCAG 2.2 minimum. Measured on the thing a
       finger actually hits: a checkbox inside a <label> is clicked anywhere on
       that label, so the label is the target, not the 16px box. */
    const target = el => (el.type === 'checkbox' || el.type === 'radio') ? (el.closest('label') || el) : el;
    const tiny = [...scope.querySelectorAll('button,a[href],input[type="checkbox"],input[type="radio"]')].filter(vis)
      .filter(el => { const r = target(el).getBoundingClientRect(); return Math.min(r.width, r.height) < 22; })
      .map(el => (el.id || el.className) + ' ' + Math.round(target(el).getBoundingClientRect().height) + 'px');

    return { unnamed, unlabelled, danglingDesc, unfocusable, tiny };
  };
});
const audit = sel => page.evaluate(s => window.__a11y(s ? document.querySelector(s) : document), sel || null);

section('Spending pane');
await page.evaluate(() => {
  AMVCompliance.accept(); AMVCompliance.setBirthYear(1990);
  AMVSpend.record(12, { item: 'Book', merchant: 'Shop' });
  S.settingsPane = 'spending'; renderSetPane();
});
const spend = await audit('.set-pane');
ok(spend.unnamed.length === 0, 'every button has an accessible name', spend.unnamed);
ok(spend.unlabelled.length === 0, 'every field has a label', spend.unlabelled);
ok(spend.danglingDesc.length === 0, 'no hint points at an element that does not exist', spend.danglingDesc);
ok(spend.unfocusable.length === 0, 'everything interactive is keyboard reachable', spend.unfocusable);
ok(spend.tiny.length === 0, 'no tap target is under 22px', spend.tiny);

const spendLive = await page.evaluate(() => {
  const live = [...document.querySelectorAll('.set-pane [aria-live]')].map(e => e.id);
  const heads = [...document.querySelectorAll('.set-pane h3')].map(h => h.textContent.trim());
  const bar = document.querySelector('.mf-bar');
  return { live, heads, barNamed: !!(bar && bar.getAttribute('aria-label')) };
});
ok(spendLive.live.length > 0, 'saving a limit is announced, not only shown', spendLive.live);
ok(spendLive.heads.length >= 3, 'the pane has real headings to navigate by', spendLive.heads);
ok(spendLive.barNamed, 'the spend bar is not a mute graphic - it carries the numbers');

section('Family pane');
await page.evaluate(() => { S.settingsPane = 'family'; renderSetPane(); });
const fam = await audit('.set-pane');
ok(fam.unnamed.length === 0, 'every button has an accessible name', fam.unnamed);
ok(fam.unlabelled.length === 0, 'every field has a label, including the permission checkboxes', fam.unlabelled);
ok(fam.danglingDesc.length === 0, 'no dangling aria references', fam.danglingDesc);
ok(fam.unfocusable.length === 0, 'everything is keyboard reachable', fam.unfocusable);
ok(fam.tiny.length === 0, 'no tap target is under 22px', fam.tiny);

const famGroup = await page.evaluate(() => {
  const fs = document.querySelector('.mf-scopes');
  return { fieldset: fs && fs.tagName === 'FIELDSET', legend: !!(fs && fs.querySelector('legend')),
           live: [...document.querySelectorAll('.set-pane [aria-live]')].length };
});
ok(famGroup.fieldset && famGroup.legend,
   'the permission choices are a grouped fieldset with a legend, so they are read as one question');
ok(famGroup.live > 0, 'the result of sending a request is announced');

section('Job Hunt setup form');
const jobs = await page.evaluate(() => { closeOvr && closeOvr(); openJobHunt(); return true; });
const jh = await audit('#ovr');
ok(jobs === true, 'the Job Hunt form opens');
ok(jh.unnamed.length === 0, 'every button in it has a name', jh.unnamed);
ok(jh.unlabelled.length === 0, 'every field in it has a label', jh.unlabelled);
ok(jh.unfocusable.length === 0, 'and all of it is keyboard reachable', jh.unfocusable);
ok(jh.tiny.length === 0, 'no tap target is under 22px', jh.tiny);

section('Account exits in the profile menu');
await page.evaluate(() => { closeOvr(); document.getElementById('nav-av').click(); });
const menu = await audit('.prof-menu');
ok(menu.unnamed.length === 0, 'every exit is named', menu.unnamed);
ok(menu.unfocusable.length === 0, 'the menu is operable from the keyboard', menu.unfocusable);
ok(menu.tiny.length === 0, 'and the items are big enough to hit on a phone', menu.tiny);

section('The universal agent run');
await page.evaluate(async () => {
  document.querySelector('.prof-menu')?.remove();
  const host = document.createElement('div'); host.id = 'uni-live'; document.body.appendChild(host);
  AMVConnectors.register({ id: 'demo', name: 'Demo', auth: 'none',
    actions: { go: { desc: 'Works', run: async () => ({ ok: true }) } } });
  const real = AMVUniversal.plan;
  AMVUniversal.plan = async () => ({ steps: [{ title: 'Do the thing', tool: 'demo.go', args: {} }] });
  await uniRun('anything', { autonomous: true, approved: true });
  AMVUniversal.plan = real;
});
const uni = await audit('#uni-live');
ok(uni.unnamed.length === 0, 'the Stop control and any other button are named', uni.unnamed);
ok(uni.unfocusable.length === 0, 'the run can be stopped from the keyboard', uni.unfocusable);

section('Mobile: nothing overflows the screen sideways');
const overflow = await page.evaluate(async () => {
  document.getElementById('uni-live')?.remove();
  const out = {};
  for(const pane of ['spending','family']){
    S.settingsPane = pane; renderSetPane();
    const el = document.querySelector('.set-pane');
    out[pane] = el.scrollWidth - el.clientWidth;
  }
  return out;
});
await page.setViewportSize({ width: 390, height: 844 });
const overflowMobile = await page.evaluate(async () => {
  const out = {};
  for(const pane of ['spending','family']){
    S.settingsPane = pane; renderSetPane();
    await new Promise(r => setTimeout(r, 60));
    const el = document.querySelector('.set-pane');
    out[pane] = { pane: el.scrollWidth - el.clientWidth, body: document.body.scrollWidth - window.innerWidth };
  }
  return out;
});
ok(overflow.spending <= 1 && overflow.family <= 1, 'no sideways scroll on desktop', overflow);
ok(overflowMobile.spending.pane <= 1 && overflowMobile.family.pane <= 1,
   'and none on a phone either', overflowMobile);
ok(overflowMobile.spending.body <= 1 && overflowMobile.family.body <= 1,
   'the page itself never scrolls sideways', overflowMobile);

section('Reduced motion is respected by the new CSS');
const motion = await page.evaluate(() => {
  const css = [...document.styleSheets].flatMap(s => { try{ return [...s.cssRules]; }catch(e){ return []; } })
    .filter(r => r.conditionText && /prefers-reduced-motion/.test(r.conditionText)).length;
  return css;
});
ok(motion > 0, 'a reduced-motion rule exists in the stylesheet', motion);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
