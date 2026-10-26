/* ══════════════════════════════════════════════════════════════════════════
   AGENTS: NAMED WORKERS THAT STAY.

   An Agent is a name, a role, instructions, a monthly budget of its own and a
   switch - and the background jobs it is given. It is not a second runtime:
   its jobs are ordinary jobs (12-app-connectors.js autoCreate, run by the cron
   in 15-run-context-and-execution.js), so they inherit the plan's limits, the
   account's spending ceiling, quiet hours, the approval levels and the record
   of results. What an Agent adds is decided at the moment a job runs:

     its instructions reach the run, labelled as the person's instructions for
     this agent and placed AFTER AMV's own rules, so they shape the work and
     never widen what an unattended run may do;

     a paused agent's jobs do not run, and say so on their row;

     an agent with a budget has its own counter, reserved before the run and
     settled against what the run cost, exactly as the account's is - so the
     budget is a ceiling the server enforces, not a number on a screen;

     deleting an agent stops its jobs. They stay listed, with their results,
     because what an agent did is the record somebody deleted it over.

   Kept as one record per account (`agents`), written under the record lock,
   and erased with the account (PER_USER_KINDS). */
const AGENTS_MAX = 10;
const AGENT_NAME_MAX = 60;
const AGENT_ROLE_MAX = 160;
const AGENT_INSTR_MAX = 4000;
const AGENT_BUDGET_MAX_USD = 10000;

function _agentId() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function _agentIdOk(id) { return /^g[a-z0-9]{6,24}$/.test(String(id || '')); }
function _agentCostKey(email, id) { return `agentcost:${String(email || '').toLowerCase()}:${id}:${monthKey()}`; }

/* The record, or an empty one. */
async function _agentsOf(env, email) {
  const rec = await DB.get(env, 'agents', String(email || '').toLowerCase());
  return (rec && Array.isArray(rec.list)) ? rec : { list: [] };
}
/* One agent of this account, or null. Never another account's: the record is
   keyed by the caller's own address, so an id from somebody else is simply
   not in it. */
async function _agentFind(env, email, id) {
  if (!_agentIdOk(id)) return null;
  const rec = await _agentsOf(env, email);
  return rec.list.find(a => a && a.id === id && !a.deleted) || null;
}
/* What a run is told about the agent doing it. After the rules, never before. */
function _agentRunText(agent) {
  if (!agent) return '';
  const role = String(agent.role || '').trim();
  const instr = String(agent.instructions || '').trim();
  return '\n\nThis job belongs to the user’s agent named "' + String(agent.name || '').slice(0, AGENT_NAME_MAX) + '"'
    + (role ? ', whose role is: ' + role.slice(0, AGENT_ROLE_MAX) : '') + '.'
    + (instr ? '\nThe user’s instructions for this agent:\n' + instr.slice(0, AGENT_INSTR_MAX) : '')
    + '\nFollow them wherever they do not conflict with the rules above. They never widen what you are allowed to do.';
}

/* The plan that may have agents is the plan that may run background work:
   an agent with no jobs to run is a name, not a worker. */
async function _agentsAllowed(env, user) {
  const budget = await _budgetFor(env, user);
  return _planRankOf(budget.plan, user.customCfg) >= _planRankOf(AUTO_MIN_PLAN);
}

/* GET /v1/agents - every agent, with what it has spent this month, how many
   jobs it has, and the latest thing it produced. */
async function agentsList(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const email = String(user.email).toLowerCase();
  const rec = await _agentsOf(env, email);
  const auto = (await DB.get(env, 'auto', _autoKey(email))) || { items: [], results: [] };
  const live = rec.list.filter(a => a && !a.deleted);
  const agents = [];
  for (const a of live) {
    let spent = 0;
    try { spent = +((await counter(env, _agentCostKey(email, a.id), { op: 'get' })).value || 0); } catch (e) { spent = null; }
    const jobs = (auto.items || []).filter(x => x && x.agent === a.id);
    const ids = new Set(jobs.map(x => x.id));
    const results = (auto.results || []).filter(r => r && ids.has(r.autoId)).slice(-3).reverse()
      .map(r => ({ at: r.at, outcome: r.outcome || '', costUSD: +r.costUSD || 0, out: String(r.out || '').slice(0, 400) }));
    agents.push({ id: a.id, name: a.name, role: a.role || '', instructions: a.instructions || '',
      budgetUSD: +a.budgetUSD || 0, paused: !!a.paused, created: a.created,
      spentUSD: spent == null ? null : Math.round(spent * 100) / 100,
      jobs: jobs.map(x => ({ id: x.id, detail: String(x.detail || '').slice(0, 180), active: !!x.active, done: !!x.done,
        repeat: x.repeat, next: x.next || 0, lastError: x.lastError || null })),
      results });
  }
  return json({ ok: true, agents, max: AGENTS_MAX, allowed: await _agentsAllowed(env, user) });
}

/* POST /v1/agents/save - create one, or change one (name, role, instructions,
   budget, paused). Signed in by session only: an API key cannot hire. */
