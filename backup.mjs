#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   AMV BACKUP  -  local snapshot & restore of all customer data

   Your customers' accounts, subscriptions, chats, projects and automations live
   in Cloudflare KV. This pulls a full snapshot to a local file so a bad deploy,
   a bad migration, or an accidental namespace delete can be recovered from.

   Run it on a schedule (cron/Task Scheduler) and keep the files somewhere safe.

   USAGE
     node backup.mjs export                 → saves ./backups/amv-backup-<date>.json
     node backup.mjs export --out my.json   → custom path
     node backup.mjs restore my.json        → restore (merge; never deletes)
     node backup.mjs restore my.json --missing  → only restore keys that are gone

   CONFIG (env vars)
     AMV_API_URL     e.g. https://amv-backend.you.workers.dev   (required)
     AMV_ADMIN_TOKEN your ADMIN_TOKEN secret                    (required)
   ───────────────────────────────────────────────────────────────────────── */
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const G = '\x1b[32m', RED = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';
const die = (m) => { console.error(`${RED}✗${X} ${m}`); process.exit(1); };
const args = process.argv.slice(2);
const cmd = args[0];

const API = (process.env.AMV_API_URL || '').replace(/\/$/, '');
const TOKEN = process.env.AMV_ADMIN_TOKEN || '';

function needConfig() {
  if (!API) die('set AMV_API_URL (your Worker URL, e.g. https://amv-backend.you.workers.dev)');
  if (!TOKEN) die('set AMV_ADMIN_TOKEN (your ADMIN_TOKEN secret)');
}

async function post(path, body) {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': TOKEN },
    body: JSON.stringify(body || {})
  });
  return r;
}

async function doExport() {
  needConfig();
  const outFlag = args.indexOf('--out');
  let outPath = outFlag >= 0 ? args[outFlag + 1] : null;
  if (!outPath) {
    if (!existsSync('backups')) mkdirSync('backups');
    outPath = join('backups', `amv-backup-${new Date().toISOString().slice(0, 10)}.json`);
  }
  console.log(`${DIM}Pulling snapshot from ${API}…${X}`);
  const r = await post('/admin/backup/export', {});
  if (r.status === 401) die('unauthorized - check AMV_ADMIN_TOKEN');
  if (!r.ok) die(`export failed: HTTP ${r.status}`);
  const snap = await r.json();
  writeFileSync(outPath, JSON.stringify(snap, null, 0));
  const kb = (JSON.stringify(snap).length / 1024).toFixed(1);
  console.log(`${G}✓${X} backed up ${B}${snap.keyCount}${X} keys (${kb} KB) → ${B}${outPath}${X}`);
  console.log(`${DIM}  snapshot time: ${snap.createdISO}${X}`);
}

async function doRestore() {
  needConfig();
  const file = args[1];
  if (!file) die('usage: node backup.mjs restore <file.json> [--missing]');
  if (!existsSync(file)) die(`file not found: ${file}`);
  const missing = args.includes('--missing');

  let snap;
  try { snap = JSON.parse(readFileSync(file, 'utf8')); }
  catch { die('could not parse the backup file as JSON'); }
  if (snap._amv_backup !== 1) die('that file is not an AMV backup snapshot');

  const keyCount = snap.keyCount || Object.keys(snap.data || {}).length;
  console.log(`${Y}${B}About to restore ${keyCount} keys${X} from ${file}`);
  console.log(`${DIM}  taken: ${snap.createdISO}  ·  mode: ${missing ? 'missing-only (safe)' : 'merge (overwrites matching keys)'}${X}`);
  console.log(`${DIM}  target: ${API}${X}`);

  // simple confirmation unless --yes is passed
  if (!args.includes('--yes')) {
    process.stdout.write(`${Y}Type "restore" to proceed: ${X}`);
    const answer = await new Promise((res) => {
      process.stdin.resume(); process.stdin.setEncoding('utf8');
      process.stdin.once('data', (d) => { process.stdin.pause(); res(String(d).trim()); });
    });
    if (answer !== 'restore') die('cancelled');
  }

  const r = await post('/admin/backup/import', { snapshot: snap, mode: missing ? 'missing' : 'merge' });
  if (r.status === 401) die('unauthorized - check AMV_ADMIN_TOKEN');
  if (!r.ok) die(`restore failed: HTTP ${r.status}`);
  const res = await r.json();
  console.log(`${G}✓${X} restored ${B}${res.restored}${X} keys` +
    (res.skipped ? `, skipped ${res.skipped} (already present)` : '') +
    (res.rejected ? `, ${Y}rejected ${res.rejected} (outside backup scope)${X}` : ''));
}

