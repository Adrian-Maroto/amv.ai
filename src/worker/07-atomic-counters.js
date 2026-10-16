/* =====================================================================
   ATOMIC COUNTERS - Durable Object
   KV cannot do atomic read-modify-write, so parallel requests can race
   past rate limits and quotas. A Durable Object serializes all ops on a
   given key (one instance per key), giving true atomicity. We shard by
   the counter key so each user/limit gets its own consistent instance.

   Operations (POST JSON { op, ... }):
     • {op:'rateCheck', limit, windowMs}  -> {allowed, count}  atomic test-and-incr
     • {op:'incr', amount, ttlMs}         -> {value}           atomic add, returns new total
     • {op:'get'}                         -> {value}
     • {op:'checkCap', cap}               -> {allowed, value}  read-only ceiling test
   ===================================================================== */
export class AMVCounter {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) {
    const body = await request.json().catch(() => ({}));
    const op = body.op;
    // All handlers run under the DO's single-threaded, serialized execution,
    // so read-modify-write here is race-free by construction.
    if (op === 'rateCheck') {
      const windowMs = body.windowMs || 60000;
      const now = Date.now();
      let rec = await this.state.storage.get('rl');
      if (!rec || now - rec.start >= windowMs) rec = { start: now, count: 0 };
      if (rec.count >= body.limit) {
        return json({ allowed: false, count: rec.count });
      }
      rec.count += 1;
      await this.state.storage.put('rl', rec);
      // auto-expire the storage a little after the window
      await this.state.storage.setAlarm(now + windowMs + 5000);
      return json({ allowed: true, count: rec.count });
    }
    if (op === 'incr') {
      const cur = (await this.state.storage.get('v')) || 0;
      // never let a refund drive the counter negative
      const next = Math.max(0, cur + (body.amount || 0));
      await this.state.storage.put('v', next);
      if (body.ttlMs) await this.state.storage.setAlarm(Date.now() + body.ttlMs);
      return json({ value: next });
    }
    /* ATOMIC TEST-AND-INCREMENT - this is what makes a quota a quota.
       A separate `get` then `incr` can be interleaved by concurrent requests:
       they all read the same value, all decide they fit, and all proceed. Doing
       the compare and the increment together, inside the DO's serialized
       execution, means only the callers that actually fit under the cap get
       through - no matter how many arrive at once. */
    if (op === 'reserve') {
      const cur = (await this.state.storage.get('v')) || 0;
      const amount = Number(body.amount);
      // reject invalid reservation amounts (NaN, non-finite, negative)
      if (!Number.isFinite(amount) || amount < 0) return json({ allowed: false, value: cur });
      const next = cur + amount;
      // Deny when the RESULT would exceed the cap, not merely when the current
      // value already does - otherwise the final reservation overshoots by up to
      // `amount` (AMV-017). Reserving up to exactly the cap is allowed.
      if (next > body.cap) return json({ allowed: false, value: cur });
      await this.state.storage.put('v', next);
      if (body.ttlMs) await this.state.storage.setAlarm(Date.now() + body.ttlMs);
      return json({ allowed: true, value: next });
    }
    /* ATOMIC CLAIM - a real mutual-exclusion lock.
       The KV fallback does `get` then `put`, which is a genuine TOCTOU window:
       two concurrent withdrawals can BOTH pass the check before either writes,
       producing a double payout. Inside the DO every op is serialized, so the
       read and the write cannot interleave. This is the correct place for any
       lock that guards money. */
    if (op === 'claim') {
      const now = Date.now();
      const held = await this.state.storage.get('claim');
      if (held && held.until > now) return json({ claimed: false, until: held.until });
      const ttl = Math.max(1000, Number(body.ttlMs) || 30000);
      /* AMV-013: WHO HOLDS IT, NOT JUST THAT IT IS HELD.
         A claim carries an owner token so a release can prove it is giving back
         the lock it took. See the release below for what that stops. */
      const owner = crypto.randomUUID();
      await this.state.storage.put('claim', { until: now + ttl, owner });
      await this.state.storage.setAlarm(now + ttl + 1000);
      return json({ claimed: true, until: now + ttl, owner });
    }
    if (op === 'release') {
      /* AMV-013: A RELEASE USED TO DELETE WHOEVER'S LOCK WAS THERE.

         Leases expire. A holder whose work outran its TTL - a slow storage
         call, a provider taking its time - lost the lock without knowing, and
         somebody else took it. Then the first one finished and released, and
         the delete was unconditional: it removed the SECOND holder's lock while
         that holder was still working. From there both of them believe they
         have it, which is the exact state the lock exists to make impossible,
         and it happens under load rather than under attack.

         A release now has to name the claim it is giving back. One that does
         not match is a holder whose lease had already expired, which is worth
         knowing about on its own - so it is reported rather than silently
         ignored. */
      const held = await this.state.storage.get('claim');
      if (!held) return json({ released: true, wasHeld: false });
      if (body.owner && held.owner && held.owner !== body.owner) {
        return json({ released: false, reason: 'not_owner' });
      }
      await this.state.storage.delete('claim');
      return json({ released: true, wasHeld: true });
    }
    if (op === 'get') {
      return json({ value: (await this.state.storage.get('v')) || 0 });
    }
    /* A TALLY: how many times each job id was switched on, and in all.
       Counted here rather than in one shared KV record because every job
       created anywhere used to take the same lock on the same key - KV takes
       about one write a second per key - so under real traffic creations
       queued behind each other, lock timeouts dropped counts and paged the
       owner. Inside the object every call is serialized, with no lock to
       take. Bounded the same way the record was: past `cap` distinct ids, ids
       already counted keep counting and new ones are not added. No alarm is
       ever set on a tally object, so nothing wipes it. */
    if (op === 'tally') {
      const id = String(body.id || '').slice(0, 120);
      const cap = Math.max(1, Math.min(10000, Number(body.cap) || 1000));
      const t = (await this.state.storage.get('t')) || { counts: {}, total: 0 };
      if (id && (Object.prototype.hasOwnProperty.call(t.counts, id) || Object.keys(t.counts).length < cap)) {
        t.counts[id] = (t.counts[id] || 0) + 1;
      }
      t.total = (t.total || 0) + 1;
      await this.state.storage.put('t', t);
      return json({ total: t.total });
    }
    if (op === 'tallyGet') {
      return json((await this.state.storage.get('t')) || { counts: {}, total: 0 });
    }
    if (op === 'checkCap') {
      const cur = (await this.state.storage.get('v')) || 0;
      return json({ allowed: cur < body.cap, value: cur });
    }
    return json({ error: 'bad op' }, 400);
  }
  // when the alarm fires, wipe stale counter storage to reclaim space
  async alarm() { await this.state.storage.deleteAll(); }
}

