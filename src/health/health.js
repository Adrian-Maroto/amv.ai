/* AMV reads an Apple Health export - loaded on demand.

   Fetched the first time somebody attaches a .zip (see _healthTry in the
   app), not shipped in the page. It runs in the page's own scope, wrapped so
   none of its names can collide with the app's, and publishes what the app
   calls on window. */
(function(){
'use strict';
/* ── YOUR HEALTH DATA, READ ON YOUR DEVICE ───────────────────────────────────

   iPhone keeps health data where no website can reach it; what every iPhone
   CAN do is Health -> profile -> Export All Health Data, which makes an
   export.zip. This reads that file here, in this browser, and attaches a
   compact summary to the message - days, not millions of samples. The file
   itself is never uploaded and AMV keeps none of it; the summary goes with the
   message the person sends, like any attachment.

   An export is routinely hundreds of megabytes and can pass four gigabytes, so
   nothing is loaded whole: the zip's directory is read from the end of the
   file, and the one part that matters (export.xml) is streamed from disk,
   inflated and scanned piece by piece. Large exports use ZIP64, which is read.

   Counted honestly:
   - an iPhone and a Watch BOTH count the same steps, and the raw export holds
     both. Health shows one number by preferring one device; this takes, each
     day, the device that counted most - so a day is never double-counted;
   - sleep is time asleep (not time in bed), given to the night it ended, from
     the source that recorded most that night;
   - units are converted to km, kcal and kg, whatever the export used. */
const SCAN_MAX = 8 * 1024 * 1024 * 1024;   // inflated text scanned, at most
const DAILY_DAYS = 365, WORKOUTS = 100;
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 4294967296;
const slice = async (file, start, len) => new Uint8Array(await file.slice(start, start + len).arrayBuffer());
class Stop extends Error { constructor(why){ super(why); this.why = why; } }

/* The entry for export.xml, from the zip's own directory: null when the file
   is not a zip AMV can read, 'other' when it is a zip without one. */
async function findExport(file){
  const size = file.size;
  if(size < 22) return null;
  const tailLen = Math.min(size, 65557 + 20);
  const tail = await slice(file, size - tailLen, tailLen);
  let e = -1;
  for(let i = tail.length - 22; i >= 0; i--) if(u32(tail, i) === 0x06054b50){ e = i; break; }
  if(e < 0) return null;
  let count = u16(tail, e + 10), cdSize = u32(tail, e + 12), cdOff = u32(tail, e + 16);
  if(count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF){
    const l = e - 20;
    if(l < 0 || u32(tail, l) !== 0x07064b50) return null;
    const rec = await slice(file, u64(tail, l + 8), 56);
    if(u32(rec, 0) !== 0x06064b50) return null;
    count = u64(rec, 32); cdSize = u64(rec, 40); cdOff = u64(rec, 48);
  }
  if(cdSize > 64 * 1024 * 1024 || cdOff + cdSize > size) return null;
  const cd = await slice(file, cdOff, cdSize), dec = new TextDecoder();
  let p = 0;
  for(let k = 0; k < count && p + 46 <= cd.length; k++){
    if(u32(cd, p) !== 0x02014b50) return null;
    const flags = u16(cd, p + 8), method = u16(cd, p + 10);
    let csize = u32(cd, p + 20), usize = u32(cd, p + 24), off = u32(cd, p + 42);
    const nl = u16(cd, p + 28), el = u16(cd, p + 30), cl = u16(cd, p + 32);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nl));
    for(let x = p + 46 + nl, end = x + el; x + 4 <= end; ){
      const id = u16(cd, x), sz = u16(cd, x + 2);
      if(id === 1){
        let q = x + 4;
        if(usize === 0xFFFFFFFF){ usize = u64(cd, q); q += 8; }
        if(csize === 0xFFFFFFFF){ csize = u64(cd, q); q += 8; }
        if(off === 0xFFFFFFFF){ off = u64(cd, q); q += 8; }
      }
      x += 4 + sz;
    }
    if(/(^|\/)export\.xml$/i.test(name)) return { name, flags, method, csize, usize, off };
    p += 46 + nl + el + cl;
  }
  return 'other';
}

/* ── Counting ───────────────────────────────────────────────────────────── */
const when = s => { const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(s || ''); return m ? Date.parse(m[1] + 'T' + m[2] + m[3] + ':' + m[4]) : NaN; };
const dayOf = s => String(s || '').slice(0, 10);
const SUMMED = {   // per source per day, then the source that counted most
  HKQuantityTypeIdentifierStepCount: ['steps', v => v],
  HKQuantityTypeIdentifierDistanceWalkingRunning: ['distance_km', (v, u) => u === 'mi' ? v * 1.609344 : u === 'm' ? v / 1000 : u === 'ft' ? v * 0.0003048 : v],
  HKQuantityTypeIdentifierFlightsClimbed: ['flights', v => v],
  HKQuantityTypeIdentifierActiveEnergyBurned: ['active_kcal', (v, u) => u === 'kJ' ? v / 4.184 : v],
};
const AVERAGED = {
  HKQuantityTypeIdentifierRestingHeartRate: 'resting_hr',
  HKQuantityTypeIdentifierHeartRate: 'hr',
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: 'hrv_ms',
};
const LATEST = {
  HKQuantityTypeIdentifierBodyMass: ['weight_kg', (v, u) => u === 'lb' ? v * 0.45359237 : u === 'g' ? v / 1000 : v],
  HKQuantityTypeIdentifierVO2Max: ['vo2max', v => v],
};
const ASLEEP = /^HKCategoryValueSleepAnalysis(Asleep|AsleepUnspecified|AsleepCore|AsleepDeep|AsleepREM)$/;

