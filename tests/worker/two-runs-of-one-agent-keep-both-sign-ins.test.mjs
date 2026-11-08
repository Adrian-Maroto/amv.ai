/* TWO RUNS OF ONE AGENT KEEP BOTH SIGN-INS (Nov 8 audit).

   Two watched runs of the same agent each read the jar, added the site they
   signed in to, and wrote it back - and the second write erased the first
   run's sign-in while both were told it was kept. Reproduced here the way
   the audit did: both runs read the jar at the same moment and the second
   is shown the old copy, as another region's KV would show it. The counter
   object is the real class, one request at a time, as a Durable Object runs. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'jarrace.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, _agentFind, _agentJarSave, _agentJarLoad };\n');
const W = await import(harness + '?t=' + Date.now());
const quiet = console.log; console.log = (...a) => { if (String(a[0]).startsWith('AUDIT')) return; quiet(...a); };

const objs = new Map();
const ns = { idFromName: n => n, get: (n) => ({ async fetch(_u, init) {
  if (!objs.has(n)) { const st = new Map(); objs.set(n, new W.AMVCounter({ storage: { async get(k){ return st.get(k); }, async put(k, v){ st.set(k, v); }, async delete(k){ st.delete(k); }, async deleteAll(){ st.clear(); }, async setAlarm(){}, async deleteAlarm(){} } }, {})); }
  const o = objs.get(n); const run = (o._q || Promise.resolve()).then(() => o.fetch(new Request('https://do/c', init)));
  o._q = run.catch(() => {}); return run; } }) };
const kv = new Map();
let stale = null;          // when set: the jar key answers this copy once per reader, as a lagging region would
const store = {
  async get(k) { if (stale && k.startsWith('agentjar:') && stale.left > 0) { stale.left--; return stale.copy; } return kv.has(k) ? kv.get(k) : null; },
  async put(k, v) { kv.set(k, String(v)); }, async delete(k) { kv.delete(k); },
  async list({ prefix } = {}) { return { keys: [...kv.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
};
const env = { JWT_SECRET: 'j'.repeat(48), APP_URL: 'https://amv.test', CONNECT_KEY: 'c'.repeat(44), AMV_KV: store, AMV_COUNTER: ns };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const call = async (path, body, tok) => { const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.9.0.1', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) }; };
const email = 'race@example.com';
const tok = (await call('/auth/signup', { email, name: 'Race', password: 'a sufficiently long password phrase' })).d.token;
await W.DB.put(env, 'ent', email, { plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
const id = (await call('/v1/agents/save', { name: 'Race Agent', browserKeep: true, browserSites: ['a.example.com', 'b.example.com', 'base.example.com'] }, tok)).d.agent.id;
const cookie = (domain, value) => ({ name: 'sid', value, domain, path: '/', secure: true, httpOnly: true });
const values = async () => Object.fromEntries((await W._agentJarLoad(env, email, await W._agentFind(env, email, id))).map(c => [String(c.domain).replace(/^\./, ''), c.value]));

section('Two runs saving at once both keep what they signed in to');
{
  const base = await W._agentFind(env, email, id);
  await W._agentJarLoad(env, email, base);
  await W._agentJarSave(env, email, base, [cookie('base.example.com', 'BASE')]);
  const a = await W._agentFind(env, email, id), b = await W._agentFind(env, email, id);
  await Promise.all([W._agentJarLoad(env, email, a), W._agentJarLoad(env, email, b)]);
  /* The copy from before either save, shown to both runs' first read. */
  stale = { copy: kv.get([...kv.keys()].find(k => k.startsWith('agentjar:'))), left: 2 };
  const res = await Promise.all([W._agentJarSave(env, email, a, [cookie('a.example.com', 'A-NEW')]), W._agentJarSave(env, email, b, [cookie('b.example.com', 'B-NEW')])]);
  stale = null;
  const v = await values();
  ok(v['a.example.com'] === 'A-NEW' && v['b.example.com'] === 'B-NEW' && v['base.example.com'] === 'BASE', 'every sign-in both runs kept is in the jar, and the one before them', v);
  ok(res[0].includes('a.example.com') && res[1].includes('b.example.com'), 'and each run is told what it kept, truthfully', res);
}

section('A copy here that never catches up decides nothing: the jar is read from the strong copy (Nov 8 verified audit R21)');
{
  const run = await W._agentFind(env, email, id);
  await W._agentJarLoad(env, email, run);
  stale = { copy: null, left: 100 };                    // this region still shows no jar at all
  const kept = await W._agentJarSave(env, email, run, [cookie('a.example.com', 'A-3')]);
  stale = null;
  const v = await values();
  ok(kept.includes('a.example.com'), 'the save is made, on the copy that is current', kept);
  ok(v['a.example.com'] === 'A-3' && v['b.example.com'] === 'B-NEW' && v['base.example.com'] === 'BASE', 'and every sign-in already there is still there', v);
}

console.log = quiet;
report();
done();
