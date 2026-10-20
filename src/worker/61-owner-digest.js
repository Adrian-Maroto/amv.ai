/* =====================================================================
   AMV-081  THE WEEKLY OWNER DIGEST

   Every number below already existed. Signups, activation, referral
   conversions, per-plan margin, cost per paying user, money at risk - all of
   it computed, all of it correct, and all of it sitting on a dashboard that
   only reports what is true at the instant somebody remembers to open it.

   A dashboard tells you the state. A digest tells you the CHANGE, on a
   schedule, without being asked - which is the difference between having
   metrics and being run by them. So this stores a snapshot each week and
   reports the delta against the last one, in the order the questions actually
   get asked: is it growing, does it make money, and what is on fire.

   Rules it keeps:
     - It never invents a comparison. The first week says "no previous week",
       because that is what is true.
     - It sends at most once per week, claimed atomically, so a cron that fires
       twice does not mail twice.
     - With nothing configured it does nothing and says why in the log, rather
       than failing the cron tick that also runs everyone's automations.
   ===================================================================== */

/* Monday-anchored week key, so a digest belongs to a week rather than to
   whenever the cron happened to fire. */
function _weekKey(ts) {
  const d = new Date(ts || Date.now());
  const day = (d.getUTCDay() + 6) % 7;                 // Monday = 0
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  return new Date(monday).toISOString().slice(0, 10);
}

/* The owner's numbers, read through the same admin endpoint the dashboard uses
   so the digest and the screen can never drift apart. Returns null when there
   is no admin token configured - with no admin surface there is nothing to
   report, and inventing a second path into these numbers would be a second
   thing to secure. */
async function _ownerMetrics(env) {
  if (!env.ADMIN_TOKEN) return null;
  const r = await adminStats(new Request('https://internal/v1/admin/stats', {
    headers: { Authorization: 'Bearer ' + env.ADMIN_TOKEN },
  }), env);
  if (!r || r.status !== 200) return null;
  const m = await r.json().catch(() => null);
  if (!m) return null;

  /* AMV-194: WHAT IS WAITING ON A PERSON.

     The support inbox and the abuse review are real routes behind the admin
     token, and no screen calls either - the moderation card in the dashboard
     still says "pending". That is a defensible way to build them and a terrible
     way to run them: a customer files a complaint, it is stored correctly, and
     the only way anybody reads it is remembering to curl an endpoint. An
     unanswered support ticket is churn that never explains itself.

     So the digest - the one thing that already arrives without being asked for
     - carries the count. Cheap to gather, and it turns "I must remember to
     check" into "something told me". */
  try {
    const { rows: sup } = await scan(env, 'support', SUPPORT_SCAN_LIMIT, 'digest: support waiting');
    let open = 0, oldest = 0;
    for (const row of sup) {
      for (const t of ((row.value || {}).tickets || [])) {
        if (t && t.status === 'closed') continue;
        open++;
        if (t && t.at && (!oldest || t.at < oldest)) oldest = t.at;
      }
    }
    const { rows: ab } = await scan(env, 'abuse', 5000, 'digest: abuse flags');
    const flagged = ab.filter(x => (x.value || {}).blocked).length;
    m.waiting = { support: open, supportOldestDays: oldest ? Math.floor((Date.now() - oldest) / 86400000) : 0,
                  flagged };
  } catch (e) { /* the digest is worth sending without this */ }
  return m;
}

/* The handful of figures worth carrying week to week. Deliberately small: a
   snapshot that stores everything becomes a second source of truth to keep
   correct, and nobody compares forty numbers. */
function _digestSnapshot(m) {
  const g = m.growth || {}, rev = m.revenue || {}, mar = m.margin || {}, u = m.users || {};
  return {
    at: Date.now(),
    signups7: +g.signups7 || 0,
    referrals7: +g.referrals7 || 0,
    activeToday: +u.activeToday || 0,
    paying: +u.paying || 0,
    totalUsers: +u.total || 0,
    mrr: +rev.estMRR || 0,
    mrrAtRisk: +rev.mrrAtRisk || 0,
    grossMargin: +mar.grossMargin || 0,
    grossMarginPct: mar.grossMarginPct === null ? null : +mar.grossMarginPct,
    costPerPayingUser: +mar.costPerPayingUser || 0,
    freeUserCost: +mar.freeUserCost || 0,
    monthlyCost: +mar.estMonthlyCost || 0,
    unprofitable: (mar.unprofitableAccounts || []).length,
    approvalPct: (m.quality && m.quality.approvalPct != null) ? m.quality.approvalPct : null,
    qualityVotes: (m.quality && m.quality.votes) || 0,
    avgFirstTokenMs: (m.speed && m.speed.avgFirstTokenMs != null) ? m.speed.avgFirstTokenMs : null,
    activatedPct: (m.funnel && m.funnel.activatedPct != null) ? m.funnel.activatedPct : null,
    returnedPct: (m.funnel && m.funnel.returnedPct != null) ? m.funnel.returnedPct : null,
    paidPct: (m.funnel && m.funnel.paidPct != null) ? m.funnel.paidPct : null,
    avgDaysToPay: (m.funnel && m.funnel.avgDaysToPay != null) ? m.funnel.avgDaysToPay : null,
    teamSeatsSold: (m.revenue && m.revenue.teamSeatsSold) || 0,
  };
}

/* "12 (+3)" - and nothing at all when there is no previous week, because an
   invented baseline is worse than no baseline. */
function _delta(now, before, opts) {
  const o = opts || {};
  const fmt = v => (o.money ? '$' + (+v).toFixed(o.dp == null ? 2 : o.dp)
                            : (o.pct ? (+v).toFixed(1) + '%' : String(Math.round(v))));
  if (before == null || !Number.isFinite(before)) return fmt(now);
  const d = now - before;
  if (Math.abs(d) < 1e-9) return fmt(now) + ' (no change)';
  return fmt(now) + ' (' + (d > 0 ? '+' : '-') + fmt(Math.abs(d)) + ')';
}

/* Build the digest. Returns { subject, html, text, snapshot, previous } so it
   can be previewed without being sent - the same content either way, which is
   the only way a preview is worth anything. */
