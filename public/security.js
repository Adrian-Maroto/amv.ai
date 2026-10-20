/* PASSKEYS AND TWO-STEP SIGN-IN - the part of Settings > Security that
   manages them. Fetched when that pane opens (_loadSecurityFactors in
   12c-settings-panes.js), so nobody who never opens it carries it. A classic
   script in the page's own scope.

   Every change here asks for proof first - the password, an authenticator or
   recovery code, or a passkey - because the server will refuse it without
   (_stepUp, 73-passkeys-and-mfa.js). Asking up front is the honest order: the
   person learns what is needed before pressing the thing that needs it. */

const _secApi = {
  async call(path, body){
    const r = await AMV_API._fetch(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if(!r.ok || d.error){ const e = new Error(d.error || T('That did not work. Try again.')); e.code = d.code; e.can = d.can; throw e; }
    return d;
  },
};

/* An ArrayBuffer from base64url and back - what navigator.credentials speaks. */
const _secB = {
  buf(s){ const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); const b = atob(t + '='.repeat((4 - t.length % 4) % 4)); const u = new Uint8Array(b.length); for(let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; },
  str(buf){ let s = ''; for(const x of new Uint8Array(buf)) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
};
function _secCredOut(c){
  const r = c.response, out = { id: c.id, type: c.type, response: { clientDataJSON: _secB.str(r.clientDataJSON) } };
  if(r.attestationObject) out.response.attestationObject = _secB.str(r.attestationObject);
  if(r.authenticatorData){ out.response.authenticatorData = _secB.str(r.authenticatorData); out.response.signature = _secB.str(r.signature); }
  return out;
}

let _secState = null;

/* PROOF. Resolves with a proof object, or null if they back out. */
function _secProof(){
  const s = (_secState && _secState.security) || {};
  if(!s.password && !s.totp && !(s.passkeys && s.passkeys.length)) return Promise.resolve({});
  return new Promise((resolve) => {
    const host = $('sec-proof'); if(!host){ resolve(null); return; }
    const opts = [];
    if(s.password) opts.push('<label class="fp-lbl" for="sec-pw">' + escH(T('Your password')) + '</label><input id="sec-pw" class="fp-in" type="password" autocomplete="current-password">');
    else if(s.totp) opts.push('<label class="fp-lbl" for="sec-code">' + escH(T('A code from your authenticator app')) + '</label><input id="sec-code" class="fp-in fp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6">');
    host.innerHTML = '<div class="sec-proof"><p class="set-sub">' + escH(T('To change how you sign in, confirm it is you.')) + '</p>' + opts.join('')
      + '<div class="sec-row">'
      + (opts.length ? '<button class="btn bp" id="sec-proof-go">' + escH(T('Confirm')) + '</button>' : '')
      + (s.passkeys && s.passkeys.length && window.PublicKeyCredential ? '<button class="btn bs" id="sec-proof-pk">' + escH(T('Confirm with a passkey')) + '</button>' : '')
      + '<button class="btn bs" id="sec-proof-x">' + escH(T('Cancel')) + '</button></div>'
      + '<div class="set-sub" id="sec-proof-msg" role="status" aria-live="polite"></div></div>';
    const end = (v) => { host.innerHTML = ''; resolve(v); };
    on($('sec-proof-x'), 'click', () => end(null));
    on($('sec-proof-go'), 'click', () => {
      const pw = $('sec-pw'), code = $('sec-code');
      if(pw) return end({ password: pw.value });
      if(code) return end({ totp: code.value.replace(/\D/g, '') });
    });
    on($('sec-proof-pk'), 'click', async () => {
      try{
        const o = await _secApi.call('/auth/passkey/options', { purpose: 'stepup' });
        const pk = Object.assign({}, o.publicKey, { challenge: _secB.buf(o.publicKey.challenge),
          allowCredentials: (o.publicKey.allowCredentials || []).map(c => ({ type: c.type, id: _secB.buf(c.id) })) });
        const c = await navigator.credentials.get({ publicKey: pk });
        end({ passkey: { cid: o.cid, credential: _secCredOut(c) } });
      }catch(e){ const m = $('sec-proof-msg'); if(m) m.textContent = (e && e.name === 'NotAllowedError') ? T('The passkey was not used. Try again, or use another way.') : (e.message || T('That did not work. Try again.')); }
    });
    setTimeout(() => { try{ const f = $('sec-pw') || $('sec-code'); f && f.focus(); }catch(e){} }, 40);
  });
}

function _secWhen(ts){ try{ return ts ? new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : ''; }catch(e){ return ''; } }

function _secPaint(){
  const host = $('sec-mfa'); if(!host || !_secState) return;
  const s = _secState.security, pkOk = _secState.passkeysAvailable && !!window.PublicKeyCredential;
  const keys = (s.passkeys || []).map(k => '<div class="sess-row"><div class="sess-txt"><div class="sess-name">' + escH(k.name) + (k.synced ? ' <span class="sess-badge">' + escH(T('Synced')) + '</span>' : '') + '</div>'
    + '<div class="sess-meta">' + escH(T('Added') + ' ' + _secWhen(k.at) + (k.used ? ' · ' + T('last used') + ' ' + _secWhen(k.used) : '')) + '</div></div>'
    + '<button type="button" class="btn bs" data-sec-rm="' + escH(k.id) + '">' + escH(T('Remove')) + '</button></div>').join('');
  host.innerHTML = '<div class="ss2"><h3>' + escH(T('Passkeys')) + '</h3>'
    + '<div class="set-sub">' + escH(T('Sign in with your fingerprint, face or device PIN instead of a password. Nobody can phish a passkey, and it never leaves your device.')) + '</div>'
    + (keys || '<div class="set-sub">' + escH(T('No passkeys yet.')) + '</div>')
    + (pkOk ? '<button class="btn bp" id="sec-pk-add" style="margin-top:10px">' + escH(T('Add a passkey')) + '</button>'
            : '<div class="set-sub">' + escH(_secState.passkeysAvailable ? T('This browser cannot make passkeys.') : T('Passkeys are not available on this AMV yet.')) + '</div>')
    + '</div>'
    + '<div class="ss2"><h3>' + escH(T('Authenticator app')) + '</h3>'
    + '<div class="set-sub">' + escH(s.totp
        ? T('On. Signing in with your password on a new device asks for a code from the app.') + ' ' + T('Recovery codes left:') + ' ' + s.recoveryLeft
        : T('A six-digit code from an app like Google Authenticator or 1Password, asked for when you sign in with your password on a new device - so your password and your inbox are not enough on their own.')) + '</div>'
    + (s.totp
        ? '<div class="sec-row"><button class="btn bs" id="sec-rc-new">' + escH(T('New recovery codes')) + '</button><button class="btn bs" id="sec-totp-off">' + escH(T('Turn off')) + '</button></div>'
        : (_secState.totpAvailable ? '<button class="btn bp" id="sec-totp-on" style="margin-top:10px">' + escH(T('Set up an authenticator app')) + '</button>'
                                   : '<div class="set-sub">' + escH(T('Authenticator apps are not available on this AMV yet.')) + '</div>'))
    + '<div id="sec-totp-setup"></div></div>'
    + '<div id="sec-proof"></div><div class="set-sub" id="sec-msg" role="status" aria-live="polite"></div>';
  on($('sec-pk-add'), 'click', _secAddPasskey);
  on($('sec-totp-on'), 'click', _secTotpOn);
  on($('sec-totp-off'), 'click', _secTotpOff);
  on($('sec-rc-new'), 'click', _secNewCodes);
  host.querySelectorAll('[data-sec-rm]').forEach(b => on(b, 'click', () => _secRemove(b.getAttribute('data-sec-rm'))));
}
const _secMsg = (t) => { const m = $('sec-msg'); if(m) m.textContent = t || ''; };
const _secFail = (e) => _secMsg(e && e.name === 'NotAllowedError' ? T('The passkey prompt was closed. Nothing was changed.') : ((e && e.message) || T('That did not work. Try again.')));

async function _secAddPasskey(){
  const proof = await _secProof(); if(!proof) return;
  try{
    const o = await _secApi.call('/auth/passkey/options', { purpose: 'register', proof });
    const p = o.publicKey;
    const c = await navigator.credentials.create({ publicKey: Object.assign({}, p, {
      challenge: _secB.buf(p.challenge), user: Object.assign({}, p.user, { id: _secB.buf(p.user.id) }),
      excludeCredentials: (p.excludeCredentials || []).map(x => ({ type: x.type, id: _secB.buf(x.id) })) }) });
    const name = (navigator.userAgentData && navigator.userAgentData.platform) || (/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone or iPad' : /Mac/.test(navigator.userAgent) ? 'Mac' : /Android/.test(navigator.userAgent) ? 'Android' : /Windows/.test(navigator.userAgent) ? 'Windows' : T('Passkey'));
    const d = await _secApi.call('/auth/passkey/register', { cid: o.cid, credential: _secCredOut(c), name });
    _secState.security = d.security; _secPaint(); _secMsg(T('Passkey added. Next time, choose "Sign in with a passkey".'));
  }catch(e){ _secFail(e); }
}
async function _secRemove(id){
  const proof = await _secProof(); if(!proof) return;
  try{ const d = await _secApi.call('/auth/passkey/remove', { id, proof }); _secState.security = d.security; _secPaint(); _secMsg(T('Passkey removed.')); }
  catch(e){ _secFail(e); }
}
function _secShowCodes(codes){
  const host = $('sec-totp-setup'); if(!host) return;
  host.innerHTML = '<div class="sec-codes"><p class="set-sub"><b>' + escH(T('Your recovery codes. Each works once, if you lose your phone. Keep them somewhere safe - they are not shown again.')) + '</b></p>'
    + '<pre class="sec-code-list" data-no-i18n>' + codes.map(escH).join('\n') + '</pre>'
    + '<div class="sec-row"><button class="btn bs" id="sec-rc-copy">' + escH(T('Copy')) + '</button><button class="btn bs" id="sec-rc-save">' + escH(T('Download')) + '</button></div></div>';
  on($('sec-rc-copy'), 'click', () => { try{ navigator.clipboard.writeText(codes.join('\n')); _secMsg(T('Copied.')); }catch(e){} });
  on($('sec-rc-save'), 'click', () => _saveBlob(new Blob(['AMV recovery codes\n\n' + codes.join('\n') + '\n'], { type: 'text/plain' }), 'amv-recovery-codes.txt'));
}
async function _secTotpOn(){
  const proof = await _secProof(); if(!proof) return;
  let d; try{ d = await _secApi.call('/auth/totp/start', { proof }); }catch(e){ return _secFail(e); }
  const host = $('sec-totp-setup'); if(!host) return;
  const grouped = d.secret.match(/.{1,4}/g).join(' ');
  host.innerHTML = '<div class="sec-setup">'
    + '<p class="set-sub">' + escH(T('1. In your authenticator app, add an account and enter this key (or open the link on your phone):')) + '</p>'
    + '<div class="sec-secret" data-no-i18n><code>' + escH(grouped) + '</code></div>'
    + '<div class="sec-row"><button class="btn bs" id="sec-key-copy">' + escH(T('Copy key')) + '</button><button class="btn bs" id="sec-key-open">' + escH(T('Open in authenticator app')) + '</button></div>'
    + '<label class="fp-lbl" for="sec-first">' + escH(T('2. Enter the 6-digit code it shows')) + '</label>'
    + '<input id="sec-first" class="fp-in fp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6">'
    + '<button class="btn bp" id="sec-first-go">' + escH(T('Turn on')) + '</button></div>';
  on($('sec-key-copy'), 'click', () => { try{ navigator.clipboard.writeText(d.secret); _secMsg(T('Copied.')); }catch(e){} });
  /* Opened only in the one shape the server makes it: an otpauth address,
     which a phone hands to its authenticator app. Nothing else is followed. */
  on($('sec-key-open'), 'click', () => { if(/^otpauth:\/\/totp\/[^\s"'<>]+$/.test(d.uri)) location.href = d.uri; });
  on($('sec-first-go'), 'click', async () => {
    const code = ($('sec-first').value || '').replace(/\D/g, '');
    try{
      const r = await _secApi.call('/auth/totp/confirm', { code });
      _secState.security = r.security; _secPaint(); _secShowCodes(r.recovery);
      _secMsg(T('Authenticator app is on.'));
    }catch(e){ _secFail(e); }
  });
  setTimeout(() => { try{ $('sec-first').focus(); }catch(e){} }, 40);
}
async function _secTotpOff(){
  const proof = await _secProof(); if(!proof) return;
  try{ const d = await _secApi.call('/auth/totp/disable', { proof }); _secState.security = d.security; _secPaint(); _secMsg(T('Authenticator app is off. A new device now gets an emailed code instead.')); }
  catch(e){ _secFail(e); }
}
async function _secNewCodes(){
  const proof = await _secProof(); if(!proof) return;
  try{ const d = await _secApi.call('/auth/recovery/new', { proof }); _secState.security = d.security; _secPaint(); _secShowCodes(d.recovery); _secMsg(T('New recovery codes made. The old ones no longer work.')); }
  catch(e){ _secFail(e); }
}

async function _secRenderNow(){
  const host = $('sec-mfa'); if(!host) return;
  try{ _secState = await _secApi.call('/auth/security', {}); _secPaint(); }
  catch(e){ host.innerHTML = '<div class="set-sub">' + escH(T('AMV could not read your sign-in settings just now.')) + '</div>'; }
}
try{ window._secRenderNow = _secRenderNow; }catch(e){}
