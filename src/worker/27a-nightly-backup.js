
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
  /* One slice at a time, ever (DR-002). */
  const lease = await _runAlone(env, 'nightly-backup', NIGHTLY_SLICE_MS + 60000);
  if (!lease.held) return { on: true, busy: true };
  try { return await _nightlyBackupSlice(env, atMs); }
  finally { await _runAloneEnd(env, 'nightly-backup', lease); }
}
async function _nightlyBackupSlice(env, atMs){
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
        + 'The newest complete one is still in the backups bucket; tonight’s starts on its own.', 12 * 60); } catch (e) { /* logging: it never decides anything */ }
    }
  }

  let st;
  try { st = JSON.parse((await env.AMV_KV.get(_nightlyStateKey(day))) || 'null'); } catch (e) { st = null; }
  if (!st) st = { day, prefix: 0, cursor: null, part: 0, count: 0, bytes: 0, startedAt: now, done: false, failed: '' };
  /* Done: the night is drilled on its own, slice by slice (REL-017) - a
     backup nobody has read back is not one readiness may count. */
  if (st.done) return Object.assign({ on: true, day, done: true }, await _nightlyDrillSlice(env, day));
  if (st.failed) return { on: true, day, done: false, failed: st.failed };

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
          + 'The record needs looking at; the last complete backup is untouched.', 6 * 60); } catch (e) { /* logging: it never decides anything */ }
        return { on: true, day, failed: st.failed };
      }
      lines.push(JSON.stringify({ k: k.name, v: raw }));
      st.bytes += raw.length + k.name.length;
    }
    if (lines.length) {
      const body = lines.join('\n') + '\n';
      /* Each part's checksum, kept for the manifest (Nov 1 audit DR-004): a
         restore checks every part against it before anything is written. */
      const sha = await _sha256Hex(body);
      await env.AMV_BACKUPS.put(_nightlyPart(day, st.part), body, { httpMetadata: { contentType: 'application/x-ndjson' }, customMetadata: { sha256: sha } });
      st.partSha = Array.isArray(st.partSha) ? st.partSha : [];
      st.partSha[st.part] = sha;
      st.part++; st.count += lines.length; parts++;
    }
    if (page.list_complete) { st.prefix++; st.cursor = null; }
    else st.cursor = page.cursor;
    await save();
  }

  if (st.prefix < BACKUP_PREFIXES.length) return { on: true, day, parts, count: st.count, more: true };

  /* Written last: a night without a manifest is not a backup. Signed (Nov 3
     audit REL-017), so a manifest somebody edited in the bucket - or one
     written by anything but this Worker - is not taken for a backup. */
  const man = {
    _amv_backup: 1, day, complete: true, keyCount: st.count, approxBytes: st.bytes, parts: st.part,
    partSha: Array.isArray(st.partSha) && st.partSha.length === st.part ? st.partSha : undefined,
    prefixes: BACKUP_PREFIXES, startedAt: st.startedAt, finishedAt: Date.now(),
    finishedISO: new Date().toISOString(),
  };
  man.sig = await _manifestSig(env, man);
  await env.AMV_BACKUPS.put(_nightlyManifest(day), JSON.stringify(man), { httpMetadata: { contentType: 'application/json' } });
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
/* The drill's check of one part: each record is what a restore would accept
   (a prefix restore writes, a value it can hold), counted - nothing written. */
function _drillEntries(entries, t){
  for (const [key, val] of entries) {
    if (!BACKUP_PREFIXES.some(p => key.startsWith(p))) { t.refused++; continue; }
    if (typeof val !== 'string' || val.length > BACKUP_MAX_VALUE_BYTES) { t.unrestorable++; if (t.lost.length < 20) t.lost.push(key); continue; }
    t.verified++;
  }
}

/* The manifest's signature: HMAC-SHA256 over the manifest without it, under
   the deployment's backup key (BACKUP_SIGNING_KEY, or the token secret). */
async function _manifestSig(env, man){
  const secret = String(env.BACKUP_SIGNING_KEY || env.JWT_SECRET || '');
  if (!secret) return '';
  const body = Object.assign({}, man); delete body.sig;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('amv-backup-manifest\n' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify(body)));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function _manifestSigned(env, man){
  if (!man || typeof man.sig !== 'string' || !man.sig) return false;
  const want = await _manifestSig(env, man);
  if (!want || want.length !== man.sig.length) return false;
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ man.sig.charCodeAt(i);
  return diff === 0;
}
/* A night's drill, a slice at a time, from the cron. The drill is the same
   one an operator runs ({ fromNight, mode: 'verify' }); it carries where it
   got to in its own run record. A night found unsound is recorded as such,
   alerted once, and not drilled again on every tick. */
