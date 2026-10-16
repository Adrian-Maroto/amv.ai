/* =====================================================================
   AUDIT LOGGING (auditor #5)
   Structured, security-relevant event logging. Goes to:
   - console (captured by Cloudflare Workers Logs / Logpush), and
   - optionally an external sink (AUDIT_WEBHOOK) for anomaly detection.
   We log auth failures, quota/rate/spend blocks, and forged webhooks -
   the signals you'd watch to spot abuse. PII is minimized (email only).
   ===================================================================== */
/* AMV-046: A WORKER STOPS THE MOMENT IT ANSWERS, AND TAKES THE PROMISE WITH IT.

   `audit()` started a fetch to AUDIT_WEBHOOK and to PostHog and did not wait,
   with a comment saying "fire-and-forget; never block the request on logging".
   The first half is right and the second half is not what happens: a Worker's
   isolate is free to be torn down as soon as the response is returned, and a
   promise nobody registered goes with it. So the delivery is not fire-and-
   forget, it is fire-and-maybe - and the faster the request answers, the less
   likely the event ever leaves.

   Which events. `_highSignal` picks auth failures, forged webhooks, spend
   blocks, admin denials: the ones an external collector exists to see, and the
   ones whose absence looks exactly like nothing having happened. An anomaly
   detector fed by a channel that drops under load is worse than none, because
   the load is when it matters.

   `waitUntil` is the platform's answer and it needs a context object, which
   `audit` does not have and cannot be given without threading it through
   several hundred call sites. So the most recent live context is kept here and
   used. It is not perfectly attributed - under concurrency the promise may
   extend a different request's lifetime than the one that logged - and that
   does not matter for what waitUntil actually does, which is keep the isolate
   alive until the promise settles. Wrapped, because using a context whose
   request has already finished throws, and a logging call must never be the
   thing that breaks a request. */
let _liveCtx = null;
function _bg(p) {
  if (!p || typeof p.then !== 'function') return;
  const settled = p.catch(() => {});
  try {
    if (_liveCtx && typeof _liveCtx.waitUntil === 'function') { _liveCtx.waitUntil(settled); return; }
  } catch (e) { /* a finished context: the fallback below still applies */ }
  /* Nothing to hold it open. Better than throwing, and honest: this is the
     case where delivery really is best-effort. */
}

