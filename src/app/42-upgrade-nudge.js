/* ============================================================
   NOW AND THEN, THE NEXT ENGINE UP
   ============================================================
   Asked for: "add this from time to time" - a centred card offering the next
   plan by the engine it unlocks, Monthly or Yearly, one button, See all plans
   and Not now.

   "From time to time" is the whole design, because an upgrade prompt that is
   not rationed is the reason people leave. So it appears:
     - only to a signed-in person on Free (offered Pro, for AMV Forge) or Pro
       (offered Elite, for AMV Apex) - never above that, never to the owner;
     - only after they have had real answers (UPN_AFTER_ANSWERS), so the first
       thing AMV does for somebody is not ask for money;
     - only right after an answer has landed, on the chat screen, with nothing
       else open and nothing running - never over their work;
     - at most once a week, and two weeks after a "Not now", and never again
       after UPN_MAX showings.
   Every figure on it comes from the same tables as the plans page, and the
   yearly price is the processor's to state, as everywhere else. */
const UPN_AFTER_ANSWERS = 6;
const UPN_EVERY_MS  = 7 * 864e5;
const UPN_SNOOZE_MS = 14 * 864e5;
const UPN_MAX = 6;

function _upnOffer(){
  const plan = loadStr('amv_plan') || 'free';
  if(plan === 'free') return { plan: 'pro', engine: 'coding' };
  if(plan === 'pro')  return { plan: 'elite', engine: 'smart' };
  return null;
}
function _upnPoints(to){
  const n = (x) => Number(x).toLocaleString();
  if(to === 'pro') return [
    'AMV Forge - built for hard coding and long, careful work',
    n(PLAN_MONTH_MESSAGES.pro) + ' messages a month, up from ' + n(PLAN_MONTH_MESSAGES.free),
    'Up to ' + AUTO_MAX_BY_PLAN.pro + ' Crew jobs running on a schedule',
    'Autonomous agents and the app sandbox',
  ];
  return [
    'AMV Apex - the most capable engine AMV has',
    n(PLAN_MONTH_MESSAGES.elite) + ' messages a month, up from ' + n(PLAN_MONTH_MESSAGES.pro),
    'Up to ' + AUTO_MAX_BY_PLAN.elite + ' Crew jobs running on a schedule',
    'Ship real apps to a live address',
  ];
}

function _upnDue(){
  try{
    if(!(S.user && S.user.email)) return false;
    if(typeof isAdmin === 'function' && isAdmin()) return false;
    if(!_upnOffer()) return false;
    if(S.busy || S.tab !== 'chat' || document.hidden) return false;
    if(document.querySelector('#ovr.on, #ovr > *, #set-modal, #done-ask')) return false;
    const answers = +(loadStr('amv_upn_answers') || 0);
    const shown = +(loadStr('amv_upn_shown') || 0);
    const next = +(loadStr('amv_upn_next') || 0);
    return answers >= UPN_AFTER_ANSWERS && shown < UPN_MAX && Date.now() >= next;
  }catch(e){ return false; }
}

/* Called when an answer has landed (the chat turn wrapper in 05-ui-blocks). */
function _upnAnswered(){
  try{ saveStr('amv_upn_answers', String(+(loadStr('amv_upn_answers') || 0) + 1)); }catch(e){}
  if(_upnDue()) setTimeout(() => { if(_upnDue()) openUpgradeNudge(); }, 1500);
}

function openUpgradeNudge(){
  const o = _upnOffer(); if(!o) return;
  const r = $('ovr'); if(!r) return;
  const P = PLANS[o.plan], eng = MODELS[o.engine];
  const yearly = loadStr('amv_upn_cycle') === 'year';
  try{
    saveStr('amv_upn_shown', String(+(loadStr('amv_upn_shown') || 0) + 1));
    saveStr('amv_upn_next', String(Date.now() + UPN_EVERY_MS));
  }catch(e){}
  try{ track('upgrade_nudge_shown', { plan: o.plan }); }catch(e){}
  const ck = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  r.innerHTML = '<div class="ov upn-bg" id="upn-bg"><div class="upn" role="dialog" aria-modal="true" aria-labelledby="upn-h">' +
    '<button type="button" class="upn-x" id="upn-x" aria-label="Close">✕</button>' +
    '<h2 class="upn-h" id="upn-h">Use ' + escH(eng.label) + ' with AMV ' + escH(P.name) + '</h2>' +
    '<ul class="upn-pts">' + _upnPoints(o.plan).map(t => '<li>' + ck + '<span>' + escH(t) + '</span></li>').join('') + '</ul>' +
    '<div class="upn-cyc" role="group" aria-label="Billing">' +
      '<button type="button" class="upn-c' + (yearly ? '' : ' on') + '" data-upn-cycle="month" aria-pressed="' + (!yearly) + '">Monthly</button>' +
      '<button type="button" class="upn-c' + (yearly ? ' on' : '') + '" data-upn-cycle="year" aria-pressed="' + yearly + '">Yearly</button>' +
    '</div>' +
    '<button type="button" class="btn bp upn-go" id="upn-go"></button>' +
    '<div class="upn-links"><button type="button" class="upn-l" id="upn-all">See all plans</button><span aria-hidden="true">·</span>' +
      '<button type="button" class="upn-l" id="upn-later">Not now</button></div>' +
    '<p class="upn-fine">Prices and plans may change; you always see the price before you pay, and can cancel any time.</p>' +
  '</div></div>';
  r.classList.add('on');
  const cycle = () => loadStr('amv_upn_cycle') === 'year' ? 'year' : 'month';
  const paint = () => {
    const b = $('upn-go'); if(!b) return;
    b.textContent = cycle() === 'year'
      ? 'Upgrade to ' + P.name + ', billed yearly'
      : 'Upgrade to ' + P.name + ' for $' + P.price + '/month';
  };
  paint();
  const esc = (e) => { if(e.key === 'Escape'){ e.stopPropagation(); close(); } };
  const close = () => { document.removeEventListener('keydown', esc, true); if($('upn-bg')) closeOvr(); };
  document.addEventListener('keydown', esc, true);
  r.querySelectorAll('[data-upn-cycle]').forEach(b => on(b, 'click', () => {
    try{ saveStr('amv_upn_cycle', b.dataset.upnCycle === 'year' ? 'year' : 'month'); }catch(e){}
    r.querySelectorAll('[data-upn-cycle]').forEach(x => { const onIt = x === b; x.classList.toggle('on', onIt); x.setAttribute('aria-pressed', String(onIt)); });
    paint();
  }));
  on($('upn-x'), 'click', close);
  on($('upn-later'), 'click', () => { try{ saveStr('amv_upn_next', String(Date.now() + UPN_SNOOZE_MS)); }catch(e){} close(); });
  on($('upn-all'), 'click', () => { close(); setTab('plans'); });
  on($('upn-go'), 'click', () => {
    const c = cycle();
    document.removeEventListener('keydown', esc, true);
    try{ track('upgrade_nudge_clicked', { plan: o.plan, cycle: c }); }catch(e){}
    openCheckout(o.plan, undefined, c);
  });
  try{ $('upn-go').focus({ preventScroll: true }); }catch(e){}
}
try{ window.openUpgradeNudge = openUpgradeNudge; window._upnAnswered = _upnAnswered; }catch(e){}
