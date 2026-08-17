/* THE SELLER DECIDED WHETHER YOU COULD REVIEW THEM.

   Reviewing a seller was proved by walking the buyer's purchases and reading
   each LISTING to see who wrote it. So the proof depended on the listing still
   existing - and the person who decides whether it exists is the seller being
   reviewed. Take the item down and every buyer of it silently loses the ability
   to say anything about you.

   That is the one thing a reputation system must not let a seller do, and it
   needs no exploit: it is the "delete listing" button, used by somebody who has
   just had a bad week. The same happens by accident when moderation removes an
   item, or when a restore does not bring one back - the reviews of that seller
   quietly become unwritable, and nobody sees an error, because the buyer just
   gets "you can only review sellers you've bought from".

   Rating had the same shape one step earlier: the entitlement proving the
   purchase survives, and the handler then read the listing and answered 404.

   Who somebody bought from is a fact about the TRANSACTION. It belongs with the
   transaction, where the seller cannot reach it.

   AND THE SALT EVERY DEPLOYMENT SHARED (AMV-048). Mail passwords are encrypted
   with a key derived from MAIL_CRED_KEY over a hard-coded salt -
   'amv-mail-credentials-v1', the same string in every copy of AMV that has ever
   run. A salt exists to make precomputation useless, and a constant one in
   shipped source is a constant an attacker has too: work done once applies to
   every instance at the same time. The only check on the secret itself was that
   it was sixteen characters long, so sixteen letter As passed. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'sellerdel.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, issueTokens, marketRate, marketReview,' +
  ' _mailEncrypt, _mailDecrypt, _mailCredWeak, MAIL_CRED_MIN };\n');
const W = await import(harness + '?t=' + Date.now());

const SELLER = 'seller@example.com';
const BUYER = 'buyer@example.com';
const ITEM = 'usr_thing1';

function mkEnv() {
  const m = new Map(); const vals = new Map();
  return {
    JWT_SECRET: 'x'.repeat(40), _map: m,
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, String(v)); },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) {
        return { keys: [...m.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'claim') { if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false })); vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true, owner: 'o' })); }
        if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ released: true })); }
        if (b.op === 'rateCheck') { const nx = cur + 1; vals.set(n, nx); return new Response(JSON.stringify({ allowed: nx <= (b.limit || 9999) })); }
        if (b.op === 'reserve') { const nx = cur + (b.amount || 0); if (nx > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur })); vals.set(n, nx); return new Response(JSON.stringify({ allowed: true, value: nx })); }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}

/* A sale, recorded the way marketFulfil records one. */
async function sell(env, { withSeller = true } = {}) {
  env._map.set(`market:${ITEM}`, JSON.stringify({
    id: ITEM, title: 'A Thing', kind: 'prompt', price: 9, authorEmail: SELLER, status: 'active',
  }));
  env._map.set(`entitleitem:${BUYER}:${ITEM}`, '1');
  env._map.set(`purchases:${BUYER}`, JSON.stringify([
    Object.assign({ id: ITEM, title: 'A Thing', kind: 'prompt', price: 9, ts: Date.now() },
                  withSeller ? { seller: SELLER } : {}),
  ]));
  await W.DB.put(env, 'mktsnap', `${BUYER}:${ITEM}`,
    { id: ITEM, title: 'A Thing', kind: 'prompt', price: 9, authorEmail: SELLER, _boughtAt: Date.now() });
}
const takeDown = (env) => env._map.delete(`market:${ITEM}`);
const tokFor = async (env, email) => (await W.issueTokens(env, email, 'U')).token;
const post = async (env, fn, body, email) => {
  const r = await fn(new Request('https://api.amv.test/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '8.8.4.4',
               Authorization: 'Bearer ' + (await tokFor(env, email)) },
    body: JSON.stringify(body),
  }), env);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

section('A buyer can review the seller they bought from, which is the feature');
{
  const env = mkEnv();
  await sell(env);
  const r = await post(env, W.marketReview, { seller: SELLER, stars: 5, text: 'Genuinely good' }, BUYER);
  ok(r.status === 200, 'the review is accepted', { status: r.status, err: r.body.error });
}

section('THE FINDING: taking the listing down does not take the review with it');
{
  const env = mkEnv();
  await sell(env);
  takeDown(env);

  const r = await post(env, W.marketReview, { seller: SELLER, stars: 1, text: 'Did not deliver' }, BUYER);
  ok(r.status === 200, 'the buyer can still say what they thought', { status: r.status, err: r.body.error });
  ok(!/only review sellers/.test(r.body.error || ''), 'and is not told they never bought anything', r.body.error);
}

section('And rating survives it too');
{
  const env = mkEnv();
  await sell(env);
  const before = await post(env, W.marketRate, { id: ITEM, stars: 5 }, BUYER);
  ok(before.status === 200, 'a rating works while the listing is up', before.status);

  takeDown(env);
  const after = await post(env, W.marketRate, { id: ITEM, stars: 2 }, BUYER);
  ok(after.status === 200, 'and still works once it is gone', { status: after.status, err: after.body.error });
  ok(after.status !== 404, 'rather than answering that the thing they paid for does not exist', after.status);
}

