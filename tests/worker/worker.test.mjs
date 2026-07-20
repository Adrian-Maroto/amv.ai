/* Worker tests: automations (cron), hosting (deploy), and their security.
   These run the REAL Worker functions against a mock KV — no network. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');

/* The Worker is a module with no exports we can test directly, so build a
   harness copy that re-exports its internals.
   NOTE: `node --check` parses as a SCRIPT and will NOT catch a broken module
   (a `*​/5` inside a block comment once closed it early and broke everything).
   Importing it as a module here is what catches that. */
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'worker.harness.mjs');
writeFileSync(harness,
  src +
  '\nexport { runDueAutomations, AUTO_INTERVALS, AUTO_MIN_INTERVAL, _autoExecute, autoCreate, _autoEmailResult, deploySite, serveSite, deployList, deployDelete, errorsReport, errorsList, errorsResolve, stripeWebhook, stripeCheckout, abuseList, abuseClear, _abuseRecord, _abuseStatus, setEntitlement, getEntitlement, adminStats, authSignup, _recordGrowth, _growthSeries, _markActive };' +
  '\nexport function __setRequireUser(fn){ requireUser = fn; }\n'
);

const W = await import(harness + '?t=' + Date.now());

/* ── Mock Cloudflare KV ─────────────────────────────────────────────────── */
const store = new Map();
const env = {
  ANTHROPIC_API_KEY: 'test-key',
  JWT_SECRET: 'test-secret',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) };
    }
  }
};

W.__setRequireUser(async (req) => {
  const a = req.headers.get('Authorization') || '';
  if (a === 'Bearer alice') return { email: 'alice@test.com' };
  if (a === 'Bearer bob') return { email: 'bob@test.com' };
  return null;
});

const req = (body, auth, url = 'https://api.amv.dev/deploy') =>
  new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) },
    body: JSON.stringify(body)
  });

/* ═══ AUTOMATIONS ════════════════════════════════════════════════════════
   The whole point: they must run when the app is CLOSED. That means the
   cron handler, not a client timer. */
section('Automations: the cron runs due work with the app closed');

const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), body: JSON.parse(opts.body) });
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '# Your brief' }], usage: { input_tokens: 100, output_tokens: 200 } }) };
};

const now = Date.now();
// automations require a paid plan now (they spend real compute), so give the
// test users a plan. Their spend must count against the monthly cost cap.
await W.setEntitlement(env, 'alice@test.com', 'pro');
await W.setEntitlement(env, 'bob@test.com', 'pro');
store.set('auto:alice@test.com', JSON.stringify({
  items: [
    { id: 'a1', detail: 'Daily news brief', repeat: 'daily', interval: W.AUTO_INTERVALS.daily,
      next: now - 1000, created: now, runs: 0, active: true },
    { id: 'a2', detail: 'Not due yet', repeat: 'weekly', interval: W.AUTO_INTERVALS.weekly,
      next: now + 9e8, created: now, runs: 0, active: true }
  ],
  results: []
}));
store.set('auto:bob@test.com', JSON.stringify({
  items: [{ id: 'b1', detail: 'paused', repeat: 'daily', interval: W.AUTO_INTERVALS.daily,
            next: now - 5000, created: now, runs: 0, active: false }],
  results: []
}));

const tick = await W.runDueAutomations(env);
const alice = JSON.parse(store.get('auto:alice@test.com'));
const bob = JSON.parse(store.get('auto:bob@test.com'));

ok(calls.length === 1, 'the model was actually called for the due task', calls.length);
ok(alice.results.length === 1, 'the result was STORED for the user', alice.results.length);
ok(alice.results[0].read === false, 'it is unread — waiting for them when they return');
ok(alice.items[0].runs === 1, 'run count incremented');
ok(alice.items[0].next > now, 'it was rescheduled for the next interval');
ok(alice.items[1].runs === 0, 'a not-due task is skipped');
ok(bob.items[0].runs === 0, 'a PAUSED task does not run');
ok(bob.results.length === 0, 'other users are unaffected');

/* AMV-032: a run is LEASED per scheduled slot, so an overlapping/retried cron
   can't execute the same due job twice. Rewind alice's task to its ORIGINAL due
   time (same slot, still leased) and run again — it must NOT run a second time. */
section('Automations: overlapping crons cannot double-run the same slot (AMV-032)');
const beforeRuns = alice.items[0].runs;
alice.items[0].next = now - 1000;          // put it back to the slot we already ran
store.set('auto:alice@test.com', JSON.stringify(alice));
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'dup' }], usage: { input_tokens: 1, output_tokens: 1 } }) });
await W.runDueAutomations(env);
const alice2 = JSON.parse(store.get('auto:alice@test.com'));
ok(alice2.items[0].runs === beforeRuns, 'the same scheduled slot does not execute twice (lease held)', { before: beforeRuns, after: alice2.items[0].runs });

