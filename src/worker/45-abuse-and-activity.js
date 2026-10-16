/* ══════════════════════════════════════════════════════════════════════
   ABUSE / REFUND-FRAUD PROTECTION  (auditor #3)

   The "DoorDash method": pay, consume the product, then claw the money back
   (chargeback or refund) while keeping what you took. For AMV the product is
   compute - model calls, deep research, autonomous jobs - which costs real money the
   moment it's delivered. So a refund/chargeback after heavy use is a direct
   loss, and a repeat pattern is fraud.

   This layer:
     • records every refund and dispute against the user (abuse:<email>)
     • revokes the entitlement that was refunded/disputed (no free access)
     • flags accounts with a pattern, so they can't just re-subscribe and
       repeat. A flagged user can still USE a free account, but new paid
       checkouts are refused until a human clears them.
   None of this blocks a legitimate one-off refund; it takes a PATTERN.
   ══════════════════════════════════════════════════════════════════════ */

const ABUSE_DISPUTE_BLOCK = 1;   // a single chargeback is a hard fraud signal → block
const ABUSE_REFUND_BLOCK  = 3;   // this many refunds shows a pattern → block

/* =====================================================================
   AMV-076  ACCOUNT ACTIVITY - what happened on YOUR account

   `audit()` writes security events to the operator's logs, which is the right
   place for them and completely useless to the person whose account it is. The
   Security screen meanwhile showed a hardcoded "This browser - Active now" row
   that was not reading anything: a picture of a session list, not a session
   list. Someone whose password had leaked would have looked straight at it and
   seen nothing wrong.

   So security events are also written per account, and the account can read
   them back. What is recorded is deliberately coarse:
     - WHAT happened, and when
     - the browser family (Chrome/Safari/...), not the full user-agent string
     - the country, when the edge knows it, not a city and never an address
   That is enough to recognise "someone signed in from another country" and not
   enough to become a tracking record of its own. The log is capped at the last
   100 events and expires, so it cannot grow into a liability either.
   ===================================================================== */
const ACTIVITY_MAX_EVENTS = 100;
const ACTIVITY_TTL_S      = 400 * 86400;

/* Browser family only. A full user-agent is a fingerprint; "Chrome on Windows"
   is what actually helps someone recognise their own session. */
function _deviceLabel(request) {
  const ua = String((request && request.headers && request.headers.get('User-Agent')) || '');
  if (!ua) return '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : '';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return [browser, os].filter(Boolean).join(' on ') || '';
}

/* Record one thing that happened to an account. Never throws: an account event
   is a record OF an action, and must not be able to break the action. */
async function _userEvent(env, request, email, kind, detail) {
  try {
    const em = String(email || '').toLowerCase();
    if (!em || !kind) return;
    const cf = (request && request.cf) || {};
    const ev = { at: Date.now(), kind };
    const dev = _deviceLabel(request); if (dev) ev.dev = dev;
    if (cf.country) ev.country = String(cf.country).slice(0, 2);
    if (detail && typeof detail === 'object') {
      // Only short, non-identifying extras - this record is shown back to the user.
      for (const k of ['plan', 'from', 'to', 'reason', 'count']) {
        if (detail[k] != null) ev[k] = String(detail[k]).slice(0, 40);
      }
    }
    const key = `alog:${em}`;
    let list = [];
    try { list = JSON.parse(await env.AMV_KV.get(key) || '[]') || []; } catch (e) { list = []; }
    list.push(ev);
    if (list.length > ACTIVITY_MAX_EVENTS) list = list.slice(-ACTIVITY_MAX_EVENTS);
    await env.AMV_KV.put(key, JSON.stringify(list), { expirationTtl: ACTIVITY_TTL_S });
  } catch (e) { /* never let logging break the thing being logged */ }
}

