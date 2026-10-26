/* AN AGENT WORKS WITHIN WHAT IT WAS GIVEN.

   Oct 26 audit: "first-class persistent named Agents". An agent is a name,
   instructions, a monthly budget and a switch over ordinary background jobs
   (77-agents.js). What has to be true, run against the Worker:
     - only an account whose plan runs background work can make one, and only
       ten; nothing credential-shaped is stored in its instructions;
     - a job can be given to one of the caller's own agents, never to another
       account's or to one that does not exist;
     - the agent's instructions reach the run, after AMV's own rules;
     - a paused agent's jobs do not run and nothing is spent; resumed, they do;
     - an agent over its own monthly budget does not run, and says why; what a
       run costs is counted against the agent;
     - deleting an agent stops its jobs and keeps what they produced;
     - an API key cannot hire or fire. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'agents.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { runDueAutomations, issueTokens, _agentCostKey };
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'ada@test.com', OTHER = 'ben@test.com';
const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  AMV_MODEL_KEY: 'k', AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k, v){ store.set(k, v); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
const ctx = { waitUntil(){}, passThroughOnException(){} };

store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
store.set('ent:' + OTHER, JSON.stringify({ plan: 'ultra' }));
const mine = await W.issueTokens(env, ME, 'Ada');
const theirs = await W.issueTokens(env, OTHER, 'Ben');
let ip = 1;
const call = async (path, body, token = mine.token, method = 'POST') => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.8.' + (ip++) },
    ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const rec = () => JSON.parse(store.get('auto:' + ME) || '{"items":[],"results":[]}');
const put = (r) => store.set('auto:' + ME, JSON.stringify(r));

let modelCalls = 0, lastSystem = '', systems = [];
globalThis.fetch = async (u, init) => {
  modelCalls++;
  try { const b = JSON.parse(String((init && init.body) || '{}')); lastSystem = typeof b.system === 'string' ? b.system : JSON.stringify(b.system || ''); systems.push(lastSystem); } catch (e) {}
  return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Three things changed in solar policy this week.' }], stop_reason: 'end_turn',
    usage: { input_tokens: 2000, output_tokens: 800 } }), { status: 200 });
};

let agentId = '';
section('Made by an account that runs background work, read back as stored');
{
  const r = await call('/v1/agents/save', { name: 'Solar scout', role: 'Reads solar energy news', instructions: 'Always lead with policy changes in Spain.', budgetUSD: 5 });
  ok(r.status === 200 && r.d.agent && r.d.agent.id, 'an agent is created', r.status + ' ' + JSON.stringify(r.d).slice(0, 160));
  agentId = r.d.agent && r.d.agent.id;
  ok(r.d.agent && r.d.agent.budgetUSD === 5 && r.d.agent.paused === false, 'with its budget, not paused', r.d.agent);
  const l = await call('/v1/agents', null, mine.token, 'GET');
  ok(l.status === 200 && l.d.agents.length === 1 && l.d.agents[0].name === 'Solar scout', 'and it is listed', l.status + ' ' + JSON.stringify(l.d).slice(0, 160));
  ok(l.d.allowed === true && l.d.max === 10, 'the list says it may have up to ten', l.d);

  const empty = await call('/v1/agents/save', { name: '   ' });
  ok(empty.status === 400 && empty.d.code === 'agent_name', 'a nameless agent is refused', empty.status + ' ' + empty.d.code);
  const secret = await call('/v1/agents/save', { name: 'Leaky', instructions: 'Log in with password: hunter2hunter2 every day' });
  ok(secret.status === 400 && secret.d.code === 'credentials_in_detail', 'a password in its instructions is refused, and nothing is stored', secret.status + ' ' + secret.d.code);
  ok(!/hunter2/.test(String(store.get('agents:' + ME) || '')), 'the password is nowhere in storage');
  const big = await call('/v1/agents/save', { name: 'Spender', budgetUSD: 1e9 });
  ok(big.status === 400 && big.d.code === 'agent_budget', 'an impossible budget is refused', big.status + ' ' + big.d.code);

  store.set('ent:free@test.com', JSON.stringify({ plan: 'free' }));
  const free = await W.issueTokens(env, 'free@test.com', 'Free');
  const f = await call('/v1/agents/save', { name: 'Free agent' }, free.token);
  ok(f.status === 402 && f.d.code === 'plan_required', 'a free account is told agents are part of Pro', f.status + ' ' + f.d.code);
}

section('No more than ten');
{
  for (let i = 0; i < 9; i++) await call('/v1/agents/save', { name: 'Extra ' + i });
  const r = await call('/v1/agents/save', { name: 'One too many' });
  ok(r.status === 429 && r.d.code === 'agent_limit', 'the eleventh is refused, saying why', r.status + ' ' + r.d.code);
  const l = await call('/v1/agents', null, mine.token, 'GET');
  for (const a of l.d.agents.filter(a => /^Extra/.test(a.name))) await call('/v1/agents/delete', { id: a.id });
}

section('A job goes to your own agent, or nowhere');
{
  const bad = await call('/auto/create', { detail: 'Watch solar news', repeat: 'daily', approval: 'auto', agent: 'gnotarealone' });
  ok(bad.status === 400 && bad.d.code === 'agent_unknown', 'an agent that does not exist is refused', bad.status + ' ' + bad.d.code);
  const steal = await call('/auto/create', { detail: 'Watch solar news', repeat: 'daily', approval: 'auto', agent: agentId }, theirs.token);
  ok(steal.status === 400 && steal.d.code === 'agent_unknown', 'another account cannot give work to my agent', steal.status + ' ' + steal.d.code);
  const r = await call('/auto/create', { detail: 'Brief me on solar energy news', repeat: 'daily', approval: 'auto', agent: agentId });
  ok(r.status === 200 && r.d.item && r.d.item.agent === agentId, 'my agent gets the job', r.status + ' ' + JSON.stringify(r.d).slice(0, 160));
}

const due = () => { const r = rec(); r.items.forEach(i => { if (i.agent === agentId && i.active) i.next = Date.now() - 1000; }); put(r); };
section('Its instructions reach the run, after AMV’s rules');
{
  due(); modelCalls = 0; lastSystem = '';
  await W.runDueAutomations(env, Date.now());
  ok(modelCalls > 0, 'the job runs', modelCalls);
  const at = lastSystem.indexOf('Always lead with policy changes in Spain.');
  ok(at > 0, 'the agent’s instructions are in what the run was told', lastSystem.slice(-400));
  ok(at > lastSystem.indexOf('Never state or imply that you have taken an action'), 'after the rules an unattended run keeps, never before them');
  ok(/Solar scout/.test(lastSystem) && /never widen/.test(lastSystem), 'named, and told they never widen what it may do');
  const l = await call('/v1/agents', null, mine.token, 'GET');
  const a = l.d.agents.find(x => x.id === agentId);
  ok(a && a.spentUSD > 0, 'what the run cost is counted against the agent', a && a.spentUSD);
  ok(a && a.results.length === 1 && /solar policy/.test(a.results[0].out), 'and its result is shown as the agent’s', a && a.results);
}

section('Paused, its jobs do not run; resumed, they do');
{
  const p = await call('/v1/agents/save', { id: agentId, paused: true });
  ok(p.status === 200 && p.d.agent.paused === true, 'paused, and read back as paused', p.status);
  due(); modelCalls = 0;
  await W.runDueAutomations(env, Date.now() + 1);
  const it = rec().items.find(i => i.agent === agentId);
  ok(modelCalls === 0, 'nothing runs and nothing is spent', modelCalls);
  ok(/agent is paused/.test(it.lastError || '') && it.next > Date.now(), 'the row says why, and it is not due again at once', it.lastError);
  ok(it.active === true, 'the job itself is still on', it.active);
  await call('/v1/agents/save', { id: agentId, paused: false });
  due(); modelCalls = 0;
  await W.runDueAutomations(env, Date.now() + 2);
  ok(modelCalls > 0, 'resumed, it runs again', modelCalls);
}

section('Over its own budget, it waits for next month and says so');
{
  await call('/v1/agents/save', { id: agentId, budgetUSD: 0.01 });
  due(); modelCalls = 0;
  await W.runDueAutomations(env, Date.now() + 3);
  const it = rec().items.find(i => i.agent === agentId);
  ok(modelCalls === 0, 'past its budget nothing runs', modelCalls);
  ok(/monthly budget/.test(it.lastError || ''), 'and the row names its budget as the reason', it.lastError);
  await call('/v1/agents/save', { id: agentId, budgetUSD: 0 });
  due(); modelCalls = 0;
  await W.runDueAutomations(env, Date.now() + 4);
  ok(modelCalls > 0, 'with no budget of its own, the plan’s ceiling is the only one', modelCalls);
}

section('A task in steps can hand each step to a different agent');
{
  const w = await call('/v1/agents/save', { name: 'Writer', instructions: 'Write in short plain sentences for a board.' });
  const writer = w.d.agent.id;
  const bad = await call('/auto/create', { steps: [{ title: 'Find', detail: 'Find the news' }, { title: 'Write', detail: 'Write it up', after: 0, agent: 'gnotarealone' }] });
  ok(bad.status === 400 && bad.d.code === 'agent_unknown', 'a step naming an agent that does not exist is refused, and nothing is set up', bad.status + ' ' + bad.d.code);
  const r = await call('/auto/create', { approval: 'auto', steps: [
    { title: 'Gather', detail: 'Gather this week\u2019s solar policy news', agent: agentId },
    { title: 'Brief', detail: 'Turn what was gathered into a board brief', after: 0, agent: writer } ] });
  ok(r.status === 200 && r.d.items[0].agent === agentId && r.d.items[1].agent === writer, 'each step belongs to its own agent', r.status + ' ' + JSON.stringify(r.d).slice(0, 200));
  const g = r.d.group;
  const tick = async (t) => { const x = rec(); x.items.forEach(i => { if (i.group === g && i.active && !i.waiting) i.next = t - 1000; }); put(x); modelCalls = 0; lastSystem = ''; await W.runDueAutomations(env, t); };
  systems = [];
  await tick(Date.now() + 10);
  if (systems.length < 2) await tick(Date.now() + 20);
  ok(systems.length === 2, 'both steps run, the second once the first has finished', systems.length);
  ok(/policy changes in Spain/.test(systems[0] || '') && !/plain sentences for a board/.test(systems[0] || ''), 'the first step runs as the first agent', (systems[0] || '').slice(-300));
  ok(/plain sentences for a board/.test(systems[1] || '') && !/policy changes in Spain/.test(systems[1] || ''), 'and the step that builds on it runs as the second', (systems[1] || '').slice(-300));
  await call('/v1/agents/delete', { id: writer });
}

section('An API key cannot hire or fire');
{
  store.set('apikey:test', 'x');
  const k = await W.default.fetch(new Request('https://api.amv.test/v1/agents/save', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AMV-Key': 'amv_sk_notreal', 'CF-Connecting-IP': '9.9.9.9' }, body: JSON.stringify({ name: 'Bot' }) }), env, ctx);
  ok(k.status === 401 || k.status === 403, 'a key that is not a session is refused', k.status);
}

section('Deleted, its jobs stop and their results stay');
{
  const before = rec().results.length;
  const r = await call('/v1/agents/delete', { id: agentId });
  ok(r.status === 200 && r.d.stopped === 1, 'the agent is deleted and its one job stopped', r.status + ' ' + JSON.stringify(r.d));
  const it = rec().items.find(i => i.agent === agentId);
  ok(it && it.active === false && /agent was deleted/.test(it.lastError || ''), 'the job is off and says why', it);
  ok(rec().results.length === before, 'what it produced is kept');
  due(); modelCalls = 0;
  await W.runDueAutomations(env, Date.now() + 5);
  ok(modelCalls === 0, 'and it does not run again', modelCalls);
  const l = await call('/v1/agents', null, mine.token, 'GET');
  ok(!l.d.agents.some(a => a.id === agentId), 'it is no longer listed');
  ok(!/Always lead with policy/.test(String(store.get('agents:' + ME) || '')), 'and its instructions are no longer stored');
  const again = await call('/auto/create', { detail: 'One more', repeat: 'daily', approval: 'auto', agent: agentId });
  ok(again.status === 400 && again.d.code === 'agent_unknown', 'a deleted agent cannot be given new work', again.status);
}

if (report('an-agent-works-within-what-it-was-given') > 0) process.exitCode = 1;
done();
