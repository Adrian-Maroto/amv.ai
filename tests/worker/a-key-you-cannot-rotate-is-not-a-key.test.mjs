/* A SECRET THAT CANNOT BE CHANGED IS NOT A SECRET, IT IS A LIABILITY.

   Every connected account's provider token is sealed with AES-GCM under
   CONNECT_KEY. That is the right shape: a stolen copy of the database is
   ciphertext rather than mailboxes.

   What it could not do was change. The sealed payload recorded a format
   version and nothing about WHICH key had sealed it, so rotating CONNECT_KEY
   made every stored connection undecryptable at once. The remedy for a
   suspected leak was therefore: every customer reconnects every account.

   That is not a remedy, it is a reason not to rotate. The day the key looks
   compromised is exactly the day nobody will accept that cost, so in practice
   the secret would never change for the life of the product - and a key that
   never changes is one that only ever accumulates exposure.

   So the sealed payload carries a KEY ID, CONNECT_KEY_PREV keeps one retired
   key readable, and a record re-seals under the current key the next time it is
   used. A rotation drains itself.

   WHAT THIS DELIBERATELY DOES NOT CLAIM, because the comment in the Worker says
   the same and a test that implied more would be worse than none: this does not
   shrink the blast radius. Whoever holds the primary key can open every record,
   exactly as before. Per-record data keys wrapped by a master would not change
   that either - the master unwraps everything. Rotation is the honest win. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'connkey.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, connSeal, connOpen, connIsPrimary, connSealedKeyId, connUse, CONN_KV, CONN_VER };\n');
const W = await import(harness + '?t=' + Date.now());

const OLD = 'the-key-this-deployment-started-with';
const NEW = 'the-key-it-was-rotated-to-after-a-scare';

const store = new Map();
const mkEnv = (extra) => Object.assign({
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix } = {}) {
      return { keys: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
    },
  },
  GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret',
}, extra || {});

const TOKEN = { access: 'ya29.a-real-looking-access-token', refresh: 'r-1', exp: Date.now() + 3600000 };

section('A sealed record says which key sealed it');
{
  const env = mkEnv({ CONNECT_KEY: OLD });
  const sealed = await W.connSeal(env, TOKEN);
  const parts = sealed.split('.');
  ok(parts.length === 4, 'version, key id, iv, ciphertext', parts.length);
  ok(Number(parts[0]) === W.CONN_VER, 'the version is first, so a format change is detectable', parts[0]);
  ok(/^[0-9a-f]{8}$/.test(parts[1]), 'and the key id is a short hex fingerprint', parts[1]);

  /* THE ID IS NOT THE SECRET, AND NOT THE KEY MATERIAL EITHER. It is stored
     beside the ciphertext, so if it were derivable back into either of those
     this would be a design that writes the key next to the lock. */
  ok(sealed.indexOf(OLD) < 0, 'the secret itself is nowhere in the record', true);
  const other = await W.connSeal(mkEnv({ CONNECT_KEY: NEW }), TOKEN);
  ok(other.split('.')[1] !== parts[1], 'a different secret gets a different id', [parts[1], other.split('.')[1]]);
}

section('The same secret always produces the same id, or nothing could be matched');
{
  const a = await W.connSeal(mkEnv({ CONNECT_KEY: OLD }), TOKEN);
  const b = await W.connSeal(mkEnv({ CONNECT_KEY: OLD }), TOKEN);
  ok(a.split('.')[1] === b.split('.')[1], 'the id is a function of the secret, not of the moment', a.split('.')[1]);
  ok(a.split('.')[2] !== b.split('.')[2], 'while the IV is fresh every time, which is what AES-GCM requires', true);
}

section('After a rotation, a record sealed under the old key still opens');
{
  const before = mkEnv({ CONNECT_KEY: OLD });
  const sealed = await W.connSeal(before, TOKEN);

  /* The rotation: the new value in CONNECT_KEY, the old one in PREV. */
  const during = mkEnv({ CONNECT_KEY: NEW, CONNECT_KEY_PREV: OLD });
  /* Caught rather than awaited bare. A rotation that cannot read the old key
     throws, and a throw here would kill the process on the FIRST assertion
     instead of reporting which property failed - the suite would go red, but
     about a stack trace rather than about the rotation. */
  let opened = null, openErr = '';
  try { opened = await W.connOpen(during, sealed); }
  catch (e) { openErr = String((e && e.message) || e); }
  ok(openErr === '', 'the old key is still consulted during a rotation', openErr || 'no error');
  ok(opened && opened.access === TOKEN.access, 'and the token is readable through it', !!(opened && opened.access === TOKEN.access));
  ok((await W.connIsPrimary(during, sealed)) === false,
     'and it knows the record is not on the current key yet', true);

  /* And the new key is what new records get. */
  const fresh = await W.connSeal(during, TOKEN);
  ok((await W.connIsPrimary(during, fresh)) === true, 'anything sealed now is on the current key', true);
}