function _buildDigest(m, prev) {
  const snap = _digestSnapshot(m);
  const g = m.growth || {}, mar = m.margin || {};
  const p = prev || null;
  const pv = k => (p ? p[k] : null);

  const rows = [
    ['Signups this week',      _delta(snap.signups7, pv('signups7'))],
    ['Of those, from invites', (snap.referrals7 || 0) + (g.referralSharePct != null ? ' (' + g.referralSharePct + '% of signups)' : '')],
    ['Active today',           _delta(snap.activeToday, pv('activeToday'))],
    /* The funnel, in the order somebody moves through it. These four lines are
       the only ones on this page that say whether the product WORK is landing -
       everything else says how the business is doing today (AMV-101). */
    ['Got a real answer',      snap.activatedPct == null ? 'not enough signups yet'
                                 : _delta(snap.activatedPct, pv('activatedPct'), { pct: true }) + ' of signups'],
    ['Came back another day',  snap.returnedPct == null ? 'not enough signups yet'
                                 : _delta(snap.returnedPct, pv('returnedPct'), { pct: true }) + ' of signups'],
    ['Went on to pay',         snap.paidPct == null ? 'not enough signups yet'
                                 : _delta(snap.paidPct, pv('paidPct'), { pct: true }) + ' of signups'],
    ['Time from signup to pay', snap.avgDaysToPay == null ? 'nobody has paid yet'
                                 : _delta(snap.avgDaysToPay, pv('avgDaysToPay')) + ' days on average'],
    ['Paying accounts',        _delta(snap.paying, pv('paying'))],
    ['Team seats sold',        _delta(snap.teamSeatsSold, pv('teamSeatsSold'))],
    ['MRR',                    _delta(snap.mrr, pv('mrr'), { money: true })],
    ['MRR at risk',            _delta(snap.mrrAtRisk, pv('mrrAtRisk'), { money: true })],
    ['Gross margin',           _delta(snap.grossMargin, pv('grossMargin'), { money: true })
                               + (snap.grossMarginPct != null ? ' (' + snap.grossMarginPct + '%)' : '')],
    ['Cost per paying user',   _delta(snap.costPerPayingUser, pv('costPerPayingUser'), { money: true, dp: 3 })],
    ['Cost of the free tier',  _delta(snap.freeUserCost, pv('freeUserCost'), { money: true })],
    ['Wait for the first word', snap.avgFirstTokenMs == null
                                 ? 'not measured yet'
                                 : _delta(snap.avgFirstTokenMs, pv('avgFirstTokenMs')) + ' ms'],
    ['Answers rated good',     snap.approvalPct == null
                                 ? 'not enough ratings yet'
                                 : _delta(snap.approvalPct, pv('approvalPct'), { pct: true })
                                   + ' (' + snap.qualityVotes + ' rating' + (snap.qualityVotes === 1 ? '' : 's') + ')'],
  ];

  /* What to actually DO. Only stated when the numbers say it - a digest that
     ends with advice every week is a digest nobody finishes reading. */
  const flags = [];
  /* Somebody is waiting on a person, and there is no screen that shows it. */
  const waiting = (m && m.waiting) || {};
  if (waiting.support > 0) {
    flags.push(waiting.support + ' support message' + (waiting.support > 1 ? 's are' : ' is') + ' waiting for a reply'
      + (waiting.supportOldestDays > 0 ? ', the oldest for ' + waiting.supportOldestDays + ' day' + (waiting.supportOldestDays > 1 ? 's' : '') : '')
      + '. Nobody is emailed when one arrives, so this line is the only thing that will tell you.');
  }
  if (waiting.flagged > 0) {
    flags.push(waiting.flagged + ' account' + (waiting.flagged > 1 ? 's are' : ' is') + ' blocked for chargeback or refund abuse. '
      + 'Worth a look in case any of them is a real customer caught by a pattern.');
  }
  if (snap.mrrAtRisk > 0)
    flags.push('$' + snap.mrrAtRisk.toFixed(2) + ' of MRR is on cards that failed. Those accounts drop to Free when their grace period ends.');
  if (snap.unprofitable > 0)
    flags.push(snap.unprofitable + ' account' + (snap.unprofitable > 1 ? 's cost' : ' costs') + ' more than it pays. They are named on the dashboard.');
  if (snap.grossMarginPct != null && snap.grossMarginPct < 50)
    flags.push('Gross margin is ' + snap.grossMarginPct + '%. Below 50% the plan pricing or the model routing needs a look.');
  if (p && snap.signups7 < pv('signups7'))
    flags.push('Signups fell from ' + pv('signups7') + ' to ' + snap.signups7 + ' week on week.');
  if (snap.paying === 0 && snap.totalUsers > 0)
    flags.push('No paying accounts yet against ' + snap.totalUsers + ' signups. Every cost below is being carried by nothing.');
  if (m.spend && m.spend.killed)
    flags.push('The global kill switch is ON. Nobody can use AMV right now.');
  /* A quality drop is the one thing that will not show up anywhere else until
     it shows up as churn, by which point it is months old. */
  if (snap.avgFirstTokenMs != null && snap.avgFirstTokenMs > 3000)
    flags.push('The average wait for the first word is ' + snap.avgFirstTokenMs + 'ms. Past about three seconds people assume it is broken.');
  if (p && pv('avgFirstTokenMs') != null && snap.avgFirstTokenMs != null
      && snap.avgFirstTokenMs > pv('avgFirstTokenMs') * 1.5)
    flags.push('AMV got noticeably slower to start: ' + pv('avgFirstTokenMs') + 'ms to ' + snap.avgFirstTokenMs + 'ms.');
  if (snap.approvalPct != null && snap.approvalPct < 70)
    flags.push('Only ' + snap.approvalPct + '% of rated answers were rated good. Something in routing or prompting is worth looking at.');
  /* Each of these points at a different problem, which is the whole reason for
     measuring the steps separately rather than only counting conversions. */
  if (snap.activatedPct != null && snap.activatedPct < 50)
    flags.push('Only ' + snap.activatedPct + '% of signups ever got a real answer out of AMV. That is a first-screen problem, not a pricing one.');
  else if (snap.returnedPct != null && snap.returnedPct < 25)
    flags.push('Only ' + snap.returnedPct + '% of signups came back on a second day. People are getting an answer and not finding a reason to return.');
  else if (snap.paidPct != null && snap.paidPct < 2 && snap.activatedPct != null && snap.activatedPct > 50)
    flags.push('People are using AMV (' + snap.activatedPct + '% activated) but only ' + snap.paidPct + '% pay. The limits or the upgrade moment are worth a look, not the onboarding.');
  if (p && pv('approvalPct') != null && snap.approvalPct != null && snap.approvalPct < pv('approvalPct') - 5)
    flags.push('Answer quality fell from ' + pv('approvalPct') + '% to ' + snap.approvalPct + '% week on week.');
  const worstReason = (m.quality && (m.quality.reasons || [])[0]);
  if (worstReason && worstReason.count >= 5)
    flags.push('The most common complaint was "' + worstReason.reason.replace(/_/g, ' ') + '" (' + worstReason.count + ' times).');

  const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const appUrl = String(_digestAppUrl(m) || '').replace(/\/$/, '');
  const week = _weekKey();
  const subject = 'AMV weekly: ' + snap.signups7 + ' signups, $' + snap.mrr.toFixed(0) + ' MRR';

  const rowsHtml = rows.map(([k, v]) =>
    '<tr><td style="padding:7px 0;font-size:13px;color:#666">' + esc(k) + '</td>' +
    '<td style="padding:7px 0;font-size:13px;color:#111;text-align:right;font-weight:600">' + esc(v) + '</td></tr>').join('');
  const flagsHtml = flags.length
    ? '<div style="margin-top:22px;padding:14px;border-radius:10px;background:#fff8e6;border:1px solid #f0dca8">' +
      '<div style="font-size:12px;font-weight:700;color:#8a6d1f;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Needs a decision</div>' +
      flags.map(f => '<div style="font-size:13px;line-height:1.6;color:#5c4a14;margin-bottom:6px">' + esc(f) + '</div>').join('') +
      '</div>'
    : '<p style="margin:22px 0 0;font-size:13px;color:#777">Nothing needs a decision this week.</p>';

  const html = _emailShell(
    'Week of ' + week,
    (p ? '<p style="margin:0 0 16px;font-size:13px;color:#777">Compared with the week before.</p>'
       : '<p style="margin:0 0 16px;font-size:13px;color:#777">First digest, so there is nothing to compare against yet.</p>') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + rowsHtml + '</table>' + flagsHtml,
    appUrl ? { label: 'Open the dashboard', url: appUrl } : null,
    '<hr style="border:none;border-top:1px solid #eee;margin:18px 0"><p style="margin:0;font-size:11px;color:#999">Sent once a week to the AMV owner. These are the same figures as the founder dashboard.</p>',
    'AMV weekly digest.'
  );

  const text = 'AMV weekly - week of ' + week + '\n\n'
    + rows.map(([k, v]) => k + ': ' + v).join('\n')
    + (flags.length ? '\n\nNeeds a decision:\n' + flags.map(f => '- ' + f).join('\n') : '\n\nNothing needs a decision this week.')
    + (appUrl ? '\n\n' + appUrl : '');

  return { subject, html, text, snapshot: snap, previous: p, flags, week };
}
/* The dashboard payload does not carry the app URL, and threading env through
   the builder purely for one link would make it harder to test. This keeps the
   builder pure and lets the caller attach it to the metrics it passes in. */
