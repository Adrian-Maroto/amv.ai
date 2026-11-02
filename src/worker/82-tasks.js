/* =====================================================================
   ONE TASK API (Nov 1 audit TASK-008).

   Background work lived in several shapes - Crew jobs, tasks in steps, an
   agent's jobs, webhook-started jobs, batches of API requests - each with its
   own list and its own way to stop it. This is one view over all of them:

     GET  /v1/tasks          every piece of background work this account has,
                             as one shape: what it is, its status in one
                             vocabulary, its budget, its latest evidence
     POST /v1/tasks/cancel   { id } - stop it, the same meaning everywhere:
                             nothing more runs and nothing more is spent;
                             what it already produced is kept

   The systems underneath keep their own records; this neither copies nor
   replaces them, so there is no second truth to drift.
   ===================================================================== */
const BG_TASK_STATUSES = ['scheduled', 'due', 'waiting', 'held', 'paused', 'done', 'failed', 'cancelled', 'running', 'canceling'];

function _taskOfJob(it, rec, now, spent){
  const results = (rec.results || []).filter(r => r && r.autoId === it.id);
  const last = results[results.length - 1] || null;
  const status = it.cancelled ? 'cancelled'
    : it.done ? ((last && last.kind === 'failed') ? 'failed' : 'done')
    : it.waiting ? 'waiting'
    : !it.active ? 'paused'
    : (it.heldUntil && it.heldUntil > now) ? 'held'
    : (+it.next || 0) <= now ? 'due' : 'scheduled';
  return {
    id: 'job:' + it.id, kind: it.group ? 'step' : it.agent ? 'agent_job' : (it.when && it.when.source === 'hook') ? 'triggered_job' : 'job',
    title: String(it.detail || '').slice(0, 200), status,
    ...(it.group ? { group: it.group } : {}), ...(it.agent ? { agent: it.agent } : {}),
    repeat: it.repeat || null, next: it.active && !it.done ? (+it.next || null) : null,
    why: it.lastError || null,
    budget: +it.budgetUSD > 0 ? { usd: +it.budgetUSD, spentUSD: spent, leftUSD: spent == null ? null : Math.max(0, Math.round((+it.budgetUSD - spent) * 100) / 100) } : null,
    evidence: last ? { at: last.at, outcome: last.outcome || last.kind || '', costUSD: +last.costUSD || 0,
                       ...(last.contract ? { contract: last.contract } : {}), runs: results.length } : null,
    cancellable: !it.done && !it.cancelled,
  };
}
function _taskOfBatch(rec){
  const v = _batchView(rec);
  const c = v.request_counts || {};
  return { id: 'batch:' + rec.id, kind: 'batch', title: (c.processing || 0) + (c.succeeded || 0) + (c.errored || 0) + (c.canceled || 0) + ' requests',
    status: v.processing_status === 'ended' ? 'done' : v.processing_status === 'canceling' ? 'canceling' : 'running',
    next: null, why: null, budget: null,
    evidence: { at: rec.endedAt || rec.created, outcome: v.processing_status, counts: c },
    cancellable: v.processing_status === 'in_progress' };
}

async function tasksList(request, env){
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const email = String(user.email).toLowerCase();
  const now = Date.now();
  const rec = (await DB.get(env, 'auto', _autoKey(email))) || { items: [], results: [] };
  const tasks = [];
  for (const it of (rec.items || [])) {
    if (!it || !it.id) continue;
    let spent = null;
    if (+it.budgetUSD > 0) { try { spent = Math.round(+((await counter(env, _jobCostKey(email, it.id), { op: 'get' })).value || 0) * 100) / 100; } catch (e) { spent = null; } }
    tasks.push(_taskOfJob(it, rec, now, spent));
  }
  const idx = (await DB.get(env, 'batchidx', email)) || [];
  for (const b of idx.slice(0, 50)) { const br = await DB.get(env, 'batch', b.id); if (br && br.owner === email) tasks.push(_taskOfBatch(br)); }
  return json({ ok: true, statuses: BG_TASK_STATUSES, tasks });
}

async function tasksCancel(request, env){
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const blocked = await guardAction(env, 'tasks:' + user.email, 30, 500, 'stopping tasks');
  if (blocked) return blocked;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  const email = String(user.email).toLowerCase();
  const m = /^(job|batch):([A-Za-z0-9_-]{1,80})$/.exec(id);
  if (!m) return json({ error: 'There is no task with that id.', code: 'not_found' }, 404);
  if (m[1] === 'batch') {
    const rec = /^batch_[a-f0-9]{24}$/.test(m[2]) ? await DB.get(env, 'batch', m[2]) : null;
    if (!rec || rec.owner !== email) return json({ error: 'There is no task with that id.', code: 'not_found' }, 404);
    const out = await _withKind(env, 'batch', rec.id, (r) => { if (r && r.status === 'in_progress') r.status = 'canceling'; return r; });
    audit(env, 'task_cancelled', { by: email, kind: 'batch' });
    return json({ ok: true, task: _taskOfBatch(out || rec) });
  }
  /* A job: nothing more runs. A repeating job is switched off - it can be
     resumed from Crew; a one-time job or a step is finished as cancelled, and
     whatever waited on it is cancelled with it and says why. */
  let found = null, already = false;
  await _withAuto(env, _autoKey(email), (fresh) => {
    if (!fresh) return null;
    const it = (fresh.items || []).find(x => x && x.id === m[2]);
    if (!it) return null;
    found = it;
    if (it.done || it.cancelled) { already = true; return null; }
    const now = Date.now();
    if (it.repeat === 'once' || it.group) {
      it.active = false; it.done = true; it.doneAt = now; it.next = 0; it.waiting = false; it.cancelled = true;
      it.lastError = 'cancelled by you';
      _autoSettleSteps(fresh, it, false, '', now, 'it was cancelled');
    } else {
      it.active = false; it.cancelled = false; it.lastError = 'stopped by you';
    }
    return fresh.items;
  }, { items: [], results: [] });
  if (!found) return json({ error: 'There is no task with that id.', code: 'not_found' }, 404);
  if (already) return json({ error: 'That task has already finished.', code: 'already_finished' }, 409);
  audit(env, 'task_cancelled', { by: email, kind: 'job' });
  const rec = (await DB.get(env, 'auto', _autoKey(email))) || { items: [], results: [] };
  const it = (rec.items || []).find(x => x && x.id === m[2]);
  return json({ ok: true, task: it ? _taskOfJob(it, rec, Date.now(), null) : null });
}
