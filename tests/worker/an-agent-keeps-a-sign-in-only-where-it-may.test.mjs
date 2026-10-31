/* AN AGENT KEEPS A SIGN-IN ONLY WHERE IT MAY.

   Owner decision #46 (Oct 31), docs/AGENT-SIGN-INS.md. An agent may hold the
   person's sign-in for a few sites so its background work can read them while
   every device is off. That is a store of other services' credentials, so
   each rule the design names is held here:
     - opt-in, listed sites only, never a site that moves money;
     - sealed (the stored record never carries a cookie in the clear);
     - each site's sign-in expires 30 days after it was last refreshed;
     - used unattended only to READ the listed pages a job names - the
       browser is given cookies, opened and read, and nothing else;
     - forgotten per site, when switched off, when the agent is deleted, and
       on "sign out everywhere". */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'agentjar.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { DB, connSeal, connOpen, revokeUserTokens, _agentFind, _agentJarSave, _agentJarLoad, _agentReadSites };\n');
const W = await import(harness + '?t=' + Date.now());

const kv = new Map(); const vals = new Map(); const audits = [];
const origLog = console.log; console.log = (...a) => { const s = a.join(' '); if (s.startsWith('AUDIT')) { try { audits.push(JSON.parse(s.slice(6))); } catch (e) {} return; } origLog(...a); };
/* The hosted browser, standing in: it records every call, and has no click,
   type or submit at all - a run that reached for one would throw. */
const calls = [];
const BROWSER = { launch: async () => ({
  newPage: async () => ({
    setCookie: async (...c) => { calls.push(['setCookie', c.map(x => x.domain)]); },
    goto: async (u) => { calls.push(['goto', u]); },
    evaluate: async () => { const last = [...calls].reverse().find(c => c[0] === 'goto'); return 'Inbox for the person at ' + (last ? last[1] : '?'); },
  }),
  close: async () => { calls.push(['close']); },
}) };
const env = {
  JWT_SECRET: 'j'.repeat(48), APP_URL: 'https://amv.test', CONNECT_KEY: 'c'.repeat(44), BROWSER,
  AMV_KV: { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, String(v)); }, async delete(k) { kv.delete(k); },
    async list({ prefix } = {}) { return { keys: [...kv.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: withAuthOps({ idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = o => new Response(JSON.stringify(o));
    if (b.op === 'claim') return r({ claimed: true });
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur, count: 1 });
  } }) }),
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
let ip = 1;
const call = async (path, body, tok) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.8.0.' + (ip++ % 200 + 1) }, tok ? { Authorization: 'Bearer ' + tok } : {}),
    body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const ME = 'lena@example.com';
