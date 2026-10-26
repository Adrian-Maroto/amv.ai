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
// Per-user token epoch: raising it revokes all that user's tokens.
/* WHERE IT IS HELD. With the Durable Object bound (every real deployment),
   the per-account object 'auth:<email>' is the authority - see authGet in
   07-atomic-counters.js for why KV was not enough. KV is still written, so a
   backup carries the number and a deployment without the object still works,
   and it is read once per account to seed the object. Every failure throws:
   the caller refuses, it never guesses. */
const _authName = (email) => 'auth:' + String(email).toLowerCase();
/* AND WHEN THE OBJECT CANNOT BE ASKED, SIGN-IN STAYS UP.

   Failing closed there would turn an outage of one Durable Object into every
   person signed out of AMV at once. So an object that throws or answers
   nonsense falls back to the KV epoch - revocation within about a minute,
   which is how it always worked - with the operator alerted. KV failing is
   still a refusal, as it always was: no number at all is never read as zero.
   The floor is max(object, KV), so the object can only make it stricter. */
/* Both are read, in parallel, every time, and the higher wins. Reading the
   object alone was the first version, and its own test found the hole: a
   revocation made while the object was down lands in KV only, and when the
   object came back it still held the lower number - so the revoked session
   worked again. KV ahead of the object raises the object (authSeed), and the
   KV read costs what verifyToken already paid before the object existed. */
async function _authState(env, email, sid) {
  if (!env.AMV_COUNTER) return { epoch: await _tokenEpochKV(env, email), ended: false };
  const kvP = _tokenEpochKV(env, email);           // throws on failure, as always
  let s = null, why = '';
  try {
    s = await counter(env, _authName(email), { op: 'authGet', sid: sid || '', strict: true });
    if (!s || typeof s.epoch !== 'number') { why = 'the revocation object answered without an epoch'; s = null; }
  } catch (e) { why = String((e && e.message) || e); s = null; }
  const kv = await kvP;
  if (!s) {
    try { audit(env, 'revocation_degraded', { error: why.slice(0, 120) }); } catch (_) {}
    try { await alertOnce(env, 'revocation_degraded', 'The account revocation object could not be read; sign-in is using the KV epoch, so a revoked session may keep working for up to a minute.', 15); } catch (_) {}
    return { epoch: kv, ended: false };
  }
  if (!s.seeded || kv > s.epoch) {
    try { await counter(env, _authName(email), { op: 'authSeed', floor: kv, strict: true }); } catch (e) {}
  }
  return { epoch: Math.max(kv, s.epoch), ended: !!s.ended };
}
async function _tokenEpoch(env, email) { return (await _authState(env, email)).epoch; }
/* One sign-in ended, from the device list, by signing out, or because its
   renewal token was reused. The record goes from KV (the device list) and the
   session is marked ended in the object, which is what verifyToken asks.
   The object failing is said, not swallowed: the KV delete still ends it
   within about a minute, which is how it worked before. */
async function _sessEnd(env, email, sid) {
  if (!email || !sid) return;
  try { await env.AMV_KV.delete(_sessKey(email, sid)); } catch (e) {}
  if (env.AMV_COUNTER) {
    try {
      await counter(env, _authName(email), { op: 'authEndSession', sid, ttlMs: REFRESH_TTL_MS, floor: await _tokenEpochKV(env, email), strict: true });
    } catch (e) { audit(env, 'session_end_slow', { email, error: String((e && e.message) || e).slice(0, 120) }); }
  }
}
async function _tokenEpochKV(env, email) {
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
  if (env.AMV_COUNTER) {
    /* Raised in the object first - that is the moment it takes effect - then
       copied to KV, which is what the fallback reads, so the two agree. If
       the object cannot take it, KV alone is raised (the old behaviour) and
       said - a revocation is never dropped because one store was down. */
    const floor = await _tokenEpochKV(env, email);
    let next = floor + 1;
    try {
      const r = await counter(env, _authName(email), { op: 'authRevokeAll', floor, strict: true });
      if (!r || typeof r.epoch !== 'number') throw new Error('the revocation object answered without an epoch');
      next = r.epoch;
    } catch (e) {
      audit(env, 'revocation_degraded', { email, where: 'revoke', error: String((e && e.message) || e).slice(0, 120) });
    }
    await env.AMV_KV.put(`tokepoch:${email}`, String(next));
  } else {
    const cur = await _tokenEpochKV(env, email);
    await env.AMV_KV.put(`tokepoch:${email}`, String(cur + 1));
  }
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
   people out just after they signed in. That window no longer delays an
   ending: ending a sign-in also marks it in the account's revocation object
   (_sessEnd), which verifyToken asks first and which every location sees at
   once. The record check below is kept as the second way it ends.

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
  return _cookieAuthOn(env) ? { 'Set-Cookie': _refreshCookie(env, '', 0) } : undefined;
}

