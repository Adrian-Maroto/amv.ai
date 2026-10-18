/* AN ANSWER CAN BE SEVERAL PIECES AT ONCE - AND EVERY PIECE IS ONE ENTRY.

   The interactive pieces an answer can draw live in one registry (AMV_UI).
   This holds the three places that read it to each other - what md() draws,
   what the model is taught, and what "open in Dev" treats as code - and then
   drives the view that composes them: a stack, a grid, tabs that work from
   the keyboard, the pieces inside still alive, and every malformed view shown
   as the block it is rather than a component with a hole in it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* Draw an answer into the page, the way a chat message is drawn. */
const draw = (text) => page.evaluate((text) => {
  let host = document.getElementById('t-host');
  if (!host) { host = document.createElement('div'); host.id = 't-host'; host.className = 'mc';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;overflow:auto;background:var(--bg);padding:16px'; document.body.appendChild(host); }
  host.innerHTML = md(text);
  return host.innerHTML;
}, text);
const fence = (kind, obj) => '```' + kind + '\n' + JSON.stringify(obj) + '\n```';
const S = { kind: 'stats', label: 'Budget', items: [{ value: '€1,200', label: 'Total' }] };
const STEPS = { kind: 'steps', label: 'Days', steps: [{ title: 'Day 1', detail: 'Alfama' }, { title: 'Day 2' }] };
const CARDS = { kind: 'cards', label: 'Stay', items: [{ title: 'Casa A', subtitle: 'Near the river' }] };
const CALC = { kind: 'calc', label: 'Split', inputs: [{ id: 'total', label: 'Total', value: 100 }, { id: 'people', label: 'People', value: 4 }],
  outputs: [{ label: 'Each', formula: 'total/people', format: 'number' }] };

section('One registry, and the three places that read it agree');
{
  const r = await page.evaluate(() => {
    const kinds = Object.keys(AMV_UI);
    const sys = String(SYS);
    const taught = kinds.filter(k => sys.includes('```' + k));
    const blockLines = sys.split('\n').filter(l => /^- \w+ \(/.test(l) && /```\w+/.test(l)).map(l => l.match(/```(\w+)/)[1]);
    return { kinds, taught, blockLines, notCode: _NEXT_NOT_CODE };
  });
  ok(r.kinds.length >= 9 && r.kinds.includes('view'), 'the registry holds every piece, the view among them', r.kinds);
  ok(r.taught.length === r.kinds.length, 'the model is taught every piece the page can draw', r.kinds.filter(k => !r.taught.includes(k)));
  ok(r.blockLines.every(k => r.kinds.includes(k)), 'and is taught nothing the page cannot draw', r.blockLines.filter(k => !r.kinds.includes(k)));
  ok(['cards', 'calc', 'form', 'view'].every(k => r.notCode.includes(k)), 'none of them is offered to "open in Dev" as a source file - cards, calc and form were', r.notCode);
}

section('A piece that does not check out is shown as written, never as an empty component');
{
  for (const kind of ['stats', 'compare', 'steps', 'cards', 'choices', 'view']) {
    const h = await draw(fence(kind, {}));
    ok(!/class="gui-/.test(h) && h.includes('{}'), kind + ' with nothing in it is shown as the block it is', h.slice(0, 160));
  }
}

section('A grid: one title over the pieces, each labelled');
{
  const h = await draw('Here is the plan.\n\n' + fence('view', { title: 'Lisbon in 4 days', layout: 'grid', parts: [S, STEPS, CARDS] }));
  const r = await page.evaluate(() => {
    const v = document.querySelector('#t-host .gui-view-grid');
    return v ? { title: v.querySelector('.gui-view-title').textContent, parts: v.querySelectorAll('.gui-view-part').length,
      heads: [...v.querySelectorAll('.gui-view-h')].map(x => x.textContent),
      inner: !!v.querySelector('.gui-stats') && !!v.querySelector('.gui-steps') && !!v.querySelector('.gui-cards') } : null;
  });
  ok(r && r.title === 'Lisbon in 4 days' && r.parts === 3, 'drawn as one view of three parts', r);
  ok(r && r.heads.join('|') === 'Budget|Days|Stay' && r.inner, 'each under its label, each drawn by its own piece', r);
}

section('Tabs: one panel at a time, by click and by keyboard');
{
  await draw(fence('view', { title: 'Trip', layout: 'tabs', parts: [S, STEPS, CARDS] }));
  const state = () => page.evaluate(() => {
    const tabs = [...document.querySelectorAll('#t-host [role="tab"]')];
    return { sel: tabs.map(t => t.getAttribute('aria-selected')).join(','), order: tabs.map(t => t.tabIndex).join(','),
      shown: [...document.querySelectorAll('#t-host [role="tabpanel"]')].map(p => !p.hidden).join(','),
      focus: document.activeElement && document.activeElement.textContent,
      wired: tabs.every(t => document.getElementById(t.getAttribute('aria-controls')) &&
        document.getElementById(t.getAttribute('aria-controls')).getAttribute('aria-labelledby') === t.id),
      list: document.querySelector('#t-host [role="tablist"]').getAttribute('aria-label') };
  });
  let s = await state();
  ok(s.sel === 'true,false,false' && s.shown === 'true,false,false' && s.order === '0,-1,-1', 'the first tab is chosen, its panel shown, the rest out of the tab order', s);
  ok(s.wired && s.list === 'Trip', 'every tab names its panel and the panel names it back; the list is named', s);
  await page.focus('#t-host [role="tab"]');
  await page.keyboard.press('ArrowRight');
  s = await state();
  ok(s.sel === 'false,true,false' && s.shown === 'false,true,false' && s.focus === 'Days', 'the right arrow moves to the next tab and shows its panel', s);
  await page.keyboard.press('End');
  s = await state();
  ok(s.sel === 'false,false,true' && s.focus === 'Stay', 'End goes to the last', s);
  await page.keyboard.press('ArrowRight');
  s = await state();
  ok(s.sel === 'true,false,false' && s.focus === 'Budget', 'and the arrows wrap round', s);
  await page.click('#t-host [role="tab"]:nth-child(2)');
  s = await state();
  ok(s.sel === 'false,true,false' && s.shown === 'false,true,false', 'a click chooses a tab too', s);
}

section('The pieces inside a view are still alive');
{
  await draw(fence('view', { layout: 'stack', parts: [CALC, S] }));
  const r = await page.evaluate(async () => {
    const inp = document.querySelector('#t-host [data-calc-in="people"]');
    const out = () => document.querySelector('#t-host [data-calc-out="0"]').textContent;
    const before = out();
    inp.value = '5'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    return { before, after: out() };
  });
  ok(r.before === '25' && r.after === '20', 'a calculator in a view follows its inputs', r);
}

section('A view that is not one is shown as the block it is');
{
  const bad = {
    'a view inside a view': { parts: [S, { kind: 'view', parts: [S] }] },
    'a piece the page does not have': { parts: [S, { kind: 'script', src: 'x' }] },
    'two forms, which would each send half': { parts: [
      { kind: 'form', fields: [{ id: 'a', label: 'A' }] }, { kind: 'form', fields: [{ id: 'b', label: 'B' }] }] },
    'more than six parts': { parts: Array(7).fill(S) },
    'a part that does not check out': { parts: [S, { kind: 'cards', items: [{ subtitle: 'no title' }] }] },
  };
  for (const [why, spec] of Object.entries(bad)) {
    const h = await draw(fence('view', spec));
    ok(!/gui-view/.test(h), why + ': not drawn', h.slice(0, 120));
  }
}

section('Nothing the model wrote becomes markup');
{
  const h = await draw(fence('view', { title: '<img src=x onerror="window.__x=1">', layout: 'tabs',
    parts: [{ ...S, label: '<b onclick="window.__x=1">tab</b>' }] }));
  const r = await page.evaluate(() => ({ img: !!document.querySelector('#t-host img'), b: !!document.querySelector('#t-host b[onclick]'), x: window.__x }));
  ok(!r.img && !r.b && r.x === undefined, 'a title and a label are text, whatever they contain', [r, h.slice(0, 200)]);
}

section('With interactive answers off, a view is the block it is - a chart is still a chart');
{
  const r = await page.evaluate(() => {
    const was = loadStr('amv_cap_suggestions');
    saveStr('amv_cap_suggestions', '0');
    try {
      const v = md('```view\n{"parts":[{"kind":"stats","items":[{"value":"1","label":"x"}]}]}\n```');
      const c = md('```chart\n{"type":"bar","title":"T","data":[{"label":"A","value":1}]}\n```');
      return { view: /gui-view/.test(v), chart: /<svg/.test(c) };
    } finally { saveStr('amv_cap_suggestions', was == null ? '' : was); }
  });
  ok(!r.view && r.chart, 'the view is not drawn, the chart is', r);
}

section('On a phone, a view fits and its tabs are big enough to hit');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await draw(fence('view', { title: 'Trip', layout: 'tabs', parts: [S, STEPS, CARDS, { ...S, label: 'A longer label here' }, { ...STEPS, label: 'Another one' }] }));
  const r = await page.evaluate(() => {
    const v = document.querySelector('#t-host .gui-view');
    const tabs = [...v.querySelectorAll('[role="tab"]')];
    return { over: v.scrollWidth - v.clientWidth, list: v.querySelector('[role="tablist"]').scrollWidth > 0,
      minH: Math.min(...tabs.map(t => t.getBoundingClientRect().height)),
      pageOver: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  ok(r.over <= 1 && r.pageOver <= 1, 'nothing spills sideways - the tab row scrolls inside itself', r);
  ok(r.minH >= 44, 'every tab is at least 44px tall', r.minH);
  await page.setViewportSize({ width: 1280, height: 860 });
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('an-answer-can-be-several-pieces-at-once') > 0) process.exitCode = 1;
done();
