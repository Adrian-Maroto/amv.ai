/* HOW LONG CONVERSATIONS ARE KEPT (Oct 31 audit, item 108: retention
   controls).

   A person can choose to keep their conversations for 30, 90, 180 or 365
   days (Settings > Privacy), and a team's owner or admin can set the same for
   every member (Team > Data rules). Where both are set, the SHORTER one
   applies - a company's rule is a ceiling its people can go under, never
   over.

   What is removed: a conversation, a Dev or Lab session, or a handoff whose
   last change is older than the period. Something still in use is never old,
   because using it changes it. Something with no date at all is kept and
   counted - deleting what cannot be dated would be guessing.

   Where it is enforced - the server is the authority, the app only follows:
     - every sync push, after the merge and before the write, so a device
       that still holds an old conversation cannot put it back;
     - every sync pull, so what is handed out has already been trimmed;
     - the nightly sweep, for accounts that never come back - otherwise a
       period would only apply to people who keep using AMV;
     - the app trims its own copy when it pulls, from the period the server
       sends, so the device and the server agree.

   Residency (where in the world the data is held) is not here: the store is
   Cloudflare's global KV, and a region cannot be promised by this code. */

const RETENTION_CHOICES = new Set([30, 90, 180, 365]);
const RETENTION_LISTS = ['convs', 'chats', 'sessions', 'handoffs'];
const RETENTION_SWEEP_MS = 15000;