/* Helper: call a named counter DO. Falls back to KV (non-atomic) only if
   the DO binding isn't configured, so the Worker still runs in dev. */
async function counter(env, name, payload) {
  try {
    if (env.AMV_COUNTER) {
      const id = env.AMV_COUNTER.idFromName(name);
      const stub = env.AMV_COUNTER.get(id);
      const r = await stub.fetch('https://do/counter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return await r.json();
    }
  } catch (e) {
    // AMV-016: the DO was BOUND but the atomic call failed. That is a real
    // degradation of a security/cost counter to non-atomic KV - do not do it
    // silently. Alert operators (throttled) so a transient/fault condition that
    // weakens quota enforcement is visible instead of a transparent downgrade.
    try { if (env.AMV_COUNTER) await alertOnce(env, 'counter_degraded', 'Atomic counter DO failed - falling back to non-atomic KV, quota enforcement is weakened: ' + String((e && e.message) || e), 15); } catch (_) {}
    /* AMV-032: AND FOR THE OPS WHERE ATOMICITY IS THE WHOLE POINT, DO NOT.

       Alerting was the right first step and it is not enough on its own,
       because the fallback still ran. `claim` and `reserve` are not counters
       that can be a little bit wrong - they are the mutual exclusion behind a
       payout and the ceiling behind a bill. Done through KV they are a read
       followed by a write, which is the race they exist to close, so a failing
       DO quietly turned "only one of these may proceed" into "all of them may".

       An UNBOUND namespace is different and keeps its fallback: that is a
       development machine with no Durable Object configured, the degradation is
       documented, and refusing there would mean the product does not run at all
       without wrangler.

       Bound-and-failing is a fault, and the honest answer to a fault is that
       the question could not be answered. Callers already understand
       `unavailable` - guardAction turns it into a 503 that says so rather than
       telling somebody they are going too fast. */
    /* AMV-032b: AND rateCheck, WHICH WAS LEFT OUT AND SHOULD NOT HAVE BEEN.

       The rule above was written for claim and reserve because those are
       mutual exclusion and a ceiling on money. A rate limit looked softer, so
       it kept the KV fallback - and the fallback is a read followed by a
       write, which is the exact race the Durable Object exists to close. Under
       any concurrency it is not a slightly loose limit, it is no limit:
       measured on the KV path, forty-five simultaneous calls against a cap of
       thirty let all forty-five through, because every one of them read zero
       before any of them wrote one.

       It went unnoticed because almost every caller also passes a daily cap,
       and that second call IS a reserve - so a bound-and-failing namespace
       already answered `unavailable` a line later and the racy minute check
       never decided anything. Exactly one caller has no daily cap, and it is
       the worst one to have missed: /crew/popular, the public unauthenticated
       route whose own comment says an endpoint anybody can reach without a
       credential is the one worth hammering. Its only ceiling was the racy one,
       and it reported success while enforcing nothing.

       Bound-and-failing now answers that the question could not be answered,
       the same as the other two. An UNBOUND namespace keeps the fallback for
       the same reason it always did: that is a development machine with no
       Durable Object, and refusing there means the product does not run. */
    /* A credit or its reversal, falling back to KV, lands on a key the balance
       is never read from: paid for and never seen. The caller asks for that to
       be an error instead, so the payment provider's retry can finish it. */
    if (env.AMV_COUNTER && payload.strict) throw e;
    if (env.AMV_COUNTER && (payload.op === 'claim' || payload.op === 'reserve' || payload.op === 'rateCheck')) {
      audit(env, 'atomic_unavailable', { op: payload.op, name: String(name).slice(0, 120) });
      if (payload.op === 'claim') return { claimed: false, unavailable: true, code: 'atomic_unavailable' };
      if (payload.op === 'rateCheck') return { allowed: false, unavailable: true, code: 'atomic_unavailable', count: 0 };
      return { allowed: false, unavailable: true, code: 'atomic_unavailable', value: 0 };
    }
  }
  // ---- KV fallback (best-effort, NOT atomic) - only used if DO unbound ----
  return _counterKVFallback(env, name, payload);
}
async function _counterKVFallback(env, name, payload) {
  const op = payload.op;
  /* No usable store at all. Every branch below reaches straight into
     env.AMV_KV, so an unbound (or half-bound) namespace used to surface as a
     TypeError thrown from whichever handler happened to touch a counter -
     a 500 with no explanation, from code that had nothing to do with the
     fault. Answer honestly instead: nothing can be counted, so nothing is
     allowed, and the caller is told WHY rather than being handed an
     exception. Callers that must keep working without a counter check for
     `unavailable` and decide for themselves. */
  const kv = env && env.AMV_KV;
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    try { await alertOnce(env, 'counter_unavailable', 'No counter storage is bound (AMV_COUNTER and AMV_KV are both unusable) - limits and caps cannot be enforced.', 15); } catch (_) {}
    return { allowed: false, value: 0, count: 0, unavailable: true };
  }
  if (op === 'rateCheck') {
    const cur = parseInt(await env.AMV_KV.get('rl:' + name) || '0', 10);
    if (cur >= payload.limit) return { allowed: false, count: cur };
    await env.AMV_KV.put('rl:' + name, String(cur + 1), { expirationTtl: Math.ceil((payload.windowMs || 60000) / 1000) + 10 });
    return { allowed: true, count: cur + 1 };
  }
  if (op === 'incr') {
    const cur = parseFloat(await env.AMV_KV.get('ctr:' + name) || '0');
    const next = Math.max(0, cur + (payload.amount || 0));
    await env.AMV_KV.put('ctr:' + name, String(next), payload.ttlMs ? { expirationTtl: Math.ceil(payload.ttlMs / 1000) } : undefined);
    return { value: next };
  }
  if (op === 'reserve') {
    // Best-effort only. This IS the race the DO exists to close - without the
    // AMV_COUNTER binding a concurrent burst can still overshoot. Bind the
    // Durable Object in wrangler.toml (see the comments there).
    const cur = parseFloat(await env.AMV_KV.get('ctr:' + name) || '0');
    const amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount < 0) return { allowed: false, value: cur };
    const next = cur + amount;
    // deny when the RESULT would exceed the cap (AMV-017), not just when cur does
    if (next > payload.cap) return { allowed: false, value: cur };
    await env.AMV_KV.put('ctr:' + name, String(next), payload.ttlMs ? { expirationTtl: Math.ceil(payload.ttlMs / 1000) } : undefined);
    return { allowed: true, value: next };
  }
  if (op === 'get') return { value: parseFloat(await env.AMV_KV.get('ctr:' + name) || '0') };
  if (op === 'checkCap') { const cur = parseFloat(await env.AMV_KV.get('ctr:' + name) || '0'); return { allowed: cur < payload.cap, value: cur }; }
  return { error: 'bad op' };
}

