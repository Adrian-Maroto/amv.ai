/* A TEAM CHOOSES ITS ENGINES - AND THE SERVER HOLDS THE LINE.

   A company decides which AMV engines its people may use. Driven through the
   Worker's own routes with the model provider stood in for:

   - with no policy, a member uses every engine the team's plan includes;
   - the owner allows one extra engine: the member is refused another with
     code team_policy, before the model is called, and the refusal names the
     engine; the allowed one and the always-on base engines still answer;
   - Auto never routes a member to an engine the team turned off;
   - a member cannot change the policy; an unknown engine name is refused
     rather than stored;
   - the change is in the team's activity log, and the member's entitlement
     carries the list so the app can say it before a send does;
   - removing the policy gives everything back. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'team-engines.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());

const sse = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n'
  + 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n'
  + 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n'
  + 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
let modelCalls = 0;
globalThis.fetch = async (url) => {
  if (!/model\.example/.test(String(url))) return new Response('{}', { status: 200 });
  modelCalls++;
  return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

const m = new Map(), vals = new Map();
const env = {
  AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example', JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
  GLOBAL_DAILY_USD_CAP: '100000',
  AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
    async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body || '{}'); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { vals.set(n, cur + Number(b.amount || 0)); return r({ allowed: true, value: vals.get(n) }); }
    if (b.op === 'incr') { vals.set(n, cur + Number(b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur, count: 1 });
  } }) },
};
const waits = [];
const ctx = { waitUntil(p) { waits.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} };
const settle = async () => { await Promise.all(waits.splice(0)); };
let ip = 1;
const call = (path, body, tok, method) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: method || 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.' + (ip++ % 200 + 1), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: method === 'GET' ? undefined : JSON.stringify(body) }), env, ctx);
async function account(email, plan) {
  const tok = (await (await call('/auth/signup', { email, name: 'T', password: 'A-real-Passw0rd!' })).json()).token;
  if (plan !== 'free') await W.DB.put(env, 'ent', email, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
const ask = async (tok, model, text) => {
  const before = modelCalls;
  const r = await call('/v1/messages', { model, max_tokens: 1000, messages: [{ role: 'user', content: text || 'hi' }] }, tok);
  const body = await r.text(); await settle();
  let d = {}; try { d = JSON.parse(body); } catch (e) {}
  return { status: r.status, engine: r.headers.get('X-AMV-Engine'), d, called: modelCalls - before };
};
const policy = async (tok, engines) => { const r = await call('/team/policy', { engines }, tok); return { status: r.status, d: await r.json() }; };

const owner = await account('owner-te@example.com', 'elite');
const member = await account('member-te@example.com', 'free');
const made = await (await call('/team/create', { name: 'Acme' }, owner)).json();
ok(made.ok, 'the owner creates a team', made);
const inv = await (await call('/team/invite', { email: 'member-te@example.com', role: 'member' }, owner)).json();
const joined = await (await call('/team/join', { token: inv.inviteToken }, member)).json();
ok(joined.ok, 'the member joins it', joined);

section('No policy: a member uses what the team’s plan includes');
{
  const r = await ask(member, 'amv-forge');
  ok(r.status === 200 && r.engine === 'amv-forge', 'Forge answers', r.status);
}

section('The owner allows Swift: Forge is refused before anything is spent, and says why');
{
  const set = await policy(owner, ['amv-swift']);
  ok(set.status === 200 && JSON.stringify(set.d.engines) === JSON.stringify(['amv-pulse', 'amv-core', 'amv-swift']),
     'the policy is saved, with the base engines always on', set.d);
  const r = await ask(member, 'amv-forge');
  ok(r.status === 403 && r.d.code === 'team_policy' && r.called === 0, 'Forge is refused with team_policy and the model is never called', r);
  ok(/AMV Forge/.test(r.d.error || '') && /owner or an admin/.test(r.d.error || ''), 'the refusal names the engine and who can change it', r.d.error);
  const s = await ask(member, 'amv-swift');
  ok(s.status === 200 && s.engine === 'amv-swift', 'Swift, which was allowed, answers', s.status);
  const c = await ask(member, 'amv-core');
  ok(c.status === 200 && c.engine === 'amv-core', 'Core, always on, answers', c.status);
  const o = await ask(owner, 'amv-apex');
  ok(o.status === 403 && o.d.code === 'team_policy', 'the rule binds the owner too - it is the team’s rule', o.status);
}

section('Auto never routes to an engine the team turned off');
{
  const r = await ask(member, 'auto', 'Refactor this function and fix the race condition:\n```js\nasync function f(){ await a(); b(); }\n```');
  ok(r.status === 200 && r.engine === 'amv-core', 'a hard coding question routes to Core, not Forge', r.engine);
}

section('Only the owner or an admin can change it, and only to engines that exist');
{
  const byMember = await policy(member, null);
  ok(byMember.status === 403, 'a member is refused', byMember);
  const typo = await policy(owner, ['amv-froge']);
  ok(typo.status === 400 && typo.d.code === 'unknown_engine', 'an unknown engine is refused, not stored', typo.d);
  const still = await ask(member, 'amv-forge');
  ok(still.status === 403, 'and the policy that was there is unchanged', still.status);
}

section('It is in the activity log, and the member’s app is told');
{
  const log = (await (await call('/team/audit', {}, owner)).json()).log || [];
  const e = log.find(x => x.action === 'engines_changed');
  ok(e && e.actor === 'owner-te@example.com' && /amv-swift/.test(e.engines) && e.before === 'all', 'the log says who changed it, from what, to what', e);
  const ent = await (await call('/v1/entitlement', null, member, 'GET')).json();
  ok(Array.isArray(ent.teamEngines) && ent.teamEngines.includes('amv-swift') && !ent.teamEngines.includes('amv-forge'), 'the entitlement carries the list', ent.teamEngines);
}

section('Removing the policy gives everything back');
{
  const set = await policy(owner, null);
  ok(set.status === 200 && set.d.engines === null, 'the policy is removed', set.d);
  const r = await ask(member, 'amv-forge');
  ok(r.status === 200 && r.engine === 'amv-forge', 'Forge answers again', r.status);
  const ent = await (await call('/v1/entitlement', null, member, 'GET')).json();
  ok(ent.teamEngines === null, 'and the entitlement says there is no limit', ent.teamEngines);
}

if (report('a-team-chooses-its-engines') > 0) process.exitCode = 1;
done();
