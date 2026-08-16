/* THE FILE ANNOUNCED ITSELF AS A BACKUP AND WAS MISSING A KIND.

   The export pulled every prefix out of KV, then - when D1 is the store - every
   kind out of D1, each inside `catch(e){}`. So a kind that could not be read was
   dropped, silently, from a file that still said `_amv_backup: 1` and carried a
   key count. Restore from it and the store comes back short, with nothing
   anywhere saying which part is gone.

   A backup that is quietly incomplete is worse than no backup. No backup is a
   known state; a short one is trusted, and it is trusted at the single worst
   moment there is.

   It also built the whole thing in memory and then stringified it, which is the
   entire store twice over inside a Worker with 128MB. That is survivable on a
   small deployment and it is not a property that HOLDS: it fails at exactly the
   size where a backup starts to matter.

   AND THE GRANT NOBODY LISTED (AMV-SP-02). A live Google grant is erased on
   account deletion - by a hand-written delete somebody remembered to add - and
   was on none of the shared rosters. So the inventory that says what AMV holds
   about a person did not know it existed: the export never mentioned it, and
   the deletion depended on memory rather than on anything that would notice if
   it stopped.

   AND SUCCESS REPORTED BEFORE DELIVERY (AMV-SP-06). Handing work to somebody
   wrote the sender's own copy first and the recipient's inbox second. A failure
   on the second one threw, the sender got a 500, and their own sent list
   already said they had sent it - so their screen shows a handoff that was
   delivered nowhere, and the honest response to a 500 is to send it again. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'shortbackup.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, backupExport, handoffCreate, handoffAct, issueTokens,' +
  ' PER_USER_KINDS, EXPORT_REDACTED, BACKUP_NEVER };\n');
const W = await import(harness + '?t=' + Date.now());

const ADMIN = 'a-long-random-admin-token';
function mkEnv(opts = {}) {
  const m = new Map(); const vals = new Map();
  return {
    JWT_SECRET: 'x'.repeat(40), ADMIN_TOKEN: ADMIN, _map: m,
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, String(v)); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        const keys = [...m.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'claim') { if (vals.has('c:' + n) && !opts.lockFails) return new Response(JSON.stringify({ claimed: false })); if (opts.lockFails) return new Response(JSON.stringify({ claimed: false })); vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true, owner: 'o' })); }
        if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ released: true })); }
        if (b.op === 'rateCheck') { const nx = cur + 1; vals.set(n, nx); return new Response(JSON.stringify({ allowed: nx <= (b.limit || 9999) })); }
        if (b.op === 'reserve') { const nx = cur + (b.amount || 0); if (nx > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur })); vals.set(n, nx); return new Response(JSON.stringify({ allowed: true, value: nx })); }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const adminReq = () => new Request('https://api.amv.test/admin/backup/export', {
  headers: { Authorization: 'Bearer ' + ADMIN, 'CF-Connecting-IP': '2.4.6.8' },
});

section('A backup is produced and is a real file');
{
  const env = mkEnv();
  await W.DB.put(env, 'acct', 'a@example.com', { email: 'a@example.com', name: 'A' });
  await W.DB.put(env, 'ent', 'a@example.com', { plan: 'pro' });

  const r = await W.backupExport(adminReq(), env);
  ok(r.status === 200, 'the export answers', r.status);
  ok(/attachment/.test(r.headers.get('Content-Disposition') || ''), 'as a download', r.headers.get('Content-Disposition'));
  const text = await r.text();
  const snap = JSON.parse(text);
  ok(snap._amv_backup === 1, 'and the file parses as one', snap._amv_backup);
  ok(snap.complete === true, 'saying it is complete', snap.complete);
  ok(!!snap.data['acct:a@example.com'], 'with the account in it', Object.keys(snap.data));
  ok(!!snap.data['ent:a@example.com'], 'and the entitlement', Object.keys(snap.data));
  ok(snap.keyCount === Object.keys(snap.data).length,
     'and a key count that matches what is actually there', { said: snap.keyCount, real: Object.keys(snap.data).length });
}

section('THE FINDING: it is written as it is read, not built up in memory first');
{
  /* The property that fails at scale: a whole store accumulated into one object
     and then stringified is the store twice over. Streaming is what removes the
     ceiling, and it cannot be measured from the outside - what CAN be checked
     is that the response is a stream and that nothing collects the records into
     an object on the way. */
  const fn = codeOnly(functionBody(src, 'backupExport') || '');
  ok(fn.length > 800, 'the handler was read', fn.length);
  ok(/new ReadableStream\(/.test(fn), 'the body is a stream', true);
  ok(!/const data = \{\}/.test(fn) && !/data\[k\.name\] = raw/.test(fn),
     'and no object accumulates every record before anything is sent', true);
  ok(!/JSON\.stringify\(snapshot\)/.test(fn), 'nor is the whole file stringified at the end', true);
  ok(/controller\.enqueue/.test(fn), 'records go out as they are read', true);
}

