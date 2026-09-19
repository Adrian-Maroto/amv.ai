/* ══════════════════════════════════════════════════════════════════════════
   PLACING A TRADE, WITH THE APPROVAL THAT ACTUALLY MEANS SOMETHING.

   Two steps, and the split is the point. Quote first: the server writes down
   the exact market, side and amount and hands back an id. Then the person
   reads those numbers - the ones the SERVER holds, echoed back from its own
   reply rather than the ones this page happens to remember - and confirms.
   Executing sends the id and nothing else.

   So this screen cannot place a trade of its own devising, and neither can
   anything driving it. That matters more here than it looks: the model can
   drive a browser, so a confirmation dialog rendered in a page is a
   confirmation the model can click. What it cannot do is produce a quote id
   the server issued for terms a person has seen.

   The numbers on the button come from the quote response. If this page showed
   what was typed instead, the two could differ and the approval would be for
   a trade nobody read.
   ══════════════════════════════════════════════════════════════════════════ */

let _PQ = null;        // the quote awaiting confirmation, as the server described it

function _pmMoney(n) { return '$' + (Math.round(Number(n) * 100) / 100).toFixed(2); }

async function openPredictionMarkets() {
  if (!_ovOpenLoading('pm', 'Prediction markets', 'Trade on an outcome')) return;
  _PQ = null;

  let d = null;
  try { d = await AMV_API.predictMarkets(); } catch (e) { d = null; }
  const b = $('pm-body'); if (!b) return;
  if (!d) { b.innerHTML = '<div class="ml-err">' + escH(T('Could not reach AMV just now.')) + '</div>'; return; }

  /* Not available where somebody is, said as that rather than as an empty
     screen. Which venue may serve them is a legal question, not a preference,
     so it is answered plainly. */
  if (!d.venues || !d.venues.length) {
    b.innerHTML = '<p class="mu">' + escH(d.note || T('Prediction markets are not available in your country.')) + '</p>';
    return;
  }
  const ready = d.venues.filter(v => v.ready);
  if (!ready.length) {
    b.innerHTML = '<p class="mu">' + escH(T('No prediction venue is connected on this deployment yet, so no trade can be placed. Nothing is attempted.')) + '</p>';
    return;
  }

  b.innerHTML =
    '<p class="mu pm-intro">' + escH(T('AMV shows you the exact trade and places it only after you confirm those numbers. It will not place more than'))
      + ' ' + escH(_pmMoney(d.caps.perTrade)) + ' ' + escH(T('on one trade or')) + ' ' + escH(_pmMoney(d.caps.perDay)) + ' '
      + escH(T('in a day - those are fixed limits, not settings.')) + '</p>'
    + '<label class="ml-f"><span>' + escH(T('Venue')) + '</span><select id="pm-venue">'
      + ready.map(v => '<option value="' + escH(v.id) + '">' + escH(v.name) + '</option>').join('')
    + '</select></label>'
    + '<label class="ml-f"><span>' + escH(T('Market')) + '</span>'
      + '<input id="pm-market" type="text" autocomplete="off" maxlength="120" placeholder="' + escH(T('The market identifier')) + '"></label>'
    + '<label class="ml-f"><span>' + escH(T('Side')) + '</span><select id="pm-side">'
      + '<option value="yes">' + escH(T('Yes')) + '</option><option value="no">' + escH(T('No')) + '</option></select></label>'
    + '<label class="ml-f"><span>' + escH(T('Amount')) + '</span>'
      + '<input id="pm-usd" type="number" min="1" step="1" max="' + escH(String(d.caps.perTrade)) + '" placeholder="10"></label>'
    + '<button class="btn bs" id="pm-quote">' + escH(T('Check this trade')) + '</button>'
    + '<div class="pm-confirm" id="pm-confirm" hidden></div>'
    + '<div class="fam-say" id="pm-say" role="status" aria-live="polite"></div>';

  const say = (t, cls) => { const el = $('pm-say'); if (el) { el.textContent = t || ''; el.className = 'fam-say' + (cls ? ' ' + cls : ''); } };

  on($('pm-quote'), 'click', async () => {
    const venue = ($('pm-venue') || {}).value || '';
    const market = (($('pm-market') || {}).value || '').trim();
    const side = ($('pm-side') || {}).value || 'yes';
    const usd = Number(($('pm-usd') || {}).value || 0);
    say('');
    const z = $('pm-confirm'); if (z) { z.hidden = true; z.innerHTML = ''; }
    _PQ = null;
    try {
      const q = await AMV_API.predictQuote(venue, market, side, usd);
      _PQ = q.quote;
      if (!z) return;
      /* EVERY NUMBER HERE COMES FROM THE SERVER'S REPLY.

         Showing what was typed would let the two drift, and then somebody
         approves a trade that is not the one the server is holding. */
      z.hidden = false;
      z.innerHTML =
        '<div class="pm-c-t">' + escH(T('Confirm this trade')) + '</div>'
        + '<dl class="pm-c-d">'
          + '<dt>' + escH(T('Venue')) + '</dt><dd>' + escH(q.quote.venueName) + '</dd>'
          + '<dt>' + escH(T('Market')) + '</dt><dd>' + escH(q.quote.market) + '</dd>'
          + '<dt>' + escH(T('Side')) + '</dt><dd>' + escH(q.quote.side === 'yes' ? T('Yes') : T('No')) + '</dd>'
          + '<dt>' + escH(T('Amount')) + '</dt><dd>' + escH(_pmMoney(q.quote.usd)) + '</dd>'
        + '</dl>'
        + '<p class="pm-c-w">' + escH(T('This spends real money and cannot be undone. The approval lasts one minute.')) + '</p>'
        + '<button class="btn bp" id="pm-go">' + escH(T('Place this trade')) + '</button>';
      on($('pm-go'), 'click', async () => {
        const go = $('pm-go'); if (go) { go.disabled = true; go.textContent = T('Placing…'); }
        try {
          /* The id alone. Resending the terms would invite a caller to change
             what was approved - and the server ignores them regardless. */
          const res = await AMV_API.predictTrade(_PQ.id);
          z.hidden = true; z.innerHTML = ''; _PQ = null;
          say(T('Placed:') + ' ' + res.placed.side + ' ' + _pmMoney(res.placed.usd) + ' · ' + res.placed.market, 'ok');
        } catch (e) {
          if (go) { go.disabled = false; go.textContent = T('Place this trade'); }
          /* A venue that did not answer is NOT reported as nothing happening -
             the request may have arrived, and the wrong reassurance here makes
             somebody trade twice. */
          say((e && e.message) || T('That trade could not be placed.'), 'err');
        }
      });
    } catch (e) { say((e && e.message) || T('That trade could not be checked.'), 'err'); }
  });
}
try { window.openPredictionMarkets = openPredictionMarkets; } catch (e) {}
