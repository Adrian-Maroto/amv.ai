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



/* Balance and the ceiling, side by side, because the useful question is not
   what either one is - it is which of them is smaller. */
function _spvMoneyFacts(){
  const c=AMVSpend.cfg(), cell=(value,label,cls)=>`<div class="spv-f ${cls}"><div class="spv-f-s">${escH(label)}</div><div class="spv-f-b">${escH(value)}</div></div>`;
  return '<div class="spv-facts spv-facts-m" id="spv-money-facts">'+
    cell('Checking','Bank connection','spv-f-bank')+cell('Checking','Monthly cap (USD)','spv-f-cap')+
    cell('Checking','Spent or reserved this month (USD)','spv-f-used')+cell('Checking','Auto-spending preference','spv-f-auto')+'</div>';
}
async function _spvFillBalance(){
  const host=$('spv-money-facts');if(!host)return;
  const set=(name,value)=>{const x=host.querySelector('.spv-f-'+name+' .spv-f-b');if(x)x.textContent=value;};
  try{const st=await AMVFinance.refresh();if(!st||st.ok!==true||st.stale)throw new Error('Unavailable');set('bank',st.linked?'Linked':'Not linked');}
  catch(e){set('bank','Not verified');}
  try{
    if(!AMVSpend.serverBacked())throw new Error('Not connected');
    await AMVSpend.pull();const c=AMVSpend.cfg();
    set('cap',_mfMoney(c.monthlyCap));set('used',_mfMoney(c.spent));set('auto',c.enabled?'On':'Off');
  }catch(e){set('cap','Not verified');set('used','Not verified');set('auto','Not verified');}
}
function renderSpendView(){
  const vc=$('vc');if(!vc)return;
  vc.innerHTML='<div class="sv fi"><div class="vi spv"><header class="spv-head"><span class="eyebrow">Your controls</span><h2 class="spv-t">Spending</h2><p class="spv-sub">Your account connection, budget and spending status in one place.</p></header>'+_spvMoneyFacts()+
    '<p class="product-note">A linked bank account provides data, not permission to pay. Browser checkout requires your completion. Reserved amounts are not settled purchases. Monthly limits use UTC.</p>'+
    '<section class="spv-sec" id="spv-limits"></section><details class="spv-bank-details"><summary>Manage linked financial account</summary><section class="spv-sec" id="spv-bank"></section></details></div></div>';
  _renderSpendingPane($('spv-limits'),renderSpendView);_renderInvestPane($('spv-bank'));_spvFillBalance();
}

/* THE PLANS, AND NOTHING ELSE.

   What Upgrade opens. Every plan, the one you are on marked, one tap to the
   plan's own detail and checkout - and the comparison for whoever wants it.
   Centred, because it is the one screen in AMV that is a choice between a few
   equal things laid side by side. */