function _retentionStamp(it){
  const v = _syncStamp(it);
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
/* Trims `data` in place. Returns how many items went, and how many had no
   date and were kept. */
function _retentionPrune(data, days, now){
  const out = { removed: 0, undated: 0 };
  if (!data || !(days > 0)) return out;
  const cutoff = (now || Date.now()) - days * 86400000;
  for (const k of RETENTION_LISTS) {
    if (!Array.isArray(data[k])) continue;
    const keep = data[k].filter(it => {
      const s = _retentionStamp(it);
      if (!s) { out.undated++; return true; }
      return s >= cutoff;
    });
    out.removed += data[k].length - keep.length;
    data[k] = keep;
  }
  return out;
}
/* The period that applies to one person, and whose rule it is. `user` is the
   principal requireUser returned (it carries the team's policy); the
   personal choice is on the account record. */
async function _retentionFor(env, email, user){
  const acct = await DB.get(env, 'acct', String(email || '').toLowerCase());
  const mine = acct && RETENTION_CHOICES.has(+acct.retentionDays) ? +acct.retentionDays : 0;
  let team = user && RETENTION_CHOICES.has(+user.teamRetention) ? +user.teamRetention : 0;
  if (!user) {
    const t = await _teamOf(env, email).catch(() => null);
    team = t && t.policy && RETENTION_CHOICES.has(+t.policy.retentionDays) ? +t.policy.retentionDays : 0;
  }
  if (!mine && !team) return { days: 0, by: null, mine: 0, team: 0 };
  const days = mine && team ? Math.min(mine, team) : (mine || team);
  return { days, by: team && days === team ? 'team' : 'you', mine, team };
}
async function _retentionIndex(env, who, on){
  const email = String(who || '').toLowerCase();
  const k = `retainidx:${email}`;
  if (on) await env.AMV_KV.put(k, '1'); else await env.AMV_KV.delete(k);
}

/* POST /account/retention {days: 30|90|180|365|null}: the person's own
   choice. Answers the period that now applies (a team's may be shorter). */
async function accountRetention(request, env){
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const body = await request.json().catch(() => ({}));
  if (Object.prototype.hasOwnProperty.call(body, 'days')) {
    const d = body.days == null ? null : +body.days;
    if (d !== null && !RETENTION_CHOICES.has(d)) return json({ error: 'Choose 30, 90, 180 or 365 days, or keep everything.', code: 'bad_request' }, 400);
    try {
      await _withAcct(env, user.email, (a) => { if (!a) return; if (d) a.retentionDays = d; else delete a.retentionDays; });
    } catch (e) { if (!_isBusy(e)) throw e; return _busyJson('account'); }
    await _retentionIndex(env, user.email, !!d);
    audit(env, 'retention_set', { email: user.email, days: d || 'all' });
  }
  const r = await _retentionFor(env, user.email, user);
  return json({ ok: true, days: r.days || null, by: r.by, mine: r.mine || null, team: r.team || null });
}

/* The nightly part: everybody who chose a period, and every member of a team
   that set one. Bounded per run and resumable (`retainrun:<day>` holds the
   cursors), like the backup it runs beside. */
async function _retentionTrimOne(env, email, days){
  let removed = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await DB.get(env, 'data', email);
    if (!cur) return 0;
    const rev = +(cur._rev || 0);
    const r = _retentionPrune(cur, days);
    if (!r.removed) return 0;
    cur._rev = rev + 1; cur._updatedAt = Date.now();
    const res = await DB.putIfRev(env, 'data', email, cur, rev);
    if (res.ok) { removed = r.removed; break; }
  }
  if (removed) audit(env, 'retention_trimmed', { email, removed, days, how: 'nightly' });
  return removed;
}
async function runRetentionSweep(env, atMs){
  /* One sweep at a time (STATE-003). */
  const lease = await _runAlone(env, 'retention-sweep', RETENTION_SWEEP_MS + 60000);
  if (!lease.held) return { ran: false, busy: true };
  try { return await _retentionSweepSlice(env, atMs); }
  finally { await _runAloneEnd(env, 'retention-sweep', lease); }
}
async function _retentionSweepSlice(env, atMs){
  const now = atMs || Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const stateKey = 'retainrun:' + day;
  let st = null; try { st = JSON.parse((await env.AMV_KV.get(stateKey)) || 'null'); } catch (e) { st = null; }
  st = st || { people: null, teams: null, done: false, trimmed: 0, accounts: 0 };
  if (st.done) return { ran: false, done: true };
  const until = Date.now() + RETENTION_SWEEP_MS;
  /* People who chose a period themselves. */
  while (st.people !== 'end' && Date.now() < until) {
    const page = await env.AMV_KV.list({ prefix: 'retainidx:', cursor: st.people || undefined, limit: 100 });
    for (const k of page.keys) {
      const email = k.name.slice('retainidx:'.length);
      /* An erased account leaves no address behind in an index either. */
      if (!(await DB.get(env, 'acct', email))) { await env.AMV_KV.delete(k.name); continue; }
      const r = await _retentionFor(env, email, null);
      if (r.days) { st.trimmed += await _retentionTrimOne(env, email, r.days); st.accounts++; }
    }
    st.people = page.list_complete ? 'end' : page.cursor;
  }
  /* Every member of a team that set one. */
  while (st.people === 'end' && st.teams !== 'end' && Date.now() < until) {
    const page = await env.AMV_KV.list({ prefix: 'retainteam:', cursor: st.teams || undefined, limit: 50 });
    for (const k of page.keys) {
      const team = await DB.get(env, 'team', k.name.slice('retainteam:'.length));
      if (!team || !(team.policy && RETENTION_CHOICES.has(+team.policy.retentionDays))) continue;
      for (const m of team.members || []) {
        /* Already reached in the first pass, with the shorter of the two
           periods (STATE-004): not counted, or read, twice. */
        const email = String(m.email || '').toLowerCase();
        try { if (await env.AMV_KV.get(`retainidx:${email}`)) continue; } catch (e) {}
        const r = await _retentionFor(env, m.email, null);
        if (r.days) { st.trimmed += await _retentionTrimOne(env, m.email, r.days); st.accounts++; }
      }
    }
    st.teams = page.list_complete ? 'end' : page.cursor;
  }
  st.done = st.people === 'end' && st.teams === 'end';
  await env.AMV_KV.put(stateKey, JSON.stringify(st), { expirationTtl: 3 * 86400 });
  return { ran: true, done: st.done, trimmed: st.trimmed, accounts: st.accounts };
}