function _digestAppUrl(m) { return (m && m._appUrl) || ''; }

/* Run it. Claimed once per week so a doubled cron cannot mail twice. */
async function runWeeklyDigest(env) {
  const week = _weekKey();
  const to = String(env.OWNER_EMAIL || '').toLowerCase().trim();
  if (!to || !env.EMAIL_API_KEY || !env.ADMIN_TOKEN) {
    return { sent: false, reason: !to ? 'no OWNER_EMAIL' : (!env.EMAIL_API_KEY ? 'no email provider' : 'no ADMIN_TOKEN') };
  }
  // Atomic, so two overlapping cron invocations cannot both send.
  if (!(await _claimOnce(env, 'digest', week, 40 * 86400))) return { sent: false, reason: 'already sent this week' };

  const m = await _ownerMetrics(env);
  if (!m) { return { sent: false, reason: 'metrics unavailable' }; }
  m._appUrl = env.APP_URL || env.APP_ORIGIN || '';

  let prev = null;
  try { prev = JSON.parse(await env.AMV_KV.get('digestsnap') || 'null'); } catch (e) { prev = null; }

  const d = _buildDigest(m, prev);
  const ok = await _sendEmail(env, to, d.subject, d.html, d.text, 'owner');
  if (!ok) {
    /* Nothing was delivered, so two things must not happen: this snapshot must
       not become the baseline for a week the owner never saw - that would
       quietly under-report the next change - and the week must not stay
       claimed, or one provider hiccup silently costs a whole digest. Give the
       week back and the next tick tries again. */
    await _releaseClaim(env, 'digest', week);
    audit(env, 'digest_failed', { week });
    await alertOnce(env, 'digest_fail', 'Weekly owner digest could not be delivered - the email provider rejected it.', 720);
    return { sent: false, reason: 'delivery failed', week };
  }
  // Stored only after a delivery that actually happened.
  await env.AMV_KV.put('digestsnap', JSON.stringify(d.snapshot), { expirationTtl: 120 * 86400 });
  audit(env, 'digest_sent', { week, signups7: d.snapshot.signups7, mrr: d.snapshot.mrr });
  return { sent: true, week, flags: d.flags.length };
}

/* GET/POST /admin/digest - preview it now, or send it now.

   Preview is the default and changes nothing. Sending is an outward-facing
   action, so it takes an explicit flag rather than happening because someone
   opened a URL. */
async function adminDigest(request, env) {
  { const g = await _adminGate(request, env, 'digest', 60, 2000); if (g) return g; }
  const url = new URL(request.url);
  const send = url.searchParams.get('send') === '1';
  if (send) {
    /* Release this week's claim so an explicit request is honoured rather than
       silently swallowed by the once-a-week guard. Through the helper, because
       the claim lives in the Durable Object, D1 or KV depending on what is
       configured - deleting one KV key would miss it in two of three cases. */
    await _releaseClaim(env, 'digest', _weekKey());
    const r = await runWeeklyDigest(env);
    return json({ ok: !!r.sent, ...r });
  }
  const m = await _ownerMetrics(env);
  if (!m) return json({ error: 'metrics unavailable' }, 503);
  m._appUrl = env.APP_URL || env.APP_ORIGIN || '';
  let prev = null;
  try { prev = JSON.parse(await env.AMV_KV.get('digestsnap') || 'null'); } catch (e) {}
  const d = _buildDigest(m, prev);
  return json({ ok: true, preview: true, week: d.week, subject: d.subject,
                snapshot: d.snapshot, previous: d.previous, flags: d.flags, text: d.text });
}

// flip the global kill switch on/off
/* NOTIFY ME, KEPT. Somebody pressed Notify me on an app AMV could not connect;
   when it can, the operator presses "Tell them" in the dashboard and each of
   them gets one email saying so.

   Once per person per app, ever: a claim is taken before each send, so a
   second press, a retry after a timeout, or two operators at once cannot
   email anybody twice. Their waitlist entry is removed after a send that went
   through - so the dashboard's count is "still waiting" - and kept when the
   send failed, so the next press reaches them. Bounded per press; the reply
   says how many are left rather than implying it reached everyone.

   The app's name comes from the operator, and is checked to be a plain name:
   it goes into an email subject in front of people who asked for it. */
