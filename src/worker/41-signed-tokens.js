  return new Response(js, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function _widgetLoaderJS(key, appHost) {
  // The loader is intentionally tiny and dependency-free. It creates a launcher
  // button and an iframe (the actual chat UI lives in the AMV app at #embed).
  const iframeSrc = appHost + '/#embed=1&k=' + encodeURIComponent(key);
  return `(function(){
  if(window.__AMV_WIDGET__) return; window.__AMV_WIDGET__=1;
  var KEY=${JSON.stringify(key)}, SRC=${JSON.stringify(iframeSrc)};
  var open=false, wrap, frame, btn;
  function el(t,s){var e=document.createElement(t); if(s) e.setAttribute('style',s); return e;}
  function build(){
    btn=el('button','position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;background:#4f7cff;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.25);z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .15s');
    btn.setAttribute('aria-label','Open chat');
    btn.innerHTML='<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    btn.onmouseenter=function(){btn.style.transform='scale(1.06)';};
    btn.onmouseleave=function(){btn.style.transform='scale(1)';};
    wrap=el('div','position:fixed;bottom:92px;right:20px;width:390px;height:600px;max-width:calc(100vw - 32px);max-height:calc(100vh - 120px);border-radius:16px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.32);z-index:2147483000;display:none;background:#fff');
    frame=el('iframe','width:100%;height:100%;border:none;');
    frame.setAttribute('title','AMV chat'); frame.setAttribute('allow','clipboard-write');
    frame.src=SRC;
    wrap.appendChild(frame);
    btn.onclick=function(){ open=!open; wrap.style.display=open?'block':'none'; btn.style.transform='scale(1)'; };
    document.body.appendChild(wrap); document.body.appendChild(btn);
  }
  /* AMV-044: THE X INSIDE THE PANEL, AND NOBODY ELSE.

     This listened for a message and acted on it without asking where it came
     from. The listener runs on the CUSTOMER'S OWN SITE - AMV's script, on
     somebody else's page - so every frame on that page, and every window with a
     handle to it, could send {__amvWidget:'close'} and be obeyed.

     Closing a panel is a small thing to be able to do. The listener is not: it
     is an open channel into a script running on a third party's site, and the
     moment this protocol grows a second verb - open it, point it somewhere,
     hand it a session - the same code obeys that from anywhere too. The cost of
     checking is two comparisons.

     Both checks, because either alone leaves a way in: the ORIGIN alone would
     accept any frame served from the app host, including one an attacker
     embedded themselves, and the SOURCE alone would accept a window that
     happens to be the frame but is showing something else. */
  var APP_ORIGIN=(function(){ try{ return new URL(SRC).origin; }catch(e){ return ''; } })();
  window.addEventListener('message',function(e){
    if(!e || !APP_ORIGIN || e.origin!==APP_ORIGIN) return;
    if(!frame || e.source!==frame.contentWindow) return;
    if(e.data && e.data.__amvWidget==='close'){ open=false; if(wrap) wrap.style.display='none'; }
  });
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',build); else build();
})();`;
}

/* ---------------- alerting (webhook) ------------------------------- */
async function notify(env, msg) {
  if (!env.ALERT_WEBHOOK) return;
  try { await fetchDeadline(env.ALERT_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '[AMV] ' + msg }) }); } catch {}
}

/* Throttled alert: fire at most once per `key` per `windowMin` minutes, so a
   recurring failure pages you the FIRST time (when you can still act) without
   burying you in thousands of duplicate messages. Critical money/security
   events use a short window; noisy ones use a long one. Returns quietly if no
   webhook is configured - alerting is opt-in via ALERT_WEBHOOK. */
async function alertOnce(env, key, msg, windowMin = 30) {
  if (!env.ALERT_WEBHOOK) return;
  try {
    const k = `alerted:${key}`;
    if (await env.AMV_KV.get(k)) return;            // already alerted this window
    await env.AMV_KV.put(k, '1', { expirationTtl: Math.max(60, windowMin * 60) });
    await notify(env, msg);
  } catch { /* alerting must never break the request */ }
}