async function _nightlyDrillSlice(env, day){
  let d = null; try { d = JSON.parse((await env.AMV_KV.get(_drillKey(day))) || 'null'); } catch (e) { d = null; }
  if (d) return { drill: d.sound ? 'sound' : 'unsound' };
  let run = null; try { run = JSON.parse((await env.AMV_KV.get(_drillKey(day) + ':run')) || 'null'); } catch (e) { run = null; }
  const r = await _restoreFromNight(env, day, (run && run.next) || 0, 'verify');
  const body = await r.json().catch(() => ({}));
  if (body.more) return { drill: 'partial', through: body.nextPart };
  if (!body.ok) { try { await alertOnce(env, 'backup_drill_failed', 'The drill of the ' + day + ' backup found it unsound (' + (body.code || (body.badParts && body.badParts.length ? 'parts that do not match their checksum' : 'records that would not restore')) + '). It is not counted as a backup. Run the drill by hand to see which parts.', 12 * 60); } catch (e) { /* logging: it never decides anything */ } }
  return { drill: body.ok ? 'sound' : 'unsound' };
}
/* WHAT "A RECENT BACKUP EXISTS" MEANS (Nov 3 audit REL-017). Not that a
   status record says done: a manifest for last night (or tonight) is in the
   bucket, complete, signed by this deployment, with a checksum for every
   part; its last part is there; and a drill of THAT manifest read every part
   back and found it sound. Answers { fresh, day } or { fresh: false, why }. */