const WAITLIST_NOTIFY_PER_CALL = 300;
async function adminWaitlistNotify(request, env) {
  { const g = await _adminGate(request, env, 'waitlist', 10, 200); if (g) return g; }
  const body = await request.json().catch(() => ({}));
  const slug = String(body.app || '');
  const name = String(body.name || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(slug)) return json({ error: 'Which app? Send its slug, as the dashboard lists it.' }, 400);
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .&+'’-]{0,39}$/u.test(name)) return json({ error: 'Give the app’s name in plain words.' }, 400);
  if (!_emailReaches(env)) return json({ error: 'Email is not set up to reach people yet (EMAIL_API_KEY and RESET_EMAIL_FROM), so nobody can be told. Nothing was sent.', code: 'needs_service' }, 503);
  const origin = String(env.APP_URL || '').replace(/\/$/, '');
  const prefix = 'waitlist:app-' + slug + ':';
  let sent = 0, failed = 0, skipped = 0, cursor, more = false;
  outer: do {
    const page = await env.AMV_KV.list({ prefix, cursor, limit: 1000 });
    for (const k of page.keys) {
      if (sent + failed >= WAITLIST_NOTIFY_PER_CALL) { more = true; break outer; }
      const email = String(k.name).slice(prefix.length).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { skipped++; continue; }
      if (!(await _claimOnce(env, 'wlnotify', slug + ':' + email, CLAIM_ONCE_TTL_S))) { skipped++; try { await env.AMV_KV.delete(k.name); } catch (e) {} continue; }
      const ok = await _sendEmail(env, email, name + ' now connects in AMV',
        _emailShell(name + ' connects now',
          `<p style="margin:0 0 22px;font-size:14px;line-height:1.65;color:#555">You asked AMV to tell you when <b>${_escHtml(name)}</b> could be connected. It can now - open Connectors in AMV and connect it in a few taps.</p>`,
          origin ? { label: 'Open Connectors', url: origin + '/#/integrations' } : null,
          '', 'You received this because you pressed Notify me for ' + name + '. This is the only email about it.'),
        `You asked AMV to tell you when ${name} could be connected. It can now - open Connectors in AMV to connect it.${origin ? '\n\n' + origin + '/#/integrations' : ''}\n\nYou received this because you pressed Notify me for ${name}. This is the only email about it.`,
        'waitlist');
      if (ok) { sent++; try { await env.AMV_KV.delete(k.name); } catch (e) {} }
      else { failed++; await _releaseClaim(env, 'wlnotify', slug + ':' + email); }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  audit(env, 'waitlist_notified', { app: slug, sent, failed });
  return json({ ok: true, sent, failed, skipped, more });
}

async function adminKill(request, env) {
  { const g = await _adminGate(request, env, 'kill', 60, 2000); if (g) return g; }
  const { on } = await request.json().catch(() => ({}));
  if (on) await env.AMV_KV.put('GLOBAL_KILL', '1');
  else await env.AMV_KV.delete('GLOBAL_KILL');
  audit(env, 'admin_kill', { on: !!on });
  return json({ ok: true, killed: !!on });
}

// inspect one user, or override their plan (e.g. comp an account, stop abuse)
async function adminUser(request, env) {
  { const g = await _adminGate(request, env, 'user.write', 60, 2000); if (g) return g; }
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  if (!email) return json({ error: 'email required' }, 400);
  const month = monthKey(), today = todayKey();

  if (body.action === 'setPlan' && body.plan) {
    await setEntitlement(env, email, body.plan, { source: 'admin' });
    audit(env, 'admin_set_plan', { email, plan: body.plan });
    return json({ ok: true, email, plan: body.plan });
  }
  if (body.action === 'revoke') {
    await revokeUserTokens(env, email);   // force re-login everywhere
    audit(env, 'admin_revoke', { email });
    return json({ ok: true, revoked: email });
  }
  // default: inspect
  const ent = await DB.get(env, 'ent', email);
  /* Read the counters this account actually spends against. A team member's own
     key is empty by design, and showing an operator three zeros for somebody who
     is using the product every day would be worse than showing nothing. */
  const sub = await _billingSubjectOf(env, email, ent);
  const monthCost = (await counter(env, `cost:${sub.subject}:${month}`, { op: 'get' })).value || 0;
  const monthTok = (await counter(env, `usg:${sub.subject}:${month}`, { op: 'get' })).value || 0;
  const dayTok = (await counter(env, `usg:${sub.subject}:${today}`, { op: 'get' })).value || 0;
  return json({
    ok: true, email,
    entitlement: ent || { plan: 'free' },
    team: sub.teamId ? { id: sub.teamId, role: sub.teamRole, plan: sub.plan, shared: sub.subject !== email } : null,
    usage: { dayTokens: dayTok, monthTokens: monthTok, monthCostUSD: +monthCost.toFixed(3),
             subject: sub.subject, shared: sub.subject !== email },
  });
}


/* Verify a Stripe webhook signature (the t=…,v1=… scheme: HMAC-SHA256 of
   "timestamp.payload" with the webhook secret). Constant-time compared. */
async function verifyStripeSignature(secret, payload, sigHeader) {
  try {
    if (!secret || !sigHeader) return false;
    /* Stripe sends EVERY valid signature, and during a webhook-secret rotation
       that is more than one v1. Object.fromEntries keeps only the last, so if
       the configured secret produced the first one, verification failed and
       real events were rejected as forged - sales uncredited, at exactly the
       moment somebody is rotating a secret. All of them are considered. */
    let t = '';
    const v1s = [];
    for (const kv of sigHeader.split(',')) {
      const eq = kv.indexOf('=');
      if (eq < 0) continue;
      const k = kv.slice(0, eq).trim(), v = kv.slice(eq + 1).trim();
      if (k === 't') t = v;
      else if (k === 'v1') v1s.push(v);
    }
    if (!t || !v1s.length) return false;
    // reject very old timestamps (replay protection, 5 min tolerance)
    if (Math.abs(Date.now() / 1000 - parseInt(t, 10)) > 300) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
    const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
    // constant-time compare against each offered signature
    let matched = false;
    for (const v1 of v1s) {
      if (expected.length !== v1.length) continue;
      let diff = 0;
      for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
      if (diff === 0) matched = true;
    }
    return matched;
  } catch { return false; }
}

/* ---- PayPal: create a recurring SUBSCRIPTION (needs billing plan IDs) ----

   The only PayPal purchase route there is. A one-time ORDER pair used to sit
   here too (create + capture) and had to go: an order has no renewal, so the
   entitlement it granted had nothing that would ever expire or revoke it. One
   $15 payment bought Pro permanently, callable directly by any signed-in
   account. A subscription is the thing that keeps paying, and the webhook is
   what grants and revokes against it. */
async function paypalSubscribe(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_SECRET)
    return json({ error: 'PayPal is not connected on this deployment yet, so it cannot be used to pay. Nothing has been charged.',
                  code: 'needs_service' }, 503);
  /* AFTER the service check above, on purpose. If this deployment cannot take a
     payment at all, "confirm your age" asks somebody for their birth year
     under false pretences - they answer, and only then find out there is no
     processor. A configuration failure is about the deployment, not the
     person, and it is the operator who needs to read it.

     A minor cannot form a binding contract, which is exactly why their
     purchases come back as chargebacks - and a subscription is the longest one
     this product sells. `age_required` is a QUESTION, not a refusal: it means
     nobody has ever asked, which is true of every account that existed before
     the gate did. The client asks and retries, the same way buying already
     does, so an existing customer is asked once rather than walled out of
     renewing. 428 says "answer this first"; 403 is the actual no. */
  {
    const ageBad = await _moneyAgeGate(env, user.email);
    if (ageBad) return json(ageBad, ageBad.code === 'age_required' ? 428 : 403);
  }
  /* The same bound the card path has had all along, for the same reason: one
     account hammering this burns AMV's rate limit at PayPal, and the people
     who then cannot check out are everybody else. It was missing here because
     the rule that finds these knew Stripe's hostname and not PayPal's. */
  const pg = await guardAction(env, `paypalsub:${user.email}`, 10, 100, 'starting a subscription');
  if (pg) return pg;
  const { plan } = await request.json().catch(() => ({}));
  // PayPal subscriptions require a pre-created billing plan per tier. Map tier →
  // the plan id you set as a secret. If it's not set, say so honestly rather
  // than pretending to subscribe.
  const PLAN_IDS = { pro: env.PAYPAL_PLAN_PRO, elite: env.PAYPAL_PLAN_ELITE, ultra: env.PAYPAL_PLAN_ULTRA };
  const planId = PLAN_IDS[plan];
  if (!plan || !(plan in PLAN_IDS)) return json({ error: 'unknown plan' }, 400);
  if (!planId) return json({ error: 'PayPal subscriptions are not set up for this plan yet. Use card checkout.', code: 'paypal_sub_unconfigured' }, 503);

  const token = await _paypalToken(env);
  if (!token) return json({ error: 'paypal auth failed' }, 502);
  const appUrl = (env.APP_URL || '').replace(/\/$/, '');
  const r = await fetchDeadline(`${_paypalBase(env)}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan_id: planId,
      custom_id: `${user.email}|${plan}`,
      application_context: {
        brand_name: 'AMV',
        user_action: 'SUBSCRIBE_NOW',
        return_url: appUrl ? `${appUrl}/?paypal_sub=success` : undefined,
        cancel_url: appUrl ? `${appUrl}/?paypal_sub=cancel` : undefined,
      },
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: 'paypal subscribe failed' }, 502);
  // return the approval URL for the client to open
  const approve = (d.links || []).find(l => l.rel === 'approve');
  if (!approve) return json({ error: 'no approval url from paypal' }, 502);
  /* Same for PayPal: the subscription exists now, activation arrives later by
     webhook, and a lost activation is a customer paying for nothing. */
  await _pendStart(env, d.id, { provider:'paypal', email:user.email, plan });
  return json({ url: approve.href, id: d.id });
}

// ---- PayPal: capture an approved order, then grant entitlement ----
// ---- PayPal: webhook (for renewals/disputes/refunds) ----
async function paypalWebhook(request, env, ctx) {
  const raw = await request.text();
  // PayPal webhook verification requires an API call to /v1/notifications/verify-webhook-signature.
  const verified = await verifyPaypalWebhook(env, request.headers, raw);
  if (!verified) { audit(env, 'forged_webhook', { kind: 'paypal' }); return new Response('bad signature', { status: 400 }); }
  let evt; try { evt = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }
  /* AMV-201: the same exactly-once guarantee Stripe has had. PayPal redelivers
     an event until it gets a 200, and every redelivery was being processed
     again here. Most handlers happen to be idempotent, but "happens to be" is
     not a guarantee, and the two money paths should not have different ones.
     Released below if handling genuinely fails, so a real failure is still
     allowed to be retried. */
  if (evt.id && !(await _claimOnce(env, 'paypalevt', evt.id, CLAIM_ONCE_TTL_S))) {
    return new Response('ok', { status: 200 });
  }
  /* AMV-200: when it happened. PayPal gives no ordering guarantee either, so a
     retried older event can arrive after a newer one - a cancellation followed
     by a stale "still active" would put a cancelled customer back on a paid
     plan, free. */
  const evtAt = Date.parse(evt.create_time || evt.resource?.create_time || '') || Date.now();
  try {
    const custom = evt.resource?.custom_id || '';
    const [email, claimedPlan] = custom.split('|');
    /* AMV-007: which PayPal subscription this event is about. A subscription
       event IS the subscription; a sale names the agreement it was taken under.
       A refund of a one-off capture names neither, and correctly makes no
       ownership claim. */
    const ppSub = evt.resource?.billing_agreement_id
               || (/^BILLING\.SUBSCRIPTION\./.test(evt.event_type || '') ? (evt.resource?.id || '') : '')
               || '';
    if (evt.event_type === 'PAYMENT.CAPTURE.REFUNDED' || evt.event_type === 'BILLING.SUBSCRIPTION.CANCELLED'
        || evt.event_type === 'BILLING.SUBSCRIPTION.EXPIRED') {
      if (email) await setEntitlement(env, email.toLowerCase(), 'free', { source: 'paypal', canceled: true, eventAt: evtAt, sub: ppSub });
    } else if (evt.event_type === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED'
            || evt.event_type === 'BILLING.SUBSCRIPTION.SUSPENDED') {
      // Same rule as Stripe: a failed payment does not buy another month.
      if (email) await _markPastDue(env, email.toLowerCase(), { provider: 'paypal', event: evt.event_type });
    } else if (evt.event_type === 'BILLING.SUBSCRIPTION.ACTIVATED'
            || evt.event_type === 'BILLING.SUBSCRIPTION.RE-ACTIVATED'
            || evt.event_type === 'PAYMENT.SALE.COMPLETED') {
      /* THE PLAN THEY PAID FOR, WHICH NOTHING HERE USED TO GRANT.

         This branch called _clearPastDue and stopped. _clearPastDue returns
         immediately when there is no pastDueSince - which is the state every
         NEW subscriber is in - so activation did nothing at all. The only
         setEntitlement on this whole path set the plan to 'free', on
         cancellation. custom_id has carried the tier since the day it was
         written and the line above discarded it.

         So PayPal took a recurring payment, every month, and the customer
         stayed on the free plan. Nothing errored, nothing was logged, and the
         one thing that would have caught it - somebody paying by PayPal - is
         not something the tests did. It is the worst shape a defect can have
         in this product: money in, nothing out, silently.

         The tier is taken from the plan PayPal is ACTUALLY billing wherever
         that is knowable, and only falls back to the echoed custom_id. Both
         arrive inside a signature-verified webhook, but one of them is what
         the customer is being charged for and the other is what a client
         claimed at checkout time - and if they ever disagree, the charge is
         the truth. */
      const em = String(email || '').toLowerCase();
      if (em) {
        const tier = _paypalTierOf(env, evt.resource?.plan_id, claimedPlan);
        if (tier) {
          const cur = await DB.get(env, 'ent', em);
          /* renewedAt moves on every successful payment, so the renewal sweep
             sees a live subscription rather than revoking one that is being
             paid for. */
          if (!cur || cur.plan !== tier || cur.pastDueSince) {
            await setEntitlement(env, em, tier, { source: 'paypal', eventAt: evtAt, sub: ppSub });
          } else {
            /* AMV-202: a renewal touch-up is still an entitlement write, and a
               webhook is exactly when another one is likely to be in flight. */
            await _withEnt(env, em, (rec) => {
              if (!rec) return null;
              rec.renewedAt = Date.now();
              delete rec.pastDueSince;
            });
          }
          audit(env, 'paypal_grant', { email: em, plan: tier, event: evt.event_type });
        } else {
          /* Paid, and AMV cannot tell what for. Never guess a tier - guessing
             high gives away product and guessing low shortchanges somebody who
             paid. It is a real failure and it needs a human. */
          audit(env, 'paypal_unmapped_plan', { email: em, planId: evt.resource?.plan_id || '', claimed: claimedPlan || '' });
          try { await alertOnce(env, 'paypal_unmapped',
            'A PayPal payment arrived for a plan AMV cannot map to a tier (plan_id: '
            + (evt.resource?.plan_id || 'none') + '). The customer has PAID and has NOT been granted anything. '
            + 'Check PAYPAL_PLAN_PRO / _ELITE / _ULTRA match the billing plans in PayPal.', 5); } catch (_) {}
        }
        await _clearPastDue(env, em);
        /* Finished the normal way, so the sweep has nothing to chase. The id is
           the subscription's, which is what _pendStart recorded. */
        await _pendDone(env, evt.resource?.id || '');
      }
    }
  } catch (e) {
    audit(env, 'webhook_error', { kind: 'paypal', msg: String(e.message).slice(0, 120) });
    /* AMV-008: RELEASING THE CLAIM IS HALF OF A RETRY. THE STATUS IS THE OTHER.

       This released the claim and then fell through to the 200 below, so PayPal
       recorded the delivery as handled and never sent it again. The comment
       here said "let PayPal's retry reprocess it" while the code was the reason
       no retry would come. A customer paid, processing threw, and they were
       charged with no plan - and nothing anywhere reported a failure.

       A webhook is acknowledged when the work is durable, never before. The
       claim goes back so the redelivery is not mistaken for a duplicate, and
       the status tells PayPal to send it. */
    if (evt.id) { try { await _releaseClaim(env, 'paypalevt', evt.id); } catch (_) {} }
    try { await alertOnce(env, 'paypal_webhook_failed',
      'A PayPal webhook failed to process and was returned for retry. Event '
      + (evt && evt.id ? evt.id : 'unknown') + ' type ' + (evt && evt.event_type ? evt.event_type : 'unknown')
      + '. If this repeats, a payment may be taken with no plan granted.', 15); } catch (_) {}
    return new Response('retry', { status: 503, headers: { ...CORS } });
  }
  return json({ received: true });
}

/* Which AMV tier a PayPal billing plan corresponds to.

   Prefers the plan id PayPal is really charging against, because that is what
   the customer's money is buying. The tier echoed back in custom_id is a
   fallback for events that do not carry a plan id, and is validated against the
   known tiers rather than trusted as a string - it round-trips through the
   client, and a tier is an entitlement. */
function _paypalTierOf(env, planId, claimed) {
  const byId = {
    [env.PAYPAL_PLAN_PRO || '\u0000none-pro']: 'pro',
    [env.PAYPAL_PLAN_ELITE || '\u0000none-elite']: 'elite',
    [env.PAYPAL_PLAN_ULTRA || '\u0000none-ultra']: 'ultra',
  };
  const fromId = planId ? byId[String(planId)] : null;
  if (fromId) return fromId;
  const c = String(claimed || '').toLowerCase();
  return (c === 'pro' || c === 'elite' || c === 'ultra') ? c : null;
}

function _paypalBase(env) { return env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'; }
async function _paypalToken(env) {
  try {
    const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`);
    const r = await fetchDeadline(`${_paypalBase(env)}/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const d = await r.json();
    return d.access_token || null;
  } catch { return null; }
}
async function verifyPaypalWebhook(env, headers, body) {
  try {
    if (!env.PAYPAL_WEBHOOK_ID) return false;
    const token = await _paypalToken(env);
    if (!token) return false;
    const r = await fetchDeadline(`${_paypalBase(env)}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: headers.get('paypal-auth-algo'),
        cert_url: headers.get('paypal-cert-url'),
        transmission_id: headers.get('paypal-transmission-id'),
        transmission_sig: headers.get('paypal-transmission-sig'),
        transmission_time: headers.get('paypal-transmission-time'),
        webhook_id: env.PAYPAL_WEBHOOK_ID,
        webhook_event: _safeJson(body),
      }),
    });
    const d = await r.json();
    return d.verification_status === 'SUCCESS';
  } catch { return false; }
}


