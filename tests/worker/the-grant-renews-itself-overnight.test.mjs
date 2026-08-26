/* A CONNECTION THAT DIES AT THE ONE-HOUR MARK IS NOT A CONNECTION.

   Every provider access token expires in about an hour. Every promise AMV makes
   about connected accounts - the morning brief, the overnight watch, the school
   reader that runs with no tab open - is a promise about the twenty-third hour,
   not the first. So the renewal is not a nicety attached to the feature; it is
   the feature.

   This property used to be guarded in the BROWSER, in tests/e2e/resilience,
   because the browser was where the token lived: ensureGToken renewed it a
   couple of minutes early so a long job never expired mid-run. The token moved
   to the server, the browser now asks /v1/connect/act to have something DONE
   rather than asking for a key to do it with, and the old assertions went with
   the code they described.

   The RISK did not move, it just changed address. connUse is where a stale
   grant now turns into a job that quietly stops working every morning, so this
   is the same guarantee asserted against the thing that now makes it.

   Three outcomes, and they are deliberately different from each other, because
   collapsing them is how a revoked account and a slow network come to look
   identical on a screen:
     - it can renew          -> renew, re-seal, carry on, nobody notices
     - it has no refresh     -> say expired_no_refresh, which is reconnectable
     - the provider refuses  -> mark the record broken so a screen can say so */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'connrenew.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, connSeal, connOpen, connUse, CONN_KV };\n');
const W = await import(harness + '?t=' + Date.now());

const KEY = 'the-secret-this-deployment-seals-connections-with';
const store = new Map();
const env = {
  CONNECT_KEY: KEY,
  GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix } = {}) {
      return { keys: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
    },
  },
};

/* The provider's token endpoint, and a record of what was actually sent to it.
   Asserting the REPLY alone would pass on a refresh request that sent the wrong
   grant type, which the provider would refuse in production and this would
   not. */
let sent = [];
let reply = null;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.indexOf('oauth2.googleapis.com/token') >= 0) {
    sent.push(Object.fromEntries(new URLSearchParams(String((init && init.body) || ''))));
    return reply();
  }
  throw new Error('the suite reached an address it does not stub: ' + u);
};
const jsonReply = (status, body) => () => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
});

async function seed(email, tok, extra) {
  store.clear(); sent = [];
  await W.DB.put(env, W.CONN_KV, email, {
    c1: Object.assign({
      provider: 'google', scopes: ['mail.read'], unattended: true,
      sealed: await W.connSeal(env, tok),
    }, extra || {}),
  });
}

section('An expired grant is renewed rather than reported as disconnected');
{
  const email = 'overnight@example.com';
  await seed(email, { access: 'STALE', refresh: 'r-1', exp: Date.now() - 1000 });
  reply = jsonReply(200, { access_token: 'FRESH', expires_in: 3600 });

  const r = await W.connUse(env, email, 'mail.read', 'morning-brief', {});
  ok(r.ok === true, 'the job runs', r.code || 'ok');
  ok(r.token === 'FRESH', 'on a token minted just now, not the stale one', r.token);
  ok(sent.length === 1, 'exactly one call to the provider', sent.length);
  ok(sent[0] && sent[0].grant_type === 'refresh_token', 'as a refresh_token grant', sent[0] && sent[0].grant_type);
  ok(sent[0] && sent[0].refresh_token === 'r-1', 'carrying the stored refresh token', !!(sent[0] && sent[0].refresh_token));
  ok(sent[0] && sent[0].client_secret === 'gsecret',
     'and the client secret, which is why this cannot happen in a browser', !!(sent[0] && sent[0].client_secret));

  /* The renewal has to SURVIVE the request, or the next job refreshes again and
     the one after that, and the provider throttles the whole client. */
  const after = (await W.DB.get(env, W.CONN_KV, email)) || {};
  const reopened = await W.connOpen(env, after.c1.sealed);
  ok(reopened.access === 'FRESH', 'the new token is sealed back into the record', reopened.access);
  ok(reopened.exp > Date.now() + 3000000, 'with its new expiry, so the next job does not refresh again', reopened.exp - Date.now());
}

section('It renews EARLY, so a job cannot expire between the check and the call');
{
  /* A token with thirty seconds left passes "not expired" and is dead by the
     time the request lands. That is the failure this margin exists for, and it
     is invisible without it: everything looks fine until a slow morning. */
  const email = 'margin@example.com';
  await seed(email, { access: 'ALMOST', refresh: 'r-2', exp: Date.now() + 30000 });
  reply = jsonReply(200, { access_token: 'FRESH2', expires_in: 3600 });
  const r = await W.connUse(env, email, 'mail.read', 'brief', {});
  ok(r.token === 'FRESH2', 'a token about to expire is replaced before it is used', r.token);
}

section('A healthy grant is used as it is, with no call to the provider');
{
  const email = 'healthy@example.com';
  await seed(email, { access: 'GOOD', refresh: 'r-3', exp: Date.now() + 3600000 });
  reply = jsonReply(500, { error: 'this should never be reached' });
  const r = await W.connUse(env, email, 'mail.read', 'brief', {});
  ok(r.token === 'GOOD', 'the stored token is handed straight back', r.token);
  ok(sent.length === 0, 'and the provider is not called for nothing', sent.length);
}

