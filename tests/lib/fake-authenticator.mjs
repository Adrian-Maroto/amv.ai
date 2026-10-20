/* A PASSKEY AUTHENTICATOR, IN THE TEST.

   Real keys (P-256 or RSA from WebCrypto), real CBOR, real authenticator data
   and real DER signatures - the same bytes a phone or a security key hands a
   browser - so the server's checks are measured against what it will
   actually receive, not against a shape this file made up. Each knob is a way
   a real one, or an attacker's, can differ: another site, another origin, no
   fingerprint, a counter that went backwards. */
import { webcrypto as wc } from 'node:crypto';
const subtle = wc.subtle;

export const b64u = (buf) => Buffer.from(buf).toString('base64url');

/* Just enough CBOR to write what an authenticator writes. */
function cbor(v){
  const out = [];
  const head = (major, n) => {
    if(n < 24) out.push((major << 5) | n);
    else if(n < 256) out.push((major << 5) | 24, n);
    else if(n < 65536) out.push((major << 5) | 25, n >> 8, n & 255);
    else out.push((major << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
  };
  const w = (x) => {
    if(typeof x === 'number'){ if(x >= 0) head(0, x); else head(1, -1 - x); }
    else if(typeof x === 'string'){ const b = Buffer.from(x, 'utf8'); head(3, b.length); out.push(...b); }
    else if(x instanceof Uint8Array){ head(2, x.length); out.push(...x); }
    else if(x instanceof Map){ head(5, x.size); for(const [k, val] of x){ w(k); w(val); } }
    else if(Array.isArray(x)){ head(4, x.length); x.forEach(w); }
    else throw new Error('cbor: ' + typeof x);
  };
  w(v);
  return Uint8Array.from(out);
}
const sha256 = async (d) => new Uint8Array(await subtle.digest('SHA-256', typeof d === 'string' ? Buffer.from(d) : d));
function rawToDer(raw){
  const int = (b) => { let i = 0; while(i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if(b[0] & 0x80) b = Uint8Array.from([0, ...b]); return [0x02, b.length, ...b]; };
  const r = int(raw.slice(0, 32)), s = int(raw.slice(32));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

export async function makeAuthenticator({ kind = 'ec', counter = 0 } = {}){
  const pair = kind === 'ec'
    ? await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    : await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', pair.publicKey);
  const credId = wc.getRandomValues(new Uint8Array(32));
  let count = counter;
  const cose = kind === 'ec'
    ? new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]])
    : new Map([[1, 3], [3, -257], [-1, Buffer.from(jwk.n, 'base64url')], [-2, Buffer.from(jwk.e, 'base64url')]]);
  const authData = async ({ rpId, up = true, uv = true, withCred = false, countOverride }) => {
    const flags = (up ? 1 : 0) | (uv ? 4 : 0) | (withCred ? 64 : 0);
    const c = countOverride != null ? countOverride : count;
    const parts = [...(await sha256(rpId)), flags, (c >>> 24) & 255, (c >> 16) & 255, (c >> 8) & 255, c & 255];
    if(withCred) parts.push(...new Uint8Array(16), credId.length >> 8, credId.length & 255, ...credId, ...cbor(cose));
    return Uint8Array.from(parts);
  };
  return {
    credId: b64u(credId),
    /* What navigator.credentials.create hands the page, as the page sends it on. */
    async create({ challenge, origin, rpId, type = 'webauthn.create', up, uv, idOverride }){
      const clientDataJSON = Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
      const ad = await authData({ rpId, up, uv, withCred: true });
      const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]));
      return { id: idOverride || b64u(credId), rawId: idOverride || b64u(credId), type: 'public-key',
        response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject) } };
    },
    /* What navigator.credentials.get hands the page. */
    async get({ challenge, origin, rpId, type = 'webauthn.get', up, uv, countOverride, tamper }){
      if(countOverride == null) count += 1;
      const clientDataJSON = Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
      const ad = await authData({ rpId, up, uv, countOverride });
      const signed = Uint8Array.from([...ad, ...(await sha256(clientDataJSON))]);
      let sig = new Uint8Array(kind === 'ec'
        ? await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, signed)
        : await subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, pair.privateKey, signed));
      if(kind === 'ec') sig = rawToDer(sig);
      if(tamper) sig[sig.length - 1] ^= 1;
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key',
        response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(ad), signature: b64u(sig), userHandle: '' } };
    },
  };
}
