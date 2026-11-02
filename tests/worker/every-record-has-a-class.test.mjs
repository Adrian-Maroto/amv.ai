/* EVERY RECORD HAS A CLASS, AND THE CLASS IS A RULE (Nov 1 audit OPS-003).

   docs/DATA-CLASSIFICATION.md says what each class of data is and what
   happens to it. That was prose: nothing tied a new kind of record to a class,
   so a new one could be stored with no decision about how sensitive it is.

   docs/data-inventory.json names every kind of record the Worker keeps - the
   same set the backup lists must account for (backup-covers-everything) - with
   its class, what it holds and how long it is kept. This checks the file
   against the code, both ways, and enforces what a class means where code can:
     - every kind the backup lists know is in the inventory, and nothing stale;
     - every entry has a known class, says what it holds and how long it stays;
     - whether it is backed up agrees with BACKUP_PREFIXES / BACKUP_NEVER;
     - a credential for another service is NEVER in a backup;
     - a security challenge or code that lives for minutes is never in one;
     - every financial record is backed up, or says why not by being a sealed
       link or a short-lived reservation. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const inv = JSON.parse(readFileSync(join(ROOT, 'docs', 'data-inventory.json'), 'utf8')).kinds;
const listBody = (name) => {
  const m = src.match(new RegExp(name + '\\s*=\\s*\\[(.*?)\\n\\];', 's'));
  return m ? new Set([...m[1].matchAll(/'([a-z_]+):'/g)].map(x => x[1])) : new Set();
};
const backed = listBody('BACKUP_PREFIXES');
const never = listBody('BACKUP_NEVER');
const CLASSES = ['security', 'credential', 'financial', 'content', 'account', 'enterprise', 'operational', 'public'];

section('The inventory and the code name the same records');
{
  ok(backed.size > 20 && never.size > 20, 'both backup lists were read', [backed.size, never.size]);
  const missing = [...backed, ...never].filter(k => !inv[k]).sort();
  ok(missing.length === 0, 'every kind the Worker keeps has an entry - a new one needs a class before it ships', missing);
  const stale = Object.keys(inv).filter(k => !backed.has(k) && !never.has(k)).sort();
  ok(stale.length === 0, 'and nothing in the inventory is a kind the Worker no longer keeps', stale);
}

section('Each entry is a decision, not a placeholder');
{
  const bad = Object.entries(inv).filter(([, e]) => !CLASSES.includes(e.class) || !String(e.holds || '').trim() || !String(e.kept || '').trim()).map(([k]) => k);
  ok(bad.length === 0, 'a known class, what it holds, and how long it is kept', bad);
  const wrong = Object.entries(inv).filter(([k, e]) => e.backup !== backed.has(k)).map(([k]) => k);
  ok(wrong.length === 0, 'whether it is backed up is what the code does', wrong);
}

section('What a class means, enforced');
{
  const credsBacked = Object.entries(inv).filter(([k, e]) => e.class === 'credential' && backed.has(k)).map(([k]) => k);
  ok(credsBacked.length === 0, 'no credential for another service is ever in a backup', credsBacked);
  ok(Object.values(inv).filter(e => e.class === 'credential').length >= 8, 'and the credentials are recognised as such', true);
  const shortSec = Object.entries(inv).filter(([k, e]) => e.class === 'security' && /minute|hour/.test(e.kept) && backed.has(k)).map(([k]) => k);
  ok(shortSec.length === 0, 'no short-lived challenge or code is restored from a backup', shortSec);
  const moneyOut = Object.entries(inv).filter(([k, e]) => e.class === 'financial' && !backed.has(k) && !/minute|day|until/.test(e.kept)).map(([k]) => k);
  ok(moneyOut.length === 0, 'a lasting money record is always in the backup', moneyOut);
  for (const k of ['conn', 'agentjar', 'mailcfg', 'finlink']) ok(inv[k] && inv[k].class === 'credential', k + ' is a credential', inv[k]);
  for (const k of ['wallet', 'wallet_tx', 'withdraw', 'txn']) ok(inv[k] && inv[k].class === 'financial' && inv[k].backup, k + ' is financial and backed up', inv[k]);
}

if (report('every-record-has-a-class') > 0) process.exitCode = 1;
done();