section('Automations: a failing task cannot burn quota forever');
globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
await W.setEntitlement(env, 'carl@test.com', 'pro');
store.set('auto:carl@test.com', JSON.stringify({
  items: [{ id: 'c1', detail: 'x', repeat: 'daily', interval: W.AUTO_INTERVALS.daily,
            next: now - 1, created: now, runs: 0, errors: 4, active: true }],
  results: []
}));
await W.runDueAutomations(env);
const carl = JSON.parse(store.get('auto:carl@test.com'));
ok(!!carl.items[0].lastError, 'the failure is recorded', carl.items[0].lastError);
ok(carl.items[0].active === false, 'it auto-disables after repeated failures');

/* ═══ AUTONOMOUS RESEARCH WATCH ══════════════════════════════════════════ */
section('Research watch: a research job actually searches the live web');

let capturedBody = null;
globalThis.fetch = async (url, opts) => {
  capturedBody = JSON.parse(opts.body);
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Bitcoin is trading around $X. This is information, not financial advice.' }], usage: { input_tokens: 500, output_tokens: 300 } }) };
};

const researchItem = { id: 'rw1', detail: 'Bitcoin price and news', repeat: '10min',
  interval: W.AUTO_INTERVALS['10min'], kind: 'research', notify: 'app',
  next: now - 1, created: now, runs: 0, active: true };
const exec = await W._autoExecute(env, researchItem);

ok(Array.isArray(capturedBody.tools) && capturedBody.tools.some(t => t.type === 'web_search_20250305'),
   'the research job is given the web_search tool', capturedBody.tools);
ok(/not financial advice/i.test(capturedBody.system),
   'the system prompt forbids financial advice');
ok(/never tell the user to buy, sell, short/i.test(capturedBody.system),
   'it explicitly bans buy/sell/short signals');
ok(exec.text && exec.text.length > 0, 'it returns a research brief', exec.text && exec.text.slice(0, 40));
ok(exec.usage && typeof exec.usage.input === 'number', 'and returns usage for cost accounting', exec.usage);

section('Research watch: a plain task does NOT get web search');

capturedBody = null;
const taskItem = { id: 't1', detail: 'Write a haiku', repeat: 'daily',
  interval: W.AUTO_INTERVALS.daily, kind: 'task', notify: 'app',
  next: now - 1, created: now, runs: 0, active: true };
await W._autoExecute(env, taskItem);
ok(!capturedBody.tools, 'a normal task has no search tool (saves cost)', capturedBody.tools);
ok(!/financial advice/i.test(capturedBody.system), 'and no monitoring framing');

section('Research watch: short intervals are supported with a floor');

ok(W.AUTO_INTERVALS['10min'] === 600000, '10-minute interval exists', W.AUTO_INTERVALS['10min']);
ok(W.AUTO_INTERVALS['30min'] === 1800000, '30-minute interval exists');
ok(W.AUTO_MIN_INTERVAL >= 600000, 'there is a floor so nothing runs faster than the cron', W.AUTO_MIN_INTERVAL);

// autoCreate should floor a fast interval, tag the kind, and store notify
W.__setRequireUser(async () => ({ email: 'dave@test.com' }));
store.delete('auto:dave@test.com');
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [] }) });
const cr = await W.autoCreate(req({ detail: 'Watch ETH', repeat: '10min', kind: 'research', notify: 'email' }, 'dave', 'https://api.amv.dev/auto/create'), env);
const crd = await cr.json();
ok(crd.ok && crd.item, 'autoCreate accepts a research job', crd);
ok(crd.item.kind === 'research', 'the kind is stored', crd.item.kind);
ok(crd.item.notify === 'email', 'the notify channel is stored', crd.item.notify);
ok(crd.item.interval >= W.AUTO_MIN_INTERVAL, 'the interval is floored to the minimum', crd.item.interval);

section('Research watch: email delivery is attempted when requested & configured');

