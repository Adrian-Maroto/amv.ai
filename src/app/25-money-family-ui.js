/* ============================================================
   SPENDING + FAMILY LINKS - the screens.

   AMVSpend, AMVFamily and AMVCompliance shipped as working logic with no
   way for anyone to reach them. Spending was enforced but not configurable;
   links could be created from chat but not seen, approved or revoked; and
   AMVCompliance.gate('spend') refuses every purchase until the user has
   accepted terms and confirmed their age, which there was no screen to do.
   That last one is a dead end: the product blocks you and offers no way out.

   Both panes are keyboard-operable and screen-reader labelled: every control
   has a real <label for>, the scope choices are a fieldset with a legend,
   results are announced through aria-live, and validation errors are tied to
   their input with aria-describedby rather than only turning something red.
   ============================================================ */

function _mfMoney(n){ return '$' + (+n || 0).toFixed(2); }
function _mfWhen(ts){
  try{ return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
  catch(e){ return ''; }
}
/* One place to say something happened, out loud for screen readers too. */
function _mfSay(id, msg, kind){
  const el = document.getElementById(id); if(!el) return;
  el.className = 'mf-say' + (kind ? ' ' + kind : '');
  el.textContent = msg || '';
}

/* ---------- SPENDING ---------- */
/* The limits shown here must be the ones the server will enforce, not the
   browser's copy of them. Pulled once per visit; the guard is on the REQUEST,
   not on the result, because the reply re-renders this pane and a result-only
   guard re-issues the fetch every redraw. */
let _SPEND_PULLED = false, _SPEND_BUSY = false;
/* WHO REDRAWS THIS PANE IS NOT ALWAYS SETTINGS.

   It called `renderSetPane()` in four places - after accepting terms, after
   saving a birth year, and after the server's real limits come back. That is
   correct while this only ever lives inside Settings, and wrong the moment it
   is also the money section of the Spending tab: a pull finishing there would
   have thrown the person into Settings, or redrawn a pane that is not on
   screen and quietly dropped the server's numbers.

   So the caller says how to redraw itself. Settings passes nothing and keeps
   the behaviour it had. */
/* The pane itself lives in spending.js (src/finance/spending.js), fetched the
   first time it is opened. */
let _spendingP = null;
function _spendingLoad(){
  if(typeof window._renderSpendingPaneNow === 'function') return Promise.resolve(true);
  if(!_spendingP) _spendingP = new Promise(res => {
    const sc = document.createElement('script');
    sc.src = 'spending.js';
    sc.onload = () => res(typeof window._renderSpendingPaneNow === 'function');
    sc.onerror = () => { _spendingP = null; sc.remove(); res(false); };
    document.head.appendChild(sc);
  });
  return _spendingP;
}
function _renderSpendingPane(pane, redraw){
  if(typeof window._renderSpendingPaneNow === 'function') return window._renderSpendingPaneNow(pane, redraw);
  if(!pane) return;
  pane.innerHTML = '<div style="color:var(--mu);font-size:var(--t-sm)">' + escH(T('Loading\u2026')) + '</div>';
  _spendingLoad().then(ok => {
    if(ok) window._renderSpendingPaneNow(pane, redraw);
    else pane.innerHTML = '<div style="color:var(--mu);font-size:var(--t-sm)">' + escH(T('That could not be loaded. Check your connection and try again.')) + '</div>';
  });
}
try{ window._renderSpendingPane = _renderSpendingPane; }catch(e){}

/* ---------- FAMILY ---------- */
/* ============================================================
   AMV-102  THE PARENT'S PANEL.

   The controls underneath are real and enforced - a monthly cap checked in the
   same backstop that protects the plan, buying refused at the purchase, taking
   money out refused at the withdrawal. This is the screen that lets a parent
   actually use them, written for a parent rather than for whoever built it.

   Two rules it follows throughout:

     - Say what is visible and what is not, before anything else. A parent
       deciding whether to add their child needs to know they will not be able
       to read their conversations, and the child needs to know it too. Both
       sentences come from the server, so neither can drift from what is
       enforced.
     - Every control is one the parent can act on and the child cannot. Nothing
       here is a suggestion.
   ============================================================ */
let _FAM_STATE = null;
/* Family invitations waiting for THIS account, from the server. null = not asked yet. */
let _FAM_PENDING = null;
/* In flight, as distinct from not yet asked. This pane makes TWO independent
   requests, and each one's reply re-renders - so a guard that only asks "is
   the state still null" re-issues the other request every time its sibling
   lands, and the count grows with each redraw. */
let _FAM_BUSY = false, _FAM_PEND_BUSY = false;
/* What was typed and what was last said, kept OUTSIDE the markup. The pane is
   redrawn whenever one of its two requests lands, and on a slow connection that
   can be after somebody pressed Send - which wiped the address and the answer,
   so they never learned whether the invitation went out. */
const _FAM_UI = { email: '', say: '' };

function _famRedraw(pane){
  const live = (pane && pane.isConnected) ? pane : document.querySelector('[data-fam-pane]');
  if(live) _renderFamilyPane(live);
}
/* The pane itself lives in family.js (src/finance/family.js), fetched the
   first time it is opened. */
let _familyP = null;
function _familyLoad(){
  if(typeof window._renderFamilyPaneNow === 'function') return Promise.resolve(true);
  if(!_familyP) _familyP = new Promise(res => {
    const sc = document.createElement('script');
    sc.src = 'family.js';
    sc.onload = () => res(typeof window._renderFamilyPaneNow === 'function');
    sc.onerror = () => { _familyP = null; sc.remove(); res(false); };
    document.head.appendChild(sc);
  });
  return _familyP;
}
function _renderFamilyPane(pane){
  if(typeof window._renderFamilyPaneNow === 'function') return window._renderFamilyPaneNow(pane);
  if(!pane) return;
  pane.innerHTML = '<div style="color:var(--mu);font-size:var(--t-sm)">' + escH(T('Loading\u2026')) + '</div>';
  _familyLoad().then(ok => {
    if(ok) window._renderFamilyPaneNow(pane);
    else pane.innerHTML = '<div style="color:var(--mu);font-size:var(--t-sm)">' + escH(T('That could not be loaded. Check your connection and try again.')) + '</div>';
  });
}
try{ window._renderFamilyPane = _renderFamilyPane; }catch(e){}
