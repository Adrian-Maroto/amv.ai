/* THE WORK THAT NEVER RAN, FOR THE PEOPLE NOBODY COUNTED.

   Every failure in this file looks like success from the outside. Nothing
   throws, no request 500s, no alert fires. A list comes back, a loop finishes,
   a summary is returned. The defect is entirely in what was NOT in the list and
   in the fact that the code knew and said nothing.

   Two shapes of it were live here.

   A bounded scan that comes back exactly full has probably stopped short. The
   renewal sweep read two thousand entitlements and computed `truncated` - and
   the caller dropped the flag on the floor. Past two thousand paying accounts,
   a stable arbitrary subset was never examined for a lapsed payment. Not
   examined late. Never, because the cut fell in the same place every day. The
   erasure path had the same shape with worse consequences: records left behind
   and "your account has been deleted" returned anyway. Admin screens had it
   too, where a subset that looks like the whole list is a number an operator
   makes decisions on.

   And a loop with no time budget. The autonomous tick walked up to a million
   users in a fixed order doing several round trips each, until the platform
   killed it. Whoever was far enough down that list never ran - and had paid for
   a nightly job that had quietly stopped existing.

   So the rules asserted here are: a scan that stops short says so, to somebody;
   a screen that shows part of something says which; work that must be complete
   to be correct is not capped; and a tick that runs out of time stops on
   purpose, serves the most overdue first, and reports what it left. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'scans.harness.mjs');
writeFileSync(harness, src
  + '\nexport { DB, scan, SCAN_ALL, SWEEP_SCAN_LIMIT, ADMIN_USERS_LIMIT, SUPPORT_SCAN_LIMIT,'
  + ' runRenewalSweep, runDueAutomations, AUTO_TICK_BUDGET_MS };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

let alerts = [];
let modelCalls = 0;
let modelDelayMs = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/hooks\.|slack|discord/i.test(u)) { alerts.push(String((opts && opts.body) || '')); return { ok: true, status: 200, json: async () => ({}) }; }
  if (/model\.example/.test(u)) {
    modelCalls++;
    if (modelDelayMs) await new Promise(r => setTimeout(r, modelDelayMs));
    return { ok: true, status: 200, json: async () => ({
      content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 10, output_tokens: 10 } }) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

/* Counts every read, because "did this cost a round trip" is the whole point of
   one of the fixes below and is invisible from the outputs. */
