/* THE VERIFIER WAS RELAXED ABOUT EXACTLY THE THINGS A TOKEN MIGHT OMIT.

   `if (data.exp && nowSec > data.exp)`. `if (data.typ && expectedTyp && ...)`.
   Read them again: a token that carries neither claim passes both checks. The
   verifier was strict about what a token SAID and silent about what it did not
   say, which is the wrong way round - what a credential leaves out is precisely
   what a verifier must not be relaxed about.

   What that would buy, for a token that lacked them. No `exp` is a session that
   never ends: the revocation epoch still catches a deliberate sign-out, and
   nothing else does, so "valid for ever unless somebody notices" is what a
   session means. No `typ` is worse, because the two tokens differ in that field
   and nothing else - without it the month-long refresh token is accepted
   everywhere the fifteen-minute access token is, and having two stops meaning
   anything.

   signToken has always set all three, so nothing could reach this today. It was
   reachable by one future issuing path that forgot one field, and it would have
   failed open, silently, in the direction of a longer session.

   AND THE REDIRECT (AMV-SP-08). The Google OAuth exchange checked the caller's
   redirect_uri against the app's own address with `indexOf(allowed) !== 0` -
   a string prefix, not an origin. `https://amv.homes.attacker.example` starts
   with `https://amv.homes` and is not it, and so does `https://amv.homes@evil`,
   where the browser sends the authorisation code to `evil`.

   AND THE SHARE LINK (AMV-055). A share id is a bearer capability - whoever has
   it reads the conversation, because the whole point is that it works for
   somebody with no account. So the id is the password, and it was about fifty
   bits. Not from a weak source, but from an encoding that threw most of it
   away: nine random bytes rendered two characters each and then cut in half,
   with the first character of every pair only able to be 0-7. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'claims.harness.mjs');
writeFileSync(harness, src +
  '\nexport { signToken, verifyToken, issueTokens, _sameOrigin, _shareId, _randId,' +
  ' TOKEN_VER, JWT_ALG };\n');
const W = await import(harness + '?t=' + Date.now());

const SECRET = 'a-real-looking-secret-value-for-tests';
const env = null;   // no revocation lookup; this file is about the claims themselves

/* Build a token by hand so a claim can be LEFT OUT, which is the whole
   question. Signed with the real secret, so everything except the missing
   claim is exactly as valid as a token AMV issues. */
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
async function handMade(payload) {
  const header = b64({ alg: W.JWT_ALG, typ: 'JWT' });
  const body = b64(payload);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(header + '.' + body)));
  const sig = Buffer.from(mac).toString('base64url');
  return header + '.' + body + '.' + sig;
}
const now = () => Math.floor(Date.now() / 1000);
const full = (over = {}) => Object.assign({
  email: 'me@example.com', name: 'Me', typ: 'access', ver: W.TOKEN_VER,
  epoch: 0, iat: now(), nbf: now(), exp: now() + 900, jti: 'j1',
}, over);

section('A token AMV issued still works, which is what all of this guards');
{
  const t = await W.signToken({ email: 'me@example.com' }, SECRET, { typ: 'access', epoch: 0 });
  const d = await W.verifyToken(t, SECRET, env, 'access');
  ok(!!d, 'it verifies', d && d.email);
  ok(d.email === 'me@example.com', 'as the person it names', d && d.email);

  const hand = await handMade(full());
  ok(!!(await W.verifyToken(hand, SECRET, env, 'access')),
     'and so does an equivalent one built here, so the fixtures below are honest');
}

section('THE FINDING: a token with no expiry is not a session');
{
  const p = full();
  delete p.exp;
  const t = await handMade(p);
  ok((await W.verifyToken(t, SECRET, env, 'access')) === null,
     'a token that never says when it ends is refused', t.slice(0, 24));

  for (const bad of [null, 'soon', NaN, Infinity, {}, []]) {
    const q = await handMade(full({ exp: bad }));
    ok((await W.verifyToken(q, SECRET, env, 'access')) === null,
       'and so is one whose expiry is ' + JSON.stringify(bad), bad);
  }

  const expired = await handMade(full({ exp: now() - 10 }));
  ok((await W.verifyToken(expired, SECRET, env, 'access')) === null,
     'while a real expiry in the past still refuses, as it always did');
}

section('And a token with no kind is not the kind you asked for');
{
  /* The two tokens differ in this field and nothing else. Without it, the
     month-long one is accepted wherever the fifteen-minute one is. */
  const p = full();
  delete p.typ;
  const t = await handMade(p);
  ok((await W.verifyToken(t, SECRET, env, 'access')) === null, 'a token with no kind is refused for access');
  ok((await W.verifyToken(t, SECRET, env, 'refresh')) === null, 'and for refresh');

  const refresh = await handMade(full({ typ: 'refresh' }));
  ok((await W.verifyToken(refresh, SECRET, env, 'access')) === null,
     'a refresh token is still not an access token');
  ok(!!(await W.verifyToken(refresh, SECRET, env, 'refresh')),
     'and is still itself where a refresh token belongs');

  const notAString = await handMade(full({ typ: 42 }));
  ok((await W.verifyToken(notAString, SECRET, env, 'access')) === null,
     'a kind that is not a name is refused rather than coerced');
}