section('A purchase made before this was recorded still counts');
{
  /* Every sale already on the books predates the seller being written down, so
     a fix that only reads the new field silently keeps the defect for every
     existing customer. */
  const env = mkEnv();
  await sell(env, { withSeller: false });
  takeDown(env);
  const r = await post(env, W.marketReview, { seller: SELLER, stars: 4, text: 'Bought this last year' }, BUYER);
  ok(r.status === 200, 'the snapshot taken at purchase stands in for the listing',
     { status: r.status, err: r.body.error });
}

section('And it is still not open to somebody who bought nothing');
{
  /* A control that stops being a control is not a fix. */
  const env = mkEnv();
  await sell(env);
  const r = await post(env, W.marketReview, { seller: SELLER, stars: 5, text: 'Never bought it' }, 'stranger@example.com');
  ok(r.status === 403, 'a stranger cannot review a seller', r.status);
  ok(/only review sellers/.test(r.body.error || ''), 'and is told why', r.body.error);

  const other = await post(env, W.marketReview, { seller: 'someone-else@example.com', stars: 5, text: 'x' }, BUYER);
  ok(other.status === 403, 'nor can a real buyer review a seller they never bought from', other.status);

  const notMine = await post(env, W.marketRate, { id: 'usr_other', stars: 5 }, BUYER);
  ok(notMine.status === 403, 'and rating still needs the purchase', notMine.status);
}

section('Who you bought from is written down with the purchase');
{
  const fulfil = codeOnly(src);
  ok(/seller: sellerEmail \|\| \(it \? String\(it\.authorEmail \|\| ''\)\.toLowerCase\(\) : ''\)/.test(fulfil),
     'the sale records the seller', true);
  const review = codeOnly(functionBody(src, 'marketReview') || '');
  ok(/String\(p\.seller \|\| ''\)\.toLowerCase\(\) === sellerEmail/.test(review),
     'and the review reads it from there first', true);
  ok(review.indexOf('p.seller') < review.indexOf('_getListing'),
     'before it falls back to a record the seller controls',
     { seller: review.indexOf('p.seller'), listing: review.indexOf('_getListing') });
}

section('A mail key is stretched with a salt that is this deployment’s own');
{
  const key = codeOnly(functionBody(src, '_mailCredKey') || '');
  ok(key.length > 100, 'the derivation was read', key.length);
  ok(/_mailCredSalt\(secret\)/.test(key), 'the salt comes from the deployment’s key', true);
  const salt = codeOnly(functionBody(src, '_mailCredSalt') || '');
  ok(/digest\('SHA-256'/.test(salt), 'hashed rather than used raw', true);
  ok(/amv-mail-credentials-v2/.test(salt), 'and versioned, so v1 can still be read', true);
}

section('A weak deployment key is refused rather than stretched');
{
  ok(W.MAIL_CRED_MIN >= 24, 'the minimum is a real length', W.MAIL_CRED_MIN);
  ok(W._mailCredWeak('a'.repeat(64)) !== null, 'one character repeated is refused however long');
  ok(W._mailCredWeak('aaaaaaaaaaaaaaaa') !== null, 'sixteen letter As, which used to pass, is refused');
  ok(W._mailCredWeak('short') !== null, 'and anything short');
  ok(W._mailCredWeak('changeme-changeme-changeme') !== null, 'and a placeholder');
  ok(W._mailCredWeak('') !== null, 'and nothing at all');

  const real = 'k7Qv2mZr9TbX4pLw8Ns3Jd6Hy1Ge5Ua0';
  ok(W._mailCredWeak(real) === null, 'while a generated secret is accepted', real.length);
}

section('And a password stored under the old salt still opens');
{
  /* A key rotation that silently locks somebody out of their own mailbox is a
     worse outcome than the thing being fixed. */
  const env = mkEnv();
  env.MAIL_CRED_KEY = 'k7Qv2mZr9TbX4pLw8Ns3Jd6Hy1Ge5Ua0';

  const blob = await W._mailEncrypt(env, 'app-password-1234');
  ok(!!blob, 'a password encrypts', typeof blob);
  ok(!String(blob).includes('app-password'), 'and the plaintext is not in it', String(blob).slice(0, 24));
  ok(await W._mailDecrypt(env, blob) === 'app-password-1234', 'and comes back', true);

  /* Written by the v1 derivation, which is what every existing record is. */
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', enc.encode(env.MAIL_CRED_KEY), 'PBKDF2', false, ['deriveKey']);
  const v1 = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('amv-mail-credentials-v1'), iterations: 120000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, v1, enc.encode('older-password')));
  const old = new Uint8Array(iv.length + ct.length);
  old.set(iv, 0); old.set(ct, iv.length);
  const oldBlob = Buffer.from(old).toString('base64');

  ok(await W._mailDecrypt(env, oldBlob) === 'older-password',
     'a mailbox connected before this change still opens', true);

  /* And the wrong key opens neither. */
  const wrong = Object.assign({}, env, { MAIL_CRED_KEY: 'P9xZ2qWv4nRt7mKd1Fy6Bs3Hj8La5Uc0' });
  ok(await W._mailDecrypt(wrong, blob) === null, 'a different deployment’s key opens nothing', true);
  ok(await W._mailDecrypt(wrong, oldBlob) === null, 'including the old ones', true);
  const weak = Object.assign({}, env, { MAIL_CRED_KEY: 'aaaaaaaaaaaaaaaa' });
  ok(await W._mailDecrypt(weak, blob) === null, 'and a weak key is not a key at all', true);
}

if (report('a-seller-cannot-delete-what-you-thought') > 0) process.exitCode = 1;
done();
