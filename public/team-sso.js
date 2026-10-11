/* Company sign-in, the owner's half of it - fetched the first time an owner
   opens the team page (_teamSsoLoad in 06-team-market.js), the way the owner
   console and the spreadsheet editor are. A classic script, so these land on
   window and use the page's own helpers (escH, on, toast, confirmModal,
   AMVTeam).

   Read from the server rather than guessed from the team record, because the
   proof and the record to add are the server's. The three states are the
   three things the owner does: say which provider, prove the domain, then
   decide whether to require it. */
function _teamSsoFormHTML(cur, redirectUri){
  const v = (k) => escH((cur && cur[k]) || '');
  return '<div class="sf team-sso-form">'+
    '<p class="team-sso-say">In your provider, add AMV as an app (OpenID Connect, web) with this sign-in redirect address: '+
      '<code>'+escH(redirectUri||'')+'</code></p>'+
    '<label class="lbl" for="sso-domain">Your email domain</label>'+
    '<input id="sso-domain" type="text" inputmode="url" autocomplete="off" placeholder="yourcompany.com" value="'+v('domain')+'">'+
    '<label class="lbl" for="sso-issuer">Issuer</label>'+
    '<input id="sso-issuer" type="url" autocomplete="off" placeholder="https://yourcompany.okta.com" value="'+v('issuer')+'">'+
    '<label class="lbl" for="sso-client">Client ID</label>'+
    '<input id="sso-client" type="text" autocomplete="off" value="'+v('clientId')+'">'+
    '<label class="lbl" for="sso-secret">Client secret</label>'+
    '<input id="sso-secret" type="password" autocomplete="new-password" placeholder="'+(cur?'Leave empty to keep the one saved':'')+'">'+
    '<button class="btn bp" id="sso-save" type="button">Save</button>'+
  '</div>';
}
function _teamSsoRender(d){
  const body = $('team-sso-body'); if(!body) return;
  const s = d && d.sso;
  if(!s){ body.innerHTML = _teamSsoFormHTML(null, d && d.redirectUri) + '<p class="team-sso-say" id="sso-say" role="status" aria-live="polite"></p>'; return; }
  const step = !s.verified
    ? '<div class="team-sso-step"><b>Prove you own '+escH(s.domain)+'.</b> Add this record where your domain’s DNS is managed, then check it. '+
        'Until then nobody signs in this way.'+
        '<dl class="team-sso-rec"><dt>Type</dt><dd>TXT</dd><dt>Name</dt><dd><code>'+escH(s.record.name)+'</code></dd>'+
        '<dt>Value</dt><dd><code>'+escH(s.record.value)+'</code></dd></dl>'+
        '<button class="btn bp" id="sso-verify" type="button">Check the record</button></div>'
    : '<div class="team-sso-step is-on"><b>On.</b> People at <b>@'+escH(s.domain)+'</b> can choose “Sign in with your company” and use '+
        escH(s.issuer)+'.</div>'+
      '<label class="team-sso-req"><input type="checkbox" id="sso-require"'+(s.required?' checked':'')+'> '+
        'Require it for everybody at @'+escH(s.domain)+' - passwords and Google stop working for them. You can always still use yours.</label>';
  body.innerHTML = step +
    '<details class="team-sso-edit"><summary>Change settings</summary>'+_teamSsoFormHTML(s, d.redirectUri)+'</details>'+
    '<button class="btn bs" id="sso-remove" type="button">Turn off company sign-in</button>'+
    '<p class="team-sso-say" id="sso-say" role="status" aria-live="polite"></p>';
}
async function _teamSsoStart(vc){
  if(!$('team-sso-body')) return;
  let d;
  try{ d = await AMVTeam.sso({ action:'get' }); }
  catch(e){ const b=$('team-sso-body'); if(b) b.innerHTML='<p class="team-sso-say">'+escH(e.message||'Could not load company sign-in.')+'</p>'; return; }
  _teamSsoRender(d);
  _teamSsoWire(vc);
}
function _teamSsoWire(vc){
  const say = (t) => { const m=$('sso-say'); if(m) m.textContent=t||''; };
  const run = async (btn, body, done) => {
    if(btn) btn.disabled = true; say('');
    try{ const d = await AMVTeam.sso(body); _teamSsoRender(d); _teamSsoWire(vc); if(done) done(d); }
    catch(e){ if(btn) btn.disabled = false; say(e.message||'That did not work.'); }
  };
  const save = $('sso-save');
  if(save) on(save,'click',()=>run(save, { action:'set', domain:($('sso-domain')||{}).value, issuer:($('sso-issuer')||{}).value,
    clientId:($('sso-client')||{}).value, clientSecret:($('sso-secret')||{}).value },
    ()=>toast('Saved. Now prove the domain with the record shown.','success',5000)));
  const ver = $('sso-verify');
  if(ver) on(ver,'click',()=>run(ver, { action:'verify' }, (d)=>{
    if(d.verified) toast('Proved. Your people can now sign in with your company.','success',5000);
    else { const m=$('sso-say'); if(m) m.textContent = d.message || 'AMV does not see the record yet.'; }
  }));
  const req = $('sso-require');
  if(req) on(req,'change',()=>run(req, { action:'require', on: req.checked },
    (d)=>toast(d.sso && d.sso.required ? 'Required. Only company sign-in works at @'+d.sso.domain+' now.' : 'Not required. Passwords work again.','success',5000)));
  const rm = $('sso-remove');
  if(rm) on(rm,'click',()=>confirmModal('Turn off company sign-in?',
    'Your people go back to signing in with a password or Google. Anybody who never set a password will need to reset it.',
    ()=>run(rm, { action:'remove' }, ()=>toast('Company sign-in is off.','info',5000)), { okText:'Turn off' }));
}
window._teamSsoStart = _teamSsoStart;
