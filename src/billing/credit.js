/* Extra usage - the packs somebody buys when their plan runs out. Fetched the
   first time it is opened (_creditOpen in 09-checkout-plans.js): it is only
   ever needed at the moment a limit is reached, or from Billing. A classic
   script, so it uses the page's own helpers ($, escH, on, toast, AMV_API).

   The server decides everything that matters: whether this account may buy,
   whether card payments are on, and - only after Stripe confirms the money -
   the balance. This screen shows what it says and hands over to Stripe. */
async function _creditPicker(){
  const r = $('ovr'); if(!r) return;
  r.innerHTML = '<div class="ov" id="cr-bg"><div class="ob cr-ob" role="dialog" aria-modal="true" aria-labelledby="cr-h">'
    + '<button class="oc" data-dact="closeOvr" aria-label="Close">×</button>'
    + '<h2 id="cr-h">Extra usage</h2>'
    + '<p class="ob-sub">Keep going when your plan’s limit is reached. It is used only after your plan’s own allowance, and never expires.</p>'
    + '<div id="cr-body"><p class="cr-say">Loading…</p></div></div></div>';
  try{ r.classList.add('on'); }catch(e){}
  let d = null;
  try{ const res = await AMV_API._fetch('/v1/credit', { method: 'GET', timeout: 10000 }); d = await res.json(); }catch(e){}
  const body = $('cr-body'); if(!body) return;
  if(!d || d.ok !== true){ body.innerHTML = '<p class="cr-say">Extra usage could not be loaded. Check your connection and try again.</p>'; return; }
  const bal = '<p class="cr-bal">Balance: <b>$' + escH((+d.balance || 0).toFixed(2)) + '</b></p>';
  if(!d.available){ body.innerHTML = bal + '<p class="cr-say">Card payments are not switched on here yet, so extra usage cannot be bought.</p>'; return; }
  if(!d.eligible){
    body.innerHTML = bal + '<p class="cr-say">Extra usage comes with a paid plan. Upgrade first, then add more whenever you run out.</p>'
      + '<button type="button" class="btn bp" id="cr-plans">See plans</button>';
    const b = $('cr-plans'); if(b) on(b, 'click', () => { try{ closeOvr(); setTab('plans'); }catch(e){} });
    return;
  }
  body.innerHTML = bal
    + _creditModeHTML(d.mode)
    + '<div class="cr-packs" role="group" aria-label="Packs">'
    + (d.packs || []).map(p => '<button type="button" class="cr-pack" data-cr-usd="' + escH(String(+p || 0)) + '"><b>$' + escH(String(+p || 0)) + '</b><span>one time</span></button>').join('')
    + '</div>'
    + '<p class="cr-say">Paid securely by card on the next page. Messages past your plan come off this balance at what they cost to run, plus AMV’s margin - the same terms as your plan.</p>'
    + '<p class="cr-say" id="cr-msg" role="status" aria-live="polite"></p>';
  _creditModeWire(body);
  body.querySelectorAll('[data-cr-usd]').forEach(b => on(b, 'click', async () => {
    const say = (t) => { const m = $('cr-msg'); if(m) m.textContent = t; };
    body.querySelectorAll('[data-cr-usd]').forEach(x => { x.disabled = true; });
    say('Opening the payment page…');
    try{
      const res = await AMV_API._fetch('/v1/credit/checkout', { method: 'POST', body: JSON.stringify({ usd: +b.dataset.crUsd }) });
      const out = await res.json().catch(() => ({}));
      let u = null; try{ u = new URL(out.url); }catch(e){}
      if(!res.ok || !u || u.protocol !== 'https:') throw new Error(out.error || 'The payment page could not be opened.');
      location.assign(u.toString());
    }catch(e){
      say(e.message || 'The payment page could not be opened.');
      body.querySelectorAll('[data-cr-usd]').forEach(x => { x.disabled = false; });
    }
  }));
}
/* WHEN THE PLAN RUNS OUT: keep going on credit, ask first, or never. Saved
   on the server and shown as the server read it back, so the choice on
   screen is the one that applies. */
const _CREDIT_MODE_TXT = {
  auto: ['Keep going automatically', 'Messages past your plan come off your balance without asking.'],
  ask:  ['Ask me first', 'AMV asks before the first message paid from your balance, each time your plan runs out.'],
  stop: ['Never use it', 'Your plan\u2019s limit is the limit. Your balance stays untouched until you change this.'],
};
function _creditModeHTML(mode){
  const cur = _CREDIT_MODE_TXT[mode] ? mode : 'auto';
  return '<fieldset class="cr-mode"><legend>' + escH(T('When your plan runs out')) + '</legend>'
    + Object.keys(_CREDIT_MODE_TXT).map(k => '<label class="cr-mode-opt"><input type="radio" name="cr-mode" value="' + k + '"' + (k === cur ? ' checked' : '') + '>'
      + '<span><b>' + escH(T(_CREDIT_MODE_TXT[k][0])) + '</b><span>' + escH(T(_CREDIT_MODE_TXT[k][1])) + '</span></span></label>').join('')
    + '<p class="cr-say" id="cr-mode-msg" role="status" aria-live="polite"></p></fieldset>';
}
function _creditModeWire(body){
  body.querySelectorAll('input[name="cr-mode"]').forEach(inp => on(inp, 'change', async () => {
    const say = (t) => { const m = $('cr-mode-msg'); if(m) m.textContent = t; };
    const all = body.querySelectorAll('input[name="cr-mode"]');
    all.forEach(x => { x.disabled = true; });
    say(T('Saving\u2026'));
    let back = null;
    try{
      const res = await AMV_API._fetch('/v1/credit/mode', { method: 'POST', body: JSON.stringify({ mode: inp.value }) });
      const out = await res.json().catch(() => ({}));
      if(!res.ok || !out.ok) throw new Error(out.error || T('That setting could not be saved. Nothing changed - try again.'));
      back = out.mode;
      say(T('Saved.'));
    }catch(e){ say(e.message); }
    /* Whatever the server holds is what is checked - a failed save puts the
       old choice back rather than showing one that does not apply. */
    if(back){ all.forEach(x => { x.checked = x.value === back; }); }
    else { try{ const r = await AMV_API._fetch('/v1/credit', { method: 'GET', timeout: 10000 }); const d = await r.json(); all.forEach(x => { x.checked = x.value === (d.mode || 'auto'); }); }catch(e){} }
    all.forEach(x => { x.disabled = false; });
  }));
}
window._creditPicker = _creditPicker;