/* Reusable per-actor rate limit + optional daily cap. Use on any endpoint that
   writes data or spends money, so no single account can spam it. Atomic via the
   Durable Object, so parallel requests can't race past the limit.
     key    - a stable id for the actor+action, e.g. `handoff:${email}`
     perMin - max calls per rolling minute
     perDay - optional max calls per day (0 = no daily cap)
   Returns { ok:true } or { ok:false, code, retry } - caller turns !ok into a 429. */
/* A CEILING ON THE WRITES THAT DO NOT MATTER, SO THEY CANNOT STARVE THE ONES
   THAT DO.

   Cloudflare's free KV tier allows 1000 writes a DAY for the whole account.
   Two endpoints here are public, unauthenticated, and write once per request:
   /errors (telemetry) and /waitlist. Both were rate-limited per IP and nothing
   else - 500 a day and 50 a day respectively - so two IPs at the telemetry
   allowance is 1000 writes: the entire account's budget for the day, spent on
   error reports.

   When it is gone, every write fails. Sign-up. Session. Save. The KV
   bookkeeping behind a payment. For everybody, until the quota rolls over, and
   nothing in the product would know that was why.

   Neither per-IP limit is wrong on its own. What was missing is that no
   allowance may be larger than a fraction of what the account HAS. Telemetry
   and a waitlist are the two least important writes AMV makes, so they get a
   small shared daily ceiling and are refused first - which is the correct order
   for a product to shed load in.

   Exhausting it is worth knowing about: it is either far more traffic than
   expected or somebody pushing on it, and both are things an operator should
   hear once rather than discover from a dead sign-up page. */