async function _backupProven(env, now){
  if (!_nightlyOn(env)) return { fresh: false, why: 'off' };
  let why = 'no complete backup';
  for (const day of [_nightlyDay(now), _nightlyDay(now - 86400000)]) {
    let man = null;
    try { const o = await env.AMV_BACKUPS.get(_nightlyManifest(day)); if (o) man = JSON.parse(await o.text()); } catch (e) { man = null; }
    if (!man || !man.complete) continue;
    if (!(await _manifestSigned(env, man))) { why = 'manifest not signed'; continue; }
    if (!Array.isArray(man.partSha) || man.partSha.length !== man.parts) { why = 'manifest without every checksum'; continue; }
    if (man.parts > 0) {
      const last = typeof env.AMV_BACKUPS.head === 'function' ? await env.AMV_BACKUPS.head(_nightlyPart(day, man.parts - 1)).catch(() => null) : await env.AMV_BACKUPS.get(_nightlyPart(day, man.parts - 1)).catch(() => null);
      if (!last) { why = 'a part is missing'; continue; }
    }
    let d = null; try { d = JSON.parse((await env.AMV_KV.get(_drillKey(day))) || 'null'); } catch (e) { d = null; }
    if (!d || !d.sound || d.parts !== man.parts || (d.sig || '') !== man.sig) { why = d && !d.sound ? 'drill found it unsound' : 'not drilled yet'; continue; }
    return { fresh: true, day };
  }
  return { fresh: false, why };
}
async function _sha256Hex(text){
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/* CHECKED BEFORE ANYTHING IS WRITTEN (Nov 1 audit DR-004). A restore used to
   write part 0, then part 1, and only find at part 7 that a part was missing
   or corrupt - leaving the store half old, half new. Now a night may be
   restored only after a drill of THAT night read every part, matched each
   against the checksum in the manifest, and found every record restorable
   (`bkdrill:<day>`, written by a complete, sound drill). The restore checks
   each part's checksum again as it applies it. What a KV restore still is
   not: a point-in-time rewind - records created after the backup are kept,
   not deleted. Point-in-time recovery is the Postgres provider's, once the
   control plane lives there (docs/DATA-TIER.md). */
const _drillKey = (day) => 'bkdrill:' + day;

/* A RESTORE THAT CAN BE TAKEN BACK, WITH NOTHING ELSE WRITING (Nov 3 audit
   DR-009/DR-004). A KV store has no switch to flip between two whole copies,
   so a restore is still applied record by record. What changes is what that
   is allowed to mean:
     - nothing else writes while it runs: a restore is refused unless the
       owner has switched off `feature:writes` (every change by people and by
       API is paused, honestly, until it is back on), so the store is never a
       mix of the backup and writes that landed half way through;
     - every record's value BEFORE the restore is kept in the bucket first,
       part by part (`restores/<day>/<run>/before-NNNNNN.ndjson`), so the
       whole restore can be taken back ({ rollbackRun }) to exactly what was
       there - the old state is retained, not overwritten;
     - a run is named (`runId`), and each later slice must carry it.
   The true point-in-time switch is the Postgres provider's, once the control
   plane lives there (docs/DATA-TIER.md). */
const _restoreRunBase = (day, run) => 'restores/' + day + '/' + run + '/';
/* Asked fresh, never from a cache: is everything else paused RIGHT NOW. */
/* For everything ELSE that writes (Nov 8 audit DR-011/016): background work
   pauses while a restore has writes off, and also when that cannot be
   asked - a switchboard that does not answer is not permission to write
   into a store somebody may be restoring. The restore itself still needs a
   definite yes from _restoreFrozen before it starts. */
async function _writesPaused(env){
  if (env.AMV_COUNTER) {
    try { const r = await counter(env, SWITCHBOARD, { op: 'swGet', strict: true });
      if (r && r.unavailable) return true;
      if (r && r.map && typeof r.map === 'object') return !!(r.map['feature:writes'] && r.map['feature:writes'].off);
      /* Answered with no switchboard of its own: the stored switches decide,
         as they do for the restore itself. */
    } catch (e) { return true; }
  }
  try { const m = JSON.parse((await env.AMV_KV.get(SWITCH_KEY)) || '{}'); return !!(m && m['feature:writes'] && m['feature:writes'].off); }
  catch (e) { return true; }
}
async function _restoreFrozen(env){
  let m = null;
  if (env.AMV_COUNTER) { try { const r = await counter(env, SWITCHBOARD, { op: 'swGet', strict: true }); if (r && r.map && typeof r.map === 'object') m = r.map; } catch (e) { return false; } }
  if (!m) { try { m = JSON.parse((await env.AMV_KV.get(SWITCH_KEY)) || '{}'); } catch (e) { return false; } }
  return !!(m && m['feature:writes'] && m['feature:writes'].off);
}
async function _restoreJournal(env, day, run, part, entries){
  const lines = [];
  for (const [key] of entries) {
    let before = null;
    try { before = await env.AMV_KV.get(key); } catch (e) { throw new Error('a record could not be read before it was replaced: ' + key); }
    lines.push(JSON.stringify({ k: key, v: before }));
  }
  await env.AMV_BACKUPS.put(_restoreRunBase(day, run) + 'before-' + String(part).padStart(6, '0') + '.ndjson', lines.join('\n') + '\n');
}
/* Taken back: every journaled record put back as it was before the restore
   (absent ones deleted), newest part first. Same freeze, same slices. */
async function _restoreRollback(env, day, run, fromPart){
  if (!/^[0-9a-f]{16}$/.test(String(run || ''))) return json({ error: 'Name the restore run to take back.', code: 'bad_request' }, 400);
  if (!(await _restoreFrozen(env))) return json({ error: 'Switch off feature:writes first, so nothing changes while the restore is taken back.', code: 'freeze_required' }, 409);
  const base = _restoreRunBase(day, run);
  let st = null; try { const o = await env.AMV_BACKUPS.get(base + 'state.json'); if (o) st = JSON.parse(await o.text()); } catch (e) { st = null; }
  if (!st) return json({ error: 'There is no restore run ' + run + ' for ' + day + '.', code: 'not_found' }, 404);
  const started = Date.now();
  let part = fromPart != null ? parseInt(fromPart, 10) : (st.journaled || 0) - 1;
  let put = 0;
  for (; part >= 0; part--) {
    if (Date.now() - started > NIGHTLY_SLICE_MS) break;
    const o = await env.AMV_BACKUPS.get(base + 'before-' + String(part).padStart(6, '0') + '.ndjson');
    if (!o) continue;
    for (const line of (await o.text()).split('\n')) {
      if (!line) continue;
      const r = JSON.parse(line);
      if (r.v == null) await env.AMV_KV.delete(r.k); else await env.AMV_KV.put(r.k, r.v);
      put++;
    }
  }
  audit(env, 'backup_rollback', { day, run, put, through: part });
  if (part >= 0) return json({ ok: true, more: true, nextPart: part, put }, 202);
  st.rolledBack = Date.now();
  await env.AMV_BACKUPS.put(base + 'state.json', JSON.stringify(st));
  return json({ ok: true, more: false, put, note: 'Every record is back as it was before the restore. Switch feature:writes back on.' });
}
async function _restoreFromNight(env, day, fromPart, mode, runIn){
  if (!_nightlyOn(env)) return json({ error: 'Nightly backups are not switched on here.', code: 'needs_service' }, 503);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return json({ error: 'Name the night as YYYY-MM-DD.', code: 'bad_request' }, 400);
  let man = null;
  try { const o = await env.AMV_BACKUPS.get(_nightlyManifest(day)); if (o) man = JSON.parse(await o.text()); } catch (e) { man = null; }
  if (!man || !man.complete) return json({ error: 'There is no complete backup for ' + day + '.', code: 'no_backup' }, 404);
  /* Signed by this deployment, or not a backup it trusts (REL-017). A night
     from before manifests were signed can still be drilled, and is said to
     be unsigned; it cannot be restored. */
  const signed = await _manifestSigned(env, man);
  if (!signed && mode !== 'verify') return json({ error: 'The ' + day + ' backup manifest is not signed by this deployment, so it is not restored.', code: 'manifest_unsigned' }, 409);
  const started = Date.now();
  const t = { restored: 0, skipped: 0, refused: 0, unrestorable: 0, heldForward: 0, lost: [] };
  const drill = mode === 'verify';
  if (drill) { t.verified = 0; t.badParts = []; }
  const sums = Array.isArray(man.partSha) && man.partSha.length === man.parts ? man.partSha : null;
  let run = '', runSt = null;
  if (!drill) {
    if (!(await _restoreFrozen(env)))
      return json({ error: 'Switch off feature:writes first (POST /v1/admin/switch), so nothing else changes while the restore runs - then switch it back on when it is done.', code: 'freeze_required' }, 409);
    let d = null;
    try { d = JSON.parse((await env.AMV_KV.get(_drillKey(day))) || 'null'); } catch (e) { d = null; }
    if (!d || !d.sound || d.parts !== man.parts || (d.sig || '') !== (man.sig || ''))
      return json({ error: 'Run a drill of the ' + day + ' backup first ({ fromNight, mode: "verify" }, until it answers more: false). A restore only starts once every part of the night has been read and checked, so nothing is written from a backup that would stop half way.', code: 'drill_required' }, 409);
  }
  let part = Math.max(0, parseInt(fromPart, 10) || 0);
  if (!drill) {
    /* The run: made at the first slice, required for every later one. */
    if (part === 0 && !runIn) {
      run = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
      runSt = { day, run, startedAt: Date.now(), journaled: 0, applied: 0 };
      await env.AMV_BACKUPS.put(_restoreRunBase(day, run) + 'state.json', JSON.stringify(runSt));
    } else {
      run = String(runIn || '');
      try { const o = /^[0-9a-f]{16}$/.test(run) ? await env.AMV_BACKUPS.get(_restoreRunBase(day, run) + 'state.json') : null; if (o) runSt = JSON.parse(await o.text()); } catch (e) { runSt = null; }
      if (!runSt || runSt.rolledBack) return json({ error: 'Carry on a restore by naming its run (runId from its first answer).', code: 'run_required' }, 409);
    }
  }
  for (; part < man.parts; part++) {
    if (Date.now() - started > NIGHTLY_SLICE_MS) break;
    const o = await env.AMV_BACKUPS.get(_nightlyPart(day, part));
    if (!o) {
      /* The night is no longer whole: whatever drill said otherwise is void. */
      try { await env.AMV_KV.delete(_drillKey(day)); await env.AMV_KV.delete(_drillKey(day) + ':run'); } catch (e) { /* cleanup of a record already spent or fenced; it expires or is retried on its own */ }
      try { await alertOnce(env, 'restore_incomplete', 'A restore from the ' + day + ' backup stopped: part ' + part + ' is missing from the bucket.', 5); } catch (e) { /* logging: it never decides anything */ }
      return json({ ok: false, code: 'restore_incomplete', error: 'Part ' + part + ' of the ' + day + ' backup is missing, so the restore stopped there. ' + (drill ? 'Run the drill again once it is back.' : 'Parts before it were restored; run a drill again before continuing.'), ...t, nextPart: part }, 422);
    }
    const text = await o.text();
    if (sums && (await _sha256Hex(text)) !== sums[part]) {
      if (drill) { t.badParts.push(part); continue; }
      try { await env.AMV_KV.delete(_drillKey(day)); } catch (e) { /* cleanup of a record already spent or fenced; it expires or is retried on its own */ }
      try { await alertOnce(env, 'restore_incomplete', 'A restore from the ' + day + ' backup stopped: part ' + part + ' no longer matches its checksum.', 5); } catch (e) { /* logging: it never decides anything */ }
      return json({ ok: false, code: 'restore_checksum', error: 'Part ' + part + ' of the ' + day + ' backup no longer matches its checksum, so the restore stopped there.', ...t, nextPart: part }, 422);
    }
    const entries = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch (e) { t.unrestorable++; continue; }
      if (r && typeof r.k === 'string') entries.push([r.k, r.v]);
    }
    if (drill) _drillEntries(entries, t);
    else {
      /* What was there first, kept - then applied. */
      await _restoreJournal(env, day, run, part, entries);
      runSt.journaled = part + 1;
      await env.AMV_BACKUPS.put(_restoreRunBase(day, run) + 'state.json', JSON.stringify(runSt));
      await _restoreEntries(env, entries, mode, t);
      runSt.applied = part + 1;
      await env.AMV_BACKUPS.put(_restoreRunBase(day, run) + 'state.json', JSON.stringify(runSt));
    }
  }
  if (drill) {
    audit(env, 'backup_drill', { from: 'night:' + day, verified: t.verified, refused: t.refused, unrestorable: t.unrestorable, through: part });
    /* A drill in slices carries what earlier slices found, so "sound" is
       about the whole night, not the last slice. */
    let prior = null;
    if (parseInt(fromPart, 10) > 0) { try { prior = JSON.parse((await env.AMV_KV.get(_drillKey(day) + ':run')) || 'null'); } catch (e) { prior = null; } }
    const acc = { verified: t.verified + ((prior && prior.verified) || 0), refused: t.refused + ((prior && prior.refused) || 0),
      unrestorable: t.unrestorable + ((prior && prior.unrestorable) || 0), badParts: ((prior && prior.badParts) || []).concat(t.badParts) };
    const sound = !acc.unrestorable && !acc.refused && !acc.badParts.length;
    const base = { ok: sound, drill: true, parts: man.parts, expected: man.keyCount, verified: acc.verified, refused: acc.refused,
      unrestorable: acc.unrestorable, badParts: acc.badParts, checksums: !!sums, lost: t.lost, ms: Date.now() - started, snapshotFrom: man.finishedISO };
    if (part < man.parts) {
      await env.AMV_KV.put(_drillKey(day) + ':run', JSON.stringify(Object.assign({}, acc, { next: part })), { expirationTtl: 86400 });
      return json({ ...base, more: true, nextPart: part }, 202);
    }
    try { await env.AMV_KV.delete(_drillKey(day) + ':run'); } catch (e) { /* cleanup of a record already spent or fenced; it expires or is retried on its own */ }
    const whole = prior || !(parseInt(fromPart, 10) > 0);
    if (sound && whole) await env.AMV_KV.put(_drillKey(day), JSON.stringify({ sound: true, parts: man.parts, sig: man.sig || '', at: Date.now() }), { expirationTtl: 40 * 86400 });
    else if (whole) await env.AMV_KV.put(_drillKey(day), JSON.stringify({ sound: false, parts: man.parts, sig: man.sig || '', at: Date.now() }), { expirationTtl: 40 * 86400 });
    else await env.AMV_KV.delete(_drillKey(day));
    return json({ ...base, more: false }, sound ? 200 : 422);
  }
  audit(env, 'backup_import', { mode, from: 'night:' + day, ...t, lost: t.lost.join(',') || undefined, through: part });
  const ok = !t.unrestorable;
  if (part < man.parts) return json({ ok, more: true, nextPart: part, parts: man.parts, runId: run, ...t,
    note: 'Restored parts up to ' + part + ' of ' + man.parts + '. Call again with fromPart: ' + part + ' and runId: ' + run + ' to go on. To take it all back: { fromNight, rollbackRun: ' + run + ' }.' }, ok ? 202 : 422);
  return json({ ok, more: false, parts: man.parts, runId: run, ...t, snapshotFrom: man.finishedISO,
    note: (t.heldForward ? t.heldForward + ' record(s) were restored WITHOUT undoing a revocation, block or sign-out that happened after this backup was taken. ' : '')
      + 'Check it, then switch feature:writes back on - or take it back with { fromNight, rollbackRun: ' + run + ' }.' },
    ok ? 200 : 422);
}
