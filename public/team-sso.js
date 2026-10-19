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
        'Require it for everybody at @'+escH(s.domain)+' - passwords and Google stop working for them. You can always still use yours.</label>'+
      _teamScimHTML(s, d.scim);
  body.innerHTML = step +
    '<details class="team-sso-edit"><summary>Change settings</summary>'+_teamSsoFormHTML(s, d.redirectUri)+'</details>'+
    '<button class="btn bs" id="sso-remove" type="button">Turn off company sign-in</button>'+
    '<p class="team-sso-say" id="sso-say" role="status" aria-live="polite"></p>';
}
/* DIRECTORY SYNC (SCIM, 71-scim.js). When somebody leaves the company, its
   identity provider removes them here and ends their sign-ins. Offered only
   once the domain is proved, because it only ever manages that domain. The
   token is shown once, at the moment it is made; the server keeps its hash. */
function _teamScimHTML(s, scim){
  const head = '<div class="team-sso-step team-scim"><b>'+escH(T('Directory sync (SCIM)'))+'</b> '+
    escH(T('When somebody leaves, your identity provider removes them from AMV within minutes and ends every sign-in they have. It manages only addresses at {0}, and never you.').replace('{0}', '@'+s.domain));
  if(!scim) return head + '<div><button class="btn bs" id="scim-on" type="button">'+escH(T('Turn on directory sync'))+'</button></div></div>';
  return head + '<dl class="team-sso-rec"><dt>'+escH(T('Address'))+'</dt><dd><code>'+escH(scim.baseUrl||'')+'</code></dd>'+
    '<dt>'+escH(T('Token'))+'</dt><dd>'+escH(T('ending {0}').replace('{0}', scim.tail||''))+'</dd></dl>'+
    '<div id="scim-token" aria-live="polite"></div>'+
    '<button class="btn bs" id="scim-new" type="button">'+escH(T('New token'))+'</button> '+
    '<button class="btn bs" id="scim-off" type="button">'+escH(T('Turn off directory sync'))+'</button></div>';
}
function _teamScimShowToken(token){
  const box = $('scim-token'); if(!box || !token) return;
  box.innerHTML = '<p class="team-sso-say"><b>'+escH(T('Copy this token into your identity provider now. AMV shows it only once.'))+'</b></p>'+
    '<code class="team-scim-tok">'+escH(token)+'</code> <button class="btn bs" id="scim-copy" type="button">'+escH(T('Copy'))+'</button>';
  const c = $('scim-copy');
  if(c) on(c, 'click', async () => { try{ await _copyText(token); toast(T('Token copied.'), 'success', 3000); }catch(e){ toast(T('Select it and copy it instead.'), 'info', 4000); } });
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
  /* SCIM answers with the token, not the sign-in settings: read them again,
     then show the token in the space the fresh render made for it. */
  const scimRun = async (btn, on) => {
    if(btn) btn.disabled = true; say('');
    try{
      const r = await AMVTeam.sso({ action:'scim', on });
      const d = await AMVTeam.sso({ action:'get' });
      _teamSsoRender(d); _teamSsoWire(vc);
      if(on) _teamScimShowToken(r.token);
      else toast(T('Directory sync is off. The old token no longer works.'), 'info', 5000);
    }catch(e){ if(btn) btn.disabled = false; say(e.message || T('That did not work.')); }
  };
  const sOn = $('scim-on'); if(sOn) on(sOn, 'click', () => scimRun(sOn, true));
  const sNew = $('scim-new');
  if(sNew) on(sNew, 'click', () => confirmModal(T('Make a new token?'), T('The current token stops working at once. Paste the new one into your identity provider.'),
    () => scimRun(sNew, true), { confirm: T('New token') }));
  const sOff = $('scim-off');
  if(sOff) on(sOff, 'click', () => confirmModal(T('Turn off directory sync?'), T('Your identity provider stops adding and removing people here. Nobody already in the team is removed.'),
    () => scimRun(sOff, false), { confirm: T('Turn off') }));
  const rm = $('sso-remove');
  if(rm) on(rm,'click',()=>confirmModal('Turn off company sign-in?',
    'Your people go back to signing in with a password or Google. Anybody who never set a password will need to reset it.',
    ()=>run(rm, { action:'remove' }, ()=>toast('Company sign-in is off.','info',5000)), { confirm:'Turn off' }));
}
window._teamSsoStart = _teamSsoStart;
