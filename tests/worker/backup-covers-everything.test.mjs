/* A DURABLE RECORD NOBODY LISTED IS A RECORD NOBODY CAN RESTORE.

   The backup exists because one bad migration or an accidental namespace delete
   wipes every account, subscription, chat and automation with no recovery. It
   works by exporting a list of key prefixes.

   A list is only as good as the last time somebody remembered to add to it, and
   nothing connected it to the record kinds the worker actually writes. Comparing
   the two found seven durable kinds in neither list - not excluded, just never
   considered. Among them:

     mktsnap  the deliverable snapshotted at purchase, which exists precisely so
              a later seller edit cannot revoke what a buyer paid for
     spend    everybody's spending limits - a restore without them resets the
              lot to defaults, which is the permissive direction
     fraud    the abuse assessments an operator needs after an incident

   And three that must NOT be exported, which is a different statement from
   being forgotten: OAuth tokens do not belong in a snapshot file, and pending
   invitations, presence and error logs regenerate on their own.

   So the rule is not "back everything up". It is that every durable kind is in
   exactly one of the two lists, and adding a new one forces the decision. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');

/* WHERE THE RECORD KINDS COME FROM.

   This asked `DB.put(env, 'kind', ...)` and nothing else, so it saw only the
   records that go through that one door. Everything written straight to the
   namespace - `env.AMV_KV.put(`withdraw:${id}`, ...)` and its like - was
   invisible, and the check reported a complete list while seventeen durable
   kinds sat in neither list. Among them the payout ledger, a seller's money
   history, the identity verdicts and the reverse Stripe map: the four records
   that cannot be reconstructed from anything else AMV holds.

   A completeness check has to be complete about how the code WRITES, not
   about how somebody hoped it would. Comments are stripped first, because a
   prefix mentioned in a note is not a record anybody stores. */
const code = codeOnly(src);
const kindsFrom = (re) => new Set([...code.matchAll(re)].map(m => m[1]));
const managed = new Set([
  ...kindsFrom(/DB\.put\(env,\s*'([a-z_]+)'/g),
  ...kindsFrom(/DB\.(?:get|del|list)\(env,\s*'([a-z_]+)'/g),
  /* Straight to the namespace, both quotings. */
  ...kindsFrom(/AMV_KV\.put\(\s*`([a-z_]+):/g),
  ...kindsFrom(/AMV_KV\.put\(\s*'([a-z_]+):/g),
  /* And through the locked helper, which writes `${name}:${key}`. */
  ...kindsFrom(/_withKV\(env,\s*'([a-z_]+)'/g),
]);

const listBody = (name) => {
  const m = src.match(new RegExp(name + '\\s*=\\s*\\[(.*?)\\n\\];', 's'));
  return m ? new Set([...m[1].matchAll(/'([a-z_]+):'/g)].map(x => x[1])) : new Set();
};
const backed = listBody('BACKUP_PREFIXES');
const never = listBody('BACKUP_NEVER');

section('Both lists and the record kinds were found');
{
  ok(managed.size > 35, 'the durable record kinds were parsed', managed.size);
  /* Named, because the whole failure was that these were not seen. If the
     sweep narrows again it must not narrow back to exactly this blind spot. */
  /* kyc is deliberately not here: nothing in the Worker WRITES it yet - the
     provider is not wired, and _kycState only reads. It is in the backup list
     for the day one does, which is the right way round, but a check that
     something is "counted" has to be about a write or it is asserting nothing. */
  ['withdraw', 'wallet_tx', 'custemail', 'txn'].forEach(k => {
    ok(managed.has(k), k + ' is written straight to KV and is still counted', k);
  });
  ok(backed.size > 20, 'the backup list was parsed', backed.size);
  ok(never.size > 2, 'and the deliberate exclusions', never.size);
}

section('Every durable record is either backed up or deliberately not');
{
  const unclassified = [...managed].filter(k => !backed.has(k) && !never.has(k)).sort();
  ok(unclassified.length === 0,
     'no kind is durable and simply unlisted - a new one forces the decision', unclassified);
}

section('The two lists do not disagree with each other');
{
  const both = [...backed].filter(k => never.has(k)).sort();
  ok(both.length === 0, 'nothing is both exported and never exported', both);
}

section('The things somebody paid for are in the backup');
{
  /* Named individually. The general rule above is satisfied by moving something
     into BACKUP_NEVER, which for these would be the wrong answer. */
  /* spendlimits, not spend: the daily global spend COUNTER is keyed spend:<date>
     and is ephemeral, while the per-account limits are durable. They were once
     the same prefix, which swept the counters into the snapshot. */
  ['mktsnap', 'purchases', 'entitleitem', 'wallet', 'spendlimits', 'billing',
   /* The money records. A restore that brings back everybody's account and
      forgets who was paid what leaves AMV unable to answer a seller asking
      where their money went, or a tax authority asking the same thing. */
   'withdraw', 'payoutyear', 'wallet_tx', 'txn', 'saleref'].forEach(k => {
    ok(backed.has(k), k + ' survives a restore', k);
  });
}

section('Credentials are never written into a snapshot file');
{
  /* A backup is a file somebody downloads. Access tokens in it turn one leaked
     export into every connected account. */
  ['fin', 'finlink', 'goauth',
   /* Live, short-lived credentials: a reset token in a downloadable file is a
      way into an account, and losing one costs the person a second click. */
   'reset', 'resetcode', 'smsverify', 'invite'].forEach(k => {
    ok(never.has(k), k + ' is excluded on purpose', k);
    ok(!backed.has(k), 'and is not exported', k);
  });
}

if (report('backup-covers-everything') > 0) process.exitCode = 1;
done();
