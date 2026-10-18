/* YOUR APPLE HEALTH EXPORT IS READ ON YOUR DEVICE - AND COUNTED HONESTLY.

   iPhone keeps health data where no website can reach it; the export.zip from
   Health -> Export All Health Data is how it leaves the phone. Attached
   through the real door (the chat's file input), in a real browser, it must:

   - be read here, by health.js, and become a compact summary - nothing of
     the file is uploaded, and the summary is what the message carries;
   - count a day's steps ONCE when an iPhone and a Watch both counted them,
     take sleep as time asleep (not in bed) from the source that recorded
     most, average heart rate, take the day's last weight, and convert miles
     and pounds;
   - read an export far over the attachment limit, streamed from disk, and
     one in ZIP64 form, as large exports are;
   - leave any other zip to the ordinary path, which refuses archives. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { zip } from '../lib/office-fixtures.mjs';
import { deflateRawSync, crc32 } from 'zlib';
import { randomBytes } from 'crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
const TMP = mkdtempSync(join(tmpdir(), 'amv-health-'));

const rec = (type, src, start, end, value, unit, extra) =>
  `<Record type="${type}" sourceName="${src}" sourceVersion="17.4" unit="${unit || ''}" creationDate="${end}" startDate="${start}" endDate="${end}" value="${value}"${extra ? '>' + extra + '</Record>' : '/>'}`;
const HK = 'HKQuantityTypeIdentifier', Z = ' +0100';
const body = [];
// Steps: the iPhone counted 5,000 and the Watch 6,500 of the SAME walking.
body.push(rec(HK + 'StepCount', 'Kim’s iPhone', '2024-03-01 08:00:00' + Z, '2024-03-01 09:00:00' + Z, 3000, 'count'));
body.push(rec(HK + 'StepCount', 'Kim’s iPhone', '2024-03-01 17:00:00' + Z, '2024-03-01 18:00:00' + Z, 2000, 'count'));
body.push(rec(HK + 'StepCount', 'Kim’s Apple Watch', '2024-03-01 08:00:00' + Z, '2024-03-01 09:00:00' + Z, 4000, 'count',
  '<MetadataEntry key="HKMetadataKeySyncVersion" value="2"/>'));
body.push(rec(HK + 'StepCount', 'Kim’s Apple Watch', '2024-03-01 17:00:00' + Z, '2024-03-01 18:00:00' + Z, 2500, 'count'));
body.push(rec(HK + 'DistanceWalkingRunning', 'Kim’s iPhone', '2024-03-01 08:00:00' + Z, '2024-03-01 09:00:00' + Z, 2, 'mi'));
// Sleep for the night that ended on 2 March: the Watch has 5.5 hours asleep;
// a sleep app has 6. In bed and awake are not sleep.
const S = 'HKCategoryTypeIdentifierSleepAnalysis', V = 'HKCategoryValueSleepAnalysis';
body.push(rec(S, 'Kim’s Apple Watch', '2024-03-01 22:30:00' + Z, '2024-03-02 07:00:00' + Z, V + 'InBed'));
body.push(rec(S, 'Kim’s Apple Watch', '2024-03-01 23:00:00' + Z, '2024-03-02 03:00:00' + Z, V + 'AsleepCore'));
body.push(rec(S, 'Kim’s Apple Watch', '2024-03-02 03:00:00' + Z, '2024-03-02 04:30:00' + Z, V + 'AsleepDeep'));
body.push(rec(S, 'Kim’s Apple Watch', '2024-03-02 04:30:00' + Z, '2024-03-02 04:45:00' + Z, V + 'Awake'));
body.push(rec(S, 'SleepTracker', '2024-03-01 23:00:00' + Z, '2024-03-02 05:00:00' + Z, V + 'AsleepUnspecified'));
// Heart rate, resting heart rate, weight in pounds (the later one counts).
for (const v of [70, 90, 110]) body.push(rec(HK + 'HeartRate', 'Kim’s Apple Watch', '2024-03-01 10:00:00' + Z, '2024-03-01 10:00:00' + Z, v, 'count/min'));
for (const v of [58, 62]) body.push(rec(HK + 'RestingHeartRate', 'Kim’s Apple Watch', '2024-03-01 06:00:00' + Z, '2024-03-01 06:00:00' + Z, v, 'count/min'));
body.push(rec(HK + 'BodyMass', 'Scale', '2024-03-01 07:00:00' + Z, '2024-03-01 07:00:00' + Z, 155, 'lb'));
body.push(rec(HK + 'BodyMass', 'Scale', '2024-03-01 08:00:00' + Z, '2024-03-01 08:00:00' + Z, 154.32, 'lb'));
body.push('<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="32.4" durationUnit="min" sourceName="Kim’s Apple Watch" startDate="2024-03-01 18:30:00' + Z + '" endDate="2024-03-01 19:02:00' + Z + '"><WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" sum="5.1" unit="km"/></Workout>');
// Many more days, so the file is read in many pieces and tags fall across them.
for (let d = 0; d < 400; d++) {
  const day = new Date(Date.UTC(2023, 0, 1) + d * 864e5).toISOString().slice(0, 10);
  for (let h = 0; h < 60; h++) body.push(rec(HK + 'HeartRate', 'Kim’s Apple Watch', day + ' 12:00:00' + Z, day + ' 12:00:00' + Z, 60 + (h % 20), 'count/min'));
}
const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE HealthData [\n<!ELEMENT HealthData (ExportDate,Me,(Record|Workout)*)>\n]>\n'
  + '<HealthData locale="en_GB">\n <ExportDate value="2024-03-05 10:00:00 +0100"/>\n <Me HKCharacteristicTypeIdentifierDateOfBirth="1990-01-01"/>\n '
  + body.join('\n ') + '\n</HealthData>\n';

/* A ZIP64 archive, as big exports are written: sizes and offsets in the
   zip64 extra fields, and the zip64 end record. */