/* Password reset - emails a secure, time-limited link.
   Needs an email service (e.g. Resend, SendGrid, or AWS SES). Set the
   RESET_EMAIL_FROM secret and EMAIL_API_KEY; wire sendResetEmail() to your
   provider. Until then it stores a token so the flow is ready. */
async function authReset(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return json({ error: 'invalid email' }, 400);

  /* Bounded, and it was not. This route needs no credential of any kind and it
     causes an email to whatever address is typed into it - which is a mail
     bomber with AMV's return address on it, aimed at somebody who never signed
     up here, spending AMV's sending reputation and per-message cost on every
     shot. It also mints a KV record per call.

     Two limits, because they stop different things. Per ADDRESS stops one
     person being buried; per IP stops one caller working through a list. The
     per-address one is deliberately the tighter of the two: a real human who
     has lost their password asks once, maybe twice, and the second request is
     usually because the first email was slow.

     Both are counted BEFORE the token is minted and before anything is sent,
     and a refusal is the same shape as everywhere else - which also means it
     cannot be used to tell a real address from an unknown one, since the limit
     applies either way. */
  const perAddress = await guardAction(env, `reset:${email}`, 2, 6, 'password reset emails');
  if (perAddress) return perAddress;
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (ip) {
    const perIp = await guardAction(env, `resetip:${ip}`, 5, 30, 'password reset requests');
    if (perIp) return perIp;
  }

  // generate a one-time, 1-hour token
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await env.AMV_KV.put(`reset:${token}`, JSON.stringify({ email, at: Date.now() }), { expirationTtl: 3600 });
  /* The reset page is served by this server: its public address, mount included. */
  const link = `${_publicOrigin(request)}/reset?token=${token}`;
  // send the email if a provider is configured; otherwise the flow is ready but no email goes out
  let sent = false;
  try { sent = await sendResetEmail(env, email, link); } catch (e) { /* provider not set up */ }
  // Always return ok:true to avoid leaking which emails exist (security best practice)
  return json({ ok: true, sent });
}