const tok = (await call('/auth/signup', { email: ME, name: 'Lena', password: 'a long enough passphrase here' })).d.token;
await W.DB.put(env, 'ent', ME, { plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
const made = await call('/v1/agents/save', { name: 'Inbox reader', role: 'Reads my project tracker' }, tok);
const AG = made.d.agent && made.d.agent.id;
const agent = () => W._agentFind(env, ME, AG);
const cookie = (domain, value) => ({ name: 'sid', value, domain, path: '/', secure: true, httpOnly: true });

section('Opt-in, listed sites only, never a site that moves money');
{
  ok(!!AG && made.d.agent.browser.keep === false, 'a new agent keeps no sign-in', made.d.agent);
  for (const bank of ['chase.com', 'www.paypal.com', 'online.mybank.co.uk', 'coinbase.com']) {
    const r = await call('/v1/agents/save', { id: AG, browserKeep: true, browserSites: ['tracker.example.com', bank] }, tok);
    ok(r.status === 400 && r.d.code === 'money_site', bank + ' is refused - it moves money', [r.status, r.d.code]);
  }
  const none = await call('/v1/agents/save', { id: AG, browserKeep: true, browserSites: [] }, tok);
  ok(none.status === 400, 'keeping sign-ins with no site named is refused', none.status);
  const many = await call('/v1/agents/save', { id: AG, browserKeep: true, browserSites: Array.from({ length: 11 }, (_, i) => 's' + i + '.example.com') }, tok);
  ok(many.status === 400 && many.d.code === 'agent_sites', 'and more than ten sites', many.status);
  const set = await call('/v1/agents/save', { id: AG, browserKeep: true, browserSites: ['https://tracker.example.com/board', 'wiki.example.org'] }, tok);
  ok(set.status === 200 && set.d.agent.browser.keep && set.d.agent.browser.sites.join() === 'tracker.example.com,wiki.example.org',
     'two sites, kept as their plain names', set.d.agent && set.d.agent.browser);
}

section('Kept from a watched run: only its sites, sealed');
{
  const kept = await W._agentJarSave(env, ME, await agent(), [
    cookie('tracker.example.com', 'TRACKER-SECRET-1'), cookie('.wiki.example.org', 'WIKI-SECRET-2'),
    cookie('other.example.net', 'OTHER-SECRET-3'), cookie('chase.com', 'BANK-SECRET-4')]);
  ok(kept.sort().join() === 'tracker.example.com,wiki.example.org', 'the cookies of its two sites are kept, nothing else', kept);
  const raw = kv.get('agentjar:' + ME + ':' + AG) || '';
  ok(raw && !/SECRET/.test(raw) && !/tracker\.example\.com/.test(raw), 'the stored record is sealed: no cookie, no site name in the clear', raw.slice(0, 60));
  const loaded = await W._agentJarLoad(env, ME, await agent());
  ok(loaded.length === 2 && loaded.every(c => /TRACKER|WIKI/.test(c.value)), 'and opens back to exactly those two', loaded.map(c => c.domain));
  const list = await call('/v1/agents', undefined, tok);
  const a = (list.d.agents || []).find(x => x.id === AG);
  ok(a && a.signIns.length === 2 && !JSON.stringify(a).includes('SECRET'), 'the list shows which sites and until when - never a cookie', a && a.signIns);
}

section('Read unattended: only the listed pages its job names, and nothing but reading');
{
  calls.length = 0; audits.length = 0;
  const pages = await W._agentReadSites(env, ME, await agent(),
    'Every morning read https://tracker.example.com/board/42 and https://other.example.net/x and https://chase.com/accounts then summarise.');
  ok(pages.length === 1 && pages[0].url === 'https://tracker.example.com/board/42' && /Inbox for the person/.test(pages[0].text),
     'only the page on its own site is opened and read', pages.map(p => p.url));
  const kinds = [...new Set(calls.map(c => c[0]))].sort().join();
  ok(kinds === 'close,goto,setCookie', 'the browser was given cookies, opened, read and closed - nothing clicked, typed or sent', kinds);
  ok(calls.filter(c => c[0] === 'goto').every(c => /tracker\.example\.com/.test(c[1])), 'no other site was ever visited', calls);
  ok(audits.some(a => a.event === 'agent_signins_used' && a.agent === AG) && !JSON.stringify(audits).includes('SECRET'), 'the use is on the record, with no cookie in it', audits.map(a => a.event));
  const none = await W._agentReadSites(env, ME, await agent(), 'Summarise the news.');
  ok(none.length === 0, 'a job that names none of its pages opens nothing', none.length);
}

section('Expires on its own: 30 days after a watched run refreshed it');
{
  const key = 'agentjar:' + ME + ':' + AG;
  const rec = await W.connOpen(env, kv.get(key));
  rec.sites['tracker.example.com'].at = Date.now() - 31 * 86400 * 1000;
  kv.set(key, await W.connSeal(env, rec));
  const loaded = await W._agentJarLoad(env, ME, await agent());
  ok(loaded.length === 1 && /WIKI/.test(loaded[0].value), 'the stale site is no longer used; the fresh one is', loaded.map(c => c.domain));
}

section('Forgotten: one site, when switched off, with the agent, and on sign out everywhere');
{
  const f = await call('/v1/agents/signins/forget', { id: AG, site: 'wiki.example.org' }, tok);
  ok(f.status === 200 && !f.d.signIns.some(s => s.site === 'wiki.example.org'), 'one site forgotten from the card', f.d.signIns);
  await W._agentJarSave(env, ME, await agent(), [cookie('tracker.example.com', 'TRACKER-SECRET-5')]);
  await call('/v1/agents/save', { id: AG, browserKeep: false, browserSites: [] }, tok);
  ok(!kv.has('agentjar:' + ME + ':' + AG), 'switching it off deletes what it held');
  await call('/v1/agents/save', { id: AG, browserKeep: true, browserSites: ['tracker.example.com'] }, tok);
  await W._agentJarSave(env, ME, await agent(), [cookie('tracker.example.com', 'TRACKER-SECRET-6')]);
  const two = (await call('/v1/agents/save', { name: 'Second', browserKeep: true, browserSites: ['wiki.example.org'] }, tok)).d.agent;
  await W._agentJarSave(env, ME, await W._agentFind(env, ME, two.id), [cookie('wiki.example.org', 'WIKI-SECRET-7')]);
  await call('/v1/agents/delete', { id: two.id }, tok);
  ok(!kv.has('agentjar:' + ME + ':' + two.id) && kv.has('agentjar:' + ME + ':' + AG), 'deleting an agent deletes its sign-ins, and only its own');
  await W.revokeUserTokens(env, ME);
  ok(![...kv.keys()].some(k => k.startsWith('agentjar:' + ME + ':')), '"sign out everywhere" forgets every agent’s sign-ins');
}

section('No key to seal with: no sign-in is kept');
{
  /* Signed in again: "sign out everywhere" above ended the session. */
  const tok2 = (await call('/auth/login', { email: ME, password: 'a long enough passphrase here' })).d.token;
  const saved = env.CONNECT_KEY; delete env.CONNECT_KEY;
  const r = await call('/v1/agents/save', { id: AG, browserKeep: true, browserSites: ['tracker.example.com'] }, tok2);
  ok(r.status === 503 && r.d.code === 'needs_service', 'refused, and says why', [r.status, r.d.code]);
  env.CONNECT_KEY = saved;
}

console.log = origLog;
if (report('an-agent-keeps-a-sign-in-only-where-it-may') > 0) process.exitCode = 1;
done();