function zip64(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content), comp = deflateRawSync(data), nm = Buffer.from(name), crc = crc32(data);
    const lx = Buffer.alloc(20); lx.writeUInt16LE(1, 0); lx.writeUInt16LE(16, 2); lx.writeBigUInt64LE(BigInt(data.length), 4); lx.writeBigUInt64LE(BigInt(comp.length), 12);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(45, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(0xFFFFFFFF, 18); lh.writeUInt32LE(0xFFFFFFFF, 22); lh.writeUInt16LE(nm.length, 26); lh.writeUInt16LE(lx.length, 28);
    const cx = Buffer.alloc(28); cx.writeUInt16LE(1, 0); cx.writeUInt16LE(24, 2); cx.writeBigUInt64LE(BigInt(data.length), 4); cx.writeBigUInt64LE(BigInt(comp.length), 12); cx.writeBigUInt64LE(BigInt(off), 20);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(45, 4); ch.writeUInt16LE(45, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(0xFFFFFFFF, 20); ch.writeUInt32LE(0xFFFFFFFF, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt16LE(cx.length, 30); ch.writeUInt32LE(0xFFFFFFFF, 42);
    parts.push(lh, nm, lx, comp); central.push(ch, nm, cx);
    off += 30 + nm.length + lx.length + comp.length;
  }
  const cd = Buffer.concat(central), n = Object.keys(files).length;
  const e64 = Buffer.alloc(56); e64.writeUInt32LE(0x06064b50, 0); e64.writeBigUInt64LE(44n, 4); e64.writeUInt16LE(45, 12); e64.writeUInt16LE(45, 14);
  e64.writeBigUInt64LE(BigInt(n), 24); e64.writeBigUInt64LE(BigInt(n), 32); e64.writeBigUInt64LE(BigInt(cd.length), 40); e64.writeBigUInt64LE(BigInt(off), 48);
  const loc = Buffer.alloc(20); loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(off + cd.length), 8); loc.writeUInt32LE(1, 16);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0xFFFF, 8); end.writeUInt16LE(0xFFFF, 10); end.writeUInt32LE(0xFFFFFFFF, 12); end.writeUInt32LE(0xFFFFFFFF, 16);
  return Buffer.concat([...parts, cd, e64, loc, end]);
}

const app = await bootApp({ tab: 'chat', user: { name: 'Kim', email: 'kim@example.com', ini: 'K' } });
const { page, errors } = app;
await page.evaluate(() => {
  window._callAI = async (msgs) => { window.__sent = msgs[msgs.length - 1]; S.busy = false; };
  try { AMVUsage.status = () => ({ remaining: 9999, resetsAt: Date.now() + 3600e3 }); } catch (e) {}
  window.__toasts = [];
  const real = window.toast;
  window.toast = (m, k, ms) => { window.__toasts.push((k || '') + ' | ' + m); return real(m, k, ms); };
});
const uploads = [];
page.on('request', r => { if (r.method() !== 'GET') uploads.push(r.url()); });
const attach = async (name, buffer) => {
  await page.evaluate(() => { S.att = null; window.__toasts = []; });
  /* The browser is handed a file on disk past 40 MB, as a person's would be. */
  if (buffer.length > 40 * 1024 * 1024) { const p = join(TMP, name); writeFileSync(p, buffer); await page.setInputFiles('#fi', p); }
  else await page.setInputFiles('#fi', [{ name, mimeType: 'application/zip', buffer }]);
  await page.waitForFunction(() => S.att || window.__toasts.some(t => /^error/.test(t)), null, { timeout: 60000 }).catch(() => {});
  return page.evaluate(() => ({ att: S.att ? { format: S.att.format || '', summary: S.att.summary || '', data: S.att.data || '' } : null,
    chip: (document.getElementById('ac') || {}).textContent || '', toasts: window.__toasts.slice() }));
};
const rowOf = (data, date) => {
  const lines = data.split('\n'), h = lines.findIndex(l => /^date,/.test(l));
  const cols = lines[h].split(','), row = (lines.find(l => l.startsWith(date + ',')) || '').split(',');
  return Object.fromEntries(cols.map((c, i) => [c, row[i]]));
};