function audit(env, event, detail) {
  try {
    const rec = { t: new Date().toISOString(), event, ...detail };
    // Workers Logs captures console output; cheap and always-on.
    console.log('AUDIT ' + JSON.stringify(rec));
    // Optional: ship high-signal events to an external collector.
    if (env && env.AUDIT_WEBHOOK && _highSignal(event)) {
      // Registered with waitUntil (see _bg), not abandoned: the request is not
      // blocked on it and the isolate is kept alive until it settles.
      _bg(fetchDeadline(env.AUDIT_WEBHOOK, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      }));
    }
    // Product analytics: mirror every business event to PostHog when configured
    // (set POSTHOG_KEY as a Worker secret). Inert until then. distinct_id is
    // pseudonymous - no raw email/IP leaves here - privacy by default.
    if (env && env.POSTHOG_KEY) {
      const host = (env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/$/, '');
      const { by, email, ip, ...safe } = detail || {};
      _bg(fetchDeadline(host + '/capture/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: env.POSTHOG_KEY,
          event: 'srv_' + event,
          distinct_id: _phId(by || email || (detail && detail.user) || 'server'),
          properties: { ...safe, source: 'amv-worker' },
          timestamp: rec.t,
        }),
      }));
    }
  } catch { /* logging must never throw */ }
}
function _highSignal(event) {
  return event === 'auth_fail' || event === 'spend_cap_hit' ||
         event === 'forged_webhook' || event === 'global_cap_hit';
}
// Pseudonymous, stable id for analytics - masks the raw identifier so no email
// or IP is sent to PostHog, while the same user still maps to the same id.
function _phId(s) {
  s = String(s || 'server');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'u_' + h.toString(36);
}
// ── Error monitoring: forward to Sentry when SENTRY_DSN is configured ────────
// Inert until the secret is set. Fire-and-forget, fail-safe (never throws, never
// blocks the request). Server-side only, so no client SDK and no CSP change.
function _sentryEndpoint(dsn) {
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+/, '');
    if (!u.username || !project) return null;
    return { url: `${u.protocol}//${u.host}/api/${project}/store/`, key: u.username };
  } catch { return null; }
}
function _forwardSentry(env, ctx, e) {
  try {
    if (!env || !env.SENTRY_DSN) return;
    const s = _sentryEndpoint(env.SENTRY_DSN); if (!s) return;
    const payload = {
      event_id: (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Date.now()) + Math.random().toString(36).slice(2)),
      timestamp: new Date().toISOString(),
      platform: 'javascript',
      level: 'error',
      logger: String(e.where || 'amv'),
      release: e.ver || undefined,
      message: String(e.msg || 'error').slice(0, 500),
      tags: { kind: String(e.kind || 'error'), tab: String(e.tab || '') },
      extra: { where: e.where, stack: e.stack, ua: e.ua },
    };
    const p = fetchDeadline(s.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=amv/1.0, sentry_key=${s.key}`,
      },
      body: JSON.stringify(payload),
    }).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(p);
  } catch { /* telemetry must never throw */ }
}

const todayKey = () => new Date().toISOString().slice(0, 10);

/* ── WHY A FIVE-HOUR WINDOW AND NOT A DAY OR A MONTH ──────────────────────
   A monthly cap has one failure mode and it is severe: somebody who works
   hard for three days is locked out for the remaining twenty-seven, and the
   product they are paying for simply stops. A daily cap does the same thing
   in miniature, with the lockout landing in the middle of whatever they were
   doing and lasting until midnight in a timezone they may not live in.

   A rolling five-hour window cannot lock anybody out for long. The worst wait
   is a few hours, it arrives four or five times a day, and it bounds a burst -
   which is the only thing a short window is actually good at - without ever
   becoming a wall. That is why the products people compare AMV to are shaped
   this way, and it is the right shape for the same reason.

   Computed from absolute time, so the window does not move with a timezone
   and cannot be reset by changing one. */
const WINDOW_5H_MS = 5 * 60 * 60 * 1000;
const window5hKey = (now = Date.now()) => String(Math.floor(now / WINDOW_5H_MS));

/* The week the DEAREST engines are counted over. Long enough that somebody
   doing a hard week of work is not stopped on Wednesday, short enough that a
   month cannot be spent in a weekend. ISO-style: Monday starts it, and it is
   derived from the same absolute clock for the same reason. */
const weekKey = (now = Date.now()) => {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7;                       // Monday = 0
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  return new Date(monday).toISOString().slice(0, 10);
};
const monthKey = () => new Date().toISOString().slice(0, 7);

/* THE WINDOW AN ALLOWANCE IS ACTUALLY MEASURED OVER.

   Every per-customer allowance in this file was keyed by monthKey() - the
   CALENDAR month. Subscriptions do not bill on the calendar. They bill on the
   day somebody subscribed, and the two only line up for people who happened to
   sign up on the 1st.

   What that cost: somebody who subscribes on the 28th spends four days against
   August's bucket, and on 1 September gets a completely fresh one - still
   inside their FIRST paid month. They receive close to two months of compute
   for one payment, and it repeats every month for as long as they stay. The
   customer who subscribed on the 1st gets exactly what they paid for. Nothing
   about it looks wrong from any single screen: every charge is correct, every
   counter is correct, and the window they are counted over is the wrong one.

   `renewedAt` already moves on every successful payment - the renewal sweep
   sets it - so the anchor existed and nothing consulted it.

   Free accounts keep the calendar month. They have no billing date, so there
   is no anniversary to anchor to, and the 1st is as good a boundary as any. */
function _periodStartISO(anchorMs, nowMs) {
  const a = new Date(anchorMs), n = new Date(nowMs);
  const anchorDay = a.getUTCDate();
  let y = n.getUTCFullYear(), mo = n.getUTCMonth();
  /* The 31st does not exist in September. A subscription anchored on the 31st
     renews on the 30th there and on the 28th in February, which is what every
     processor does, so the window has to agree with the charge. */
  const dayIn = (yy, mm) => Math.min(anchorDay, new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate());
  if (n.getUTCDate() < dayIn(y, mo)) {
    mo -= 1;
    if (mo < 0) { mo = 11; y -= 1; }
  }
  const d = dayIn(y, mo);
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/* WHEN THIS SUBJECT'S ALLOWANCE ACTUALLY COMES BACK.

   Every monthly refusal tells somebody to wait, so every one of them needs a
   real answer to "until when". There was one, computed inline, and it was
   `Date.UTC(y, m + 1, 1)` - the first of the calendar month.

   That is right for a free account and wrong for every paying one. The counter
   that refused is keyed on `_periodKeyOf`, which for a paying subject is their
   BILLING ANNIVERSARY, not the 1st. Somebody who renews on the 20th and runs
   out on the 5th was told their allowance returns on the 1st - fifteen days
   early - and the client unlocks the composer on that date, so the next thing
   they send is refused again with no explanation.

   Same clamping as `_periodStartISO` because it has to land on the same day
   the charge does: the 31st is the 30th in September and the 28th in
   February. Derived from that function's answer rather than recomputed, so
   the two cannot drift apart. */
function _periodResetAtFor(renewedAt, plan, customCfg, nowMs) {
  const now = nowMs || Date.now();
  const anchor = +renewedAt || 0;
  const n = new Date(now);
  // No billing anniversary to anchor to: the calendar month is the window.
  if (!anchor || !(_planPriceUSD(plan, customCfg) > 0)) {
    return Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1);
  }
  const start = _periodStartISO(anchor, now).split('-').map(Number);
  const anchorDay = new Date(anchor).getUTCDate();
  let y = start[0], mo = start[1] - 1 + 1;          // the month AFTER this period
  if (mo > 11) { mo -= 12; y += 1; }
  const d = Math.min(anchorDay, new Date(Date.UTC(y, mo + 1, 0)).getUTCDate());
  return Date.UTC(y, mo, d);
}
/* The same question asked of a resolved user, which is what most callers have. */
const _periodResetAtOf = (user, nowMs) =>
  _periodResetAtFor(user && user.billingRenewedAt, user && user.plan, user && user.customCfg, nowMs);

/* The key for a billing subject's current allowance window. Takes what it
   needs rather than a whole user, so the cron and the request path - which
   hold different shapes - can both ask the same question. */
function _periodKeyFor(renewedAt, plan, customCfg) {
  const anchor = +renewedAt || 0;
  if (!anchor || !(_planPriceUSD(plan, customCfg) > 0)) return monthKey();
  return _periodStartISO(anchor, Date.now());
}

/* The same question asked of a resolved user, which is what most callers have.
   `billingRenewedAt` is put there by requireUser from the billing subject, so a
   team member is measured over the TEAM's period rather than their own. */
const _periodKeyOf = (user) =>
  _periodKeyFor(user && user.billingRenewedAt, user && user.plan, user && user.customCfg);

