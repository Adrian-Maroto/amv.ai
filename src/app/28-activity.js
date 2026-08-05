/* ============================================================
   ACCOUNT ACTIVITY - the Security screen, reading something real.

   What was there before was a single hardcoded row: "This browser - Active
   now", with a green Active badge, wired to nothing. It could not have shown a
   second session, a sign-in from another country, or a run of failed password
   attempts, because it never asked. Someone whose password had leaked would
   have looked at that screen and been reassured by a picture.

   This reads the account's real event log from the server and shows it, with
   the one action that matters when something on it looks wrong: end every
   session on the account, right now.
   ============================================================ */

/* Every kind the server can record, in the user's language. An unknown kind is
   shown as itself rather than hidden - a log that quietly drops events it does
   not recognise is worse than one that shows a raw word. */
const ACT_LABEL = {
  signed_in:              ['Signed in', ''],
  sign_in_failed:         ['Failed sign-in attempt', 'warn'],
  signed_out:             ['Signed out of a device', ''],
  signed_out_everywhere:  ['Signed out of all devices', 'warn'],
  account_created:        ['Account created', ''],
  password_changed:       ['Password changed', 'warn'],
  plan_changed:           ['Plan changed', ''],
  /* The rest of what the server actually records. These were absent, so they
     fell through to the raw-word fallback and rendered as ordinary, untoned
     rows - and they are precisely the events somebody checks this screen to
     find. If an account is taken over, the attacker connects a bank, mints a
     key to keep access after a password change, or attaches the account to a
     "family" they control. Each of those is marked. */
  finance_linked:         ['A bank account was linked', 'warn'],
  finance_unlinked:       ['A bank account was disconnected', 'warn'],
  api_key_created:        ['An API key was created', 'warn'],
  api_key_revoked:        ['An API key was revoked', ''],
  family_joined:          ['This account joined a family', 'warn'],
  family_left:            ['This account left a family', ''],
  family_member_left:     ['Someone left your family', ''],
  family_limits_changed:  ['Family spending limits changed', 'warn'],
  team_left:              ['Left a team', ''],
  /* Raising a spending limit is the quiet half of taking money out: the
     withdrawal is loud, the permission that allowed it is not. Marked. */
  spend_limits_changed:   ['Spending limits changed', 'warn'],
};
function _actLabel(ev){
  const m = ACT_LABEL[ev.kind];
  let text = m ? m[0] : String(ev.kind || 'Activity').replace(/_/g, ' ');
  if(ev.kind === 'plan_changed' && ev.plan) text += ' to ' + ev.plan;
  if(ev.kind === 'signed_in' && ev.reason) text += ' with ' + ev.reason;
  return { text, tone: m ? m[1] : '' };
}
function _actWhen(ts){
  const d = new Date(ts), now = Date.now(), diff = now - ts;
  if(diff < 60000) return 'Just now';
  if(diff < 3600000) return Math.floor(diff/60000) + ' min ago';
  if(diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  try{ return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
  catch(e){ return d.toISOString().slice(0,16).replace('T',' '); }
}
/* The country code the edge saw, as a flag plus the code. Never invented: if
   the server did not record one, nothing is shown. */
function _actWhere(ev){
  const cc = String(ev.country || '').toUpperCase();
  if(!/^[A-Z]{2}$/.test(cc)) return '';
  let flag = '';
  try{ flag = String.fromCodePoint(...[...cc].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) + ' '; }catch(e){}
  return flag + cc;
}

function _renderActivityBlock(host){
  host.innerHTML = '<div class="act-load">Loading your account activity…</div>';
  if(!(window.AMV_API && AMV_API.live && AMV_API.token)){
    host.innerHTML = '<div class="act-off">Account activity is recorded on the server. '+
      'Sign in to your AMV account to see where and when it has been used.</div>';
    return;
  }
  AMV_API.activity().then(d=>{
    if(!d || !d.ok){ host.innerHTML = '<div class="act-off">Your activity history is unavailable right now. Please try again shortly.</div>'; return; }
    _actPaint(host, d);
  }).catch(()=>{
    host.innerHTML = '<div class="act-off">Could not reach the server, so this list would be out of date. It will load when you are back online.</div>';
  });
}

function _actPaint(host, d){
  const evs = (d.events || []).slice(0, 40);
  const rows = evs.map(ev=>{
    const L = _actLabel(ev);
    const where = _actWhere(ev);
    const meta = [ev.dev || '', where].filter(Boolean).join(' · ');
    return '<div class="act-row'+(L.tone?' '+L.tone:'')+'">'+
      '<div class="act-main"><div class="act-what">'+escH(L.text)+'</div>'+
      (meta ? '<div class="act-meta">'+escH(meta)+'</div>' : '<div class="act-meta act-unknown">Device not recorded</div>')+
      '</div><div class="act-when"><time datetime="'+escH(new Date(ev.at).toISOString())+'">'+escH(_actWhen(ev.at))+'</time></div></div>';
  }).join('');

  const failed = evs.filter(e=>e.kind==='sign_in_failed').length;

  host.innerHTML =
    (failed >= 3 ? '<div class="act-alert" role="alert">'+failed+' failed sign-in attempts are in this list. '+
       'If none of them were you, change your password and sign out of all devices.</div>' : '')+
    (rows ? '<div class="act-rows">'+rows+'</div>'
          : '<div class="act-off">Nothing recorded yet. Sign-ins, password changes and plan changes will appear here.</div>')+
    '<div class="act-actions">'+
      '<button class="btn bd2" id="act-signout-all" type="button">Sign out of all devices</button>'+
      '<button class="btn bs" id="act-export" type="button">Download this log</button>'+
    '</div>'+
    '<div class="act-say" id="act-say" role="status" aria-live="polite"></div>'+
    '<div class="act-fine">AMV records the browser family and the country the request came from - never your IP address, '+
      'and never a full device fingerprint. The last '+(+d.kept||100)+' events are kept for '+(+d.retentionDays||400)+' days.</div>';

  on(document.getElementById('act-signout-all'),'click',()=>_actSignOutEverywhere());
  on(document.getElementById('act-export'),'click',()=>{
    /* The same records, as a file. No server round trip - this is exactly what
       was on screen, so it cannot disagree with it. */
    try{
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(),
        account: (S.user && S.user.email) || '', events: d.events || [] }, null, 2)],
        { type:'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'amv-account-activity.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
      const s = document.getElementById('act-say'); if(s) s.textContent = 'Downloaded.';
    }catch(e){
      const s = document.getElementById('act-say'); if(s) s.textContent = 'Your browser blocked the download.';
    }
  });
}

