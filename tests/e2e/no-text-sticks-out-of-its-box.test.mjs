/* NO TEXT STICKS OUT OF ITS BOX (Nov 10, owner: "I see text sticking out of
   so many boxes, that can't happen at all, all around").

   mobile-sweep asks whether a screen pushes the page sideways. This asks the
   narrower question the owner actually saw: does any piece of text cross the
   edge of the box it is drawn in - the card, the panel, the button, the pill -
   at a phone, a tablet and a desktop width, on every main screen and every
   Settings pane. A "box" is the nearest ancestor that paints an edge (a
   border or a background of its own); text inside something that scrolls
   sideways on purpose, or clipped on purpose, is not counted. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const TABS = ['chat', 'crew', 'tasks', 'integrations', 'spend', 'team', 'help', 'memory', 'plans', 'build', 'handoff', 'usage'];
const PANES = ['account', 'billing', 'family', 'integrations', 'privacy', 'appearance'];
const WIDTHS = (process.env.SWEEP_WIDTHS || '390,768,1440').split(',').map(Number);

const scan = () => {
  const out = [];
  const paints = (cs) => (parseFloat(cs.borderLeftWidth) > 0 || parseFloat(cs.borderRightWidth) > 0 ||
    (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent'));
  const root = document.getElementById('ovr')?.children.length ? document.getElementById('ovr') : (document.getElementById('app') || document.body);
  for (const el of root.querySelectorAll('*')) {
    if (!el.childNodes.length) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.width <= 2 && r.height <= 2) continue;                 // screen-reader-only text
    /* The text's own extent: a range over its text nodes, not the element box. */
    const rg = document.createRange(); rg.selectNodeContents(el);
    const tr = rg.getBoundingClientRect();
    let box = null, skip = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const as = getComputedStyle(a);
      /* Something that scrolls or clips sideways on purpose: the text cannot be
         SEEN past its edge (it scrolls, or it is cut), so it does not stick out. */
      if (/(auto|scroll|hidden|clip)/.test(as.overflowX) && a !== el) { skip = true; break; }
      /* Invisible (a tooltip at rest): nothing is seen at all. */
      if (as.opacity === '0') { skip = true; break; }
      if (a !== el && paints(as)) { box = a; break; }
      if (a === el && (/(hidden|clip)/.test(as.overflowX) || as.textOverflow === 'ellipsis')) { skip = true; break; }
    }
    if (skip || !box) continue;
    const br = box.getBoundingClientRect();
    if (!br.width) continue;
    const over = Math.max(tr.right - br.right, br.left - tr.left);
    if (over > 1.5) out.push({ text: el.textContent.trim().slice(0, 40), el: (el.className || el.tagName).toString().slice(0, 30), box: (box.className || box.tagName).toString().slice(0, 30), over: Math.round(over) });
    if (out.length > 12) break;
  }
  return out;
};

section('The check notices');
{
  /* A sweep that passes is only worth something if it fails on the real thing:
     a card with a word too long for it, and the same card wrapping it. */
  const a = await bootApp({ tab: 'chat' });
  const r = await a.page.evaluate((src) => {
    const scanNow = eval('(' + src + ')');
    const host = document.getElementById('app') || document.body;
    const card = document.createElement('div');
    card.style.cssText = 'width:120px;border:1px solid red;white-space:nowrap';
    card.innerHTML = '<span>Supercalifragilisticexpialidocious-account-name</span>';
    host.prepend(card);
    const caught = scanNow().some(x => /Supercali/.test(x.text));
    card.style.whiteSpace = 'normal'; card.style.overflowWrap = 'anywhere';
    const clean = !scanNow().some(x => /Supercali/.test(x.text));
    card.remove();
    return { caught, clean };
  }, scan.toString());
  ok(r.caught, 'text wider than its card is caught', r);
  ok(r.clean, 'and the same text wrapped inside it is not', r);
  await a.close();
}

for (const w of WIDTHS) {
  section(w + 'px');
  const app = await bootApp({ tab: 'chat', viewport: { width: w, height: w < 500 ? 844 : 900 }, hasTouch: w < 500, user: { name: 'Alexandria Montgomery-Okafor', email: 'alexandria.montgomery-okafor@example.com', ini: 'AM' } });
  const p = app.page;
  await p.evaluate(() => { saveStr('amv_plan', 'pro'); document.getElementById('ck')?.remove(); });
  for (const t of TABS) {
    await p.evaluate((x) => { try { closeOvr(); } catch (e) {} setTab(x); }, t);
    await p.waitForTimeout(t === 'crew' || t === 'integrations' ? 1200 : 600);
    const bad = await p.evaluate(scan);
    ok(bad.length === 0, w + 'px ' + t + ': all text inside its box', bad);
  }
  for (const s of PANES) {
    await p.evaluate((x) => { try { closeOvr(); } catch (e) {} S.settingsPane = x; setTab('settings'); }, s);
    await p.waitForTimeout(900);
    const bad = await p.evaluate(scan);
    ok(bad.length === 0, w + 'px settings/' + s + ': all text inside its box', bad);
  }
  ok(app.errors.length === 0, w + 'px: no page errors', app.errors.slice(0, 3));
  await app.close();
}

report();
done();
