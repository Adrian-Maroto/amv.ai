/* A DEVICE IS TOLD, AND ONLY WHAT A LOCK SCREEN MAY SHOW.

   Oct 31 production audit, "mobile push": background jobs finish while nobody
   has AMV open. With a VAPID key pair set (81-web-push.js), a device that said
   yes is told. Driven here as a real browser would be: the suite makes the
   device's own key pair, and decrypts what the Worker sends with the steps of
   RFC 8291 written out on its own, so a wrong label or step on the server
   fails to decrypt rather than passing. What has to be true:
     - with no keys, nothing is offered and nothing is sent;
     - only a browser maker's push service is accepted as an address - never
       one somebody chose, never plain http - and the keys must be real;
     - at most ten devices; the oldest goes first;
     - a job that finishes tells the device, signed as AMV (a valid ES256
       token for that push service), encrypted for that device only;
     - it names the job and never the result;
     - a device the push service says is gone is forgotten;
     - "sign out everywhere" and deleting the account forget every device. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { webcrypto as C } from 'crypto';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'webpush.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { runDueAutomations, issueTokens, revokeUserTokens };\n');
const W = await import(harness + '?t=' + Date.now());

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
const quiet = console.log; const audits = [];
console.log = (...a) => { const s = a.join(' '); if (s.startsWith('AUDIT')) { try { audits.push(JSON.parse(s.slice(6))); } catch (e) {} return; } quiet(...a); };

/* AMV's key pair, made the way tools/vapid-keys.mjs makes it. */
const vk = await C.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const VAPID_PUBLIC_KEY = b64u(new Uint8Array(await C.subtle.exportKey('raw', vk.publicKey)));
const VAPID_PRIVATE_KEY = (await C.subtle.exportKey('jwk', vk.privateKey)).d;