async function issueTokens(env, email, name, sid) {
  const epoch = await _tokenEpoch(env, email);
  const base = { email, name: name || '' };
  if (sid) base.sid = String(sid);
  /* Tells the page that this is the operator, so it can show the owner's
     screens without a personal address compiled into the app. It decides
     nothing here: every owner route still checks OWNER_EMAIL itself. */
  const owner = String(env.OWNER_EMAIL || '').toLowerCase().trim();
  if (owner && String(email || '').toLowerCase().trim() === owner) base.own = 1;
  const access = await signToken(base, env.JWT_SECRET, { typ: 'access', epoch });
  const refresh = await signToken(base, env.JWT_SECRET, { typ: 'refresh', epoch });
  return { token: access, refreshToken: refresh, email, name: name || '' };
}

/* Verify a JWT. Pins algorithm, checks exp/nbf/ver, constant-time signature.
   When env is provided, also enforces the per-user revocation epoch.
   expectedTyp defaults to 'access' so refresh tokens can't be used as access. */
async function verifyToken(token, secret, env = null, expectedTyp = 'access') {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;

    // Pin the algorithm - reject 'none' / RS256 confusion attempts.
    const header = JSON.parse(b64urlDecodeToString(headerB64));
    if (!header || header.alg !== JWT_ALG || header.typ !== 'JWT') return null;

    // Recompute signature and compare in constant time.
    const key = await _hmacKey(secret);
    const expectedMac = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${headerB64}.${payloadB64}`))
    );
    const givenMac = b64urlDecodeToBytes(sigB64);
    if (!timingSafeEqual(expectedMac, givenMac)) return null;

    const data = JSON.parse(b64urlDecodeToString(payloadB64));
    const nowSec = Math.floor(Date.now() / 1000);
    if (data.ver !== TOKEN_VER) return null;

    /* AMV-054: A CLAIM THAT IS ONLY CHECKED WHEN PRESENT IS NOT A CHECK.

       These read `if (data.exp && ...)` and `if (data.typ && ...)`, so a token
       carrying neither passed every one of them. That is the wrong shape for a
       verifier: what a token DOES NOT SAY is exactly what a verifier must not
       be relaxed about.

       What it bought, if a token without them ever existed: no `exp` is a
       session that never ends - revocation still catches it through the epoch,
       but nothing else does, and "valid for ever unless somebody notices" is
       not a session. No `typ` is worse, because the refresh token and the
       access token differ only in that field: without it the month-long refresh
       token is accepted anywhere the fifteen-minute access token is, which
       undoes the whole reason for having two.

       signToken has always set all three, so this was not reachable today. It
       was reachable by one future issuing path that forgot one field, and it
       would have failed open and silently. Required now, so that path fails
       closed and loudly instead. */
    if (!data.typ || typeof data.typ !== 'string') return null;
    if (expectedTyp && data.typ !== expectedTyp) return null;
    if (!Number.isFinite(data.exp)) return null;
    if (nowSec > data.exp) return null;                            // expired
    if (!Number.isFinite(data.nbf)) return null;
    if (nowSec < data.nbf - 60) return null;                       // not-yet-valid (60s skew)
    if (env && data.email) {                                       // revocation check
      const st = await _authState(env, data.email, data.sid);
      if ((data.epoch || 0) !== st.epoch) return null;
      if (data.sid && st.ended) return null;                       // ended from the device list, at once
      /* A sign-in ended from the device list. Fresh tokens are spared while
         their record may still be on its way to this location (SESS_FRESH_S). */
      if (data.sid && nowSec - (data.iat || 0) > SESS_FRESH_S) {
        if (!(await env.AMV_KV.get(_sessKey(data.email, data.sid)))) return null;
      }
    }
    return data;
  } catch { return null; }
}

