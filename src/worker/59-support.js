/* ══════════════════════════════════════════════════════════════════════
   SUPPORT - a bug report that reaches a person.

   There was nowhere for one to go. The in-app report wrote to localStorage and
   only transmitted if `amv_feedback_endpoint` was set, a key no screen in the
   product could write, and /v1/feedback is the thumbs up/down counter above,
   which deliberately stores no content and would have refused a sentence. So
   somebody reporting a broken payment was thanked and their report sat in
   their own browser for ever.

   The screen at least stopped claiming otherwise. It still left a product that
   takes money with no way to be told it is broken, which is a refund and a
   chargeback for every problem that could have been a reply.

   Stored under the reporter's own email, which is not incidental: it is what
   puts support tickets on PER_USER_KINDS, so they are erased with the account
   and included in a data export like everything else the server holds. A
   support inbox is one of the easiest places to accumulate personal data that
   outlives the person who wrote it. */
const SUPPORT_MAX_LEN = 4000;
const SUPPORT_KEEP = 20;              // per account, newest first
const SUPPORT_KINDS = new Set(['bug', 'idea', 'billing', 'account', 'other']);

async function supportSubmit(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in first, or email support directly' }, 401);
  /* Reaching a human is worth spending real money on, so it is worth abusing.
     Generous for a person with a bad day, useless as an amplifier. */
  const blocked = await guardAction(env, `support:${user.email}`, 5, 20, 'support messages');
  if (blocked) return blocked;

  const body = await request.json().catch(() => ({}));
  const text = String(body.text || '').trim().slice(0, SUPPORT_MAX_LEN);
  if (text.length < 5) return json({ error: 'please describe what happened' }, 400);
  const kind = SUPPORT_KINDS.has(body.kind) ? body.kind : 'other';
  /* Context the reporter did not have to think to include, and nothing more.
     No conversation content: somebody reporting that chat is broken has not
     agreed to send us what they were chatting about. */
  const ticket = {
    id: 'sup_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    kind, text, at: Date.now(),
    plan: String(body.plan || '').slice(0, 16),
    tab: String(body.tab || '').replace(/[^a-z_-]/gi, '').slice(0, 24),
    app: String(body.app || '').slice(0, 24),
    status: 'open',
  };

  /* AMV-033: two tickets submitted from two tabs both read the list, both
     prepend, and the later write loses the earlier ticket - somebody who asked
     for help and was told it was sent. */
  await _withKind(env, 'support', user.email, (rec) => {
    rec.tickets = [ticket].concat(Array.isArray(rec.tickets) ? rec.tickets : []).slice(0, SUPPORT_KEEP);
    rec.updatedAt = Date.now();
  }, { tickets: [] });

  /* Told to the operator NOW. A ticket that only exists until somebody thinks
     to open an admin page is barely better than one in a browser. Not
     alertOnce: every report is a different person, and collapsing them is how
     the second one is never seen. */
  let notified = false;
  try {
    await notify(env, `📮 ${kind} report from ${user.email}` + (ticket.plan ? ` (${ticket.plan})` : '')
      + `:\n${text.slice(0, 500)}`);
    notified = !!env.ALERT_WEBHOOK;
  } catch (e) {}
  audit(env, 'support_submitted', { email: user.email, kind, id: ticket.id });

  /* What actually happened, so the screen cannot thank somebody for a delivery
     that did not occur. Stored is true either way; reaching a person is not. */
  return json({ ok: true, id: ticket.id, stored: true, notified,
                support: env.SUPPORT_EMAIL || '' });
}

/* The operator's inbox. Behind the admin token like every other operator
   surface - it contains other people's words about their own accounts. */
async function supportInbox(request, env) {
  /* AMV-052: through the SAME gate as every other admin route. This was a bare
     token comparison with no rate limit, so three of the sixteen admin routes
     were an unbounded channel for guessing the token while the other thirteen
     were not - and an attacker only has to find the unbounded one. */
  { const g = await _adminGate(request, env, 'read', 60, 2000); if (g) return g; }
  const { rows, truncated } = await scan(env, 'support', SUPPORT_SCAN_LIMIT, 'support inbox');
  const out = [];
  for (const row of rows) {
    for (const t of ((row.value || {}).tickets || [])) out.push(Object.assign({ email: row.id }, t));
  }
  out.sort((a, b) => (b.at || 0) - (a.at || 0));
  /* Two separate ways this list is not everything, and an unanswered customer
     is the cost of either: more accounts than the scan read, and more tickets
     than the page shows. Both are stated rather than implied by a short list. */
  const shown = out.slice(0, 200);
  return json({ ok: true, tickets: shown, accounts: rows.length,
                truncated: truncated || out.length > shown.length,
                totalTickets: out.length,
                note: truncated
                  ? 'More accounts have tickets than this scan read - there is unseen mail beyond this list.'
                  : (out.length > shown.length
                      ? 'Showing the ' + shown.length + ' newest of ' + out.length + ' tickets.' : null) });
}

/* Approval rate per engine, for the dashboard and the weekly digest. A rate
   with almost no votes behind it is noise, so the count travels with it and
   the rate is null until there is enough to mean anything. */
async function _qualityReport(env) {
  const mk = monthKey();
  const MIN_VOTES = 10;
  const out = { engines: [], features: [], reasons: [], month: mk };
  for (const key of Object.keys(ENGINES)) {
    const up = (await counter(env, `qual:${key}:up:${mk}`, { op: 'get' })).value || 0;
    const down = (await counter(env, `qual:${key}:down:${mk}`, { op: 'get' })).value || 0;
    const total = up + down;
    out.engines.push({ engine: key, up, down, votes: total,
      approvalPct: total >= MIN_VOTES ? +((up / total) * 100).toFixed(1) : null });
  }
  for (const feat of ['chat', 'research', 'code', 'agent', 'automation']) {
    const up = (await counter(env, `qualfeat:${feat}:up:${mk}`, { op: 'get' })).value || 0;
    const down = (await counter(env, `qualfeat:${feat}:down:${mk}`, { op: 'get' })).value || 0;
    const total = up + down;
    if (total) out.features.push({ feature: feat, up, down, votes: total,
      approvalPct: total >= MIN_VOTES ? +((up / total) * 100).toFixed(1) : null });
  }
  for (const why of FEEDBACK_REASONS) {
    const n = (await counter(env, `qualwhy:${why}:${mk}`, { op: 'get' })).value || 0;
    if (n) out.reasons.push({ reason: why, count: n });
  }
  out.reasons.sort((a, b) => b.count - a.count);
  const allUp = out.engines.reduce((n, e) => n + e.up, 0);
  const allDown = out.engines.reduce((n, e) => n + e.down, 0);
  out.votes = allUp + allDown;
  out.approvalPct = out.votes >= MIN_VOTES ? +((allUp / out.votes) * 100).toFixed(1) : null;
  out.minVotes = MIN_VOTES;
  return out;
}