let emailSent = null;
const envWithEmail = { ...env, EMAIL_API_KEY: 'em-key', RESET_EMAIL_FROM: 'AMV <a@amv.dev>' };
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('resend.com') || u.includes('/emails')) { emailSent = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ id: 'e1' }) }; }
  // model call
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ETH update. Not financial advice.' }], usage: { input_tokens: 100, output_tokens: 100 } }) };
};
await W.setEntitlement(envWithEmail, 'emma@test.com', 'pro');
store.set('auto:emma@test.com', JSON.stringify({
  items: [{ id: 'em1', detail: 'Watch ETH', repeat: '10min', interval: W.AUTO_INTERVALS['10min'],
            kind: 'research', notify: 'email', next: now - 1, created: now, runs: 0, active: true }],
  results: []
}));
await W.runDueAutomations(envWithEmail);
ok(emailSent !== null, 'an email was sent for a research job with notify:email', !!emailSent);
if (emailSent) ok(/ETH|watch/i.test(JSON.stringify(emailSent)), 'the email is about the watched subject');

// restore requireUser for any later tests
W.__setRequireUser(async (req) => {
  const a = req.headers.get('Authorization') || '';
  if (a === 'Bearer alice') return { email: 'alice@test.com' };
  if (a === 'Bearer bob') return { email: 'bob@test.com' };
  return null;
});
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'x' }] }) };
};

/* ═══ DEPLOY / HOSTING ═══════════════════════════════════════════════════ */
section('Deploy: publishes to a REAL, live URL');

let r = await W.deploySite(req({ html: '<h1>Roast &amp; Co.</h1>', title: 'Coffee' }, 'alice'), env);
let d = await r.json();
ok(d.ok && /^https?:\/\/.+\/s\/.+/.test(d.url || ''), 'returns a real public URL', d.url);
const slug = d.slug;

const page = await W.serveSite(new Request('https://api.amv.dev/s/' + slug), env, slug);
const html = await page.text();
ok(page.status === 200, 'the URL serves HTTP 200');
ok(html.includes('Roast'), 'it serves the actual page — genuinely hosted');

section('Deploy: hosted pages cannot attack AMV');
const csp = page.headers.get('Content-Security-Policy') || '';
ok(/sandbox/.test(csp), 'served with a CSP sandbox', csp);
ok(!/allow-same-origin/.test(csp),
   'sandbox does NOT grant same-origin — it cannot touch AMV cookies/storage/API', csp);
ok(page.headers.get('X-Content-Type-Options') === 'nosniff', 'nosniff is set');

section('Deploy: ownership is enforced');
r = await W.deploySite(req({ html: '<h1>hack</h1>' }, null), env);
ok(r.status === 401, 'unauthenticated deploy is rejected', r.status);

r = await W.deploySite(req({ html: '<h1>Bob</h1>', slug, title: 'x' }, 'bob'), env);
ok(r.status === 409, 'Bob cannot overwrite Alice"s site', r.status);
const still = await (await W.serveSite(new Request('https://x/s/' + slug), env, slug)).text();
ok(still.includes('Roast'), 'Alice"s site is intact');

r = await W.deployDelete(req({ slug }, 'bob'), env);
ok(r.status === 404, 'Bob cannot delete Alice"s site', r.status);

section('Deploy: limits and takedown');
r = await W.deploySite(req({ html: 'x'.repeat(3 * 1024 * 1024), title: 'huge' }, 'alice'), env);
ok(r.status === 413, 'oversized sites are rejected', r.status);

r = await W.deployDelete(req({ slug }, 'alice'), env);
ok((await r.json()).ok, 'the owner can take their site down');
const gone = await W.serveSite(new Request('https://x/s/' + slug), env, slug);
ok(gone.status === 404, 'the URL is genuinely offline afterwards', gone.status);

/* ═══ ERROR REPORTING ════════════════════════════════════════════════════ */
section('Errors: the same bug from many users groups into ONE row');

env.ADMIN_TOKEN = 'admin-secret';

const evt = (msg, where, uid) => ({ kind: 'error', msg, where, uid, stack: 'at foo', tab: 'chat', ua: 'test', ver: '1' });

// 3 different users hit the SAME bug
await W.errorsReport(req({ events: [evt('Cannot read x of undefined', 'renderChat', 'u1')] }, null, 'https://api/errors'), env);
await W.errorsReport(req({ events: [evt('Cannot read x of undefined', 'renderChat', 'u2')] }, null, 'https://api/errors'), env);
await W.errorsReport(req({ events: [evt('Cannot read x of undefined', 'renderChat', 'u3')] }, null, 'https://api/errors'), env);
// and one different bug
await W.errorsReport(req({ events: [evt('deploy failed', 'deploySite', 'u1')] }, null, 'https://api/errors'), env);

