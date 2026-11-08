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
/* EACH REQUEST'S OWN CONTEXT (Nov 3 audit SEC-008). The most recent context
   in a shared variable means that, with requests overlapping in one isolate,
   background work - a mirror write, an audit delivery - can be held open by a
   request that has already finished, and dropped with it. With the runtime's
   async-local storage, every request (and cron tick, and queue batch) runs
   inside its own context, and _bg uses the one it is running in. The shared
   variable stays only as the fallback for code called outside any of them. */
/* LOADED BEFORE THE FIRST REQUEST (Nov 7 audit AUDIT-010). It was imported
   asynchronously, so the first requests of every new isolate - at scale, a
   steady stream - ran before it existed and their background work (audit
   delivery, ledger mirrors) fell back to whichever request had set the
   shared context last. A static import is there from the start; nodejs_compat
   is on in wrangler.toml. */
import { AsyncLocalStorage as _AmvALS } from 'node:async_hooks';
const _ctxStore = new _AmvALS();
/* Runs `fn` with `ctx` as its own context, when the runtime offers one. */
function _withCtx(ctx, fn) { return _ctxStore ? _ctxStore.run(ctx, fn) : fn(); }
function _bg(p) {
  if (!p || typeof p.then !== 'function') return;
  const settled = p.catch(() => {});
  try {
    /* Only the context this work is running in (Nov 8 audit AUDIT-010):
       every request, tick and queue batch runs inside its own, so the shared
       variable is used only where the runtime offers no async-local storage
       at all - never to borrow another request's lifetime. */
    const c = _ctxStore ? _ctxStore.getStore() : _liveCtx;
    if (c && typeof c.waitUntil === 'function') { c.waitUntil(settled); return; }
  } catch (e) { /* a finished context: the fallback below still applies */ }
  /* Nothing to hold it open. Better than throwing, and honest: this is the
     case where delivery really is best-effort. */
}

function audit(env, event, detail) {
  try {
    const rec = { t: new Date().toISOString(), event, ...detail };
    /* NO ADDRESS IN THE LOG LINE EITHER (Nov 3 audit SEC-007). The line went
       to Workers Logs with every address as it was. Now every address -
       in any field, or inside a sentence - becomes a keyed pseudonym
       (`u_` + 16 hex of HMAC-SHA256 under AUDIT_ID_KEY or the token secret),
       the same for the same person so events still join up, and useless to
       anybody without the key; an IP is dropped. To find one person's lines,
       the owner asks POST /admin/audit/pid with the address (audited). */
    // Workers Logs captures console output; cheap and always-on.
    console.log('AUDIT ' + JSON.stringify(_auditScrub(env, rec)));
    // Optional: ship high-signal events to an external collector.
    if (env && env.AUDIT_WEBHOOK && _highSignal(event)) {
      // Registered with waitUntil (see _bg), not abandoned: the request is not
      // blocked on it and the isolate is kept alive until it settles.
      _bg(fetchDeadline(env.AUDIT_WEBHOOK, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(_auditScrub(env, rec)),
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
          distinct_id: _auditPid(env, by || email || (detail && detail.user) || 'server'),
          properties: { ..._auditScrub(env, safe), source: 'amv-worker' },
          timestamp: rec.t,
        }),
      }));
    }
  } catch { /* logging must never throw */ }
}
/* WHAT LEAVES FOR SOMEBODY ELSE'S SERVICE CARRIES NO ADDRESS (Nov 1 audit
   SEC-007). The log line above is AMV's own (Workers Logs). What is copied to
   an outside collector or analytics went with every field as it was - an
   address in `email`, `target`, `buyer`, `to`, or inside a sentence - and an
   IP. Outside, an address becomes the same pseudonym every time (so events
   still join up per person) and an IP is dropped. */
const _EMAIL_IN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/* SHA-256 and HMAC, synchronous: audit() is called from everywhere, in the
   middle of things, and must not become a promise. Small inputs only. */
const _SHA_K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
function _sha256Sync(bytes){
  const len = bytes.length, bitLen = len * 8;
  const total = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total); m.set(bytes); m[len] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(total - 4, bitLen >>> 0); dv.setUint32(total - 8, Math.floor(bitLen / 4294967296));
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const w = new Uint32Array(64);
  const r = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (w[i - 16] + (r(a, 7) ^ r(a, 18) ^ (a >>> 3)) + w[i - 7] + (r(b, 17) ^ r(b, 19) ^ (b >>> 10))) >>> 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + _SHA_K[i] + w[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32); const ov = new DataView(out.buffer); for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
  return out;
}
function _hmacSync(keyStr, msgStr){
  const enc = new TextEncoder();
  let key = enc.encode(keyStr); if (key.length > 64) key = _sha256Sync(key);
  const k = new Uint8Array(64); k.set(key);
  const ip = k.map(b => b ^ 0x36), op = k.map(b => b ^ 0x5c);
  const msg = enc.encode(msgStr);
  const inner = new Uint8Array(64 + msg.length); inner.set(ip); inner.set(msg, 64);
  const ih = _sha256Sync(inner);
  const outer = new Uint8Array(96); outer.set(op); outer.set(ih, 64);
  return _sha256Sync(outer);
}
/* The pseudonym for an address, the same every time under this deployment's key. */
const _pidCache = new Map();
function _auditPid(env, s){
  const v = String(s || 'server').toLowerCase();
  const key = String((env && (env.AUDIT_ID_KEY || env.JWT_SECRET)) || 'amv-audit');
  const ck = key + '\n' + v;
  if (_pidCache.has(ck)) return _pidCache.get(ck);
  const h = _hmacSync('amv-audit-id\n' + key, v);
  const id = 'u_' + [...h.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (_pidCache.size > 5000) _pidCache.clear();
  _pidCache.set(ck, id);
  return id;
}
function _auditScrub(env, v, depth){
  const d = (depth || 0) + 1;
  if (typeof v === 'string') return v.replace(_EMAIL_IN, (m) => _auditPid(env, m));
  if (Array.isArray(v)) return d > 6 ? [] : v.map(x => _auditScrub(env, x, d));
  if (v && typeof v === 'object') {
    if (d > 6) return {};
    const out = {};
    for (const [k, x] of Object.entries(v)) { if (/^(ip|cfip|clientip)$/i.test(k)) continue; out[k] = _auditScrub(env, x, d); }
    return out;
  }
  return v;
}
function _highSignal(event) {
  return event === 'auth_fail' || event === 'spend_cap_hit' ||
         event === 'forged_webhook' || event === 'global_cap_hit';
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
      event_id: (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Date.now()) + _randId(12)),
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

   A five-hour window cannot lock anybody out for long. The worst wait
   is a few hours, it arrives four or five times a day, and it bounds a burst -
   which is the only thing a short window is actually good at - without ever
   becoming a wall. That is why the products people compare AMV to are shaped
   this way, and it is the right shape for the same reason.

   It opens with the person's first message and lasts five hours from then
   (the counter's 'session' op, docs/OWNER-DECISIONS.md #13). It used to be a
   fixed block of absolute time, which reopened at a moment that had nothing
   to do with when somebody started. Either way no timezone moves it. */
const WINDOW_5H_MS = 5 * 60 * 60 * 1000;

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