/* =====================================================================
   SIGNED TOKENS - hardened HS256 JWT
   - Standards-compliant JWT (header.payload.signature), URL-safe base64
   - Constant-time signature comparison (no timing leak)
   - Short-lived ACCESS tokens (default 1h) + long-lived REFRESH tokens (30d)
   - Token versioning (ver) + per-user revocation via KV ("token epoch")
   - Algorithm is pinned to HS256 in verify (prevents alg-confusion / "none")
   ===================================================================== */
const JWT_ALG = 'HS256';
const ACCESS_TTL_MS  = 60 * 60 * 1000;          // 1 hour
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_VER = 1;                             // bump to invalidate all old tokens

// URL-safe base64 (no '+', '/', '=') - proper JWT encoding
function b64urlEncode(bytes) {
  let bin = '';
  const arr = (bytes instanceof Uint8Array) ? bytes : new TextEncoder().encode(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecodeToString(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function b64urlDecodeToBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
// Constant-time byte comparison - defeats timing attacks
/* Parse, or say you could not. Used where a throw would be worse than a null:
   a webhook body arriving malformed should become a clean refusal, not an
   exception thrown from inside the signature check before the handler's own
   guarded parse can answer 400. */
function _safeJson(txt) {
  try { return JSON.parse(txt); } catch (e) { return null; }
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function _hmacKey(secret) {
  // FAIL CLOSED: never fall back to a public/default signing key. A missing
  // JWT_SECRET must break token signing and verification (no tokens issued, all
  // verification returns null → 401) rather than silently signing with a key an
  // attacker could know and use to forge tokens for any account.
  if (!secret) throw new Error('JWT_SECRET is not configured - refusing to sign or verify tokens');
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}
// Per-user token epoch: incrementing it in KV revokes all that user's tokens.
async function _tokenEpoch(env, email) {
  /* A READ THAT FAILED IS NOT THE ANSWER ZERO.

     This used to catch any storage error and return 0. verifyToken compares
     the token's epoch against what comes back, so while the read was failing
     every token issued before the first revocation matched and verified. The
     two things that increment this epoch are a password reset and signing out
     everywhere - which is to say, the window where it fails open is exactly
     the window after somebody's account was compromised, and the sessions
     they had just revoked would be live again.

     So a failure is a failure. It throws, and the caller refuses rather than
     guessing. Refusing on a storage blip signs people out, which is annoying
     and recoverable; the other way round hands a stolen session back, which
     is not. */
  const v = await env.AMV_KV.get(`tokepoch:${email}`);
  return v ? parseInt(v, 10) || 0 : 0;
}
  /* A password that changed and sessions that did not is a half-done job, and
     the half that did not happen is the half that matters after a compromise.
     It is not a reason to fail the reset - the new password is already
     written, and telling them it failed would send them to try again with a
     credential that no longer works. So it is said instead: audited, alerted,
     and named in the answer, so nobody walks away believing the old sessions
     are gone when they are not. */
async function _revokeOrSay(env, email, where) {
  try { await revokeUserTokens(env, email); return true; }
  catch (e) {
    audit(env, 'token_revoke_failed', { email, where, error: String((e && e.message) || e) });
    try { await alertOnce(env, 'token_revoke_failed',
      'A password change could not sign existing sessions out. Storage may be unhealthy; sessions issued before the change are still valid.', 30); } catch (_) {}
    return false;
  }
}

async function revokeUserTokens(env, email) {
  const cur = await _tokenEpoch(env, email);
  await env.AMV_KV.put(`tokepoch:${email}`, String(cur + 1));
  /* The epoch already ends every token; the records go too, so the device list
     does not show sign-ins that can no longer do anything. */
  try { await _sessDropAll(env, email); } catch (e) {}
}

/* ── WHERE YOU ARE SIGNED IN ───────────────────────────────────────────────
   One record per sign-in, keyed by the session id the tokens carry: the
   browser and system it came from, the country, when it started and when it
   was last renewed. It is what the account's device list shows, and ending one
   deletes its record - after which that browser can neither renew nor use the
   access token it still holds (verifyToken checks the record).

   KV is eventually consistent between locations, so a record written moments
   ago may not be visible everywhere yet. A token issued in the last two
   minutes is therefore not refused for a missing record: refusing it would sign
   people out just after they signed in. Ending a session that is under two
   minutes old takes effect when it is two minutes old.

   Never backed up (BACKUP_NEVER): restoring one would bring back a sign-in
   somebody ended. Exported and erased with the account's other records. */
const SESS_FRESH_S = 120;
const _sessKey = (email, sid) => 'sess:' + String(email).toLowerCase() + ':' + sid;
async function _sessOpen(env, request, email) {
  const sid = crypto.randomUUID();
  const cf = (request && request.cf) || {};
  const rec = { sid, created: Date.now(), seen: Date.now(), dev: _deviceLabel(request) || '', country: cf.country ? String(cf.country).slice(0, 2) : '' };
  /* A sign-in is never refused because its record could not be written: the
     tokens go out without a session id, as they did before sessions were
     recorded, and are still ended by "sign out everywhere". */
  try { await env.AMV_KV.put(_sessKey(email, sid), JSON.stringify(rec), { expirationTtl: Math.floor(REFRESH_TTL_MS / 1000) }); }
  catch (e) { audit(env, 'session_record_failed', { email }); return ''; }
  return sid;
}
async function _sessTouch(env, request, email, sid) {
  const raw = await env.AMV_KV.get(_sessKey(email, sid));
  if (!raw) return false;
  let rec; try { rec = JSON.parse(raw); } catch (e) { return false; }
  rec.seen = Date.now();
  const dev = _deviceLabel(request); if (dev) rec.dev = dev;
  const cf = (request && request.cf) || {}; if (cf.country) rec.country = String(cf.country).slice(0, 2);
  await env.AMV_KV.put(_sessKey(email, sid), JSON.stringify(rec), { expirationTtl: Math.floor(REFRESH_TTL_MS / 1000) });
  return true;
}
async function _sessList(env, email) {
  const out = [];
  let cursor;
  do {
    const page = await env.AMV_KV.list({ prefix: 'sess:' + String(email).toLowerCase() + ':', cursor });
    for (const k of page.keys) {
      try { const r = JSON.parse(await env.AMV_KV.get(k.name) || 'null'); if (r && r.sid) out.push(r); } catch (e) {}
      if (out.length >= 100) break;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && out.length < 100);
  return out;
}
async function _sessDropAll(env, email) {
  let cursor;
  do {
    const page = await env.AMV_KV.list({ prefix: 'sess:' + String(email).toLowerCase() + ':', cursor });
    for (const k of page.keys) { try { await env.AMV_KV.delete(k.name); } catch (e) {} }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

/* Sign a JWT. typ is 'access' or 'refresh'. */
async function signToken(payload, secret, opts = {}) {
  const typ = opts.typ || 'access';
  const ttl = opts.ttlMs || (typ === 'refresh' ? REFRESH_TTL_MS : ACCESS_TTL_MS);
  const now = Date.now();
  const header = { alg: JWT_ALG, typ: 'JWT' };
  const fullPayload = {
    ...payload,
    typ,
    ver: TOKEN_VER,
    epoch: opts.epoch || 0,
    iat: Math.floor(now / 1000),
    nbf: Math.floor(now / 1000),
    exp: Math.floor((now + ttl) / 1000),
    jti: crypto.randomUUID(),
  };
  const headerB64 = b64urlEncode(JSON.stringify(header));
  const payloadB64 = b64urlEncode(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await _hmacKey(secret);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  const sigB64 = b64urlEncode(new Uint8Array(mac));
  return `${signingInput}.${sigB64}`;
}

/* Issue an access+refresh pair for a user. */
/* AMV-019: THE LONG-LIVED HALF OF THE SESSION, OUT OF REACH OF SCRIPT.

   Both tokens were handed to the browser and both were written to
   localStorage, which is readable by any script that ends up running on the
   page - an injected one, a compromised dependency, an extension. The access
   token is short-lived and has to be readable, because it goes in an
   Authorization header. The REFRESH token is the one worth protecting: it is
   valid for weeks and mints new access tokens on demand, so a copy of it is a
   copy of the account.

   It travels as an HttpOnly cookie now. Script cannot read an HttpOnly cookie
   at all, so the same injection that could previously walk off with a
   month-long credential gets, at worst, one short-lived token.

   Scoped to /auth so it is not attached to every API call - it is only ever
   needed by refresh and logout, and a credential that rides along on requests
   that do not need it is a credential with more chances to leak.

   SameSite=None is required because the app and the API are different origins,
   and that in turn requires Secure and a concrete Allow-Origin - which is why
   this only engages on a deployment that has set ALLOWED_ORIGIN. Without it
   the browser would refuse the cookie and the session would silently stop
   surviving a reload, so the token is still returned in the body and the
   response says which mode is in force rather than leaving the client to
   guess. */
const REFRESH_COOKIE = 'amv_rt';
function _cookieAuthOn(env) { return _corsOrigin(env) !== '*'; }
function _refreshCookie(env, value, maxAgeS) {
  const bits = [`${REFRESH_COOKIE}=${value}`, 'HttpOnly', 'Secure', 'SameSite=None', 'Path=/auth'];
  bits.push('Max-Age=' + Math.max(0, Math.floor(maxAgeS)));
  return bits.join('; ');
}
function _readRefreshCookie(request) {
  try {
    const raw = request.headers.get('Cookie') || '';
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      if (part.slice(0, i).trim() === REFRESH_COOKIE) return part.slice(i + 1).trim();
    }
  } catch (e) {}
  return '';
}
/* The tokens, plus the cookie that carries the long one. Returns a Response so
   every issuing path sets the cookie the same way - four call sites setting a
   header by hand is four chances for one of them to be forgotten, which is the
   shape of most of this week's findings. */
function _tokenResponse(env, tokens, extra) {
  const body = Object.assign({}, tokens, extra || {});
  if (!_cookieAuthOn(env)) return json(body);
  /* The client is told the cookie is authoritative, so it can stop keeping its
     own copy. Saying so explicitly beats having the client infer it from a
     header it cannot read. */
  body.refreshInCookie = true;
  const res = json(body, 200, { 'Set-Cookie': _refreshCookie(env, tokens.refreshToken, REFRESH_TTL_MS / 1000) });
  res.headers.append('Set-Cookie', _sessionHintCookie(REFRESH_TTL_MS / 1000));
  return res;
}
/* "SOMEBODY IS SIGNED IN ON THIS BROWSER" - AND NOTHING MORE (LESSONS 553).

   Safari deletes a site's script-writable storage after seven days without a
   visit, but not a cookie the server set. The page decided whether to try the
   renewal cookie from what it remembered in storage, so a weekly visitor came
   back to an empty memory, never tried the cookie it still had, and looked
   signed out. This cookie is readable by the page and carries no credential:
   it only says a renewal is worth asking for. Path=/ so the page can see it;
   the session itself stays in the HttpOnly cookie under /auth. */
function _sessionHintCookie(maxAgeS) {
  return ['amv_si=' + (maxAgeS > 0 ? '1' : ''), 'Secure', 'SameSite=Lax', 'Path=/',
          'Max-Age=' + Math.max(0, Math.floor(maxAgeS))].join('; ');
}
function _clearRefreshCookie(env) {
