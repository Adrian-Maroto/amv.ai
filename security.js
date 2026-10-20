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
/* A QR CODE FOR THE AUTHENTICATOR APP.

   Typing a 32-letter key into a phone is where people give up on a second
   step, so the key is also shown as a QR code the app scans. Drawn here, in
   the page, from the key the server just sent: the key is a secret, and a
   QR service on another host would be one more place it was sent.

   Byte mode, error correction M, versions 1-10 (up to 213 bytes - an
   otpauth address is about 100). The algorithm is the one in ISO/IEC 18004:
   Reed-Solomon over GF(256), the function patterns, the zigzag placement and
   the eight masks scored by the standard's four penalty rules. Returns rows
   of booleans (true = dark), or null when the text is too long. */
function _secQr(text){
  const data = [...new TextEncoder().encode(String(text))];
  const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  const raw = (v) => { let r = (16 * v + 128) * v + 64; if(v >= 2){ const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if(v >= 7) r -= 36; } return r; };
  const cap = (v) => Math.floor(raw(v) / 8) - ECC[v] * BLOCKS[v];
  let ver = 1;
  while(ver <= 10 && 4 + (ver < 10 ? 8 : 16) + data.length * 8 > cap(ver) * 8) ver++;
  if(ver > 10) return null;
  /* The bit stream: mode, length, bytes, terminator, padding. */
  const bits = [];
  const put = (val, n) => { for(let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(data.length, ver < 10 ? 8 : 16); data.forEach(b => put(b, 8));
  const room = cap(ver) * 8;
  put(0, Math.min(4, room - bits.length)); put(0, (8 - bits.length % 8) % 8);
  for(let p = 0xEC; bits.length < room; p ^= 0xEC ^ 0x11) put(p, 8);
  const words = []; for(let i = 0; i < bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  /* Reed-Solomon, per block, then interleaved. */
  const mul = (x, y) => { let z = 0; for(let i = 7; i >= 0; i--){ z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; };
  const deg = ECC[ver], div = new Array(deg).fill(0); div[deg - 1] = 1;
  for(let i = 0, root = 1; i < deg; i++){ for(let j = 0; j < deg; j++){ div[j] = mul(div[j], root); if(j + 1 < deg) div[j] ^= div[j + 1]; } root = mul(root, 2); }
  const rem = (dat) => { const r = new Array(deg).fill(0); for(const b of dat){ const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); } return r; };
  const nb = BLOCKS[ver], total = Math.floor(raw(ver) / 8), shortN = nb - total % nb, shortLen = Math.floor(total / nb);
  const blocks = [];
  for(let i = 0, k = 0; i < nb; i++){
    const dat = words.slice(k, k + shortLen - deg + (i < shortN ? 0 : 1)); k += dat.length;
    const e = rem(dat); if(i < shortN) dat.push(0); blocks.push(dat.concat(e));
  }
  const code = [];
  for(let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if(i !== shortLen - deg || j >= shortN) code.push(b[i]); });
  /* The grid. */
  const size = ver * 4 + 17;
  const m = [...Array(size)].map(() => new Array(size).fill(false));
  const fn = [...Array(size)].map(() => new Array(size).fill(false));
  const set = (x, y, d) => { m[y][x] = d; fn[y][x] = true; };
  for(let i = 0; i < size; i++){ set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for(const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for(let dy = -4; dy <= 4; dy++) for(let dx = -4; dx <= 4; dx++){
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if(x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  if(ver > 1){
    const n = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2, pos = [6];
    for(let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    pos.forEach((a, i) => pos.forEach((b, j) => {
      if((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return;
      for(let dy = -2; dy <= 2; dy++) for(let dx = -2; dx <= 2; dx++) set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
  }
  const format = (mask) => {
    const d = mask; let r = d; for(let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const f = ((d << 10) | r) ^ 0x5412, bit = (i) => ((f >>> i) & 1) === 1;
    for(let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for(let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for(let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for(let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);
  if(ver >= 7){
    let r = ver; for(let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
    const v = (ver << 12) | r;
    for(let i = 0; i < 18; i++){ const d = ((v >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3); set(a, b, d); set(b, a, d); }
  }
  for(let right = size - 1, i = 0; right >= 1; right -= 2){
    if(right === 6) right = 5;
    for(let vert = 0; vert < size; vert++) for(let j = 0; j < 2; j++){
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if(!fn[y][x] && i < code.length * 8){ m[y][x] = ((code[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  const MASK = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  const flip = (k) => { for(let y = 0; y < size; y++) for(let x = 0; x < size; x++) if(!fn[y][x] && MASK[k](x, y)) m[y][x] = !m[y][x]; };
  const score = () => {
    let s = 0, dark = 0;
    const line = (get) => {
      for(let a = 0; a < size; a++){
        let run = 1;
        for(let b = 1; b <= size; b++){
          if(b < size && get(a, b) === get(a, b - 1)) run++;
          else { if(run >= 5) s += run - 2; run = 1; }
        }
        for(let b = 0; b + 7 <= size; b++){
          const p = [1, 0, 1, 1, 1, 0, 1].every((v, k) => get(a, b + k) === !!v);
          if(!p) continue;
          const light = (from, to) => { for(let k = from; k < to; k++) if(k >= 0 && k < size && get(a, k)) return false; return true; };
          if(light(b - 4, b) || light(b + 7, b + 11)) s += 40;
        }
      }
    };
    line((a, b) => m[a][b]); line((a, b) => m[b][a]);
    for(let y = 0; y < size - 1; y++) for(let x = 0; x < size - 1; x++){ const c = m[y][x]; if(c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) s += 3; }
    m.forEach(r => r.forEach(c => { if(c) dark++; }));
    return s + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  };
  let best = 0, bestScore = Infinity;
  for(let k = 0; k < 8; k++){ flip(k); format(k); const sc = score(); if(sc < bestScore){ best = k; bestScore = sc; } flip(k); }
  flip(best); format(best);
  return m;
}
/* As an SVG: dark squares on white with the four-module quiet zone the
   scanner needs, in both themes - a QR code is read by a camera, not by the
   colour scheme. */
function _secQrSvg(text, label){
  const m = _secQr(text); if(!m) return '';
  const n = m.length + 8; let d = '';
  m.forEach((r, y) => r.forEach((c, x) => { if(c) d += 'M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z'; }));
  return '<svg class="sec-qr" viewBox="0 0 ' + n + ' ' + n + '" role="img" aria-label="' + escH(label) + '" shape-rendering="crispEdges"><rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}

async function _secTotpOn(){
  const proof = await _secProof(); if(!proof) return;
  let d; try{ d = await _secApi.call('/auth/totp/start', { proof }); }catch(e){ return _secFail(e); }
  const host = $('sec-totp-setup'); if(!host) return;
  const grouped = d.secret.match(/.{1,4}/g).join(' ');
  host.innerHTML = '<div class="sec-setup">'
    + '<p class="set-sub">' + escH(T('1. Scan this with your authenticator app, or enter the key below:')) + '</p>'
    + (/^otpauth:\/\/totp\//.test(d.uri || '') ? _secQrSvg(d.uri, T('QR code for your authenticator app')) : '')
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