section('A not-yet-valid time is required too, and still allows for clock skew');
{
  const p = full();
  delete p.nbf;
  ok((await W.verifyToken(await handMade(p), SECRET, env, 'access')) === null,
     'a token that does not say when it starts is refused');

  const future = await handMade(full({ nbf: now() + 600 }));
  ok((await W.verifyToken(future, SECRET, env, 'access')) === null,
     'one that starts in ten minutes is not valid yet');

  const skew = await handMade(full({ nbf: now() + 30 }));
  ok(!!(await W.verifyToken(skew, SECRET, env, 'access')),
     'while thirty seconds ahead still works, because clocks disagree by that much');
}

section('And none of it can be reached by changing the header');
{
  /* The checks above are about the payload. The header pin is what stops the
     signature being skipped altogether, and it has to keep holding. */
  const t = await handMade(full());
  const [h, b, s] = t.split('.');
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  ok((await W.verifyToken([none, b, s].join('.'), SECRET, env, 'access')) === null, 'alg:none is refused');
  const rs = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  ok((await W.verifyToken([rs, b, s].join('.'), SECRET, env, 'access')) === null, 'and so is RS256 confusion');
  ok((await W.verifyToken(t, 'the-wrong-secret-entirely', env, 'access')) === null, 'and a wrong key');
  ok((await W.verifyToken(h + '.' + b + '.' + s.slice(0, -2) + 'aa', SECRET, env, 'access')) === null,
     'and a tampered signature');
}

section('A redirect target is compared as an origin, not as a prefix');
{
  const APP = 'https://amv.homes';
  ok(W._sameOrigin(APP + '/auth/callback', APP) === true, 'our own callback path is allowed');
  ok(W._sameOrigin(APP, APP) === true, 'and the bare origin');
  ok(W._sameOrigin(APP + '/a/b/c?x=1#y', APP) === true, 'and any path, query or fragment under it');

  /* THE FINDING. Every one of these passes a prefix check. */
  for (const evil of [
    'https://amv.homes.attacker.example/steal',
    'https://amv.homes.evil.co',
    'https://amv.homes@attacker.example/steal',
    'https://amv.homesX/steal',
    'https://amv.homes-attacker.example',
  ]) {
    ok(W._sameOrigin(evil, APP) === false, 'refused: ' + evil, evil);
    ok(evil.indexOf(APP) === 0, '  (and it really does pass a prefix check, which is the point)', evil);
  }

  ok(W._sameOrigin('http://amv.homes/x', APP) === false, 'a different scheme is a different origin');
  ok(W._sameOrigin('https://amv.homes:8443/x', APP) === false, 'and a different port');
  ok(W._sameOrigin('https://other.example/x', APP) === false, 'and an unrelated host');
  ok(W._sameOrigin('not a url', APP) === false, 'nonsense is refused rather than throwing');
  ok(W._sameOrigin('', APP) === false, 'and so is nothing at all');
  ok(W._sameOrigin('javascript:alert(1)', APP) === false, 'and a scheme that is not the web');

  const handler = codeOnly(functionBody(src, 'googleOAuthExchange') || codeOnly(src));
  ok(!/redirectUri\.indexOf\(allowed\) !== 0/.test(codeOnly(src)),
     'the prefix comparison is gone from the source, not merely wrapped', true);
  ok(/_sameOrigin\(redirectUri, allowed\)/.test(codeOnly(src)),
     'and the origin comparison is what the exchange uses', true);
}

section('A share link is long enough to be a password, because it is one');
{
  const id = W._shareId();
  ok(/^[a-z0-9]+$/.test(id), 'it is a plain identifier', id);
  ok(id.length >= 20, 'and it is long', id.length);

  /* Bits, said plainly: 36 possibilities per character. Twenty-two of them is
     over a hundred and thirteen, which nobody is guessing. The old one was
     fourteen characters of a skewed alphabet, worth about fifty. */
  const bits = id.length * Math.log2(36);
  ok(bits >= 100, 'which is more than a hundred bits of it', Math.round(bits));

  const many = new Set();
  for (let i = 0; i < 3000; i++) many.add(W._shareId());
  ok(many.size === 3000, 'three thousand of them are three thousand different ids', many.size);

  /* Evenly distributed, which is the part the old encoding got wrong: its first
     character of each pair could only be 0-7. A modulo over 256 would make the
     same class of mistake more quietly, so the generator rejects and redraws. */
  const first = new Map();
  for (const s of many) first.set(s[0], (first.get(s[0]) || 0) + 1);
  ok(first.size >= 30, 'the first character really uses the alphabet', first.size);
  const counts = [...first.values()];
  const expected = 3000 / 36;
  ok(Math.max(...counts) < expected * 2.2 && Math.min(...counts) > expected * 0.35,
     'and no character is much more likely than another',
     { min: Math.min(...counts), max: Math.max(...counts), expected: Math.round(expected) });

  ok(!/Math\.random/.test(codeOnly(functionBody(src, '_randId') || '')),
     'none of it comes from Math.random', true);
  ok(/crypto\.getRandomValues/.test(codeOnly(functionBody(src, '_randId') || '')),
     'it comes from the cryptographic source', true);
}

if (report('what-a-token-does-not-say') > 0) process.exitCode = 1;
done();
