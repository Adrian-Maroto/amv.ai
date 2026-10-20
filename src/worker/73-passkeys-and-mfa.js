/* ── PASSKEYS, AN AUTHENTICATOR APP, AND RECOVERY CODES: THE ROUTES ─────────

   Decided by the owner on 2026-10-20 (passkeys + MFA, LESSONS 596). The
   failure this answers is account takeover, which at AMV's scale is not an
   edge case: a password reused from a breached site, phished, or typed on a
   shared computer opens everything AMV holds for a person - their chats,
   files, connected accounts and background jobs.

   WHAT A PERSON CAN DO
     - Sign in with a passkey: no password, no emailed code. A passkey is
       already two factors - the device that holds it, and the fingerprint,
       face or PIN that unlocks it (user verification is REQUIRED).
     - Add an authenticator app. From then on, a password sign-in on a device
       AMV has not seen asks for its six-digit code instead of the emailed one,
       and the account's mailbox alone no longer opens the account.
     - Keep ten recovery codes for the day the phone is lost.

   WHAT HOLDS IT SAFE
     - Every challenge is minted here, bound to its purpose (and, for adding a
       passkey, to the account), lives five minutes and is spent ONCE - through
       _claimOnce, so two requests racing with one challenge do not both pass.
     - Changing any of this - adding or removing a passkey, turning the
       authenticator on or off, new recovery codes - needs PROOF in the same
       request: the password, an authenticator or recovery code, or a passkey.
       A stolen session is not enough to plant a passkey the thief keeps
       through "sign out everywhere". The one exception is an account with
       nothing to prove with yet (signed up with Google, no factor): adding
       its FIRST factor needs the session, and is recorded and alerted, because
       refusing would leave those accounts with no way to get stronger at all.
     - An API key is never enough for any of it.
     - Secrets are sealed under CONNECT_KEY; recovery codes are kept only as
       hashes; nothing secret is ever logged. A deployment without CONNECT_KEY
       says the authenticator app is unavailable rather than storing a secret
       in the clear.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── PASSKEYS: THE VERIFICATION ─────────────────────────────────────────────

   Everything a browser hands back from navigator.credentials is checked here,
   by the rules of WebAuthn Level 2 (sections 7.1 and 7.2), with no library:

   CREATING ONE (register):
     - clientDataJSON.type is "webauthn.create", its challenge is the one this
       server issued for this account and has not been used, and its origin is
       this site's - so a page on another address cannot enrol a key here;
     - the authenticator data's rpIdHash is SHA-256 of this site's host, the
       user-present flag is set, and the user-verified flag is set (a passkey
       that skipped the fingerprint or PIN is a possession factor only);
     - the attested credential's public key is ES256 (P-256) or RS256 - what
       every phone, laptop and security key in use offers - and anything else
       is refused by name rather than stored and never usable.
     Attestation statements are not checked (fmt "none" is asked for): AMV
     does not restrict which make of authenticator people may use, and the
     user-verified flag is what it relies on.

   USING ONE (sign in, or prove it is you):
     - type "webauthn.get", a challenge issued and spent once, this origin;
     - rpIdHash, user present, user verified, as above;
     - the signature over authenticatorData || SHA-256(clientDataJSON) checks
       against the public key stored when it was created;
     - the signature counter, where the authenticator keeps one, has gone up.
       A counter that did not is the mark of a cloned key and is refused.
   ══════════════════════════════════════════════════════════════════════════ */