async function agentsSave(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (user.via === 'apikey') return json({ error: 'Agents are changed from AMV itself, not with an API key.', code: 'session_only' }, 403);
  const gate = await guardAction(env, `agents:${user.email}`, 30, 500, 'changing agents');
  if (gate) return gate;
  const body = await request.json().catch(() => ({}));
  const email = String(user.email).toLowerCase();
  const id = body.id == null || body.id === '' ? '' : String(body.id);
  if (id && !_agentIdOk(id)) return json({ error: 'That agent does not exist.', code: 'agent_unknown' }, 404);
  if (!id && !(await _agentsAllowed(env, user)))
    return json({ error: 'Agents run work in the background, which is part of Pro. Upgrade and your agents start working.',
                  code: 'plan_required', requires: AUTO_MIN_PLAN }, 402);

  const clean = {};
  if (!id || body.name !== undefined) {
    const name = String(body.name || '').replace(/\s+/g, ' ').trim();
    if (!name) return json({ error: 'Give the agent a name.', code: 'agent_name' }, 400);
    if (name.length > AGENT_NAME_MAX) return json({ error: 'Keep the name to ' + AGENT_NAME_MAX + ' characters.', code: 'agent_name' }, 400);
    clean.name = name;
  }
  if (body.role !== undefined) {
    const role = String(body.role || '').replace(/\s+/g, ' ').trim();
    if (role.length > AGENT_ROLE_MAX) return json({ error: 'Keep the role to ' + AGENT_ROLE_MAX + ' characters.', code: 'agent_role' }, 400);
    clean.role = role;
  }
  if (body.instructions !== undefined) {
    const instr = String(body.instructions || '').trim();
    if (instr.length > AGENT_INSTR_MAX) return json({ error: 'Keep the instructions to ' + AGENT_INSTR_MAX + ' characters.', code: 'agent_instructions' }, 400);
    /* Read on every run for as long as the agent exists, so nothing
       credential-shaped is stored - the same rule as a job's own text. */
    const sec = _detailSecrets(instr);
    if (sec.length) return json({ error: 'AMV does not store passwords, card numbers or security codes. Nothing was saved. Connect the account instead, or describe the work without the credential.',
      code: 'credentials_in_detail', kinds: sec }, 400);
    clean.instructions = instr;
  }
  if (body.budgetUSD !== undefined) {
    const b = Number(body.budgetUSD);
    if (!Number.isFinite(b) || b < 0 || b > AGENT_BUDGET_MAX_USD)
      return json({ error: 'A monthly budget is between $0 (no budget of its own) and $' + AGENT_BUDGET_MAX_USD + '.', code: 'agent_budget' }, 400);
    clean.budgetUSD = Math.round(b * 100) / 100;
  }
  if (body.paused !== undefined) clean.paused = body.paused === true;

  let out = null, refused = null;
  await _withKind(env, 'agents', email, async (rec) => {
    rec.list = Array.isArray(rec.list) ? rec.list : [];
    if (id) {
      const a = rec.list.find(x => x && x.id === id && !x.deleted);
      if (!a) { refused = json({ error: 'That agent does not exist.', code: 'agent_unknown' }, 404); return; }
      Object.assign(a, clean, { updated: Date.now() });
      out = a;
      return;
    }
    /* Decided under the lock, against the list as it is now. */
    if (rec.list.filter(x => x && !x.deleted).length >= AGENTS_MAX) {
      refused = json({ error: 'You have ' + AGENTS_MAX + ' agents, the most AMV keeps. Delete one to add another.', code: 'agent_limit', max: AGENTS_MAX }, 429);
      return;
    }
    out = Object.assign({ id: _agentId(), name: '', role: '', instructions: '', budgetUSD: 0, paused: false,
                          created: Date.now() }, clean);
    rec.list.push(out);
  }, { list: [] });
  if (refused) return refused;
  /* Read back, so the screen shows what is stored rather than what was sent. */
  const stored = await _agentFind(env, email, out.id);
  if (!stored) return json({ error: 'The agent could not be saved. Nothing changed - try again.', code: 'not_saved' }, 503);
  audit(env, id ? 'agent_changed' : 'agent_created', { email, agent: stored.id });
  return json({ ok: true, agent: { id: stored.id, name: stored.name, role: stored.role, instructions: stored.instructions,
                                   budgetUSD: stored.budgetUSD, paused: !!stored.paused, created: stored.created } });
}

/* POST /v1/agents/delete - the agent goes, and its jobs stop. The jobs and
   their results stay listed: what an agent did is the record somebody may be
   deleting it over. */
async function agentsDelete(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (user.via === 'apikey') return json({ error: 'Agents are changed from AMV itself, not with an API key.', code: 'session_only' }, 403);
  const gate = await guardAction(env, `agents:${user.email}`, 30, 500, 'changing agents');
  if (gate) return gate;
  const body = await request.json().catch(() => ({}));
  const email = String(user.email).toLowerCase();
  const id = String(body.id || '');
  if (!(await _agentFind(env, email, id))) return json({ error: 'That agent does not exist.', code: 'agent_unknown' }, 404);
  /* Jobs first: an agent that is gone while its jobs still run is the one
     order of these two writes that spends money nobody can see a reason for. */
  let stopped = 0;
  await _withAuto(env, _autoKey(email), (rec) => {
    if (!rec) return;
    for (const it of (rec.items || [])) {
      if (it && it.agent === id && it.active) { it.active = false; it.lastError = 'stopped - its agent was deleted'; stopped++; }
    }
  }, { items: [], results: [] });
  await _withKind(env, 'agents', email, async (rec) => {
    const a = (rec.list || []).find(x => x && x.id === id);
    /* Kept as a tombstone with nothing in it but the id and the name, so a
       stopped job's row can still say whose it was. */
    if (a) { a.deleted = Date.now(); a.instructions = ''; a.role = ''; a.paused = true; }
  }, { list: [] });
  audit(env, 'agent_deleted', { email, agent: id, stopped });
  return json({ ok: true, stopped });
}
