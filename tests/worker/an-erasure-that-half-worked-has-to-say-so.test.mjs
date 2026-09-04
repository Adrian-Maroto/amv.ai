/* "YOUR ACCOUNT HAS BEEN DELETED" WAS TRUE OF ONE PHASE OUT OF FIFTEEN.

   authDeleteAccount removes a person in about fifteen passes: their team
   membership, their deployed sites, their shared conversations, their
   marketplace listings and the snapshots of what they bought, their account-link
   invitations, their phone record, their bank connection, every connected
   account revoked at the provider, the OTHER party's half of every permission
   link, their family membership, the limits they set on children, their API
   keys, a live password-reset code, and everything found by scanning for keys
   that carry their address.

   Exactly one of those - the loop over perUserKinds - collected its failures.
   When that list came back non-empty the route audited, paged an operator, and
   answered `deleted:false` naming what survived. Its comment states the rule:
   "Erasure that half-worked and SAYS so can be finished by hand; erasure that
   half-worked in silence cannot, because nobody knows to look."

   Every other pass was written `try { ... } catch {}`. So a storage fault in any
   of them returned `deleted:true` - the person told their data was gone - while
   a valid reset code, somebody else's live permission grant, or a membership row
   still naming them sat there, with no audit entry and nothing paged. The rule
   was right and had been applied once.

   This drives the real route against a store that fails exactly one phase at a
   time, and asks the only question that matters: when something survives, does
   the answer say so? */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'erase-honest.harness.mjs');
writeFileSync(harness, src + '\nexport { authSignup, authDeleteAccount, DB };\n');
const W = await import(harness + '?t=' + Date.now());

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

const PW = 'correct-horse-9';

/* A store that works normally except for the keys a caller names. `failOn` is
   matched against the key, so one phase can be broken while the rest of the
   erasure proceeds exactly as it would in production. */
/* `failWrite` matters as much as `failOn`. Stripping the OTHER party's half of
   a permission link is not a delete - it is a read, a filter, and a write back -
   so a store that only fails deletes never touches that phase, and a test built
   on one passes while the phase is still silent. That is exactly what happened
   here: the links case went green against a delete-only fault, on the strength
   of an unrelated phase failing. */
function makeEnv(failOn, failWrite) {
  const kv = new Map();
  const env = {
    _kv: kv, JWT_SECRET: 'test-secret-abcdefghijklmnopqrstuv',
    ALERT_WEBHOOK: '', OWNER_EMAIL: 'owner@x.com',
    /* Armed AFTER the fixture is seeded. Set at construction, the pattern
       blocked the test's own setup write and the suite died before it ran. */
    _failRead: failOn || null, _failWrite: failWrite || null,
  };
  const bad = k => env._failRead && env._failRead.test(String(k));
  const badWrite = k => env._failWrite && env._failWrite.test(String(k));
  env.AMV_KV = {
      get: async k => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { if (badWrite(k)) throw new Error('storage fault'); kv.set(k, String(v)); },
      delete: async k => { if (bad(k)) throw new Error('storage fault'); kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()]
        .filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }),
  };
  return env;
}
const post = (path, body, token) => new Request('https://w' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: JSON.stringify(body || {}),
});
const signup = async (env, email) =>
  (await (await W.authSignup(post('/auth/signup', { email, name: 'T', password: PW }), env)).json());