section('And a kind it could not read abandons the file rather than shortening it');
{
  /* The D1 path is what had the empty catch. With D1 bound and a kind that
     throws, the download must FAIL - visibly, mid-stream - rather than land on
     disk looking complete. */
  const fn = codeOnly(functionBody(src, 'backupExport') || '');
  const d1 = fn.slice(fn.indexOf('DB._hasD1(env)'));
  ok(d1.length > 100, 'the D1 half was found', d1.length);
  ok(!/\}\s*catch\s*\(e\)\s*\{\s*\}/.test(d1), 'its catch is not empty', true);
  ok(/failed\.push\(kind\)/.test(d1), 'a kind that fails is named', true);
  ok(/throw new Error\('backup incomplete/.test(d1), 'and the whole export is abandoned', true);
  ok(/controller\.error\(e\)/.test(fn),
     'which errors the stream, so the download visibly fails instead of finishing short', true);
  ok(/backup_export_failed/.test(fn), 'and it is on the record', true);
  ok(/alertOnce\(env, 'backup_failed'/.test(fn),
     'and the operator is told there is no usable backup from this attempt', true);
}

section('The Google grant is in the inventory that says what AMV holds');
{
  ok(W.PER_USER_KINDS.includes('goauth'),
     'it is one of the per-person records, so the export walks it and the erasure roster sees it', true);
  ok(!!W.EXPORT_REDACTED.goauth,
     'and it is redacted, because the refresh token in it is a working key to their Google account',
     W.EXPORT_REDACTED.goauth);
  ok(/revoke/i.test(W.EXPORT_REDACTED.goauth || ''),
     'with a description that tells them what to do about it', W.EXPORT_REDACTED.goauth);
  ok(W.BACKUP_NEVER.some(p => /goauth/.test(p)),
     'while still never appearing in a downloadable backup', true);

  /* And it is still really deleted, with the grant revoked at Google first. */
  const del = codeOnly(functionBody(src, 'authDeleteAccount') || '');
  ok(/oauth2\.googleapis\.com\/revoke/.test(del), 'erasure revokes it at Google', true);
  ok(/DB\.del\(env, 'goauth', email\)/.test(del), 'and then removes the record', true);
}

section('A handoff is delivered before it is reported as delivered');
{
  const create = codeOnly(functionBody(src, 'handoffCreate') || '');
  const iTheirs = create.indexOf("_withKind(env, 'handoff', toEmail");
  const iMine = create.indexOf("_withKind(env, 'handoff', user.email");
  ok(iTheirs > -1 && iMine > -1, 'both writes were found', { theirs: iTheirs, mine: iMine });
  ok(iTheirs < iMine,
     'the recipient inbox is written first, so a failure there means nothing was written anywhere',
     { theirs: iTheirs, mine: iMine });
  ok(/recorded = false/.test(create),
     'and a failure on the sender’s own copy is survivable rather than a 500', true);
  ok(/Do not send it again/.test(create),
     'said in words, because the honest response to a 500 is to send it twice', true);
}

section('And a status the other side never received is not reported as sent');
{
  const act = codeOnly(functionBody(src, 'handoffAct') || '');
  ok(/notified = false/.test(act), 'a propagation failure is recorded', true);
  ok(!/\}catch\(e\)\{ \/\* the recipient's own record is already correct \*\/ \}/.test(act),
     'rather than swallowed with a comment saying it does not matter', true);
  ok(/they may still see this as waiting/.test(act),
     'and the person is told what the other side is looking at', true);
}

section('Handing work over still works, which all of this is in service of');
{
  const env = mkEnv();
  const tok = (await W.issueTokens(env, 'sender@example.com', 'S')).token;
  const r = await W.handoffCreate(new Request('https://api.amv.test/api/handoff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '5.5.5.5', Authorization: 'Bearer ' + tok },
    body: JSON.stringify({ title: 'Finish the deck', to: 'recipient@example.com', context: 'slides 4-9' }),
  }), env);
  const d = await r.json();
  ok(r.status === 200 && d.ok === true, 'it is accepted', { status: r.status, err: d.error });
  ok(d.recorded === true, 'and recorded on both sides', d.recorded);

  const theirs = await W.DB.get(env, 'handoff', 'recipient@example.com');
  ok(theirs && (theirs.incoming || []).length === 1, 'the recipient has it', theirs && theirs.incoming);
  const mine = await W.DB.get(env, 'handoff', 'sender@example.com');
  ok(mine && (mine.sent || []).length === 1, 'and the sender’s history shows it', mine && mine.sent);
}

section('The deploy checklist names every setting the Worker reads');
{
  /* A warning that is always there for a reason nobody needs to act on is a
     warning people stop reading - and the one time it names something real,
     they skip that too. */
  const pre = readFileSync(join(ROOT, 'preflight.mjs'), 'utf8');
  for (const name of ['MAIL_CRED_KEY', 'TURNSTILE_SITE_KEY', 'IMAGE_COST_USD', 'VIDEO_COST_USD']) {
    ok(pre.includes("'" + name + "'"), name + ' is on the checklist', name);
  }
  const deploy = readFileSync(join(ROOT, 'DEPLOY.md'), 'utf8');
  ok(/MAIL_CRED_KEY/.test(deploy), 'and the one that silently disables three connectors is documented', true);
  ok(/randomBytes/.test(deploy), 'with a way to generate a real one', true);
  ok(/unreadable/i.test(deploy), 'and a warning about what changing it costs', true);
}

if (report('a-backup-that-is-short-says-nothing') > 0) process.exitCode = 1;
done();