function counter(){
  const perSource = new Map();   // day|metric|source -> sum
  const avg = new Map();         // day|metric -> {n, sum, min, max}
  const latest = new Map();      // day|metric -> {t, v}
  const workouts = [];
  let records = 0, first = '', last = '';
  const addSource = (key, v) => perSource.set(key, (perSource.get(key) || 0) + v);
  return {
    record(a){
      records++;
      const type = a.type, d = dayOf(a.startDate);
      if(!d) return;
      if(!first || d < first) first = d;
      if(!last || d > last) last = d;
      const v = parseFloat(a.value), u = a.unit || '', src = a.sourceName || '?';
      if(SUMMED[type] && isFinite(v)){ const [m, conv] = SUMMED[type]; addSource(d + '|' + m + '|' + src, conv(v, u)); return; }
      if(AVERAGED[type] && isFinite(v)){
        const k = d + '|' + AVERAGED[type], s = avg.get(k) || { n: 0, sum: 0, min: Infinity, max: -Infinity };
        s.n++; s.sum += v; s.min = Math.min(s.min, v); s.max = Math.max(s.max, v); avg.set(k, s); return;
      }
      if(LATEST[type] && isFinite(v)){
        const [m, conv] = LATEST[type], k = d + '|' + m, t = when(a.startDate) || 0, cur = latest.get(k);
        if(!cur || t >= cur.t) latest.set(k, { t, v: conv(v, u) }); return;
      }
      if(type === 'HKCategoryTypeIdentifierSleepAnalysis' && ASLEEP.test(a.value || '')){
        const s = when(a.startDate), e = when(a.endDate);
        if(isFinite(s) && isFinite(e) && e > s && e - s < 24 * 3600e3) addSource(dayOf(a.endDate) + '|sleep_h|' + src, (e - s) / 3600e3);
      }
    },
    workout(a){
      const d = dayOf(a.startDate); if(!d) return;
      let min = parseFloat(a.duration);
      if(a.durationUnit === 'h') min *= 60; else if(a.durationUnit === 's') min /= 60;
      const kind = String(a.workoutActivityType || '').replace(/^HKWorkoutActivityType/, '').replace(/([a-z])([A-Z])/g, '$1 $2') || 'Workout';
      workouts.push({ d, kind, min: isFinite(min) ? min : null });
    },
    done(){
      const days = new Map();
      const row = d => days.get(d) || (days.set(d, {}), days.get(d));
      const best = new Map();
      for(const [k, v] of perSource){ const [d, m] = k.split('|'); const key = d + '|' + m; if(!best.has(key) || v > best.get(key)) best.set(key, v); }
      for(const [k, v] of best){ const [d, m] = k.split('|'); row(d)[m] = v; }
      for(const [k, s] of avg){
        const [d, m] = k.split('|'), r = row(d);
        if(m === 'hr'){ r.avg_hr = s.sum / s.n; r.min_hr = s.min; r.max_hr = s.max; } else r[m] = s.sum / s.n;
      }
      for(const [k, x] of latest){ const [d, m] = k.split('|'); row(d)[m] = x.v; }
      workouts.sort((a, b) => a.d < b.d ? 1 : -1);
      return { days, workouts, records, first, last };
    },
  };
}

/* Attributes of a start tag, as written. */
function attrs(s){ const o = {}; for(const m of s.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) o[m[1]] = m[2]; return o; }