section('Without the old key it says so, rather than reading as corruption');
{
  /* THE FAILURE THAT MATTERS MOST. Somebody rotates the secret and forgets
     PREV. If that surfaced as "no connections" they would reconnect every
     account to fix a secret they changed, and the real records would sit there
     readable the whole time. */
  const before = mkEnv({ CONNECT_KEY: OLD });
  const sealed = await W.connSeal(before, TOKEN);
  const after = mkEnv({ CONNECT_KEY: NEW });
  let err = '';
  try { await W.connOpen(after, sealed); } catch (e) { err = String((e && e.message) || e); }
  ok(err === 'connect_key_retired', 'it names the cause exactly', err);
  ok(err !== '', 'and it throws rather than answering null, which would read as "nothing stored"', err);
}

section('A record re-seals under the current key the next time it is used');
{
  /* Lazy rotation, and it costs nothing: connUse writes the record back anyway
     to stamp lastUsed, so the re-seal rides along on a write that was already
     happening. A rotation therefore drains itself as connections get used,
     rather than needing a migration job that would have to hold every token in
     memory to run. */
  store.clear();
  const email = 'rotator@example.com';
  const before = mkEnv({ CONNECT_KEY: OLD });
  const sealed = await W.connSeal(before, TOKEN);
  await W.DB.put(before, W.CONN_KV, email, {
    c1: { provider: 'google', scopes: ['gmail.readonly'], unattended: true, sealed },
  });

  const during = mkEnv({ CONNECT_KEY: NEW, CONNECT_KEY_PREV: OLD });
  const r = await W.connUse(during, email, 'gmail.readonly', 'job-1', { attended: true });
  ok(r.ok === true, 'the job gets its token through the rotation', r.code || 'ok');
  ok(r.token === TOKEN.access, 'and it is the real one', r.token === TOKEN.access);

  const after = (await W.DB.get(during, W.CONN_KV, email)) || {};
  ok((await W.connIsPrimary(during, after.c1.sealed)) === true,
     'and the stored record is now on the current key', W.connSealedKeyId(after.c1.sealed));

  /* WHICH MEANS THE OLD KEY CAN GO. The point of the whole exercise: after the
     connections have been used, removing CONNECT_KEY_PREV breaks nothing. */
  const done_ = mkEnv({ CONNECT_KEY: NEW });
  const still = await W.connOpen(done_, after.c1.sealed);
  ok(still.access === TOKEN.access, 'with CONNECT_KEY_PREV removed, it still opens', true);
}

section('A record already on the current key is not rewritten for nothing');
{
  store.clear();
  const email = 'settled@example.com';
  const env = mkEnv({ CONNECT_KEY: NEW });
  const sealed = await W.connSeal(env, TOKEN);
  await W.DB.put(env, W.CONN_KV, email, {
    c1: { provider: 'google', scopes: ['gmail.readonly'], unattended: true, sealed },
  });
  await W.connUse(env, email, 'gmail.readonly', 'job-2', { attended: true });
  const after = (await W.DB.get(env, W.CONN_KV, email)) || {};
  /* Byte-identical, which is stronger than "still opens": a re-seal picks a new
     IV, so an unnecessary one would be visible here. */
  ok(after.c1.sealed === sealed, 'the ciphertext is untouched when there is nothing to migrate', true);
}

section('And the operator is told a rotation is in progress');
{
  /* CONNECT_KEY_PREV being set is not a missing capability, it is a rotation
     that has started and not finished. Left off the readiness screen, the only
     way to know AMV can still read old records would be to remember setting
     it. */
  const item = src.slice(src.indexOf("id: 'connectKeyPrev'"), src.indexOf("id: 'connectKeyPrev'") + 1400);
  ok(item.length > 100, 'the readiness line exists', item.length);
  ok(/on: !_has\(env, 'CONNECT_KEY_PREV'\)/.test(item),
     'and reports "on" when it is ABSENT, because absent is the settled state', true);
  ok(/ROTATION IS IN PROGRESS/.test(item), 'saying plainly what the set state means', true);
  ok(/every customer reconnect/.test(item),
     'and what rotating without it would cost, which is the reason it exists', true);
}

section('The path that uses a token is the path that migrates it');
{
  /* Stated as a source rule as well, because the behaviour above is proved
     through connUse and the property is about WHERE the re-seal lives: on the
     write that already happens, not in a job somebody has to remember to run. */
  const fn = codeOnly(functionBody(src, 'connUse'));
  ok(/connIsPrimary\(env, c\.sealed\)/.test(fn), 'connUse asks whether the record is current', true);
  ok(/c\.sealed = await connSeal\(env, tok\)/.test(fn), 'and re-seals it when it is not', true);
  ok(fn.indexOf('connIsPrimary') < fn.indexOf('DB.put(env, CONN_KV, email, all)'),
     'before the write it rides on, or it would need a second one', true);
  ok(/connect_key_retired/.test(fn),
     'and a record it cannot read at all is reported as a retired key, not as corruption', true);
}

if (report('a-key-you-cannot-rotate-is-not-a-key') > 0) process.exitCode = 1;
done();
