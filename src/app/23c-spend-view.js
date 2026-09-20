/* ══════════════════════════════════════════════════════════════════════════
   SPENDING - EVERY WAY MONEY MOVES, ON ONE SCREEN.

   It was in four places and none of them was the obvious one. What a plan
   costs was on Pricing. What the plan buys you was on Plan & usage. What AMV
   may spend on your behalf was a Settings pane three levels down. Whether a
   bank was connected at all was a different Settings pane beside it. Money is
   the thing people most want a single answer about, and AMV made them assemble
   it from four screens that did not reference each other.

   So this is the money section, and the rail entry that used to say Pricing
   says Spending. Prices come with it rather than staying behind: a plan's
   price and a plan's limits are the same decision, and splitting them is what
   produced a Pricing page that could disagree with the thing enforcing it.

   COMPOSED, NOT COPIED. The limits editor and the bank-link card are the exact
   panes Settings renders, called here with a redraw of their own. Re-typing
   either would have produced a second copy of the most consequential controls
   in the product, and the two would have drifted - which is the defect this
   screen was just built out of.
   ══════════════════════════════════════════════════════════════════════════ */

function _spvPlanNow() {
  const plan = (typeof loadStr === 'function' && loadStr('amv_plan')) || 'free';
  const P = (typeof PLANS !== 'undefined' && PLANS[plan]) || null;
  const name = P ? P.name : 'Free';
  const price = P ? P.price : 0;
  const cell = (big, small) =>
    '<div class="spv-f"><div class="spv-f-b">' + escH(big) + '</div>'
    + '<div class="spv-f-s">' + escH(small) + '</div></div>';
  return '<section class="spv-now">'
    + '<div class="spv-now-h">'
      + '<div><div class="spv-now-l">' + escH(T('Your plan')) + '</div>'
        + '<div class="spv-now-p">' + escH(name)
          + (price ? ' <span class="spv-now-x">$' + escH(String(price)) + '/mo</span>' : '')
        + '</div></div>'
      + '<button type="button" class="btn bs spv-manage" data-gs="billing">'
        + escH(T('Manage billing')) + '</button>'
    + '</div>'
    /* The three numbers the server actually refuses on, for the plan somebody
       is on right now - not for the plan the page would like to sell them. */
    + '<div class="spv-facts">'
      + cell(_msgMonthLabel(plan), T('messages a month'))
      + cell(_msg5hLabel(plan), T('every') + ' ' + USAGE_WINDOW_HOURS + ' ' + T('hours'))
      + cell(_topWeekLabel(plan), T('top-engine messages a week'))
      + cell(_rpmForPlan(plan) + '', T('requests a minute'))
    + '</div>'
  + '</section>';
}

function renderSpendView() {
  const vc = $('vc'); if (!vc) return;
  vc.innerHTML =
    '<div class="sv fi"><div class="vi spv">'
      + '<div class="spv-head">'
        + '<span class="eyebrow">' + escH(T('Spending')) + '</span>'
        + '<h2 class="spv-t">' + escH(T('Everywhere your money goes')) + '</h2>'
        + '<p class="spv-sub">' + escH(T('What you pay, what that buys, what AMV may spend for you, and the accounts it is allowed to see. Every limit here is checked on the server before anything happens.')) + '</p>'
      + '</div>'
      + _spvPlanNow()
      /* How the limit behaves, before somebody meets it. Same band the plans
         carry, for the same reason: a ceiling with no shape reads as a cliff. */
      + (typeof _usageShapeBand === 'function' ? _usageShapeBand() : '')
      + '<section class="spv-sec" id="spv-limits"></section>'
      + '<section class="spv-sec" id="spv-bank"></section>'
      + '<section class="spv-sec spv-plans">'
        + '<h2 class="set-title">' + escH(T('Plans')) + '</h2>'
        + '<div class="set-sub">' + escH(T('The same engine on every paid plan. A bigger plan buys more of it, not a better one.')) + '</div>'
        + '<div class="pg pg-app pg-4">' + planCards(true) + '</div>'
        + _teamPlanBanner(true)
        + _customPlanBanner(true)
        + '<p class="px-note" style="display:none">' + escH(T('Prices are in US dollars. Your local-currency amount is an estimate for convenience - you are charged the same value wherever you are, so there are no cheaper prices by country.')) + '</p>'
        + '<div class="plans-compare-row"><button class="btn bs" id="spv-compare">'
          + escH(T('Compare all plans in detail')) + ' →</button></div>'
      + '</section>'
    + '</div></div>';

  /* The real editors, not a second copy of them. Each is told how to redraw
     itself HERE - the default redraw is Settings, which on this screen would
     either navigate away or silently drop the server's answer. */
  try { _renderSpendingPane($('spv-limits'), renderSpendView); } catch (e) {}
  try { _renderInvestPane($('spv-bank')); } catch (e) {}

  on($('spv-compare'), 'click', () => {
    try { openPlanCompare(loadStr('amv_plan') || 'pro'); } catch (e) {}
  });
  try { _localizePrices(document); } catch (e) {}
}
try { window.renderSpendView = renderSpendView; } catch (e) {}