const _b64u = {
  enc(buf){ let s = ''; for(const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(str){
    const t = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    if(!/^[A-Za-z0-9+/]*$/.test(t)) throw new Error('pk_bad_encoding');
    const bin = atob(t + '='.repeat((4 - t.length % 4) % 4));
    const out = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
  },
};

/* A CBOR reader for the two things WebAuthn encodes in it: the attestation
   object and the COSE public key. Definite lengths only (which is all the
   specification permits here), bounded depth and size. */
function _cbor(bytes){
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let i = 0;
  const need = (n) => { if(i + n > b.length) throw new Error('pk_bad_cbor'); };
  const len = (info) => {
    if(info < 24) return info;
    if(info === 24){ need(1); return b[i++]; }
    if(info === 25){ need(2); const v = (b[i] << 8) | b[i + 1]; i += 2; return v; }
    if(info === 26){ need(4); const v = ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; i += 4; return v; }
    throw new Error('pk_bad_cbor');
  };
  const item = (depth) => {
    if(depth > 8) throw new Error('pk_bad_cbor');
    need(1);
    const ib = b[i++], major = ib >> 5, info = ib & 31;
    if(major === 0) return len(info);
    if(major === 1) return -1 - len(info);
    if(major === 2){ const n = len(info); need(n); const v = b.slice(i, i + n); i += n; return v; }
    if(major === 3){ const n = len(info); need(n); const v = new TextDecoder().decode(b.slice(i, i + n)); i += n; return v; }
    if(major === 4){ const n = len(info); if(n > 64) throw new Error('pk_bad_cbor'); const a = []; for(let k = 0; k < n; k++) a.push(item(depth + 1)); return a; }
    if(major === 5){ const n = len(info); if(n > 64) throw new Error('pk_bad_cbor'); const m = new Map(); for(let k = 0; k < n; k++){ const key = item(depth + 1); m.set(key, item(depth + 1)); } return m; }
    if(major === 7){ if(info === 20) return false; if(info === 21) return true; if(info === 22) return null; }
    throw new Error('pk_bad_cbor');
  };
  const v = item(0);
  return { value: v, end: i };
}

/* Authenticator data, WebAuthn 6.1. */
function _pkAuthData(buf){
  const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if(a.length < 37) throw new Error('pk_bad_authdata');
  const flags = a[32];
  const out = { rpIdHash: a.slice(0, 32), up: !!(flags & 1), uv: !!(flags & 4), be: !!(flags & 8), bs: !!(flags & 16),
    at: !!(flags & 64), count: ((a[33] << 24) >>> 0) + (a[34] << 16) + (a[35] << 8) + a[36] };
  if(out.at){
    if(a.length < 55) throw new Error('pk_bad_authdata');
    const n = (a[53] << 8) | a[54];
    if(n < 16 || n > 1023 || a.length < 55 + n) throw new Error('pk_bad_authdata');
    out.credId = a.slice(55, 55 + n);
    const key = _cbor(a.slice(55 + n));
    out.coseKey = key.value;
  }
  return out;
}

/* A COSE key (RFC 9053) as a JWK WebCrypto will import, or null when it is
   not a kind AMV verifies. */
function _pkCoseToJwk(m){
  if(!(m instanceof Map)) return null;
  const kty = m.get(1), alg = m.get(3);
  if(kty === 2 && alg === -7 && m.get(-1) === 1){
    const x = m.get(-2), y = m.get(-3);
    if(!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) return null;
    return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: _b64u.enc(x), y: _b64u.enc(y), ext: true } };
  }
  if(kty === 3 && alg === -257){
    const n = m.get(-1), e = m.get(-2);
    if(!(n instanceof Uint8Array) || !(e instanceof Uint8Array) || n.length < 256 || n.length > 512) return null;
    return { alg: -257, jwk: { kty: 'RSA', n: _b64u.enc(n), e: _b64u.enc(e), alg: 'RS256', ext: true } };
  }
  return null;
}

/* An ECDSA signature arrives DER-encoded (SEQUENCE of two INTEGERs);
   WebCrypto wants the two 32-byte numbers side by side. */
function _pkDerToRaw(der){
  const d = der instanceof Uint8Array ? der : new Uint8Array(der);
  if(d[0] !== 0x30) throw new Error('pk_bad_signature');
  let i = 2;
  if(d[1] & 0x80) i = 2 + (d[1] & 0x7f);
  const part = () => {
    if(d[i++] !== 0x02) throw new Error('pk_bad_signature');
    const n = d[i++]; let v = d.slice(i, i + n); i += n;
    while(v.length > 32 && v[0] === 0) v = v.slice(1);
    if(v.length > 32) throw new Error('pk_bad_signature');
    const out = new Uint8Array(32); out.set(v, 32 - v.length); return out;
  };
  const r = part(), s = part();
  const raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32); return raw;
}