/* Complete a password reset: consume the one-time token and set a new password.
   The token is single-use and expires in 1 hour. The new password is hashed with
   PBKDF2-SHA256 and a fresh salt, so it's stored securely and no one can read it. */
async function authResetConfirm(request, env) {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  const password = String(body.password || '');
  if (!token) return json({ error: 'missing token' }, 400);
  /* AMV-191: bounded, though the token is long and random rather than a
     guessable code - the six-digit path is separate and counts its own attempts.
     This is not about somebody brute-forcing their way in; it is that an
     unbounded route doing a storage read per call is a free way to hammer the
     store, and that every other door has a ceiling. Keyed per address so one
     source cannot spend everybody's. */
  const rcIp = (await _ipHash(env, request))
            || _rlIp(request);
  const rcBlock = await guardAction(env, `resetconfirm:${rcIp}`, 10, 60, 'password resets');
  if (rcBlock) return rcBlock;
  /* Only the bound here: how long it must be depends on the account (a
     passkey or an authenticator app lowers it to 8), and the account is not
     known until the token is read below. */
  { const bad = _passwordTooLong(password); if(bad) return json(bad, 400); }
  const stored = await env.AMV_KV.get(`reset:${token}`);
  if (!stored) return json({ error: 'This reset link is invalid or has expired. Please request a new one.' }, 400);
  /* Stored as {email, at}. The timestamp exists because erasure cannot reach
     this record - it is keyed by the token, and nothing maps an address back to
     the tokens issued for it. So a link outlives the account it was issued for,
     and if that address is registered again inside the hour, the link would
     name a DIFFERENT person's account. Refusing anything issued before the
     account existed closes that without needing to find the token. */
  let email = '', issuedAt = 0;
  try { const p = JSON.parse(stored); email = String(p.email || ''); issuedAt = +p.at || 0; }
  catch { email = String(stored || ''); }
  if (!email) return json({ error: 'This reset link is invalid or has expired. Please request a new one.' }, 400);
  const acct = await DB.get(env, 'acct', email);
  if (!acct) return json({ error: 'account not found' }, 404);
  /* HERE, AND NOT WITH THE OTHER PASSWORD RULES ABOVE.

     Length and commonness are facts about the password alone, so they are
     checked before anything is read from storage. Whether the password is the
     account's OWN address cannot be asked until the token has said which
     account this is - so it is asked at the first moment there is an answer,
     which is also still before the expensive hash. */
  if (_passwordIsPersonal(password, email, acct.name || ''))
    return json({ error: 'That password is your own email address or name, which is the first thing anybody holding your address would try. Please choose another.',
                  code: 'password_is_personal' }, 400);
  { const bad = _passwordProblem(password, acct); if(bad) return json(bad, 400); }
  if (issuedAt && acct.createdAt && acct.createdAt > issuedAt) {
    await env.AMV_KV.delete(`reset:${token}`);
    audit(env, 'reset_token_predates_account', { email });
    return json({ error: 'This reset link is invalid or has expired. Please request a new one.' }, 400);
  }
  /* Hash the new password with a fresh salt. This is deliberately slow, which
     is the point of it - and it is why the write that follows takes the record
     lock instead of writing back the copy read before the hashing started.
     AMV-196: anything else that touched this account in the meantime would be
     reverted, and in the other direction a login's iteration upgrade could put
     the OLD credential back after this said the reset worked. */
  const salt = crypto.randomUUID().replace(/-/g, '');
  const newHash = await _hashPassword(password, salt, PBKDF2_ITERATIONS);
  try {
    await _withAcct(env, email, (a) => {
      if (!a) return;
      a.pwHash = newHash; a.salt = salt; a.pwIter = PBKDF2_ITERATIONS;
      a.pwResetAt = Date.now();
    });
  } catch (e) {
    /* Not written, so do NOT consume the token - the link still works and they
       can try again. Saying it worked here is the failure that matters: they
       would walk away believing the old password no longer opens the account. */
    audit(env, 'password_reset_blocked', { email });
    return json({ error: 'Something else was changing this account just now, so the password was not changed. Please try again in a moment.', code: 'acct_busy' }, 503);
  }
  // consume the token (single-use) and revoke existing sessions for safety
  await env.AMV_KV.delete(`reset:${token}`);
  const _revoked = await _revokeOrSay(env, email, 'password_reset');
  audit(env, 'password_reset', { email, sessionsRevoked: _revoked });
  await _userEvent(env, request, email, 'password_changed');
  /* The code that got them here was sent to the address, so this device has
     just proved itself: trust it, after the revocation above so the token
     carries the new epoch. Signing in next asks for the password only.
     The password has ALREADY changed by this line, so failing to sign the
     device token must not turn a success into an error: it just means the
     next sign-in asks for a code. */
  let device = null;
  try { if (env.JWT_SECRET) device = await _deviceTokenFor(env, email); } catch (e) { device = null; }
  const cookies = _cookieAuthOn(env);
  const resp = json({ ok: true, sessionsRevoked: _revoked, ...(device ? { deviceToken: device } : {}),
    note: _revoked ? undefined : 'Your password was changed, but AMV could not sign out sessions that were already open. Use "sign out everywhere" once things settle.' });
  if (cookies && device) resp.headers.append('Set-Cookie', _deviceCookie(device, DEVICE_TRUST_MS / 1000));
  return resp;
}

