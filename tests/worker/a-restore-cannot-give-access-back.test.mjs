/* THE RECOVERY HANDED THE INTRUDER THEIR SESSION BACK.

   Restoring a backup wrote every key straight over the live one. That is right
   for data and wrong for anything recording that somebody's access was TAKEN
   AWAY - and a restore is normally run after an incident, which is precisely
   when the state being overwritten is the state created by responding to it.

   The sharp one is the token epoch. Every "sign out everywhere" and every
   password reset increments a counter, and verifying a token compares its epoch
   against that number. Writing an older number back makes every token issued
   before it valid again. So the sequence is: an account is compromised, the
   owner signs out everywhere, somebody restores yesterday's snapshot as part of
   putting things right, and the stolen session is live again. Nothing reports
   anything; the restore says it succeeded, because it did.

   The same shape covers three more facts that all live on records a restore
   overwrites: a revoked API key, an account blocked for charging back, and a
   suspended seller. Each is a decision somebody made, undone by a file.

   The rule is that revocation only moves one way. A restore may add one and
   may never remove one - and it has to SAY when it held something forward,
   because a partial restore an operator does not know about is one they will
   assume was total.

   The counter-rule matters as much: a restore that quietly refused to write
   most of what it was given would be worse than one that overwrites too much.
   These four facts, and nothing else. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'restoremerge.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _restoreMerge, backupImport, revokeUserTokens, _tokenEpoch, verifyToken, issueTokens };\n');
const W = await import(harness + '?t=' + Date.now());

const USER = 'victim@example.com';

function mkEnv() {
  const m = new Map(); const vals = new Map();
  return {
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admintok', APP_URL: 'https://amv.test',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') return new Response(JSON.stringify({ claimed: true }));
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const restore = (env, data, mode) => W.backupImport(new Request('https://x/admin/backup/import', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admintok', 'CF-Connecting-IP': '4.4.4.4' },
  body: JSON.stringify({ mode: mode || 'merge', snapshot: { _amv_backup: 1, createdISO: '2026-01-01T00:00:00Z', data } }),
}), env);

section('The session somebody signed out of does not come back');
{
  /* The finding, end to end, in the order it happens. */
  const env = mkEnv();

  /* Yesterday: a working session, and a snapshot taken. */
  const before = await W.issueTokens(env, USER, 'V');
  const snapshot = { ['tokepoch:' + USER]: await env.AMV_KV.get('tokepoch:' + USER) || '0' };
  ok((await W.verifyToken(before.token, env.JWT_SECRET, env, 'access')) != null,
     'the token works while the session is live', true);

  /* Today: the account is compromised and they sign out everywhere. */
  await W.revokeUserTokens(env, USER);
  ok((await W.verifyToken(before.token, env.JWT_SECRET, env, 'access')) == null,
     'signing out everywhere kills it', true);

  /* And somebody restores yesterday's snapshot as part of putting things right. */
  const r = await restore(env, snapshot);
  const d = await r.json();
  ok(d.ok === true, 'the restore runs', d);

  ok((await W.verifyToken(before.token, env.JWT_SECRET, env, 'access')) == null,
     'the stolen session STAYS dead - a restore cannot undo a sign-out', true);
  ok(d.heldForward >= 1, 'and the restore says something was held forward', d.heldForward);
  ok(/taken away/i.test(d.note || ''),
     'in words an operator will understand, so they do not assume it was total', d.note);
}

section('But an epoch the live store has lost is still carried forward');
{
  /* The rule is "never lower", not "never write". A restore has to be able to
     put back a revocation the live store no longer has, or recovering from
     data loss would quietly resurrect sessions too. */
  const env = mkEnv();
  await env.AMV_KV.put('tokepoch:' + USER, '2');
  const r = await restore(env, { ['tokepoch:' + USER]: '7' });
  await r.json();
  ok(await env.AMV_KV.get('tokepoch:' + USER) === '7',
     'a higher epoch in the snapshot is applied', await env.AMV_KV.get('tokepoch:' + USER));
}

section('A revoked API key is not brought back to life');
{
  const env = mkEnv();
  /* The snapshot remembers it live. */
  const snap = { ['apikeys:' + USER]: JSON.stringify({ items: [{ id: 'k1', name: 'old' }] }) };
  /* Since then it was revoked, and a new one was made. */
  await env.AMV_KV.put('apikeys:' + USER, JSON.stringify({
    items: [{ id: 'k1', name: 'old', revoked: true }, { id: 'k2', name: 'new' }] }));

  const d = await (await restore(env, snap)).json();
  const rec = JSON.parse(await env.AMV_KV.get('apikeys:' + USER));
  const k1 = rec.items.find(k => k.id === 'k1');
  const k2 = rec.items.find(k => k.id === 'k2');

  ok(k1 && k1.revoked === true, 'the key somebody killed stays killed', k1);
  ok(!!k2, 'and a key made after the snapshot is not lost by the restore', !!k2);
  ok(d.heldForward >= 1, 'the restore reports it', d.heldForward);
}