/* GET /v1/activity -> the account's own security history, newest first. */
async function accountActivity(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  let list = [];
  try { list = JSON.parse(await env.AMV_KV.get(`alog:${user.email}`) || '[]') || []; } catch (e) { list = []; }
  return json({
    ok: true,
    events: list.slice(-ACTIVITY_MAX_EVENTS).reverse(),
    kept: ACTIVITY_MAX_EVENTS,
    retentionDays: Math.round(ACTIVITY_TTL_S / 86400),
  });
}

async function _abuseRecord(env, email, kind, detail = {}) {
  email = String(email || '').toLowerCase();
  if (!email) return null;
  /* AMV-208: this record accumulates evidence, and two things write it - a flag
     going on, from a dispute or a refund or referral velocity, and the owner
     clearing one. Losing a flag to the write that cleared another loses the
     reason the next decision would have been made, and the counts that decide
     whether an account is blocked are counted off it. Under the lock, and the
     block decision made against the totals as they are inside it. */
  let blockedNow = null;
  const rec = await _withKind(env, 'abuse', email, (r) => {
    if (kind === 'dispute') r.disputes = (r.disputes || 0) + 1;
    if (kind === 'refund')  r.refunds  = (r.refunds  || 0) + 1;
    r.events = (r.events || []).concat({ kind, at: Date.now(), ...detail }).slice(-50);

    // Decide whether this account is now blocked from new paid purchases.
    const shouldBlock = (r.disputes >= ABUSE_DISPUTE_BLOCK) || (r.refunds >= ABUSE_REFUND_BLOCK);
    if (shouldBlock && !r.blocked) {
      r.blocked = true;
      r.blockedAt = Date.now();
      r.blockedReason = r.disputes >= ABUSE_DISPUTE_BLOCK ? 'chargeback' : 'refund_pattern';
      /* MARKED WHERE THE SPENDING PATHS CAN SEE IT.

         This flag was set here and read in two places: whether a new checkout
         may start, and whether a referral pays out. Nothing on the paths that
         actually cost money asked. So an account blocked for charging back
         went on calling the model and running scheduled work - all of it
         billed to AMV, from somebody who has already proved
         they take the money back.

         Denormalised onto the entitlement because requireUser reads that
         record on every request anyway. Reading `abuse:` on the hot path would
         be a second lookup per call to save the same lookup, and the whole
         point is that this costs nothing to check. */
      blockedNow = { reason: r.blockedReason, disputes: r.disputes, refunds: r.refunds };
    }
    return r;
  }, { email, disputes: 0, refunds: 0, events: [], blocked: false });
  if (blockedNow) {
    audit(env, 'abuse_blocked', { email, ...blockedNow });
    /* Written onto the entitlement, under its own lock, so every request sees
       it without a second lookup. Best-effort and audited: if it cannot be
       written the account is still blocked in the abuse record, and the paths
       that read that one still refuse - this makes the block reach the rest. */
    try {
      await _withEnt(env, email, (e) => {
        if (!e) return;
        e.blocked = true;
        e.blockedReason = blockedNow.reason;
        e.blockedAt = Date.now();
      });
    } catch (e) {
      audit(env, 'abuse_block_not_propagated', { email, error: String((e && e.message) || e) });
      try { await alertOnce(env, 'blockprop:' + email,
        'An account was blocked for ' + blockedNow.reason + ' but the flag did not reach its entitlement, '
        + 'so the spending paths will not see it. Set it by hand.', 60); } catch (_) {}
    }
  }
  return rec;
}

async function _abuseStatus(env, email) {
  email = String(email || '').toLowerCase();
  if (!email) return { blocked: false };
  return (await DB.get(env, 'abuse', email)) || { blocked: false, disputes: 0, refunds: 0 };
}

/* Called at checkout: a flagged account cannot start a new paid plan. This is
   what stops "chargeback, then just subscribe again and do it once more". */
async function _abuseCheckoutAllowed(env, email) {
  const s = await _abuseStatus(env, email);
  return !s.blocked;
}