section('A rotating refresh token is stored, or the SECOND renewal fails');
{
  /* Some providers hand back a new refresh token on every use and retire the
     old one. Ignoring it works exactly once - the failure arrives on the next
     renewal, hours later, and looks like a revoked account. */
  const email = 'rotating@example.com';
  await seed(email, { access: 'STALE', refresh: 'r-old', exp: Date.now() - 1000 });
  reply = jsonReply(200, { access_token: 'FRESH3', refresh_token: 'r-new', expires_in: 3600 });
  await W.connUse(env, email, 'mail.read', 'brief', {});
  const after = (await W.DB.get(env, W.CONN_KV, email)) || {};
  const reopened = await W.connOpen(env, after.c1.sealed);
  ok(reopened.refresh === 'r-new', 'the replacement refresh token is kept', reopened.refresh);
}

section('A grant with nothing to renew from says so, and does not pretend');
{
  const email = 'norefresh@example.com';
  await seed(email, { access: 'STALE', exp: Date.now() - 1000 });
  reply = jsonReply(500, { error: 'this should never be reached' });
  const r = await W.connUse(env, email, 'mail.read', 'brief', {});
  ok(r.ok === false, 'the job does not run', r.ok);
  ok(r.code === 'expired_no_refresh', 'and the reason is named exactly', r.code);
  ok(sent.length === 0, 'no pointless call to the provider', sent.length);
}

section('A refusal from the provider is recorded, so a screen can ask for a reconnect');
{
  /* The quiet failure this exists to prevent: somebody revokes AMV at Google,
     and every morning for a fortnight the brief is empty with nothing anywhere
     saying why. */
  const email = 'revoked@example.com';
  await seed(email, { access: 'STALE', refresh: 'r-dead', exp: Date.now() - 1000 });
  reply = jsonReply(400, { error: 'invalid_grant' });
  const r = await W.connUse(env, email, 'mail.read', 'brief', {});
  ok(r.ok === false, 'the job does not run', r.ok);
  ok(r.code === 'refresh_failed', 'the code says the renewal failed, not that nothing is connected', r.code);
  ok(r.why === 'invalid_grant', 'and the reason the provider gave is carried', r.why);

  const after = (await W.DB.get(env, W.CONN_KV, email)) || {};
  ok(after.c1.broken === 'invalid_grant', 'the record is marked broken so the interface can say so', after.c1.broken);
}

section('And a renewal clears the mark, so a reconnect is not sticky');
{
  const email = 'recovered@example.com';
  await seed(email, { access: 'STALE', refresh: 'r-4', exp: Date.now() - 1000 }, { broken: 'invalid_grant' });
  reply = jsonReply(200, { access_token: 'FRESH4', expires_in: 3600 });
  await W.connUse(env, email, 'mail.read', 'brief', {});
  const after = (await W.DB.get(env, W.CONN_KV, email)) || {};
  ok(!('broken' in after.c1), 'a grant that works again is no longer flagged', after.c1.broken);
}

section('The renewal is in connUse, so nothing can reach a token around it');
{
  /* Stated as a source rule too. The behaviour above proves connUse renews; the
     property here is that connUse is the ONLY door - a second path that read
     c.sealed directly would hand out a stale token with none of this. */
  const fn = codeOnly(functionBody(src, 'connUse'));
  ok(/tok\.exp - 60000 < Date\.now\(\)/.test(fn), 'the margin is a minute, not zero', true);
  ok(/expired_no_refresh/.test(fn), 'a grant with no refresh token is named', true);
  ok(/c\.broken = String\(d\.error/.test(fn), 'and a refusal is recorded on the record', true);

  /* THE FIRST VERSION OF THIS ASSERTED THAT connUse WAS THE ONLY PLACE THAT
     OPENS A STORED CONNECTION, AND IT FOUND THREE. It was wrong to fail: the
     other two are the disconnect route and account erasure, and both open a
     record only to hand the refresh token to the provider's REVOKE endpoint.
     A refresh token does not expire on a clock, so renewing before revoking it
     would be a call to mint a credential AMV is about to destroy.

     The property that actually matters is narrower and is the one asserted:
     connUse is the only place that opens a record and hands the token BACK to
     a caller to do work with. Anywhere else that opened one and returned it
     would be a path around every check above - the pause, the scope test, the
     renewal, the audit line - so the count is pinned rather than eyeballed. */
  /* Named by the function each one sits in rather than by a fixed window of
     characters after it: a window drifts the moment somebody adds a line, and a
     check that drifts reports the wrong thing confidently. */
  const owners = [...src.matchAll(/connOpen\(env, c\.sealed\)/g)].map(m => {
    const before = src.slice(0, m.index);
    const decl = [...before.matchAll(/\n(?:async )?function ([A-Za-z0-9_]+)\s*\(/g)].pop();
    return decl ? decl[1] : '(top level)';
  });
  ok(owners.length === 3, 'every place that opens a stored connection was found', owners);
  ok(owners.filter(n => n === 'connUse').length === 1,
     'connUse is one of them, and only once', owners);
  ok(owners.every(n => ['connUse', 'connRemove', 'authDeleteAccount'].indexOf(n) >= 0),
     'and the other two are the disconnect route and account erasure, which revoke rather than hand out', owners);
}

if (report('the-grant-renews-itself-overnight') > 0) process.exitCode = 1;
done();