const NONESSENTIAL_DAILY_WRITES = 150;
async function _nonEssentialWrite(env, what) {
  const cap = Math.max(1, parseInt(env.NONESSENTIAL_WRITE_CAP || '', 10) || NONESSENTIAL_DAILY_WRITES);
  const res = await counter(env, `noness:${todayKey()}`,
    { op: 'reserve', amount: 1, cap, ttlMs: 86400000 * 2 });
  /* The counter itself being unreachable is not a reason to spend the budget on
     the least important thing AMV does. Refuse, quietly. */
  if (res.unavailable) return false;
  if (!res.allowed) {
    try {
      await alertOnce(env, 'noness_write_cap',
        'The daily ceiling on non-essential writes (' + cap + ') is used up, so ' + what +
        ' is being refused to keep sign-ups, sessions and saves working. Either traffic is far ' +
        'higher than expected or somebody is pushing on a public endpoint.', 720);
    } catch (e) {}
    return false;
  }
  return true;
}

async function limitAction(env, key, perMin, perDay = 0) {
  const minName = `act:${key}:${Math.floor(Date.now() / 60000)}`;
  const minRes = await counter(env, minName, { op: 'rateCheck', limit: perMin, windowMs: 60000 });
  /* The counter could not be reached at all. That is a server fault, not the
     caller doing something too often, and saying "slow down" would blame them
     for it. Pass the distinction up so the caller can answer honestly. */
  if (minRes.unavailable) return { ok: false, code: 'limit_unavailable', unavailable: true };
  if (!minRes.allowed) return { ok: false, code: 'rate_limited', scope: 'minute' };
  if (perDay > 0) {
    const dayName = `actday:${key}:${todayKey()}`;
    const dayRes = await counter(env, dayName, { op: 'reserve', amount: 1, cap: perDay, ttlMs: 86400000 * 2 });
    if (dayRes.unavailable) return { ok: false, code: 'limit_unavailable', unavailable: true };
    if (!dayRes.allowed) return { ok: false, code: 'daily_limit', scope: 'day' };
  }
  return { ok: true };
}

