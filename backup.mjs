#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   AMV BACKUP  —  local snapshot & restore of all customer data

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
  if (r.status === 401) die('unauthorized — check AMV_ADMIN_TOKEN');
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
  if (r.status === 401) die('unauthorized — check AMV_ADMIN_TOKEN');
  if (!r.ok) die(`restore failed: HTTP ${r.status}`);
  const res = await r.json();
  console.log(`${G}✓${X} restored ${B}${res.restored}${X} keys` +
    (res.skipped ? `, skipped ${res.skipped} (already present)` : '') +
    (res.rejected ? `, ${Y}rejected ${res.rejected} (outside backup scope)${X}` : ''));
}

(async () => {
  if (cmd === 'export') await doExport();
  else if (cmd === 'restore') await doRestore();
  else {
    console.log(`${B}AMV backup${X}\n`);
    console.log('  node backup.mjs export                  save a snapshot to ./backups/');
    console.log('  node backup.mjs export --out file.json  save to a specific path');
    console.log('  node backup.mjs restore file.json       restore (merge; never deletes)');
    console.log('  node backup.mjs restore file.json --missing   only restore keys that are gone');
    console.log(`\n  ${DIM}Set AMV_API_URL and AMV_ADMIN_TOKEN first.${X}`);
    process.exit(cmd ? 1 : 0);
  }
})();