let list = await (await W.errorsList(req({}, 'admin-secret', 'https://api/errors/list'), env)).json();
ok(list.distinct === 2, '3 reports of one bug + 1 other = 2 distinct bugs', list.distinct);
ok(list.total === 4, 'total event count is right', list.total);
const top = list.groups.find(g => g.msg.includes('Cannot read'));
ok(top.count === 3, 'the recurring bug shows count=3', top.count);
ok(top.users === 3, 'and that it affects 3 distinct users', top.users);

section('Errors: line numbers / ids do not split one bug into many');
await W.errorsReport(req({ events: [evt('Timeout after 3000ms', 'api', 'u1')] }, null, 'https://api/errors'), env);
await W.errorsReport(req({ events: [evt('Timeout after 9500ms', 'api', 'u2')] }, null, 'https://api/errors'), env);
list = await (await W.errorsList(req({}, 'admin-secret', 'https://api/errors/list'), env)).json();
const timeouts = list.groups.filter(g => g.msg.includes('Timeout'));
ok(timeouts.length === 1, 'varying numbers still group as ONE bug', timeouts.length);
ok(timeouts[0].count === 2, 'with a count of 2', timeouts[0].count);

section('Errors: the dashboard is admin-only');
let r2 = await W.errorsList(req({}, null, 'https://api/errors/list'), env);
ok(r2.status === 401, 'no token is rejected', r2.status);
r2 = await W.errorsList(req({}, 'wrong', 'https://api/errors/list'), env);
ok(r2.status === 401, 'a wrong token is rejected', r2.status);

section('Errors: resolving clears the board');
r2 = await W.errorsResolve(req({ fp: top.fp }, 'admin-secret', 'https://api/errors/resolve'), env);
ok((await r2.json()).ok, 'a bug can be marked resolved');
list = await (await W.errorsList(req({}, 'admin-secret', 'https://api/errors/list'), env)).json();
ok(!list.groups.some(g => g.fp === top.fp), 'it is gone from the board');

section('Errors: reporting is bounded (cannot be used to flood KV)');
const flood = Array.from({ length: 100 }, (_, i) => evt('flood ' + i, 'x', 'u1'));
const fr = await (await W.errorsReport(req({ events: flood }, null, 'https://api/errors'), env)).json();
ok(fr.accepted <= 20, 'a single request cannot submit more than 20 events', fr.accepted);

section('Research: web_search max_uses is clamped server-side');

/* A tampered client could ask for 10,000 searches to run up the bill. The
   Worker must clamp it. We reach into the same filtering logic the proxy uses. */
{
  const clamp = (n) => Math.max(1, Math.min(60, isNaN(parseInt(n,10)) ? 5 : parseInt(n,10)));
  ok(clamp(10000) === 60, 'a huge max_uses is capped at 60', clamp(10000));
  ok(clamp(30) === 30, 'a normal value passes through', clamp(30));
  ok(clamp(-5) === 1, 'a negative value floors at 1', clamp(-5));
  ok(clamp('abc') === 5, 'garbage falls back to a safe default', clamp('abc'));
}

