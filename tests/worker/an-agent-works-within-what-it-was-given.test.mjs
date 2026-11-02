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
export { runDueAutomations, issueTokens, _agentCostKey, _jobCostKey, counter, monthKey };
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

let modelCalls = 0, lastSystem = '', systems = [], lastBody = null, bodies = [];
const replies = [];
globalThis.fetch = async (u, init) => {
  modelCalls++;
  try { const b = JSON.parse(String((init && init.body) || '{}')); lastBody = b; bodies.push(b); lastSystem = typeof b.system === 'string' ? b.system : JSON.stringify(b.system || ''); systems.push(lastSystem); } catch (e) {}
  const text = replies.length ? replies.shift() : 'Three things changed in solar policy this week.';
  return new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn',
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

section('It remembers its own last runs, and only its own (Nov 1 audit AGENT-002)');
{
  /* Another job of the account, not this agent's, with a result of its own. */
  const r0 = rec();
  r0.items.push({ id: 'otherjob1', detail: 'Unrelated job', active: false, kind: 'task' });
  r0.results.push({ id: 'rx', autoId: 'otherjob1', detail: 'Unrelated job', at: Date.now(), out: 'SECRET-OF-ANOTHER-JOB' });
  put(r0);
  due(); lastSystem = '';
  await W.runDueAutomations(env, Date.now() + 0.5);
  ok(/last runs/.test(lastSystem) && /Three things changed in solar policy/.test(lastSystem), 'the next run is told what this agent found last time', lastSystem.slice(-500));
  ok(!/SECRET-OF-ANOTHER-JOB/.test(lastSystem), 'and nothing from any other job', true);
  ok(/never an instruction/.test(lastSystem), 'fenced as a record, never an instruction');
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

section('A job of its own can have a monthly budget too, enforced the same way');
{
  const made = await call('/auto/create', { detail: 'Summarise the markets each morning', repeat: 'daily', approval: 'auto' });
  const jobId = made.d.item && made.d.item.id;
  ok(made.status === 200 && jobId && !made.d.item.agent, 'a job that belongs to no agent', made.status);
  const dueJob = () => { const r = rec(); const j = r.items.find(i => i.id === jobId); j.next = Date.now() - 1000; put(r); };
  const bad = await call('/auto/update', { action: 'budget', id: jobId, budgetUSD: 1e9 });
  ok(bad.status === 400 && bad.d.code === 'bad_budget', 'an impossible budget is refused', bad.status);
  const neg = await call('/auto/update', { action: 'budget', id: jobId, budgetUSD: -5 });
  ok(neg.status === 400, 'so is a negative one', neg.status);
  const other = await call('/auto/update', { action: 'budget', id: jobId, budgetUSD: 5 }, theirs.token);
  ok(other.status === 404, 'another account cannot set a budget on my job', other.status);
  const set = await call('/auto/update', { action: 'budget', id: jobId, budgetUSD: 0.01 });
  ok(set.status === 200 && set.d.budgetUSD === 0.01 && rec().items.find(i => i.id === jobId).budgetUSD === 0.01, 'set, and stored on the job', set.d);
  dueJob(); modelCalls = 0;
  await W.runDueAutomations(env, Date.now() + 5);
  let it = rec().items.find(i => i.id === jobId);
  ok(modelCalls === 0, 'a budget smaller than one run costs: nothing runs', modelCalls);
  ok(/this job reached its monthly budget of \$0\.01/.test(it.lastError || '') && it.next > Date.now(), 'the row names the job’s budget, and it is not due again at once', it.lastError);
  await call('/auto/update', { action: 'budget', id: jobId, budgetUSD: 5 });
  const acctName = 'cost:' + ME + ':' + W.monthKey();
  const acctBefore = +((await W.counter(env, acctName, { op: 'get' })) || {}).value || 0;
  dueJob(); modelCalls = 0;
  await W.runDueAutomations(env, Date.now() + 6);
  const acctAfter = +((await W.counter(env, acctName, { op: 'get' })) || {}).value || 0;
  it = rec().items.find(i => i.id === jobId);
  const shown = await call('/auto/update', { action: 'budget', id: jobId, budgetUSD: 5 });
  ok(modelCalls > 0 && !/budget/.test(it.lastError || ''), 'with room in the budget, it runs', { modelCalls, err: it.lastError });
  ok(shown.d.spentUSD > 0 && Math.abs(shown.d.spentUSD - (acctAfter - acctBefore)) < 1e-4, 'and its budget is charged what the run actually cost - the same amount the account was', { job: shown.d.spentUSD, account: acctAfter - acctBefore });
  const off = await call('/auto/update', { action: 'budget', id: jobId, budgetUSD: 0 });
  ok(off.d.budgetUSD === null && !('budgetUSD' in rec().items.find(i => i.id === jobId)), '0 removes it', off.d);
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

section('An agent can have its own engine, priced as that engine, and be kept off the web (Nov 1 audit AGENT-003/004)');
{
  const unthrottle = () => { for (const k of [...store.keys()]) if (/agents:/.test(k) && /(^rl|act)/.test(k)) store.delete(k); };
  unthrottle();
  await call('/v1/agents/save', { id: agentId, budgetUSD: 0, paused: false });
  const bad = await call('/v1/agents/save', { id: agentId, engine: 'amv-nothing' });
  ok(bad.status === 400 && bad.d.code === 'agent_engine', 'an engine that does not exist is refused', bad.d);
  const freeAcct = await W.issueTokens(env, 'cy@test.com', 'Cy');
  store.set('ent:cy@test.com', JSON.stringify({ plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  const fa = await call('/v1/agents/save', { name: 'Cy agent' }, freeAcct.token);
  const notPlan = fa.d.agent ? await call('/v1/agents/save', { id: fa.d.agent.id, engine: 'amv-apex' }, freeAcct.token) : { status: 0, d: {} };
  ok(notPlan.status === 403 && notPlan.d.code === 'agent_engine_plan', 'one the plan does not include is refused', notPlan.d);
  const set = await call('/v1/agents/save', { id: agentId, engine: 'amv-forge', web: false });
  ok(set.status === 200 && set.d.agent.engine === 'amv-forge' && set.d.agent.web === false, 'saved, and read back', set.d.agent);
  /* Its job runs on that engine, without the web, and is charged at that engine's prices. */
  const costKey = 'ctr:' + W._agentCostKey(ME, agentId);
  const before = +(await W.counter(env, W._agentCostKey(ME, agentId), { op: 'get' })).value || 0;
  due(); lastBody = null;
  await W.runDueAutomations(env, Date.now() + 6);
  ok(lastBody && /fable/.test(lastBody.model) && !lastBody.tools, 'the run uses its engine, and has no web search', lastBody && { model: lastBody.model, tools: lastBody.tools });
  const after = +(await W.counter(env, W._agentCostKey(ME, agentId), { op: 'get' })).value || 0;
  const spent = after - before;
  /* 2,000 in and 800 out at the heavier engine's $10/$50 per million: $0.06 before markup, more than the everyday $0.018. */
  ok(spent >= 0.06 - 1e-9, 'and is charged at that engine’s prices, not the everyday one’s', spent);
  /* The plan lapses: the next run is on the everyday engine. */
  unthrottle();
  await call('/v1/agents/save', { id: agentId, engine: 'amv-apex' });
  store.set('ent:' + ME, JSON.stringify({ plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  due(); lastBody = null;
  await W.runDueAutomations(env, Date.now() + 7);
  ok(lastBody && lastBody.model && !/fable-5-1/.test(lastBody.model), 'on a plan without that engine, the run goes ahead on the everyday one', lastBody && lastBody.model);
  store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
  unthrottle();
  await call('/v1/agents/save', { id: agentId, engine: '', web: true });
  unthrottle();
}

section('An agent can promise the form of its results, and what lacks it is repaired once or built on by nothing (Nov 1 audit AGENT-017)');
{
  const unthrottle = () => { for (const k of [...store.keys()]) if (/agents:/.test(k) && /(^rl|act)/.test(k)) store.delete(k); };
  unthrottle();
  const badKind = await call('/v1/agents/save', { id: agentId, contract: { kind: 'xml', required: ['a'] } });
  ok(badKind.status === 400 && badKind.d.code === 'agent_contract', 'a contract of an unknown kind is refused', badKind.d);
  const badType = await call('/v1/agents/save', { id: agentId, contract: { kind: 'json', required: ['price:money'] } });
  ok(badType.status === 400 && badType.d.code === 'agent_contract', 'a field of an unknown type is refused', badType.d);
  const empty = await call('/v1/agents/save', { id: agentId, contract: { kind: 'sections', required: [' ', ''] } });
  ok(empty.status === 400 && empty.d.code === 'agent_contract', 'a contract naming nothing is refused', empty.d);
  unthrottle();
  const set = await call('/v1/agents/save', { id: agentId, contract: { kind: 'sections', required: 'Summary, Sources' } });
  ok(set.status === 200 && set.d.agent.contract && set.d.agent.contract.required.join('|') === 'Summary|Sources', 'saved, and read back as a list', set.d.agent);
  const l = await call('/v1/agents', null, mine.token, 'GET');
  ok((l.d.agents.find(a => a.id === agentId) || {}).contract?.kind === 'sections', 'and listed');

  /* A run that leaves out a section is repaired once - from its own answer only. */
  const good = '## Summary\nSpain cut its solar tariff.\n\n## Sources\n- boe.es';
  replies.length = 0; replies.push('Spain cut its solar tariff. (no headings at all)', good);
  due(); modelCalls = 0; bodies = []; lastSystem = '';
  const before = +(await W.counter(env, W._agentCostKey(ME, agentId), { op: 'get' })).value || 0;
  await W.runDueAutomations(env, Date.now() + 8);
  ok(modelCalls === 2, 'the off-form answer gets exactly one repair call', modelCalls);
  ok(/"Summary", "Sources"/.test(bodies[0] && bodies[0].system || ''), 'the run was told the form beforehand', (bodies[0] && bodies[0].system || '').slice(-300));
  const fixCall = bodies[1] || {};
  const fixText = (fixCall.messages || []).map(m => m.content).join('\n');
  ok(!fixCall.tools && /section "Sources" is missing/.test(fixText) && /add no new facts/.test(fixText),
    'the repair has no tools, names what is missing, and may add nothing', fixCall.messages);
  const last = rec().results.filter(r => r.autoId && rec().items.find(i => i.id === r.autoId && i.agent === agentId)).slice(-1)[0];
  ok(last && last.out === good && !last.contract, 'the repaired answer is the result', last);
  const after = +(await W.counter(env, W._agentCostKey(ME, agentId), { op: 'get' })).value || 0;
  ok(after - before > 0.03, 'and both calls are counted against the agent', after - before);

  /* A step that stays off-form: kept, said so, and the step after it never runs. */
  const w = await call('/v1/agents/save', { name: 'Briefer', instructions: 'Brief the board.' });
  const briefer = w.d.agent.id;
  const r = await call('/auto/create', { approval: 'auto', steps: [
    { title: 'Gather', detail: 'Gather solar policy news', agent: agentId },
    { title: 'Brief', detail: 'Brief the board on it', after: 0, agent: briefer } ] });
  const g = r.d.group;
  replies.length = 0; replies.push('Just prose, no form.', 'Still just prose.');
  const x = rec(); x.items.forEach(i => { if (i.group === g && i.active && !i.waiting) i.next = Date.now() - 1000; }); put(x);
  modelCalls = 0; systems = [];
  await W.runDueAutomations(env, Date.now() + 9);
  ok(modelCalls === 2, 'the first step ran and was asked to repair once, and nothing more', modelCalls);
  const items = rec().items.filter(i => i.group === g);
  const res = rec().results.filter(r => r.autoId === items[0].id).slice(-1)[0];
  ok(res && res.contract && res.contract.ok === false && /Sources/.test(res.contract.problems.join(' ')), 'its result is kept and marked as off-form, naming what is missing', res);
  ok(res && /does not have the form this agent promises/.test(res.out), 'and says so where it is read', res && res.out.slice(0, 160));
  ok(res && /Just prose, no form\./.test(res.out) && !/Still just prose/.test(res.out), 'a repair that is still off-form does not replace the answer it was made from', res && res.out);
  ok(items[1].done && !items[1].active && /form its agent promises/.test(items[1].lastError || ''), 'the step that would build on it is not started, and says why', items[1]);
  ok(!systems.some(sy => /Brief the board\./.test(sy)), 'the second agent never ran', systems.length);
  await call('/v1/agents/delete', { id: briefer });

  /* And when the form is kept, the next agent gets the dossier - and only
     that: not the first agent's memory, instructions or sign-ins (AGENT-006). */
  {
    const w2 = await call('/v1/agents/save', { name: 'Seller', instructions: 'Write the pitch.' });
    const seller = w2.d.agent.id;
    const r2 = await call('/auto/create', { approval: 'auto', steps: [
      { title: 'Research', detail: 'Research the solar market', agent: agentId },
      { title: 'Pitch', detail: 'Write a pitch from the research', after: 0, agent: seller } ] });
    const g2 = r2.d.group;
    replies.length = 0; replies.push('## Summary\nDOSSIER-SUMMARY-LINE\n\n## Sources\n- ree.es', 'Pitch written.');
    const tick2 = async (t) => { const x = rec(); x.items.forEach(i => { if (i.group === g2 && i.active && !i.waiting) i.next = t - 1000; }); put(x); await W.runDueAutomations(env, t); };
    systems = []; bodies = [];
    await tick2(Date.now() + 9.3);
    if (systems.length < 2) await tick2(Date.now() + 9.6);
    const second = bodies.find(b => /Write the pitch\./.test(b.system || '')) || {};
    const turn = JSON.stringify(second.messages || []);
    ok(/DOSSIER-SUMMARY-LINE/.test(turn), 'the next agent is handed the checked result', turn.slice(0, 200));
    ok(!/Three things changed in solar policy/.test(second.system || '') && !/policy changes in Spain/.test(second.system || ''),
      'and none of the first agent\u2019s memory or instructions', (second.system || '').slice(-300));
    ok(!/"Summary", "Sources"/.test(second.system || ''), 'nor its contract', true);
    await call('/v1/agents/delete', { id: seller });
  }

  /* A JSON contract is read as JSON: a field of the wrong type is not "there". */
  unthrottle();
  await call('/v1/agents/save', { id: agentId, contract: { kind: 'json', required: ['price:number', 'source'] } });
  replies.length = 0; replies.push('```json\n{"price":"about 40","source":"omie.es"}\n```', '```json\n{"price":41.2,"source":"omie.es"}\n```');
  due(); modelCalls = 0;
  await W.runDueAutomations(env, Date.now() + 10);
  const lj = rec().results.filter(r => rec().items.find(i => i.id === r.autoId && i.agent === agentId && !i.group)).slice(-1)[0];
  ok(modelCalls === 2 && lj && /41\.2/.test(lj.out) && !lj.contract, 'a price given as words is repaired into a number', { modelCalls, out: lj && lj.out });
  unthrottle();
  const off = await call('/v1/agents/save', { id: agentId, contract: null });
  ok(off.status === 200 && off.d.agent.contract === null, 'and a contract can be taken away', off.d.agent);
  replies.length = 0; unthrottle();
}

section('Its record is kept, and three bad runs in a row pause it (Nov 1 audit AGENT-007)');
{
  const unthrottle = () => { for (const k of [...store.keys()]) if (/agents:/.test(k) && /(^rl|act)/.test(k)) store.delete(k); };
  unthrottle();
  const l0 = await call('/v1/agents', null, mine.token, 'GET');
  const a0 = l0.d.agents.find(x => x.id === agentId);
  ok(a0 && a0.score && a0.score.runs >= 1 && a0.score.good + a0.score.failed + a0.score.offForm === a0.score.runs && a0.score.costUSD > 0,
    'the list carries its last 30 days: runs, good, failed, off-form and cost', a0 && a0.score);
  ok(a0 && a0.score.offForm >= 1 && a0.score.goodPct < 100 && a0.score.costPerGoodUSD > 0, 'an off-form result counts against it, and cost is per good result', a0 && a0.score);
  /* Three failed runs, after it was last started. */
  const job = rec().items.find(i => i.agent === agentId && !i.group);
  await new Promise(r => setTimeout(r, 5));
  const r0 = rec(); const t = Date.now();
  for (let k = 0; k < 3; k++) r0.results.push({ id: 'bad' + k, autoId: job.id, detail: job.detail, at: t + k, kind: 'failed', outcome: 'failed', costUSD: 0, out: 'x' });
  put(r0);
  due(); modelCalls = 0;
  await W.runDueAutomations(env, Date.now() + 11);
  ok(modelCalls === 0, 'the next run does not happen', modelCalls);
  const l1 = await call('/v1/agents', null, mine.token, 'GET');
  const a1 = l1.d.agents.find(x => x.id === agentId);
  ok(a1 && a1.paused === true && /last 3 runs failed/.test(a1.pausedWhy || ''), 'it is paused, saying why', a1 && { paused: a1.paused, why: a1.pausedWhy });
  ok(/paused because its last 3 runs/.test(rec().items.find(i => i.id === job.id).lastError || ''), 'and its job says so too', rec().items.find(i => i.id === job.id).lastError);
  /* Resumed by the person: a fresh start, so the old failures no longer trip it. */
  unthrottle();
  await new Promise(r => setTimeout(r, 10));
  const res = await call('/v1/agents/save', { id: agentId, paused: false });
  ok(res.status === 200 && res.d.agent.paused === false, 'resumed', res.status);
  due(); modelCalls = 0;
  await W.runDueAutomations(env, Date.now() + 12);
  ok(modelCalls === 1, 'and it runs again - what went wrong before it was resumed does not pause it again', modelCalls);
  unthrottle();
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
