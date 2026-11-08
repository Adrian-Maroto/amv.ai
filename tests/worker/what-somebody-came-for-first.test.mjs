/* WHAT SOMEBODY CAME FOR FIRST (Nov 8 audit GROWTH-010).

   The first starting chip a new person clicks is kept by name, once, and
   every later funnel step - first answer, something made recurring, coming
   back, paying - is counted under it too. The owner's Growth tab then shows
   which first step turns into people who stay. Driven through the real route
   and the real _funnelMark. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'firstgoal.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _funnelMark, _goalReport, _funnelReport };\n');
const W = await import(harness + '?t=' + Date.now());
const quiet = console.log; console.log = (...a) => { if (String(a[0]).startsWith('AUDIT')) return; quiet(...a); };

const m = new Map(), vals = new Map();
const env = { JWT_SECRET: 'j'.repeat(40), APP_URL: 'https://amv.test',
  AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, String(v)); }, async delete(k) { m.delete(k); },
    async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: withAuthOps({ idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body || '{}'); const r = (o) => new Response(JSON.stringify(o));
    if (b.op === 'tally' || b.op === 'incr') { vals.set(n, (vals.get(n) || 0) + Number(b.amount || 1)); return r({ value: vals.get(n), total: vals.get(n) }); }
    if (b.op === 'tallyGet' || b.op === 'get') return r({ value: vals.get(n) || 0, total: vals.get(n) || 0 });
    return r({ allowed: true, value: vals.get(n) || 0, count: 1, claimed: true });
  } }) }) };
const ctx = { waitUntil() {}, passThroughOnException() {} };
let ip = 1;
const call = async (path, body, tok) => { const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.4.0.' + (ip++), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body || {}) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) }; };
const signup = async (email) => (await call('/auth/signup', { email, name: 'N', password: 'a long enough passphrase' })).d.token;

section('The first chip is kept by name, once');
{
  const t = await signup('ana@example.com');
  ok((await call('/v1/firstgoal', { goal: 'build' })).status === 401, 'nobody signed out can record one');
  ok((await call('/v1/firstgoal', { goal: 'anything' }, t)).status === 400, 'only the chips that exist are names it takes');
  const r = await call('/v1/firstgoal', { goal: 'build' }, t);
  ok(r.status === 200 && r.d.kept === true && m.get('fgoal:ana@example.com') === 'build', 'the first one is kept', r.d);
  const again = await call('/v1/firstgoal', { goal: 'advice' }, t);
  ok(again.d.kept === false && m.get('fgoal:ana@example.com') === 'build', 'and a later click does not replace it', again.d);
}

section('Every later step is counted under it too');
{
  const t = await signup('bo@example.com');
  await call('/v1/firstgoal', { goal: 'automate' }, t);
  await W._funnelMark(env, 'ana@example.com', 'activated');
  await W._funnelMark(env, 'bo@example.com', 'activated');
  await W._funnelMark(env, 'bo@example.com', 'habit');
  await W._funnelMark(env, 'bo@example.com', 'habit');   // once ever
  const g = await W._goalReport(env);
  ok(g.build.chose === 1 && g.build.activated === 1 && g.build.habit === 0, 'Build: chose, got an answer, nothing recurring yet', g.build);
  ok(g.automate.chose === 1 && g.automate.activated === 1 && g.automate.habit === 1, 'Automate: and made something recurring - counted once', g.automate);
  const f = await W._funnelReport(env);
  ok(f.habit === 1 && f.habitPct != null, 'the funnel has the habit step between a first answer and coming back', { habit: f.habit, pct: f.habitPct });
}

section('A recurring job is the habit step; the chips report it; the owner sees it');
{
  const back = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  ok(/if\(repeat !== 'once'\)\{ try\{ await _funnelMark\(env, user\.email, 'habit'\)/.test(back), 'creating a job that runs again marks the habit step');
  const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
  ok(/loadStr\('amv_firstgoal'\)!=='1'[\s\S]{0,140}AMV_API\.firstGoal\(p\.dataset\.kind\)/.test(app), 'the first chip clicked is sent once, by its kind');
  const admin = readFileSync(join(ROOT, 'src', 'admin', 'admin.js'), 'utf8');
  ok(/Which first step keeps people/.test(admin) && /Set something to run again on its own/.test(admin), 'and the Growth tab shows the habit step and the table by first chip');
}

console.log = quiet;
report();
done();
