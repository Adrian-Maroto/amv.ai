/* A LOCK ONLY HOLDS IF EVERY WRITER TAKES IT.

   This is the third time. Entitlements had eleven writers and one of them took
   the lock; teams and families had the same shape; and computing it again
   found six more record kinds where somebody wrote a lock in one place and
   other handlers read-modify-write the same record raw:

     auto        the cron writes it under the lock while a run is in progress,
                 and creating, editing or clearing results wrote it straight
     abuse       a chargeback from Stripe writes it under the lock; an operator
                 clearing a flag wrote it straight, so a dispute landing in
                 that window is erased and the account is unmarked
     approvals   an autonomous run enqueues under the lock; editing one wrote
                 the whole queue back, so an approval that arrived in between
                 is dropped and the thing it was asking about is never asked
     acct        signup and Google sign-in
     team        creation
     apikeys     creating a key

   None of them is broken today, which is exactly why it would have stayed that
   way. A lost write leaves no error, no log line and no failing request - the
   second writer simply wins, and what the first one did was never there.

   The check is COMPUTED rather than listed. It reads every handler, finds the
   record kinds each one reads and writes back, and compares that against the
   kinds written through a lock anywhere. A kind written both ways is reported
   with the handlers that bypass it. Nothing here has to be maintained by hand,
   so a seventh cannot be added by somebody who has not read this file. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const code = codeOnly(src);           // a lock mentioned in a comment is not a lock

/* Every kind that is written through one of the locking helpers, anywhere. */
const LOCK_CALL = /_with(?:Kind|KV|Record|Acct|Ent|Team|Fam|Wallet)\(\s*env\s*,\s*'([a-z_]+)'/g;
const lockedKinds = new Set([...code.matchAll(LOCK_CALL)].map(m => m[1]));
/* Named wrappers that take a lock for one kind and add something to the write.
   _withAuto locks `auto` and books the due-time index from the record, so that
   booking cannot be left to a caller. A wrapper is still a lock. */
if (/async function _withAuto\(/.test(code)) lockedKinds.add('auto');

/* Every top-level handler, and the kinds it reads and writes back itself. */
const lines = code.split('\n');
const fns = [];
lines.forEach((l, i) => {
  /* Top-level `const NAME =` counts as a boundary too, not just `function`.
     Without it, the small arrow helpers defined between two functions -
     _loadAcct and _saveAcct sit between _withWallet and _withAcct - are
     attributed to whichever function came before, and _withWallet gets
     reported for writing `acct`. A splitter that mis-bounds a body invents
     findings, which is the fastest way to get a check switched off. */
  const m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)
         || l.match(/^const\s+([A-Za-z_$][\w$]*)\s*=/);
  if (m) fns.push({ name: m[1], line: i });
});
const bodies = fns.map((f, k) => ({
  name: f.name,
  text: lines.slice(f.line, k + 1 < fns.length ? fns[k + 1].line : lines.length).join('\n'),
}));

const readModifyWrite = (body) => {
  const gets = [...body.matchAll(/DB\.get\(\s*env\s*,\s*'([a-z_]+)'/g)].map(m => m[1]);
  const puts = [...body.matchAll(/DB\.put\(\s*env\s*,\s*'([a-z_]+)'/g)].map(m => m[1]);
  return [...new Set(gets.filter(g => puts.includes(g)))];
};
/* A WRITE DOES NOT HAVE TO SPELL ITSELF DB.put.

   This asked for `DB.put(env, 'kind'` and nothing else, so a record written
   through a named helper was invisible to it. The wallet is written by
   `_saveWallet(env, email, w)`, which puts `wallet:<email>` straight into the
   namespace - and the payout-rejection refund read the wallet, added the
   money and wrote the whole record back that way, outside the lock every other
   wallet writer takes. A refund landing beside a sale silently dropped one of
   them, and the whole file exists to find exactly that.

   It is the third time a check here has gone blind because it recognised a
   write by its spelling (LESSONS #233). So the helpers are DERIVED: any
   top-level `_saveX(env, ...)` whose body writes a `<kind>:` key is a way of
   writing that kind, and calling it counts. A fourth spelling invented next
   year is covered without anybody editing this list. */
const SAVERS = new Map();
for (const m of code.matchAll(/^(?:async\s+)?function\s+(_save[A-Za-z]*)\s*\(/gm)) {
  const seg = code.slice(m.index, m.index + 500);
  const k = seg.match(/AMV_KV\.put\(\s*`([a-z_]+):/) || seg.match(/DB\.put\(\s*env\s*,\s*'([a-z_]+)'/);
  if (k) SAVERS.set(m[1], k[1]);
}

/* AND THE LOCKS THAT DO NOT NAME THEIR KIND EITHER.

   `lockedKinds` was built from `_withX(env, 'kind'` - which is right for the
   generic helpers and blind to the ones that already know what they guard.
   `_withWallet(env, email, ...)` takes no kind argument, so `wallet` was never
   a locked kind here at all, and the rule this whole file rests on - locked
   somewhere, therefore locked everywhere - simply never applied to the record
   that holds people's money.

   Derived from the pair: a `_withX` whose body calls a `_saveX` is the lock for
   whatever that saver writes. */
const FIXED_LOCKS = new Map();
for (const m of code.matchAll(/^(?:async\s+)?function\s+(_with[A-Za-z]+)\s*\(/gm)) {
  const seg = code.slice(m.index, m.index + 1200);
  for (const [saver, kind] of SAVERS) {
    if (new RegExp('\\b' + saver + '\\(').test(seg)) { FIXED_LOCKS.set(m[1], kind); lockedKinds.add(kind); }
  }
}

/* Every kind this handler writes DIRECTLY, whether or not it also takes a lock
   for something. */
const rawWrites = (body) => {
  const out = new Set([...body.matchAll(/DB\.put\(\s*env\s*,\s*'([a-z_]+)'/g)].map(m => m[1]));
  for (const [fn, kind] of SAVERS) {
    if (new RegExp('\\b' + fn + '\\(').test(body)) out.add(kind);
  }
  return out;
};

/* Handlers that legitimately write a record they also read, with no lock and
   with a reason. Each one is a single writer, or a write where losing the race
   costs nothing anybody would notice. */
/* EIGHT EXEMPTIONS WERE DELETED HERE, NOT REWORDED.

   Every one of them said some version of "the caller's own record, and nobody
   else writes it". That is true of who OWNS the record and says nothing about
   how many writers it has: one person with a phone and a laptop is two, a
   double-submitted form is two, and a retry landing beside the original is two.

   Three of them were wrong on their own terms as well. apiKeyCreate was excused
   because "the cap below refuses the second anyway" - the cap is read inside
   the same window it is meant to close, so it refuses nothing, and the key that
   loses the race keeps a live lookup row while vanishing from the list that
   could revoke it. handoffCreate was excused as writing "the SENDER's own copy"
   and wrote the recipient's inbox too, which every other sender appends to.
   widgetConfigSave was excused because "the only other writer is this same
   handler", which is the definition of the race rather than a reason there
   isn't one.

   All eight take the lock now. An exemption whose reason has stopped being
   true is how a real bypass gets waved through later by inheriting somebody
   else's reasoning - which is exactly what happened to the signup, and it took
   an external audit to notice. */
const NO_LOCK_NEEDED = {
  authDeleteAccount: 'erasure, which is terminal: it is removing this person from every link they are in, and there is nothing left afterwards for a lost write to matter to. It already holds the team lock for the same pass',
  /* authSignup WAS exempted here, on the grounds that it creates the record
     everything else keys on, that there is nobody to race, and that a claim
     already stopped two signups for one address. Every part of that was wrong.
     There is somebody to race - the other person submitting the same form - and
     there was no claim anywhere in front of it. Two signups arriving together
     both read nothing, both wrote, and the second one's password became the
     account's while the first still held a working session (AMV-017).

     It takes the account lock now, so it needs no exemption. The line is gone
     rather than reworded: an exemption whose reason has stopped being true is
     how a real bypass gets waved through by inheriting somebody else's. */
  authGoogle:      'the same account creation through Google, with the same claim in front of it',
  teamCreate:      'writes a team that does not exist yet, under a fresh id nobody else has',
  teamPresence:    'who is online right now, overwritten every few seconds by design - a lost write is corrected before anybody reads it',
  errorsReport:    'a telemetry sink; losing a sample of a burst that is being counted in the hundreds changes nothing anybody acts on',
  _workerError:    'the same sink, from the Worker side',
  errorsResolve:   'an operator marking an error group read',
  _investCheckin:  'a snapshot for one account, rewritten in full each time',
  /* googleOAuthExchange was exempted here and the route no longer exists. It
     took a code from the browser and wrote the refresh token it got back, and
     the whole flow was retired when the connected-accounts handshake replaced
     it - the exchange happens in connFinish now, and the token is sealed rather
     than stored in the clear. The line is deleted rather than repointed at
     connFinish: that one takes its own claim, so it needs no exemption, and an
     exemption inherited by a different function is how a real bypass gets waved
     through on somebody else's reasoning. */
  stripeSubscribe: 'writes the billing row for the checkout it is creating',
  fraudRecord:     'an append-only assessment log, read only by an operator',
  widgetConfigGet: 'creates the caller\'s widget record on first read, with a key nobody else has yet',
};

section('Both sides were read');
{
  ok(lockedKinds.size >= 8, 'the kinds written through a lock were found', [...lockedKinds].sort());
  /* A derivation that finds nothing passes everything. Named because the whole
     reason this exists is that `wallet` was invisible here. */
  ok(SAVERS.size >= 1, 'the named save helpers were derived from the source', [...SAVERS]);
  ok(SAVERS.get('_saveWallet') === 'wallet',
     'including the one that writes the wallet, which this check could not see', SAVERS.get('_saveWallet'));
  ok(lockedKinds.has('wallet'), 'and the wallet is a locked kind, so every writer must take it', true);
  ok(bodies.length > 200, 'and every handler in the Worker', bodies.length);
  const anyRMW = bodies.filter(b => readModifyWrite(b.text).length).length;
  ok(anyRMW > 10, 'including the ones that read a record and write it back', anyRMW);
}

section('No record is written through a lock in one place and raw in another');
{
  /* THE ONE THAT MATTERS. If a kind is locked anywhere, every writer has to
     take it - otherwise the lock is decoration and the careful writer is the
     one that loses. */
  /* ASKED PER KIND, not per handler.

     The first version skipped any function that MENTIONED a lock, which made
     it useless: three sabotages that added a raw DB.put back alongside the
     locked call all passed, because the function still contained the word.
     A handler that locks one record and writes another raw is exactly the
     shape this is looking for, so the question has to be about the kind. */
  /* A put that sits INSIDE the lock's own callback is the lock working, not a
     bypass - setEntitlement's write of `ent` is the obvious case. Told apart
     by position: the helper for that kind has to be opened before the write
     happens. That also catches the sabotage the previous version missed, where
     a raw put was added back ahead of a lock call the function still
     contained. */
  const insideTheLock = (body, kind) => {
    const open = body.indexOf("_withRecord(env, '" + kind + "'");
    const openK = body.search(new RegExp('_with(?:Kind|KV|Acct|Ent|Team|Fam|Wallet)\\(\\s*env\\s*,\\s*\'' + kind + '\''));
    /* The wrappers that know their own kind and so do not name it. */
    const fixed = [...FIXED_LOCKS].filter(([, k]) => k === kind)
      .map(([fn]) => body.search(new RegExp('\\b' + fn + '\\(')));
    const first = [open, openK, ...fixed].filter(i => i >= 0);
    if (!first.length) return false;
    const puts = [body.search(new RegExp('DB\\.put\\(\\s*env\\s*,\\s*\'' + kind + '\''))];
    /* The named savers too, or a raw `_saveWallet` sitting AFTER a _withWallet
       call in the same handler would be read as "inside the lock" when it is
       the bypass this is looking for. */
    for (const [fn, k] of SAVERS) {
      if (k !== kind) continue;
      const at = body.search(new RegExp('\\b' + fn + '\\('));
      if (at >= 0) puts.push(at);
    }
    const put = Math.min(...puts.filter(i => i >= 0).concat([Infinity]));
    return put === Infinity || Math.min(...first) < put;
  };
  /* The save halves of the lock helpers themselves. `_saveAcct` exists to be
     the write _withAcct performs INSIDE the lock, so reporting it is reporting
     the mechanism for using the mechanism. Matched by shape rather than named,
     so a new pair added later is covered without anybody editing this. */
  const IS_LOCK_PLUMBING = /^_(save|load)[A-Z]/;
  const bypassing = [];
  for (const b of bodies) {
    if (b.name in NO_LOCK_NEEDED) continue;
    if (IS_LOCK_PLUMBING.test(b.name)) continue;
    for (const kind of rawWrites(b.text)) {
      if (!lockedKinds.has(kind)) continue;
      if (insideTheLock(b.text, kind)) continue;
      bypassing.push(b.name + ' writes ' + kind + ' with DB.put, but ' + kind + ' is locked elsewhere');
    }
  }
  ok(bypassing.length === 0,
     'every writer of a locked record takes the lock', bypassing);
}

section('And the exemptions are honest');
{
  /* An exemption for a handler that no longer reads-and-writes anything is a
     line nobody will question later, and it is how a real bypass gets waved
     through by inheriting somebody else's reason. */
  const names = new Set(bodies.map(b => b.name));
  const gone = Object.keys(NO_LOCK_NEEDED).filter(n => !names.has(n));
  ok(gone.length === 0, 'every exemption still names a function that exists', gone);

  const notRMW = Object.keys(NO_LOCK_NEEDED).filter(n => {
    const b = bodies.find(x => x.name === n);
    return b && readModifyWrite(b.text).length === 0;
  });
  ok(notRMW.length === 0,
     'and still describes a handler that reads a record and writes it back', notRMW);

  /* An exemption that has since started taking a lock is not an exemption. */
  /* An exemption that has since started locking THE RECORD IT WAS EXCUSED FOR
     is not an exemption any more. Taking some other record's lock in the same
     handler is ordinary - erasure holds the team lock while it also clears a
     link - so the question has to name the kind. */
  const nowLocks = Object.keys(NO_LOCK_NEEDED).filter(n => {
    const b = bodies.find(x => x.name === n);
    if (!b) return false;
    return [...rawWrites(b.text)].some(kind =>
      new RegExp('_with(?:Kind|KV|Record|Acct|Ent|Team|Fam|Wallet)\\(\\s*env\\s*,\\s*\'' + kind + '\'').test(b.text));
  });
  ok(nowLocks.length === 0,
     'and none of them has quietly started locking the record it was excused for', nowLocks);
}

section('The six that were bypassing it now take it, by name');
{
  /* Named individually. The rule above is satisfied by adding an exemption,
     which for these would be the wrong answer - each one loses something that
     matters when it loses the race. */
  /* Takes the lock AND does not also write the record raw - a dead-code lock
     beside a live DB.put is what three sabotages did, and it has to read as
     the bypass it is. */
  /* `auto` is written through _withAuto now - a wrapper that takes the same
     lock and books the due-time index as part of the write, so booking cannot
     be forgotten by a caller. A named wrapper around the lock is still the
     lock, so it counts as one. */
  const LOCK_FOR = { auto: /_with(?:Auto|Kind|KV|Record)\(\s*env\s*,\s*(?:'auto'\s*,\s*)?/ };
  const takesLock = (fn, kind) => {
    const b = bodies.find(x => x.name === fn);
    if (!b) return false;
    /* A dead-code lock beside a live DB.put is a bypass, so the write has to
       be the locked one rather than merely accompanied by a lock. */
    const put = b.text.search(new RegExp('DB\\.put\\(\\s*env\\s*,\\s*\'' + kind + '\''));
    const re = LOCK_FOR[kind] || new RegExp('_with(?:Kind|KV|Record)\\(\\s*env\\s*,\\s*\'' + kind + '\'');
    const lock = b.text.search(re);
    return lock >= 0 && (put < 0 || lock < put);
  };
  ok(takesLock('abuseClear', 'abuse'),
     'clearing an abuse flag cannot erase a chargeback that landed while it read', true);
  ok(takesLock('crewApprovalEdit', 'approvals'),
     'editing an approval cannot drop one that arrived while it read', true);
  ok(takesLock('autoClearResults', 'auto'),
     'marking results read cannot overwrite what the cron just produced', true);
  ok(takesLock('shareRevoke', 'shares'),
     'revoking a share cannot lose to a share being created', true);
  ok(takesLock('linkRevoke', 'links'),
     'and revoking access cannot lose to anything, in either direction', true);
  ok(takesLock('marketPublish', 'seller'),
     'a policy strike is counted from what is stored, so two at once are two', true);
}

if (report('a-lock-nobody-takes-is-not-a-lock') > 0) process.exitCode = 1;
done();
