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

/* WHAT SPENDING IS, BEFORE ANY NUMBER ABOUT IT.

   The screen opened on the plan panel, which answers a question somebody has
   not asked yet. "Spending" means two different things in this product - the
   subscription you pay AMV, and the money AMV may spend on your behalf - and
   until that is said, every figure below is ambiguous.

   Two sentences, one for each meaning, at the top. */
function _spvWhat() {
  return '<section class="spv-what">'
    + '<div class="spv-w-g">'
      + '<div class="spv-w-i"><div class="spv-w-t">' + escH(T('What you pay AMV')) + '</div>'
        + '<p>' + escH(T('Your plan, and how much of it you have used. This is the only thing AMV charges you for - there is nothing metered on top and no surprise bill.')) + '</p></div>'
      + '<div class="spv-w-i"><div class="spv-w-t">' + escH(T('What AMV may spend for you')) + '</div>'
        + '<p>' + escH(T('When a job you started needs something bought, this is what decides whether AMV may buy it and how much it may spend without asking. It is off until you turn it on.')) + '</p></div>'
    + '</div>'
  + '</section>';
}

/* Balance and the ceiling, side by side, because the useful question is not
   what either one is - it is which of them is smaller. */
function _spvMoneyFacts() {
  const c = (typeof AMVSpend !== 'undefined') ? AMVSpend.cfg() : null;
  const linked = (() => { try { return AMVFinance.linked(); } catch (e) { return false; } })();
  const cell = (big, small, cls) =>
    '<div class="spv-f' + (cls ? ' ' + cls : '') + '"><div class="spv-f-b">' + escH(big) + '</div>'
    + '<div class="spv-f-s">' + escH(small) + '</div></div>';
  const money = (n) => (typeof _mfMoney === 'function') ? _mfMoney(n) : ('$' + (+n || 0).toFixed(2));
  return '<div class="spv-facts spv-facts-m" id="spv-money-facts">'
    /* The balance is a live read from the bank, so it is not printed until it
       comes back. A number AMV made up here would be the single worst thing on
       this screen. */
    + cell(linked ? T('Reading\u2026') : T('Not linked'),
           linked ? T('balance across your accounts') : T('no account linked yet'), 'spv-f-bal')
    + cell(c ? money(c.monthlyCap) : '-', T('the most AMV may spend a month'))
    + cell(c ? money(AMVSpend.spentThisMonth()) : '-', T('spent this month'))
    + cell(c && c.enabled ? T('On') : T('Off'), T('AMV spending on your behalf'))
  + '</div>';
}

/* Filled in once the bank answers, or replaced with why it did not. */
async function _spvFillBalance() {
  const z = document.querySelector('#spv-money-facts .spv-f-bal');
  if (!z) return;
  let linked = false;
  try { linked = AMVFinance.linked(); } catch (e) {}
  if (!linked) return;
  const set = (big, small) => {
    const b = z.querySelector('.spv-f-b'), s = z.querySelector('.spv-f-s');
    if (b) b.textContent = big;
    if (s) s.textContent = small;
  };
  try {
    const d = await AMVFinance.accounts();
    const list = (d && d.accounts) || [];
    const total = list.reduce((n, a) => n + (Number(a && a.balance) || 0), 0);
    set((typeof _mfMoney === 'function') ? _mfMoney(total) : ('$' + total.toFixed(2)),
        list.length === 1 ? T('balance in your account')
                          : (list.length + ' ' + T('accounts, combined balance')));
  } catch (e) {
    /* Said as what it is. A balance that failed to load and a balance of zero
       are different facts, and only one of them is somebody's. */
    set(T('Could not read'), T('your balance did not come back just now'));
  }
}

function renderSpendView() {
  const vc = $('vc'); if (!vc) return;
  vc.innerHTML =
    '<div class="sv fi"><div class="vi spv">'
      + '<div class="spv-head">'
        + '<span class="eyebrow">' + escH(T('Spending')) + '</span>'
        + '<h2 class="spv-t">' + escH(T('Everywhere your money goes')) + '</h2>'
        + '<p class="spv-sub">' + escH(T('Two kinds of money live here, and they are not the same thing. Every limit on this page is checked on the server before anything happens.')) + '</p>'
      + '</div>'
      /* 1. WHAT IT IS. */
      + _spvWhat()
      /* 2. THE PLAN AND ITS LIMITS. */
      + '<section class="spv-sec">'
        + '<h2 class="set-title">' + escH(T('Your plan, and what it gives you')) + '</h2>'
        + _spvPlanNow()
        + (typeof _usageShapeBand === 'function' ? _usageShapeBand() : '')
      + '</section>'
      /* 3. THE MONEY AMV MAY SPEND: what is there, what the ceiling is. */
      + '<section class="spv-sec">'
        + '<h2 class="set-title">' + escH(T('Money AMV can spend for you')) + '</h2>'
        + '<div class="set-sub">' + escH(T('What is in the account it can see, and the most it may ever spend from it.')) + '</div>'
        + _spvMoneyFacts()
      + '</section>'
      /* The limits editor and the account card, which are the Settings panes
         themselves rather than a second copy of them. */
      + '<section class="spv-sec" id="spv-limits"></section>'
      + '<section class="spv-sec" id="spv-bank"></section>'
      /* 4. WHAT IT IS WATCHING FOR. */
      + (typeof watchlistHTML === 'function' ? watchlistHTML() : '')
      /* 5. AND ONLY THEN, THE UPGRADE.

         Last on purpose. Somebody who came here to check what AMV spent is
         not here to be sold to, and a plan grid above their own numbers reads
         as the page being about the sale. */
      + '<section class="spv-sec spv-plans">'
        + '<h2 class="set-title">' + escH(T('Upgrade your plan')) + '</h2>'
        + '<div class="set-sub">' + escH(T('The same engine on every paid plan. A bigger plan buys more of it, not a better one.')) + '</div>'
        + '<div class="pg pg-app pg-4">' + planCards(true) + '</div>'
        + _teamPlanBanner(true)
        + _customPlanBanner(true)
        + '<p class="px-note" style="display:none">' + escH(T('Prices are in US dollars. Your local-currency amount is an estimate for convenience - you are charged the same value wherever you are, so there are no cheaper prices by country.')) + '</p>'
        + '<div class="plans-compare-row"><button class="btn bs" id="spv-compare">'
          + escH(T('Compare all plans in detail')) + ' \u2192</button></div>'
      + '</section>'
    + '</div></div>';

  /* The real editors, not a second copy of them. Each is told how to redraw
     itself HERE - the default redraw is Settings, which on this screen would
     either navigate away or silently drop the server's answer. */
  try { _renderSpendingPane($('spv-limits'), renderSpendView); } catch (e) {}
  try { _renderInvestPane($('spv-bank')); } catch (e) {}
  try { wireWatchlist(renderSpendView); } catch (e) {}
  try { _spvFillBalance(); } catch (e) {}

  on($('spv-compare'), 'click', () => {
    try { openPlanCompare(loadStr('amv_plan') || 'pro'); } catch (e) {}
  });
  try { _localizePrices(document); } catch (e) {}
}
try { window.renderSpendView = renderSpendView; } catch (e) {}