/* THE RESTORE DRILL. Reads the newest complete nightly backup (or the night
   named) part by part through the same server path a restore uses, with
   mode 'verify': every record is checked the way a restore checks it and
   nothing is written, so it is safe against production on any day. It says
   how long reading the whole night took - the floor under how long a real
   restore takes - and fails if the night holds fewer records than its
   manifest says, or any record a restore would refuse. */
async function doDrill() {
  needConfig();
  let day = args[1] && /^\d{4}-\d{2}-\d{2}$/.test(args[1]) ? args[1] : '';
  if (!day) {
    const r = await fetch(API + '/admin/backup/nights', { headers: { 'X-Admin-Token': TOKEN } });
    if (r.status === 403) die('forbidden - check AMV_ADMIN_TOKEN');
    const d = await r.json().catch(() => ({}));
    if (!d.on) die('nightly backups are not switched on here: ' + (d.note || 'no AMV_BACKUPS bucket'));
    const done = (d.nights || []).filter(n => n.complete).map(n => n.day).sort();
    if (!done.length) die('there is no complete nightly backup yet');
    day = done[done.length - 1];
  }
  console.log(`${B}Restore drill${X} - reading the ${day} backup, writing nothing`);
  const t0 = Date.now();
  let part = 0, verified = 0, refused = 0, unrestorable = 0, expected = null, parts = null, calls = 0;
  const lost = [];
  for (;;) {
    calls++;
    const r = await post('/admin/backup/import', { fromNight: day, fromPart: part, mode: 'verify' });
    const d = await r.json().catch(() => ({}));
    if (r.status === 403) die('forbidden - check AMV_ADMIN_TOKEN');
    if (!d.drill) die(`the drill could not read the backup: HTTP ${r.status} ${d.error || ''}`);
    verified += d.verified || 0; refused += d.refused || 0; unrestorable += d.unrestorable || 0;
    for (const k of d.lost || []) if (lost.length < 20) lost.push(k);
    expected = d.expected; parts = d.parts;
    if (!d.more) break;
    part = d.nextPart;
    if (calls > 10000) die('the drill did not finish');
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const counted = verified + refused + unrestorable;
  console.log(`  ${parts} part(s), ${verified} record(s) a restore would write, read in ${secs}s over ${calls} request(s)`);
  let bad = false;
  if (expected != null && counted !== expected) { bad = true; console.log(`${RED}✗${X} the manifest says ${expected} records; the parts hold ${counted}`); }
  if (refused) { bad = true; console.log(`${RED}✗${X} ${refused} record(s) outside what a restore accepts`); }
  if (unrestorable) { bad = true; console.log(`${RED}✗${X} ${unrestorable} record(s) a restore could not write: ${lost.join(', ')}`); }
  if (bad) process.exit(1);
  console.log(`${G}✓${X} the ${day} backup is complete and restorable. Reading it took ${secs}s; a real restore also writes every record, so it takes longer.`);
}

(async () => {
  if (cmd === 'export') await doExport();
  else if (cmd === 'restore') await doRestore();
  else if (cmd === 'drill') await doDrill();
  else {
    console.log(`${B}AMV backup${X}\n`);
    console.log('  node backup.mjs export                  save a snapshot to ./backups/');
    console.log('  node backup.mjs export --out file.json  save to a specific path');
    console.log('  node backup.mjs restore file.json       restore (merge; never deletes)');
    console.log('  node backup.mjs restore file.json --missing   only restore keys that are gone');
    console.log('  node backup.mjs drill [YYYY-MM-DD]      read a nightly backup through the restore path, write nothing');
    console.log(`\n  ${DIM}Set AMV_API_URL and AMV_ADMIN_TOKEN first.${X}`);
    process.exit(cmd ? 1 : 0);
  }
})();
