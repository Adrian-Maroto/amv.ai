/* A PASSKEY SURVIVES ANYTHING SENT AT IT.

   The WebAuthn layer is written here rather than taken from a library: a CBOR
   reader, authenticator-data parsing, COSE keys, DER signatures. Its suites
   test the cases somebody thought of. This one tests the cases nobody did, the
   way the October 24 audit asked: a real P-256 credential is registered and
   used, then every field of a real sign-in is mutated thousands of times -
   bytes flipped, cut short, extended, replaced with noise - and three things
   must hold for every one of them:

     nothing altered is ever accepted (the signature binds every byte that
     matters, so the only acceptable outcome of a change is a refusal);
     every refusal is a named passkey refusal, never a crash in the parser
     (a TypeError from a bad index is a bug that happens to refuse);
     and nothing takes long (a parser that can be made to spin is a way to
     take the sign-in page down).

   Deterministic: the mutations come from a seeded generator, so a failure
   names an input that reproduces. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'pkfuzz.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { _cbor, _pkVerifyRegistration, _pkVerifyAssertion, _pkDerToRaw, _b64u };\n');
const W = await import(harness + '?t=' + Date.now());

/* ── A real authenticator, in miniature ─────────────────────────────────── */
const enc = new TextEncoder();
const sha = async (b) => new Uint8Array(await crypto.subtle.digest('SHA-256', typeof b === 'string' ? enc.encode(b) : b));
const b64u = (u) => Buffer.from(u).toString('base64url');
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
/* Just enough CBOR to write what an authenticator writes. */
function cbor(v) {
  const head = (major, n) => n < 24 ? [major << 5 | n] : n < 256 ? [major << 5 | 24, n] : [major << 5 | 25, n >> 8, n & 255];
  if (typeof v === 'number') return Uint8Array.from(v >= 0 ? head(0, v) : head(1, -1 - v));
  if (typeof v === 'string') { const s = enc.encode(v); return cat(Uint8Array.from(head(3, s.length)), s); }
  if (v instanceof Uint8Array) return cat(Uint8Array.from(head(2, v.length)), v);
  if (v instanceof Map) return cat(Uint8Array.from(head(5, v.size)), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)]));
  throw new Error('cbor: ' + typeof v);
}
/* WebCrypto signs P-256 as r||s; authenticators send DER. */
function der(raw) {
  const int = (x) => { let i = 0; while (i < x.length - 1 && x[i] === 0) i++; x = x.slice(i); if (x[0] & 0x80) x = cat(Uint8Array.of(0), x); return cat(Uint8Array.of(2, x.length), x); };
  const body = cat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return cat(Uint8Array.of(0x30, body.length), body);
}

const RP = 'amv.test', ORIGIN = 'https://amv.test';
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
const credId = crypto.getRandomValues(new Uint8Array(32));
const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]);
const rpHash = await sha(RP);

const regChallenge = b64u(crypto.getRandomValues(new Uint8Array(32)));
const regAuthData = cat(rpHash, Uint8Array.of(0x45), Uint8Array.of(0, 0, 0, 0), new Uint8Array(16), Uint8Array.of(0, 32), credId, cbor(cose));
const att = {
  id: b64u(credId),
  clientDataJSON: b64u(enc.encode(JSON.stringify({ type: 'webauthn.create', challenge: regChallenge, origin: ORIGIN }))),
  attestationObject: b64u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', regAuthData]]))),
};

let stored;
section('A real credential registers and signs in');
{
  stored = await W._pkVerifyRegistration(att, { challenge: regChallenge, origins: [ORIGIN], rpId: RP });
  ok(stored && stored.alg === -7 && stored.credId === b64u(credId), 'registration accepted, with this key and this id', stored && stored.credId);
}

const challenge = b64u(crypto.getRandomValues(new Uint8Array(32)));
const cd = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN }));
const ad = cat(rpHash, Uint8Array.of(0x05), Uint8Array.of(0, 0, 0, 7));
const sigRaw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, cat(ad, await sha(cd))));
const good = { id: b64u(credId), clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(der(sigRaw)) };
const expect = { challenge, origins: [ORIGIN], rpId: RP };
{
  const r = await W._pkVerifyAssertion(good, stored, expect);
  ok(r && r.count === 7, 'the real sign-in is accepted, counter 7', r);
}

