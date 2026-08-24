/* THE RISKIEST THING IN THE PRODUCT.

   The decision was work that runs with the tab closed. That means AMV holds a
   key to somebody's mailbox, and one breach would otherwise expose every
   connected account at once. So the bar for this file is not "the flow works" -
   it is that each specific thing which would make it dangerous is absent.

   The five that matter, and all five are checked against the worker itself
   rather than against a description of it:

     - the token is sealed before it is stored, so a stolen store is ciphertext;
     - no route hands a provider token back to a browser, ever;
     - the emergency stop reaches an unattended run before it opens a mailbox;
     - disconnecting revokes at the provider instead of only forgetting;
     - deleting an account revokes every connection first, because that is
       precisely what somebody closing their account is trying to end.

   And the narrow one that is easy to get wrong: a connection may only be used
   for the capability it was granted, so a calendar grant cannot read mail. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFile } from 'node:fs/promises';

const worker = await readFile(new URL('../../amv-backend.js', import.meta.url), 'utf8');
/* A REAL FUNCTION BODY, NOT A FIXED NUMBER OF BYTES.

   The first version of this sliced a fixed length from the function start. Two
   things go wrong with that and both did: a window too short drops the code the
   assertion is about and reports the guard missing, and a window too long spills
   into the NEXT function so an assertion passes on somebody else's code. Both
   are the check lying rather than the product being wrong.

   Sliced to the next top-level function instead, so a window is exactly one
   function however long it is or how much comment it carries. */
const fn = (name) => {
  const i = worker.indexOf('async function ' + name + '(');
  if (i < 0) return '';
  const next = worker.slice(i + 10).search(/\n(?:async )?function [A-Za-z_]/);
  return next < 0 ? worker.slice(i) : worker.slice(i, i + 10 + next);
};

