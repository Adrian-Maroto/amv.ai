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
/* Every kind this handler writes DIRECTLY, whether or not it also takes a lock
   for something. */
const rawWrites = (body) =>
  new Set([...body.matchAll(/DB\.put\(\s*env\s*,\s*'([a-z_]+)'/g)].map(m => m[1]));

/* Handlers that legitimately write a record they also read, with no lock and
   with a reason. Each one is a single writer, or a write where losing the race
   costs nothing anybody would notice. */
const NO_LOCK_NEEDED = {
  authDeleteAccount: 'erasure, which is terminal: it is removing this person from every link they are in, and there is nothing left afterwards for a lost write to matter to. It already holds the team lock for the same pass',
  authSignup:      'creates the account record that everything else keys on - there is nobody else to race, and _claimOnce already stops two signups for one address',
  authGoogle:      'the same account creation through Google, with the same claim in front of it',
  teamCreate:      'writes a team that does not exist yet, under a fresh id nobody else has',
  apiKeyCreate:    'appends to the caller\'s own key list; two creates at once is one person double-clicking, and the cap below refuses the second anyway',
  teamPresence:    'who is online right now, overwritten every few seconds by design - a lost write is corrected before anybody reads it',
  errorsReport:    'a telemetry sink; losing a sample of a burst that is being counted in the hundreds changes nothing anybody acts on',
  _workerError:    'the same sink, from the Worker side',
  errorsResolve:   'an operator marking an error group read',
  deployDelete:    'the caller\'s own site index',
  consentRecord:   'append-only consent log for one account',
  _investCheckin:  'a snapshot for one account, rewritten in full each time',
  crewJobs:        'the caller\'s own crew list',
  googleOAuthExchange: 'writes the token it has just received for one account',
  supportSubmit:   'appends to the caller\'s own ticket list',
  stripeSubscribe: 'writes the billing row for the checkout it is creating',
  fraudRecord:     'an append-only assessment log, read only by an operator',
  handoffCreate:   'the recipient\'s inbox is appended to under _withKind by the deliver path; this writes the SENDER\'s own copy',
  handoffAct:      'the actor\'s own copy of a handoff they already hold',
  widgetConfigGet: 'creates the caller\'s widget record on first read, with a key nobody else has yet',
  widgetConfigSave: 'the caller\'s own widget settings; the only other writer is this same handler',
};

section('Both sides were read');
{
  ok(lockedKinds.size >= 8, 'the kinds written through a lock were found', [...lockedKinds].sort());
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
    const first = [open, openK].filter(i => i >= 0);
    if (!first.length) return false;
    const put = body.search(new RegExp('DB\\.put\\(\\s*env\\s*,\\s*\'' + kind + '\''));
    return put < 0 || Math.min(...first) < put;
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
  const takesLock = (fn, kind) => {
    const b = bodies.find(x => x.name === fn);
    if (!b) return false;
    /* A dead-code lock beside a live DB.put is a bypass, so the write has to
       be the locked one rather than merely accompanied by a lock. */
    const put = b.text.search(new RegExp('DB\\.put\\(\\s*env\\s*,\\s*\'' + kind + '\''));
    const lock = b.text.search(new RegExp('_with(?:Kind|KV|Record)\\(\\s*env\\s*,\\s*\'' + kind + '\''));
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