async function _pkSha256(data){
  return new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data));
}
function _pkEq(a, b){
  if(a.length !== b.length) return false;
  let d = 0; for(let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0;
}

/* The client data, checked against what this server expects. Returns the
   parsed object, or throws a short reason. */
function _pkClientData(raw, type, challenge, origins){
  let c; try{ c = JSON.parse(new TextDecoder().decode(raw)); }catch(e){ throw new Error('pk_bad_client_data'); }
  if(!c || c.type !== type) throw new Error('pk_wrong_type');
  if(typeof c.challenge !== 'string' || c.challenge !== challenge) throw new Error('pk_wrong_challenge');
  if(!origins.includes(c.origin)) throw new Error('pk_wrong_origin');
  if(c.crossOrigin === true) throw new Error('pk_wrong_origin');
  return c;
}

/* REGISTER. `att` is what the page sends: { id, clientDataJSON, attestationObject }
   as base64url. Returns { credId, alg, jwk, count, backedUp } or throws. */
async function _pkVerifyRegistration(att, expect){
  const raw = _b64u.dec(att && att.clientDataJSON);
  _pkClientData(raw, 'webauthn.create', expect.challenge, expect.origins);
  const ao = _cbor(_b64u.dec(att && att.attestationObject)).value;
  if(!(ao instanceof Map) || !(ao.get('authData') instanceof Uint8Array)) throw new Error('pk_bad_attestation');
  const ad = _pkAuthData(ao.get('authData'));
  if(!_pkEq(ad.rpIdHash, await _pkSha256(expect.rpId))) throw new Error('pk_wrong_site');
  if(!ad.up) throw new Error('pk_not_present');
  if(!ad.uv) throw new Error('pk_not_verified');
  if(!ad.at || !ad.credId) throw new Error('pk_bad_attestation');
  const key = _pkCoseToJwk(ad.coseKey);
  if(!key) throw new Error('pk_unsupported_key');
  /* The id the page reports must be the one the authenticator attested. */
  if(att.id && att.id !== _b64u.enc(ad.credId)) throw new Error('pk_bad_attestation');
  /* Imported now, so a key WebCrypto would refuse is refused before it is kept. */
  await _pkImport(key);
  return { credId: _b64u.enc(ad.credId), alg: key.alg, jwk: key.jwk, count: ad.count, backedUp: ad.bs };
}

function _pkImport(key){
  return key.alg === -7
    ? crypto.subtle.importKey('jwk', key.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    : crypto.subtle.importKey('jwk', key.jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

/* USE. `asr` is { id, clientDataJSON, authenticatorData, signature } as
   base64url; `stored` is what _pkVerifyRegistration returned. Returns the new
   signature count, or throws. */
async function _pkVerifyAssertion(asr, stored, expect){
  const raw = _b64u.dec(asr && asr.clientDataJSON);
  _pkClientData(raw, 'webauthn.get', expect.challenge, expect.origins);
  const adBytes = _b64u.dec(asr && asr.authenticatorData);
  const ad = _pkAuthData(adBytes);
  if(!_pkEq(ad.rpIdHash, await _pkSha256(expect.rpId))) throw new Error('pk_wrong_site');
  if(!ad.up) throw new Error('pk_not_present');
  if(!ad.uv) throw new Error('pk_not_verified');
  const signed = new Uint8Array(adBytes.length + 32);
  signed.set(adBytes, 0); signed.set(await _pkSha256(raw), adBytes.length);
  const sig = _b64u.dec(asr && asr.signature);
  const key = await _pkImport(stored);
  const good = stored.alg === -7
    ? await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, _pkDerToRaw(sig), signed)
    : await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, sig, signed);
  if(!good) throw new Error('pk_bad_signature');
  /* Authenticators that keep no counter send 0 every time; one that keeps
     one must move it forward. */
  if((ad.count || stored.count) && ad.count <= (stored.count || 0)) throw new Error('pk_cloned');
  return { count: ad.count };
}

/* ── AUTHENTICATOR-APP CODES (RFC 6238) AND RECOVERY CODES ──────────────────

   The six-digit codes from Google Authenticator, 1Password, Authy and every
   other app: HMAC-SHA1 over the 30-second step, as the RFC and every one of
   those apps compute it. A code is accepted for the current step and one
   either side (a phone clock a little off), and a step that has been used
   cannot be used again - the step is recorded, so a code read over a
   shoulder is spent.

   Recovery codes are for the day the phone is lost. Ten, shown once, kept
   only as SHA-256 hashes, each usable once. */
const TOTP_STEP_S = 30;
const TOTP_WINDOW = 1;
const RECOVERY_CODES = 10;
const _B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function _b32enc(bytes){
  let bits = 0, val = 0, out = '';
  for(const b of bytes){ val = (val << 8) | b; bits += 8; while(bits >= 5){ out += _B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if(bits > 0) out += _B32[(val << (5 - bits)) & 31];
  return out;
}
function _b32dec(str){
  const s = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, val = 0; const out = [];
  for(const ch of s){ const i = _B32.indexOf(ch); if(i < 0) throw new Error('totp_bad_secret'); val = (val << 5) | i; bits += 5; if(bits >= 8){ out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
function _totpNewSecret(){ return _b32enc(crypto.getRandomValues(new Uint8Array(20))); }

async function _totpAt(secret, step){
  const key = await crypto.subtle.importKey('raw', _b32dec(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8);
  let s = step; for(let i = 7; i >= 0; i--){ msg[i] = s & 255; s = Math.floor(s / 256); }
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[19] & 15;
  const n = (((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6;
  return String(n).padStart(6, '0');
}
/* The step a code matches, or -1. `last` is the step used last time; it and
   anything before it are refused. */
async function _totpCheck(secret, code, last, nowMs){
  const c = String(code || '').replace(/\s/g, '');
  if(!/^\d{6}$/.test(c)) return -1;
  const now = Math.floor((nowMs == null ? Date.now() : nowMs) / 1000 / TOTP_STEP_S);
  for(let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d++){
    const step = now + d;
    if(last != null && step <= last) continue;
    const want = await _totpAt(secret, step);
    let diff = 0; for(let i = 0; i < 6; i++) diff |= want.charCodeAt(i) ^ c.charCodeAt(i);
    if(!diff) return step;
  }
  return -1;
}
function _totpUri(secret, email, issuer){
  return 'otpauth://totp/' + encodeURIComponent(issuer + ':' + email) + '?secret=' + secret
    + '&issuer=' + encodeURIComponent(issuer) + '&algorithm=SHA1&digits=6&period=' + TOTP_STEP_S;
}

/* Ten codes like "7KQ2-M9XD-PL4T": 60 bits each, unambiguous letters only. */
function _recoveryNew(){
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const out = [];
  for(let k = 0; k < RECOVERY_CODES; k++){
    const r = crypto.getRandomValues(new Uint8Array(12));
    let s = ''; for(let i = 0; i < 12; i++) s += A[r[i] & 31];
    out.push(s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8));
  }
  return out;
}
const _recoveryNorm = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
async function _recoveryHash(c){
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('amv-recovery:' + _recoveryNorm(c))));
  let s = ''; for(const b of d) s += b.toString(16).padStart(2, '0'); return s;
}

const PK_CHALLENGE_S = 300;
const PK_MAX = 10;
const MFA_CHALLENGE_S = 600;
const MFA_ATTEMPTS = 5;

/* The site a passkey belongs to: its relying-party id is the host the page is
   served from, and a browser only signs for the origin it is really on. */
function _pkSite(env){
  const origins = [...new Set([_originOf(env && env.APP_URL), _originOf(env && env.ALLOWED_ORIGIN)]
    .filter(o => o && o !== '*' && /^https?:\/\//.test(o)))];
  if(!origins.length) return null;
  let rpId; try{ rpId = new URL(origins[0]).hostname; }catch(e){ return null; }
  return { rpId, origins };
}
const _pkOff = () => json({ error: 'Passkeys are not available on this deployment: it does not know its own address (APP_URL).', code: 'passkeys_unavailable' }, 503);

async function _pkChallenge(env, purpose, email){
  const id = _b64u.enc(crypto.getRandomValues(new Uint8Array(18)));
  const c = _b64u.enc(crypto.getRandomValues(new Uint8Array(32)));
  await env.AMV_KV.put('pkchal:' + id, JSON.stringify({ c, purpose, email: email || '' }), { expirationTtl: PK_CHALLENGE_S });
  return { id, c };
}
/* The challenge, spent: null when it is unknown, expired, for something else,
   or already used. */
async function _pkSpend(env, id, purpose, email){
  if(typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,40}$/.test(id)) return null;
  let rec = null; try{ rec = JSON.parse(await env.AMV_KV.get('pkchal:' + id) || 'null'); }catch(e){ rec = null; }
  if(!rec || rec.purpose !== purpose || (email != null && rec.email !== email)) return null;
  /* Claimed under a kind of its own: where the claim falls back to storage it
     is written as `kind:id`, and `pkchal:id` is the challenge itself - which
     would then read as already claimed, every time. */
  if(!(await _claimOnce(env, 'pkspent', id, PK_CHALLENGE_S))) return null;
  try{ await env.AMV_KV.delete('pkchal:' + id); }catch(e){}
  return rec;
}

function _acctFactors(acct){
  return { password: !!(acct && acct.provider === 'email' && acct.pwHash),
           passkeys: (acct && Array.isArray(acct.passkeys)) ? acct.passkeys.length : 0,
           totp: !!(acct && acct.totp && acct.totp.on),
           recoveryLeft: (acct && Array.isArray(acct.recovery)) ? acct.recovery.length : 0 };
}

/* PROOF THAT IT IS THEM, for a change to how they sign in. `proof` is one of
   { password }, { totp }, { recovery }, { passkey: { cid, credential } }.
   Returns null when proved, or a refusal Response. A recovery code used here
   is spent, like anywhere else. */
async function _stepUp(env, request, user, proof){
  const em = String(user.email || '').toLowerCase();
  const acct = await DB.get(env, 'acct', em);
  if(!acct) return json({ error: 'unauthorized' }, 401);
  const f = _acctFactors(acct);
  const p = proof && typeof proof === 'object' ? proof : {};
  const lim = await limitAction(env, 'stepup:' + em, 10, 60);
  if(!lim.ok && !lim.unavailable) return json({ error: 'Too many tries. Wait a minute and try again.', code: 'rate_limited' }, 429);
  if(typeof p.password === 'string' && f.password){
    { const bad = _passwordTooLong(p.password); if(bad) return json(bad, 400); }
    const h = await _hashPassword(p.password, acct.salt, acct.pwIter || 100000);
    if(timingSafeEqual(new TextEncoder().encode(h), new TextEncoder().encode(acct.pwHash || ''))) return null;
  } else if(typeof p.totp === 'string' && f.totp){
    if(await _totpSpend(env, em, p.totp)) return null;
  } else if(typeof p.recovery === 'string' && f.recoveryLeft){
    if(await _recoverySpend(env, em, p.recovery)) return null;
  } else if(p.passkey && f.passkeys){
    const site = _pkSite(env);
    if(site){
      const ok = await _pkAssertFor(env, site, em, p.passkey, 'stepup').catch(() => null);
      if(ok) return null;
    }
  } else if(!f.password && !f.passkeys && !f.totp){
    return null;   /* nothing to prove with yet - see the note at the top */
  }
  audit(env, 'stepup_fail', { email: em });
  return json({ error: 'That did not confirm it is you. Nothing was changed.', code: 'stepup_failed',
                can: { password: f.password, totp: f.totp, recovery: f.recoveryLeft > 0, passkey: f.passkeys > 0 } }, 403);
}

/* A passkey assertion, checked against THIS account's passkeys. Updates the
   counter under the lock. Returns the passkey used, or throws. */
async function _pkAssertFor(env, site, email, sent, purpose){
  const rec = await _pkSpend(env, sent && sent.cid, purpose, purpose === 'signin' ? null : email);
  if(!rec) throw new Error('pk_wrong_challenge');
  const cred = sent && sent.credential && sent.credential.response ? sent.credential : null;
  if(!cred || typeof cred.id !== 'string') throw new Error('pk_bad_request');
  const acct = await DB.get(env, 'acct', email);
  const stored = acct && Array.isArray(acct.passkeys) ? acct.passkeys.find(k => k.id === cred.id) : null;
  if(!stored) throw new Error('pk_unknown');
  const r = await _pkVerifyAssertion({ id: cred.id, ...cred.response }, stored, { challenge: rec.c, origins: site.origins, rpId: site.rpId });
  await _withAcct(env, email, (a) => {
    const k = a && Array.isArray(a.passkeys) ? a.passkeys.find(x => x.id === cred.id) : null;
    if(!k) return { error: 'gone', status: 409 };
    /* Re-checked inside the lock: two uses racing with the same count must
       not both move it forward. */
    if((r.count || k.count) && r.count <= (k.count || 0)) return { error: 'pk_cloned', status: 409 };
    k.count = r.count; k.used = Date.now();
  });
  const after = await DB.get(env, 'acct', email);
  const k2 = after && after.passkeys && after.passkeys.find(x => x.id === cred.id);
  if(!k2 || k2.count !== r.count) throw new Error('pk_cloned');
  return k2;
}

/* POST /auth/passkey/options { purpose: 'register'|'signin', proof? } */
async function passkeyOptions(request, env){
  const site = _pkSite(env); if(!site) return _pkOff();
  const body = await request.json().catch(() => ({}));
  if(body.purpose === 'signin'){
    const lim = await limitAction(env, 'pksign:' + _rlIp(request), 30, 600);
    if(!lim.ok && !lim.unavailable) return json({ error: 'Too many sign-in attempts from here. Give it a moment.', code: 'rate_limited' }, 429);
    const ch = await _pkChallenge(env, 'signin', '');
    return json({ ok: true, cid: ch.id, publicKey: { challenge: ch.c, rpId: site.rpId, userVerification: 'required', timeout: PK_CHALLENGE_S * 1000 } });
  }
  if(body.purpose === 'stepup'){
    const user = await requireUser(request, env);
    if(!user || user.via === 'apikey') return json({ error: 'unauthorized' }, 401);
    const acct = await DB.get(env, 'acct', user.email);
    const ch = await _pkChallenge(env, 'stepup', user.email);
    return json({ ok: true, cid: ch.id, publicKey: { challenge: ch.c, rpId: site.rpId, userVerification: 'required', timeout: PK_CHALLENGE_S * 1000,
      allowCredentials: ((acct && acct.passkeys) || []).map(k => ({ type: 'public-key', id: k.id })) } });
  }
  if(body.purpose !== 'register') return json({ error: 'purpose must be register, signin or stepup' }, 400);
  const user = await requireUser(request, env);
  if(!user || user.via === 'apikey') return json({ error: 'unauthorized' }, 401);
  const refused = await _stepUp(env, request, user, body.proof); if(refused) return refused;
  const acct = await DB.get(env, 'acct', user.email);
  const have = (acct && acct.passkeys) || [];
  if(have.length >= PK_MAX) return json({ error: 'An account can hold ' + PK_MAX + ' passkeys. Remove one first.', code: 'passkey_limit' }, 409);
  const ch = await _pkChallenge(env, 'register', user.email);
  const handle = _b64u.enc((await _pkSha256('amv-user:' + user.email)).slice(0, 16));
  return json({ ok: true, cid: ch.id, publicKey: {
    challenge: ch.c, rp: { id: site.rpId, name: 'AMV' },
    user: { id: handle, name: user.email, displayName: (acct && acct.name) || user.email },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    attestation: 'none', timeout: PK_CHALLENGE_S * 1000,
    excludeCredentials: have.map(k => ({ type: 'public-key', id: k.id })) } });
}

/* POST /auth/passkey/register { cid, credential, name } */
async function passkeyRegister(request, env){
  const site = _pkSite(env); if(!site) return _pkOff();
  const user = await requireUser(request, env);
  if(!user || user.via === 'apikey') return json({ error: 'unauthorized' }, 401);
  const em = String(user.email).toLowerCase();
  const body = await request.json().catch(() => ({}));
  const rec = await _pkSpend(env, body.cid, 'register', em);
  if(!rec) return json({ error: 'That request to add a passkey has expired. Start again.', code: 'passkey_expired' }, 400);
  const cred = body.credential && body.credential.response ? body.credential : null;
  let made;
  try{ made = await _pkVerifyRegistration({ id: cred && cred.id, ...(cred ? cred.response : {}) }, { challenge: rec.c, origins: site.origins, rpId: site.rpId }); }
  catch(e){
    audit(env, 'passkey_refused', { email: em, why: String(e && e.message || e).slice(0, 40) });
    const msg = /unsupported_key/.test(String(e && e.message)) ? 'That passkey uses a kind of key AMV does not support yet. Try another device or a security key.'
      : /not_verified/.test(String(e && e.message)) ? 'That passkey was made without a fingerprint, face or PIN, so it cannot be used to sign in.'
      : 'That passkey could not be verified, so it was not added.';
    return json({ error: msg, code: 'passkey_refused' }, 400);
  }
  if(await env.AMV_KV.get('pkcred:' + made.credId)) return json({ error: 'That passkey is already in use on an account.', code: 'passkey_exists' }, 409);
  const name = String(body.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) || 'Passkey';
  const r = await _withAcct(env, user.email, (a) => {
    if(!a) return { error: 'unauthorized', status: 401 };
    a.passkeys = Array.isArray(a.passkeys) ? a.passkeys : [];
    if(a.passkeys.length >= PK_MAX) return { error: 'passkey_limit', status: 409 };
    if(a.passkeys.some(k => k.id === made.credId)) return { error: 'passkey_exists', status: 409 };
    a.passkeys.push({ id: made.credId, alg: made.alg, jwk: made.jwk, count: made.count, name, at: Date.now(), used: 0, backedUp: !!made.backedUp });
  });
  if(r && r.error) return json({ error: r.error === 'passkey_limit' ? 'An account can hold ' + PK_MAX + ' passkeys.' : 'That passkey could not be added.', code: r.error }, r.status || 400);
  await env.AMV_KV.put('pkcred:' + made.credId, em);
  audit(env, 'passkey_added', { email: em });
  await _userEvent(env, request, em, 'passkey_added', { name });
  return json({ ok: true, security: _securityShown(await DB.get(env, 'acct', em)) });
}

/* POST /auth/passkey/signin { cid, credential } - no password, no code. */
async function passkeySignin(request, env){
  const site = _pkSite(env); if(!site) return _pkOff();
  const body = await request.json().catch(() => ({}));
  const cred = body.credential && body.credential.response ? body.credential : null;
  const FAIL = { error: 'That passkey did not sign you in. Try again, or use your password.', code: 'passkey_failed' };
  if(!cred || typeof cred.id !== 'string' || cred.id.length > 1400) return json(FAIL, 401);
  const em = await env.AMV_KV.get('pkcred:' + cred.id);
  if(!em){ await _pkSpend(env, body.cid, 'signin', null); audit(env, 'auth_fail', { reason: 'passkey_unknown' }); return json(FAIL, 401); }
  { const sso = await _ssoRequiredFor(env, em); if (sso) return _ssoRequiredJson(sso); }
  let used;
  try{ used = await _pkAssertFor(env, site, em, { cid: body.cid, credential: cred }, 'signin'); }
  catch(e){
    audit(env, 'auth_fail', { email: em, reason: 'passkey_' + String(e && e.message || e).replace(/^pk_/, '').slice(0, 30) });
    if(/cloned/.test(String(e && e.message))) await _userEvent(env, request, em, 'sign_in_failed', { reason: 'a passkey used out of order - it may have been copied' });
    return json(FAIL, 401);
  }
  const acct = await DB.get(env, 'acct', em);
  try{ await _markActive(env, em); }catch(e){}
  await _userEvent(env, request, em, 'signed_in', { via: 'passkey', name: used.name });
  audit(env, 'passkey_signin', { email: em });
  return _withDeviceTrust(env, em, _tokenResponse, await issueTokens(env, em, (acct && acct.name) || '', await _sessOpen(env, request, em)));
}

/* What the security screen shows - never a secret, a key or a hash. */
function _securityShown(acct){
  const f = _acctFactors(acct);
  return { password: f.password, totp: f.totp, recoveryLeft: f.recoveryLeft,
    passkeys: ((acct && acct.passkeys) || []).map(k => ({ id: k.id, name: k.name, at: k.at, used: k.used || 0, synced: !!k.backedUp })) };
}

/* GET /auth/security */
async function securityStatus(request, env){
  const user = await requireUser(request, env);
  if(!user || user.via === 'apikey') return json({ error: 'unauthorized' }, 401);
  const acct = await DB.get(env, 'acct', user.email);
  return json({ ok: true, passkeysAvailable: !!_pkSite(env), totpAvailable: connConfigured(env), security: _securityShown(acct) });
}

/* POST /auth/passkey/remove { id, proof } */
async function passkeyRemove(request, env){
  const user = await requireUser(request, env);
  if(!user || user.via === 'apikey') return json({ error: 'unauthorized' }, 401);
  const em = String(user.email).toLowerCase();
  const body = await request.json().catch(() => ({}));
  const refused = await _stepUp(env, request, user, body.proof); if(refused) return refused;
  const id = String(body.id || '');
  let name = '';
  const r = await _withAcct(env, user.email, (a) => {
    const k = a && Array.isArray(a.passkeys) ? a.passkeys.find(x => x.id === id) : null;
    if(!k) return { error: 'not_found', status: 404 };
    /* Never the last way in: an account with no password, no other passkey
       and no Google sign-in would have no door left. */
    const others = a.passkeys.length - 1;
    if(!others && !(a.provider === 'email' && a.pwHash) && a.provider !== 'google')
      return { error: 'last_way_in', status: 409 };
    name = k.name;
    a.passkeys = a.passkeys.filter(x => x.id !== id);
  });
  if(r && r.error) return json({ error: r.error === 'last_way_in' ? 'That is the only way into this account, so it cannot be removed. Add another first.' : 'That passkey is not on this account.', code: r.error }, r.status);
  try{ await env.AMV_KV.delete('pkcred:' + id); }catch(e){}
  audit(env, 'passkey_removed', { email: em });
  await _userEvent(env, request, em, 'passkey_removed', { name });
  return json({ ok: true, security: _securityShown(await DB.get(env, 'acct', em)) });
}

/* ── The authenticator app ─────────────────────────────────────────────── */
async function _totpSecretOf(env, acct){
  if(!acct || !acct.totp || !acct.totp.sealed) return null;
  try{ const o = await connOpen(env, acct.totp.sealed); return o && o.t === 'totp' ? o.s : null; }catch(e){ return null; }
}
/* A code checked and SPENT: the step it matched is recorded under the lock,
   so the same code cannot be used twice, from two places at once or later. */
async function _totpSpend(env, email, code){
  const acct = await DB.get(env, 'acct', email);
  const secret = await _totpSecretOf(env, acct);
  if(!secret) return false;
  const step = await _totpCheck(secret, code, acct.totp.last == null ? null : acct.totp.last);
  if(step < 0) return false;
  const r = await _withAcct(env, email, (a) => {
    if(!a || !a.totp || !a.totp.on) return { error: 'off', status: 409 };
    if(a.totp.last != null && step <= a.totp.last) return { error: 'replay', status: 409 };
    a.totp.last = step;
  });
  return !(r && r.error);
}
async function _recoverySpend(env, email, code){
  const h = await _recoveryHash(code);
  let hit = false;
  const r = await _withAcct(env, email, (a) => {
    const list = a && Array.isArray(a.recovery) ? a.recovery : [];
    if(!list.includes(h)) return { error: 'no', status: 403 };
    a.recovery = list.filter(x => x !== h); hit = true;
  });
  if(hit && !(r && r.error)){ audit(env, 'recovery_code_used', { email }); return true; }
  return false;
}

/* POST /auth/totp/start { proof } -> { secret, uri } - not on until confirmed. */
async function totpStart(request, env){
  const user = await requireUser(request, env);
  if(!user || user.via === 'apikey') return json({ error: 'unauthorized' }, 401);
  if(!connConfigured(env)) return json({ error: 'Authenticator apps are not available on this deployment yet (it has no key to keep the secret sealed).', code: 'totp_unavailable' }, 503);
  const body = await request.json().catch(() => ({}));
  const refused = await _stepUp(env, request, user, body.proof); if(refused) return refused;
  const em = String(user.email).toLowerCase();
  const secret = _totpNewSecret();
  await env.AMV_KV.put('totpset:' + em, await connSeal(env, { t: 'totpset', s: secret }), { expirationTtl: 900 });
  return json({ ok: true, secret, uri: _totpUri(secret, em, 'AMV') });
}
/* POST /auth/totp/confirm { code } -> { recovery: [ten codes, shown once] } */
async function totpConfirm(request, env){
  const user = await requireUser(request, env);
  if(!user || user.via === 'apikey') return json({ error: 'unauthorized' }, 401);
  const em = String(user.email).toLowerCase();
  const body = await request.json().catch(() => ({}));
  const lim = await limitAction(env, 'totpset:' + em, 10, 60);
  if(!lim.ok && !lim.unavailable) return json({ error: 'Too many tries. Wait a minute and try again.', code: 'rate_limited' }, 429);
  let pend = null; try{ pend = await connOpen(env, await env.AMV_KV.get('totpset:' + em) || ''); }catch(e){ pend = null; }
  if(!pend || pend.t !== 'totpset') return json({ error: 'That setup has expired. Start again.', code: 'totp_expired' }, 400);
  const step = await _totpCheck(pend.s, body.code, null);
  if(step < 0) return json({ error: 'That code does not match. Check the time on your phone and try the newest code.', code: 'totp_wrong' }, 400);
  const codes = _recoveryNew();
  const hashes = await Promise.all(codes.map(_recoveryHash));
  const sealed = await connSeal(env, { t: 'totp', s: pend.s });
  await _withAcct(env, user.email, (a) => { if(!a) return { error: 'unauthorized', status: 401 }; a.totp = { on: true, sealed, at: Date.now(), last: step }; a.recovery = hashes; });
  try{ await env.AMV_KV.delete('totpset:' + em); }catch(e){}
  audit(env, 'totp_on', { email: em });
  await _userEvent(env, request, em, 'mfa_on', { kind: 'authenticator app' });
  return json({ ok: true, recovery: codes, security: _securityShown(await DB.get(env, 'acct', em)) });
}
/* POST /auth/totp/disable { proof } */
async function totpDisable(request, env){
  const user = await requireUser(request, env);
  if(!user || user.via === 'apikey') return json({ error: 'unauthorized' }, 401);
  const em = String(user.email).toLowerCase();
  const body = await request.json().catch(() => ({}));
  const refused = await _stepUp(env, request, user, body.proof); if(refused) return refused;
  await _withAcct(env, user.email, (a) => { if(!a) return { error: 'unauthorized', status: 401 }; delete a.totp; a.recovery = []; });
  audit(env, 'totp_off', { email: em });
  await _userEvent(env, request, em, 'mfa_off', { kind: 'authenticator app' });
  return json({ ok: true, security: _securityShown(await DB.get(env, 'acct', em)) });
}
/* POST /auth/recovery/new { proof } -> ten new codes; the old ones stop working. */
async function recoveryNew(request, env){
  const user = await requireUser(request, env);
  if(!user || user.via === 'apikey') return json({ error: 'unauthorized' }, 401);
  const em = String(user.email).toLowerCase();
  const body = await request.json().catch(() => ({}));
  const refused = await _stepUp(env, request, user, body.proof); if(refused) return refused;
  const acct = await DB.get(env, 'acct', em);
  if(!_acctFactors(acct).totp) return json({ error: 'Recovery codes come with an authenticator app. Turn that on first.', code: 'totp_off' }, 409);
  const codes = _recoveryNew();
  const hashes = await Promise.all(codes.map(_recoveryHash));
  await _withAcct(env, user.email, (a) => { a.recovery = hashes; });
  audit(env, 'recovery_new', { email: em });
  await _userEvent(env, request, em, 'recovery_codes_new', {});
  return json({ ok: true, recovery: codes, security: _securityShown(await DB.get(env, 'acct', em)) });
}

/* ── The second step at sign-in ────────────────────────────────────────── */
/* Called by a password (or Google) sign-in that has passed, on a device AMV
   has not seen, for an account with an authenticator app. Returns the
   response that asks for the code. */
async function _mfaAsk(env, email, name){
  const id = _b64u.enc(crypto.getRandomValues(new Uint8Array(18)));
  await env.AMV_KV.put('mfachal:' + id, JSON.stringify({ email, name: name || '', attempts: 0 }), { expirationTtl: MFA_CHALLENGE_S });
  return json({ ok: true, needsMfa: true, challenge: id, methods: ['totp', 'recovery'] });
}
/* POST /auth/login/mfa { challenge, code } or { challenge, recovery } */
async function authLoginMfa(request, env){
  const body = await request.json().catch(() => ({}));
  const id = String(body.challenge || '');
  const FAIL = { error: 'That code did not work. Use the newest code from your authenticator app, or a recovery code.', code: 'mfa_wrong' };
  if(!/^[A-Za-z0-9_-]{16,40}$/.test(id)) return json(FAIL, 400);
  let rec = null;
  const r = await _withRecord(env, 'mfachal', id,
    async (e, k) => { try{ return JSON.parse(await e.AMV_KV.get('mfachal:' + k) || 'null'); }catch(x){ return null; } },
    async (e, k, v) => { if(v) await e.AMV_KV.put('mfachal:' + k, JSON.stringify(v), { expirationTtl: MFA_CHALLENGE_S }); },
    (c) => { if(!c) return { error: 'expired', status: 400 }; if(c.attempts >= MFA_ATTEMPTS) return { error: 'too_many', status: 429 }; c.attempts++; rec = c; });
  if(r && r.error) return json(r.error === 'too_many' ? { error: 'Too many tries. Sign in again.', code: 'mfa_locked' }
                                                    : { error: 'That sign-in has expired. Sign in again.', code: 'mfa_expired' }, r.status);
  const em = rec.email;
  const ok = typeof body.recovery === 'string' ? await _recoverySpend(env, em, body.recovery)
           : await _totpSpend(env, em, String(body.code || ''));
  if(!ok){ audit(env, 'auth_fail', { email: em, reason: 'mfa_wrong' }); return json(FAIL, 401); }
  try{ await env.AMV_KV.delete('mfachal:' + id); }catch(e){}
  try{ await _markActive(env, em); }catch(e){}
  await _userEvent(env, request, em, 'signed_in', { via: typeof body.recovery === 'string' ? 'recovery code' : 'authenticator app' });
  return _withDeviceTrust(env, em, _tokenResponse, await issueTokens(env, em, rec.name || '', await _sessOpen(env, request, em)));
}