const app = await bootApp({ tab: 'chat', user: { name: 'Adrian', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());

section('A token is sealed before it is ever written down');
{
  ok(/AES-GCM/.test(worker), 'the store uses real encryption, not encoding');
  ok(/async function connSeal\(/.test(worker) && /async function connOpen\(/.test(worker),
     'with a seal and an open around it');
  const finish = fn('connFinish');
  ok(/sealed: await connSeal\(/.test(finish),
     'the exchange seals the token as it stores it, rather than storing then sealing');
  ok(!/access: d\.access_token[\s\S]{0,200}DB\.put\(env, CONN_KV[^)]*\)[\s\S]{0,80}sealed/.test(finish),
     'and there is no window where the plain token is the thing being written');
  /* A key in the database is not a key. */
  ok(/env && env\.CONNECT_KEY/.test(worker), 'the key comes from a Worker secret, not from storage');
}

section('Without the key it refuses, rather than storing in the clear');
{
  const start = fn('connStart');
  ok(/connConfigured\(env\)/.test(start), 'connecting checks the key exists first');
  ok(/connect_key_missing/.test(start), 'and refuses by name when it does not');
  ok(/throw new Error\('connect_key_missing'\)/.test(worker),
     'sealing throws rather than returning something unsealed');
}

section('No route hands a provider token to a browser');
{
  /* Structural, not a promise: if connList ever returned `sealed` or a token,
     every interface bug downstream becomes a credential leak. */
  const list = fn('connList');
  ok(!/sealed/.test(list), 'the list route does not return the sealed blob');
  ok(!/token:/.test(list), 'nor a token field');
  ok(/lastUsed|lastJob/.test(list), 'it returns metadata, which is the useful part');
  const clientSrc = await page.evaluate(() => (document.getElementById('amv-app-code') || {}).textContent || '');
  ok(clientSrc.length > 0, 'the shipped bundle can be read');
  ok(!/connectToken|getConnToken/.test(clientSrc), 'and the client has no way to ask for one');
}

section('The emergency stop reaches an unattended run before it opens anything');
{
  const use = fn('connUse');
  ok(/if\(!o\.attended\)/.test(use), 'an unattended call is treated differently from a person');
  /* Anchored on the record the pause is really written to. Checking for the
     word "paused" alone would pass against the first version of this, which
     read a field that does not exist anywhere in the worker. */
  ok(/DB\.get\(env, 'auto', _autoKey\(email\)\)/.test(use),
     'it reads the record autoPause actually writes');
  ok(/rec && rec\.paused/.test(use), 'and refuses when that record says paused');
  ok(/autonomy_unknown/.test(use), 'an unreadable pause refuses too, rather than proceeding');
  /* The pause writes where this reads. Two files, one claim - the failure this
     product keeps having. */
  const pause = fn('autoPause');
  ok(/rec\.paused = paused/.test(pause), 'and that is the same field the pause route sets');
}

section('A grant is only good for what it was granted for');
{
  const use = fn('connUse');
  ok(/c\.scopes\.indexOf\(need\) >= 0/.test(use),
     'using a connection checks the capability against what was granted');
  ok(/o\.attended \|\| c\.unattended/.test(use),
     'and a foreground-only connection is not used by a background run');
  const start = fn('connStart');
  ok(/hasOwnProperty\.call\(p\.scopes, k\)/.test(start),
     'requested scopes are filtered against the provider table, not trusted');
}

section('Disconnecting revokes, rather than forgetting');
{
  const rm = fn('connRemove');
  ok(/p\.revoke/.test(rm) && /fetchDeadline\(p\.revoke/.test(rm),
     'it calls the provider revoke endpoint');
  const revokeAt = rm.indexOf('fetchDeadline(p.revoke');
  const deleteAt = rm.indexOf('delete all[id]');
  ok(revokeAt > 0 && deleteAt > revokeAt,
     'and does it BEFORE dropping the only copy of the token', revokeAt + ' then ' + deleteAt);
  ok(/did not confirm the grant was revoked/.test(rm),
     'a provider that did not confirm is said plainly, not reported as success');
}

section('Closing an account ends every grant it held');
{
  const seg = fn('authDeleteAccount');
  ok(seg.length > 500, 'the deletion routine was found to read', seg.length);
  ok(/conn_revoked_on_erasure/.test(seg), 'deletion revokes connected accounts');
  ok(/conn_revoke_failed_on_erasure/.test(seg),
     'and records the ones it could not, because that is a live grant nobody can reach now');
  ok(/'conn'/.test(worker.slice(worker.indexOf('const PER_USER_KINDS'), worker.indexOf('const PER_USER_KINDS') + 2200)),
     'and the record is on the roster that erasure and export both walk');
}

section('It is not in a backup, and not in an export');
{
  const never = worker.slice(worker.indexOf('const BACKUP_NEVER'), worker.indexOf('const BACKUP_NEVER') + 2500);
  ok(/'conn:'/.test(never), 'connected accounts are excluded from backups');
  const red = worker.slice(worker.indexOf('const EXPORT_REDACTED'), worker.indexOf('const EXPORT_REDACTED') + 1600);
  ok(/conn:/.test(red), 'and redacted from a data export');
}

section('The handshake cannot be replayed or hijacked');
{
  const finish = fn('connFinish');
  const delAt = finish.indexOf("DB.del(env, 'connstate'");
  const exAt = finish.indexOf('fetchDeadline(p.token');
  ok(delAt > 0 && delAt < exAt, 'the state is spent before the exchange, so a replay finds nothing');
  ok(/st\.email !== user\.email/.test(finish),
     'a state can only be finished by the account that started it');
  ok(/expired_state/.test(finish), 'and it expires');
  const start = fn('connStart');
  ok(/code_challenge_method: 'S256'/.test(start), 'PKCE is used');
  ok(/sealed: await connSeal\(env, \{ verifier/.test(start),
     'and the verifier is sealed server-side rather than left in the browser');
  ok(/rOrigin !== appOrigin/.test(start),
     'the return address is checked against this deployment, so it is not an open redirect');
}

section('The two OAuth returns do not collide');
{
  const clientSrc = await page.evaluate(() => (document.getElementById('amv-app-code') || {}).textContent || '');
  ok(/c_/.test(clientSrc) && /indexOf\("c_"\)|indexOf\('c_'\)/.test(clientSrc),
     'the client routes a connect return away from the sign-in handler');
  ok(/'c_' \+ _connRandom/.test(worker), 'because the server marks its own state');
}

section('The screen says what it may do and when it was last used');
{
  await page.evaluate(async () => {
    AMV_API.base = 'https://stub.amv.dev';
    saveStr('amv_api_token', 't'); saveStr('amv_api_token_origin', 'https://stub.amv.dev');
    AMV_API.connectList = async () => ({
      ok: true, configured: true,
      items: [{ id: 'google:x', provider: 'google', name: 'Google',
                scopes: ['mail.read', 'calendar.read'], at: Date.now() - 86400000,
                lastUsed: Date.now() - 3600000, lastJob: 'Daily inbox digest', unattended: true }],
      providers: [{ id: 'google', name: 'Google', ready: true, scopes: ['mail.read'] },
                  { id: 'microsoft', name: 'Microsoft', ready: false, scopes: ['mail.read'] }],
    });
    connReload();
    setTab('integrations');
    await new Promise(r => setTimeout(r, 250));
  });
  const t = await page.evaluate(() => (document.getElementById('conn-body') || {}).textContent || '');
  ok(/read your mail/.test(t), 'permissions are in words, not scope strings', t.slice(0, 90));
  ok(/works with AMV closed/.test(t), 'it says this one runs unattended');
  ok(/Daily inbox digest/.test(t), 'and which job used it last');
  ok(/last used\s+(just now|\d+\s*(min|h)\s*ago|yesterday|\d+ days ago)/i.test(t),
     'and when', (t.match(/last used[^·]*/) || [''])[0].slice(0, 40));
  const dark = await page.evaluate(() =>
    !!document.querySelector('.conn-add.dark[data-darg="microsoft"]'));
  ok(dark, 'a provider with no credentials reads as unavailable rather than a button that fails');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
