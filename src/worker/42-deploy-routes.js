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
      const epoch = await _tokenEpoch(env, data.email);
      if ((data.epoch || 0) !== epoch) return null;
      /* A sign-in ended from the device list. Fresh tokens are spared while
         their record may still be on its way to this location (SESS_FRESH_S). */
      if (data.sid && nowSec - (data.iat || 0) > SESS_FRESH_S) {
        if (!(await env.AMV_KV.get(_sessKey(data.email, data.sid)))) return null;
      }
    }
    return data;
  } catch { return null; }
}

/* =====================================================================
   DEPLOY
   1. npm i -g wrangler && wrangler login
   2. wrangler kv:namespace create AMV_KV   → put id in wrangler.toml
   3. Secrets:
        wrangler secret put AMV_MODEL_KEY
        wrangler secret put JWT_SECRET           (LONG random string - 32+ chars)