/* A browser: its own key pair and secret, as PushManager.subscribe makes. */
async function device(endpoint) {
  const kp = await C.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await C.subtle.exportKey('raw', kp.publicKey));
  const auth = C.getRandomValues(new Uint8Array(16));
  return { kp, pub, auth, sub: { endpoint, keys: { p256dh: b64u(pub), auth: b64u(auth) } } };
}
const hmac = async (key, data) => new Uint8Array(await C.subtle.sign('HMAC', await C.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data));
const cat = (...p) => { const o = new Uint8Array(p.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const te = (s) => new TextEncoder().encode(s);
/* RFC 8291 section 3, from the receiving side. */
async function decrypt(dev, body) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asKey = await C.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await C.subtle.deriveBits({ name: 'ECDH', public: asKey }, dev.kp.privateKey, 256));
  const ikm = await hmac(await hmac(dev.auth, shared), cat(te('WebPush: info\0'), dev.pub, asPub, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(te('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(te('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const pt = new Uint8Array(await C.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await C.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
  if (pt[pt.length - 1] !== 2) throw new Error('no last-record delimiter');
  return JSON.parse(new TextDecoder().decode(pt.slice(0, -1)));
}
/* RFC 8292: the token is a valid ES256 JWT, for that push service, signed by AMV. */
async function vapidOk(header, endpoint) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header || '');
  if (!m || m[2] !== VAPID_PUBLIC_KEY) return false;
  const [h, c, s] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  const good = await C.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vk.publicKey, unb64u(s), te(h + '.' + c));
  return good && claims.aud === new URL(endpoint).origin && claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86400 && /^(mailto:|https:)/.test(claims.sub);
}

const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  AMV_MODEL_KEY: 'k', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
  AMV_KV: { async get(k){ return store.has(k) ? store.get(k) : null; }, async put(k, v){ store.set(k, v); }, async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
const ctx = { waitUntil(){}, passThroughOnException(){} };
const ME = 'ada@test.com';
store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
let tok = (await W.issueTokens(env, ME, 'Ada')).token;
let ip = 1;
const call = async (path, body) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.5.' + (ip++ % 250) },
    body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};

/* The network: the model, and the push services (recorded, with an answer
   the test chooses per address). */
const pushes = []; const pushAnswer = new Map();
globalThis.fetch = async (u, init) => {
  const url = String(u);
  if (/push\.services\.mozilla\.com|fcm\.googleapis\.com|push\.apple\.com|notify\.windows\.com/.test(url)) {
    pushes.push({ url, headers: init.headers, body: new Uint8Array(init.body) });
    return new Response('', { status: pushAnswer.get(url) || 201 });
  }
  return new Response(JSON.stringify({ content: [{ type: 'text', text: 'SECRET-FINDING: your rent went up 40 percent.' }], stop_reason: 'end_turn',
    usage: { input_tokens: 2000, output_tokens: 800 } }), { status: 200 });
};

section('With no keys, nothing is offered and nothing is sent');
{
  const saved = [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY];
  delete env.VAPID_PUBLIC_KEY; delete env.VAPID_PRIVATE_KEY;
  const s = await call('/v1/push');
  const d = await device('https://fcm.googleapis.com/fcm/send/none');
  const sub = await call('/v1/push/subscribe', { subscription: d.sub });
  ok(s.status === 200 && s.d.on === false && sub.status === 503 && sub.d.code === 'needs_service', 'off, and it says so', [s.d, sub.status]);
  [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY] = saved;
}

const phone = await device('https://fcm.googleapis.com/fcm/send/phone-1');
section('Only a browser maker’s push service is accepted, with real keys');
{
  for (const bad of ['https://evil.example/push', 'http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com.evil.example/x',
                     'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://169.254.169.254/latest']) {
    const d = await device(bad);
    const r = await call('/v1/push/subscribe', { subscription: d.sub });
    ok(r.status === 400 && r.d.code === 'push_endpoint', 'refused: ' + bad, r.status);
  }
  const r = await call('/v1/push/subscribe', { subscription: { endpoint: phone.sub.endpoint, keys: { p256dh: 'abc', auth: 'def' } } });
  ok(r.status === 400 && r.d.code === 'push_keys', 'keys that are not a device’s keys are refused', r.status);
  const good = await call('/v1/push/subscribe', { subscription: phone.sub, label: 'Android' });
  ok(good.status === 200 && good.d.devices === 1, 'a real one is added', good.d);
  const st = await call('/v1/push');
  ok(st.d.on && st.d.key === VAPID_PUBLIC_KEY && st.d.devices === 1 && !JSON.stringify(st.d).includes(phone.sub.keys.auth),
     'the status names the device’s service, never its keys', st.d);
}

section('At most ten devices; the oldest goes first');
{
  for (let i = 0; i < 11; i++) await call('/v1/push/subscribe', { subscription: (await device('https://updates.push.services.mozilla.com/wpush/v2/d' + i)).sub });
  const rec = JSON.parse(store.get('push:' + ME));
  ok(rec.devices.length === 10 && !rec.devices.some(d => d.endpoint === phone.sub.endpoint) && rec.devices.some(d => /d10$/.test(d.endpoint)),
     'ten kept, the newest ones', rec.devices.map(d => d.endpoint.slice(-4)));
  await call('/v1/push/unsubscribe', { all: true });
  /* This phone's page was in Spanish when it said yes. */
  await call('/v1/push/subscribe', { subscription: phone.sub, lang: 'es' });
}
/* And a laptop that said yes in English (stored as the route stores it). */
const laptop = await device('https://wns2-par02p.notify.windows.com/w/?token=laptop');
{
  const rec = JSON.parse(store.get('push:' + ME));
  rec.devices.push({ endpoint: laptop.sub.endpoint, p256dh: laptop.sub.keys.p256dh, auth: laptop.sub.keys.auth, added: Date.now(), lang: 'en' });
  store.set('push:' + ME, JSON.stringify(rec));
}

section('A job that finishes tells the device: signed as AMV, encrypted for it, naming the job and never the result');
{
  const c = await call('/auto/create', { detail: 'Check my rent statement', repeat: 'daily', approval: 'auto' });
  const r = JSON.parse(store.get('auto:' + ME)); r.items.forEach(i => { i.next = Date.now() - 1000; }); store.set('auto:' + ME, JSON.stringify(r));
  pushes.length = 0;
  await W.runDueAutomations(env, Date.now());
  const p = pushes.find(x => x.url === phone.sub.endpoint);
  ok(c.status === 200 && p, 'the device was sent one notification', { created: c.status, pushes: pushes.length });
  ok(p && p.headers['Content-Encoding'] === 'aes128gcm' && +p.headers.TTL > 0, 'encrypted content, with a time to live', p && p.headers);
  ok(p && await vapidOk(p.headers.Authorization, p.url), 'signed by AMV’s key, for that push service, expiring within a day');
  let note = null; try { note = await decrypt(phone, p.body); } catch (e) { note = { error: e.message }; }
  ok(note && /^Listo: Check my rent statement$/.test(note.body), 'the device can read it, and it names the job - in the language it said yes in', note);
  const lp = pushes.find(x => x.url === laptop.sub.endpoint);
  let lnote = null; try { lnote = lp && await decrypt(laptop, lp.body); } catch (e) { lnote = { error: e.message }; }
  ok(lnote && /^Ready: Check my rent statement$/.test(lnote.body), 'and the English laptop in English, from the same run', lnote);
  ok(note && !JSON.stringify(note).includes('SECRET-FINDING') && !/40 percent/.test(JSON.stringify(note)), 'and never what the job found');
  const other = await device('https://fcm.googleapis.com/fcm/send/someone-else');
  let leaked = true; try { await decrypt(other, p.body); } catch (e) { leaked = false; }
  ok(!leaked, 'another device cannot read it');
}

section('A device the push service says is gone is forgotten');
{
  pushAnswer.set(phone.sub.endpoint, 410);
  const t = await call('/v1/push/test', {});
  const rec = JSON.parse(store.get('push:' + ME) || '{"devices":[]}');
  ok(t.d.gone === 1 && !rec.devices.some(d => d.endpoint === phone.sub.endpoint), 'removed after the service said 410', t.d);
  pushAnswer.delete(phone.sub.endpoint);
}

section('Sign out everywhere, and deleting the account, forget every device');
{
  /* Twenty changes a minute is the limit, and this suite has used them:
     the 21st is refused, as it should be. */
  const over = await call('/v1/push/subscribe', { subscription: phone.sub });
  ok(over.status === 429, 'a twenty-first change in a minute is refused', over.status);
  store.set('push:' + ME, JSON.stringify({ devices: [{ endpoint: phone.sub.endpoint, p256dh: phone.sub.keys.p256dh, auth: phone.sub.keys.auth, added: Date.now() }] }));
  ok(JSON.parse(store.get('push:' + ME)).devices.length === 1, 'a device is there');
  await W.revokeUserTokens(env, ME);
  ok(!store.has('push:' + ME) || JSON.parse(store.get('push:' + ME)).devices.length === 0, '"sign out everywhere": gone');
  /* Signed up properly, so the account can be deleted the real way. */
  const PW = 'a long enough passphrase here';
  const s = await W.default.fetch(new Request('https://api.amv.test/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.4.1' },
    body: JSON.stringify({ email: 'bo@test.com', name: 'Bo', password: PW }) }), env, ctx);
  tok = (await s.json()).token;
  await call('/v1/push/subscribe', { subscription: (await device('https://web.push.apple.com/bo-phone')).sub });
  ok(store.has('push:bo@test.com'), 'a second account adds an iPhone');
  const del = await call('/auth/delete', { password: PW });
  ok(del.status === 200 && !store.has('push:bo@test.com'), 'deleting that account deletes its devices', del.status);
}

console.log = quiet;
if (report('a-device-is-told-only-what-a-lock-screen-may-show') > 0) process.exitCode = 1;
done();