function renderPlansView() {
  /* LAID OUT THE WAY THE PRODUCTS PEOPLE ALREADY PAY FOR LAY THEIRS OUT.

     Reported as "too much, so unorganized". The cards carried two badges, a
     superscript dollar sign, nine bold-studded bullets including the things a
     plan does NOT have, and the button at the very bottom - below the fold on
     a laptop, so the one action on the page was the last thing found.

     Now: four equal cards, each with its name, its price, one line about who
     it is for, the button straight under the price, then a short list of what
     it includes. The next step up from where somebody is gets the only filled
     button and a label saying where it sits on the ladder ("Start here" /
     "Next step up") - never "Most popular", which would be a claim about other
     customers. Team and Custom, which are not steps on the ladder, are two
     quiet rows underneath; the full comparison and how the limits work are
     one tap away rather than on the page. */
  const vc = $('vc'); if (!vc) return;
  const now = (typeof S !== 'undefined' && S.plan) ? S.plan : ((typeof loadStr === 'function' && loadStr('amv_plan')) || 'free');
  const nowName = (PLANS[now] && PLANS[now].name) || 'Free';
  const ladder = ['free', 'pro', 'elite', 'ultra'];
  const rank = k => ladder.indexOf(k);
  const nowR = rank(now);
  const lead = (nowR >= 0 && nowR < ladder.length - 1) ? ladder[nowR + 1] : '';
  const pitch = k => (typeof _planPitch === 'function' && _planPitch(k)) || { anchor: '', feats: [] };
  /* What the plan HAS, only - the comparison is where what it lacks is said. */
  const feats = k => pitch(k).feats.filter(f => f && f[0]).slice(0, 7)
    .map(f => '<li>' + String(f[1]).replace(/\ud83d[\udc00-\udfff]\s*/g, '') + '</li>').join('');
  const cta = k => {
    const P = PLANS[k] || { name: 'Free' };
    if (k === now) return '<button type="button" class="btn bs pl2-cta" disabled aria-disabled="true">' + escH(T('Your current plan')) + '</button>';
    /* Moving to Free is cancelling, and cancelling goes through Billing. */
    if (k === 'free') return '<button type="button" class="btn bs pl2-cta" data-gs="billing">' + escH(T('Manage in Billing')) + '</button>';
    const up = nowR < 0 || rank(k) > nowR;
    return '<button type="button" class="btn ' + (k === lead ? 'bp' : 'bs') + ' pl2-cta" data-dact="openUpgrade" data-darg="' + escH(k) + '">'
      + escH((up ? T('Get {plan}') : T('Switch to {plan}')).replace('{plan}', () => P.name)) + '</button>';
  };
  const card = k => {
    const P = PLANS[k] || { name: 'Free', price: 0 };
    const price = k === 'free' ? 0 : P.price;
    /* Three parts and always three - heading block, button, list - so the
       cards can share their rows and every button sits level. */
    return '<div class="pl2-card' + (k === lead ? ' lead' : '') + (k === now ? ' cur' : '') + '" data-plan="' + k + '">'
      + '<div class="pl2-top"><div class="pl2-name">' + escH(P.name || 'Free')
        + (k === lead ? '<span class="pl2-tag">' + escH(now === 'free' ? T('Start here') : T('Next step up')) + '</span>' : '')
      + '</div>'
      + '<div class="pl2-price"><span class="pl2-amt">$' + price + '</span><span class="pl2-per">' + escH(T('/ month')) + '</span></div>'
      /* Present on every card, empty on Free, so the cards share their rows. */
      + (k === 'free' ? '<div class="pl2-local"></div>' : '<div class="pl2-local px-local" data-usd="' + price + '" data-per="mo"></div>')
      + '<p class="pl2-line">' + (pitch(k).anchor || '') + '</p></div>'
      + cta(k)
      + '<ul class="pl2-feats">' + feats(k) + '</ul>'
    + '</div>';
  };
  const teamP = (PLANS.team && PLANS.team.price) || 20;
  vc.innerHTML =
    '<div class="sv fi"><div class="vi pl2">'
      + '<div class="pl2-head">'
        + '<h1 class="pl2-t">' + escH(now === 'free' ? T('Upgrade your plan') : T('Change your plan')) + '</h1>'
        /* What each step buys, as PLAN_TIERS and the server have it. It used to
           say every paid plan ran the same engine, which Pro does not: Apex
           starts at Elite. */
        + '<p class="pl2-sub">' + escH(T('You are on {plan}').replace('{plan}', () => nowName)) + '. '
          + escH(T('Pro unlocks AMV Forge. Elite and Ultra add AMV Apex, and each step up gives you more usage.')) + '</p>'
      + '</div>'
      + '<div class="pl2-grid">' + ladder.map(card).join('') + '</div>'
      + '<div class="pl2-more">'
        + '<button type="button" class="pl2-row" data-stab="team"><span class="pl2-row-t"><b>' + escH(T('Team')) + '</b> · $' + teamP + ' ' + escH(T('per person / month')) + '</span>'
          + '<span class="pl2-row-d">' + escH(T('One bill and a shared pool for everyone you work with')) + ' →</span></button>'
        + '<button type="button" class="pl2-row" data-dact="openCustomPlan"><span class="pl2-row-t"><b>' + escH(T('Custom')) + '</b> · ' + escH(T('from $10 / month')) + '</span>'
          + '<span class="pl2-row-d">' + escH(T('Pick an exact monthly budget, hard-capped')) + ' →</span></button>'
      + '</div>'
      + '<div class="pl2-foot"><button type="button" class="pl2-link" id="pln-compare">' + escH(T('Compare all plans in detail')) + '</button>'
        + '<p class="pl2-fine">' + escH(T('Prices in US dollars \u00b7 Cancel anytime \u00b7 Secure checkout')) + '</p></div>'
      + (typeof _usageShapeBand === 'function'
          ? '<details class="pl2-limits"><summary>' + escH(T('How usage limits work')) + '</summary>' + _usageShapeBand() + '</details>' : '')
      + '<p class="px-note" style="display:none">' + escH(T('Prices are in US dollars. Your local-currency amount is an estimate for convenience - you are charged the same value wherever you are, so there are no cheaper prices by country.')) + '</p>'
    + '</div></div>';
  on($('pln-compare'), 'click', () => {
    try { openPlanCompare(loadStr('amv_plan') || 'pro'); } catch (e) {}
  });
  try { _localizePrices(document); } catch (e) {}
}
try { window.renderPlansView = renderPlansView; } catch (e) {}
try { window.renderSpendView = renderSpendView; } catch (e) {}
