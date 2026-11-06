/* AN EMPTY CATCH IN TRUST CODE SAYS WHY (Nov 3 audit SEC-001).

   A swallowed failure looks exactly like success. In the files that decide
   sign-in, money, permissions, migration, backup and erasure, every catch
   that does nothing now says why doing nothing is right - cleanup that
   nothing depends on, logging that decides nothing, a record already spent,
   a lock that expires, a read whose absence fails closed - and the handful
   where it was not right were changed to say so (a payout or tax row that
   does not parse, a sign-out-everywhere step that failed, a team join whose
   rollback did not take). A new bare `catch {}` in these files fails here.

   Everywhere else the count may only go down. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TRUST = ['04-data-layer', '04a-control-plane', '04b-pg-backfill', '04c-pg-shadow', '04d-pg-read', '07-atomic-counters',
  '09-connected-accounts', '09a-action-protocol', '11-company-sign-in', '27-backup-restore', '27a-nightly-backup', '28-password-reset',
  '30-accounts-and-sync', '31-sign-in-codes', '33-team-roles', '34-chat-sync', '41-signed-tokens', '46-referrals', '47-renewal-sweep',
  '49-renewals-and-ledger', '50-extra-usage', '53-marketplace-economy', '54-payouts', '73-passkeys-and-mfa', '77a-agent-signins', '83-support'];
/* Bare: nothing inside the braces, not even a comment. Read from the code
   with comments KEPT inside the catch body (a comment there is the reason),
   but comments elsewhere stripped (an essay quoting `catch(e){}` is not one). */
const BARE = /catch\s*(\(\s*[\w$]*\s*\))?\s*\{\s*\}/g;
const bareIn = (src) => {
  /* Drop block comments that are not the whole body of a catch. */
  const kept = src.replace(/\/\*[\s\S]*?\*\//g, (c, i) => /catch\s*(\([^)]*\))?\s*\{\s*$/.test(src.slice(Math.max(0, i - 40), i)) ? '/*R*/' : ' ');
  return [...kept.replace(/(^|[^:'"`])\/\/.*$/gm, '$1').matchAll(BARE)].length;
};

section('Trust-critical files: every empty catch says why');
{
  const found = {};
  for (const t of TRUST) {
    const n = bareIn(readFileSync(join(ROOT, 'src/worker', t + '.js'), 'utf8'));
    if (n) found[t] = n;
  }
  ok(Object.keys(found).length === 0, 'no bare catch {} in the files that decide sign-in, money, permissions, migration, backup and erasure', found);
}

section('Everywhere else in the Worker, the count only goes down');
{
  let total = 0;
  for (const f of readdirSync(join(ROOT, 'src/worker')).filter(f => f.endsWith('.js'))) {
    if (TRUST.includes(f.replace(/\.js$/, ''))) continue;
    total += bareIn(readFileSync(join(ROOT, 'src/worker', f), 'utf8'));
  }
  /* The ceiling is today's number. Lower it when one is given a reason. */
  const CEILING = Number(readFileSync(join(ROOT, 'tests/worker/empty-catch-ceiling.txt'), 'utf8').trim());
  ok(total <= CEILING, 'no new bare catch {} outside them either (ceiling ' + CEILING + ')', total);
}

if (report('an-empty-catch-in-trust-code-says-why') > 0) process.exitCode = 1;
done();