async function scan(file, ent, onProgress){
  if(ent.flags & 1) throw new Stop('locked');
  if(ent.method !== 0 && ent.method !== 8) throw new Stop('damaged');
  const lh = await slice(file, ent.off, 30);
  if(u32(lh, 0) !== 0x04034b50) throw new Stop('damaged');
  const start = ent.off + 30 + u16(lh, 26) + u16(lh, 28);
  if(start + ent.csize > file.size) throw new Stop('damaged');
  let stream = file.slice(start, start + ent.csize).stream();
  if(ent.method === 8){
    if(typeof DecompressionStream === 'undefined') throw new Stop('old_browser');
    stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
  }
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  const c = counter();
  const TAG = /<(Record|Workout)\s([^>]*?)\/?>/g;
  let buf = '', seen = 0, checked = false, lastTick = 0;
  try{
    for(;;){
      const { value, done } = await reader.read();
      if(done) break;
      seen += value.length;
      if(seen > SCAN_MAX) throw new Stop('too_big');
      buf += value;
      if(!checked){
        if(buf.length < 4096 && !/<HealthData[\s>]/.test(buf)) continue;
        if(!/<HealthData[\s>]/.test(buf.slice(0, 1 << 20))) throw new Stop('not_health');
        checked = true;
      }
      /* Everything up to the last '<' is whole; what follows it waits for the
         next piece, so a tag split across two pieces is read once, whole. */
      const cut = buf.lastIndexOf('<');
      const whole = cut > 0 ? buf.slice(0, cut) : '';
      buf = cut > 0 ? buf.slice(cut) : buf;
      TAG.lastIndex = 0;
      for(let m; (m = TAG.exec(whole)); ){ const a = attrs(m[2]); if(m[1] === 'Record') c.record(a); else c.workout(a); }
      if(onProgress && ent.usize && seen - lastTick > 8 * 1024 * 1024){ lastTick = seen; onProgress(Math.min(0.99, seen / ent.usize)); }
    }
    TAG.lastIndex = 0;
    for(let m; (m = TAG.exec(buf)); ){ const a = attrs(m[2]); if(m[1] === 'Record') c.record(a); else c.workout(a); }
  }catch(e){
    try{ reader.cancel(); }catch(_){}
    throw (e instanceof Stop) ? e : new Stop('damaged');
  }
  if(!checked) throw new Stop('not_health');
  return c.done();
}

/* ── The summary the model is given ─────────────────────────────────────── */
const COLS = ['steps', 'distance_km', 'flights', 'active_kcal', 'resting_hr', 'avg_hr', 'min_hr', 'max_hr', 'hrv_ms', 'sleep_h', 'weight_kg', 'vo2max'];
const DP = { steps: 0, flights: 0, active_kcal: 0, resting_hr: 0, avg_hr: 0, min_hr: 0, max_hr: 0, hrv_ms: 0, distance_km: 2, sleep_h: 1, weight_kg: 1, vo2max: 1 };
const fmt = (k, v) => v == null || !isFinite(v) ? '' : (+v).toFixed(DP[k] == null ? 1 : DP[k]);

function summarise(r){
  const dates = [...r.days.keys()].sort();
  const daily = dates.slice(-DAILY_DAYS);
  const used = COLS.filter(k => daily.some(d => r.days.get(d)[k] != null));
  const lines = [];
  lines.push('Apple Health export, read on the person’s own device. ' + r.records.toLocaleString('en-US') + ' records, ' + r.first + ' to ' + r.last + '.');
  lines.push('Steps, distance, flights and active energy are counted once per day, from the device that counted most (an iPhone and a Watch both count the same steps). Sleep is time asleep, given to the night it ended. Units: km, kcal, kg, ms, beats per minute.');
  if(daily.length){
    lines.push('', '## Daily' + (dates.length > DAILY_DAYS ? ' (latest ' + DAILY_DAYS + ' days with data)' : ''));
    lines.push(['date'].concat(used).join(','));
    for(const d of daily){ const x = r.days.get(d); lines.push([d].concat(used.map(k => fmt(k, x[k]))).join(',')); }
  }
  /* Monthly averages over the whole export, so a trend older than a year
     is still there. */
  const months = new Map();
  for(const d of dates){
    const m = d.slice(0, 7), x = r.days.get(d), acc = months.get(m) || {};
    for(const k of COLS) if(x[k] != null){ const a = acc[k] || (acc[k] = { n: 0, s: 0 }); a.n++; a.s += x[k]; }
    months.set(m, acc);
  }
  if(months.size > 1){
    const mcols = COLS.filter(k => [...months.values()].some(a => a[k]));
    lines.push('', '## Monthly averages (per day with data)');
    lines.push(['month'].concat(mcols).join(','));
    for(const [m, a] of [...months].sort()) lines.push([m].concat(mcols.map(k => a[k] ? fmt(k, a[k].s / a[k].n) : '')).join(','));
  }
  if(r.workouts.length){
    lines.push('', '## Workouts' + (r.workouts.length > WORKOUTS ? ' (latest ' + WORKOUTS + ' of ' + r.workouts.length + ')' : ''));
    lines.push('date,type,minutes');
    for(const w of r.workouts.slice(0, WORKOUTS)) lines.push(w.d + ',' + w.kind + ',' + (w.min == null ? '' : w.min.toFixed(0)));
  }
  return lines.join('\n');
}

/* amvHealthRead(file, onProgress) ->
     null                                   not an Apple Health export
     { refuse: code }                       one, but it cannot be read
     { text, summary, days, records }       read */
async function amvHealthRead(file, onProgress){
  let ent;
  try{ ent = await findExport(file); }catch(e){ return null; }
  if(!ent || ent === 'other') return null;
  try{
    const r = await scan(file, ent, onProgress);
    if(!r.days.size) return { refuse: 'health_empty' };
    return { text: summarise(r), days: r.days.size, records: r.records,
             summary: r.days.size.toLocaleString() + ' ' + (r.days.size === 1 ? T('day') : T('days')) + ' · ' + r.first + ' – ' + r.last };
  }catch(e){
    if(e instanceof Stop && e.why === 'not_health') return null;
    return { refuse: e instanceof Stop ? e.why : 'damaged' };
  }
}
window.amvHealthRead = amvHealthRead;
})();