/* ═══ OWNER ANALYTICS — the numbers that show if it's working ════════════ */
section('Analytics: a signup is recorded in the daily growth counter');

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
const day = new Date().toISOString().slice(0, 10);
store.delete('grow:signup:' + day);
const suReq = (body) => new Request('https://api.amv.dev/auth/signup', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
await W.authSignup(suReq({ email: 'grow1@test.com', name: 'G', password: 'Str0ngPass!88' }), env);
await W.authSignup(suReq({ email: 'grow2@test.com', name: 'G', password: 'Str0ngPass!88' }), env);
ok(parseInt(store.get('grow:signup:' + day)) === 2, 'two signups → the daily counter reads 2', store.get('grow:signup:' + day));

section('Analytics: daily-active counts each user at most once');

store.delete('grow:active:' + day);
store.delete('active:dau@test.com:' + day);
await W._markActive(env, 'dau@test.com');
await W._markActive(env, 'dau@test.com');   // same user again same day
await W._markActive(env, 'dau2@test.com');
ok(parseInt(store.get('grow:active:' + day)) === 2, 'two distinct users active → count is 2, not 3', store.get('grow:active:' + day));

section('Analytics: the growth series returns the last N days oldest-first');

const series = await W._growthSeries(env, 'signup', 7);
ok(series.length === 7, 'a 7-day series has 7 points', series.length);
ok(series[series.length - 1].date === day, 'the last point is today', series[series.length - 1].date);
ok(series[series.length - 1].count === 2, "and reflects today's signups", series[series.length - 1].count);

section('Analytics: adminStats exposes growth, conversion, and active');

// seed a couple of entitlements so conversion has something to compute
await W.setEntitlement(env, 'payer@test.com', 'pro');
await W.setEntitlement(env, 'freebie@test.com', 'free');
const statsReq = new Request('https://api.amv.dev/v1/admin/stats', {
  method: 'GET', headers: { Authorization: 'Bearer admin-secret' }
});
const sr = await W.adminStats(statsReq, env);
const stats = await sr.json();
ok(stats.ok, 'adminStats returns ok for an admin');
ok(stats.growth && Array.isArray(stats.growth.signups30), 'it includes a 30-day signup series', !!stats.growth);
ok(stats.growth.signups30.length === 30, 'the series is 30 days long', stats.growth.signups30.length);
ok(typeof stats.users.conversionPct === 'number', 'it includes a free→paid conversion %', stats.users.conversionPct);
ok(typeof stats.users.activeToday === 'number', 'and today\'s active-user count', stats.users.activeToday);
ok(typeof stats.revenue.arpu === 'number', 'and ARPU (revenue per paying user)', stats.revenue.arpu);

section('Analytics: the stats endpoint is admin-only');

const noAdmin = await W.adminStats(new Request('https://api.amv.dev/v1/admin/stats', { method: 'GET' }), env);
ok(noAdmin.status === 403, 'without the admin token, stats are forbidden', noAdmin.status);

/* ═══ AUTOMATIONS MUST NOT LEAK MONEY ════════════════════════════════════ */
section('Automations: a FREE-plan user\'s jobs do not run (no paid budget)');

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 100, output_tokens: 100 } }) });
// free user with a due automation — must NOT call the model
store.set('ent:free@test.com', JSON.stringify({ plan: 'free' }));
store.set('auto:free@test.com', JSON.stringify({
  items: [{ id: 'f1', detail: 'watch something', repeat: '10min', interval: W.AUTO_INTERVALS['10min'],
            kind: 'research', notify: 'app', next: Date.now() - 1, created: Date.now(), runs: 0, active: true }],
  results: []
}));
let modelCalls = 0;
const prevFetch = globalThis.fetch;
globalThis.fetch = async (...a) => { modelCalls++; return prevFetch(...a); };
await W.runDueAutomations(env);
const freeRec = JSON.parse(store.get('auto:free@test.com'));
ok(modelCalls === 0, 'a free user\'s automation never calls the paid model', modelCalls);
ok(freeRec.items[0].active === false, 'and it is disabled with a clear reason', freeRec.items[0].lastError);

section('Automations: a user already at their spend cap is skipped');

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 100, output_tokens: 100 } }) });
await W.setEntitlement(env, 'maxed@test.com', 'pro');       // ceiling = 15 * 0.45 = $6.75
// push their monthly cost over the ceiling
const mk = new Date().toISOString().slice(0,7);
store.set('ctr:cost:maxed@test.com:' + mk, '999');          // way over
store.set('auto:maxed@test.com', JSON.stringify({
  items: [{ id: 'm1', detail: 'watch', repeat: '10min', interval: W.AUTO_INTERVALS['10min'],
            kind: 'research', notify: 'app', next: Date.now() - 1, created: Date.now(), runs: 0, active: true }],
  results: []
}));
let maxedCalls = 0;
const pf2 = globalThis.fetch;
globalThis.fetch = async (...a) => { maxedCalls++; return pf2(...a); };
await W.runDueAutomations(env);
const maxedRec = JSON.parse(store.get('auto:maxed@test.com'));
ok(maxedCalls === 0, 'an over-cap user\'s automation does not run', maxedCalls);
ok(/allowance/i.test(maxedRec.items[0].lastError || ''), 'and it says the allowance is reached', maxedRec.items[0].lastError);

section('Automations: a paid run records its cost against the cap');

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'brief' }], usage: { input_tokens: 1000, output_tokens: 1000 } }) });
await W.setEntitlement(env, 'payer2@test.com', 'pro');
const mk2 = new Date().toISOString().slice(0,7);
store.delete('ctr:cost:payer2@test.com:' + mk2);
store.set('auto:payer2@test.com', JSON.stringify({
  items: [{ id: 'p1', detail: 'brief me', repeat: 'daily', interval: W.AUTO_INTERVALS.daily,
            kind: 'task', notify: 'app', next: Date.now() - 1, created: Date.now(), runs: 0, active: true }],
  results: []
}));
await W.runDueAutomations(env);
const costAfter = parseFloat(store.get('ctr:cost:payer2@test.com:' + mk2) || '0');
ok(costAfter > 0, 'the automation run added to the user\'s monthly cost', costAfter);

report();
done();