async function erase(env, email, token) {
  const r = await W.authDeleteAccount(post('/auth/delete', { password: PW }, token), env);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

section('With nothing broken, it deletes and says so');
{
  const env = makeEnv(null);
  const a = await signup(env, 'ok@x.com');
  const r = await erase(env, 'ok@x.com', a.token);
  ok(r.body.deleted !== false, 'a clean erasure is not reported as incomplete',
     JSON.stringify(r.body).slice(0, 120));
  ok(!r.body.incomplete, 'and carries no incomplete flag', r.body.incomplete);
}

section('A live reset code that could not be removed is NOT reported as deleted');
{
  /* The one in the loose-key list. The comment beside it calls it a live
     credential, and it was deleted inside a catch that swallowed. */
  const env = makeEnv(/^resetcode:/);
  const a = await signup(env, 'code@x.com');
  await env.AMV_KV.put('resetcode:code@x.com', JSON.stringify({ code: '123456' }));
  const r = await erase(env, 'code@x.com', a.token);

  ok(r.body.deleted === false, 'the answer is not "deleted"', JSON.stringify(r.body.deleted));
  ok(r.body.incomplete === true, 'it is marked incomplete', r.body.incomplete);
  ok(Array.isArray(r.body.failed) && r.body.failed.length > 0,
     'and it names what survived', JSON.stringify(r.body.failed));
  ok(/could not be deleted/i.test(String(r.body.error || '')),
     'in a sentence the person can act on', String(r.body.error || '').slice(0, 90));
  ok(!!env._kv.get('resetcode:code@x.com'),
     'and the credential really did survive, so this is not a false alarm', true);
}

section('So is a permission link left on the other party');
{
  /* A link lives under BOTH sides. Failing to strip the other side leaves them
     holding a live grant pointing at an account that no longer exists. */
  const env = makeEnv(null, null);
  const a = await signup(env, 'linked@x.com');
  await env.AMV_KV.put('links:linked@x.com', JSON.stringify({
    items: [{ id: 'l1', owner: 'other@x.com', grantee: 'linked@x.com' }] }));
  await env.AMV_KV.put('links:other@x.com', JSON.stringify({
    items: [{ id: 'l1', owner: 'other@x.com', grantee: 'linked@x.com' }] }));
  env._failWrite = /^links:other@x\.com$/;   // armed only now the fixture is in place
  const r = await erase(env, 'linked@x.com', a.token);
  ok(r.body.deleted === false, 'not reported as deleted', JSON.stringify(r.body.deleted));
  ok((r.body.failed || []).some(f => /other party/i.test(f)),
     'and names THIS phase, not some other one that happened to fail',
     JSON.stringify(r.body.failed));
  const other = JSON.parse(env._kv.get('links:other@x.com') || '{}');
  ok((other.items || []).some(x => x.id === 'l1'),
     'and the grant really did survive on the other side', JSON.stringify(other.items || []));
}

section('Every phase reports into the same list, not just the one that always did');
{
  /* The property behind the two cases above. Read from the source, because the
     alternative is one test per phase and fifteen chances to forget one. */
  const fn = (() => {
    const i = src.indexOf('async function authDeleteAccount');
    let j = src.indexOf('{', i), d = 0;
    for (let k = j; k < src.length; k++) {
      if (src[k] === '{') d++;
      else if (src[k] === '}' && --d === 0) return src.slice(j, k);
    }
    return '';
  })();
  ok(fn.length > 2000, 'the function was found and read', fn.length);

  const code = fn.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  /* A swallowing catch is only a defect when it wraps a DELETION - a parse
     fallback is a fallback, and counting it would be the same overreach that
     makes a check worth ignoring. */
  /* MATCHED TO ITS OWN try BLOCK, not to a window of nearby lines.

     The first version of this looked back five lines, and reported two things
     that are correct: a JSON.parse fallback that happens to sit on a line which
     also deletes, and a stats counter a few lines under a delete. That is the
     same overreach the comment above warns about, made by the check itself -
     so it brace-matches backwards to the `try` this `catch` belongs to and asks
     what is actually inside it. */
  const swallowed = [];
  const reTry = /catch\s*(\([^)]*\))?\s*\{\s*\}/g;
  let m;
  while ((m = reTry.exec(code))) {
    /* The NEAREST PRECEDING `try`, not a brace walk. Counting braces backwards
       looked right and was not: this source is full of template literals, and
       `${email}` contributes braces that no stripper here removes, so the walk
       sailed past the try and returned the whole function. Every catch belongs
       to the try closest above it, which needs no brace arithmetic at all. */
    const tryIdx = code.lastIndexOf('try', m.index);
    if (tryIdx < 0) continue;
    const tryBody = code.slice(tryIdx, m.index);
    /* A write-back counts. Removing somebody from a record they are in is a
       DB.put, and a phase that fails to write it back leaves the grant in
       place just as surely as a failed delete would. */
    if (!/DB\.del\(|AMV_KV\.delete\(|DB\.put\(/.test(tryBody)) continue;
    swallowed.push(tryBody.replace(/\s+/g, ' ').trim().slice(0, 90));
  }
  ok(swallowed.length === 0,
     'no deletion in the erasure path is wrapped in a catch that says nothing',
     swallowed.join(' | '));

  const reports = (code.match(/_eraseFailed\(/g) || []).length;
  ok(reports >= 15, 'and the phases that can fail all report into one list', reports);
}

if (report('an-erasure-that-half-worked-has-to-say-so') > 0) process.exitCode = 1;
done();