// Wire this to your email provider (Resend shown as an example).
async function sendResetEmail(env, to, link) {
  return _sendEmail_security(env, to, 'Reset your AMV password',
    _emailShell('Reset your password',
      `<p style="margin:0 0 22px;font-size:14px;line-height:1.65;color:#555">We received a request to reset your AMV password. Tap the button below to choose a new one. This link expires in <b>1 hour</b>.</p>`,
      { label: 'Reset my password', url: link },
      `<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#999">Or paste this link into your browser:</p>`+
      `<p style="margin:0 0 22px;font-size:12px;line-height:1.6;color:#7c6cff;word-break:break-all">${link}</p>`+
      `<hr style="border:none;border-top:1px solid #eee;margin:0 0 18px"><p style="margin:0;font-size:12px;line-height:1.6;color:#999">If you didn't request this, you can safely ignore this email - your password won't change.</p>`,
      'This is an automated security email.'),
    `Reset your AMV password\n\nWe received a request to reset your password. Open this link to set a new one (it expires in 1 hour):\n${link}\n\nIf you didn't request this, you can safely ignore this email - your password won't change.\n\n- The AMV team`);
}

/* Notify a teammate that work was assigned to them. */
async function sendTaskAssignedEmail(env, to, { assignerName, taskTitle, priority, teamName, appUrl }) {
  const safeTitle = _escHtml(taskTitle || 'a task');
  const who = _escHtml(assignerName || 'A teammate');
  const team = _escHtml(teamName || 'your team');
  const prio = priority && priority !== 'normal' ? ` <span style="font-size:11px;color:${priority==='high'?'#d23':'#888'};font-weight:600">(${_escHtml(priority)} priority)</span>` : '';
  const link = appUrl || '';
  return _sendEmail_task(env, to, `${assignerName||'A teammate'} assigned you: ${taskTitle||'a task'}`,
    _emailShell('You\u2019ve been assigned work',
      `<p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#555">${who} assigned you a task in <b>${team}</b> on AMV:</p>`+
      `<div style="background:#f6f6f9;border:1px solid #ececf3;border-radius:10px;padding:16px;margin:0 0 22px"><div style="font-size:15px;font-weight:600;color:#15131f">${safeTitle}${prio}</div></div>`,
      link ? { label: 'Open in AMV', url: link } : null,
      `<p style="margin:0;font-size:12px;line-height:1.6;color:#999">You can view, update, and complete this task from the Team page in AMV.</p>`,
      'You received this because you\u2019re a member of this team on AMV.'),
    `${assignerName||'A teammate'} assigned you a task in ${teamName||'your team'} on AMV:\n\n"${taskTitle||'a task'}"${priority&&priority!=='normal'?' ('+priority+' priority)':''}\n\nOpen AMV to view and update it: ${link}\n\n- The AMV team`);
}

/* Generic Resend sender - one place that talks to the email provider. */
/* Resend gives every account a sender that needs NO domain verification:
   onboarding@resend.dev. It only delivers to the address that owns the Resend
   account - which is exactly what you need to recover YOUR OWN login on day one.
   For real users, set RESET_EMAIL_FROM to an address on a domain you've verified
   in Resend, or their mail will not arrive. */
const RESET_FROM_DEFAULT = 'AMV <onboarding@resend.dev>';

