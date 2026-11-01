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
import { withAuthOps } from '../lib/auth-object.mjs';

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
  AMV_COUNTER: withAuthOps({ idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body || '{}'); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { vals.set(n, cur + Number(b.amount || 0)); return r({ allowed: true, value: vals.get(n) }); }
    if (b.op === 'incr') { vals.set(n, cur + Number(b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur, count: 1 });
  } }) }),
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

section('The same policy carries the team\u2019s rules for its members\u2019 computers');
{
  const rules = (r) => call('/team/policy', { agentRules: r }, owner).then(async x => ({ status: x.status, d: await x.json() }));
  await policy(owner, ['amv-swift']);
  const set = await rules({ block: ['terraform apply', ' terraform apply '], ask: ['git commit'], protect: ['secrets/*'], afterWrite: 'npm run lint', onFinish: 'npm test' });
  ok(set.status === 200 && set.d.agentRules.block.join() === 'terraform apply' && set.d.agentRules.onFinish === 'npm test', 'the owner saves them, trimmed and without repeats', set.d);
  const team = (await (await call('/team/get', {}, member)).json()).team;
  ok(team.policy.agentRules.protect.join() === 'secrets/*', 'every member\u2019s app is given them', team.policy.agentRules);
  ok(JSON.stringify(team.policy.engines) === JSON.stringify(['amv-swift']), 'and saving the rules left the engines as they were', team.policy.engines);
  await policy(owner, ['amv-swift', 'amv-forge']);
  const after = (await (await call('/team/get', {}, member)).json()).team;
  ok(after.policy.agentRules && after.policy.agentRules.onFinish === 'npm test', 'and saving the engines leaves the rules as they were', after.policy.agentRules);
  const byMember = await call('/team/policy', { agentRules: { block: [] } }, member);
  ok(byMember.status === 403, 'a member cannot change them', byMember.status);
  const two = await rules({ afterWrite: 'npm test\nrm -rf ~' });
  ok(two.status === 400, 'a check with a second line hidden in it is refused', two.d);
  const many = await rules({ block: Array.from({ length: 51 }, (_, i) => 'cmd' + i) });
  ok(many.status === 400, 'and so are more than fifty rules', many.status);
  const log = (await (await call('/team/audit', {}, owner)).json()).log || [];
  ok(log.some(x => x.action === 'agent_rules_changed' && x.actor === 'owner-te@example.com'), 'the change is in the activity log', log.map(x => x.action));
  await policy(owner, null);
}

section('A team can refuse to send credentials and card numbers to AMV - on the server');
{
  const dlp = (v, tok) => call('/team/policy', { dlp: v }, tok || owner).then(async x => ({ status: x.status, d: await x.json() }));
  const KEY = 'AKIA' + 'Q7ZK3M2LXPRT4VWN';
  const CARD = '4111 1111 1111 1111';
  const before = await ask(member, 'amv-core', 'deploy with ' + KEY);
  ok(before.status === 200, 'with no rule, nothing is refused', before.status);
  ok((await dlp('block', member)).status === 403, 'a member cannot turn it on');
  ok((await dlp('maybe')).status === 400, 'a rule that is not "block" or off is refused');
  const on = await dlp('block');
  ok(on.status === 200 && on.d.dlp === 'block', 'the owner turns it on', on.d);
  const key = await ask(member, 'amv-core', 'deploy with ' + KEY);
  ok(key.status === 422 && key.d.code === 'dlp_blocked' && key.d.found === 'a cloud access key' && key.called === 0, 'a cloud key is refused before the model is called, naming the kind', key.d);
  ok(!JSON.stringify(key.d).includes(KEY), 'and the key itself is not repeated back');
  const card = await ask(member, 'amv-core', 'charge ' + CARD + ' exp 04/28');
  ok(card.status === 422 && card.d.found === 'a payment card number', 'a card number is refused', card.d);
  const notCard = await ask(member, 'amv-core', 'order number 1234 5678 9012 3456 shipped');
  ok(notCard.status === 200, 'a long number that is not a card is not', notCard.status);
  const plain = await ask(member, 'amv-core', 'summarise the meeting notes');
  ok(plain.status === 200, 'an ordinary message is untouched', plain.status);
  const log = (await (await call('/team/audit', {}, owner)).json()).log || [];
  ok(log.some(x => x.action === 'data_rule_changed'), 'the change is in the activity log', log.map(x => x.action));
  const team = (await (await call('/team/get', {}, member)).json()).team;
  ok(team.policy.dlp === 'block' && team.policy.agentRules, 'and setting it left the other rules as they were', team.policy);
  await dlp(null);
  ok((await ask(member, 'amv-core', 'deploy with ' + KEY)).status === 200, 'off again, it sends');
}

if (report('a-team-chooses-its-engines') > 0) process.exitCode = 1;
done();
