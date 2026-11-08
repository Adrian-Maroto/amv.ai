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
  + '\nexport { DB, connSeal, connOpen, revokeUserTokens, _agentFind, _agentJarSave, _agentJarLoad, _agentJarForget, _agentJarForgetAll, _agentReadSites, runAgentJarCleanup, _agentDek, _agentJarOpen, _agentJarSeal, _withKind, _autoCostUSD, _autoRunMaxUSD, BROWSER_PAGE_USD, AGENT_READ_PAGES_MAX };\n');
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
  /* Nov 1 audit AGENT-012: more than money. */
  for (const [site, code] of [['accounts.google.com', 'identity_site'], ['login.microsoftonline.com', 'identity_site'], ['okta.com', 'identity_site'],
                              ['irs.gov', 'government_site'], ['www.tax.service.gov.uk', 'government_site'], ['impots.gouv.fr', 'government_site'],
                              ['mychart.example-clinic.org', 'health_site'], ['patient.portal.example.com', 'health_site']]) {
    const r = await call('/v1/agents/save', { id: AG, browserKeep: true, browserSites: ['tracker.example.com', site] }, tok);
    ok(r.status === 400 && r.d.code === code, site + ' is refused (' + code + ')', [r.status, r.d.code]);
  }
  for (const site of ['github.com', 'notion.so', 'epicgames.com', 'linear.app']) {
    const r = await call('/v1/agents/save', { id: AG, browserKeep: true, browserSites: [site] }, tok);
    ok(r.status === 200, site + ' is an ordinary site and allowed', [r.status, r.d.code]);
  }
  const none = await call('/v1/agents/save', { id: AG, browserKeep: true, browserSites: [] }, tok);
  ok(none.status === 400, 'keeping sign-ins with no site named is refused', none.status);
  const many = await call('/v1/agents/save', { id: AG, browserKeep: true, browserSites: Array.from({ length: 11 }, (_, i) => 's' + i + '.example.com') }, tok);
  ok(many.status === 400 && many.d.code === 'agent_sites', 'and more than ten sites', many.status);
  const set = await call('/v1/agents/save', { id: AG, browserKeep: true, browserSites: ['https://tracker.example.com/board', 'wiki.example.org'] }, tok);
  ok(set.status === 200 && set.d.agent.browser.keep && set.d.agent.browser.sites.join() === 'tracker.example.com,wiki.example.org',
     'two sites, kept as their plain names', set.d.agent && set.d.agent.browser);
}

/* A watched run begins by loading the agent's sign-ins (which reads the
   generation it runs under) and ends by keeping them - as the browser route
   does. */
const watched = async (a, cookies) => { await W._agentJarLoad(env, ME, a); return W._agentJarSave(env, ME, a, cookies); };