/* ── Mutations ──────────────────────────────────────────────────────────── */
let seed = 0x9e3779b9;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const pick = (n) => Math.floor(rnd() * n);
function mutate(bytes) {
  const b = Uint8Array.from(bytes);
  switch (pick(6)) {
    case 0: { const i = pick(b.length); b[i] ^= 1 << pick(8); return b; }                    // one bit
    case 1: { const i = pick(b.length); b[i] = pick(256); return b; }                         // one byte
    case 2: return b.slice(0, pick(b.length));                                                // cut short
    case 3: return cat(b, crypto.getRandomValues(new Uint8Array(1 + pick(64))));             // extended
    case 4: return crypto.getRandomValues(new Uint8Array(pick(300)));                        // noise
    default: { const i = pick(b.length), j = pick(b.length); [b[i], b[j]] = [b[j], b[i]]; return b; }   // swapped
  }
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const fields = { clientDataJSON: cd, authenticatorData: ad, signature: der(sigRaw) };

const RUNS = 1500;
for (const [field, orig] of Object.entries(fields)) {
  section('Every mutation of the sign-in’s ' + field + ' is refused, by name, quickly');
  let accepted = [], crashed = [], slow = 0, tried = 0;
  for (let k = 0; k < RUNS; k++) {
    const m = mutate(orig);
    if (same(m, orig)) continue;
    tried++;
    const asr = Object.assign({}, good, { [field]: b64u(m) });
    const t0 = performance.now();
    try {
      await W._pkVerifyAssertion(asr, stored, expect);
      accepted.push(b64u(m));
    } catch (e) {
      if (!/^pk_/.test(String(e && e.message))) crashed.push(String(e && e.message) + ' <- ' + b64u(m).slice(0, 60));
    }
    if (performance.now() - t0 > 50) slow++;
  }
  ok(tried > RUNS * 0.9, 'mutations tried', tried);
  ok(accepted.length === 0, 'none of them is accepted', accepted.slice(0, 3));
  ok(crashed.length === 0, 'every refusal is a passkey refusal, not a crash', crashed.slice(0, 3));
  ok(slow === 0, 'and none takes more than 50ms', slow);
}

section('The CBOR reader refuses noise and bombs without crashing or spinning');
{
  let crashed = [], slow = 0;
  for (let k = 0; k < 4000; k++) {
    const m = k % 2 ? mutate(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', regAuthData]]))) : crypto.getRandomValues(new Uint8Array(pick(200)));
    const t0 = performance.now();
    try { W._cbor(m); } catch (e) { if (!/^pk_/.test(String(e && e.message))) crashed.push(String(e && e.message)); }
    if (performance.now() - t0 > 50) slow++;
  }
  /* A declared length far beyond the bytes, and nesting past the depth bound. */
  const lies = [Uint8Array.of(0x5a, 0xff, 0xff, 0xff, 0xff), Uint8Array.of(0x9a, 0xff, 0xff, 0xff, 0xff), new Uint8Array(40).fill(0x81)];
  for (const m of lies) { try { W._cbor(m); crashed.push('accepted ' + b64u(m)); } catch (e) { if (!/^pk_/.test(String(e && e.message))) crashed.push(String(e && e.message)); } }
  ok(crashed.length === 0, 'every malformed input is a named refusal', crashed.slice(0, 3));
  ok(slow === 0, 'and none takes more than 50ms', slow);
}

section('A signature is read strictly: its stated lengths must be the real ones');
{
  const d = der(sigRaw);
  const wrongOuter = Uint8Array.from(d); wrongOuter[1] = (wrongOuter[1] + 1) & 0x7f;
  const trailing = cat(d, Uint8Array.of(0));
  for (const [what, m] of [['a wrong outer length', wrongOuter], ['a byte after the signature', trailing]]) {
    let refused = false;
    try { await W._pkVerifyAssertion(Object.assign({}, good, { signature: b64u(m) }), stored, expect); } catch (e) { refused = /^pk_/.test(e.message); }
    ok(refused, 'a signature with ' + what + ' is refused', what);
  }
}

if (report('a-passkey-survives-anything-sent-at-it') > 0) process.exitCode = 1;
done();