/* Convenience: run the limit and, if blocked, return the 429 response directly.
   `label` is a friendly noun for the message ("handoffs", "listings"). */
/* WHO A HANDOFF MAY BE ADDRESSED TO.

   Written out twice inline, which is two copies of a security bound and two
   chances for one of them to drift. Named once so both sites ask the same
   question, and so a test can hold THIS pattern rather than a second copy of
   it that would keep passing after the real one changed.

   The characters it excludes are the point: a space, a colon and a newline are
   not typos in an address, they are the start of another mail header. */
const HANDOFF_TO_RE = /^[^\s@:]{1,64}@[^\s@:]+\.[^\s@:]{2,}$/;

async function guardAction(env, key, perMin, perDay, label) {
  const r = await limitAction(env, key, perMin, perDay);
  if (r.ok) return null;
  /* Storage is gone, so the limit could not be evaluated. Refusing is right -
     an unenforceable cap is not a cap - but it is a 503 and it says so,
     because telling somebody they are going too fast when the fault is ours
     sends them off to fix something that is not broken. */
  if (r.unavailable) {
    return json({ error: 'That is temporarily unavailable. Please try again in a moment.', code: r.code }, 503);
  }
  const msg = r.scope === 'day'
    ? `You've hit the daily limit for ${label}. Try again tomorrow.`
    : `You're doing that too fast. Give it a moment.`;
  /* HOW LONG TO WAIT, said rather than left to be guessed.

     No 429 in this file carried Retry-After, and the client retries a 429 with
     an exponential backoff that starts in the hundreds of milliseconds - well
     inside a per-minute window. So a caller who hit the limit spent two more
     attempts being refused, which the limiter has to handle, and burned their
     own remaining budget doing it. The header is the one thing that makes a
     retry useful instead of harmful: the minute limit says how long is left of
     this minute, the daily one says try tomorrow. */
  const retryAfter = r.scope === 'day'
    ? Math.max(60, Math.ceil((86400000 - (Date.now() % 86400000)) / 1000))
    : Math.max(1, 60 - Math.floor((Date.now() % 60000) / 1000));
  return json({ error: msg, code: r.code, retryAfter }, 429, { 'Retry-After': String(retryAfter) });
}

/* SECONDS UNTIL IT IS WORTH TRYING AGAIN, for a 429 that is not built by
   `_limitOrRefuse`.

   That helper computes this correctly and explains why it matters: the client
   retries a 429 with an exponential backoff starting in the hundreds of
   milliseconds, well inside a per-minute window, so a refused caller spends
   two or three more attempts being refused - and every one of those costs a
   Durable Object op on the way in.

   The endpoints that do NOT go through the helper are the ones where that
   costs the most. `/v1/messages` is called on every message anybody sends and
   is the only route that spends real money; its three refusals carried no
   Retry-After at all, while two cheaper routes in this same file hard-code
   `'60'`. The fix was applied where it barely mattered and skipped where it
   does.

   Two shapes, because a limit and a quota are different waits. A window is
   whatever is left of this minute. A quota already knows the instant it
   resets, so it is asked. Floored at a second so a header never says zero,
   and capped at a day so a clock skew cannot tell somebody to wait a year. */
const _retryAfterWindow = () => Math.max(1, 60 - Math.floor((Date.now() % 60000) / 1000));
/* Until UTC midnight, for the two caps that are keyed on `todayKey()` and
   really do reset then. Both of those refusals are 503s, and a 503 is the
   WORSE one to send bare: a 429 is about one caller, a 503 is about everybody,
   so every client in the world backs off on the same exponential curve and
   comes back together. Saying when turns a thundering herd into a queue. */
const _retryAfterMidnight = () => {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return String(Math.max(1, Math.min(86400, Math.ceil((midnight - Date.now()) / 1000))));
};
const _retryAfterUntil = (at) => {
  const secs = Math.ceil(((+at || 0) - Date.now()) / 1000);
  return String(Math.max(1, Math.min(86400, secs || 1)));
};