section('Kept from a watched run: only its sites, sealed');
{
  const kept = await watched(await agent(), [
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
  /* Nov 1 audit AGENT-013: the sign-in could not be put into the browser. */
  const realLaunch = BROWSER.launch;
  BROWSER.launch = async () => { const b = await realLaunch(); const np = b.newPage; b.newPage = async () => { const p = await np(); p.setCookie = async () => { throw new Error('cookie refused'); }; return p; }; return b; };
  calls.length = 0; audits.length = 0;
  const failed = await W._agentReadSites(env, ME, await agent(), 'Read https://tracker.example.com/board/42 please.');
  BROWSER.launch = realLaunch;
  ok(failed.length === 1 && !failed[0].text && /could not be put into the browser/.test(failed[0].error || ''), 'a sign-in that cannot be applied reads nothing, and says so for the page', failed);
  ok(!calls.some(c => c[0] === 'goto'), 'no page is opened signed out and read as though it were the real one', calls);
  ok(!audits.some(a => a.event === 'agent_signins_used') && audits.some(a => a.event === 'agent_signins_not_applied'), 'and it is recorded as not applied - never as used', audits.map(a => a.event));
  /* Nov 1 audit USAGE-004: the pages it opens are paid for from the same
     budget as the model, reserved before the run and charged after. */
  const none0 = { input: 0, output: 0, webSearches: 0 };
  ok(W._autoCostUSD(Object.assign({ browserPages: 2 }, none0), 'amv-core') === 2 * W.BROWSER_PAGE_USD && W.BROWSER_PAGE_USD > 0, 'each page opened is charged to the run', W._autoCostUSD(Object.assign({ browserPages: 2 }, none0), 'amv-core'));
  const withB = W._autoRunMaxUSD(false, false, 'amv-core', false, false, true), without = W._autoRunMaxUSD(false, false, 'amv-core', false, false, false);
  ok(Math.abs(withB - without - W.AGENT_READ_PAGES_MAX * W.BROWSER_PAGE_USD) < 1e-12, 'and the most it can open is reserved before it runs', [withB, without]);
}

section('Expires on its own: 30 days after a watched run refreshed it');
{
  const key = 'agentjar:' + ME + ':' + AG;
  const k = await W._agentDek(env, ME, AG, false);
  const rec = await W._agentJarOpen(k, ME, AG, kv.get(key));
  rec.sites['tracker.example.com'].at = Date.now() - 31 * 86400 * 1000;
  kv.set(key, await W._agentJarSeal(k, ME, AG, rec));
  const loaded = await W._agentJarLoad(env, ME, await agent());
  ok(loaded.length === 1 && /WIKI/.test(loaded[0].value), 'the stale site is no longer used; the fresh one is', loaded.map(c => c.domain));
}

section('Forgotten: one site, when switched off, with the agent, and on sign out everywhere');
{
  const f = await call('/v1/agents/signins/forget', { id: AG, site: 'wiki.example.org' }, tok);
  ok(f.status === 200 && !f.d.signIns.some(s => s.site === 'wiki.example.org'), 'one site forgotten from the card', f.d.signIns);
  await watched(await agent(), [cookie('tracker.example.com', 'TRACKER-SECRET-5')]);
  await call('/v1/agents/save', { id: AG, browserKeep: false, browserSites: [] }, tok);
  ok(!kv.has('agentjar:' + ME + ':' + AG), 'switching it off deletes what it held');
  await call('/v1/agents/save', { id: AG, browserKeep: true, browserSites: ['tracker.example.com'] }, tok);
  await watched(await agent(), [cookie('tracker.example.com', 'TRACKER-SECRET-6')]);
  const two = (await call('/v1/agents/save', { name: 'Second', browserKeep: true, browserSites: ['wiki.example.org'] }, tok)).d.agent;
  await watched(await W._agentFind(env, ME, two.id), [cookie('wiki.example.org', 'WIKI-SECRET-7')]);
  await call('/v1/agents/delete', { id: two.id }, tok);
  ok(!kv.has('agentjar:' + ME + ':' + two.id) && kv.has('agentjar:' + ME + ':' + AG), 'deleting an agent deletes its sign-ins, and only its own');
  await W.revokeUserTokens(env, ME);
  ok(![...kv.keys()].some(k => k.startsWith('agentjar:' + ME + ':')), '"sign out everywhere" forgets every agent’s sign-ins');
}

section('A forget that cannot delete says so, fences the sign-in, and finishes later (Nov 1 audit AGENT-008/009)');
{
  const tok3 = (await call('/auth/login', { email: ME, password: 'a long enough passphrase here' })).d.token;
  await call('/v1/agents/save', { id: AG, browserKeep: true, browserSites: ['tracker.example.com', 'wiki.example.org'] }, tok3);
  await watched(await agent(), [cookie('tracker.example.com', 'T-8'), cookie('wiki.example.org', 'W-8')]);
  const none = await call('/v1/agents/signins/forget', { id: AG, site: 'nothing.example.net' }, tok3);
  ok(none.status === 404 && none.d.code === 'not_held', 'forgetting a site it does not hold is not reported as done', none.d);
  /* The store refuses every write to the jar: the delete "succeeds" at the
     route only if somebody forgets to check. */
  const realPut = env.AMV_KV.put, realDel = env.AMV_KV.delete;
  const jarKey = 'agentjar:' + ME + ':' + AG;
  env.AMV_KV.put = async (k, v, o) => { if (k === jarKey) throw new Error('store down'); return realPut.call(env.AMV_KV, k, v, o); };
  env.AMV_KV.delete = async (k) => { if (k === jarKey) throw new Error('store down'); return realDel.call(env.AMV_KV, k); };
  await new Promise(r => setTimeout(r, 2));
  const f = await call('/v1/agents/signins/forget', { id: AG }, tok3);
  ok(f.status === 200 && f.d.removed === false && /can no longer be used/.test(f.d.note || ''), 'the answer says it is not gone yet, and that it can no longer be used', f.d);
  ok(kv.has(jarKey), 'the stored copy really is still there (the store refused)');
  ok((await W._agentJarLoad(env, ME, await agent())).length === 0, 'but it is fenced: nothing in it is ever used again', 0);
  ok(f.d.signIns.length === 0, 'and the card no longer lists it');
  ok(kv.has('agentjarpend:' + ME + ':' + AG), 'the deletion is queued for another try');
  env.AMV_KV.put = realPut; env.AMV_KV.delete = realDel;
  const c = await W.runAgentJarCleanup(env);
  ok(c.done === 1 && !kv.has(jarKey) && !kv.has('agentjarpend:' + ME + ':' + AG), 'the retry deletes it and clears the queue once the store answers', c);
  /* A new sign-in kept after the forget is not caught by the fence. */
  await new Promise(r => setTimeout(r, 2));
  await watched(await agent(), [cookie('tracker.example.com', 'T-9')]);
  ok((await W._agentJarLoad(env, ME, await agent())).some(x => x.value === 'T-9'), 'a sign-in kept afterwards works again');
  /* Deleting the agent while the store refuses: deleted, and honest about the rest. */
  env.AMV_KV.delete = async (k) => { if (k === jarKey) throw new Error('store down'); return realDel.call(env.AMV_KV, k); };
  const d = await call('/v1/agents/delete', { id: AG }, tok3);
  env.AMV_KV.delete = realDel;
  ok(d.d.signIns === 'pending' && d.d.ok === true, 'deleting the agent says its sign-ins are still being deleted', d.d);
  await W.runAgentJarCleanup(env);
  ok(!kv.has(jarKey), 'and they are, at the next retry');
}

section('Each agent seals with a key of its own, and forgetting destroys it (Nov 1 audit AGENT-010)');
{
  const t = (await call('/auth/login', { email: ME, password: 'a long enough passphrase here' })).d.token;
  const mk = async (name, site) => (await call('/v1/agents/save', { name, browserKeep: true, browserSites: [site] }, t)).d.agent;
  const A1 = await mk('Alpha', 'tracker.example.com'), B1 = await mk('Beta', 'tracker.example.com');
  await watched(await W._agentFind(env, ME, A1.id), [cookie('tracker.example.com', 'ALPHA-SECRET')]);
  await watched(await W._agentFind(env, ME, B1.id), [cookie('tracker.example.com', 'BETA-SECRET')]);
  const ra = await W._agentFind(env, ME, A1.id), rb = await W._agentFind(env, ME, B1.id);
  ok(ra.browser.dek && rb.browser.dek && ra.browser.dek !== rb.browser.dek, 'each agent has a key of its own', [!!ra.browser.dek, !!rb.browser.dek]);
  const jarA = kv.get('agentjar:' + ME + ':' + A1.id);
  let globalOpens = true; try { await W.connOpen(env, jarA); } catch (e) { globalOpens = false; }
  ok(!globalOpens, 'a jar is not sealed under the deployment key: that key alone opens no sign-in');
  const kb = await W._agentDek(env, ME, B1.id, false);
  ok(await W._agentJarOpen(kb, ME, B1.id, jarA) === null && await W._agentJarOpen(kb, ME, A1.id, jarA) === null, 'one agent’s key does not open another agent’s jar');
  /* A jar copied over another agent's: it does not open there, and nothing is used. */
  const jarB = kv.get('agentjar:' + ME + ':' + B1.id);
  kv.set('agentjar:' + ME + ':' + B1.id, jarA);
  ok((await W._agentJarLoad(env, ME, await W._agentFind(env, ME, B1.id))).length === 0, 'a jar moved under another agent’s name opens nothing there');
  kv.set('agentjar:' + ME + ':' + B1.id, jarB);
  /* A jar sealed the earlier way, under the deployment key: never opened. */
  kv.set('agentjar:' + ME + ':' + B1.id, await W.connSeal(env, { sites: { 'tracker.example.com': { at: Date.now(), cookies: [cookie('tracker.example.com', 'OLD-FORMAT')] } } }));
  ok((await W._agentJarLoad(env, ME, await W._agentFind(env, ME, B1.id))).length === 0, 'a jar in the earlier format is not opened - the next watched run signs in again');
  kv.set('agentjar:' + ME + ':' + B1.id, jarB);
  /* Editing an agent keeps its key and its fences. */
  await call('/v1/agents/signins/forget', { id: A1.id, site: 'tracker.example.com' }, t);
  await new Promise(r => setTimeout(r, 2));
  await watched(await W._agentFind(env, ME, A1.id), [cookie('tracker.example.com', 'ALPHA-2')]);
  const before = await W._agentFind(env, ME, A1.id);
  const ed = await call('/v1/agents/save', { id: A1.id, name: 'Alpha renamed', browserKeep: true, browserSites: ['tracker.example.com', 'wiki.example.org'] }, t);
  const after = await W._agentFind(env, ME, A1.id);
  ok(after.browser.dek === before.browser.dek && JSON.stringify(after.browser.revokedSites) === JSON.stringify(before.browser.revokedSites) && after.browser.revokedSites,
     'changing an agent’s sites keeps its key and the fence on what it forgot', { dek: after.browser.dek === before.browser.dek, revoked: after.browser.revokedSites });
  ok((await W._agentJarLoad(env, ME, after)).some(c => c.value === 'ALPHA-2'), 'and what it holds still opens');
  const list = await call('/v1/agents', undefined, t);
  const exp = await call('/v1/account/export', undefined, t);
  const shown = JSON.stringify(ed.d) + JSON.stringify(list.d) + JSON.stringify(exp.d);
  ok(!shown.includes(before.browser.dek) && !/"dek"|revokedSites|revokedAt/.test(shown), 'no agent key or fence is ever sent to the page, in a list, a save or an export', shown.length);
  ok(exp.d.withheld && exp.d.withheld.agentkeys, 'the export says the keys exist and are withheld', exp.d.withheld);
  /* Changing CONNECT_KEY (the old one kept as CONNECT_KEY_PREV): sign-ins still open. */
  const savedKey = env.CONNECT_KEY; env.CONNECT_KEY_PREV = savedKey; env.CONNECT_KEY = 'd'.repeat(44);
  ok((await W._agentJarLoad(env, ME, await W._agentFind(env, ME, A1.id))).some(c => c.value === 'ALPHA-2'), 'a new deployment key, the old one kept for opening: every sign-in still opens');
  env.CONNECT_KEY = savedKey; delete env.CONNECT_KEY_PREV;
  /* Forgetting every sign-in destroys the key: a stale copy of the jar, read
     from anywhere, opens to nothing even with the fence taken away. */
  const stale = kv.get('agentjar:' + ME + ':' + A1.id);
  const f = await call('/v1/agents/signins/forget', { id: A1.id }, t);
  const gone = await W._agentFind(env, ME, A1.id);
  ok(f.status === 200 && !gone.browser.dek, 'forgetting all of an agent’s sign-ins destroys its key', f.d);
  kv.set('agentjar:' + ME + ':' + A1.id, stale);
  await W._withKind(env, 'agents', ME, (rec) => { const a = rec.list.find(x => x.id === A1.id); delete a.browser.revokedAt; delete a.browser.revokedSites; }, { list: [] });
  ok((await W._agentJarLoad(env, ME, await W._agentFind(env, ME, A1.id))).length === 0, 'a copy that outlived the delete opens to nothing, even without the fence');
  kv.delete('agentjar:' + ME + ':' + A1.id);
  await W.revokeUserTokens(env, ME);
  ok(!(await W._agentFind(env, ME, B1.id)).browser.dek, '"sign out everywhere" destroys every agent’s key');
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

section('Unknown is not absent, and a forget during a run is not undone by it (Nov 3 audit)');
{
  const tok4 = (await call('/auth/login', { email: ME, password: 'a long enough passphrase here' })).d.token;
  const G = (await call('/v1/agents/save', { name: 'Gamma', browserKeep: true, browserSites: ['tracker.example.com', 'wiki.example.org'] }, tok4)).d.agent.id;
  const ag = () => W._agentFind(env, ME, G);
  await watched(await ag(), [cookie('tracker.example.com', 'T-10')]);
  const jarKey = 'agentjar:' + ME + ':' + G;

  /* AGENT-019: the store cannot be read. The audit's proof got
     {held:false, removed:true} here - "nothing to forget" while it stayed. */
  const realGet = env.AMV_KV.get;
  env.AMV_KV.get = async (k) => { if (k === jarKey) throw new Error('regional storage outage'); return realGet.call(env.AMV_KV, k); };
  const r = await W._agentJarForget(env, ME, G, '');
  ok(r.held === 'unknown' && r.removed === false, 'an unreadable store is "unknown", never "nothing held, removed"', r);
  const viaRoute = await call('/v1/agents/signins/forget', { id: G }, tok4);
  ok(viaRoute.status === 200 && viaRoute.d.removed === false, 'and the person is told it is not gone yet - not that there was nothing', [viaRoute.status, viaRoute.d.code]);
  env.AMV_KV.get = realGet;
  ok(kv.has(jarKey) && (await W._agentJarLoad(env, ME, await ag())).length === 0, 'the copy that could not be read is fenced: nothing in it is used');
  ok(kv.has('agentjarpend:' + ME + ':' + G), 'and its deletion is queued');
  await W.runAgentJarCleanup(env);
  ok(!kv.has(jarKey), 'the retry removes it once the store answers');

  /* AGENT-020: a watched run began, the person forgot the sign-in, then the
     run finished and tried to keep its cookies. */
  await watched(await ag(), [cookie('tracker.example.com', 'T-11')]);
  const run = await ag();
  await W._agentJarLoad(env, ME, run);                 // the run begins
  const f = await call('/v1/agents/signins/forget', { id: G }, tok4);
  ok(f.status === 200, 'forgotten while the run was going', f.status);
  await new Promise(res => setTimeout(res, 3));
  const kept = await W._agentJarSave(env, ME, run, [cookie('tracker.example.com', 'T-RESURRECTED')]);
  ok(kept.length === 0, 'the run that began before the forget keeps nothing when it ends', kept);
  ok(!(await W._agentJarLoad(env, ME, await ag())).some(c => c.value === 'T-RESURRECTED'), 'so the forgotten sign-in is not brought back');

  /* One site forgotten mid-run: only that site is refused. */
  await watched(await ag(), [cookie('tracker.example.com', 'T-12'), cookie('wiki.example.org', 'W-12')]);
  const run2 = await ag();
  await W._agentJarLoad(env, ME, run2);
  await call('/v1/agents/signins/forget', { id: G, site: 'wiki.example.org' }, tok4);
  const kept2 = await W._agentJarSave(env, ME, run2, [cookie('tracker.example.com', 'T-13'), cookie('wiki.example.org', 'W-13')]);
  ok(kept2.join() === 'tracker.example.com', 'a site forgotten during the run is not kept; the others are', kept2);

  /* A stale copy of the agent record (the revocation stamp not yet seen in
     this region) does not make a forgotten sign-in usable: the generation
     is read from the strong object, not from the record. */
  await watched(await ag(), [cookie('tracker.example.com', 'T-20'), cookie('wiki.example.org', 'W-20')]);
  const copy = kv.get(jarKey);
  await call('/v1/agents/signins/forget', { id: G, site: 'wiki.example.org' }, tok4);
  const settled = kv.get(jarKey);
  kv.set(jarKey, copy);                                  // a copy that outlived the delete
  const stale = JSON.parse(JSON.stringify(await ag()));
  delete stale.browser.revokedAt; delete stale.browser.revokedSites;   // and a record that has not seen the stamp
  const used = (await W._agentJarLoad(env, ME, stale)).map(c => c.value);
  ok(used.includes('T-20') && !used.includes('W-20'), 'a stale record without the stamp still uses nothing forgotten - the generation decides', used);

  /* Nov 8 audit: a save does not merge into a copy older than the one last
     written - it waits for the region to catch up, and says not kept if it
     has not. Once the copy has settled the save goes ahead. */
  ok((await watched(await ag(), [cookie('tracker.example.com', 'T-21')])).length === 0
     && audits.some(a => a.event === 'agent_signins_not_kept' && a.why === 'jar_settling'), 'a save over a copy older than the last write is not made, and says why');
  kv.set(jarKey, settled);
  /* The generation cannot be read: nothing is used, nothing is kept. */
  await watched(await ag(), [cookie('tracker.example.com', 'T-21')]);
  ok((await W._agentJarLoad(env, ME, await ag())).some(c => c.value === 'T-21'), 'a usable sign-in is in place');
  const realCounter = env.AMV_COUNTER;
  env.AMV_COUNTER = { idFromName: n => n, get: () => ({ async fetch() { throw new Error('object unreachable'); } }) };
  ok((await W._agentJarLoad(env, ME, await ag())).length === 0, 'with the generation unreadable no sign-in is used');
  let threw = false; try { await W._agentJarForget(env, ME, G, ''); } catch (e) { threw = true; }
  ok(threw, 'and a forget that cannot move the generation does not claim success');
  env.AMV_COUNTER = realCounter;

  /* AGENT-021: the listing fails during "forget everything". */
  const realList = env.AMV_KV.list;
  env.AMV_KV.list = async () => { throw new Error('list unavailable'); };
  const all = await W._agentJarForgetAll(env, ME);
  ok(all.removed === false && all.listed === false, 'forget-all whose listing failed does not say everything was removed', all);
  ok(kv.has('agentjarpend:' + ME + ':*'), 'and queues the whole forget to run again');
  env.AMV_KV.list = realList;
  await W.runAgentJarCleanup(env);
  ok(!kv.has('agentjarpend:' + ME + ':*') && ![...kv.keys()].some(k => k.startsWith('agentjar:' + ME + ':')), 'which removes everything once the store answers');
}

section('What is stored is read before it is replaced; a forget mid-save wins; unknown is shown as unknown (Nov 7 audit AGENT-022/023/024)');
{
  const t = (await call('/auth/login', { email: ME, password: 'a long enough passphrase here' })).d.token;
  const mk = await call('/v1/agents/save', { name: 'Tracker reader', role: 'Reads the tracker' }, t);
  const AG2 = mk.d.agent && mk.d.agent.id;
  const agent = () => W._agentFind(env, ME, AG2);
  await call('/v1/agents/save', { id: AG2, browserKeep: true, browserSites: ['tracker.example.com', 'wiki.example.org'] }, t);
  await new Promise(r => setTimeout(r, 2));
  await watched(await agent(), [cookie('tracker.example.com', 'T-20'), cookie('wiki.example.org', 'W-20')]);
  const jarKey = 'agentjar:' + ME + ':' + AG2;
  const realGet = env.AMV_KV.get, realPut = env.AMV_KV.put;

  /* The jar cannot be read: saving the wiki must not wipe the tracker. */
  const a1 = await agent(); await W._agentJarLoad(env, ME, a1);
  env.AMV_KV.get = async (k, ...x) => { if (k === jarKey) throw new Error('store down'); return realGet.call(env.AMV_KV, k, ...x); };
  const kept = await W._agentJarSave(env, ME, a1, [cookie('wiki.example.org', 'W-21')]);
  ok(kept.length === 0, 'with the jar unreadable, nothing is saved', kept);

  /* And the list says it could not be checked, keeping Forget - not "not signed in yet". */
  const listed = await call('/v1/agents', undefined, t);
  const mine = (listed.d.agents || []).find(x => x.id === AG2) || {};
  ok(mine.signInsUnknown === true && mine.signIns === null, 'the card is told the sign-ins could not be checked, not that there are none', { u: mine.signInsUnknown, s: mine.signIns });
  env.AMV_KV.get = realGet;
  const load = await W._agentJarLoad(env, ME, await agent());
  ok(load.some(c => c.value === 'T-20') && load.some(c => c.value === 'W-20'), 'and once it can be read, both sign-ins are still there', load.map(c => c.value));

  /* A forget lands between the save's check and its write. */
  const a2 = await agent(); await W._agentJarLoad(env, ME, a2);
  let once = true;
  env.AMV_KV.put = async (k, v, o) => {
    if (k === jarKey && once) { once = false; await call('/v1/agents/signins/forget', { id: AG2 }, t); }
    return realPut.call(env.AMV_KV, k, v, o);
  };
  const raced = await W._agentJarSave(env, ME, a2, [cookie('tracker.example.com', 'T-22')]);
  env.AMV_KV.put = realPut;
  ok(raced.length === 0 && !kv.has(jarKey), 'the forget wins: the save says it kept nothing, and nothing is left stored', { raced, stored: kv.has(jarKey) });
}

console.log = origLog;
if (report('an-agent-keeps-a-sign-in-only-where-it-may') > 0) process.exitCode = 1;
done();
