
/* ══════════════════════════════════════════════════════════════════════════
   THE NIGHTLY BACKUP (Oct 31 production audit: automated backups).

   The backup above is a file an operator downloads. Nobody downloads one on
   an ordinary night, and one file cannot hold a large namespace inside one
   Worker run anyway. With the AMV_BACKUPS bucket bound, every night is backed
   up by itself, in slices:

     each five-minute tick does about twenty seconds of it - one page of up to
     a thousand records per part, written as one object - and saves where it
     got to after every part, so a tick that dies costs a repeated part, never
     a gap;
     the same records the export takes (BACKUP_PREFIXES), held to the same
     size a restore accepts: a record too large to restore abandons the night
     and says so, rather than writing a backup that cannot be restored;
     a night counts only when its manifest is written, last;
     thirty nights are kept; a night that has not finished by 06:00 UTC the
     next day pages the operator.

   A restore reads a night back through the same rules as an uploaded
   snapshot (_restoreEntries): only the backup prefixes, and a restore never
   undoes a revocation. When D1 is the store, D1's own Time Travel keeps
   thirty days of every write and this does not run - it would back up a copy
   that is no longer the truth. */

const NIGHTLY_SLICE_MS = 20 * 1000;
const NIGHTLY_PAGE = 1000;
const NIGHTLY_KEEP_DAYS = 30;
const NIGHTLY_LATE_HOUR_UTC = 6;

function _nightlyOn(env){
  return !!(env && env.AMV_BACKUPS && typeof env.AMV_BACKUPS.put === 'function' && typeof env.AMV_BACKUPS.list === 'function');
}
const _nightlyDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const _nightlyStateKey = (day) => 'bkrun:' + day;
const _nightlyPart = (day, n) => 'backups/' + day + '/part-' + String(n).padStart(6, '0') + '.ndjson';
const _nightlyManifest = (day) => 'backups/' + day + '/manifest.json';

/* One tick's share. Returns what it did, for the log. */
async function runNightlyBackup(env, atMs){
  if (!_nightlyOn(env)) return { on: false };
  if (DB._hasD1(env)) return { on: false, why: 'd1' };
  const now = +atMs || Date.now();
  const day = _nightlyDay(now);
  const started = Date.now();

  /* Last night not finished by the morning: said once, while there is still
     a day to put it right. */
  const yesterday = _nightlyDay(now - 86400000);
  if (new Date(now).getUTCHours() >= NIGHTLY_LATE_HOUR_UTC) {
    let y = null; try { y = JSON.parse((await env.AMV_KV.get(_nightlyStateKey(yesterday))) || 'null'); } catch (e) { y = null; }
    if (!y || !y.done) {
      try { await alertOnce(env, 'nightly_backup_late',
        'Last night’s backup (' + yesterday + ') did not finish' + (y && y.failed ? ': ' + y.failed : '') + '. '
        + 'The newest complete one is still in the backups bucket; tonight’s starts on its own.', 12 * 60); } catch (e) {}
    }
  }

  let st;
  try { st = JSON.parse((await env.AMV_KV.get(_nightlyStateKey(day))) || 'null'); } catch (e) { st = null; }
  if (!st) st = { day, prefix: 0, cursor: null, part: 0, count: 0, bytes: 0, startedAt: now, done: false, failed: '' };
  if (st.done || st.failed) return { on: true, day, done: st.done, failed: st.failed || undefined };

  const save = () => env.AMV_KV.put(_nightlyStateKey(day), JSON.stringify(st), { expirationTtl: 40 * 86400 });
  let parts = 0;
  while (st.prefix < BACKUP_PREFIXES.length && Date.now() - started < NIGHTLY_SLICE_MS) {
    const prefix = BACKUP_PREFIXES[st.prefix];
    const page = await env.AMV_KV.list({ prefix, cursor: st.cursor || undefined, limit: NIGHTLY_PAGE });
    const lines = [];
    for (const k of (page.keys || [])) {
      const raw = await env.AMV_KV.get(k.name);
      if (raw == null) continue;
      if (raw.length > BACKUP_MAX_VALUE_BYTES) {
        st.failed = k.name + ' is ' + raw.length + ' bytes, larger than a restore accepts';
        await save();
        audit(env, 'nightly_backup_failed', { day, key: k.name, bytes: raw.length });
        try { await alertOnce(env, 'nightly_backup_failed',
          'Tonight’s backup was abandoned: ' + st.failed + ', so it could not have been restored in full. '
          + 'The record needs looking at; the last complete backup is untouched.', 6 * 60); } catch (e) {}
        return { on: true, day, failed: st.failed };
      }
      lines.push(JSON.stringify({ k: k.name, v: raw }));
      st.bytes += raw.length + k.name.length;
    }
    if (lines.length) {
      await env.AMV_BACKUPS.put(_nightlyPart(day, st.part), lines.join('\n') + '\n', { httpMetadata: { contentType: 'application/x-ndjson' } });
      st.part++; st.count += lines.length; parts++;
    }
    if (page.list_complete) { st.prefix++; st.cursor = null; }
    else st.cursor = page.cursor;
    await save();
  }

  if (st.prefix < BACKUP_PREFIXES.length) return { on: true, day, parts, count: st.count, more: true };

  /* Written last: a night without a manifest is not a backup. */
  await env.AMV_BACKUPS.put(_nightlyManifest(day), JSON.stringify({
    _amv_backup: 1, day, complete: true, keyCount: st.count, approxBytes: st.bytes, parts: st.part,
    prefixes: BACKUP_PREFIXES, startedAt: st.startedAt, finishedAt: Date.now(),
    finishedISO: new Date().toISOString(),
  }), { httpMetadata: { contentType: 'application/json' } });
  st.done = true; await save();
  audit(env, 'nightly_backup', { day, keyCount: st.count, parts: st.part, bytes: st.bytes });
  await _nightlyPrune(env, now);
  return { on: true, day, done: true, count: st.count, parts: st.part };
}

