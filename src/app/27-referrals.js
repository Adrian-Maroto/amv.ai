/* ============================================================
   INVITE - the referral screen, and the code capture that feeds it.

   The server owns every decision that matters here (who owns a code, whether
   an invite ever converts, how much capacity it is worth). This file does two
   small honest things: it remembers a code someone arrived with so the signup
   request can carry it, and it shows the account its own link and what that
   link has actually earned.

   Two deliberate refusals:
   - It NEVER counts a reward locally. The number on screen is the server's
     number or it is absent; a client-side tally would be a promise the ledger
     might not keep.
   - It NEVER claims the invite paid out at signup. The copy says what the
     rules are - real use, one day, then the reward - because that IS the rule,
     and a user who is told otherwise has been lied to.
   ============================================================ */

const REF_STORE_KEY = 'amv_ref_code';

/* Capture ?ref= on arrival and take it straight out of the address bar. The
   code is not a secret, but leaving it in the URL means it rides along in every
   shared link and screenshot from then on, quietly re-attributing other
   people's signups to whoever's link was opened first. */
function _refCapture(){
  try{
    const q = new URLSearchParams(location.search || '');
    const raw = q.get('ref'); if(!raw) return;
    const code = String(raw).toUpperCase().replace(/[^0-9A-Z]/g,'').slice(0,12);
    if(code) saveStr(REF_STORE_KEY, code);
    q.delete('ref');
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + (location.hash || ''));
  }catch(e){ /* a malformed URL must never stop the app booting */ }
}
try{ _refCapture(); }catch(e){}

/* The stored code, if any. Consumed at signup and then forgotten - it applies
   to the account being created, not to every account created on this device. */
function _refPending(){ try{ return loadStr(REF_STORE_KEY) || ''; }catch(e){ return ''; } }
function _refClear(){ try{ saveStr(REF_STORE_KEY, ''); }catch(e){} }

function _refTokens(n){
  n = +n || 0;
  return n >= 1000 ? Math.round(n/1000) + 'k' : String(n);
}
function _refWhen(ts){
  try{ return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
  catch(e){ return ''; }
}

/* ---------- INVITE PANE ---------- */
function _renderInvitePane(pane){
  pane.innerHTML =
    '<h2 class="set-title">Invite</h2>'+
    '<div class="set-sub">Share AMV. When someone you invite actually uses it, you both get extra monthly capacity.</div>'+
    '<div class="ss2" id="ref-body"><div class="ref-load">Loading your invite link…</div></div>';

  const body = document.getElementById('ref-body');
  if(!(window.AMV_API && AMV_API.live)){
    body.innerHTML = '<div class="ref-off">Invites need an AMV account on the server. '+
      'Sign in and this page will show your link.</div>';
    return;
  }
  AMV_API.referral().then(d=>{
    if(!d || !d.ok){ body.innerHTML = '<div class="ref-off">Your invite link is unavailable right now. Please try again shortly.</div>'; return; }
    _refPaint(body, d);
  }).catch(()=>{
    body.innerHTML = '<div class="ref-off">Could not reach the server. Your invite link will appear when you are back online.</div>';
  });
}

function _refPaint(body, d){
  const link = d.link || '';
  const code = d.code || '';
  const earned = (d.rewards || []).length;
  const per = _refTokens(d.perReferral);
  const max = +d.max || 0;

  if(!code){
    body.innerHTML = '<div class="ref-off">Your invite link is not available on this account yet. It appears once your account is fully set up.</div>';
    return;
  }

  const rows = (d.rewards || []).slice().reverse().map(r =>
    '<div class="ref-row"><span>'+ (r.kind === 'joined' ? 'Joined through an invite' : 'Someone you invited started using AMV') +'</span>'+
    '<span class="ref-row-v">+'+ _refTokens(r.tokens) +' tokens<span class="ref-exp">until '+ escH(_refWhen(r.expiresAt)) +'</span></span></div>'
  ).join('');

  body.innerHTML =
    '<h3>Your link</h3>'+
    '<div class="ref-linkrow">'+
      '<label class="sr-only" for="ref-link">Your invite link</label>'+
      '<input id="ref-link" class="ref-link" readonly value="'+ escH(link || code) +'">'+
      '<button class="btn bs" id="ref-copy" type="button">Copy</button>'+
      (navigator.share ? '<button class="btn bs" id="ref-share" type="button">Share</button>' : '')+
    '</div>'+
    '<div class="ref-say" id="ref-say" role="status" aria-live="polite"></div>'+
    '<div class="ref-note">'+
      'Both of you get <b>'+ escH(per) +' extra tokens a month</b> once they have used AMV for real - at least '+
      escH(_refTokens(d.qualifyTokens)) +' tokens and '+ escH(String(d.minAgeHours || 24)) +' hours after signing up. '+
      'That wait is on purpose: it is what stops invite links being farmed, and it is why the reward is worth giving.'+
    '</div>'+
    '<div class="ref-stats">'+
      '<div class="ref-stat"><div class="ref-stat-n">'+ earned +' / '+ max +'</div><div class="ref-stat-l">Active rewards</div></div>'+
      '<div class="ref-stat"><div class="ref-stat-n">+'+ _refTokens(d.bonusTokens) +'</div><div class="ref-stat-l">Extra tokens this month</div></div>'+
      '<div class="ref-stat"><div class="ref-stat-n">'+ (+d.windowDays || 90) +' days</div><div class="ref-stat-l">Each reward lasts</div></div>'+
    '</div>'+
    (rows ? '<h3 style="margin-top:18px">Rewards</h3><div class="ref-rows">'+rows+'</div>'
          : '<div class="ref-empty">No rewards yet. Nothing is counted until an invited account genuinely uses AMV.</div>')+
    (earned >= max && max ? '<div class="ref-cap">You are holding the maximum '+max+' rewards. As older ones expire, new invites can earn again.</div>' : '')+
    '<div class="ref-fine">Rewards are extra capacity, never money or a plan change. Invites from your own devices do not count.</div>';

  const say = (m)=>{ const el = document.getElementById('ref-say'); if(el) el.textContent = m; };
  on(document.getElementById('ref-copy'),'click',async ()=>{
    const val = link || code;
    try{
      await navigator.clipboard.writeText(val);
      say('Link copied.');
      toast('Invite link copied','success',2000);
    }catch(e){
      // Clipboard is blocked in plenty of real browsers. Select the text so it
      // can still be copied by hand rather than pretending it worked.
      const f = document.getElementById('ref-link');
      if(f){ f.focus(); f.select(); }
      say('Copy was blocked by your browser - the link is selected, press Ctrl+C or Cmd+C.');
    }
  });
  on(document.getElementById('ref-share'),'click',()=>{
    try{ navigator.share({ title:'AMV', text:'I use AMV - here is my invite link.', url: link || undefined }); }catch(e){}
  });
}
try{ window._renderInvitePane = _renderInvitePane; }catch(e){}
try{ window._refPending = _refPending; window._refClear = _refClear; }catch(e){}