section('An account blocked for charging back stays blocked');
{
  const env = mkEnv();
  const snap = { ['ent:' + USER]: JSON.stringify({ plan: 'ultra', updatedAt: 1 }) };
  await env.AMV_KV.put('ent:' + USER, JSON.stringify({
    plan: 'free', blocked: true, blockedReason: 'chargeback', blockedAt: 2 }));

  await (await restore(env, snap)).json();
  const rec = JSON.parse(await env.AMV_KV.get('ent:' + USER));
  ok(rec.blocked === true, 'the block survives the restore', rec.blocked);
  ok(rec.blockedReason === 'chargeback', 'with the reason it was made for', rec.blockedReason);
  /* And the rest of the record IS restored - this is a merge, not a refusal. */
  ok(rec.plan === 'ultra', 'while everything else in the snapshot is applied', rec.plan);
}

section('A suspended seller stays suspended, and strikes are not forgiven');
{
  const env = mkEnv();
  const snap = { ['seller:' + USER]: JSON.stringify({ payoutTo: 'x@y.z', strikes: 0 }) };
  await env.AMV_KV.put('seller:' + USER, JSON.stringify({ payoutTo: 'old@y.z', banned: true, strikes: 3 }));

  await (await restore(env, snap)).json();
  const rec = JSON.parse(await env.AMV_KV.get('seller:' + USER));
  ok(rec.banned === true, 'the suspension survives', rec.banned);
  ok(rec.strikes === 3, 'and so do the strikes behind it', rec.strikes);
  ok(rec.payoutTo === 'x@y.z', 'while the rest of the record is restored', rec.payoutTo);
}

section('Everything else is restored exactly as given');
{
  /* The counter-rule. A restore that refused to write most of what it was
     handed would be worse than one that overwrote too much - an operator has to
     be able to trust that a restore restores. */
  const env = mkEnv();
  await env.AMV_KV.put('data:' + USER, JSON.stringify({ chats: ['new'] }));
  const snap = { ['data:' + USER]: JSON.stringify({ chats: ['from the backup'] }) };
  const d = await (await restore(env, snap)).json();
  ok(JSON.parse(await env.AMV_KV.get('data:' + USER)).chats[0] === 'from the backup',
     'ordinary data is overwritten, which is the whole point of a restore', true);
  ok(d.heldForward === 0, 'and nothing is reported as held forward', d.heldForward);
  ok(d.note === null, 'so the operator is not warned about nothing', d.note);
}

section('A key with nothing live under it is written straight through');
{
  const env = mkEnv();
  const d = await (await restore(env, { ['ent:new@example.com']: JSON.stringify({ plan: 'pro' }) })).json();
  ok(JSON.parse(await env.AMV_KV.get('ent:new@example.com')).plan === 'pro',
     'a record that does not exist yet is simply created', true);
  ok(d.heldForward === 0, 'with nothing held forward', d.heldForward);
}

section('Unreadable live state does not silently decide a revocation away');
{
  /* If the comparison cannot be made, the one thing that must not happen is
     concluding there was nothing to protect. */
  const env = mkEnv();
  await env.AMV_KV.put('ent:' + USER, '{not json at all');
  const d = await (await restore(env, { ['ent:' + USER]: JSON.stringify({ plan: 'pro' }) })).json();
  ok(d.ok === true, 'the restore still completes', d.ok);
  ok(JSON.parse(await env.AMV_KV.get('ent:' + USER)).plan === 'pro',
     'and the snapshot is applied over bytes nothing could read', true);
}

section('The rule is monotonic, checked directly');
{
  /* Read at the helper, because the four cases above are instances and this is
     the property. */
  const env = mkEnv();
  await env.AMV_KV.put('tokepoch:a@b.c', '9');
  const down = await W._restoreMerge(env, 'tokepoch:a@b.c', '3');
  ok(down.value === '9' && down.held === true, 'a lower epoch is refused and reported', down);
  const up = await W._restoreMerge(env, 'tokepoch:a@b.c', '11');
  ok(up.value === '11' && up.held === false, 'a higher one is taken', up);
  const same = await W._restoreMerge(env, 'tokepoch:a@b.c', '9');
  ok(same.value === '9' && same.held === false, 'and an equal one is not reported as a conflict', same);
}

section('The merge is on the write path, not beside it');
{
  const fn = codeOnly(functionBody(src, 'backupImport'));
  ok(/_restoreMerge\(env, key, val\)/.test(fn), 'every restored key goes through the merge', true);
  const iMerge = fn.indexOf('_restoreMerge(');
  const iPut = fn.indexOf('AMV_KV.put(key', iMerge);
  ok(iMerge > -1 && iPut > iMerge, 'before it is written, not after', { merge: iMerge, put: iPut });
  ok(!/await env\.AMV_KV\.put\(key, val\)/.test(fn),
     'and the raw snapshot value is never written directly', true);
}

if (report('a-restore-cannot-give-access-back') > 0) process.exitCode = 1;
done();