let reads = 0;
function mkEnv(extra) {
  const m = new Map(); const vals = new Map(); alerts = []; modelCalls = 0; reads = 0;
  return Object.assign({
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    OWNER_EMAIL: 'owner@example.com', ALERT_WEBHOOK: 'https://hooks.example/a',
    AMV_KV: {
      _map: m,
      async get(k) { reads++; return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      /* Paginated like the real thing. A stub that returns everything in one
         page cannot express truncation at all, so a scan limit above one page
         would look untruncated whatever the code did - the test would pass
         against the defect. */
      async list({ prefix, limit, cursor } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        const from = cursor ? +cursor : 0;
        const page = all.slice(from, from + (limit || 1000));
        const next = from + page.length;
        return { keys: page, list_complete: next >= all.length, cursor: String(next) };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  }, extra || {});
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '80.80.80.80',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);

const alerted = (re) => alerts.some(a => re.test(a));

section('Every bounded scan goes through the one place that reports truncation');
{
  /* The standing rule, checked against the source rather than a behaviour,
     because the failure mode is a NEW scan added next month that computes its
     limit correctly and tells nobody. Behaviour tests cannot see code that does
     not exist yet; this can.

     Only calls that pass `env` count - the helper's own line is the one legal
     site, and it is inside `scan`. */
  const sites = [...src.matchAll(/DB\.list\(\s*env\b/g)].map(mm => mm.index);
  const scanStart = src.indexOf('async function scan(env, kind, limit, what)');
  const scanEnd = src.indexOf('\n}', scanStart);
  ok(scanStart > 0, 'the helper exists', scanStart > 0);
  const outside = sites.filter(i => !(i > scanStart && i < scanEnd));
  ok(outside.length === 0,
     'and no scan reads a list around it', outside.map(i => src.slice(i - 90, i + 40).split('\n').pop()));
}

section('A scan that stops short says so, and pages somebody');
{
  const env = mkEnv();
  for (let i = 0; i < 12; i++) await W.DB.put(env, 'ent', 'u' + i + '@example.com', { plan: 'pro' });

  const full = await W.scan(env, 'ent', 12, 'a test scan');
  ok(full.truncated === true, 'reading exactly the limit is treated as more to come', full.rows.length);
  ok(alerted(/STOPPED SHORT/), 'and somebody is told', alerts.length);
  ok(alerted(/a test scan/), 'told WHICH scan, because "a scan" is not actionable', alerts.slice(-1)[0]);

  alerts = [];
  const room = await W.scan(env, 'ent', 500, 'a test scan with room');
  ok(room.truncated === false && room.rows.length === 12, 'a scan with room to spare is not flagged', room.rows.length);
  ok(!alerted(/STOPPED SHORT/), 'and does not page anybody', alerts.length);
}

section('The renewal sweep no longer stops checking paying accounts in silence');
{
  /* The real defect: `truncated` was computed here and thrown away by the cron,
     which only ever logged `stale`. Exactly at the limit, so the sweep believes
     it has seen everything. */
  const env = mkEnv();
  for (let i = 0; i < W.SWEEP_SCAN_LIMIT; i++)
    await W.DB.put(env, 'ent', 'p' + i + '@example.com', { plan: 'pro', source: 'stripe', renewedAt: Date.now() });

  const s = await W.runRenewalSweep(env);
  ok(s.ran === true, 'the sweep ran', s);
  ok(s.truncated === true, 'and knows it did not see everything', s.truncated);
  ok(alerted(/STOPPED SHORT/) && alerted(/renewal sweep/),
     'and that fact leaves the process, which is the part that was missing', alerts.length);
}

section('Work that has to be complete to be correct is not capped at all');
{
  /* An erasure that quietly does most of it, and a reconciliation that quietly
     rescues the first two hundred people who paid, are both worse than one that
     fails: they report success. So these pass no practical ceiling. */
  const named = [
    ['erasure: marketplace snapshots', 'mktsnap'],
    ['erasure: account-link invitations', 'link'],
    ['payment reconciliation', 'paypending'],
  ];
  for (const [what, kind] of named) {
    const i = src.indexOf("'" + what + "'");
    ok(i > 0, 'the ' + what + ' scan is named', i > 0);
    const line = src.slice(src.lastIndexOf('\n', i) + 1, i + what.length + 2);
    ok(/SCAN_ALL/.test(line), 'and reads all of ' + kind + ', not a slice of it', line.trim().slice(0, 120));
  }
}

section('An admin screen that shows part of something says which part');
{
  const env = mkEnv();
  const tok = (await (await call(env, '/auth/signup', { email: 'owner@example.com', name: 'O', password: 'A-real-Passw0rd!' })).json()).token;
  ok(!!tok, 'the owner is signed in', !!tok);

  const few = await (await call(env, '/admin/users', {}, tok)).json();
  ok(few.truncated === false, 'a short list is not flagged', few.truncated);
  ok(few.note === null, 'and says nothing misleading', few.note);

  for (let i = 0; i < W.ADMIN_USERS_LIMIT; i++)
    await W.DB.put(env, 'acct', 'a' + i + '@example.com', { email: 'a' + i + '@example.com' });

  const many = await (await call(env, '/admin/users', {}, tok)).json();
  ok(many.truncated === true, 'a full page is flagged as a page', many.truncated);
  ok(/not the total/i.test(many.note || ''),
     'and says outright that the count is not the customer base', many.note);
  ok(many.count <= W.ADMIN_USERS_LIMIT && many.scanLimit === W.ADMIN_USERS_LIMIT,
     'with the limit stated so the number can be read correctly', { count: many.count, limit: many.scanLimit });
}

section('And so does the inbox, because an unseen ticket is an unanswered customer');
{
  const env = mkEnv();
  await call(env, '/auth/signup', { email: 'owner@example.com', name: 'O', password: 'A-real-Passw0rd!' });

  const quiet = await (await worker.fetch(new Request('https://api.amv.test/v1/admin/support', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer a' }, body: '{}' }), env, ctx)).json();
  ok(quiet.truncated === false && quiet.note === null, 'an empty inbox is honestly empty', quiet);

  for (let i = 0; i < W.SUPPORT_SCAN_LIMIT; i++)
    await W.DB.put(env, 'support', 't' + i + '@example.com', { tickets: [{ id: 'k' + i, at: i, msg: 'help' }] });

  const busy = await (await worker.fetch(new Request('https://api.amv.test/v1/admin/support', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer a' }, body: '{}' }), env, ctx)).json();
  ok(busy.truncated === true, 'a full scan is flagged', busy.truncated);
  ok(/unseen mail/i.test(busy.note || ''), 'and names the consequence rather than a number', busy.note);
}

/* ------------------------------------------------------------------ */

/* One user with one job, due `overdueMs` ago. */
async function withDueJob(env, email, overdueMs, opts) {
  await W.DB.put(env, 'ent', email, { plan: 'pro', source: 'stripe' });
  await W.DB.put(env, 'auto', email, Object.assign({
    items: [{ id: 'j1', active: true, detail: 'do the thing', kind: 'task',
              next: Date.now() - overdueMs, interval: 86400000, approval: 'auto' }],
    results: [],
  }, opts || {}));
}

section('A tick costs nothing for somebody with nothing due');
{
  /* This was the reason the tick could not finish: every account that had ever
     created a job cost two round trips per tick whether or not anything was
     due, so the cost scaled with the customer base rather than with the work.
     The due check is a field comparison and must stay one. */
  /* MEASURED AS A SLOPE, not as an average.

     Dividing total reads by the number of accounts conflates two different
     things: the cost that grows with the customer base, which is what this
     check is about, and a FIXED cost that does not. The tick now reads a
     due-time index - a constant handful of records per run, whatever the
     population - and against 50 accounts a fixed 48 reads looks like one read
     each, which is exactly the shape being forbidden. It is not: at 50,000
     accounts the same 48 reads is a thousandth of one each.

     So it is run at two sizes and the DIFFERENCE is what counts. Fixed costs
     cancel; anything per-account survives. */
  const costFor = async (n) => {
    const env = mkEnv();
    for (let i = 0; i < n; i++) {
      await W.DB.put(env, 'ent', 'idle' + i + '@example.com', { plan: 'pro' });
      await W.DB.put(env, 'auto', 'idle' + i + '@example.com', {
        items: [{ id: 'j', active: true, detail: 'later', next: Date.now() + 3600000, interval: 86400000 }], results: [] });
    }
    const before = reads;
    const r = await W.runDueAutomations(env);
    return { reads: reads - before, r };
  };
  const small = await costFor(20);
  const large = await costFor(120);
  /* One read per account is unavoidable on a sweep: the tick has to look at a
     record to know nothing is due in it. What must NOT grow is anything on top
     of that - an entitlement lookup, a billing subject, a family read. */
  const perUser = (large.reads - small.reads) / 100 - 1;
  ok(large.r.queued === 0, 'nobody is queued', large.r.queued);
  ok(large.r.ran === 0 && modelCalls === 0, 'nothing runs and nothing is spent', { ran: large.r.ran, modelCalls });
  ok(perUser < 0.5, 'and an idle account costs no lookup of its own',
     { perUser: +perUser.toFixed(2), small: small.reads, large: large.reads });
}

section('The most overdue work is done first');
{
  const env = mkEnv();
  await withDueJob(env, 'recent@example.com', 60 * 1000);
  await withDueJob(env, 'ancient@example.com', 7 * 86400000);
  await withDueJob(env, 'middling@example.com', 3600 * 1000);

  const r = await W.runDueAutomations(env);
  ok(r.queued === 3 && r.ran === 3, 'all three ran', { queued: r.queued, ran: r.ran });

  const order = [];
  for (const em of ['ancient@example.com', 'middling@example.com', 'recent@example.com']) {
    const rec = await W.DB.get(env, 'auto', em);
    order.push({ em, at: (rec.results[0] || {}).at });
  }
  ok(order[0].at <= order[1].at && order[1].at <= order[2].at,
     'oldest-overdue first, which is what makes stopping early safe', order.map(o => o.em));
}

section('A tick that runs out of time stops on purpose and says what it left');
{
  /* Made to overrun deliberately: each run is slow enough that the budget is
     spent partway through. The old loop had no budget at all, so this scenario
     ended with the platform killing the tick - no record, no alert, and the
     same people cut off next time because the order never changed. */
  const env = mkEnv();
  const n = 6;
  for (let i = 0; i < n; i++) await withDueJob(env, 'slow' + i + '@example.com', (i + 1) * 3600000);
  modelDelayMs = Math.ceil(W.AUTO_TICK_BUDGET_MS / 3);

  const r = await W.runDueAutomations(env);
  modelDelayMs = 0;

  ok(r.queued === n, 'all of them had work due', r.queued);
  ok(r.deferred > 0 && r.processed < n, 'the tick stopped rather than being stopped', r);
  ok(r.processed + r.deferred === n, 'and every account is accounted for', r);
  ok(alerted(/OUT OF TIME/), 'and a growing backlog pages somebody', alerts.length);

  /* The ones left behind are the LEAST overdue, because the most overdue ran.
     That is what makes them first next time instead of never. */
  const ranIt = [];
  for (let i = 0; i < n; i++) {
    const rec = await W.DB.get(env, 'auto', 'slow' + i + '@example.com');
    if ((rec.results || []).length) ranIt.push(i);
  }
  ok(ranIt.length === r.processed, 'the ones it got to are the ones that ran', ranIt);
  ok(ranIt.every(i => i >= n - r.processed),
     'and they are the most overdue, so the rest lead the next tick', ranIt);

  /* Prove it, rather than reasoning about it: run again and the leftovers go. */
  alerts = [];
  const r2 = await W.runDueAutomations(env);
  ok(r2.ran > 0, 'the second tick runs the ones that waited', r2);
  const missed = [];
  for (let i = 0; i < n; i++) {
    const rec = await W.DB.get(env, 'auto', 'slow' + i + '@example.com');
    if (!(rec.results || []).length) missed.push(i);
  }
  ok(missed.length === 0, 'nobody is starved by the cut-off', missed);
}

globalThis.fetch = realFetch;
if (report('nothing-is-skipped-in-silence') > 0) process.exitCode = 1;
done();