/* NOTHING CAPPED WHAT ONE PERSON COULD BE SENT.

   Every rate limit in this file is per ACTOR - how often you may do a thing.
   That is the right shape for cost, and for abuse of AMV. It is the wrong shape
   for abuse of a PERSON, and email is the one thing here that leaves the
   building and lands somewhere we do not control, on our domain, with our
   reputation on it.

   Three things were true at once:

     marketMessage is guarded at 300 messages a day and every one of them mails
     the recipient. The limit works exactly as written and the outcome is still
     three hundred emails into one stranger's inbox in a day.

     Team task assignment had no limit at all. Create, assign, delete, repeat.

     An Ultra account may run 100 automations at a ten-minute interval, each
     able to mail its result. That is fourteen thousand emails a day, all of
     them asked for, none of them counted.

   So the cap goes where every send already passes, in the dimension nothing
   else covers: how much mail one ADDRESS can be sent in a day. Classed, and
   each class holds its own budget, so a flood of task notifications can never
   spend the one a password reset needs.

   The numbers are backstops, not policy. `auto` sits well above a ten-minute
   watch running all day (144) so the feature somebody paid for still works,
   and well below the fan-out above.

   When the counter cannot be reached, security and owner mail still goes and
   notification mail is held. That is a deliberate split rather than one rule:
   an unenforceable cap is not a cap, which argues for refusing - but a reset
   code that cannot be sent is somebody locked out of their account by our
   outage, and every actor-side limit is still in force underneath. The operator
   is alerted either way. */
const EMAIL_DAY_CAP = {
  security: 10,   // reset codes and account security mail
  owner:    14,   // the operator's own digests
  message:  25,   // somebody messaged you on the marketplace
  task:     25,   // work landed on you in a team
  auto:    250,   // your own scheduled jobs, addressed to you, at your request
  done:     20,   // "AMV is done" - one per long answer you walked away from
  waitlist:  5,   // "an app you asked for connects now" - one per app, and only if you asked
  signin:   10,   // sign-in and sign-up codes: a person needs a few, a stranger's inbox none
  other:    25,
};
const EMAIL_SENDS_WITHOUT_A_COUNTER = { security: true, owner: true };

async function _emailBudgetOk(env, cls, to) {
  const cap = EMAIL_DAY_CAP[cls] || EMAIL_DAY_CAP.other;
  const who = String(to || '').toLowerCase().trim();
  if (!who) return false;
  const r = await counter(env, `mailto:${cls}:${who}:${todayKey()}`,
                          { op: 'reserve', amount: 1, cap, ttlMs: 86400000 * 2 });
  if (r && r.unavailable) {
    audit(env, 'email_budget_unavailable', { cls, to: who });
    try {
      await alertOnce(env, 'email_budget',
        'The per-recipient email budget cannot be evaluated - the atomic counter is unavailable. ' +
        'Security and owner mail is still going out; notification mail is being held.', 15);
    } catch (e) { /* alerting must never break a send decision */ }
    return !!EMAIL_SENDS_WITHOUT_A_COUNTER[cls];
  }
  if (!r || !r.allowed) {
    audit(env, 'email_budget_block', { cls, cap, to: who });
    return false;
  }
  return true;
}

/* Thin, named entry points for the sends whose argument lists span many lines.
   The class is the first thing you read rather than a string trailing a
   template-literal body twenty lines down, which is where a class gets pasted
   wrong. */
const _sendEmail_security = (env, ...a) => _sendEmailAs(env, 'security', a);
const _sendEmail_message  = (env, ...a) => _sendEmailAs(env, 'message',  a);
const _sendEmail_task     = (env, ...a) => _sendEmailAs(env, 'task',     a);
function _sendEmailAs(env, cls, [to, subject, html, text]) {
  return _sendEmail(env, to, subject, html, text, cls);
}

/* CAN EMAIL REACH SOMEBODY WHO IS NOT THE OPERATOR?
   A Resend key alone is not enough: the default sender (onboarding@resend.dev)
   only delivers to the address that owns the Resend account, so for every
   other person the send fails and nothing arrives (AMV-193). Anything that
   PROMISES a person an email - Crew's "email me the result", "email me when
   AMV is done" - asks this, not whether a key exists. */
function _emailReaches(env) { return !!(env.EMAIL_API_KEY && env.RESET_EMAIL_FROM); }
/* Configured AND not currently refused by the provider. What a screen asks
   before promising someone an email: "set up" is not "will arrive" while the
   provider is turning the sender away (an unverified domain), and a yes then
   is a promise of mail that never comes. */
async function _emailReachesNow(env) { return _emailReaches(env) && !(await _emailSenderRefused(env)); }

async function _sendEmail(env, to, subject, html, text, cls) {
  if (!env.EMAIL_API_KEY) return false;
  if (!(await _emailBudgetOk(env, cls || 'other', to))) return false;
  const from = env.RESET_EMAIL_FROM || RESET_FROM_DEFAULT;
  try {
    const resp = await fetchDeadline('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.EMAIL_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
    /* A refusal of the SENDER (an unverified domain) is remembered, because it
       is the same answer for everybody until the operator fixes it - see
       _emailSenderRefused. Cleared by the first send that goes through. */
    try {
      if (resp.ok) { if (await env.AMV_KV.get('emailhealth:sender')) await env.AMV_KV.delete('emailhealth:sender'); }
      else if (resp.status === 403 || resp.status === 422) {
        const said = String((await resp.text().catch(() => '')) || '').slice(0, 300);
        if (/domain is not verified|verify (your )?domain|not verified/i.test(said))
          await env.AMV_KV.put('emailhealth:sender', JSON.stringify({ at: Date.now(), said }), { expirationTtl: 86400 });
      }
    } catch (e) {}
    return resp.ok;
  } catch (e) { return false; }
}
/* Whether the provider has said, in the last day, that it will not send from
   this deployment's sender at all. A day, so a fix at the provider is noticed
   by the next send that succeeds - which clears it - rather than never. */
async function _emailSenderRefused(env) {
  try { const r = await env.AMV_KV.get('emailhealth:sender'); return r ? JSON.parse(r) : null; }
  catch (e) { return null; }
}

// minimal HTML escape for values interpolated into email markup
function _escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* Shared branded email shell. body is trusted HTML; cta is {label,url} or null;
   extra is trusted HTML after the CTA; footnote is plain text.
   Inline styles only (clients strip <style>); table layout for compatibility. */
function _emailShell(heading, body, cta, extra, footnote) {
  const ctaHtml = cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px"><tr><td style="border-radius:10px;background:#7c6cff">
    <a href="${cta.url}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:600;color:#fff;text-decoration:none;border-radius:10px">${_escHtml(cta.label)}</a>
  </td></tr></table>` : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <tr><td style="background:#15131f;padding:28px 32px;text-align:center">
          <span style="display:inline-block;width:34px;height:34px;background:#7c6cff;border-radius:9px;color:#fff;font-weight:800;font-size:16px;line-height:34px;text-align:center">A</span>
          <div style="color:#fff;font-size:17px;font-weight:700;margin-top:10px;letter-spacing:-.3px">AMV</div>
        </td></tr>
        <tr><td style="padding:32px">
          <h1 style="margin:0 0 12px;font-size:20px;color:#15131f;letter-spacing:-.4px">${_escHtml(heading)}</h1>
          ${body}
          ${ctaHtml}
          ${extra || ''}
        </td></tr>
        <tr><td style="padding:18px 32px;background:#fafafa;text-align:center">
          <p style="margin:0;font-size:11px;color:#aaa">&copy; AMV &middot; ${_escHtml(footnote || '')}</p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

