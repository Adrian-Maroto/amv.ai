/* EVERY BACKGROUND DUTY HAS AN OWNER AND A RETRY RULE (Nov 1 audit TASK-004).

   docs/async-inventory.json names everything AMV does with nobody waiting:
   each duty of the scheduled handler and each kind of queue message, the
   function that runs it, the file that owns it, and what happens when it
   fails. Checked against the code both ways, so a new duty cannot be added
   without saying how it is retried. */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const inv = JSON.parse(readFileSync(join(ROOT, 'docs', 'async-inventory.json'), 'utf8'));
const router = readFileSync(join(ROOT, 'src', 'worker', '29-router.js'), 'utf8');
const queue = readFileSync(join(ROOT, 'src', 'worker', '15a-job-queue.js'), 'utf8');

section('Every scheduled duty is in the inventory, and nothing else is');
{
  const inCode = new Set([...router.matchAll(/_workerError\(env, 'cron\.([a-z0-9-]+)'/g)].map(m => m[1]));
  ok(inCode.size >= 10, 'the scheduled duties were read from the handler', [...inCode]);
  const missing = [...inCode].filter(k => !inv.cron[k]);
  ok(missing.length === 0, 'each has an entry', missing);
  const stale = Object.keys(inv.cron).filter(k => !inCode.has(k));
  ok(stale.length === 0, 'and the inventory names no duty the handler no longer has', stale);
}

section('Every kind of queue message is in it');
{
  const kinds = new Set(['auto', ...[...queue.matchAll(/body\.kind === '([a-z]+)'/g)].map(m => m[1])]);
  const missing = [...kinds].filter(k => !inv.queue[k]);
  ok(missing.length === 0 && Object.keys(inv.queue).every(k => kinds.has(k)), 'each message kind the consumer handles, both ways', { kinds: [...kinds], inv: Object.keys(inv.queue) });
}

section('Each names the function that runs it, the file that owns it, and its retry rule');
{
  const all = [...Object.entries(inv.cron), ...Object.entries(inv.queue)];
  const bad = [];
  for (const [k, e] of all) {
    const file = join(ROOT, e.owner || '');
    const src = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (!src || !new RegExp('async function ' + (e.runs || '#none#') + '\\(').test(src)) bad.push(k + ': ' + e.runs + ' not in ' + e.owner);
    if (String(e.retry || '').length < 20 || String(e.what || '').length < 8) bad.push(k + ': no retry rule or description');
  }
  ok(bad.length === 0, 'every entry is true of the code', bad);
}

if (report('every-background-duty-has-an-owner') > 0) process.exitCode = 1;
done();