/* End every session on the account. Confirmed, because it signs the user out
   of their own phone too - and that IS the point, so the confirmation says so
   rather than being a reflex "are you sure". */
/* `sayId` names where to write progress. It defaults to this screen's own
   status line, and the Account pane passes its own - one implementation, two
   places that need it, rather than a second copy that drifts. (The Account
   pane's copy was the one that drifted: it wrote a localStorage timestamp and
   claimed every other session had ended.) */
function _actSignOutEverywhere(sayId){
  const go = async ()=>{
    const say = document.getElementById(sayId || 'act-say');
    if(say) say.textContent = 'Ending all sessions…';
    let ok = false;
    try{ ok = await AMV_API.logout(true); }catch(e){}
    if(!ok){
      if(say) say.textContent = 'Nothing was signed out - your other sessions are STILL SIGNED IN. Please try again.';
      try{ toast('Sign out everywhere failed - nothing was changed','error',5000); }catch(e){}
      return;
    }
    try{ toast('Signed out of all devices','success',3000); }catch(e){}
    signOut();
  };
  try{
    if(typeof confirmModal === 'function'){
      confirmModal('Sign out of all devices?',
        'Every device signed in to this account is signed out immediately, including this one and your phone. '+
        'Your data is untouched. Do this if you think someone else has access.', go);
      return;
    }
  }catch(e){}
  go();
}
try{ window._renderActivityBlock = _renderActivityBlock; window._actSignOutEverywhere = _actSignOutEverywhere; }catch(e){}