section('An export is read here, and counted honestly');
{
  const before = uploads.length;
  const r = await attach('export.zip', zip({ 'apple_health_export/export.xml': xml, 'apple_health_export/export_cda.xml': '<ClinicalDocument/>' }));
  ok(r.att && r.att.format === 'health' && /Apple Health export/.test(r.chip), 'it is attached as an Apple Health export', [r.att && r.att.format, r.chip]);
  ok(/days · 2023-01-01 – 2024-03-02/.test(r.att.summary), 'the chip says how many days, and from when to when', r.att.summary);
  const d = rowOf(r.att.data, '2024-03-01');
  ok(d.steps === '6500', 'the iPhone’s and the Watch’s steps are counted once: the device that counted most', d.steps);
  ok(d.distance_km === '3.22', 'two miles is 3.22 km', d.distance_km);
  ok(d.resting_hr === '60' && d.avg_hr === '90' && d.min_hr === '70' && d.max_hr === '110', 'heart rate is averaged, with the day’s lowest and highest', d);
  ok(d.weight_kg === '70.0', 'the day’s last weight, in kg', d.weight_kg);
  const n = rowOf(r.att.data, '2024-03-02');
  ok(n.sleep_h === '6.0', 'sleep is time asleep from the source that recorded most - not time in bed, not awake', n.sleep_h);
  ok(/^2024-03-01,Running,32$/m.test(r.att.data), 'the run is listed, with its minutes', r.att.data.match(/## Workouts[\s\S]*/));
  ok(/## Monthly averages/.test(r.att.data) && /^2023-06,/m.test(r.att.data), 'and older months are kept as monthly averages', '');
  ok(r.att.data.length < 120000 && !/<Record|<HealthData|MetadataEntry/.test(r.att.data), 'what is attached is a summary, not the file', r.att.data.length);
  /* Every record is read once - including those whose tag the reading split
     between two pieces of the file. */
  const records = (xml.match(/<Record /g) || []).length;
  ok(new RegExp('^Apple Health export[^\\n]* ' + records.toLocaleString('en-US') + ' records,').test(r.att.data), 'every one of the ' + records.toLocaleString('en-US') + ' records is counted, none lost between pieces', r.att.data.split('\n')[0]);
  ok(uploads.slice(before).length === 0, 'and reading it sent nothing anywhere', uploads.slice(before));
  await page.evaluate(async () => { document.getElementById('mta').value = 'How did I sleep?'; await sendMsg(); });
  const sent = await page.evaluate(() => JSON.stringify(window.__sent && window.__sent.c));
  ok(/How did I sleep\?/.test(sent) && /sleep_h/.test(sent), 'sending the message carries the question and the summary', sent.slice(0, 200));
}

section('An export far over the attachment limit is read, streamed from disk');
{
  const big = zip({ 'apple_health_export/export.xml': xml, 'apple_health_export/workout-routes/route_2024-03-01.gpx': randomBytes(60 * 1024 * 1024) }, { store: true });
  const r = await attach('export.zip', big);
  ok(big.length > 50 * 1024 * 1024 && r.att && r.att.format === 'health' && rowOf(r.att.data, '2024-03-01').steps === '6500',
     'a ' + Math.round(big.length / 1048576) + ' MB export is read like any other', r.att && r.att.summary);
}

section('An export in ZIP64 form, as large exports are written');
{
  const r = await attach('export.zip', zip64({ 'apple_health_export/export.xml': xml }));
  ok(r.att && r.att.format === 'health' && rowOf(r.att.data, '2024-03-01').steps === '6500', 'is read the same', r.att && r.att.summary);
}

section('Any other zip is left to the ordinary path');
{
  const plain = await attach('photos.zip', zip({ 'a.txt': 'hello' }));
  ok(!plain.att && plain.toasts.some(t => /is an archive/.test(t)), 'a zip with no export in it is refused as an archive, as before', plain.toasts);
  const fake = await attach('export.zip', zip({ 'export.xml': '<?xml version="1.0"?><Invoices>' + '<Invoice amount="12.50" due="2024-03-01"/>'.repeat(400) + '</Invoices>' }));
  ok(!fake.att && fake.toasts.some(t => /is an archive/.test(t)), 'an export.xml that is not Health data is not read as one', fake.toasts);
  const empty = await attach('export.zip', zip({ 'apple_health_export/export.xml': '<?xml version="1.0"?><HealthData locale="en"><ExportDate value="2024-01-01 00:00:00 +0000"/></HealthData>' }));
  ok(!empty.att && empty.toasts.some(t => /no steps, sleep, heart rate/.test(t)), 'an export with nothing AMV reads says so', empty.toasts);
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
try { rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
if (report('your-health-export-is-read-on-your-device') > 0) process.exitCode = 1;
done();