/* Thirty nights kept; anything older is deleted, part by part. */
async function _nightlyPrune(env, now){
  const oldest = _nightlyDay(now - NIGHTLY_KEEP_DAYS * 86400000);
  try {
    const days = await _nightlyDays(env);
    for (const d of days.filter(d => d.day < oldest)) {
      let cursor;
      do {
        const page = await env.AMV_BACKUPS.list({ prefix: 'backups/' + d.day + '/', cursor });
        for (const o of (page.objects || [])) await env.AMV_BACKUPS.delete(o.key);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      audit(env, 'nightly_backup_pruned', { day: d.day });
    }
  } catch (e) { audit(env, 'nightly_backup_prune_failed', { error: String((e && e.message) || e).slice(0, 120) }); }
}

/* Every night in the bucket, with whether it is complete. */
async function _nightlyDays(env){
  const days = new Set();
  let cursor;
  do {
    const page = await env.AMV_BACKUPS.list({ prefix: 'backups/', delimiter: '/', cursor });
    for (const p of (page.delimitedPrefixes || [])) { const m = /^backups\/(\d{4}-\d{2}-\d{2})\/$/.exec(p); if (m) days.add(m[1]); }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const out = [];
  for (const day of [...days].sort()) {
    let man = null;
    try { const o = await env.AMV_BACKUPS.get(_nightlyManifest(day)); if (o) man = JSON.parse(await o.text()); } catch (e) { man = null; }
    out.push({ day, complete: !!(man && man.complete), keyCount: man ? man.keyCount : null, parts: man ? man.parts : null });
  }
  return out;
}

/* GET /admin/backup/nights - what there is to restore from. */
async function backupNights(request, env){
  const gate = await _adminGate(request, env, 'backup', 10, 100);
  if (gate) return gate;
  if (!_nightlyOn(env)) return json({ on: false, nights: [], note: 'Nightly backups are off: bind the AMV_BACKUPS bucket (wrangler.toml).' });
  return json({ on: true, nights: await _nightlyDays(env), keepDays: NIGHTLY_KEEP_DAYS });
}

/* A restore from a night, called by backupImport with { fromNight, fromPart }.
   Only a complete night; part by part, through _restoreEntries; and when the
   time a request has runs short it stops between parts and says where to go
   on from, rather than finishing short. */
async function _restoreFromNight(env, day, fromPart, mode){
  if (!_nightlyOn(env)) return json({ error: 'Nightly backups are not switched on here.', code: 'needs_service' }, 503);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return json({ error: 'Name the night as YYYY-MM-DD.', code: 'bad_request' }, 400);
  let man = null;
  try { const o = await env.AMV_BACKUPS.get(_nightlyManifest(day)); if (o) man = JSON.parse(await o.text()); } catch (e) { man = null; }
  if (!man || !man.complete) return json({ error: 'There is no complete backup for ' + day + '.', code: 'no_backup' }, 404);
  const started = Date.now();
  const t = { restored: 0, skipped: 0, refused: 0, unrestorable: 0, heldForward: 0, lost: [] };
  let part = Math.max(0, parseInt(fromPart, 10) || 0);
  for (; part < man.parts; part++) {
    if (Date.now() - started > NIGHTLY_SLICE_MS) break;
    const o = await env.AMV_BACKUPS.get(_nightlyPart(day, part));
    if (!o) {
      try { await alertOnce(env, 'restore_incomplete', 'A restore from the ' + day + ' backup stopped: part ' + part + ' is missing from the bucket.', 5); } catch (e) {}
      return json({ ok: false, code: 'restore_incomplete', error: 'Part ' + part + ' of the ' + day + ' backup is missing, so the restore stopped there. Parts before it were restored.', ...t, nextPart: part }, 422);
    }
    const entries = [];
    for (const line of (await o.text()).split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch (e) { t.unrestorable++; continue; }
      if (r && typeof r.k === 'string') entries.push([r.k, r.v]);
    }
    await _restoreEntries(env, entries, mode, t);
  }
  audit(env, 'backup_import', { mode, from: 'night:' + day, ...t, lost: t.lost.join(',') || undefined, through: part });
  const ok = !t.unrestorable;
  if (part < man.parts) return json({ ok, more: true, nextPart: part, parts: man.parts, ...t,
    note: 'Restored parts up to ' + part + ' of ' + man.parts + '. Call again with fromPart: ' + part + ' to go on.' }, ok ? 202 : 422);
  return json({ ok, more: false, parts: man.parts, ...t, snapshotFrom: man.finishedISO,
    note: t.heldForward ? t.heldForward + ' record(s) were restored WITHOUT undoing a revocation, block or sign-out that happened after this backup was taken.' : null },
    ok ? 200 : 422);
}
