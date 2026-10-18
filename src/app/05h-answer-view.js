/* ══════════════════════════════════════════════════════════════════════
   ONE RUNTIME FOR INTERACTIVE ANSWERS.

   Every interactive piece an answer can contain - chart, stats, compare,
   steps, cards, calc, form, choices, and the view that composes them - is one
   entry here. The renderer (md), the list of fenced blocks that are not code
   (26-nextstep) and the drift suite all read this table, so a piece cannot be
   drawn by one and treated as source code by another. That had happened:
   cards, calc and form were drawn as components and still offered to "open
   in Dev" as a source file, because the second list was written by hand.

   The contract is the same for every piece. The model writes DATA; `draw`
   checks it against fixed shapes and bounds and returns markup built only
   from escaped text and the page's own controls, or null. Null means the
   reader sees the block as written - never a component that silently shows
   nothing, which an empty stats block used to do.

   `always` pieces are drawn even when interactive answers are switched off in
   Settings, because without them the answer is a wall of JSON (a chart).
   ══════════════════════════════════════════════════════════════════════ */
const AMV_UI = {
  chart:   { draw: (s) => renderChartSVG(s), always: true },
  stats:   { draw: (s) => _guiStats(s) },
  compare: { draw: (s) => _guiCompare(s) },
  steps:   { draw: (s) => _guiSteps(s) },
  cards:   { draw: (s) => _guiCards(s) },
  calc:    { draw: (s) => _guiCalc(s) },
  form:    { draw: (s) => _guiForm(s) },
  choices: { draw: (s) => _guiChoices(s) },
  view:    { draw: (s) => _guiView(s) },
};
try{ window.AMV_UI = AMV_UI; }catch(e){}

/* One piece from its parsed data, or null. A renderer that throws is the same
   as one that refuses: the reader gets the block as written. */
function _uiDraw(kind, spec){
  const k = AMV_UI[kind];
  if(!k || !spec || typeof spec !== 'object') return null;
  try{
    const html = k.draw(spec);
    return typeof html === 'string' && html.trim() ? html : null;
  }catch(e){ return null; }
}

/* The fenced blocks of an answer that are components, as md() sees them
   (already HTML-escaped). Run before the generic code-block pass. */
function _uiBlocks(t, interactive){
  const kinds = Object.keys(AMV_UI).filter(k => interactive || AMV_UI[k].always);
  if(!kinds.length) return t;
  const re = new RegExp('```(' + kinds.join('|') + ')\\n?([\\s\\S]*?)```', 'gi');
  return t.replace(re, (match, kind, body) => {
    let spec;
    try{ spec = JSON.parse(body.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()); }
    catch(e){ return match; }
    return _uiDraw(kind.toLowerCase(), spec) || match;
  });
}

/* ── view: several pieces as one answer ─────────────────────────────────
   A trip plan is a budget calculator, a day-by-day timeline and three places
   to stay; a review of a quarter is the numbers, a chart and what to do next.
   A view puts them under one title, as a stack, a grid, or tabs.

   Bounded so it stays an answer and not a page: up to six parts, no view
   inside a view, at most one form (two Send buttons in one answer would each
   send half of what was asked). Every part must draw - a view with a part that
   does not is not drawn, rather than drawn with a hole in it. */
const UI_VIEW_MAX = 6;
const UI_VIEW_LAYOUTS = ['stack', 'grid', 'tabs'];
let _uiViewSeq = 0;
function _guiView(spec){
  const parts = Array.isArray(spec.parts) ? spec.parts : [];
  if(!parts.length || parts.length > UI_VIEW_MAX) return null;
  const layout = UI_VIEW_LAYOUTS.includes(spec.layout) ? spec.layout : 'stack';
  let forms = 0;
  const drawn = [];
  for(const p of parts){
    if(!p || typeof p !== 'object') return null;
    const kind = String(p.kind || '').toLowerCase();
    if(kind === 'view' || !AMV_UI[kind]) return null;
    if(kind === 'form' && ++forms > 1) return null;
    /* The part's own data is the part itself, without the two keys that
       belong to the view. */
    const own = Object.assign({}, p); delete own.kind; delete own.label;
    const html = _uiDraw(kind, own);
    if(!html) return null;
    drawn.push({ label: String(p.label || own.title || '').slice(0, 40), html });
  }
  const id = 'gv' + (++_uiViewSeq);
  const head = spec.title ? '<div class="gui-view-title">' + escH(String(spec.title).slice(0, 120)) + '</div>' : '';
  if(layout !== 'tabs')
    return '<div class="gui-view gui-view-' + layout + '">' + head + '<div class="gui-view-body">'
      + drawn.map(d => '<section class="gui-view-part">'
          + (d.label && layout === 'grid' ? '<div class="gui-view-h">' + escH(d.label) + '</div>' : '') + d.html + '</section>').join('')
      + '</div></div>';
  /* Tabs, as the pattern says: a tablist of buttons that each control one
     panel, the chosen one in the tab order and the rest reached by arrows. */
  const tabs = drawn.map((d, i) => '<button type="button" role="tab" class="gui-view-tab" id="' + id + '-t' + i + '" aria-controls="' + id + '-p' + i
      + '" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '" data-guitab="' + i + '">'
      + escH(d.label || T('Part {0}').replace('{0}', i + 1)) + '</button>').join('');
  const panels = drawn.map((d, i) => '<section role="tabpanel" class="gui-view-panel" id="' + id + '-p' + i + '" aria-labelledby="' + id + '-t' + i + '"'
      + (i === 0 ? '' : ' hidden') + '>' + d.html + '</section>').join('');
  return '<div class="gui-view gui-view-tabs">' + head + '<div role="tablist" class="gui-view-tablist"'
    + (spec.title ? ' aria-label="' + escH(String(spec.title).slice(0, 120)) + '"' : '') + '>' + tabs + '</div>' + panels + '</div>';
}

function _uiTabPick(tab, focus){
  const list = tab && tab.closest('[role="tablist"]'), view = list && list.parentNode;
  if(!view) return;
  list.querySelectorAll('[role="tab"]').forEach(t => {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    const panel = view.querySelector('#' + CSS.escape(t.getAttribute('aria-controls') || ''));
    if(panel) panel.hidden = !on;
  });
  if(focus) tab.focus();
}
document.addEventListener('click', e => {
  const tab = e.target && e.target.closest && e.target.closest('.gui-view-tab');
  if(tab) _uiTabPick(tab, false);
});
document.addEventListener('keydown', e => {
  const tab = e.target && e.target.closest && e.target.closest('.gui-view-tab');
  if(!tab) return;
  const all = [...tab.parentNode.querySelectorAll('[role="tab"]')], i = all.indexOf(tab);
  const rtl = getComputedStyle(tab).direction === 'rtl';
  const next = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
  let to = null;
  if(next) to = all[(i + next + all.length) % all.length];
  else if(e.key === 'Home') to = all[0];
  else if(e.key === 'End') to = all[all.length - 1];
  if(!to) return;
  e.preventDefault();
  _uiTabPick(to, true);
});
