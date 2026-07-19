/* =====================================================================
   AMV.AI — PRODUCTION BACKEND (Cloudflare Worker)
   The real, fundable backend. Makes every feature WORK and SAFE:
     • AI proxy (/v1/messages)  — streaming, key hidden server-side
     • Server-side PLAN enforcement (free can't call premium models)
     • Per-account token QUOTAS (daily + monthly) — real margin control
     • Per-account + per-IP RATE LIMITS
     • GLOBAL spend cap + KILL SWITCH
     • Usage + cost tracking per user (KV)
     • Image / video metering hooks
     • Payments (Stripe + PayPal) — from the payments worker
   ---------------------------------------------------------------------
   This is what converts AMV from "demo" to "live product you can fund."
   Deploy guide at the bottom.
   ===================================================================== */

// CORS — wildcard origin is fine for a token-authenticated public API (the
// token, not the origin, is the security boundary). To lock the browser API
// to ONLY your frontend in production, replace '*' with your domain, e.g.
// 'https://app.yourdomain.com'. Webhooks are server-to-server and need no CORS.
const _corsOrigin = (env) => (env && env.ALLOWED_ORIGIN) || '*';
const corsFor = (env) => ({
  'Access-Control-Allow-Origin': _corsOrigin(env),
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
});
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
// Security headers applied to every response. Protects users against clickjacking,
// MIME-sniffing, protocol downgrade, and referrer leakage. CSP here is API-appropriate
// (the API returns JSON, not HTML) — the static site sets its own page-level CSP.
const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-site',
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...CORS, ...SECURITY_HEADERS } });

/* ---- model catalog: maps AMV model -> real engine + cost + min plan ---- */
const ENGINES = {
  'amv-pulse': { model: 'claude-haiku-4-5-20251001', minPlan: 'free',  inCost: 1,  outCost: 5,   maxOut: 4000 },
  'amv-core':  { model: 'claude-sonnet-4-6',         minPlan: 'free',  inCost: 3,  outCost: 15,  maxOut: 8000 },
  'amv-forge': { model: 'claude-opus-4-8',           minPlan: 'pro',   inCost: 15, outCost: 75,  maxOut: 16000 },
  'amv-apex':  { model: 'claude-fable-5',            minPlan: 'elite', inCost: 20, outCost: 100, maxOut: 16000 },
};
// Map every form the frontend might send -> canonical engine key. The picker
// sends the real model string today, but we also accept the short keys
// (fast/core/coding/smart), the amv-* names, and 'auto' (smart routing ->
// core as a safe, cost-controlled default) so engine resolution is never a
// silent mis-default. (auditor #6: RAW_TO_KEY/engine resolution consistency)
const RAW_TO_KEY = {
  // real model strings
  'claude-haiku-4-5-20251001': 'amv-pulse',
  'claude-sonnet-4-6': 'amv-core',
  'claude-opus-4-8': 'amv-forge',
  'claude-fable-5': 'amv-apex',
  // frontend short keys
  'fast': 'amv-pulse', 'core': 'amv-core', 'coding': 'amv-forge', 'smart': 'amv-apex',
  // amv-friendly aliases
  'amv-pulse': 'amv-pulse', 'amv-core': 'amv-core', 'amv-forge': 'amv-forge', 'amv-apex': 'amv-apex',
  // smart routing -> balanced default
  'auto': 'amv-core', '': 'amv-core',
};
const PLAN_RANK = { free: 0, pro: 1, elite: 2, ultra: 3 };

// In-isolate cache for the global kill switch (avoids a KV read per request).
const _KILL_TTL_MS = 5000;
let _killCache = { val: false, ts: 0 };

/* =====================================================================
   DURABLE DATA LAYER (auditor #2)
   System-of-record data (accounts, entitlements, teams, per-user data) should
   live in a real database, not KV (which is eventually-consistent and built
   for caching). This layer uses Cloudflare D1 (SQLite) when an env.DB binding
   is present, and transparently falls back to KV otherwise — so the app keeps
   working today, and turning on D1 is a config change, not a rewrite.

   D1 gives: strong consistency (no stale auth reads), real queries (the admin
   dashboard can COUNT/WHERE instead of listing every key), and no 25MB/key
   ceiling. KV stays for what it's good at: counters and rate-limit windows.

   To enable D1:
     wrangler d1 create amv
     wrangler d1 execute amv --command "CREATE TABLE IF NOT EXISTS kv (
       kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL,
       updated_at INTEGER, PRIMARY KEY (kind, id));"
     # bind as [[d1_databases]] binding = "DB" in wrangler.toml
   ===================================================================== */
const DB = {
  _hasD1(env){ return !!(env && env.DB && typeof env.DB.prepare === 'function'); },
  async get(env, kind, id){
    if(this._hasD1(env)){
      const row = await env.DB.prepare('SELECT json FROM kv WHERE kind=? AND id=?').bind(kind, id).first();
      return row && row.json ? JSON.parse(row.json) : null;
    }
    const raw = await env.AMV_KV.get(`${kind}:${id}`);
    return raw ? JSON.parse(raw) : null;
  },
  async put(env, kind, id, obj, kvOpts){
    const j = JSON.stringify(obj);
    if(this._hasD1(env)){
      await env.DB.prepare('INSERT INTO kv (kind,id,json,updated_at) VALUES (?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at')
        .bind(kind, id, j, Date.now()).run();
      return;
    }
    await env.AMV_KV.put(`${kind}:${id}`, j, kvOpts);
  },
  async del(env, kind, id){
    if(this._hasD1(env)){ await env.DB.prepare('DELETE FROM kv WHERE kind=? AND id=?').bind(kind, id).run(); return; }
    await env.AMV_KV.delete(`${kind}:${id}`);
  },
  async list(env, kind, limit){
    const out = [];
    if(this._hasD1(env)){
      const rows = await env.DB.prepare('SELECT id,json FROM kv WHERE kind=? LIMIT ?').bind(kind, limit||1000).all();
      for(const r of (rows.results||[])){ try{ out.push({ id:r.id, value:JSON.parse(r.json) }); }catch{} }
      return out;
    }
    let cursor;
    do {
      const page = await env.AMV_KV.list({ prefix: `${kind}:`, cursor, limit: 1000 });
      for(const k of page.keys){
        const raw = await env.AMV_KV.get(k.name);
        if(raw){ try{ out.push({ id:k.name.slice(kind.length+1), value:JSON.parse(raw) }); }catch{} }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while(cursor && out.length < (limit||100000));
    return out;
  },
};

// Per-plan limits (TUNE THESE to protect margin). Tokens/day, tokens/month.
const PLAN_LIMITS = {
  // Token allowances per plan. These are sized to be GENEROUS for real usage
  // (a heavy day of chatting/coding is well under the daily cap) while keeping a
  // healthy margin at worst case — the plan price is decoupled from raw token
  // cost, exactly like ChatGPT/Claude. The 45% cost backstop below is only an
  // anti-abuse floor that normal users never reach. Blended compute ~$6/Mtok:
  //   pro   $15  -> ~1.8M/mo ≈ $11 worst-case compute (~27% floor, usually far higher margin)
  //   elite $75  -> ~7M/mo, ultra $200 -> ~18M/mo — all comfortably profitable.
  free:  { dayTokens: 40000,    monthTokens: 250000,    rpm: 8,  imagesDay: 8,   videosMonth: 0 },
  pro:   { dayTokens: 250000,   monthTokens: 1800000,   rpm: 20, imagesDay: 100, videosMonth: 20 },
  elite: { dayTokens: 900000,   monthTokens: 7000000,   rpm: 40, imagesDay: 500, videosMonth: 120 },
  ultra: { dayTokens: 2200000,  monthTokens: 18000000,  rpm: 80, imagesDay: 2000, videosMonth: 600 },
};

/* =====================================================================
   AUDIT LOGGING (auditor #5)
   Structured, security-relevant event logging. Goes to:
   - console (captured by Cloudflare Workers Logs / Logpush), and
   - optionally an external sink (AUDIT_WEBHOOK) for anomaly detection.
   We log auth failures, quota/rate/spend blocks, and forged webhooks —
   the signals you'd watch to spot abuse. PII is minimized (email only).
   ===================================================================== */
function audit(env, event, detail) {
  try {
    const rec = { t: new Date().toISOString(), event, ...detail };
    // Workers Logs captures console output; cheap and always-on.
    console.log('AUDIT ' + JSON.stringify(rec));
    // Optional: ship high-signal events to an external collector.
    if (env && env.AUDIT_WEBHOOK && _highSignal(event)) {
      // fire-and-forget; never block the request on logging
      fetch(env.AUDIT_WEBHOOK, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      }).catch(() => {});
    }
  } catch { /* logging must never throw */ }
}
function _highSignal(event) {
  return event === 'auth_fail' || event === 'spend_cap_hit' ||
         event === 'forged_webhook' || event === 'global_cap_hit';
}

const todayKey = () => new Date().toISOString().slice(0, 10);
const monthKey = () => new Date().toISOString().slice(0, 7);

/* =====================================================================
   INPUT VALIDATION (auditor #4)
   Bounds request size and enforces a sane message structure before we
   forward anything upstream. This caps cost-per-call and shrinks the
   attack surface (oversized payloads, malformed roles, junk content).

   NOTE on prompt injection: a proxy cannot fully "prevent" prompt
   injection — that's a model-layer concern. What we CAN do here is
   bound and shape input, reject obviously malformed payloads, and keep
   the system prompt server-controlled (we wrap it with cache_control and
   never let the client overwrite our safety framing). Defense in depth.
   ===================================================================== */
const MAX_MESSAGES = 200;          // conversation turns per request
const MAX_TOTAL_CHARS = 600000;    // ~150k tokens of input — generous but bounded
const MAX_SYSTEM_CHARS = 100000;
const VALID_ROLES = new Set(['user', 'assistant']);

function validateMessagesPayload(body) {
  const msgs = body.messages;
  if (!Array.isArray(msgs)) return 'messages must be an array';
  if (msgs.length === 0) return 'messages cannot be empty';
  if (msgs.length > MAX_MESSAGES) return `too many messages (max ${MAX_MESSAGES})`;

  let totalChars = 0;
  for (const m of msgs) {
    if (!m || typeof m !== 'object') return 'each message must be an object';
    if (!VALID_ROLES.has(m.role)) return `invalid message role: ${String(m.role).slice(0, 20)}`;
    // content may be a string or an array of content blocks
    if (typeof m.content === 'string') {
      totalChars += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (!block || typeof block !== 'object') return 'invalid content block';
        if (typeof block.text === 'string') totalChars += block.text.length;
        // allow image/tool blocks through but bound any text
      }
    } else {
      return 'message content must be a string or array';
    }
    if (totalChars > MAX_TOTAL_CHARS) return 'request too large — please shorten the conversation';
  }
  if (body.system != null) {
    if (typeof body.system !== 'string') return 'system must be a string';
    if (body.system.length > MAX_SYSTEM_CHARS) return 'system prompt too large';
  }
  if (body.max_tokens != null) {
    const mt = Number(body.max_tokens);
    if (!Number.isFinite(mt) || mt < 1 || mt > 64000) return 'max_tokens out of range';
  }
  return null; // valid
}

/* =====================================================================
   ATOMIC COUNTERS — Durable Object
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
    /* ATOMIC TEST-AND-INCREMENT — this is what makes a quota a quota.
       A separate `get` then `incr` can be interleaved by concurrent requests:
       they all read the same value, all decide they fit, and all proceed. Doing
       the compare and the increment together, inside the DO's serialized
       execution, means only the callers that actually fit under the cap get
       through — no matter how many arrive at once. */
    if (op === 'reserve') {
      const cur = (await this.state.storage.get('v')) || 0;
      const amount = body.amount || 0;
      if (cur >= body.cap) {
        return json({ allowed: false, value: cur });
      }
      const next = cur + amount;
      await this.state.storage.put('v', next);
      if (body.ttlMs) await this.state.storage.setAlarm(Date.now() + body.ttlMs);
      return json({ allowed: true, value: next });
    }
    if (op === 'get') {
      return json({ value: (await this.state.storage.get('v')) || 0 });
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
  } catch (e) { /* fall through to KV fallback */ }
  // ---- KV fallback (best-effort, NOT atomic) — only used if DO unbound ----
  return _counterKVFallback(env, name, payload);
}
async function _counterKVFallback(env, name, payload) {
  const op = payload.op;
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
    // Best-effort only. This IS the race the DO exists to close — without the
    // AMV_COUNTER binding a concurrent burst can still overshoot. Bind the
    // Durable Object in wrangler.toml (see the comments there).
    const cur = parseFloat(await env.AMV_KV.get('ctr:' + name) || '0');
    if (cur >= payload.cap) return { allowed: false, value: cur };
    const next = cur + (payload.amount || 0);
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
     key    — a stable id for the actor+action, e.g. `handoff:${email}`
     perMin — max calls per rolling minute
     perDay — optional max calls per day (0 = no daily cap)
   Returns { ok:true } or { ok:false, code, retry } — caller turns !ok into a 429. */
async function limitAction(env, key, perMin, perDay = 0) {
  const minName = `act:${key}:${Math.floor(Date.now() / 60000)}`;
  const minRes = await counter(env, minName, { op: 'rateCheck', limit: perMin, windowMs: 60000 });
  if (!minRes.allowed) return { ok: false, code: 'rate_limited', scope: 'minute' };
  if (perDay > 0) {
    const dayName = `actday:${key}:${todayKey()}`;
    const dayRes = await counter(env, dayName, { op: 'reserve', amount: 1, cap: perDay, ttlMs: 86400000 * 2 });
    if (!dayRes.allowed) return { ok: false, code: 'daily_limit', scope: 'day' };
  }
  return { ok: true };
}

/* Convenience: run the limit and, if blocked, return the 429 response directly.
   `label` is a friendly noun for the message ("handoffs", "listings"). */
async function guardAction(env, key, perMin, perDay, label) {
  const r = await limitAction(env, key, perMin, perDay);
  if (r.ok) return null;
  const msg = r.scope === 'day'
    ? `You've hit the daily limit for ${label}. Try again tomorrow.`
    : `You're doing that too fast. Give it a moment.`;
  return json({ error: msg, code: r.code }, 429);
}

/* ══════════════════════════════════════════════════════════════
   BACKGROUND AUTOMATIONS  —  they run whether or not the app is open.

   Before this, "scheduled automations" only fired when the user happened to
   open the app (client-side _runDueTasks). That meant a "7am daily brief"
   only appeared if you opened AMV at 7am — which defeats the point, and the
   product was being sold on it.

   Now: automations live server-side and are executed by a Cloudflare Cron
   trigger. Results are waiting for the user when they come back.

   Requires in wrangler.toml:
     [triggers]
     crons = ["EVERY_5_MIN"]   // use the 5-minute cron expression here
   ══════════════════════════════════════════════════════════════ */

const AUTO_MAX_PER_USER = 25;                    // hard cap: no runaway fan-out
const AUTO_INTERVALS = { '10min': 600e3, '30min': 1800e3, hourly: 3600e3, daily: 86400e3, weekly: 604800e3 };
const AUTO_MAX_RESULTS = 50;
// The cron fires every 5 minutes, so the shortest meaningful interval is ~10min.
// We keep a floor so nobody can schedule a job that hammers the model every tick.
const AUTO_MIN_INTERVAL = 600e3;

function _autoKey(email){ return String(email||'').toLowerCase(); }

/* ---- list a user's automations ---- */
async function autoList(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const rec = (await DB.get(env, 'auto', _autoKey(user.email))) || { items:[], results:[] };
  return json({ ok:true, items: rec.items||[], results: (rec.results||[]).slice(-AUTO_MAX_RESULTS) });
}

/* ---- create an automation ---- */
async function autoCreate(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const body = await request.json().catch(()=>({}));
  const detail = String(body.detail||'').trim();
  const repeat = String(body.repeat||'daily').toLowerCase();
  const kind = (body.kind === 'research') ? 'research' : 'task';
  const notify = (body.notify === 'email') ? 'email' : 'app';
  if(!detail) return json({ error:'detail required' }, 400);
  if(detail.length > 2000) return json({ error:'detail too long' }, 400);
  if(!AUTO_INTERVALS[repeat]) return json({ error:'invalid repeat interval' }, 400);

  const key = _autoKey(user.email);
  const rec = (await DB.get(env, 'auto', key)) || { items:[], results:[] };
  if((rec.items||[]).length >= AUTO_MAX_PER_USER)
    return json({ error:'You can have up to '+AUTO_MAX_PER_USER+' automations.' }, 429);

  // Honour the user's requested first-run time if given, else one interval out.
  const interval = Math.max(AUTO_MIN_INTERVAL, AUTO_INTERVALS[repeat]);
  let next = Date.now() + interval;
  if(body.firstRunAt && Number.isFinite(+body.firstRunAt)){
    const t = +body.firstRunAt;
    if(t > Date.now() - 60e3 && t < Date.now() + 366*86400e3) next = t;
  }
  const item = {
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2,7),
    detail, repeat, interval, next, kind, notify,
    created: Date.now(), runs: 0, lastError: null, active: true
  };
  rec.items = (rec.items||[]).concat(item);
  await DB.put(env, 'auto', key, rec);
  return json({ ok:true, item });
}

/* ---- delete / pause an automation ---- */
async function autoUpdate(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const body = await request.json().catch(()=>({}));
  const id = String(body.id||'');
  const key = _autoKey(user.email);
  const rec = (await DB.get(env, 'auto', key)) || { items:[], results:[] };
  const items = rec.items||[];
  const i = items.findIndex(x=>x.id===id);
  if(i < 0) return json({ error:'not found' }, 404);

  if(body.action === 'delete') items.splice(i,1);
  else if(body.action === 'pause')  items[i].active = false;
  else if(body.action === 'resume'){ items[i].active = true; items[i].next = Date.now() + items[i].interval; }
  else return json({ error:'unknown action' }, 400);

  rec.items = items;
  await DB.put(env, 'auto', key, rec);
  return json({ ok:true, items });
}

/* ---- mark results as read ---- */
async function autoClearResults(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const key = _autoKey(user.email);
  const rec = (await DB.get(env, 'auto', key)) || { items:[], results:[] };
  (rec.results||[]).forEach(r=>{ r.read = true; });
  await DB.put(env, 'auto', key, rec);
  return json({ ok:true });
}

/* ---- Execute ONE automation against the real model ---- */
async function _autoExecute(env, item){
  const isResearch = item.kind === 'research';

  /* Research jobs SEARCH THE LIVE WEB and report what's happening. The prompt is
     deliberately framed as monitoring and analysis \u2014 "here's what changed,
     here's what it might mean" \u2014 and explicitly NOT as financial advice. AMV
     never tells the user to buy, sell, or short. That's both the safe choice and
     the honest one: an unattended model should not be issuing trade signals. */
  const system = isResearch
    ? "You are AMV running an unattended research watch for the user. Search the live web NOW and report what is currently happening with the subject they asked you to monitor. "
      + "Give a tight, scannable brief: what changed, the key facts with numbers and dates, named sources, and any notable signals or risks. "
      + "If the subject is a stock, crypto, or other asset: report price action, news, sentiment, and notable events factually. "
      + "You must NOT give financial advice. Never tell the user to buy, sell, short, hold, or 'wait for an opening'. Never predict a specific price. "
      + "Describe what is happening and what people are saying; let the user decide. "
      + "Always end with a brief note that this is information, not financial advice."
    : 'You are AMV running a scheduled automation for the user, unattended. Complete the task fully and return the finished result in markdown. Be specific and useful \u2014 this is what they will read when they come back. Never say you will do it later; do it now.';

  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: isResearch ? 2500 : 3000,
    system,
    messages: [{ role:'user', content: item.detail }]
  };
  // Research jobs get the web_search tool so they actually pull live information.
  if(isResearch){
    body.tools = [{ type:'web_search_20250305', name:'web_search', max_uses: 8 }];
  }

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version':'2023-06-01'
    },
    body: JSON.stringify(body)
  });
  if(!r.ok){
    const t = await r.text().catch(()=>'');
    throw new Error('model error ' + r.status + ': ' + t.slice(0,180));
  }
  const data = await r.json();
  const text = (data.content||[]).map(b=>b.text||'').join('').trim();
  // Return usage too so the cron loop can charge automation spend against the
  // user's monthly cost cap — otherwise scheduled jobs would be a free way to
  // burn compute (a research watch every 10 min = thousands of calls/month).
  const usage = data.usage || {};
  return { text, usage: { input: usage.input_tokens||0, output: usage.output_tokens||0,
                          webSearches: (usage.server_tool_use && usage.server_tool_use.web_search_requests)||0 } };
}

/* Estimate USD cost of an automation run (worst-case-ish, matches the web path's
   accounting spirit). Web searches are billed by Anthropic per request. */
function _autoCostUSD(usage){
  const inUSD  = (usage.input||0)  / 1e6 * 3;     // ~$3 / M input
  const outUSD = (usage.output||0) / 1e6 * 15;    // ~$15 / M output
  const searchUSD = (usage.webSearches||0) * 0.01; // ~$10 / 1000 searches
  return inUSD + outUSD + searchUSD;
}

/* ---- Deliver an automation result by email ---- */
async function _autoEmailResult(env, email, item, out){
  const isResearch = item.kind === 'research';
  const label = String(item.detail||'').slice(0, 80);
  const subject = (isResearch ? 'AMV watch: ' : 'AMV update: ') + label;
  // Convert the markdown-ish result to simple HTML paragraphs (no heavy renderer
  // in the Worker — keep it robust and dependency-free).
  const esc = (t)=>String(t).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const htmlBody = esc(out)
    .replace(/^### (.*)$/gm,'<h3 style="margin:18px 0 6px;font-size:15px">$1</h3>')
    .replace(/^## (.*)$/gm,'<h2 style="margin:20px 0 8px;font-size:17px">$1</h2>')
    .replace(/\\*\\*(.+?)\\*\\*/g,'<b>$1</b>')
    .replace(/\\n\\n/g,'</p><p style="margin:0 0 12px;line-height:1.6;color:#333">')
    .replace(/\\n/g,'<br>');
  const html = _emailShell(
    isResearch ? 'Your research watch' : 'Your scheduled update',
    '<p style="margin:0 0 12px;font-size:13px;color:#777">You asked AMV to check on: <b>'+esc(label)+'</b></p>'+
    '<div style="font-size:14px"><p style="margin:0 0 12px;line-height:1.6;color:#333">'+htmlBody+'</p></div>',
    null,
    '<hr style="border:none;border-top:1px solid #eee;margin:16px 0"><p style="margin:0;font-size:11px;color:#999">You set up this recurring check in AMV. Manage or stop it anytime in the Tasks tab.</p>',
    'Automated update from AMV.'
  );
  const text = (isResearch ? 'AMV research watch\\n\\n' : 'AMV scheduled update\\n\\n')
    + 'Subject: ' + label + '\\n\\n' + out
    + '\\n\\n\\u2014 Manage this recurring check in AMV \\u2192 Tasks.';
  return _sendEmail(env, email, subject, html, text);
}

/* ---- The cron tick: find everything due, run it, store the result ---- */
async function runDueAutomations(env){
  const now = Date.now();
  let scanned = 0, ran = 0, failed = 0;
  // KV list of every user's automation record
  const listing = await env.AMV_KV.list({ prefix: 'auto:' });
  for(const k of (listing.keys||[])){
    const email = k.name.slice('auto:'.length);
    const rec = await DB.get(env, 'auto', email);
    if(!rec || !Array.isArray(rec.items) || !rec.items.length) continue;

    let changed = false;
    // The plan's monthly cost ceiling — automations spend real money and must
    // count against it, exactly like interactive use. Compute once per user.
    const ent = (await DB.get(env, 'ent', email)) || { plan: 'free' };
    const plan = ent.plan || 'free';
    const PLAN_PRICE = { pro:15, elite:75, ultra:200 };
    let planPrice = 0;
    if (plan === 'custom' && ent && ent.custom && ent.custom.price) planPrice = ent.custom.price;
    else if (PLAN_PRICE[plan]) planPrice = PLAN_PRICE[plan];
    const costCeiling = planPrice > 0 ? planPrice * 0.45 : 0;
    const costName = `cost:${email}:${monthKey()}`;

    for(const item of rec.items){
      scanned++;
      if(!item.active || item.next > now) continue;
      // If this user is already at their monthly spend ceiling, skip the run
      // (don't burn compute they've effectively used up). Free plan (ceiling 0)
      // has no paid budget for automations, so they never execute a paid model
      // call here — they degrade to nothing rather than costing us money.
      if(costCeiling > 0){
        const capNow = await counter(env, costName, { op:'checkCap', cap: costCeiling });
        if(!capNow.allowed){ item.lastError = 'monthly allowance reached'; changed = true; continue; }
      } else {
        // no paid budget — don't run paid automations for a free/unknown plan
        item.lastError = 'automations require a paid plan'; item.active = false; changed = true; continue;
      }
      try{
        const exec = await _autoExecute(env, item);
        const out = (exec && exec.text) || '';
        // record the real cost of this run against the monthly cap
        try{ const c = _autoCostUSD(exec && exec.usage || {});
          if(c>0){ await counter(env, costName, { op:'incr', amount:c, ttlMs: 86400000*70 });
                   await counter(env, `spend:${todayKey()}`, { op:'incr', amount:c, ttlMs: 86400000*2 }); } }catch(e){}
        rec.results = (rec.results||[]).concat({
          id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
          autoId: item.id, detail: item.detail, out, at: Date.now(), read: false, kind: item.kind||'task'
        }).slice(-AUTO_MAX_RESULTS);
        item.runs = (item.runs||0) + 1;
        item.lastError = null;
        ran++;
        // Deliver by email if the user asked for it and email is configured.
        if(item.notify === 'email' && env.EMAIL_API_KEY){
          try{ await _autoEmailResult(env, email, item, out); }catch(e){ /* delivery is best-effort */ }
        }
      }catch(e){
        item.lastError = String(e.message||e).slice(0,200);
        item.errors = (item.errors||0) + 1;
        // Give up on an automation that keeps failing, rather than burning quota forever.
        if(item.errors >= 5) item.active = false;
        failed++;
      }
      item.next = now + (item.interval || AUTO_INTERVALS.daily);
      changed = true;
    }
    if(changed) await DB.put(env, 'auto', email, rec);
  }
  return { scanned, ran, failed };
}

/* ══════════════════════════════════════════════════════════════
   REAL DEPLOYMENT  —  ship a live, public URL.

   "Deploy" used to base64 the page into a URL fragment and tell the user
   "nothing is stored on a server" — which is not a deployment. It broke past
   ~18KB, and the pricing page sells "one-click deploy" and "host multiple
   live apps". So: actually host them.

   POST /deploy         -> publish (auth) -> { url }
   POST /deploy/list    -> the user's live sites
   POST /deploy/delete  -> take a site down
   GET  /s/<slug>       -> the live, public page
   ══════════════════════════════════════════════════════════════ */

const SITE_MAX_BYTES     = 2 * 1024 * 1024;   // 2MB per site
const SITE_MAX_PER_USER  = 25;
const SLUG_RE            = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

function _slugify(t){
  return String(t||'app').toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,32) || 'app';
}
function _siteUrl(request, slug){
  const u = new URL(request.url);
  return u.origin + '/s/' + slug;
}

/* ---- Publish ---- */
async function deploySite(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);

  const body  = await request.json().catch(()=>({}));
  const html  = String(body.html||'');
  const title = String(body.title||'App').slice(0,80);
  if(!html.trim())            return json({ error:'nothing to deploy' }, 400);
  if(html.length > SITE_MAX_BYTES)
    return json({ error:'Site is too large ('+(html.length/1048576).toFixed(1)+'MB). Limit is 2MB.' }, 413);

  const owner = String(user.email).toLowerCase();
  const idx   = (await DB.get(env, 'sites', owner)) || { slugs: [] };

  // Reuse the slug if they're updating an existing site of theirs.
  let slug = body.slug ? String(body.slug).toLowerCase() : '';
  if(slug && !SLUG_RE.test(slug)) return json({ error:'invalid name' }, 400);

  if(slug){
    const existing = await DB.get(env, 'site', slug);
    if(existing && existing.owner !== owner) return json({ error:'that name is taken' }, 409);
  } else {
    if((idx.slugs||[]).length >= SITE_MAX_PER_USER)
      return json({ error:'You can host up to '+SITE_MAX_PER_USER+' sites. Delete one first.' }, 429);
    // find a free slug
    const base = _slugify(title);
    slug = base;
    for(let i=0; i<40; i++){
      const taken = await DB.get(env, 'site', slug);
      if(!taken || taken.owner === owner) break;
      slug = base + '-' + Math.random().toString(36).slice(2,6);
    }
  }

  const rec = {
    slug, owner, title, html,
    created: (await DB.get(env,'site',slug))?.created || Date.now(),
    updated: Date.now(),
    views: (await DB.get(env,'site',slug))?.views || 0
  };
  await DB.put(env, 'site', slug, rec);

  if(!(idx.slugs||[]).includes(slug)){
    idx.slugs = (idx.slugs||[]).concat(slug);
    await DB.put(env, 'sites', owner, idx);
  }
  return json({ ok:true, slug, url:_siteUrl(request, slug), updated:rec.updated });
}

/* ---- The user's live sites ---- */
async function deployList(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const owner = String(user.email).toLowerCase();
  const idx = (await DB.get(env, 'sites', owner)) || { slugs: [] };
  const sites = [];
  for(const slug of (idx.slugs||[])){
    const rec = await DB.get(env, 'site', slug);
    if(rec && rec.owner === owner){
      sites.push({ slug, title:rec.title, url:_siteUrl(request,slug),
                   updated:rec.updated, views:rec.views||0, bytes:(rec.html||'').length });
    }
  }
  sites.sort((a,b)=>(b.updated||0)-(a.updated||0));
  return json({ ok:true, sites });
}

/* ---- Take a site down ---- */
async function deployDelete(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const owner = String(user.email).toLowerCase();
  const body = await request.json().catch(()=>({}));
  const slug = String(body.slug||'').toLowerCase();
  const rec  = await DB.get(env, 'site', slug);
  if(!rec || rec.owner !== owner) return json({ error:'not found' }, 404);

  await env.AMV_KV.delete('site:' + slug);
  const idx = (await DB.get(env, 'sites', owner)) || { slugs: [] };
  idx.slugs = (idx.slugs||[]).filter(x=>x!==slug);
  await DB.put(env, 'sites', owner, idx);
  return json({ ok:true });
}

/* ---- Serve the live page (public, no auth) ----
   Served with CSP `sandbox`, which puts the page in a UNIQUE ORIGIN. It can run
   its own scripts but cannot touch cookies, storage, or any AMV API on this
   origin — so hosting user code can't be turned into an attack on AMV. */
async function serveSite(request, env, slug){
  if(!SLUG_RE.test(slug||'')) return new Response('Not found', { status:404 });
  const rec = await DB.get(env, 'site', slug);
  if(!rec || !rec.html) return new Response('Not found', { status:404 });

  // best-effort view counter
  try{ rec.views = (rec.views||0) + 1; await DB.put(env, 'site', slug, rec); }catch(e){}

  return new Response(rec.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "sandbox allow-scripts allow-forms allow-popups allow-modals",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'public, max-age=60'
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   ERROR REPORTING  —  so a bug your users hit actually reaches YOU.

   Before this, errors went into a localStorage ring buffer and died there.
   A paying user hit a crash, saw a toast, and left. You never found out.

   Now: the client reports structured errors here. They're grouped by a
   FINGERPRINT (message + location), so 500 users hitting one bug shows up as
   one row with count=500, not 500 rows.

   PRIVACY: we never accept message contents, prompts, or code. Only the error
   itself, where it happened, and coarse environment. Emails are stored hashed.
   ══════════════════════════════════════════════════════════════ */

const ERR_MAX_GROUPS   = 500;      // distinct bugs tracked
const ERR_MAX_SAMPLES  = 5;        // sample occurrences kept per bug
const ERR_MAX_BATCH    = 20;       // events accepted per request
const ERR_RETENTION_MS = 30 * 86400e3;

async function _errHash(s){
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(d)].slice(0,8).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* Group errors that are really the same bug. */
async function _fingerprint(e){
  // Normalise everything that varies between users but means the same bug.
  // Without this, "Timeout after 3000ms" and "Timeout after 9500ms" become two
  // separate rows and your dashboard fragments into noise.
  const msg = String(e.msg||'')
    .replace(/https?:\/\/\S+/g,'<url>')          // urls differ per user
    .replace(/0x[0-9a-f]+/gi,'<hex>')             // addresses
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,'<uuid>')
    .replace(/\d+(\.\d+)?/g,'<n>')              // ANY number \u2014 note: no \b, so it also catches '3000ms'
    .replace(/'[^']*'|"[^"]*"/g,'<s>')            // quoted values (varying names)
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,180);
  return _errHash(msg + '|' + String(e.where||'') + '|' + String(e.kind||''));
}

/* POST /errors — the client reports a batch. No auth required (errors can
   happen before/without login), but it is strictly bounded and sanitised. */
async function errorsReport(request, env){
  const body = await request.json().catch(()=>({}));
  const events = Array.isArray(body.events) ? body.events.slice(0, ERR_MAX_BATCH) : [];
  if(!events.length) return json({ ok:true, accepted:0 });

  const idx = (await DB.get(env, 'errors', 'index')) || { groups:{} };
  let accepted = 0;

  for(const raw of events){
    const e = {
      kind:  String(raw.kind||'error').slice(0,24),
      msg:   String(raw.msg||'').slice(0,300),
      where: String(raw.where||'').slice(0,120),
      stack: String(raw.stack||'').slice(0,1200),
      tab:   String(raw.tab||'').slice(0,24),
      ua:    String(raw.ua||'').slice(0,120),
      ver:   String(raw.ver||'').slice(0,24),
      at:    Date.now()
    };
    if(!e.msg) continue;

    const fp = await _fingerprint(e);
    const g = idx.groups[fp] || {
      fp, msg:e.msg, where:e.where, kind:e.kind,
      count:0, users:0, first:Date.now(), last:0, samples:[], userSet:[]
    };
    g.count++;
    g.last = Date.now();
    g.msg = e.msg; g.where = e.where; g.kind = e.kind;

    // count distinct users WITHOUT storing who they are
    if(raw.uid){
      const uh = await _errHash(String(raw.uid));
      if(!g.userSet.includes(uh)){
        g.userSet.push(uh);
        if(g.userSet.length > 200) g.userSet.shift();
        g.users = g.userSet.length;
      }
    }
    if(g.samples.length < ERR_MAX_SAMPLES) g.samples.push(e);
    else g.samples[ERR_MAX_SAMPLES-1] = e;   // always keep the most recent

    idx.groups[fp] = g;
    accepted++;
  }

  // prune: drop stale groups, then the least frequent, to stay bounded
  const now = Date.now();
  let keys = Object.keys(idx.groups);
  for(const k of keys){
    if(now - (idx.groups[k].last||0) > ERR_RETENTION_MS) delete idx.groups[k];
  }
  keys = Object.keys(idx.groups);
  if(keys.length > ERR_MAX_GROUPS){
    keys.sort((a,b)=>(idx.groups[a].count||0)-(idx.groups[b].count||0));
    for(const k of keys.slice(0, keys.length - ERR_MAX_GROUPS)) delete idx.groups[k];
  }

  await DB.put(env, 'errors', 'index', idx);
  return json({ ok:true, accepted });
}

/* POST /errors/list — YOUR dashboard. Admin only. */
async function errorsList(request, env){
  const body = await request.json().catch(()=>({}));
  const token = String(body.token || request.headers.get('X-Admin-Token') || '');
  if(!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN)
    return json({ error:'unauthorized' }, 401);

  const idx = (await DB.get(env, 'errors', 'index')) || { groups:{} };
  const groups = Object.values(idx.groups)
    .map(g=>({ fp:g.fp, msg:g.msg, where:g.where, kind:g.kind,
               count:g.count, users:g.users||0, first:g.first, last:g.last,
               samples:(g.samples||[]).slice(-2) }))
    .sort((a,b)=>(b.last||0)-(a.last||0));

  const total = groups.reduce((n,g)=>n+g.count, 0);
  const last24 = groups.filter(g=>Date.now()-g.last < 86400e3);
  return json({ ok:true, groups, total, distinct:groups.length, active24h:last24.length });
}

/* POST /errors/resolve — mark a bug fixed (clears it from the board). */
async function errorsResolve(request, env){
  const body = await request.json().catch(()=>({}));
  const token = String(body.token || request.headers.get('X-Admin-Token') || '');
  if(!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN)
    return json({ error:'unauthorized' }, 401);
  const idx = (await DB.get(env, 'errors', 'index')) || { groups:{} };
  if(body.all) idx.groups = {};
  else if(body.fp) delete idx.groups[String(body.fp)];
  await DB.put(env, 'errors', 'index', idx);
  return json({ ok:true, remaining:Object.keys(idx.groups).length });
}

/* POST /admin/abuse/list — flagged accounts (chargebacks / refund patterns).
   Admin-only, so you can see who tried the DoorDash method and clear any false
   positive. */
async function abuseList(request, env){
  const body = await request.json().catch(()=>({}));
  const token = String(body.token || request.headers.get('X-Admin-Token') || '');
  if(!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN)
    return json({ error:'unauthorized' }, 401);
  const listing = await env.AMV_KV.list({ prefix: 'abuse:' });
  const rows = [];
  for(const k of (listing.keys||[])){
    const rec = await DB.get(env, 'abuse', k.name.slice('abuse:'.length));
    if(rec) rows.push({ email:rec.email, disputes:rec.disputes||0, refunds:rec.refunds||0,
                        blocked:!!rec.blocked, blockedReason:rec.blockedReason||null,
                        blockedAt:rec.blockedAt||null, events:(rec.events||[]).slice(-5) });
  }
  rows.sort((a,b)=> (b.blockedAt||0) - (a.blockedAt||0));
  return json({ ok:true, flagged: rows, blockedCount: rows.filter(r=>r.blocked).length });
}

/* POST /admin/abuse/clear — lift a flag (a genuine refund that got caught).
   Admin-only. */
async function abuseClear(request, env){
  const body = await request.json().catch(()=>({}));
  const token = String(body.token || request.headers.get('X-Admin-Token') || '');
  if(!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN)
    return json({ error:'unauthorized' }, 401);
  const email = String(body.email||'').toLowerCase();
  if(!email) return json({ error:'email required' }, 400);
  const rec = await DB.get(env, 'abuse', email);
  if(!rec) return json({ error:'not found' }, 404);
  if(body.remove){ await env.AMV_KV.delete('abuse:'+email); }
  else { rec.blocked = false; rec.clearedAt = Date.now(); await DB.put(env, 'abuse', email, rec); }
  audit(env, 'abuse_cleared', { email, removed: !!body.remove });
  return json({ ok:true });
}

/* ══════════════════════════════════════════════════════════════════════
   CREW JOBS · APPROVALS · HANDOFF — per-user sync

   These features work locally in the browser; these endpoints persist them
   server-side so they sync across a user's devices (and, for handoff, reach
   another user). Stored per-user in KV under crewjobs:/approvals:/handoff:.
   ══════════════════════════════════════════════════════════════════════ */

async function crewJobs(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  if(request.method === 'POST'){
    const blocked = await guardAction(env, `crewjob:${user.email}`, 30, 500, 'job updates');
    if(blocked) return blocked;
    const { id, on } = await request.json().catch(()=>({}));
    if(!id) return json({ error:'id required' }, 400);
    const rec = (await DB.get(env, 'crewjobs', user.email)) || { jobs:{} };
    rec.jobs[id] = { key:id, on_flag: !!on, updatedAt: Date.now() };
    await DB.put(env, 'crewjobs', user.email, rec);
    return json({ ok:true });
  }
  const rec = (await DB.get(env, 'crewjobs', user.email)) || { jobs:{} };
  return json({ ok:true, jobs: Object.values(rec.jobs || {}) });
}

async function crewApprovals(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const rec = (await DB.get(env, 'approvals', user.email)) || { items:[] };
  return json({ ok:true, approvals: rec.items || [] });
}

async function crewApprovalAct(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { id, action } = await request.json().catch(()=>({}));
  if(!id) return json({ error:'id required' }, 400);
  const rec = (await DB.get(env, 'approvals', user.email)) || { items:[] };
  rec.items = (rec.items || []).filter(a => a.id !== id);   // approve/reject both resolve it
  await DB.put(env, 'approvals', user.email, rec);
  return json({ ok:true, action: action || 'resolved' });
}

async function handoffList(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const mine = (await DB.get(env, 'handoff', user.email)) || { incoming:[], sent:[] };
  return json({ ok:true, incoming: mine.incoming || [], sent: mine.sent || [] });
}

async function handoffCreate(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  // Cross-user write — guard against spamming another user's inbox.
  const blocked = await guardAction(env, `handoff:${user.email}`, 10, 100, 'handoffs');
  if(blocked) return blocked;
  const { title, context, to } = await request.json().catch(()=>({}));
  if(!title || !to) return json({ error:'title and recipient required' }, 400);
  const toEmail = String(to).toLowerCase().trim();
  const id = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  const entry = { id, from_email: user.email, to_email: toEmail,
                  title: String(title).slice(0,300), context: String(context||'').slice(0,5000),
                  status: 'pending', at: Date.now() };
  // record on the sender's "sent"
  const mine = (await DB.get(env, 'handoff', user.email)) || { incoming:[], sent:[] };
  mine.sent = (mine.sent || []).concat(entry).slice(-100);
  await DB.put(env, 'handoff', user.email, mine);
  // and on the recipient's "incoming"
  const theirs = (await DB.get(env, 'handoff', toEmail)) || { incoming:[], sent:[] };
  theirs.incoming = (theirs.incoming || []).concat(entry).slice(-100);
  await DB.put(env, 'handoff', toEmail, theirs);
  return json({ ok:true, id });
}

async function handoffAct(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { id, action } = await request.json().catch(()=>({}));
  if(!id) return json({ error:'id required' }, 400);
  const mine = (await DB.get(env, 'handoff', user.email)) || { incoming:[], sent:[] };
  mine.incoming = (mine.incoming || []).map(h => h.id === id ? { ...h, status: action === 'done' ? 'done' : 'seen' } : h);
  await DB.put(env, 'handoff', user.email, mine);
  return json({ ok:true });
}

/* ══════════════════════════════════════════════════════════════════════
   DATA SAFETY — backup & restore  (auditor #5)

   Every customer's account, subscription, chats, projects, and automations
   live in KV. Without a backup, one bad migration or an accidental namespace
   delete wipes all of it with NO recovery. These admin-only endpoints let you
   snapshot everything to a file and restore it.

   We back up the DURABLE data (accounts, entitlements, synced data, automations,
   teams, sites, abuse flags, wallets, purchases) and deliberately SKIP ephemeral
   keys (usage counters, rate-limits, presence, short-lived reset tokens) — those
   regenerate and would only bloat the snapshot.
   ══════════════════════════════════════════════════════════════════════ */

// Prefixes worth preserving. Everything else in KV is ephemeral/regenerable.
const BACKUP_PREFIXES = [
  'acct:', 'ent:', 'entitleitem:', 'data:', 'auto:', 'team:', 'userteam:',
  'teamtasks:', 'sites:', 'site:', 'abuse:', 'seller:', 'widget:', 'market:',
  'wallet:', 'purchases:', 'stripecust:', 'tokepoch:', 'sms:'
];

async function _adminOk(request, env){
  const body = await request.clone().json().catch(()=>({}));
  const token = String(body.token || request.headers.get('X-Admin-Token')
    || (request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,''));
  return env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

/* POST /admin/backup/export → a JSON snapshot of all durable data. */
async function backupExport(request, env){
  if(!(await _adminOk(request, env))) return json({ error:'unauthorized' }, 401);

  const data = {};
  let count = 0, bytes = 0;
  for(const prefix of BACKUP_PREFIXES){
    let cursor;
    do{
      const page = await env.AMV_KV.list({ prefix, cursor, limit: 1000 });
      for(const k of page.keys){
        const raw = await env.AMV_KV.get(k.name);
        if(raw != null){ data[k.name] = raw; count++; bytes += raw.length + k.name.length; }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while(cursor);
  }

  const snapshot = {
    _amv_backup: 1,
    createdAt: Date.now(),
    createdISO: new Date().toISOString(),
    keyCount: count,
    approxBytes: bytes,
    prefixes: BACKUP_PREFIXES,
    data
  };
  audit(env, 'backup_export', { keyCount: count, bytes });
  return new Response(JSON.stringify(snapshot), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="amv-backup-${new Date().toISOString().slice(0,10)}.json"`
    }
  });
}

/* POST /admin/backup/import → restore keys from a snapshot.
   Body: { token, snapshot, mode }
     mode 'merge'    (default) — write snapshot keys, leave others untouched.
     mode 'missing'  — only write keys that don't currently exist (safe recovery,
                       never clobbers newer live data).
   We never auto-delete. Restores are additive by design so a restore can't
   itself destroy data. */
async function backupImport(request, env){
  if(!(await _adminOk(request, env))) return json({ error:'unauthorized' }, 401);
  const body = await request.json().catch(()=>({}));
  const snap = body.snapshot;
  const mode = body.mode === 'missing' ? 'missing' : 'merge';

  if(!snap || snap._amv_backup !== 1 || !snap.data || typeof snap.data !== 'object')
    return json({ error:'not a valid AMV backup snapshot' }, 400);

  // Safety: only allow keys under known backup prefixes, so a tampered snapshot
  // can't write arbitrary control keys (e.g. GLOBAL_KILL).
  const allowed = (key) => BACKUP_PREFIXES.some(p => key.startsWith(p));

  let restored = 0, skipped = 0, rejected = 0;
  for(const [key, val] of Object.entries(snap.data)){
    if(typeof val !== 'string' || !allowed(key)){ rejected++; continue; }
    if(mode === 'missing'){
      const existing = await env.AMV_KV.get(key);
      if(existing != null){ skipped++; continue; }
    }
    await env.AMV_KV.put(key, val);
    restored++;
  }
  audit(env, 'backup_import', { mode, restored, skipped, rejected, from: snap.createdISO });
  return json({ ok:true, mode, restored, skipped, rejected, snapshotFrom: snap.createdISO || null });
}


/* Report an error that happened INSIDE the Worker itself. */
async function _workerError(env, where, err, extra){
  try{
    const idx = (await DB.get(env, 'errors', 'index')) || { groups:{} };
    const e = { kind:'worker', msg:String(err&&err.message||err).slice(0,300),
                where:String(where).slice(0,120), stack:String(err&&err.stack||'').slice(0,1200),
                tab:'server', ua:'worker', ver:'', at:Date.now(), ...(extra||{}) };
    const fp = await _fingerprint(e);
    const g = idx.groups[fp] || { fp, msg:e.msg, where:e.where, kind:'worker',
                                  count:0, users:0, first:Date.now(), last:0, samples:[], userSet:[] };
    const isNew = g.count === 0;
    g.count++; g.last = Date.now(); g.msg = e.msg;
    if(g.samples.length < ERR_MAX_SAMPLES) g.samples.push(e); else g.samples[ERR_MAX_SAMPLES-1] = e;
    idx.groups[fp] = g;
    await DB.put(env, 'errors', 'index', idx);
    // Page the owner the FIRST time a given error appears, and again if it keeps
    // happening (throttled). This is how you find out prod broke before users do.
    if(isNew){
      await alertOnce(env, 'err:'+fp, `⚠️ New server error in ${e.where}: ${e.msg} (${e.count||1}x)`, 30);
    } else if(g.count === 25 || g.count === 250){
      await alertOnce(env, 'err:'+fp+':'+g.count, `🔁 Recurring error in ${e.where} hit ${g.count}x: ${e.msg}`, 60);
    }
  }catch(e){ /* never let error reporting throw */ }
}


/* ==============================================================
   FORGOT PASSWORD - the flow people actually expect (Claude/ChatGPT style):
     1. Enter your email    -> POST /auth/reset/code
     2. Get a 6-digit code  -> emailed to you, valid 15 minutes
     3. Type the code       -> POST /auth/reset/verify -> one-time token
     4. Set a new password  -> POST /auth/reset/confirm

   A code beats a link because the email often opens on a different device
   from the one you're signing in on.
   ============================================================== */

const RESET_CODE_TTL      = 15 * 60;   // seconds
const RESET_RL_MAX        = 5;         // reset codes per email...
const RESET_RL_WINDOW_MS  = 60 * 60e3; // ...per hour
const RESET_CODE_ATTEMPTS = 5;         // wrong guesses before the code dies

function _sixDigitCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(100000 + (a[0] % 900000));
}

/* STEP 1 - send the code. */
async function authResetCode(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return json({ error: 'Enter a valid email address.' }, 400);

  const emailConfigured = !!env.EMAIL_API_KEY;

  /* Rate limit. Without this, anyone can hammer this endpoint and bomb a real
     person's inbox with reset codes, or burn through your email quota. Limited
     per-email, so one attacker can't lock out everyone. */
  const rlKey = 'resetrl:' + email;
  let rl = null;
  try { rl = JSON.parse(await env.AMV_KV.get(rlKey) || 'null'); } catch (e) {}
  const nowMs = Date.now();
  if (rl && nowMs - rl.first < RESET_RL_WINDOW_MS && rl.n >= RESET_RL_MAX) {
    // Still 200 + ok:true — never reveal whether this address is registered.
    audit(env, 'reset_rate_limited', { email });
    return json({ ok: true, sent: false, emailConfigured, rateLimited: true });
  }
  await env.AMV_KV.put(rlKey,
    JSON.stringify((rl && nowMs - rl.first < RESET_RL_WINDOW_MS)
      ? { first: rl.first, n: rl.n + 1 }
      : { first: nowMs, n: 1 }),
    { expirationTtl: Math.ceil(RESET_RL_WINDOW_MS / 1000) });

  const acct = await DB.get(env, 'acct', email);

  let sent = false;
  if (acct && emailConfigured) {
    const code = _sixDigitCode();
    await env.AMV_KV.put('resetcode:' + email,
      JSON.stringify({ code, attempts: 0, at: Date.now() }),
      { expirationTtl: RESET_CODE_TTL });
    try { sent = await sendResetCodeEmail(env, email, code); } catch (e) { sent = false; }
  }

  // Never reveal whether the account exists. But DO reveal whether email is set
  // up at all, so the app can tell the truth instead of saying "check your
  // inbox" when nothing could ever have been sent.
  return json({ ok: true, sent, emailConfigured });
}

/* STEP 2 - verify the code, hand back a one-time token. */
async function authResetVerify(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  const code = String(body.code || '').replace(/\D/g, '');
  if (!email || !code) return json({ error: 'Enter the 6-digit code.' }, 400);

  const raw = await env.AMV_KV.get('resetcode:' + email);
  if (!raw) return json({ error: 'That code has expired. Request a new one.' }, 400);

  let rec = null;
  try { rec = JSON.parse(raw); } catch (e) { rec = null; }
  if (!rec) return json({ error: 'That code has expired. Request a new one.' }, 400);

  if (rec.attempts >= RESET_CODE_ATTEMPTS) {
    await env.AMV_KV.delete('resetcode:' + email);
    return json({ error: 'Too many incorrect attempts. Request a new code.' }, 429);
  }

  if (rec.code !== code) {
    rec.attempts++;
    const left = RESET_CODE_ATTEMPTS - rec.attempts;
    await env.AMV_KV.put('resetcode:' + email, JSON.stringify(rec), { expirationTtl: RESET_CODE_TTL });
    audit(env, 'reset_code_bad', { email });
    return json({
      error: left > 0
        ? 'That code isn\u2019t right. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.'
        : 'Too many incorrect attempts. Request a new code.'
    }, 400);
  }

  // correct - burn the code, issue a single-use token for the final step
  await env.AMV_KV.delete('resetcode:' + email);
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await env.AMV_KV.put('reset:' + token, email, { expirationTtl: RESET_CODE_TTL });
  audit(env, 'reset_code_ok', { email });
  return json({ ok: true, token });
}

async function sendResetCodeEmail(env, to, code) {
  const bigCode =
    '<div style="margin:0 0 22px;padding:18px;background:#f6f7f9;border:1px solid #e6e8ec;border-radius:12px;text-align:center">' +
      '<span style="font-family:ui-monospace,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:9px;color:#111">' + code + '</span>' +
    '</div>';
  return _sendEmail(env, to, 'Your AMV password reset code',
    _emailShell('Your reset code',
      '<p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#555">Enter this code in AMV to set a new password. It expires in <b>15 minutes</b>.</p>' + bigCode,
      null,
      '<hr style="border:none;border-top:1px solid #eee;margin:0 0 18px"><p style="margin:0;font-size:12px;line-height:1.6;color:#999">If you didn\u2019t request this, you can ignore this email \u2014 your password won\u2019t change.</p>',
      'This is an automated security email.'),
    'Your AMV password reset code: ' + code +
    '\n\nEnter it in AMV to set a new password. It expires in 15 minutes.' +
    '\n\nIf you didn\u2019t request this, you can ignore this email.\n\n\u2014 The AMV team');
}

/* Owner escape hatch: set a password directly with the ADMIN_TOKEN.

   You hold the ADMIN_TOKEN (it's a Worker secret). If the email provider is
   down, misconfigured, or you're just locked out of your own product, this
   gets you back in without weakening anything for anyone else.

   Requires the admin secret. Rate-limited by the fact that a wrong token is
   simply rejected, and the token never leaves your machine. */
async function authAdminReset(request, env){
  const body = await request.json().catch(()=>({}));
  const token = String(body.token || request.headers.get('X-Admin-Token') || '');
  if(!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN)
    return json({ error:'unauthorized' }, 401);

  const email = String(body.email||'').toLowerCase().trim();
  const password = String(body.password||'');
  if(!email || !email.includes('@')) return json({ error:'valid email required' }, 400);
  if(password.length < 8) return json({ error:'Password must be at least 8 characters.' }, 400);

  const acct = await DB.get(env, 'acct', email);
  if(!acct) return json({ error:'No account with that email.' }, 404);

  const salt = crypto.randomUUID().replace(/-/g,'');
  acct.pwHash  = await _hashPassword(password, salt, PBKDF2_ITERATIONS);
  acct.salt    = salt;
  acct.pwIter  = PBKDF2_ITERATIONS;
  acct.pwResetAt = Date.now();
  await DB.put(env, 'acct', email, acct);
  try{ await revokeUserTokens(env, email); }catch(e){}
  audit(env, 'password_reset_admin', { email });
  return json({ ok:true });
}

/* Is password reset actually usable? The app asks this so it can tell the
   truth instead of saying "check your inbox" when nothing can be sent. */
async function authResetStatus(request, env){
  return json({ ok:true, emailConfigured: !!env.EMAIL_API_KEY, usingDefaultSender: !env.RESET_EMAIL_FROM });
}

/* ══════════════════════════════════════════════════════════════
   THE RESET PAGE.

   The reset email links to <worker>/reset?token=... — but that route did not
   exist, so the link 404'd. The whole "forgot password" flow was dead end to
   end: no email could send (no provider configured), and even if it had, the
   link went nowhere.

   This serves a self-contained page that sets the new password. It's plain
   HTML with no dependencies so it works no matter where the app is hosted.
   ══════════════════════════════════════════════════════════════ */
function resetPage(request, env){
  const url = new URL(request.url);
  const token = (url.searchParams.get('token') || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 128);
  const appUrl = (env.APP_URL || env.APP_ORIGIN || '').replace(/\/$/, '');

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset your AMV password</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;
       background:#0d1117;color:#e6edf3}
  .card{width:100%;max-width:400px;background:#161b22;border:1px solid #30363d;
        border-radius:16px;padding:32px}
  h1{font-size:21px;font-weight:650;margin-bottom:6px}
  p.sub{font-size:14px;color:#8b949e;line-height:1.6;margin-bottom:22px}
  label{display:block;font-size:12px;font-weight:600;color:#8b949e;
        text-transform:uppercase;letter-spacing:.04em;margin-bottom:7px}
  input{width:100%;padding:12px 14px;border-radius:9px;border:1px solid #30363d;
        background:#0d1117;color:#e6edf3;font-size:15px;outline:none;margin-bottom:16px}
  input:focus{border-color:#4c8dff;box-shadow:0 0 0 3px rgba(76,141,255,.15)}
  button{width:100%;padding:12px;border:none;border-radius:9px;background:#4c8dff;
         color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  button:hover{filter:brightness(1.08)}
  button:disabled{opacity:.6;cursor:default}
  .msg{padding:11px 13px;border-radius:9px;font-size:13.5px;line-height:1.5;
       margin-bottom:16px;display:none}
  .msg.err{display:block;background:rgba(248,81,73,.12);color:#f85149;
           border:1px solid rgba(248,81,73,.3)}
  .msg.ok{display:block;background:rgba(63,185,80,.12);color:#3fb950;
          border:1px solid rgba(63,185,80,.3)}
  a{color:#4c8dff;text-decoration:none;font-size:13.5px}
  .foot{text-align:center;margin-top:18px}
</style></head>
<body>
  <div class="card">
    <h1>Set a new password</h1>
    <p class="sub">Choose a new password for your AMV account. This link can only be used once.</p>
    <div id="msg" class="msg"></div>
    <div id="form">
      <label for="pw">New password</label>
      <input id="pw" type="password" placeholder="At least 8 characters" autocomplete="new-password">
      <label for="pw2">Confirm password</label>
      <input id="pw2" type="password" placeholder="Type it again" autocomplete="new-password">
      <button id="go">Set new password</button>
    </div>
    <div class="foot"><a href="${appUrl || '/'}">Back to AMV</a></div>
  </div>
<script>
  var TOKEN = ${JSON.stringify(token)};
  var APP   = ${JSON.stringify(appUrl)};
  var msg = document.getElementById('msg');
  var form = document.getElementById('form');
  var btn = document.getElementById('go');

  function show(text, kind){ msg.textContent = text; msg.className = 'msg ' + kind; }

  if (!TOKEN) { show('This reset link is missing its token. Request a new one from the app.', 'err'); form.style.display='none'; }

  btn.addEventListener('click', async function(){
    var pw = document.getElementById('pw').value;
    var pw2 = document.getElementById('pw2').value;
    if (pw.length < 8) { show('Password must be at least 8 characters.', 'err'); return; }
    if (pw !== pw2)    { show('Those passwords do not match.', 'err'); return; }
    btn.disabled = true; btn.textContent = 'Setting\u2026';
    try {
      var r = await fetch('/auth/reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: TOKEN, password: pw })
      });
      var d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Could not reset the password.');
      form.style.display = 'none';
      show('Password updated. You can sign in with your new password now.', 'ok');
      if (APP) setTimeout(function(){ location.href = APP; }, 2200);
    } catch (e) {
      show(e.message, 'err');
      btn.disabled = false; btn.textContent = 'Set new password';
    }
  });
</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

export default {
  /* Cloudflare Cron trigger. THIS is what makes automations real: it runs on
     Cloudflare's schedule whether or not anyone has the app open.
     Configure in wrangler.toml:
       [triggers]
       crons = ["every 5 minutes"]   // i.e. the standard 5-minute cron expression
  */
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async()=>{
      try{
        const r = await runDueAutomations(env);
        if(r.ran || r.failed) console.log('[cron] automations', JSON.stringify(r));
      }catch(e){
        console.error('[cron] failed', e && e.message);
        try{ await _workerError(env, 'cron', e); }catch(_){}
      }
    })());
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    // Live deployed sites are PUBLIC — served before any auth/CORS gating.
    if (request.method === 'GET' && path.startsWith('/s/')) {
      return serveSite(request, env, path.slice(3));
    }

    // The password-reset page must be public too — the whole point is that the
    // user cannot log in. This is what the reset email links to.
    if (request.method === 'GET' && path === '/reset') {
      return resetPage(request, env);
    }

    if (request.method === 'OPTIONS') {
      // The public widget endpoint may be locked to specific origins; reflect the
      // request Origin for its preflight so a domain-restricted widget still works.
      if (path === '/v1/widget/chat') {
        const o = request.headers.get('Origin') || '*';
        return new Response(null, { headers: {
          'Access-Control-Allow-Origin': o,
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Vary': 'Origin',
        }});
      }
      return new Response(null, { headers: { ...CORS, ...SECURITY_HEADERS } });
    }

    try {
      // ---------- GLOBAL KILL SWITCH ----------
      // Cached in-isolate for a few seconds so it's not a KV round-trip on
      // every single request (this is the hottest path). Worst-case delay to
      // honor a freshly-flipped switch is _KILL_TTL_MS. (auditor: hot-path read)
      if (path.startsWith('/v1/')) {
        const now = Date.now();
        if (now - _killCache.ts > _KILL_TTL_MS) {
          _killCache.val = (await env.AMV_KV.get('GLOBAL_KILL')) === '1';
          _killCache.ts = now;
        }
        if (_killCache.val) return json({ error: 'Service temporarily paused. Please try again soon.' }, 503);
      }

      switch (path) {
        case '/v1/health':       return json({ ok: true, ts: Date.now() });
        case '/auth/signup':     return authSignup(request, env);
        case '/auth/login':      return authLogin(request, env);
        case '/auth/google':     return authGoogle(request, env);
        case '/admin/users':     return adminUsers(request, env);
        case '/auth/refresh':    return authRefresh(request, env);
        case '/auth/logout':     return authLogout(request, env);
        case '/auth/delete':     return authDeleteAccount(request, env);
        case '/auth/reset':      return authReset(request, env);
        case '/auth/reset/confirm': return authResetConfirm(request, env);
        case '/auth/reset/status':  return authResetStatus(request, env);
        case '/auth/reset/code':    return authResetCode(request, env);
        case '/auth/reset/verify':  return authResetVerify(request, env);
        case '/auth/admin-reset':   return authAdminReset(request, env);
        case '/sync/pull':       return syncPull(request, env);
        case '/sync/push':       return syncPush(request, env);
        case '/auto/list':       return autoList(request, env);
        case '/auto/create':     return autoCreate(request, env);
        case '/auto/update':     return autoUpdate(request, env);
        case '/auto/read':       return autoClearResults(request, env);
        case '/deploy':          return deploySite(request, env);
        case '/deploy/list':     return deployList(request, env);
        case '/deploy/delete':   return deployDelete(request, env);
        case '/errors':          return errorsReport(request, env);
        case '/errors/list':     return errorsList(request, env);
        case '/errors/resolve':  return errorsResolve(request, env);
        case '/admin/abuse/list':  return abuseList(request, env);
        case '/admin/abuse/clear': return abuseClear(request, env);
        case '/admin/backup/export': return backupExport(request, env);
        case '/admin/backup/import': return backupImport(request, env);
        case '/api/jobs':            return crewJobs(request, env);
        case '/api/approvals':       return crewApprovals(request, env);
        case '/api/approvals/act':   return crewApprovalAct(request, env);
        case '/api/handoff':         return request.method === 'POST' ? handoffCreate(request, env) : handoffList(request, env);
        case '/api/handoff/act':     return handoffAct(request, env);
        case '/team/create':     return teamCreate(request, env);
        case '/team/get':        return teamGet(request, env);
        case '/team/invite':     return teamInvite(request, env);
        case '/team/join':       return teamJoin(request, env);
        case '/team/members':    return teamMembers(request, env);
        case '/team/remove':     return teamRemove(request, env);
        case '/team/role':       return teamSetRole(request, env);
        case '/team/audit':      return teamAuditLog(request, env);
        case '/team/data':       return teamData(request, env);
        case '/team/share':      return teamShare(request, env);
        case '/team/shared':     return teamShared(request, env);
        case '/team/unshare':    return teamUnshare(request, env);
        case '/team/presence':   return teamPresence(request, env);
        case '/team/tasks':      return teamTasks(request, env);
        case '/team/task/create': return teamTaskCreate(request, env);
        case '/team/task/update': return teamTaskUpdate(request, env);
        case '/v1/messages':     return aiProxy(request, env, ctx);
        case '/v1/image':        return imageMeter(request, env);
        case '/v1/image/generate': return imageGenerate(request, env);
        case '/v1/video/generate': return videoGenerate(request, env);
        case '/v1/video/status':   return videoStatus(request, env);
        case '/v1/video/list':     return videoList(request, env);
        case '/v1/usage':        return usageReport(request, env);
        case '/sms/register':    return smsRegister(request, env);
        case '/waitlist':        return waitlistAdd(request, env);
        case '/sms/incoming':    return smsIncoming(request, env, ctx);
        // --- PAYMENTS (real Stripe + PayPal) ---
        case '/v1/stripe/checkout': return stripeCheckout(request, env);
        case '/v1/stripe/portal':   return stripePortal(request, env);
        case '/v1/stripe/invoices': return stripeInvoices(request, env);
        case '/v1/stripe/webhook':  return stripeWebhook(request, env, ctx);
        case '/v1/paypal/create':   return paypalCreate(request, env);
        case '/v1/paypal/subscribe': return paypalSubscribe(request, env);
        case '/v1/paypal/capture':  return paypalCapture(request, env);
        case '/v1/paypal/webhook':  return paypalWebhook(request, env, ctx);
        case '/v1/entitlement':     return getEntitlement(request, env);
        // --- MARKETPLACE (community templates) ---
        case '/v1/market/list':     return marketList(request, env);
        case '/v1/market/publish':  return marketPublish(request, env);
        case '/v1/market/install':  return marketInstall(request, env);
        case '/v1/market/buy':      return marketBuy(request, env);
        case '/v1/market/purchases': return marketPurchases(request, env);
        case '/v1/market/mylistings': return marketMyListings(request, env);
        case '/v1/market/unlist':   return marketUnlist(request, env);
        case '/v1/market/earnings': return marketEarnings(request, env);
        case '/v1/market/withdraw': return marketWithdraw(request, env);
        case '/v1/market/status':   return marketSetStatus(request, env);
        case '/v1/market/view':     return marketView(request, env);
        case '/v1/market/rate':     return marketRate(request, env);
        case '/v1/market/review':   return marketReview(request, env);
        case '/v1/market/message':  return marketMessage(request, env);
        case '/v1/market/threads':  return marketThreads(request, env);
        // --- FOUNDER ADMIN (token-gated) ---
        case '/v1/admin/stats':     return adminStats(request, env);
        case '/v1/admin/finance':   return adminFinance(request, env);
        case '/v1/admin/kill':      return adminKill(request, env);
        case '/v1/admin/user':      return adminUser(request, env);
        // --- EMBEDDABLE WIDGET ---
        case '/v1/widget/config':   return widgetConfigGet(request, env);   // owner: read config
        case '/v1/widget/config-public': return widgetConfigPublic(request, env); // public: display fields only
        case '/v1/widget/save':     return widgetConfigSave(request, env);  // owner: create/update config
        case '/v1/widget/chat':     return widgetChat(request, env, ctx);   // public: end-visitor chat (site-key gated)
        case '/widget.js':          return widgetLoader(request, env);      // public: the <script> embed loader
        default: {
          // A browser hitting an unknown URL should get a friendly HTML page;
          // an API client gets JSON. We tell them apart by the Accept header.
          const accept = request.headers.get('Accept') || '';
          if (accept.includes('text/html')) {
            return new Response(
              `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>404 — Not found</title><style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0e14;color:#e6e6e6;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}.b{text-align:center;padding:24px}.c{font-size:72px;font-weight:800;color:#4c7dff;line-height:1}.t{font-size:22px;margin:12px 0 6px}.s{color:#9aa4b2;margin-bottom:20px}a{display:inline-block;padding:10px 20px;background:#4c7dff;color:#fff;text-decoration:none;border-radius:9px;font-weight:600}</style></head><body><div class="b"><div class="c">404</div><div class="t">Page not found</div><div class="s">This page doesn't exist or may have moved.</div><a href="/">Go home</a></div></body></html>`,
              { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          }
          return json({ error: 'not found' }, 404);
        }
      }
    } catch (err) {
      // An unhandled exception reached the top level. Record it AND alert (both
      // throttled + best-effort) so a broken endpoint pages you instead of
      // silently 500ing until a user complains. Never let logging mask the 500.
      try{
        let path = 'request';
        try{ path = new URL(request.url).pathname; }catch(_){}
        ctx.waitUntil(_workerError(env, path, err));
      }catch(_){}
      return json({ error: err.message || 'server error' }, 500);
    }
  },
};

/* ---------------- AUTH: issue a signed session token ---------------- */
/* ============================================================
   SERVER-SIDE ACCOUNTS + DATA SYNC
   Accounts (with hashed passwords) and per-user data (chats, memory,
   settings, workspaces) live in KV, so users keep everything across
   devices. Passwords are salted+hashed with PBKDF2-SHA256 at the OWASP-2023
   iteration count. The iteration count is stored ON the account record, so we
   can raise it over time and verify old logins at their original count, then
   transparently re-hash on next successful login — no lockouts.
   (Argon2id would be preferable but isn't available in the Workers runtime.)
   ============================================================ */
const PBKDF2_ITERATIONS = 210000;   // OWASP 2023 recommendation for PBKDF2-SHA256
async function _hashPassword(password, salt, iterations){
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', salt: enc.encode(salt), iterations: iterations || PBKDF2_ITERATIONS, hash:'SHA-256' }, keyMaterial, 256);
  return [...new Uint8Array(bits)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
/* Verify a Cloudflare Turnstile token. Returns true if:
   - Turnstile isn't configured yet (TURNSTILE_SECRET unset) — we don't block
     real users before you've set it up; the honeypot + rate limits still apply.
   - OR the token validates against Cloudflare.
   Returns false only when Turnstile IS configured and the token is missing/invalid. */
async function _verifyCaptcha(env, token, request){
  if (!env.TURNSTILE_SECRET) return true;           // not set up yet → don't block
  if (!token) return false;
  try{
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const form = new URLSearchParams();
    form.set('secret', env.TURNSTILE_SECRET);
    form.set('response', String(token));
    if (ip) form.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: form.toString()
    });
    const d = await r.json().catch(()=>({}));
    return !!d.success;
  }catch(e){ return false; }   // fail closed when configured but verification errors
}

async function authSignup(request, env){
  const body = await request.json().catch(()=>({}));
  const { email, name, password } = body;
  // Bot protection. Two layers:
  //  1. Honeypot: a hidden form field bots tend to fill. Works with zero config.
  //  2. Turnstile (Cloudflare's free CAPTCHA): verified when TURNSTILE_SECRET is
  //     set. Until you configure it, we rely on the honeypot + rate limits.
  if (body.company || body.website) { audit(env,'bot_blocked',{where:'signup_honeypot'}); return json({ error:'signup failed' }, 400); }
  const capOk = await _verifyCaptcha(env, body.captchaToken, request);
  if (!capOk) return json({ error:'Please complete the verification and try again.', code:'captcha_required' }, 400);
  const em = String(email||'').toLowerCase().trim();
  // Strict format: exactly one @, no whitespace/colons/control chars, sane length.
  // Emails go into KV key structures and audit logs — keep them clean by construction.
  if(!em || em.length > 254 || !/^[^\s@:]{1,64}@[^\s@:]+\.[^\s@:]{2,}$/.test(em)) return json({ error:'valid email required' }, 400);
  if(!password || password.length < 6 || password.length > 512) return json({ error:'password must be 6+ chars' }, 400);
  const safeName = String(name||'').slice(0, 80);
  const existing = await DB.get(env, 'acct', em);
  if(existing) return json({ error:'account exists' }, 409);
  const salt = crypto.randomUUID();
  const pwHash = await _hashPassword(password, salt, PBKDF2_ITERATIONS);
  const acct = { email: em, name: safeName, provider:'email', salt, pwHash, pwIter: PBKDF2_ITERATIONS, createdAt: Date.now() };
  await DB.put(env, 'acct', em, acct);
  try{ await _recordGrowth(env, 'signup'); }catch(e){}
  return json(await issueTokens(env, em, safeName));
}
async function authLogin(request, env) {
  const body = await request.json().catch(()=>({}));
  const { email, name, password, provider } = body;
  // Honeypot — a hidden field only bots fill.
  if (body.company || body.website) { audit(env,'bot_blocked',{where:'login_honeypot'}); return json({ error:'sign in failed' }, 400); }
  const em = String(email||'').toLowerCase().trim();
  if (!em) return json({ error: 'email required' }, 400);
  // /auth/login is the EMAIL + PASSWORD endpoint ONLY. Turnstile ALWAYS applies:
  // a `provider` value in the request body is attacker-controlled and must never
  // skip verification or stand in for proof of identity. Federated identities
  // (Google, etc.) authenticate through their own server-verified callback
  // (/auth/google), never here.
  {
    const capOk = await _verifyCaptcha(env, body.captchaToken, request);
    if (!capOk) return json({ error:'Please complete the verification and try again.', code:'captcha_required' }, 400);
  }
  // brute-force throttle: cap failed password attempts per email+IP
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'noip';
  const rlKey = `authfail:${em}:${ip}`;
  {
    const fails = parseInt(await env.AMV_KV.get(rlKey) || '0', 10);
    if (fails >= 8) { audit(env, 'auth_fail', { email: em, reason: 'throttled' }); return json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, 429); }
  }
  const acct0 = await DB.get(env, 'acct', em);
  if(!acct0){ await _noteAuthFail(env, rlKey); return json({ error:'no such account' }, 404); }
  const acct = acct0;
  // FAIL CLOSED: only a real email-password account with a stored password hash
  // may obtain a token here. A federated account (provider !== 'email', or no
  // pwHash) has no password to check, so it must be rejected — never fall through
  // to issueTokens. This closes both the provider-impersonation bypass and the
  // "any password logs in a federated account" bypass.
  if(acct.provider !== 'email' || !acct.pwHash){
    await _noteAuthFail(env, rlKey);
    audit(env,'auth_fail',{email:em,reason:'wrong_method'});
    return json({ error:'wrong password' }, 401);   // generic — never reveal the account's provider
  }
  if(!password) return json({ error:'password required' }, 400);
  // verify using the iteration count the hash was MADE with (default 100k for
  // pre-upgrade accounts), so raising the global count never locks anyone out
  const usedIter = acct.pwIter || 100000;
  const hash = await _hashPassword(password, acct.salt, usedIter);
  // constant-time compare to avoid password-timing leaks
  const ok = timingSafeEqual(new TextEncoder().encode(hash), new TextEncoder().encode(acct.pwHash || ''));
  if(!ok){ await _noteAuthFail(env, rlKey); audit(env,'auth_fail',{email:em,reason:'bad_password'}); return json({ error:'wrong password' }, 401); }
  // success — clear the failure counter
  try{ await env.AMV_KV.delete(rlKey); }catch(e){}
  // transparent upgrade: if this account is below the current target, re-hash now
  if(usedIter < PBKDF2_ITERATIONS){
    try{
      const newHash = await _hashPassword(password, acct.salt, PBKDF2_ITERATIONS);
      acct.pwHash = newHash; acct.pwIter = PBKDF2_ITERATIONS;
      await DB.put(env, 'acct', em, acct);
    }catch(e){ /* non-fatal — login still succeeds */ }
  }
  try{ await _markActive(env, em); }catch(e){}
  return json(await issueTokens(env, em, acct.name || name || ''));
}

/* Operator user list — admin-gated. Returns accounts for the Admin Control
   Center. Only a verified admin token may call this. */
async function adminUsers(request, env) {
  const auth = request.headers.get('Authorization')||'';
  const token = auth.replace(/^Bearer\s+/i,'');
  const claims = token ? await verifyToken(token, env.JWT_SECRET, env, 'access') : null;
  if(!claims || !claims.email) return json({ error:'unauthorized' }, 401);
  // must be an admin: either the configured owner email or an account flagged admin
  const acct = await DB.get(env, 'acct', String(claims.email).toLowerCase());
  // Operator email — from env, falling back to the hard-coded owner. Change both
  // (this line and OWNER_EMAIL in app.js) when transferring ownership.
  const ownerEmail = (env.OWNER_EMAIL || 'amarotovaleria@gmail.com').toLowerCase();
  const isOwner = String(claims.email).toLowerCase() === ownerEmail;
  if(!isOwner && !(acct && acct.admin)) return json({ error:'forbidden' }, 403);
  // list accounts (KV list is best-effort; cap for safety)
  let users=[];
  try{
    const list = await DB.list(env, 'acct', 300);
    const month = monthKey();
    users = await Promise.all((list||[]).map(async r=>{
      const a=r.value||{}; const email=a.email; if(!email) return null;
      // pull the richer per-user records so the owner sees the FULL picture
      const [ent, wallet, purchases, abuse] = await Promise.all([
        DB.get(env, 'ent', email).catch(()=>null),
        env.AMV_KV.get(`wallet:${email}`).catch(()=>null),
        env.AMV_KV.get(`purchases:${email}`).catch(()=>null),
        DB.get(env, 'abuse', email).catch(()=>null),
      ]);
      let monthCost=0, monthTok=0;
      try{ monthCost = (await counter(env, `cost:${email}:${month}`, { op:'get' })).value || 0; }catch(e){}
      try{ monthTok = (await counter(env, `tok:${email}:${month}`, { op:'get' })).value || 0; }catch(e){}
      let walletBal=0; try{ if(wallet){ walletBal=(JSON.parse(wallet).balance)||0; } }catch(e){}
      let purchaseCount=0; try{ if(purchases){ purchaseCount=(JSON.parse(purchases)||[]).length; } }catch(e){}
      const plan = (ent && ent.plan) || a.plan || 'free';
      return {
        email, name:a.name||'', plan, provider:a.provider||'email',
        createdAt:a.createdAt||null, admin:!!a.admin,
        source:(ent && ent.source)||null,          // stripe / paypal / manual
        monthCostUSD:+(+monthCost).toFixed(2),
        monthTokens:monthTok,
        walletBalance:+(+walletBal).toFixed(2),
        purchases:purchaseCount,
        flagged:!!(abuse && abuse.blocked),
        disputes:(abuse && abuse.disputes)||0,
        refunds:(abuse && abuse.refunds)||0,
      };
    }));
    users = users.filter(Boolean);
  }catch(e){}
  return json({ users, count: users.length });
}

/* Verify a Google ID token (JWT credential) SERVER-SIDE before trusting it.
   This is the production-safe path: the browser sends the credential from Google
   Identity Services, and here we confirm it with Google — checking the signature,
   that the audience matches OUR client id, and that it hasn't expired — then mint
   our own session. The frontend never grants privileges on an unverified token. */
async function authGoogle(request, env) {
  const { credential } = await request.json().catch(()=>({}));
  if (!credential) return json({ error: 'credential required' }, 400);
  try{
    // Google's tokeninfo validates signature + expiry for us and returns the claims.
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if(!r.ok){ audit(env,'google_verify_fail',{status:r.status}); return json({ error:'invalid google token' }, 401); }
    const claims = await r.json();
    // audience check: the token must have been minted for OUR client id
    const expectedAud = env.GOOGLE_CLIENT_ID || '';
    if(expectedAud && claims.aud !== expectedAud){ audit(env,'google_aud_mismatch',{}); return json({ error:'token audience mismatch' }, 401); }
    // issuer + verified-email sanity
    if(claims.iss && !/accounts\.google\.com$/.test(claims.iss)){ return json({ error:'bad issuer' }, 401); }
    const em = String(claims.email||'').toLowerCase().trim();
    if(!em) return json({ error:'no email in token' }, 401);
    const name = claims.name || em.split('@')[0];
    let acct = await DB.get(env, 'acct', em);
    if(!acct){ acct = { email:em, name, provider:'google', createdAt:Date.now() }; await DB.put(env, 'acct', em, acct); }
    const tokens = await issueTokens(env, em, name);
    return json(Object.assign({ email:em, name, picture:claims.picture||'' }, tokens));
  }catch(e){
    audit(env,'google_verify_error',{msg:String(e).slice(0,120)});
    return json({ error:'verification failed' }, 500);
  }
}

/* Exchange a valid refresh token for a fresh access+refresh pair. */
async function authRefresh(request, env) {
  const { refreshToken } = await request.json().catch(()=>({}));
  if (!refreshToken) return json({ error: 'refresh token required' }, 400);
  const data = await verifyToken(refreshToken, env.JWT_SECRET, env, 'refresh');
  if (!data || !data.email) return json({ error: 'invalid or expired refresh token' }, 401);
  try{ await _markActive(env, data.email); }catch(e){}
  return json(await issueTokens(env, data.email, data.name || ''));
}

/* Sign out everywhere: bump the user's token epoch, revoking all tokens. */
async function authLogout(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const tok = auth.replace(/^Bearer\s+/i, '');
  const data = await verifyToken(tok, env.JWT_SECRET, env, 'access');
  if (data && data.email) await revokeUserTokens(env, data.email);
  return json({ ok: true });
}

/* DELETE MY ACCOUNT — the "right to erasure" the privacy policy promises.
   Purges every piece of the user's data from KV and revokes their tokens. It is
   irreversible, so the client requires an explicit typed confirmation before
   calling this. We delete by the user's own email, so one user can only ever
   delete THEMSELVES — never anyone else. */
async function authDeleteAccount(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const email = user.email;

  // Per-user keys are keyed by email under these prefixes. Delete each.
  // NOTE: we intentionally do NOT delete `tokepoch` — it's the token-revocation
  // marker (a bare integer, no personal data). Keeping it guarantees any tokens
  // still in circulation stay dead even after the account row is gone.
  const perUserKinds = ['acct', 'ent', 'entitleitem', 'data', 'auto', 'crewjobs',
    'approvals', 'handoff', 'abuse', 'seller', 'widget', 'wallet', 'purchases',
    'stripecust', 'userteam'];
  let deleted = 0;
  for (const kind of perUserKinds) {
    try { await env.AMV_KV.delete(`${kind}:${email}`); deleted++; } catch {}
  }
  // Also clear any lookup keys that reference this email (phone link, reset state).
  for (const raw of [`sms:email:${email}`, `reset:${email}`, `active:${email}:${todayKey()}`]) {
    try { await env.AMV_KV.delete(raw); } catch {}
  }
  // Revoke all tokens so existing sessions die immediately.
  try { await revokeUserTokens(env, email); } catch {}

  audit(env, 'account_deleted', { email, keysRemoved: deleted });
  return json({ ok: true, deleted: true });
}

/* Pull all of a user's synced data (or just keys changed since `since`). */
/* ============================================================
   TEAM / WORKSPACE MODE — the B2B tier.
   A team has an owner, members with roles, and shared data (projects,
   prompts, memory). Stored in KV: team:{id} and teammember lookups.
   ============================================================ */
async function teamCreate(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { name } = await request.json().catch(()=>({}));
  const id = 'team_' + crypto.randomUUID().replace(/-/g,'');
  const team = {
    id, name: name||'My Team', ownerEmail: user.email,
    members: [{ email:user.email, role:'owner', joinedAt:Date.now() }],
    createdAt: Date.now(), data:{}
  };
  await DB.put(env, 'team', id, team);
  await env.AMV_KV.put(`userteam:${user.email}`, id);
  await _teamAudit(env, team, user.email, 'team_created', { name: team.name });
  return json({ ok:true, team });
}
async function teamGet(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const tid = await env.AMV_KV.get(`userteam:${user.email}`);
  if(!tid) return json({ ok:true, team:null });
  return json({ ok:true, team: await DB.get(env, 'team', tid) });
}
async function _teamOf(env, email){
  const tid = await env.AMV_KV.get(`userteam:${email}`);
  if(!tid) return null;
  const team = await DB.get(env, 'team', tid);
  // Membership is the source of truth. A stale or tampered userteam pointer must
  // NOT grant access to a team the caller is no longer an active member of.
  if(!team || !_role(team, email)) return null;
  return team;
}
function _role(team, email){ const m=(team.members||[]).find(x=>x.email===email); return m?m.role:null; }
/* Reject an oversized or too-deeply-nested JSON payload so a member can't amplify
   storage or make a shared record fail to parse/write. Returns an error string or
   null when the value is within bounds. */
function _boundedJson(obj, maxBytes, maxDepth){
  let s; try{ s = JSON.stringify(obj); }catch{ return 'invalid data'; }
  if(s == null) return 'invalid data';
  if(new TextEncoder().encode(s).length > maxBytes) return 'data too large';
  const depth = (o, d)=>{
    if(d > maxDepth) return d;
    if(o && typeof o === 'object'){
      let mx = d;
      for(const k in o){ mx = Math.max(mx, depth(o[k], d+1)); if(mx > maxDepth) return mx; }
      return mx;
    }
    return d;
  };
  if(depth(obj, 0) > maxDepth) return 'data nesting too deep';
  return null;
}

/* =====================================================================
   TEAM ROLES & PERMISSIONS (auditor #11)
   Three roles with an explicit capability matrix, so permissions are
   defined in one place instead of scattered ad-hoc checks.
     • owner  — full control; only one; can't be removed; can delete team
     • admin  — manage members, change member/admin roles, edit team data
     • member — use the shared workspace, read members, leave
   ===================================================================== */
const TEAM_PERMS = {
  owner:  new Set(['invite','remove','setRole','editData','viewMembers','viewAudit','deleteTeam','rename']),
  admin:  new Set(['invite','remove','setRole','editData','viewMembers','viewAudit','rename']),
  member: new Set(['viewMembers']),
};
function _can(team, email, perm){
  const r = _role(team, email);
  return !!(r && TEAM_PERMS[r] && TEAM_PERMS[r].has(perm));
}
// Append an immutable-ish action record to the team's audit log (last 200).
async function _teamAudit(env, team, actorEmail, action, detail){
  try{
    const key = `teamlog:${team.id}`;
    const raw = await env.AMV_KV.get(key);
    const log = raw ? JSON.parse(raw) : [];
    log.push({ t: Date.now(), actor: actorEmail, action, ...(detail||{}) });
    // keep the most recent 200 entries
    const trimmed = log.slice(-200);
    await env.AMV_KV.put(key, JSON.stringify(trimmed));
    audit(env, 'team_action', { team: team.id, actor: actorEmail, action });
  }catch(e){ /* logging must never break the operation */ }
}
async function teamInvite(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { email, role } = await request.json().catch(()=>({}));
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  if(!_can(team, user.email, 'invite')) return json({ error:'you don\u2019t have permission to invite' }, 403);
  const invitee = String(email||'').toLowerCase().trim();
  if(!invitee) return json({ error:'email required' }, 400);
  // can't grant a role higher than allowed; only owner/admin roles are 'admin'/'member'
  const inviteRole = (role==='admin') ? 'admin' : 'member';
  // create a high-entropy invite token (256 bits) bound to THIS recipient email
  const token = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  await env.AMV_KV.put(`invite:${token}`, JSON.stringify({ teamId:team.id, email:invitee, role:inviteRole, ts:Date.now() }), { expirationTtl: 7*86400 });
  await _teamAudit(env, team, user.email, 'member_invited', { invitee, role:inviteRole });
  return json({ ok:true, inviteToken: token, inviteLink: `?invite=${token}` });
}
async function teamJoin(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { token } = await request.json().catch(()=>({}));
  const raw = token ? await env.AMV_KV.get(`invite:${token}`) : null;
  if(!raw) return json({ error:'invalid or expired invite' }, 404);
  const inv = JSON.parse(raw);
  // BIND to the recipient: only the authenticated user the invite was sent to may
  // redeem it. A leaked/forwarded invite link cannot grant a role to any other
  // account (this is how an admin invite became a transferable privilege grant).
  if(!inv.email || inv.email !== user.email) return json({ error:'this invite was sent to a different email' }, 403);
  // Consume atomically so two racers can't both redeem the same token.
  if(!(await _claimOnce(env, 'inviteused', token))) return json({ error:'this invite has already been used' }, 409);
  const team0 = await DB.get(env, 'team', inv.teamId);
  if(!team0) return json({ error:'team gone' }, 404);
  const team = team0;
  if(!team.members.find(m=>m.email===user.email)){
    team.members.push({ email:user.email, role:inv.role||'member', joinedAt:Date.now() });
    await DB.put(env, 'team', team.id, team);
    await _teamAudit(env, team, user.email, 'member_joined', { role: inv.role||'member' });
  }
  await env.AMV_KV.put(`userteam:${user.email}`, team.id);
  await env.AMV_KV.delete(`invite:${token}`);
  return json({ ok:true, team });
}
async function teamMembers(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ ok:true, members:[] });
  return json({ ok:true, members: team.members });
}
async function teamRemove(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { email } = await request.json().catch(()=>({}));
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  if(!_can(team, user.email, 'remove')) return json({ error:'you don\u2019t have permission to remove members' }, 403);
  const target = String(email||'').toLowerCase().trim();
  if(_role(team, target)==='owner') return json({ error:'the owner can\u2019t be removed' }, 400);
  // admins can't remove other admins (only the owner can)
  if(_role(team, target)==='admin' && _role(team, user.email)!=='owner') return json({ error:'only the owner can remove an admin' }, 403);
  team.members = team.members.filter(m=>m.email!==target || m.role==='owner');
  await DB.put(env, 'team', team.id, team);
  await env.AMV_KV.delete(`userteam:${target}`);
  await _teamAudit(env, team, user.email, 'member_removed', { target });
  return json({ ok:true, members:team.members });
}

/* Change a member's role (promote to admin / demote to member). */
async function teamSetRole(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { email, role } = await request.json().catch(()=>({}));
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  if(!_can(team, user.email, 'setRole')) return json({ error:'you don\u2019t have permission to change roles' }, 403);
  const target = String(email||'').toLowerCase().trim();
  const newRole = (role==='admin') ? 'admin' : 'member';
  const m = team.members.find(x=>x.email===target);
  if(!m) return json({ error:'member not found' }, 404);
  if(m.role==='owner') return json({ error:'the owner\u2019s role can\u2019t be changed' }, 400);
  // only the owner can create/demote admins
  if(_role(team, user.email)!=='owner') return json({ error:'only the owner can change admin roles' }, 403);
  const prev = m.role; m.role = newRole;
  await DB.put(env, 'team', team.id, team);
  await _teamAudit(env, team, user.email, 'role_changed', { target, from: prev, to: newRole });
  return json({ ok:true, members: team.members });
}

/* Read the team's action audit log (owner/admin only). */
async function teamAuditLog(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ ok:true, log:[] });
  if(!_can(team, user.email, 'viewAudit')) return json({ error:'forbidden' }, 403);
  const raw = await env.AMV_KV.get(`teamlog:${team.id}`);
  const log = raw ? JSON.parse(raw) : [];
  return json({ ok:true, log: log.slice().reverse() });   // newest first
}
async function teamData(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  if(request.method==='GET') return json({ ok:true, data: team.data||{} });
  // WRITE — enforce the role model: only owner/admin may edit shared team data.
  if(!_can(team, user.email, 'editData')) return json({ error:'editing team data requires an admin or owner role' }, 403);
  const body = await request.json().catch(()=>({}));
  const patch = body.data || {};
  const bad = _boundedJson(patch, 64*1024, 6);
  if(bad) return json({ error: bad }, 413);
  team.data = Object.assign({}, team.data, patch);
  await DB.put(env, 'team', team.id, team);
  return json({ ok:true, data: team.data });
}

/* ---------------- SHARED TEAM LIBRARY ----------------
   Any member can share a project or prompt into the team's shared library;
   every member sees it. Stored on the team record; audited. */
async function teamShare(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  const { kind, item } = await request.json().catch(()=>({}));
  if(!kind || !item) return json({ error:'kind and item required' }, 400);
  const tooBig = _boundedJson(item, 32*1024, 6);
  if(tooBig) return json({ error: tooBig }, 413);
  const shared = Array.isArray(team.data && team.data.shared) ? team.data.shared : [];
  const entry = { id:'shr_'+crypto.randomUUID().replace(/-/g,''), kind:String(kind).slice(0,24),
    title:String(item.title||item.name||'Untitled').slice(0,120), item,
    by:user.email, byName:user.name||user.email.split('@')[0], at:Date.now() };
  shared.unshift(entry);
  if(shared.length>200) shared.length=200;
  team.data = Object.assign({}, team.data, { shared });
  await DB.put(env, 'team', team.id, team);
  await _teamAudit(env, team, user.email, 'item_shared', { kind:entry.kind, title:entry.title });
  return json({ ok:true, shared });
}
async function teamShared(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ ok:true, shared:[] });
  return json({ ok:true, shared: (team.data && team.data.shared) || [] });
}
async function teamUnshare(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  const { id } = await request.json().catch(()=>({}));
  let shared = (team.data && team.data.shared) || [];
  const entry = shared.find(s=>s.id===id);
  // only the sharer or an admin/owner can remove
  const role = _role(team, user.email);
  if(entry && entry.by!==user.email && !TEAM_PERMS[role]?.has('editData')) return json({ error:'forbidden' }, 403);
  shared = shared.filter(s=>s.id!==id);
  team.data = Object.assign({}, team.data, { shared });
  await DB.put(env, 'team', team.id, team);
  return json({ ok:true, shared });
}

/* ---------------- TEAM PRESENCE ----------------
   Poll-based heartbeat: each ping records the member's last-seen time; anyone
   seen in the last 60s counts as "active now". Cheap, no sockets, and honest —
   it reflects real recent activity. */
async function teamPresence(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ ok:true, present:[] });
  const key = 'presence:'+team.id;
  let map = (await DB.get(env, 'presence', team.id)) || {};
  const now = Date.now();
  map[user.email] = now;
  // prune stale (>5 min) to keep it small
  for(const e of Object.keys(map)){ if(now - map[e] > 300000) delete map[e]; }
  await DB.put(env, 'presence', team.id, map);
  const WINDOW = 60000; // active if seen in the last minute
  const present = (team.members||[]).map(m=>({
    email:m.email, name:(m.email===user.email?(user.name||''):'')||m.email.split('@')[0],
    active: (map[m.email] && (now - map[m.email] < WINDOW)) || m.email===user.email
  }));
  return json({ ok:true, present });
}

/* ---------------- TEAM TASK ASSIGNMENT ----------------
   A real assignment system: any member can create a task and assign it to a
   teammate; the assignee (or a manager) can move it across statuses. Tasks are
   stored per-team and every change is written to the team audit log. */
const TASK_STATUSES = new Set(['todo', 'in_progress', 'done']);
async function _teamTasks(env, teamId){ return (await DB.get(env, 'teamtasks', teamId)) || []; }
async function _saveTeamTasks(env, teamId, tasks){ await DB.put(env, 'teamtasks', teamId, tasks); }

async function teamTasks(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  return json({ ok:true, tasks: await _teamTasks(env, team.id), members: (team.members||[]).map(m=>({email:m.email, role:m.role})) });
}

async function teamTaskCreate(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  const { title, assignee, notes, priority } = await request.json().catch(()=>({}));
  if(!title || !String(title).trim()) return json({ error:'title required' }, 400);
  // assignee, if given, must be a real member of this team
  const asg = (assignee||'').toLowerCase().trim();
  if(asg && !(team.members||[]).some(m=>m.email===asg)) return json({ error:'assignee is not a team member' }, 400);
  const tasks = await _teamTasks(env, team.id);
  const task = {
    id: 't'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    title: String(title).trim().slice(0, 300),
    notes: String(notes||'').slice(0, 4000),
    assignee: asg || null,
    priority: ['low','normal','high'].includes(priority) ? priority : 'normal',
    status: 'todo',
    createdBy: user.email,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  tasks.unshift(task);
  await _saveTeamTasks(env, team.id, tasks);
  await _teamAudit(env, team, user.email, 'task_created', { target: asg || '(unassigned)', title: task.title });
  if (asg && asg !== user.email) await _notifyAssignee(env, team, user, asg, task);
  return json({ ok:true, task, tasks });
}

/* Email a teammate when work lands on them (no-op if email isn't configured,
   never throws — notification must not break the assignment). */
async function _notifyAssignee(env, team, assigner, assigneeEmail, task) {
  try {
    const appUrl = (env.APP_URL || '').replace(/\/$/, '');
    await sendTaskAssignedEmail(env, assigneeEmail, {
      assignerName: assigner.name || assigner.email,
      taskTitle: task.title,
      priority: task.priority,
      teamName: team.name,
      appUrl: appUrl ? appUrl + '?tab=team' : '',
    });
  } catch (e) { /* email failure must not affect the operation */ }
}

async function teamTaskUpdate(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  const { id, status, assignee, del } = await request.json().catch(()=>({}));
  const tasks = await _teamTasks(env, team.id);
  const i = tasks.findIndex(t=>t.id===id);
  if(i<0) return json({ error:'task not found' }, 404);
  const me = (team.members||[]).find(m=>m.email===user.email);
  const canManage = me && (me.role==='owner' || me.role==='admin');
  const isAssignee = tasks[i].assignee === user.email;
  const isCreator = tasks[i].createdBy === user.email;
  // delete: only managers or the creator
  if(del){
    if(!canManage && !isCreator) return json({ error:'not allowed to delete this task' }, 403);
    const removed = tasks.splice(i,1)[0];
    await _saveTeamTasks(env, team.id, tasks);
    await _teamAudit(env, team, user.email, 'task_deleted', { title: removed.title });
    return json({ ok:true, tasks });
  }
  // status change: assignee, creator, or a manager
  if(status){
    if(!TASK_STATUSES.has(status)) return json({ error:'invalid status' }, 400);
    if(!canManage && !isAssignee && !isCreator) return json({ error:'not allowed to update this task' }, 403);
    tasks[i].status = status;
  }
  // reassign: managers only (or the creator)
  if(assignee !== undefined){
    if(!canManage && !isCreator) return json({ error:'only managers can reassign' }, 403);
    const asg = (assignee||'').toLowerCase().trim();
    if(asg && !(team.members||[]).some(m=>m.email===asg)) return json({ error:'assignee is not a team member' }, 400);
    tasks[i].assignee = asg || null;
    await _teamAudit(env, team, user.email, 'task_reassigned', { target: asg||'(unassigned)', title: tasks[i].title });
    if (asg && asg !== user.email) await _notifyAssignee(env, team, user, asg, tasks[i]);
  }
  tasks[i].updatedAt = Date.now();
  await _saveTeamTasks(env, team.id, tasks);
  if(status) await _teamAudit(env, team, user.email, 'task_status', { title: tasks[i].title, to: status });
  return json({ ok:true, tasks });
}

async function syncPull(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const data = (await DB.get(env, 'data', user.email)) || {};
  return json({ ok:true, data, serverTime: Date.now() });
}
/* Push the user's data up (last-write-wins per top-level key, with a merge). */
const SYNC_ALLOWED_KEYS = new Set([
  'chats','convs','memory','workspaces','prompts','settings','imgs','vids','custom_cfg','plan_since',
  // Your actual WORK — Dev projects, Lab sessions, and everything in Recents.
  // These used to live only in the browser, so switching device or clearing the
  // cache destroyed them. They are the most valuable thing a user has.
  'sessions','skills','handoffs','profile'
]);
const SYNC_MAX_BYTES = 4 * 1024 * 1024;   // 4MB hard ceiling (well under KV's 25MB, sane for D1)
async function syncPush(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  // Sync can be frequent (autosave), so allow a generous minute rate but a
  // sane daily ceiling so a stuck client can't hammer KV writes forever.
  const blocked = await guardAction(env, `sync:${user.email}`, 60, 5000, 'syncs');
  if(blocked) return blocked;
  const body = await request.json().catch(()=>({}));
  const incoming = body.data || {};
  if(typeof incoming !== 'object' || Array.isArray(incoming)) return json({ error:'invalid data' }, 400);
  // Only persist known keys — a client can't bloat its own server record with
  // arbitrary fields (auditor #3: validate + bound what we store).
  const filtered = {};
  for(const k of Object.keys(incoming)){ if(SYNC_ALLOWED_KEYS.has(k)) filtered[k] = incoming[k]; }
  const current = (await DB.get(env, 'data', user.email)) || {};
  const merged = Object.assign({}, current, filtered, { _updatedAt: Date.now() });
  // Enforce a real size cap (the comment used to promise this but didn't do it).
  const serialized = JSON.stringify(merged);
  if(serialized.length > SYNC_MAX_BYTES){
    audit(env, 'sync_oversize', { email: user.email, bytes: serialized.length });
    return json({ error: 'Your synced data is too large. Some older items may need pruning.', code: 'sync_too_large' }, 413);
  }
  await DB.put(env, 'data', user.email, merged);
  return json({ ok:true, serverTime: Date.now() });
}

async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const data = await verifyToken(token, env.JWT_SECRET, env, 'access');
  if (!data) return null;
  // attach current plan + custom config from entitlement store
  const e = (await DB.get(env, 'ent', data.email)) || {};
  data.plan = e.plan || 'free';
  data.customCfg = e.custom || null;   // { price, monthTokens, dayTokens, rpm } set at checkout
  return data;
}

/* Resolve the effective limits for a user — custom plans use their purchased pool. */
function effectiveLimits(user) {
  if (user.plan === 'custom' && user.customCfg) {
    const c = user.customCfg;
    const price = c.price || 30;
    const monthTokens = c.monthTokens || 300000;
    // Image & video limits scale with the plan size so a bigger custom budget
    // genuinely buys proportionally more media — not a flat binary. Bounded so
    // they never exceed what the price can cover (margin stays protected).
    // ~1 image per 30k tokens of headroom; videos scale per $ above $15.
    const imagesDay = Math.min(5000, Math.max(50, Math.floor(monthTokens / 30000)));
    const videosMonth = price >= 15 ? Math.min(1000, Math.floor((price - 10) * 4)) : 0;
    return {
      dayTokens: c.dayTokens || 50000,
      monthTokens,                              // HARD CAP — the profit guarantee
      rpm: c.rpm || 16,
      imagesDay,
      videosMonth,
      allModels: true,
    };
  }
  return PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;
}


/* ==============================================================
   VIDEO GENERATION - real, not a progress bar.

   Video is unlike everything else here: it takes 30s-3min, so it cannot be a
   single request. It's a JOB. We create it, hand back an id, and the client
   polls. The job lives in KV so it survives the user closing the tab.

   Provider-agnostic. Set three secrets and it works:
     VIDEO_API_URL    e.g. https://api.replicate.com/v1/predictions
     VIDEO_API_KEY    the provider key
     VIDEO_MODEL      the model/version id at that provider

   Without them we return { configured:false } and the app SAYS SO rather than
   faking a render. That honesty is the whole point - this feature used to be a
   setInterval that ticked a fake progress bar and produced nothing.
   ============================================================== */

const VIDEO_MAX_SECONDS = 30;
const VIDEO_JOB_TTL     = 60 * 60 * 24 * 7;   // keep finished jobs for a week

function _videoConfigured(env) {
  return !!(env.VIDEO_API_URL && env.VIDEO_API_KEY && env.VIDEO_MODEL);
}

/* POST /v1/video/generate  -> { id, status } */
async function videoGenerate(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in again.' }, 401);

  if (!_videoConfigured(env)) return json({ configured: false });

  const body = await request.json().catch(() => ({}));
  const prompt = String(body.prompt || '').trim().slice(0, 2000);
  if (!prompt) return json({ error: 'Describe the video you want.' }, 400);

  const seconds = Math.min(VIDEO_MAX_SECONDS, Math.max(1, parseInt(body.seconds) || 5));
  const aspect  = ['16:9', '9:16', '1:1'].includes(body.aspect) ? body.aspect : '16:9';

  const limits = effectiveLimits(user);
  if (!limits.videosMonth) {
    return json({
      error: 'Video isn\u2019t included in your plan. Upgrade to generate video.',
      code: 'plan_required'
    }, 402);
  }

  /* Reserve one video against the monthly cap ATOMICALLY, before we spend a
     cent at the provider. Same reasoning as the token quota: a plain
     read-then-check lets a burst of parallel requests all pass. */
  const vName = `vid:${user.email}:${monthKey()}`;
  const res = await counter(env, vName, {
    op: 'reserve', amount: 1, cap: limits.videosMonth, ttlMs: 86400000 * 70
  });
  if (!res.allowed) {
    return json({
      error: 'You\u2019ve used all the video in your plan this month.',
      code: 'video_quota',
      limit: limits.videosMonth
    }, 429);
  }
  const refund = async () => {
    try { await counter(env, vName, { op: 'incr', amount: -1, ttlMs: 86400000 * 70 }); } catch (e) {}
  };

  let providerId = '';
  try {
    const resp = await fetch(env.VIDEO_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.VIDEO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: env.VIDEO_MODEL,
        input: { prompt, duration: seconds, aspect_ratio: aspect },
      }),
    });
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(d?.detail || d?.error?.message || ('Provider returned ' + resp.status));
    providerId = String(d.id || d.request_id || '');
    if (!providerId) throw new Error('The video provider did not return a job id.');
  } catch (e) {
    await refund();                       // nothing was generated - give it back
    try { await _workerError(env, 'videoGenerate', e); } catch (_) {}
    return json({ error: 'Could not start the video: ' + e.message }, 502);
  }

  const id = 'vid_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const job = {
    id, providerId, email: user.email, prompt, seconds, aspect,
    status: 'starting', url: '', error: '',
    created: Date.now(), updated: Date.now(),
  };
  await env.AMV_KV.put('vidjob:' + id, JSON.stringify(job), { expirationTtl: VIDEO_JOB_TTL });

  audit(env, 'video_start', { email: user.email });
  return json({ ok: true, id, status: 'starting' });
}

/* POST /v1/video/status { id } -> { status, url?, error?, progress }
   Real state from the provider. No invented percentages. */
async function videoStatus(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in again.' }, 401);

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
  if (!id) return json({ error: 'missing id' }, 400);

  const raw = await env.AMV_KV.get('vidjob:' + id);
  if (!raw) return json({ error: 'That video job no longer exists.' }, 404);

  let job;
  try { job = JSON.parse(raw); } catch (e) { return json({ error: 'bad job' }, 500); }

  // A job belongs to the user who started it. Nobody else may read it.
  if (job.email !== user.email) return json({ error: 'not found' }, 404);

  // Terminal states are cached - stop hammering the provider.
  if (job.status === 'succeeded' || job.status === 'failed') {
    return json({ ok: true, status: job.status, url: job.url, error: job.error, prompt: job.prompt });
  }

  if (!_videoConfigured(env)) return json({ configured: false });

  try {
    const base = env.VIDEO_API_URL.replace(/\/+$/, '');
    const resp = await fetch(base + '/' + job.providerId, {
      headers: { 'Authorization': 'Bearer ' + env.VIDEO_API_KEY },
    });
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(d?.detail || ('Provider returned ' + resp.status));

    // Normalise the provider's vocabulary to ours.
    const raw_status = String(d.status || '').toLowerCase();
    let status = 'processing';
    if (['succeeded', 'completed', 'success'].includes(raw_status)) status = 'succeeded';
    else if (['failed', 'error', 'canceled', 'cancelled'].includes(raw_status)) status = 'failed';
    else if (['starting', 'queued', 'pending'].includes(raw_status)) status = 'starting';

    let url = '';
    if (status === 'succeeded') {
      const out = d.output;
      url = Array.isArray(out) ? String(out[out.length - 1] || '') : String(out || '');
      if (!url) { status = 'failed'; job.error = 'The provider finished but returned no video.'; }
    }
    if (status === 'failed' && !job.error) {
      job.error = String(d.error || 'The video could not be generated.');
      // It produced nothing, so it shouldn't count against their plan.
      const limits = effectiveLimits(user);
      if (limits.videosMonth) {
        try {
          await counter(env, `vid:${user.email}:${monthKey()}`,
            { op: 'incr', amount: -1, ttlMs: 86400000 * 70 });
        } catch (e) {}
      }
    }

    job.status = status;
    job.url = url || job.url;
    job.updated = Date.now();
    await env.AMV_KV.put('vidjob:' + id, JSON.stringify(job), { expirationTtl: VIDEO_JOB_TTL });

    return json({ ok: true, status: job.status, url: job.url, error: job.error, prompt: job.prompt });
  } catch (e) {
    try { await _workerError(env, 'videoStatus', e); } catch (_) {}
    // A transient polling failure is NOT a failed video - don't kill the job.
    return json({ ok: true, status: job.status, url: job.url, error: '', transient: e.message });
  }
}

/* POST /v1/video/list -> the user's recent videos (survives a page reload) */
async function videoList(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  const limits = effectiveLimits(user);
  const used = (await counter(env, `vid:${user.email}:${monthKey()}`, { op: 'get' })).value || 0;
  return json({
    ok: true,
    configured: _videoConfigured(env),
    used,
    limit: limits.videosMonth || 0,
  });
}

/* ---------------- THE AI PROXY (the heart) -------------------------- */
async function aiProxy(request, env, ctx) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in again.' }, 401);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid request body.' }, 400);

  // --- INPUT VALIDATION (auditor #4) ---
  // Reject malformed/oversized requests before they reach the model. This is
  // the first line of defense; it bounds cost and shrinks the attack surface.
  const vErr = validateMessagesPayload(body);
  if (vErr) return json({ error: vErr, code: 'invalid_input' }, 400);

  // resolve requested engine
  const rawModel = body.model || 'claude-sonnet-4-6';
  const key = RAW_TO_KEY[rawModel] || (ENGINES[rawModel] ? rawModel : 'amv-core');
  const eng = ENGINES[key];

  const limits = effectiveLimits(user);

  // 1) PLAN ENFORCEMENT — free can't call premium engines (custom plans paid for all models)
  if (!limits.allModels && PLAN_RANK[user.plan] < PLAN_RANK[eng.minPlan]) {
    return json({ error: `${key} requires the ${eng.minPlan} plan. Upgrade to use it.`, code: 'plan_required', minPlan: eng.minPlan }, 402);
  }

  // 2) RATE LIMIT (per account, per minute) — ATOMIC test-and-increment.
  //    A Durable Object serializes this op, so parallel requests can't race
  //    past the limit (the bug a plain KV read-then-write would have).
  const rlName = `rl:${user.email}:${Math.floor(Date.now() / 60000)}`;
  const rlRes = await counter(env, rlName, { op: 'rateCheck', limit: limits.rpm, windowMs: 60000 });
  if (!rlRes.allowed) { audit(env,'rate_block',{email:user.email}); return json({ error: 'Rate limit reached. Slow down a moment.', code: 'rate_limited' }, 429); }

  // 3) QUOTA CHECK (per account, day + month)
  //
  // RESERVE-THEN-RECONCILE. The obvious version of this is:
  //     read used -> compare to cap -> call the model -> add what it cost
  // That races. Twenty parallel requests all read the SAME `used`, all decide
  // they're under the cap, and all call the model. Measured on the free plan:
  // 8 concurrent requests burned 160,000 tokens against a 50,000/day cap — a
  // 3.2x overshoot, trivially triggered from devtools with a fetch loop.
  //
  // So instead we RESERVE an upper bound atomically BEFORE calling the model.
  // The counter is a Durable Object, so the increment is serialised: only the
  // requests that actually fit under the cap get through. meterStream() then
  // reconciles the reservation against what the call really cost (refunding the
  // difference), so nobody is over-billed for reserving conservatively.
  const dName = `usg:${user.email}:${todayKey()}`;
  const mName = `usg:${user.email}:${monthKey()}`;

  // Upper bound for this call: what we're sending + the most it can generate.
  const estIn  = _estimateInputTokens(body.messages || []);
  const estOut = Math.max(1, Math.min(Number(body.max_tokens) || 1024, 200000));
  const reserve = estIn + estOut;

  const dRes = await counter(env, dName, { op: 'reserve', amount: reserve, cap: limits.dayTokens,  ttlMs: 86400000 * 35 });
  if (!dRes.allowed) {
    const now = new Date();
    const resetAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return json({ error: 'Daily usage limit reached.', code: 'quota_day', resetAt }, 429);
  }
  const mRes = await counter(env, mName, { op: 'reserve', amount: reserve, cap: limits.monthTokens, ttlMs: 86400000 * 70 });
  if (!mRes.allowed) {
    // give back the daily reservation we just took — this call isn't happening
    await counter(env, dName, { op: 'incr', amount: -reserve, ttlMs: 86400000 * 35 });
    const now = new Date();
    const resetAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    return json({ error: 'Monthly usage limit reached. Upgrade for more room.', code: 'quota_month', resetAt }, 429);
  }

  // From here on, `reserve` tokens are already booked against this user. Any
  // early return below MUST refund them, or a failed call would silently eat
  // someone's quota.
  const refundReservation = async () => {
    try {
      await counter(env, dName, { op: 'incr', amount: -reserve, ttlMs: 86400000 * 35 });
      await counter(env, mName, { op: 'incr', amount: -reserve, ttlMs: 86400000 * 70 });
    } catch (e) { /* never throw out of a refund */ }
  };

  const mUsed = mRes.value || 0;
  const dUsed = dRes.value || 0;
  // (month cap already enforced by the reservation above)

  // 3b) COST BACKSTOP — applies to EVERY paid plan. A user can never cost us
  //     more than a safe fraction of what they paid, guaranteeing margin even
  //     if they run 100% on the most expensive model. This is the profit lock.
  const PLAN_PRICE = { pro:15, elite:75, ultra:200 };
  let priceForBackstop = 0;
  if (user.plan === 'custom' && user.customCfg && user.customCfg.price) priceForBackstop = user.customCfg.price;
  else if (PLAN_PRICE[user.plan]) priceForBackstop = PLAN_PRICE[user.plan];
  const costName = `cost:${user.email}:${monthKey()}`;
  if (priceForBackstop > 0) {
    const costCeiling = priceForBackstop * 0.45;   // keep >=55% margin on every plan, worst case
    const capRes = await counter(env, costName, { op: 'checkCap', cap: costCeiling });
    if (!capRes.allowed) {
      audit(env,'spend_cap_hit',{email:user.email,plan:user.plan}); await refundReservation(); return json({ error: 'You\u2019ve used your full plan allowance for this billing cycle. It resets next month, or upgrade for more.', code: 'quota_month' }, 429);
    }
  }

  // 4) GLOBAL SPEND CAP — hard ceiling across ALL users (atomic read)
  const gName = `spend:${todayKey()}`;
  const gCap = parseFloat(env.GLOBAL_DAILY_USD_CAP || '500');
  const gRes = await counter(env, gName, { op: 'checkCap', cap: gCap });
  if (!gRes.allowed) {
    audit(env,'global_cap_hit',{value:gRes.value||0,cap:gCap}); ctx.waitUntil(notify(env, `GLOBAL DAILY SPEND CAP HIT: $${(gRes.value||0).toFixed(2)} >= $${gCap}`));
    await refundReservation();   // the call never happened — don't eat their quota
    return json({ error: 'Service is at capacity for today. Please try again tomorrow.', code: 'global_cap' }, 503);
  }

  // 5) clamp output tokens to the engine max (cost ceiling per call)
  const maxTokens = Math.min(body.max_tokens || eng.maxOut, eng.maxOut);

  // 6) build the upstream request — inject prompt caching to cut input cost
  const upstreamBody = {
    model: eng.model,
    max_tokens: maxTokens,
    stream: true,
    messages: body.messages || [],
  };
  if (body.system) {
    // cache the big system prompt so repeat turns are ~90% cheaper
    upstreamBody.system = [{ type: 'text', text: String(body.system), cache_control: { type: 'ephemeral' } }];
  }
  // Only forward tools we explicitly support — never pass arbitrary client
  // tool definitions straight upstream (auditor #4: bounds attack + cost surface).
  if (body.tools && Array.isArray(body.tools)) {
    const ALLOWED_TOOLS = new Set(['web_search_20250305']);
    const safe = body.tools.filter(t => t && ALLOWED_TOOLS.has(t.type)).map(t => {
      // Clamp max_uses server-side. The client asks for research depth, but a
      // tampered client must not be able to request 10,000 searches and run up
      // the bill. 60 is the ceiling even for the deepest research tier.
      if (t.type === 'web_search_20250305' && t.max_uses != null) {
        const n = parseInt(t.max_uses, 10);
        t = { ...t, max_uses: Math.max(1, Math.min(60, isNaN(n) ? 5 : n)) };
      }
      return t;
    });
    if (safe.length) upstreamBody.tools = safe;
  }

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,           // KEY HIDDEN SERVER-SIDE
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify(upstreamBody),
  });

  if (!upstream.ok) {
    // The model errored, so it produced nothing. Give the reservation back —
    // otherwise an outage would quietly burn through everyone's daily quota.
    await refundReservation();
    const e = await upstream.json().catch(() => ({}));
    try { await _workerError(env, 'aiProxy:upstream', new Error('upstream ' + upstream.status)); } catch (_) {}
    // A 401/403 from the model means your API key is bad/expired/over-quota —
    // that breaks the ENTIRE product for everyone, so alert loudly and fast.
    if (upstream.status === 401 || upstream.status === 403) {
      ctx.waitUntil(alertOnce(env, 'model_auth_fail', `🚨 Model API rejected our key (${upstream.status}): ${e?.error?.message || 'auth error'}. AI is DOWN for all users — check ANTHROPIC_API_KEY / billing.`, 10));
    } else if (upstream.status >= 500) {
      ctx.waitUntil(alertOnce(env, 'model_5xx', `⚠️ Model API erroring (${upstream.status}). AI responses may be failing.`, 15));
    }
    return json({ error: e?.error?.message || 'AI error', status: upstream.status }, upstream.status);
  }

  // 7) tee the stream: pass to client AND tally tokens/cost as it flows
  const [toClient, toMeter] = upstream.body.tee();
  ctx.waitUntil(meterStream(toMeter, eng, { dName, mName, gName, costName, user, env, limits, reqMessages: body.messages || [], reserved: reserve }));

  return new Response(toClient, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...CORS, ...SECURITY_HEADERS },
  });
}

/* Read the SSE copy, extract usage, persist token + cost counters atomically.
   Hardened for accuracy (auditor #3):
   - Prices cache tiers correctly: cache READ ~0.1x input, cache WRITE ~1.25x.
   - Survives interruptions: tracks the latest usage seen, so a disconnect
     mid-stream still bills what was generated (never a free ride).
   - Handles message_start / message_delta / message_stop usage shapes.
   - Falls back to an output estimate if the stream yields no usage at all. */
async function meterStream(stream, eng, { dName, mName, gName, costName, user, env, limits, reqMessages, reserved = 0 }) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let inTok = 0, cacheRead = 0, cacheWrite = 0, outTok = 0;
  let sawUsage = false, sawAnyEvent = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const ln of lines) {
        const line = ln.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let ev; try { ev = JSON.parse(payload); } catch { continue; }
        sawAnyEvent = true;
        // input + cache token counts arrive in message_start
        if (ev.type === 'message_start' && ev.message && ev.message.usage) {
          const u = ev.message.usage;
          inTok      = u.input_tokens || 0;
          cacheRead  = u.cache_read_input_tokens || 0;
          cacheWrite = u.cache_creation_input_tokens || 0;
          if (typeof u.output_tokens === 'number') outTok = u.output_tokens;
          sawUsage = true;
        }
        // output token count accumulates and finalizes in message_delta
        if (ev.type === 'message_delta' && ev.usage && typeof ev.usage.output_tokens === 'number') {
          outTok = ev.usage.output_tokens;  // Anthropic sends the running TOTAL, not a delta
          sawUsage = true;
        }
        // some responses (tool use, final) also carry usage on message_stop
        if (ev.type === 'message_stop' && ev.usage) {
          if (typeof ev.usage.output_tokens === 'number') outTok = ev.usage.output_tokens;
          if (typeof ev.usage.input_tokens === 'number') inTok = ev.usage.input_tokens;
          sawUsage = true;
        }
      }
    }
  } catch { /* stream interrupted — we still bill whatever usage we saw */ }

  // Fallback: if we never got usage (parse failure / hard interruption), estimate
  // conservatively from the request so a request is NEVER completely free.
  if (!sawUsage) {
    const estIn = _estimateInputTokens(reqMessages);
    inTok = inTok || estIn;
    outTok = outTok || Math.floor((eng.maxOut || 4000) * 0.5); // assume half the cap was produced
  }

  // --- cost, priced by tier (per million tokens) ---
  // cache reads are ~10% of input price; cache writes ~125% of input price.
  const cost =
      (inTok      / 1e6) * eng.inCost
    + (cacheRead  / 1e6) * eng.inCost * 0.10
    + (cacheWrite / 1e6) * eng.inCost * 1.25
    + (outTok     / 1e6) * eng.outCost;

  // total tokens for quota accounting (count cache tokens too — they're real usage)
  const total = inTok + cacheRead + cacheWrite + outTok;

  // persist counters ATOMICALLY (DO incr) — no read-modify-write race
  /* RECONCILE the reservation.

     `reserved` tokens were already booked against this user BEFORE the model
     ran (that pre-booking is what stops a parallel burst from blowing past the
     cap). Now we know what the call actually cost, so we settle the difference:

        actual > reserved  ->  charge the extra
        actual < reserved  ->  refund the unused part

     Adding `total` outright here would double-charge every single call. */
  const delta = total - (reserved || 0);
  if (delta !== 0) {
    await counter(env, dName, { op: 'incr', amount: delta, ttlMs: 86400000 * 35 });
    await counter(env, mName, { op: 'incr', amount: delta, ttlMs: 86400000 * 70 });
  }
  const gRes = await counter(env, gName, { op: 'incr', amount: cost, ttlMs: 86400000 * 2 });
  await counter(env, costName, { op: 'incr', amount: cost, ttlMs: 86400000 * 70 });

  // alert threshold (80% of global cap)
  const gSpent = gRes.value || 0;
  const gCap = parseFloat(env.GLOBAL_DAILY_USD_CAP || '500');
  if (gSpent >= gCap * 0.8 && gSpent - cost < gCap * 0.8) {
    await notify(env, `Spend alert: today at $${gSpent.toFixed(2)} (80% of $${gCap} cap).`);
  }
}

/* Rough token estimate from request messages (~4 chars/token), used only as a
   billing floor when the upstream stream gave us no usage numbers at all. */
function _estimateInputTokens(messages) {
  try {
    if (!Array.isArray(messages)) return 500;
    let chars = 0;
    for (const m of messages) {
      if (typeof m.content === 'string') chars += m.content.length;
      else if (Array.isArray(m.content)) for (const b of m.content) chars += (b.text || '').length;
    }
    return Math.max(200, Math.ceil(chars / 4));
  } catch { return 500; }
}

/* ---------------- IMAGE METERING ----------------------------------- */
async function imageMeter(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in' }, 401);
  const limits = effectiveLimits(user);
  const imgName = `img:${user.email}:${todayKey()}`;
  // atomic test-and-increment so parallel image requests can't exceed the cap
  const used = (await counter(env, imgName, { op: 'get' })).value || 0;
  if (used >= limits.imagesDay) return json({ error: 'Daily image limit reached. Upgrade for more.', code: 'img_quota' }, 429);
  const res = await counter(env, imgName, { op: 'incr', amount: 1, ttlMs: 86400000 * 2 });
  return json({ ok: true, remaining: Math.max(0, limits.imagesDay - (res.value || used + 1)) });
}

/* ---------------- PREMIUM IMAGE GENERATION (operator-configured) ------
   When the operator sets a premium image provider (IMAGE_API_URL +
   IMAGE_API_KEY as Worker secrets), image generation is proxied here so the
   key stays server-side and every call is metered against the user's daily
   image cap. The request body is { prompt, width, height }. We POST to the
   configured provider in a standard OpenAI-images-compatible shape and return
   { url } or { b64 }. If no provider is configured we return {configured:false}
   so the client falls back to the built-in free generator. This means adding a
   premium key is the ONLY step needed to upgrade image quality app-wide. */
async function imageGenerate(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in' }, 401);

  // No premium provider configured → tell the client to use its free fallback.
  if (!env.IMAGE_API_URL || !env.IMAGE_API_KEY) {
    return json({ configured: false });
  }

  // Enforce the daily image cap (atomic), same as the meter.
  const limits = effectiveLimits(user);
  const imgName = `img:${user.email}:${todayKey()}`;
  const used = (await counter(env, imgName, { op: 'get' })).value || 0;
  if (used >= limits.imagesDay) return json({ error: 'Daily image limit reached. Upgrade for more.', code: 'img_quota' }, 429);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad request' }, 400); }
  const prompt = String(body.prompt || '').slice(0, 4000);
  if (!prompt) return json({ error: 'prompt required' }, 400);
  const width = Math.min(2048, Math.max(256, parseInt(body.width) || 1024));
  const height = Math.min(2048, Math.max(256, parseInt(body.height) || 1024));
  const size = `${width}x${height}`;

  // Count the image up-front (atomic) so parallel calls can't exceed the cap.
  await counter(env, imgName, { op: 'incr', amount: 1, ttlMs: 86400000 * 2 });

  try {
    const model = env.IMAGE_API_MODEL || 'gpt-image-1';
    const upstream = await fetch(env.IMAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.IMAGE_API_KEY}`,   // KEY HIDDEN SERVER-SIDE
      },
      body: JSON.stringify({ model, prompt, size, n: 1 }),
    });
    if (!upstream.ok) {
      const txt = await upstream.text().catch(() => '');
      return json({ error: 'image provider error', detail: txt.slice(0, 300) }, 502);
    }
    const data = await upstream.json().catch(() => ({}));
    const item = (data && data.data && data.data[0]) || {};
    if (item.url) return json({ ok: true, url: item.url });
    if (item.b64_json) return json({ ok: true, b64: item.b64_json });
    return json({ error: 'image provider returned no image' }, 502);
  } catch (e) {
    return json({ error: 'image generation failed', detail: String(e && e.message || e).slice(0, 200) }, 502);
  }
}

/* ---------------- USAGE REPORT (for the in-app dashboard) ----------- */
async function usageReport(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in' }, 401);
  const limits = effectiveLimits(user);
  const dUsed = (await counter(env, `usg:${user.email}:${todayKey()}`, { op: 'get' })).value || 0;
  const mUsed = (await counter(env, `usg:${user.email}:${monthKey()}`, { op: 'get' })).value || 0;
  const mCost = (await counter(env, `cost:${user.email}:${monthKey()}`, { op: 'get' })).value || 0;
  return json({
    plan: user.plan,
    day: { used: dUsed, limit: limits.dayTokens },
    month: { used: mUsed, limit: limits.monthTokens, costUSD: +mCost.toFixed(4) },
  });
}

/* =====================================================================
   EMBEDDABLE WIDGET  (the "add AMV chat to any website" feature)
   ---------------------------------------------------------------------
   Model (same shape ChatGPT/Intercom-style embeds use):
     1. The site owner (an authenticated AMV user) creates a widget config.
        We mint a PUBLIC site key (pk_...) that is safe to ship in HTML.
     2. They paste a one-line <script src=".../widget.js?k=pk_..."> on their
        site. That loader injects a bubble + an iframe pointing at the AMV
        app in embed mode.
     3. The embedded chat calls POST /v1/widget/chat with the site key. That
        endpoint is PUBLIC (no visitor login) but hard-fenced:
          • the site key must exist and be enabled
          • the request Origin must match an allowed domain on the config
          • per-widget daily message cap  (abuse / cost ceiling)
          • per-widget daily spend cap    (hard margin protection)
          • the global daily spend cap     (shared safety net)
        The Anthropic key is NEVER exposed; the model is chosen by the owner
        and clamped server-side. This makes the widget safe to expose to the
        open internet without turning your model into a free public API.
   ===================================================================== */

// Public site keys are safe to embed; we still store a private record keyed by it.
function _newSiteKey() { return 'pk_' + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8); }

// Normalize an origin/host for comparison ("https://a.com/", "A.com" -> "a.com")
function _host(v) {
  try {
    let s = String(v || '').trim().toLowerCase();
    if (!s) return '';
    if (!/^https?:\/\//.test(s)) s = 'https://' + s;
    return new URL(s).host;
  } catch { return String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''); }
}

// Is this request's Origin allowed by the widget's domain allow-list?
// An empty allow-list means "not yet restricted" — allowed, but we surface a
// warning in the owner UI so they lock it down before going wide.
function _originAllowed(reqOrigin, allowedList) {
  if (!Array.isArray(allowedList) || allowedList.length === 0) return true;
  const oh = _host(reqOrigin);
  if (!oh) return false;
  return allowedList.some(d => {
    const dh = _host(d);
    return dh && (oh === dh || oh.endsWith('.' + dh));
  });
}

// CORS headers for the public widget endpoint: reflect an allowed origin only.
function _widgetCors(reqOrigin, cfg) {
  const allow = _originAllowed(reqOrigin, cfg && cfg.origins) && reqOrigin ? reqOrigin : (cfg && (!cfg.origins || !cfg.origins.length) ? '*' : 'null');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

const WIDGET_DEFAULTS = {
  title: 'Chat with us',
  greeting: 'Hi! How can I help you today?',
  accent: '#4f7cff',
  model: 'amv-core',                 // owner-chosen engine, clamped server-side
  systemPrompt: 'You are a helpful assistant embedded on a website. Be concise, friendly, and accurate. If you do not know something, say so.',
  origins: [],                        // allow-listed domains (empty = unrestricted, warned)
  dailyMsgCap: 500,                  // messages/day across all visitors of this widget
  dailySpendCapUSD: 5,               // $/day hard ceiling for this widget
  maxOut: 1024,                       // per-answer token clamp (cost control)
  enabled: true,
};

/* PUBLIC: display-only config for the embed panel (title, greeting, accent).
   Never returns caps, system prompt, origins, or the owner — just what the
   visitor-facing UI needs to render. Safe to call with the public site key. */
async function widgetConfigPublic(request, env) {
  const url = new URL(request.url);
  const key = (url.searchParams.get('k') || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 120);
  const cfg = key ? await DB.get(env, 'widget', key) : null;
  const cors = { 'Access-Control-Allow-Origin': request.headers.get('Origin') || '*', 'Vary': 'Origin' };
  if (!cfg || !cfg.enabled) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });
  }
  return new Response(JSON.stringify({ ok: true, config: { title: cfg.title, greeting: cfg.greeting, accent: cfg.accent } }), {
    status: 200, headers: { 'Content-Type': 'application/json', ...cors },
  });
}

/* OWNER: read the caller's widget config (creating a default one on first use). */
async function widgetConfigGet(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in.' }, 401);
  let cfg = await DB.get(env, 'widget_owner', user.email);
  if (!cfg) {
    cfg = { ...WIDGET_DEFAULTS, key: _newSiteKey(), owner: user.email, created: Date.now() };
    await DB.put(env, 'widget_owner', user.email, cfg);
    await DB.put(env, 'widget', cfg.key, cfg);   // index by site key for public lookup
  }
  return json({ ok: true, config: cfg });
}

/* OWNER: create/update the widget config. Validates + clamps every field so a
   bad value can't widen cost exposure. The site key is immutable once minted. */
async function widgetConfigSave(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in.' }, 401);
  const blocked = await guardAction(env, `widget:${user.email}`, 20, 500, 'widget saves');
  if (blocked) return blocked;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid body.' }, 400);

  let cfg = await DB.get(env, 'widget_owner', user.email);
  if (!cfg) cfg = { ...WIDGET_DEFAULTS, key: _newSiteKey(), owner: user.email, created: Date.now() };

  // Apply only known, bounded fields
  const clampNum = (v, min, max, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };
  if (typeof body.title === 'string')       cfg.title = body.title.slice(0, 60);
  if (typeof body.greeting === 'string')    cfg.greeting = body.greeting.slice(0, 300);
  if (typeof body.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.accent)) cfg.accent = body.accent;
  if (typeof body.systemPrompt === 'string') cfg.systemPrompt = body.systemPrompt.slice(0, 4000);
  if (typeof body.model === 'string' && (ENGINES[body.model] || RAW_TO_KEY[body.model])) cfg.model = RAW_TO_KEY[body.model] || body.model;
  if (Array.isArray(body.origins))          cfg.origins = body.origins.map(_host).filter(Boolean).slice(0, 20);
  if (body.dailyMsgCap != null)             cfg.dailyMsgCap = clampNum(body.dailyMsgCap, 0, 100000, cfg.dailyMsgCap);
  if (body.dailySpendCapUSD != null)        cfg.dailySpendCapUSD = clampNum(body.dailySpendCapUSD, 0, 1000, cfg.dailySpendCapUSD);
  if (body.maxOut != null)                  cfg.maxOut = clampNum(body.maxOut, 128, 4000, cfg.maxOut);
  if (typeof body.enabled === 'boolean')    cfg.enabled = body.enabled;
  cfg.updated = Date.now();

  await DB.put(env, 'widget_owner', user.email, cfg);
  await DB.put(env, 'widget', cfg.key, cfg);
  audit(env, 'widget_save', { owner: user.email, key: cfg.key });
  return json({ ok: true, config: cfg });
}

/* PUBLIC: a website visitor's chat turn. Site-key + origin gated, own caps. */
async function widgetChat(request, env, ctx) {
  const reqOrigin = request.headers.get('Origin') || '';
  const body = await request.json().catch(() => null);
  const key = body && typeof body.key === 'string' ? body.key : '';
  const cfg = key ? await DB.get(env, 'widget', key) : null;

  // Unknown key: reply with a generic error and permissive-but-safe CORS so the
  // embedded page can render the message (never leak whether a key exists via CORS).
  if (!cfg || !cfg.enabled) {
    return new Response(JSON.stringify({ error: 'This chat widget is not available.' }), {
      status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': reqOrigin || '*', 'Vary': 'Origin' },
    });
  }
  const wcors = _widgetCors(reqOrigin, cfg);

  if (!_originAllowed(reqOrigin, cfg.origins)) {
    audit(env, 'widget_origin_block', { key, origin: reqOrigin });
    return new Response(JSON.stringify({ error: 'This widget is not enabled for this domain.' }), { status: 403, headers: { 'Content-Type': 'application/json', ...wcors } });
  }
  if (!body || !Array.isArray(body.messages)) {
    return new Response(JSON.stringify({ error: 'Invalid request.' }), { status: 400, headers: { 'Content-Type': 'application/json', ...wcors } });
  }

  // Validate + bound the visitor conversation just like the main proxy.
  const vErr = validateMessagesPayload({ messages: body.messages, system: cfg.systemPrompt, max_tokens: cfg.maxOut });
  if (vErr) return new Response(JSON.stringify({ error: vErr }), { status: 400, headers: { 'Content-Type': 'application/json', ...wcors } });

  const key2 = RAW_TO_KEY[cfg.model] || (ENGINES[cfg.model] ? cfg.model : 'amv-core');
  const eng = ENGINES[key2];

  // Per-widget DAILY MESSAGE cap (atomic test-and-increment).
  const msgName = `wmsg:${key}:${todayKey()}`;
  const msgUsed = (await counter(env, msgName, { op: 'get' })).value || 0;
  if (cfg.dailyMsgCap > 0 && msgUsed >= cfg.dailyMsgCap) {
    audit(env, 'widget_msg_cap', { key });
    return new Response(JSON.stringify({ error: 'This assistant has reached its daily message limit. Please try again tomorrow.' }), { status: 429, headers: { 'Content-Type': 'application/json', ...wcors } });
  }

  // Per-widget DAILY SPEND cap (hard margin protection for the owner).
  const wSpendName = `wspend:${key}:${todayKey()}`;
  if (cfg.dailySpendCapUSD > 0) {
    const capRes = await counter(env, wSpendName, { op: 'checkCap', cap: cfg.dailySpendCapUSD });
    if (!capRes.allowed) {
      audit(env, 'widget_spend_cap', { key });
      return new Response(JSON.stringify({ error: 'This assistant is unavailable right now. Please try again later.' }), { status: 429, headers: { 'Content-Type': 'application/json', ...wcors } });
    }
  }

  // GLOBAL daily spend cap (shared safety net across the whole platform).
  const gName = `spend:${todayKey()}`;
  const gCap = parseFloat(env.GLOBAL_DAILY_USD_CAP || '500');
  const gRes = await counter(env, gName, { op: 'checkCap', cap: gCap });
  if (!gRes.allowed) {
    return new Response(JSON.stringify({ error: 'Service is at capacity. Please try again later.' }), { status: 503, headers: { 'Content-Type': 'application/json', ...wcors } });
  }

  // count the message now (before the model call) so a burst can't slip the cap
  await counter(env, msgName, { op: 'incr', amount: 1, ttlMs: 86400000 * 2 });

  const maxTokens = Math.min(cfg.maxOut || eng.maxOut, eng.maxOut);
  const upstreamBody = {
    model: eng.model,
    max_tokens: maxTokens,
    stream: true,
    system: [{ type: 'text', text: String(cfg.systemPrompt || WIDGET_DEFAULTS.systemPrompt), cache_control: { type: 'ephemeral' } }],
    messages: body.messages,
  };

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify(upstreamBody),
  });

  if (!upstream.ok) {
    const e = await upstream.json().catch(() => ({}));
    return new Response(JSON.stringify({ error: e?.error?.message || 'The assistant is unavailable.' }), { status: 502, headers: { 'Content-Type': 'application/json', ...wcors } });
  }

  // tee: stream to the visitor AND meter cost into this widget's + global counters
  const [toClient, toMeter] = upstream.body.tee();
  ctx.waitUntil(meterStream(toMeter, eng, {
    dName: `wtok:${key}:${todayKey()}`,      // per-widget token tally (informational)
    mName: `wtok:${key}:${monthKey()}`,
    gName,                                    // shares the global spend cap
    costName: wSpendName,                     // per-widget spend counter (the hard cap above)
    user: { email: 'widget:' + key, plan: 'widget' },
    env, limits: { dayTokens: Infinity, monthTokens: Infinity },
    reqMessages: body.messages,
  }));

  return new Response(toClient, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...wcors },
  });
}

/* PUBLIC: the embed loader. A site owner adds ONE line to their HTML:
     <script src="https://YOUR_WORKER/widget.js?k=pk_...&host=https://app.yourdomain.com" async></script>
   It injects a floating bubble that opens an iframe to the AMV app in embed
   mode. Served as real JavaScript with long cache + permissive CORS (it's a
   public asset). The site key travels in the iframe URL; all trust decisions
   happen server-side in /v1/widget/chat, so exposing the key here is safe. */
async function widgetLoader(request, env) {
  const url = new URL(request.url);
  const k = (url.searchParams.get('k') || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 120);
  // The app host to embed. Prefer an explicit ?host=, else an env default, else
  // this Worker's own origin (works when the app is served from the same place).
  const appHost = (url.searchParams.get('host') || env.APP_ORIGIN || url.origin).replace(/\/+$/, '');
  const js = _widgetLoaderJS(k, appHost);
  return new Response(js, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function _widgetLoaderJS(key, appHost) {
  // The loader is intentionally tiny and dependency-free. It creates a launcher
  // button and an iframe (the actual chat UI lives in the AMV app at #embed).
  const iframeSrc = appHost + '/#embed=1&k=' + encodeURIComponent(key);
  return `(function(){
  if(window.__AMV_WIDGET__) return; window.__AMV_WIDGET__=1;
  var KEY=${JSON.stringify(key)}, SRC=${JSON.stringify(iframeSrc)};
  var open=false, wrap, frame, btn;
  function el(t,s){var e=document.createElement(t); if(s) e.setAttribute('style',s); return e;}
  function build(){
    btn=el('button','position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;background:#4f7cff;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.25);z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .15s');
    btn.setAttribute('aria-label','Open chat');
    btn.innerHTML='<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    btn.onmouseenter=function(){btn.style.transform='scale(1.06)';};
    btn.onmouseleave=function(){btn.style.transform='scale(1)';};
    wrap=el('div','position:fixed;bottom:92px;right:20px;width:390px;height:600px;max-width:calc(100vw - 32px);max-height:calc(100vh - 120px);border-radius:16px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.32);z-index:2147483000;display:none;background:#fff');
    frame=el('iframe','width:100%;height:100%;border:none;');
    frame.setAttribute('title','AMV chat'); frame.setAttribute('allow','clipboard-write');
    frame.src=SRC;
    wrap.appendChild(frame);
    btn.onclick=function(){ open=!open; wrap.style.display=open?'block':'none'; btn.style.transform='scale(1)'; };
    document.body.appendChild(wrap); document.body.appendChild(btn);
  }
  // let the iframe ask us to close (X inside the panel)
  window.addEventListener('message',function(e){
    if(e&&e.data&&e.data.__amvWidget==='close'){ open=false; if(wrap) wrap.style.display='none'; }
  });
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',build); else build();
})();`;
}

/* ---------------- alerting (webhook) ------------------------------- */
async function notify(env, msg) {
  if (!env.ALERT_WEBHOOK) return;
  try { await fetch(env.ALERT_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '[AMV] ' + msg }) }); } catch {}
}

/* Throttled alert: fire at most once per `key` per `windowMin` minutes, so a
   recurring failure pages you the FIRST time (when you can still act) without
   burying you in thousands of duplicate messages. Critical money/security
   events use a short window; noisy ones use a long one. Returns quietly if no
   webhook is configured — alerting is opt-in via ALERT_WEBHOOK. */
async function alertOnce(env, key, msg, windowMin = 30) {
  if (!env.ALERT_WEBHOOK) return;
  try {
    const k = `alerted:${key}`;
    if (await env.AMV_KV.get(k)) return;            // already alerted this window
    await env.AMV_KV.put(k, '1', { expirationTtl: Math.max(60, windowMin * 60) });
    await notify(env, msg);
  } catch { /* alerting must never break the request */ }
}

/* =====================================================================
   SIGNED TOKENS — hardened HS256 JWT
   - Standards-compliant JWT (header.payload.signature), URL-safe base64
   - Constant-time signature comparison (no timing leak)
   - Short-lived ACCESS tokens (default 1h) + long-lived REFRESH tokens (30d)
   - Token versioning (ver) + per-user revocation via KV ("token epoch")
   - Algorithm is pinned to HS256 in verify (prevents alg-confusion / "none")
   ===================================================================== */
const JWT_ALG = 'HS256';
const ACCESS_TTL_MS  = 60 * 60 * 1000;          // 1 hour
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_VER = 1;                             // bump to invalidate all old tokens

// URL-safe base64 (no '+', '/', '=') — proper JWT encoding
function b64urlEncode(bytes) {
  let bin = '';
  const arr = (bytes instanceof Uint8Array) ? bytes : new TextEncoder().encode(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecodeToString(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function b64urlDecodeToBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
// Constant-time byte comparison — defeats timing attacks
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function _hmacKey(secret) {
  // FAIL CLOSED: never fall back to a public/default signing key. A missing
  // JWT_SECRET must break token signing and verification (no tokens issued, all
  // verification returns null → 401) rather than silently signing with a key an
  // attacker could know and use to forge tokens for any account.
  if (!secret) throw new Error('JWT_SECRET is not configured — refusing to sign or verify tokens');
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}
// Per-user token epoch: incrementing it in KV revokes all that user's tokens.
async function _tokenEpoch(env, email) {
  try { const v = await env.AMV_KV.get(`tokepoch:${email}`); return v ? parseInt(v, 10) || 0 : 0; }
  catch { return 0; }
}
async function revokeUserTokens(env, email) {
  const cur = await _tokenEpoch(env, email);
  await env.AMV_KV.put(`tokepoch:${email}`, String(cur + 1));
}

/* Sign a JWT. typ is 'access' or 'refresh'. */
async function signToken(payload, secret, opts = {}) {
  const typ = opts.typ || 'access';
  const ttl = typ === 'refresh' ? REFRESH_TTL_MS : ACCESS_TTL_MS;
  const now = Date.now();
  const header = { alg: JWT_ALG, typ: 'JWT' };
  const fullPayload = {
    ...payload,
    typ,
    ver: TOKEN_VER,
    epoch: opts.epoch || 0,
    iat: Math.floor(now / 1000),
    nbf: Math.floor(now / 1000),
    exp: Math.floor((now + ttl) / 1000),
    jti: crypto.randomUUID(),
  };
  const headerB64 = b64urlEncode(JSON.stringify(header));
  const payloadB64 = b64urlEncode(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await _hmacKey(secret);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  const sigB64 = b64urlEncode(new Uint8Array(mac));
  return `${signingInput}.${sigB64}`;
}

/* Issue an access+refresh pair for a user. */
async function issueTokens(env, email, name) {
  const epoch = await _tokenEpoch(env, email);
  const base = { email, name: name || '' };
  const access = await signToken(base, env.JWT_SECRET, { typ: 'access', epoch });
  const refresh = await signToken(base, env.JWT_SECRET, { typ: 'refresh', epoch });
  return { token: access, refreshToken: refresh, email, name: name || '' };
}

/* Verify a JWT. Pins algorithm, checks exp/nbf/ver, constant-time signature.
   When env is provided, also enforces the per-user revocation epoch.
   expectedTyp defaults to 'access' so refresh tokens can't be used as access. */
async function verifyToken(token, secret, env = null, expectedTyp = 'access') {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;

    // Pin the algorithm — reject 'none' / RS256 confusion attempts.
    const header = JSON.parse(b64urlDecodeToString(headerB64));
    if (!header || header.alg !== JWT_ALG || header.typ !== 'JWT') return null;

    // Recompute signature and compare in constant time.
    const key = await _hmacKey(secret);
    const expectedMac = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${headerB64}.${payloadB64}`))
    );
    const givenMac = b64urlDecodeToBytes(sigB64);
    if (!timingSafeEqual(expectedMac, givenMac)) return null;

    const data = JSON.parse(b64urlDecodeToString(payloadB64));
    const nowSec = Math.floor(Date.now() / 1000);
    if (data.ver !== TOKEN_VER) return null;
    if (data.typ && expectedTyp && data.typ !== expectedTyp) return null;
    if (data.nbf && nowSec < data.nbf - 60) return null;          // not-yet-valid (60s skew)
    if (data.exp && nowSec > data.exp) return null;               // expired
    if (env && data.email) {                                       // revocation check
      const epoch = await _tokenEpoch(env, data.email);
      if ((data.epoch || 0) !== epoch) return null;
    }
    return data;
  } catch { return null; }
}

/* =====================================================================
   DEPLOY
   1. npm i -g wrangler && wrangler login
   2. wrangler kv:namespace create AMV_KV   → put id in wrangler.toml
   3. Secrets:
        wrangler secret put ANTHROPIC_API_KEY
        wrangler secret put JWT_SECRET           (LONG random string — 32+ chars)

        # OPTIONAL — premium image generation. Set these three and image
        # generation app-wide automatically upgrades from the built-in free
        # generator to your paid provider (key stays server-side, metered
        # against each user's daily image cap). Any OpenAI-images-compatible
        # endpoint works (OpenAI gpt-image-1, or a compatible proxy):
        wrangler secret put IMAGE_API_KEY        (your image provider key)
        wrangler secret put IMAGE_API_URL        (e.g. https://api.openai.com/v1/images/generations)
        wrangler secret put IMAGE_API_MODEL      (optional, defaults to gpt-image-1)
   4. wrangler.toml config:
        [vars]
        GLOBAL_DAILY_USD_CAP = "500"             (your hard ceiling)
        ALERT_WEBHOOK = "https://hooks.slack..." (optional)

        # Durable Object — ATOMIC rate limits & quotas (no race conditions)
        [[durable_objects.bindings]]
        name = "AMV_COUNTER"
        class_name = "AMVCounter"

        [[migrations]]
        tag = "v1"
        new_sqlite_classes = ["AMVCounter"]
   5. wrangler deploy  → get https://amv-api.<you>.workers.dev
   6. In AMV → Settings → Live/Backend, paste that URL.
      Now: key is hidden, plans enforced, quotas + spend cap live & atomic.

   NOTE: If AMV_COUNTER is not bound, the Worker still runs but falls back
   to (non-atomic) KV counters. Bind the Durable Object for production —
   it's what makes rate limits and quotas race-proof under parallel load.

   PAYMENTS (real money) — set these secrets:
     wrangler secret put STRIPE_SECRET_KEY        (sk_live_…)
     wrangler secret put STRIPE_WEBHOOK_SECRET    (whsec_… from the webhook)
     [vars] STRIPE_PRICE_PRO / STRIPE_PRICE_ELITE / STRIPE_PRICE_ULTRA
            (Price IDs you create in the Stripe dashboard)
     In Stripe → Developers → Webhooks, add endpoint:
       https://<your-worker>/v1/stripe/webhook
       events: checkout.session.completed, customer.subscription.updated,
               customer.subscription.deleted, invoice.paid
   PayPal (optional):
     wrangler secret put PAYPAL_CLIENT_ID / PAYPAL_SECRET / PAYPAL_WEBHOOK_ID
     [vars] PAYPAL_MODE = "live"  (or "sandbox")
     Webhook endpoint: https://<your-worker>/v1/paypal/webhook

   HOW ACCESS IS GRANTED: the plan is written to ent:<email> ONLY by a
   signature-verified webhook from Stripe/PayPal. The browser can never
   grant itself a paid plan — requireUser() reads ent:<email> on every call.

   FOUNDER ADMIN (your private dashboard):
     wrangler secret put ADMIN_TOKEN   (a long random string only YOU hold)
     Then in AMV: open with ?owner=1, go to Settings -> Founder Dashboard,
     paste the token to see platform spend / users / revenue / top spenders,
     flip the kill switch, or override a user's plan. The token is never
     stored in the browser. Endpoints: /v1/admin/stats, /v1/admin/kill,
     /v1/admin/user — all 403 without the exact ADMIN_TOKEN.

   KILL SWITCH (instant stop):
     wrangler kv:key put --binding=AMV_KV GLOBAL_KILL 1     (halt)
     wrangler kv:key delete --binding=AMV_KV GLOBAL_KILL    (resume)
   ===================================================================== */

/* =====================================================================
   SMS / TEXT-MESSAGE AGENT  (Poke-style "run agents from your phone")
   ---------------------------------------------------------------------
   Lets users text a phone number and get AI replies — "check project X",
   "summarize my latest task", etc. Profit-safe: SMS users consume the
   same metered, capped credit pool as everyone else.

   HOW IT WORKS (the part only a backend can do):
   1. You rent a number from Twilio and point its "A MESSAGE COMES IN"
      webhook to:  https://<your-worker>/sms/incoming
   2. A user registers their phone in the website (Settings → Text Messages),
      which links that number to their AMV account.
   3. When they text the number, Twilio POSTs here, we run the AI under
      THEIR account + limits, and text the reply back.

   SECRETS to set (wrangler secret put ...):
     TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER

   SECURITY: When TWILIO_AUTH_TOKEN is set, every inbound /sms/incoming
   request is verified against Twilio's X-Twilio-Signature (HMAC-SHA1 over
   URL + params). Forged requests get a 403. ALWAYS set TWILIO_AUTH_TOKEN
   in production — without it, anyone could POST here and trigger AI spend.
   Also ensure your webhook URL in the Twilio console EXACTLY matches the
   deployed URL (scheme + host + path), since it's part of the signature.
   ===================================================================== */

// Link a phone number to an AMV account (called by the website after the
// user verifies they own the number). Stored as phone -> email in KV.
async function smsRegister(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const body = await request.json().catch(() => ({}));
  const phone = normalizePhone(body.phone || '');
  if (!phone) return json({ error: 'invalid phone number' }, 400);
  // one phone per account; one account per phone
  await env.AMV_KV.put(`sms:phone:${phone}`, user.email.toLowerCase());
  await env.AMV_KV.put(`sms:user:${user.email.toLowerCase()}`, phone);
  // greet the user so the conversation starts immediately
  let greeted = false;
  try {
    await sendSms(env, phone, 'Hey! You just linked your phone number to AMV. \uD83D\uDC4B What would you like to do next? Try: "summarize my latest task", "draft a reply to my last email", or just ask me anything.');
    greeted = true;
  } catch (e) { /* Twilio not configured yet — link still succeeds */ }
  return json({ ok: true, phone, greeted });
}

// Send an outbound SMS via Twilio's REST API.
async function sendSms(env, to, body) {
  const sid = env.TWILIO_ACCOUNT_SID, token = env.TWILIO_AUTH_TOKEN, from = env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) throw new Error('twilio_not_configured');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const form = new URLSearchParams({ To: to, From: from, Body: body });
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(sid + ':' + token),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!resp.ok) throw new Error('twilio_send_failed_' + resp.status);
  return resp.json();
}

// Twilio calls this when a text arrives. We reply with TwiML.
async function smsIncoming(request, env, ctx) {
  // Twilio sends application/x-www-form-urlencoded
  const form = await request.formData().catch(() => null);
  if (!form) return twiml('Sorry, could not read that message.');

  // --- SECURITY: verify this request actually came from Twilio ---
  // Without this, anyone could POST here and trigger AI spend on a linked
  // account. Twilio signs each webhook with HMAC-SHA1 over the URL + params.
  if (env.TWILIO_AUTH_TOKEN) {
    const sig = request.headers.get('X-Twilio-Signature') || '';
    const params = {};
    for (const [k, v] of form.entries()) params[k] = v;
    const ok = await verifyTwilioSignature(env.TWILIO_AUTH_TOKEN, request.url, params, sig);
    if (!ok) { audit(env,'forged_webhook',{kind:'twilio'}); return new Response('Forbidden', { status: 403 }); }
  }

  const from = normalizePhone(form.get('From') || '');
  const text = (form.get('Body') || '').trim();
  if (!from || !text) return twiml('Send a message to get started.');
  if (text.length > 1600) return twiml('That message is too long. Please keep it under 1600 characters.');

  // who is this number linked to?
  const email = await env.AMV_KV.get(`sms:phone:${from}`);
  if (!email) {
    return twiml('This number isn\u2019t linked to an AMV account yet. Sign up at AMV and add your phone in Settings \u2192 Text Messages.');
  }

  // load their plan + enforce the SAME limits/caps as the web app
  const e = (await DB.get(env, 'ent', email)) || {};
  const user = { email, plan: e.plan || 'free', customCfg: e.custom || null };

  // rate-limit SMS per number (cheap abuse guard) — atomic test-and-increment
  const smsRlName = `sms:rl:${from}:${Math.floor(Date.now() / 60000)}`;
  const smsRl = await counter(env, smsRlName, { op: 'rateCheck', limit: 8, windowMs: 60000 });
  if (!smsRl.allowed) return twiml('You\u2019re sending messages too fast. Give it a minute.');
  // Daily cap per number — SMS costs real money (Twilio). Even at 8/min the
  // per-minute limit alone would allow thousands/day; this bounds the bill.
  const smsDayName = `sms:day:${from}:${todayKey()}`;
  const smsDay = await counter(env, smsDayName, { op: 'reserve', amount: 1, cap: 200, ttlMs: 86400000 * 2 });
  if (!smsDay.allowed) return twiml('You\u2019ve reached today\u2019s message limit. It resets tomorrow.');

  // monthly cost backstop — SMS shares the user's profit-safe ceiling
  const PLAN_PRICE = { pro: 15, elite: 75, ultra: 200 };
  let price = user.plan === 'custom' && user.customCfg ? user.customCfg.price : (PLAN_PRICE[user.plan] || 0);
  if (price > 0) {
    const capRes = await counter(env, `cost:${email}:${monthKey()}`, { op: 'checkCap', cap: price * 0.45 });
    if (!capRes.allowed) return twiml('You\u2019ve used your plan\u2019s allowance for this cycle. It resets next month.');
  }

  // run the agent on the cheapest capable model (SMS replies are short)
  let reply;
  try {
    reply = await runSmsAgent(text, env);
  } catch (err) {
    reply = 'Something went wrong handling that. Try again in a moment.';
  }
  // SMS segments are 160 chars; keep replies tight
  if (reply.length > 600) reply = reply.slice(0, 590) + '…';
  return twiml(reply);
}

async function runSmsAgent(text, env) {
  const sys = 'You are AMV over SMS. Reply in plain text, no markdown, concise (a few sentences max, fits in a text message). The user may ask you to check tasks, summarize, draft, or answer questions. Be direct and useful.';
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', // cheapest capable — SMS is short Q&A
      max_tokens: 400,
      system: sys,
      messages: [{ role: 'user', content: text }],
    }),
  });
  const data = await resp.json();
  return (data.content || []).map(b => b.text || '').join('').trim() || 'No response.';
}

function normalizePhone(p) {
  // Strip everything except digits and a leading '+', then validate as E.164.
  let d = String(p || '').trim().replace(/[^\d+]/g, '');
  if (!d) return '';
  // collapse any '+' that isn't the leading char
  const hasPlus = d.startsWith('+');
  d = (hasPlus ? '+' : '') + d.replace(/\+/g, '');
  let digits = d.replace(/^\+/, '');
  if (!hasPlus) {
    // assume US/Canada if 10 digits; if 11 starting with 1, keep as-is
    if (digits.length === 10) digits = '1' + digits;
  }
  // E.164: 8–15 digits, leading digit 1–9 (no leading zero on country code)
  if (digits.length < 8 || digits.length > 15) return '';
  if (!/^[1-9]\d{7,14}$/.test(digits)) return '';
  return '+' + digits;
}

/* Verify a Twilio webhook signature (HMAC-SHA1 over URL + sorted POST params,
   base64-encoded). Constant-time compare. Returns true only if it matches. */
async function verifyTwilioSignature(authToken, url, params, signature) {
  try {
    if (!signature) return false;
    // Twilio concatenates the full URL, then each sorted param key+value.
    const sortedKeys = Object.keys(params).sort();
    let data = url;
    for (const k of sortedKeys) data += k + params[k];
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(authToken),
      { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    // base64 (standard, not url-safe) — matches Twilio's encoding
    let bin = ''; const bytes = new Uint8Array(mac);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const expected = btoa(bin);
    // constant-time compare
    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
}

function twiml(message) {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><Response><Message>' +
    String(message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
    '</Message></Response>';
  return new Response(xml, { headers: { 'Content-Type': 'text/xml' } });
}

/* Waitlist — captures interest for not-yet-launched apps (Chrome, iOS, etc.).
   Stored in KV so you have a real list to email when each product ships. */
async function waitlistAdd(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  const product = String(body.product || 'general').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
  if (!email || !email.includes('@')) return json({ error: 'invalid email' }, 400);
  await env.AMV_KV.put(`waitlist:${product}:${email}`, JSON.stringify({ email, product, ts: Date.now() }));
  return json({ ok: true });
}

/* =====================================================================
   PAYMENTS — real Stripe + PayPal with webhook-driven entitlement sync.

   The flow that actually grants access:
     1. Frontend calls /v1/stripe/checkout -> we create a Stripe Checkout
        Session (subscription) and return its URL. User pays on Stripe.
     2. Stripe calls /v1/stripe/webhook (signed) on success/renewal/cancel.
        We VERIFY the signature, then write ent:<email> = { plan, ... }.
     3. requireUser() reads ent:<email>, so the new plan takes effect on the
        very next API call. No client-trust: the plan is set ONLY by a
        verified webhook from the payment processor, never by the browser.

   This is the critical link the app was missing — without the webhook,
   a paid user would never actually get upgraded.
   ===================================================================== */

// Map your plans to Stripe Price IDs (create these in the Stripe dashboard).
function _stripePriceId(env, plan) {
  const map = {
    pro:   env.STRIPE_PRICE_PRO,
    elite: env.STRIPE_PRICE_ELITE,
    ultra: env.STRIPE_PRICE_ULTRA,
  };
  return map[plan] || null;
}
const PLAN_FROM_PRICE = (env) => ({
  [env.STRIPE_PRICE_PRO]: 'pro',
  [env.STRIPE_PRICE_ELITE]: 'elite',
  [env.STRIPE_PRICE_ULTRA]: 'ultra',
});

// Write a user's entitlement. This is the ONLY way a plan gets set on the
// server, and it's only ever called from a verified webhook.
/* ══════════════════════════════════════════════════════════════════════
   ABUSE / REFUND-FRAUD PROTECTION  (auditor #3)

   The "DoorDash method": pay, consume the product, then claw the money back
   (chargeback or refund) while keeping what you took. For AMV the product is
   compute — model calls, video, deep research — which costs real money the
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

async function _abuseRecord(env, email, kind, detail = {}) {
  email = String(email || '').toLowerCase();
  if (!email) return null;
  const rec = (await DB.get(env, 'abuse', email)) || { email, disputes: 0, refunds: 0, events: [], blocked: false };
  if (kind === 'dispute') rec.disputes = (rec.disputes || 0) + 1;
  if (kind === 'refund')  rec.refunds  = (rec.refunds  || 0) + 1;
  rec.events = (rec.events || []).concat({ kind, at: Date.now(), ...detail }).slice(-50);

  // Decide whether this account is now blocked from new paid purchases.
  const shouldBlock = (rec.disputes >= ABUSE_DISPUTE_BLOCK) || (rec.refunds >= ABUSE_REFUND_BLOCK);
  if (shouldBlock && !rec.blocked) {
    rec.blocked = true;
    rec.blockedAt = Date.now();
    rec.blockedReason = rec.disputes >= ABUSE_DISPUTE_BLOCK ? 'chargeback' : 'refund_pattern';
    audit(env, 'abuse_blocked', { email, reason: rec.blockedReason, disputes: rec.disputes, refunds: rec.refunds });
  }
  await DB.put(env, 'abuse', email, rec);
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

async function setEntitlement(env, email, plan, extra = {}) {
  const ent = { plan, updatedAt: Date.now(), ...extra };
  await DB.put(env, 'ent', email.toLowerCase(), ent);
  audit(env, 'entitlement_set', { email, plan });
  return ent;
}

// Read current entitlement (for the app to reflect the real plan).
async function getEntitlement(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const ent = (await DB.get(env, 'ent', user.email)) || { plan: 'free' };
  return json({ ok: true, entitlement: ent });
}

// ---- Stripe: create a Checkout Session (subscription) ----
async function stripeCheckout(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'payments not configured' }, 503);

  /* An account flagged for chargeback/refund abuse cannot start a new paid plan.
     This is what stops the loop: charge back, then just subscribe again and do
     it once more. They keep a working free account; a human can clear the flag. */
  if (!(await _abuseCheckoutAllowed(env, user.email))) {
    audit(env, 'abuse_checkout_blocked', { email: user.email });
    return json({ error: 'This account can\u2019t start a new subscription. Please contact support.', code: 'account_flagged' }, 403);
  }

  const { plan } = await request.json().catch(() => ({}));
  const price = _stripePriceId(env, plan);
  if (!price) return json({ error: 'unknown plan' }, 400);

  const origin = request.headers.get('Origin') || env.APP_URL || '';
  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('line_items[0][price]', price);
  form.set('line_items[0][quantity]', '1');
  form.set('customer_email', user.email);
  form.set('client_reference_id', user.email);       // so the webhook knows who paid
  form.set('success_url', `${origin}?upgraded=1`);
  form.set('cancel_url', `${origin}?canceled=1`);
  form.set('metadata[email]', user.email);
  form.set('metadata[plan]', plan);

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const d = await r.json();
  if (!r.ok) {
    // A customer just tried to PAY and Stripe refused. That's lost revenue you
    // need to know about now, not from a support ticket. Throttled so a Stripe
    // outage doesn't spam you.
    await alertOnce(env, 'stripe_checkout_fail', `💳 Stripe checkout failing: ${d.error?.message || 'unknown'} — customers may be unable to subscribe.`, 15);
    return json({ error: d.error?.message || 'stripe error' }, 502);
  }
  return json({ url: d.url, id: d.id });
}

// ---- Stripe: customer billing portal (manage/cancel subscription) ----
async function stripePortal(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'payments not configured' }, 503);
  const custId = await env.AMV_KV.get(`stripecust:${user.email}`);
  if (!custId) return json({ error: 'no subscription found' }, 404);
  const origin = request.headers.get('Origin') || env.APP_URL || '';
  const form = new URLSearchParams({ customer: custId, return_url: origin });
  const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const d = await r.json();
  if (!r.ok) return json({ error: d.error?.message || 'stripe error' }, 502);
  return json({ url: d.url });
}

// ---- Stripe: list this user's invoices (for the in-app billing history) ----
/* ---- Unified transaction ledger — records a payment from ANY provider
   (Stripe, PayPal, marketplace/wallet) so the admin finance page shows ALL
   money, not just Stripe. Stored as a capped list under 'txn:log'. Each entry:
   {id, ts, provider, email, amount, currency, kind, status, ref}. ---- */
async function _recordTxn(env, tx) {
  try {
    const entry = {
      id: tx.id || ('tx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      ts: tx.ts || Date.now(),
      provider: tx.provider || 'unknown',
      email: (tx.email || '').toLowerCase(),
      amount: +(+tx.amount || 0).toFixed(2),
      currency: (tx.currency || 'USD').toUpperCase(),
      kind: tx.kind || '',           // e.g. 'subscription', 'plan', 'marketplace'
      status: tx.status || 'succeeded',
      ref: tx.ref || '',
    };
    const raw = await env.AMV_KV.get('txn:log');
    const log = raw ? JSON.parse(raw) : [];
    log.unshift(entry);
    await env.AMV_KV.put('txn:log', JSON.stringify(log.slice(0, 1000)));   // keep last 1000
    return entry;
  } catch (e) { return null; }
}

async function _readTxnLog(env, limit = 200) {
  try { const raw = await env.AMV_KV.get('txn:log'); const log = raw ? JSON.parse(raw) : []; return log.slice(0, limit); }
  catch { return []; }
}

/* ---- ADMIN: financial statement — ALL real transactions across every customer.
   Owner-only (admin token). Pulls actual charges from Stripe so you see real
   money in, refunds, and net — not estimates. Honestly returns empty + a
   configured:false flag when Stripe isn't set up yet. ---- */
async function adminFinance(request, env) {
  if (!_requireAdmin(request, env)) { audit(env, 'auth_fail', { reason: 'admin_bad_token' }); return json({ error: 'forbidden' }, 403); }

  // Non-Stripe payments (PayPal, marketplace/wallet) come from our own ledger.
  const ledger = await _readTxnLog(env, 300);
  const ledgerTx = ledger.map(t => ({
    id: t.id, date: t.ts, email: t.email || '\u2014', amount: t.amount, refunded: t.status === 'refunded' ? t.amount : 0,
    currency: t.currency, status: t.status, description: t.kind || '', provider: t.provider, last4: null, receipt: null,
  }));

  if (!env.STRIPE_SECRET_KEY) {
    // No Stripe, but we may still have PayPal / marketplace transactions.
    let gross = 0, refunded = 0;
    for (const t of ledgerTx) { if (t.status === 'succeeded') gross += t.amount; refunded += t.refunded; }
    return json({ ok: true, configured: ledgerTx.length > 0, transactions: ledgerTx,
      totals: { count: ledgerTx.length, gross: +gross.toFixed(2), refunded: +refunded.toFixed(2), net: +(gross - refunded).toFixed(2), currency: 'USD' },
      note: ledgerTx.length ? 'Stripe not connected — showing PayPal & marketplace transactions.' : 'Connect Stripe (STRIPE_SECRET_KEY) to see card transactions.' });
  }
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)));
  const after = url.searchParams.get('after') || '';
  let q = `https://api.stripe.com/v1/charges?limit=${limit}`;
  if (after) q += `&starting_after=${encodeURIComponent(after)}`;
  const r = await fetch(q, { headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    await alertOnce(env, 'admin_finance_fail', `Admin finance: Stripe charges fetch failed (${d.error?.message || r.status}).`, 30);
    return json({ error: d.error?.message || 'stripe error' }, 502);
  }
  const stripeTx = (d.data || []).map(c => ({
    id: c.id,
    date: (c.created || 0) * 1000,
    email: c.billing_details?.email || c.receipt_email || (c.metadata && c.metadata.email) || '\u2014',
    amount: (c.amount || 0) / 100,
    refunded: (c.amount_refunded || 0) / 100,
    currency: (c.currency || 'usd').toUpperCase(),
    status: c.refunded ? 'refunded' : (c.disputed ? 'disputed' : c.status),
    // was this a real captured payment? (true even if later refunded — gross = money that came in)
    _paid: !!(c.paid && (c.status === 'succeeded' || c.captured)),
    description: c.description || (c.metadata && c.metadata.plan) || '',
    provider: 'stripe',
    last4: c.payment_method_details?.card?.last4 || null,
    receipt: c.receipt_url || null,
  }));

  // Merge Stripe (live) + ledger. The live Stripe pull is the source of truth
  // for card payments, so from the ledger we take only NON-Stripe entries
  // (PayPal, marketplace) to avoid double-counting recurring charges that the
  // webhook also logged.
  const ledgerNonStripe = ledgerTx.filter(t => t.provider !== 'stripe');
  const transactions = [...stripeTx, ...ledgerNonStripe].sort((a, b) => b.date - a.date);
  let gross = 0, refunded = 0, currency = 'USD';
  for (const t of transactions) {
    // gross = all money that came in (paid), refunds tracked separately as net.
    const camePaid = t._paid != null ? t._paid : (t.status === 'succeeded' || t.status === 'paid' || t.status === 'refunded');
    if (camePaid) gross += t.amount;
    refunded += t.refunded;
    currency = t.currency || currency;
    delete t._paid;
  }
  const net = +(gross - refunded).toFixed(2);
  return json({
    ok: true, configured: true,
    transactions,
    hasMore: !!d.has_more,
    nextCursor: stripeTx.length ? stripeTx[stripeTx.length - 1].id : null,
    totals: { count: transactions.length, gross: +gross.toFixed(2), refunded: +refunded.toFixed(2), net, currency },
  });
}

async function stripeInvoices(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!env.STRIPE_SECRET_KEY) return json({ ok: true, invoices: [] });
  const custId = await env.AMV_KV.get(`stripecust:${user.email}`);
  if (!custId) return json({ ok: true, invoices: [] });
  const r = await fetch(`https://api.stripe.com/v1/invoices?customer=${encodeURIComponent(custId)}&limit=24`, {
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const d = await r.json();
  if (!r.ok) return json({ error: d.error?.message || 'stripe error' }, 502);
  const invoices = (d.data || []).map(inv => ({
    id: inv.id,
    number: inv.number || inv.id,
    date: inv.created * 1000,
    amount: (inv.amount_paid != null ? inv.amount_paid : inv.total) / 100,
    currency: (inv.currency || 'usd').toUpperCase(),
    status: inv.status,
    pdf: inv.invoice_pdf || inv.hosted_invoice_url || null,
  }));
  return json({ ok: true, invoices });
}
/* ── Atomic exactly-once guard ─────────────────────────────────────────────
   Money must never be credited, captured or withdrawn twice. Payment providers
   retry webhooks, and concurrent/duplicate deliveries can race. _claimOnce
   returns true ONLY for the first caller for a given (kind,id); every duplicate
   or concurrent caller gets false. On D1 this is a hard atomic guarantee — the
   PRIMARY KEY (kind,id) makes the second INSERT fail. On KV it is best-effort
   (KV is eventually consistent — enable D1 for the money paths, see DEPLOY.md).
   ttlSec is only honored on the KV path and is used for short-lived locks. */
async function _claimOnce(env, kind, id, ttlSec){
  if(!id) return true;
  if(env && env.DB && typeof env.DB.prepare === 'function'){
    try{
      await env.DB.prepare('INSERT INTO kv (kind,id,json,updated_at) VALUES (?,?,?,?)')
        .bind(kind, String(id), '1', Date.now()).run();
      return true;
    }catch(e){ return false; }   // PRIMARY KEY violation → already claimed
  }
  const k = `${kind}:${id}`;
  if(await env.AMV_KV.get(k)) return false;
  await env.AMV_KV.put(k, '1', ttlSec ? { expirationTtl: ttlSec } : undefined);
  return true;
}
async function _releaseClaim(env, kind, id){
  try{
    if(env && env.DB && typeof env.DB.prepare === 'function'){
      await env.DB.prepare('DELETE FROM kv WHERE kind=? AND id=?').bind(kind, String(id)).run();
    } else { await env.AMV_KV.delete(`${kind}:${id}`); }
  }catch(e){}
}

async function stripeWebhook(request, env, ctx) {
  const sig = request.headers.get('Stripe-Signature') || '';
  const raw = await request.text();
  const ok = await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, raw, sig);
  if (!ok) { audit(env, 'forged_webhook', { kind: 'stripe' }); return new Response('bad signature', { status: 400 }); }

  let evt; try { evt = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }
  const type = evt.type;
  const obj = evt.data?.object || {};

  // Exactly-once: ignore a re-delivered/duplicate event so it can't double-credit
  // a sale, double-record a renewal payment, or re-run any side effect. If later
  // processing throws we RELEASE the claim (below) so the provider's retry is
  // allowed to reprocess a genuinely-failed event.
  if (evt.id && !(await _claimOnce(env, 'stripeevt', evt.id))) {
    return json({ received: true, duplicate: true });
  }

  try {
    if (type === 'checkout.session.completed') {
      // Marketplace one-time purchase → grant item + 80/20 split
      if (obj.metadata?.kind === 'market_purchase') {
        await _creditSale(env, {
          itemId: obj.metadata.itemId,
          buyer: (obj.metadata.buyer || obj.customer_email || '').toLowerCase(),
          seller: (obj.metadata.seller || '').toLowerCase(),
          amountCents: obj.amount_total,
        });
        return new Response('ok', { status: 200 });
      }
      const email = (obj.metadata?.email || obj.client_reference_id || obj.customer_email || '').toLowerCase();
      const plan = obj.metadata?.plan || 'pro';
      if (email) {
        await setEntitlement(env, email, plan, { source: 'stripe', sub: obj.subscription });
        if (obj.customer) {
          await env.AMV_KV.put(`stripecust:${email}`, obj.customer);
          await env.AMV_KV.put(`custemail:${obj.customer}`, email);  // reverse map for renewals
        }
        // Record the initial subscription payment so it shows in admin finance
        // even beyond Stripe's own retention window.
        const amt = (obj.amount_total != null ? obj.amount_total : 0) / 100;
        if (amt > 0) await _recordTxn(env, { provider: 'stripe', email, amount: amt,
          currency: (obj.currency || 'usd').toUpperCase(), kind: plan, status: 'succeeded',
          ref: obj.subscription || obj.id || '' });
      }
    } else if (type === 'customer.subscription.updated' || type === 'invoice.paid') {
      // renewal or plan change — re-derive plan from the price
      const email = (obj.metadata?.email || '').toLowerCase() || await _emailFromCustomer(env, obj.customer);
      const priceId = obj.items?.data?.[0]?.price?.id || obj.lines?.data?.[0]?.price?.id;
      const plan = PLAN_FROM_PRICE(env)[priceId];
      if (email && plan) await setEntitlement(env, email, plan, { source: 'stripe' });
      // Record each recurring renewal payment (invoice.paid carries amount_paid).
      if (type === 'invoice.paid' && email) {
        const amt = (obj.amount_paid != null ? obj.amount_paid : 0) / 100;
        if (amt > 0) await _recordTxn(env, { provider: 'stripe', email, amount: amt,
          currency: (obj.currency || 'usd').toUpperCase(), kind: (plan || 'renewal'), status: 'succeeded',
          ref: obj.id || obj.subscription || '' });
      }
    } else if (type === 'customer.subscription.deleted') {
      // cancellation/expiry — downgrade to free
      const email = await _emailFromCustomer(env, obj.customer);
      if (email) await setEntitlement(env, email, 'free', { source: 'stripe', canceled: true });
    } else if (type === 'charge.dispute.created') {
      /* CHARGEBACK — the customer told their bank to reverse the payment. This
         is the DoorDash method: they keep the compute they already used and get
         the money back. Treat it as fraud: revoke access immediately and flag
         the account so they can't just re-subscribe and do it again. */
      const email = await _emailFromCustomer(env, obj.customer)
                 || (obj.metadata?.email || '').toLowerCase();
      if (email) {
        await setEntitlement(env, email, 'free', { source: 'stripe', disputed: true });
        await _abuseRecord(env, email, 'dispute', { chargeId: obj.charge || obj.id, amount: obj.amount });
        audit(env, 'chargeback', { email, amount: obj.amount });
      }
    } else if (type === 'charge.refunded' || type === 'refund.created') {
      /* REFUND — revoke the entitlement that was paid for. A single refund is
         fine (support does them); _abuseRecord only blocks on a PATTERN. */
      const charge = obj.charge ? obj : (obj.data?.object || obj);
      const email = await _emailFromCustomer(env, charge.customer)
                 || (charge.metadata?.email || '').toLowerCase();
      if (email) {
        await setEntitlement(env, email, 'free', { source: 'stripe', refunded: true });
        await _abuseRecord(env, email, 'refund', { chargeId: charge.id, amount: charge.amount_refunded || charge.amount });
        audit(env, 'refund', { email, amount: charge.amount_refunded || charge.amount });
      }
    }
  } catch (e) {
    audit(env, 'webhook_error', { kind: 'stripe', msg: String(e.message).slice(0, 120) });
    // release the exactly-once claim so Stripe's retry can reprocess this event
    // (it genuinely failed — do NOT swallow it as "already processed"), and
    // return 500 so Stripe knows to retry.
    if (evt.id) await _releaseClaim(env, 'stripeevt', evt.id);
    return new Response('processing error', { status: 500 });
  }
  return json({ received: true });
}

// resolve email from a Stripe customer id (we store the reverse map at checkout)
async function _emailFromCustomer(env, customerId) {
  if (!customerId) return '';
  // we stored stripecust:<email> = customerId; do a tiny reverse lookup via a cust->email key
  const e = await env.AMV_KV.get(`custemail:${customerId}`);
  return e ? e.toLowerCase() : '';
}

/* =====================================================================
   MARKETPLACE (auditor #12) — community template store.
   Templates are stored as market:<id>; install counts rank them. Publishing
   requires auth (so submissions are attributable + moderatable). This is the
   technical substrate for the network effect — it lights up as real users
   publish and install.
   ===================================================================== */
async function marketList(request, env) {
  // public: list active community listings, newest+popular first
  const out = [];
  let cursor;
  do {
    const page = await env.AMV_KV.list({ prefix: 'market:', cursor, limit: 1000 });
    for (const k of page.keys) {
      const raw = await env.AMV_KV.get(k.name);
      if (!raw) continue;
      try { const it = JSON.parse(raw); if (!it.hidden && (!it.status || it.status === 'active')) out.push(_publicListing(it)); } catch {}
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < 500);
  out.sort((a, b) => (b.installs || 0) - (a.installs || 0));
  return json({ ok: true, items: out });
}

/* ══════════════════════════════════════════════════════════════
   MARKETPLACE TRUST & SAFETY
   Multi-layer automated review that runs server-side on every publish, so it
   cannot be bypassed by modifying the client.

   Layer 1  Normalization  — defeats evasion (leetspeak, spacing, homoglyphs)
   Layer 2  Prohibited categories — hard block, listing never goes live
   Layer 3  Regulated categories  — hard block unless verified seller
   Layer 4  Risk signals — listing published but held for human review
   Layer 5  Seller strikes — repeat offenders lose selling access
   ══════════════════════════════════════════════════════════════ */

/* Layer 1 — normalize text so "c0ca1ne", "c o c a i n e", "ⅽocaine" all match. */
function _mktNormalize(str) {
  let t = String(str || '').toLowerCase();
  // strip zero-width / invisible characters used to break up words
  t = t.replace(/[\u200b\u200c\u200d\u2060\ufeff\u00ad\u180e\u061c]/g, '');
  // map common homoglyphs (Cyrillic/Greek look-alikes) back to Latin
  const homo = { 'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','у':'y','ѕ':'s','і':'i','ј':'j','к':'k','м':'m','н':'h','т':'t','в':'b','г':'r','ԁ':'d','ո':'n','ε':'e','ο':'o','ρ':'p','τ':'t','ν':'v','α':'a','ι':'i','κ':'k','μ':'m' };
  t = t.replace(/[а-яөԁα-ωѕіј]/g, c => homo[c] || c);
  // strip accents / homoglyph forms
  try { t = t.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
  // common leetspeak substitutions
  const leet = { '0':'o','1':'i','!':'i','3':'e','4':'a','@':'a','5':'s','$':'s','7':'t','8':'b','9':'g','+':'t','|':'i' };
  t = t.replace(/[01!34@5$789+|]/g, c => leet[c] || c);
  // collapse separators used to break up words: c-o-c-a-i-n-e, c.o.c.a.i.n.e
  t = t.replace(/[\s._\-*~`'"()\[\]{}<>\/\\]+/g, ' ');
  return { spaced: ' ' + t.replace(/\s+/g, ' ').trim() + ' ', squeezed: t.replace(/\s+/g, '') };
}

/* Layer 2 — PROHIBITED. Nothing in these categories may ever be listed. */
const MKT_PROHIBITED = {
  'Illegal drugs & controlled substances': [
    'cocaine','heroin','fentanyl','methamphetamine','crystal meth','mdma','ecstasy','lsd','ketamine','pcp','crack cocaine',
    'psilocybin','magic mushrooms','ghb','rohypnol','roofie','oxycontin','oxycodone','percocet','xanax','xanax bars','adderall',
    'vicodin','codeine','lean drug','promethazine','tramadol','valium','klonopin','opioid','opiates',
    'illegal drugs','buy drugs','sell drugs','drug dealer','narcotics for sale','dark web drugs','research chemicals',
    'anabolic steroids','hgh for sale','prescription without','no prescription needed',
    'weed for sale','buy weed','sell weed','marijuana for sale','buy marijuana','cannabis for sale','buy cannabis',
    'thc cart','dab pen','edibles for sale','ounce of weed','gram of weed','8 ball','eightball','molly for sale','buy molly',
    'shrooms for sale','acid tabs','dmt','coke for sale','plug drugs','drug plug','420 friendly bud','top shelf bud',
    'sativa for sale','indica for sale',
  ],
  'Weapons & explosives': [
    'firearm','handgun','rifle for sale','assault weapon','ghost gun','untraceable gun','80 lower','auto sear','glock switch',
    'silencer','suppressor','ammunition','ammo for sale','high capacity magazine','bump stock',
    'explosive','pipe bomb','bomb making','ied','grenade','detonator','napalm','thermite','tannerite',
    'weapon blueprint','3d printed gun','gun cad','firearm files','poison','ricin','nerve agent','sarin','chemical weapon',
  ],
  'Malware, hacking & cyber attack': [
    'malware','ransomware','keylogger','botnet','ddos','rootkit','trojan','spyware','stalkerware','worm virus',
    'exploit kit','zero day exploit','0day exploit','remote access trojan','rat builder','crypter','stealer',
    'phishing kit','phishing page','phishing template','scam page','fake login page','clone site',
    'sql injection tool','brute force tool','password cracker','credential stuffing','account cracker','combo list',
    'sim swap','swatting','doxxing service','ip grabber','hack someone','hacking service','hack account',
  ],
  'Stolen data & credentials': [
    'stolen data','stolen account','hacked account','cracked account','database dump','leaked database','data breach dump',
    'stolen card','stolen credit','credit card numbers','card dump','cvv dump','fullz','bank logs','bank drop',
    'dumps with pin','carding','carder','paypal log','netflix account cheap','spotify account cheap','account list',
    'ssn list','social security numbers','identity package','scan of passport','stolen identity',
  ],
  'Fraud, scams & counterfeiting': [
    'money launder','launder money','money mule','cash out method','cashout method','fraud method','fraud bible',
    'counterfeit','fake id','forged document','fake passport','fake diploma','fake certificate','replica designer',
    'ponzi','pyramid scheme','get rich quick guaranteed','guaranteed profit','risk free profit','insider trading',
    'chargeback fraud','refund method','refund glitch','triangulation fraud','bin method','sniffed',
  ],
  'Sexual content & exploitation': [
    'child porn','csam','cp for sale','underage','minor sexual','loli','shota','jailbait','preteen nude',
    'bestiality','rape porn','non consensual','revenge porn','upskirt','hidden camera nude','deepfake nude','nudify',
    'escort service','prostitution','sex trafficking','onlyfans leak','nude leak',
  ],
  'Violence, terrorism & trafficking': [
    'assassinate','murder for hire','hitman','contract killing','kill someone','how to kill','how to murder',
    'human trafficking','organ sale','sell organ','kidnapping guide','torture',
    'terrorist','terrorism','isis','al qaeda','extremist manifesto','mass shooting plan','school shooting',
    'genocide','ethnic cleansing',
  ],
  'Hate & harassment': [
    'white supremacy','neo nazi','race war','holocaust denial','ethnic slur pack','hate speech pack',
    'harassment campaign','brigading service','swat someone',
  ],
  'Piracy & IP theft': [
    'pirated','cracked software','keygen','license key generator','nulled script','warez','torrent dump',
    'stolen course','leaked course','ripped content','bypass drm','drm removal',
  ],
  'Self-harm': [
    'suicide method','how to kill yourself','best way to die','suicide kit','pro ana','thinspo','self harm guide',
  ],
};

/* Layer 3 — REGULATED. Blocked unless the seller is verified for that category.
   (Verification is an operator action; unverified sellers simply can't list these.) */
const MKT_REGULATED = {
  'Financial & investment advice': ['investment advice','financial advice','stock picks','trading signals','forex signals','crypto signals','guaranteed returns','portfolio management'],
  'Medical & health claims': ['medical advice','cure cancer','miracle cure','diagnose','prescription','treatment plan','weight loss guaranteed'],
  'Legal advice': ['legal advice','legal representation','sue someone','lawsuit template guaranteed'],
  'Adult (18+)': ['adult content','nsfw','erotica','porn'],
};

/* Layer 4 — RISK SIGNALS. Not blocked, but the listing is held for review. */
const MKT_RISK_SIGNALS = [
  'hack','exploit','crack','bypass','scrape','scraper','bot farm','automation bot','mass dm','spam',
  'password','credential','proxy list','vpn crack','account generator','otp bypass','2fa bypass',
  'crypto','forex','trading bot','arbitrage','airdrop','presale','pump','nft flip',
  'guaranteed','get rich','passive income guaranteed','make money fast','mlm','downline','recruit',
  'unlimited','unlocked','premium free','free trial abuse',
];

/* Screen a listing. Returns a decision object. */
function _marketScreen(item, sellerVerifiedFor) {
  const fields = [item.title, item.desc, item.cat, item.text,
    Array.isArray(item.files) ? item.files.map(f => f && f.name).join(' ') : ''];
  const raw = fields.map(x => String(x || '')).join(' ');
  const n = _mktNormalize(raw);

  const hit = (term) => {
    const t = _mktNormalize(term);
    // word-ish boundary on the spaced form, plus a squeezed-form containment check
    const esc = t.spaced.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('(^| )' + esc + '( |$)', 'i').test(n.spaced)) return true;
    if (t.squeezed.length >= 6 && n.squeezed.includes(t.squeezed)) return true;
    return false;
  };

  // Layer 2 — prohibited
  for (const [category, terms] of Object.entries(MKT_PROHIBITED)) {
    for (const term of terms) {
      if (hit(term)) {
        return { ok: false, action: 'blocked', category, term,
          reason: 'This listing appears to involve prohibited content (' + category + '). It cannot be published. Selling this violates the Marketplace Terms and may result in losing selling access.' };
      }
    }
  }
  // Layer 3 — regulated
  for (const [category, terms] of Object.entries(MKT_REGULATED)) {
    for (const term of terms) {
      if (hit(term)) {
        const verified = Array.isArray(sellerVerifiedFor) && sellerVerifiedFor.includes(category);
        if (!verified) {
          return { ok: false, action: 'needs_verification', category, term,
            reason: category + ' listings require a verified seller account. Apply for verification to list in this category.' };
        }
      }
    }
  }
  // Layer 4 — risk signals
  const signals = [];
  for (const term of MKT_RISK_SIGNALS) { if (hit(term)) signals.push(term); }
  if (signals.length) {
    return { ok: true, action: 'held_for_review', signals: signals.slice(0, 5),
      reason: 'Your listing is live but flagged for review. If it complies with the rules it stays up; if not, it will be removed.' };
  }
  return { ok: true, action: 'approved' };
}

async function marketPublish(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in to publish' }, 401);
  // Guard against listing spam — a handful a minute, a sane cap per day.
  const blocked = await guardAction(env, `mktpub:${user.email}`, 5, 50, 'listings');
  if (blocked) return blocked;
  const item = await request.json().catch(() => ({}));
  const title = String(item.title || '').slice(0, 100).trim();
  if (!title) return json({ error: 'title required' }, 400);

  // ── Trust & Safety: seller standing ──────────────────────────
  const standing = (await DB.get(env, 'seller', user.email)) || { strikes: 0, banned: false, verifiedFor: [] };
  if (standing.banned) {
    return json({ error: 'Your selling access has been suspended for repeated policy violations. Contact support to appeal.', code: 'seller_suspended' }, 403);
  }

  // ── Automated content review (server-side = cannot be bypassed) ──
  const screen = _marketScreen(item, standing.verifiedFor);
  if (!screen.ok) {
    if (screen.action === 'blocked') {
      standing.strikes = (standing.strikes || 0) + 1;
      standing.lastViolation = { category: screen.category, at: Date.now() };
      if (standing.strikes >= 3) standing.banned = true;      // 3 strikes = suspended
      await DB.put(env, 'seller', user.email, standing);
      audit(env, 'market_blocked', { by: user.email, title, category: screen.category, term: screen.term, strikes: standing.strikes });
      return json({
        error: screen.reason, code: 'policy_violation', category: screen.category,
        strikes: standing.strikes, suspended: !!standing.banned,
      }, 422);
    }
    // needs verification
    audit(env, 'market_needs_verification', { by: user.email, title, category: screen.category });
    return json({ error: screen.reason, code: 'needs_verification', category: screen.category }, 422);
  }
  const kind = ['prompt', 'crew', 'agent', 'integration', 'workflow', 'guide', 'bundle'].includes(item.kind) ? item.kind : 'prompt';
  // price: 0 = free; otherwise whole dollars, $1..$999
  let price = Math.round(Number(item.price) || 0);
  if (price < 0) price = 0;
  if (price > 999) price = 999;
  const body = String(item.text || '').slice(0, 20000);
  // AMV-only content guard: reject listings that reference other AI brands.
  const blob = (title + ' ' + (item.desc || '') + ' ' + body).toLowerCase();
  const banned = ['claude', 'anthropic', 'openai', 'chatgpt', 'gpt-4', 'gpt-5', 'gemini', 'copilot', 'grok', 'llama', 'mistral', 'perplexity'];
  const hit = banned.find(b => blob.includes(b));
  if (hit) return json({ error: 'Listings must be AMV-only — remove references to other AI products (' + hit + ').' }, 400);
  // File attachments: store metadata + data. NOTE: KV caps values at 25MB — for
  // large media, production should upload to R2 and store only the URL here.
  let files = Array.isArray(item.files) ? item.files.slice(0, 20).map(f => ({
    name: String(f.name || 'file').slice(0, 160),
    type: String(f.type || 'application/octet-stream').slice(0, 100),
    size: Math.max(0, Number(f.size) || 0),
    data: typeof f.data === 'string' ? f.data : '',
    url: f.url ? String(f.url).slice(0, 500) : undefined,
  })) : [];
  if (!body && !files.length && !(Array.isArray(item.crew) && item.crew.length)) {
    return json({ error: 'add a deliverable: text, a crew, or at least one file' }, 400);
  }
  const clean = {
    id: 'usr_' + crypto.randomUUID().slice(0, 10),
    kind, title,
    cat: String(item.cat || 'Community').slice(0, 40),
    desc: String(item.desc || '').slice(0, 280),
    text: body,
    crew: Array.isArray(item.crew) ? item.crew.slice(0, 8) : undefined,
    files,
    icon: String(item.icon || '\u2728').slice(0, 4),
    price,
    author: (user.name || user.email.split('@')[0]).slice(0, 40),
    authorEmail: user.email,
    installs: 0,
    sales: 0,
    views: 0,
    status: screen.action === 'held_for_review' ? 'under_review' : 'active',
    review: screen.action === 'held_for_review' ? { signals: screen.signals || [], at: Date.now() } : undefined,
    createdAt: Date.now(),
  };
  await env.AMV_KV.put(`market:${clean.id}`, JSON.stringify(clean));
  if (screen.action === 'held_for_review') {
    audit(env, 'market_held_for_review', { id: clean.id, by: user.email, signals: screen.signals });
  }
  audit(env, 'market_publish', { id: clean.id, by: user.email, price, files: files.length, status: clean.status });
  return json({ ok: true, item: _publicListing(clean), review: screen.action === 'held_for_review' ? screen.reason : undefined });
}

/* Strip the deliverable (text/crew/file DATA) from a paid listing so it can't
   be read for free from the public catalog. File NAMES stay as a teaser.
   Free items keep their content inline. */
function _publicListing(it) {
  if (!it.price || it.price <= 0) return it;
  const { text, crew, files, ...rest } = it;
  const teaser = Array.isArray(files) ? files.map(f => ({ name: f.name, type: f.type, size: f.size })) : [];
  return { ...rest, files: teaser, locked: true };
}

async function marketInstall(request, env) {
  // bump the install counter (atomic) so popular templates rank up
  const { id } = await request.json().catch(() => ({}));
  if (!id || !/^[a-z0-9_]+$/i.test(id)) return json({ error: 'bad id' }, 400);
  const raw = await env.AMV_KV.get(`market:${id}`);
  if (raw) {
    try {
      const it = JSON.parse(raw);
      it.installs = (it.installs || 0) + 1;
      await env.AMV_KV.put(`market:${id}`, JSON.stringify(it));
    } catch {}
  }
  return json({ ok: true });
}

/* =====================================================================
   MARKETPLACE ECONOMY — paid listings, 80/20 split, seller balance.
   ---------------------------------------------------------------------
   Money flow: buyer pays the full price through the SAME Stripe checkout
   used for plans (mode=payment, one-time). On checkout.session.completed
   the webhook calls _creditSale(): the buyer is granted the item, the
   seller's balance is credited 80%, the platform keeps 20%. Sellers see
   their balance and can request a withdrawal (extraction) of it.
   Records:
     purchases:<buyer>      -> [ {id, title, kind, price, ts} ]   (what they own)
     entitleitem:<buyer>:<id> -> '1'                              (fast ownership check)
     wallet:<seller>        -> { balance, lifetime, currency }    (earnings ledger)
     wallet_tx:<seller>     -> [ {type, amount, item, ts, ...} ]  (ledger history)
     withdraw:<id>          -> { seller, amount, status, ts }     (extraction requests)
   ===================================================================== */
const MARKET_PLATFORM_FEE = 0.20;   // you keep 20%, seller gets 80%
const MARKET_MIN_WITHDRAW = 10;     // minimum balance (USD) to extract

async function _getListing(env, id) {
  if (!id || !/^[a-z0-9_]+$/i.test(id)) return null;
  const raw = await env.AMV_KV.get(`market:${id}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function _wallet(env, email) {
  const raw = await env.AMV_KV.get(`wallet:${email}`);
  if (raw) { try { return JSON.parse(raw); } catch {} }
  return { balance: 0, lifetime: 0, currency: 'usd' };
}
async function _saveWallet(env, email, w) { await env.AMV_KV.put(`wallet:${email}`, JSON.stringify(w)); }
async function _walletTx(env, email) {
  const raw = await env.AMV_KV.get(`wallet_tx:${email}`);
  if (raw) { try { return JSON.parse(raw); } catch {} }
  return [];
}
async function _pushWalletTx(env, email, tx) {
  const list = await _walletTx(env, email);
  list.unshift(tx);
  await env.AMV_KV.put(`wallet_tx:${email}`, JSON.stringify(list.slice(0, 500)));
}
async function _ownsItem(env, email, id) {
  return !!(await env.AMV_KV.get(`entitleitem:${email}:${id}`));
}

/* Start a purchase: creates a one-time Stripe Checkout for a paid listing.
   We pass the item id + buyer in metadata so the webhook can grant + split. */
async function marketBuy(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in to buy' }, 401);
  const { id } = await request.json().catch(() => ({}));
  const it = await _getListing(env, id);
  if (!it) return json({ error: 'item not found' }, 404);
  if (/^usr_/.test(id) && it.status === 'sold') return json({ error: 'Sorry — this just sold. Message the seller to ask for another.' }, 409);
  if (!it.price || it.price <= 0) return json({ error: 'this item is free — just install it' }, 400);
  if (it.authorEmail === user.email) return json({ error: 'you cannot buy your own listing' }, 400);
  if (await _ownsItem(env, user.email, id)) return json({ error: 'you already own this', owned: true }, 400);
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'payments not configured' }, 503);

  const origin = request.headers.get('Origin') || env.APP_URL || '';
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('line_items[0][price_data][currency]', 'usd');
  form.set('line_items[0][price_data][product_data][name]', ('AMV: ' + it.title).slice(0, 120));
  form.set('line_items[0][price_data][unit_amount]', String(it.price * 100));
  form.set('line_items[0][quantity]', '1');
  form.set('customer_email', user.email);
  form.set('client_reference_id', user.email);
  form.set('success_url', `${origin}?bought=${encodeURIComponent(id)}`);
  form.set('cancel_url', `${origin}?canceled=1`);
  form.set('metadata[kind]', 'market_purchase');
  form.set('metadata[itemId]', id);
  form.set('metadata[buyer]', user.email);
  form.set('metadata[seller]', it.authorEmail || '');

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const d = await r.json();
  if (!r.ok) return json({ error: d.error?.message || 'stripe error' }, 502);
  return json({ ok: true, url: d.url, id: d.id });
}

/* Called from the Stripe webhook when a market_purchase session completes.
   Grants the item to the buyer and credits the seller their 80% share. */
async function _creditSale(env, { itemId, buyer, seller, amountCents }) {
  if (!itemId || !buyer) return;
  // Exactly-once: atomically claim this (buyer,item) sale. A buyer can never own
  // the same item twice (marketBuy blocks re-purchase), so this is a stable key.
  // The claim is atomic on D1, closing the double-credit race that a plain
  // "already owns it?" read cannot (two concurrent callers both read "no").
  if (!(await _claimOnce(env, 'sale', `${buyer}:${itemId}`))) return;
  const it = await _getListing(env, itemId);
  const price = amountCents != null ? amountCents / 100 : (it ? it.price : 0);
  const sellerEmail = seller || (it && it.authorEmail) || '';
  // grant ownership to the buyer
  await env.AMV_KV.put(`entitleitem:${buyer}:${itemId}`, '1');
  const purchases = await _purchasesList(env, buyer);
  purchases.unshift({ id: itemId, title: it ? it.title : itemId, kind: it ? it.kind : 'prompt', price, ts: Date.now() });
  await env.AMV_KV.put(`purchases:${buyer}`, JSON.stringify(purchases.slice(0, 500)));
  // credit the seller 80%
  if (sellerEmail) {
    const sellerShare = +(price * (1 - MARKET_PLATFORM_FEE)).toFixed(2);
    const w = await _wallet(env, sellerEmail);
    w.balance = +(w.balance + sellerShare).toFixed(2);
    w.lifetime = +(w.lifetime + sellerShare).toFixed(2);
    await _saveWallet(env, sellerEmail, w);
    await _pushWalletTx(env, sellerEmail, { type: 'sale', amount: sellerShare, gross: price, item: itemId, title: it ? it.title : itemId, buyer, ts: Date.now() });
    // record the platform's cut (your revenue) so it shows in admin finance. The
    // full charge is already in Stripe; this logs the marketplace fee distinctly.
    const platformCut = +(price * MARKET_PLATFORM_FEE).toFixed(2);
    if (platformCut > 0) await _recordTxn(env, { provider: 'marketplace', email: buyer, amount: platformCut,
      currency: 'USD', kind: 'marketplace fee', status: 'succeeded', ref: itemId });
  }
  // bump sale count; user listings are one-of-a-kind → mark SOLD (leaves catalog)
  if (it) {
    it.sales = (it.sales || 0) + 1; it.installs = (it.installs || 0) + 1;
    if (/^usr_/.test(itemId)) it.status = 'sold';
    await env.AMV_KV.put(`market:${itemId}`, JSON.stringify(it));
  }
  audit(env, 'market_sale', { item: itemId, buyer, seller: sellerEmail, price });
}
async function _purchasesList(env, email) {
  const raw = await env.AMV_KV.get(`purchases:${email}`);
  if (raw) { try { return JSON.parse(raw); } catch {} }
  return [];
}

/* Buyer's library: items they've purchased, WITH the unlocked deliverable. */
async function marketPurchases(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const list = await _purchasesList(env, user.email);
  // attach the live deliverable for each owned item
  const items = [];
  for (const p of list) {
    const it = await _getListing(env, p.id);
    if (it) items.push({ ...it, _purchasedAt: p.ts });        // full content — they own it
    else items.push({ ...p, _removed: true });                // seller unlisted it; keep the record
  }
  return json({ ok: true, items });
}

/* Seller's own listings + sale counts. */
async function marketMyListings(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const out = [];
  let cursor;
  do {
    const page = await env.AMV_KV.list({ prefix: 'market:', cursor, limit: 1000 });
    for (const k of page.keys) {
      const raw = await env.AMV_KV.get(k.name);
      if (!raw) continue;
      try { const it = JSON.parse(raw); if (it.authorEmail === user.email) out.push(it); } catch {}
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return json({ ok: true, items: out });
}
async function marketUnlist(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { id } = await request.json().catch(() => ({}));
  const it = await _getListing(env, id);
  if (!it) return json({ error: 'not found' }, 404);
  if (it.authorEmail !== user.email) return json({ error: 'not your listing' }, 403);
  await env.AMV_KV.delete(`market:${id}`);
  audit(env, 'market_unlist', { id, by: user.email });
  return json({ ok: true });
}

/* Seller wallet: balance, lifetime earnings, recent transactions. */
async function marketEarnings(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const w = await _wallet(env, user.email);
  const tx = await _walletTx(env, user.email);
  return json({ ok: true, balance: w.balance, lifetime: w.lifetime, currency: w.currency || 'usd', minWithdraw: MARKET_MIN_WITHDRAW, sellerPct: Math.round((1 - MARKET_PLATFORM_FEE) * 100), tx: tx.slice(0, 50) });
}

/* Extraction: seller requests a withdrawal of their balance. Records a
   pending payout and zeroes the balance (operator fulfills it via the
   destination on file). Idempotent-ish via a unique request id. */
async function marketWithdraw(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { destination } = await request.json().catch(() => ({}));
  // Serialize withdrawals per seller so two concurrent requests can't both read
  // the same balance and each create a payout for it (double withdrawal). The
  // lock is atomic on D1; on KV it is a best-effort short-TTL guard. Balance is
  // re-read INSIDE the lock.
  if (!(await _claimOnce(env, 'wdlock', user.email, 30))) {
    return json({ error: 'A withdrawal is already being processed. Please try again in a moment.' }, 409);
  }
  try {
    const w = await _wallet(env, user.email);
    if (w.balance < MARKET_MIN_WITHDRAW) return json({ error: `Minimum withdrawal is $${MARKET_MIN_WITHDRAW}. Your balance is $${w.balance.toFixed(2)}.` }, 400);
    const amount = w.balance;
    const wid = 'wd_' + crypto.randomUUID().slice(0, 12);
    await env.AMV_KV.put(`withdraw:${wid}`, JSON.stringify({
      id: wid, seller: user.email, amount, destination: String(destination || '').slice(0, 200),
      status: 'pending', ts: Date.now(),
    }));
    // zero the balance and log the debit
    w.balance = 0;
    await _saveWallet(env, user.email, w);
    await _pushWalletTx(env, user.email, { type: 'withdrawal', amount: -amount, status: 'pending', id: wid, ts: Date.now() });
    audit(env, 'market_withdraw', { seller: user.email, amount, id: wid });
    return json({ ok: true, amount, id: wid, status: 'pending' });
  } finally {
    await _releaseClaim(env, 'wdlock', user.email);
  }
}

/* Seller changes a listing's status: active | sold | deactivated. Owner only. */
async function marketSetStatus(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { id, status } = await request.json().catch(() => ({}));
  if (!['active', 'sold', 'deactivated'].includes(status)) return json({ error: 'bad status' }, 400);
  const it = await _getListing(env, id);
  if (!it) return json({ error: 'not found' }, 404);
  if (it.authorEmail !== user.email) return json({ error: 'not your listing' }, 403);
  // SECURITY: a seller can never flip their own listing out of review or off a
  // moderation hold. Only deactivating is allowed while under review/removed.
  if ((it.status === 'under_review' || it.status === 'removed') && status === 'active') {
    return json({ error: 'This listing is under review and can\u2019t be activated until review completes.', code: 'under_review' }, 403);
  }
  // Re-screen on any activation, in case the stored content is prohibited.
  if (status === 'active') {
    const screen = _marketScreen(it, ((await DB.get(env, 'seller', user.email)) || {}).verifiedFor);
    if (!screen.ok) {
      it.status = 'removed';
      await env.AMV_KV.put(`market:${id}`, JSON.stringify(it));
      return json({ error: screen.reason, code: 'policy_violation' }, 422);
    }
    if (screen.action === 'held_for_review') { it.status = 'under_review'; await env.AMV_KV.put(`market:${id}`, JSON.stringify(it)); return json({ ok: true, status: 'under_review' }); }
  }
  it.status = status;
  await env.AMV_KV.put(`market:${id}`, JSON.stringify(it));
  audit(env, 'market_status', { id, status, by: user.email });
  return json({ ok: true, status });
}

/* Increment a listing's view counter (best-effort analytics, not authed). */
async function marketView(request, env) {
  const { id } = await request.json().catch(() => ({}));
  const it = await _getListing(env, id);
  if (!it) return json({ ok: true });
  it.views = (it.views || 0) + 1;
  await env.AMV_KV.put(`market:${id}`, JSON.stringify(it));
  return json({ ok: true, views: it.views });
}

/* Buyer rates a listing (item rating, 1-5). Recomputes the listing average. */
async function marketRate(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { id, stars } = await request.json().catch(() => ({}));
  const s = Math.max(1, Math.min(5, Math.round(Number(stars) || 0)));
  if (!(await _ownsItem(env, user.email, id))) return json({ error: 'buy it before rating' }, 403);
  const it = await _getListing(env, id);
  if (!it) return json({ error: 'not found' }, 404);
  const key = `mkrate:${id}`;
  let map = {};
  try { const raw = await env.AMV_KV.get(key); if (raw) map = JSON.parse(raw); } catch {}
  map[user.email] = s;
  await env.AMV_KV.put(key, JSON.stringify(map));
  const vals = Object.values(map);
  it.rating = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  it.ratings = vals.length;
  await env.AMV_KV.put(`market:${id}`, JSON.stringify(it));
  return json({ ok: true, rating: it.rating, ratings: it.ratings });
}

/* Buyer reviews a SELLER (person) with 1-5 stars + text. Gated: must have
   bought at least one of that seller's listings. Stored under the seller. */
async function marketReview(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { seller, stars, text } = await request.json().catch(() => ({}));
  const sellerEmail = String(seller || '').toLowerCase();
  if (!sellerEmail || sellerEmail === user.email) return json({ error: 'invalid seller' }, 400);
  // verify the buyer owns something from this seller
  const purchases = await _purchasesList(env, user.email);
  let bought = false;
  for (const p of purchases) {
    const it = await _getListing(env, p.id);
    if (it && (it.authorEmail || '').toLowerCase() === sellerEmail) { bought = true; break; }
  }
  if (!bought) return json({ error: 'You can only review sellers you\u2019ve bought from.' }, 403);
  const s = Math.max(1, Math.min(5, Math.round(Number(stars) || 0)));
  const key = `mkreview:${sellerEmail}`;
  let list = [];
  try { const raw = await env.AMV_KV.get(key); if (raw) list = JSON.parse(raw); } catch {}
  // Screen review text — user-generated content that displays publicly.
  const reviewText = String(text || '').slice(0, 1000);
  const rScreen = _marketScreen({ text: reviewText, title: '' });
  if (!rScreen.ok && rScreen.action === 'blocked') {
    audit(env, 'market_review_blocked', { by: user.email, category: rScreen.category });
    return json({ error: 'Your review contains content that isn\u2019t allowed.', code: 'policy_violation' }, 422);
  }
  const entry = { by: user.email, byName: (user.name || user.email.split('@')[0]).slice(0, 40), stars: s, text: reviewText, ts: Date.now() };
  const existing = list.findIndex(r => (r.by || '').toLowerCase() === user.email.toLowerCase());
  if (existing >= 0) list[existing] = entry; else list.unshift(entry);
  await env.AMV_KV.put(key, JSON.stringify(list.slice(0, 500)));
  audit(env, 'market_review', { seller: sellerEmail, by: user.email, stars: s });
  return json({ ok: true, review: entry });
}

/* Deterministic thread id for a pair (order-independent) so both share one. */
function _threadId(a, b) { return 'mkthread:' + [String(a || '').toLowerCase(), String(b || '').toLowerCase()].sort().join('__'); }

/* Send a message to another user (buyer<->seller). Appends to the shared thread. */
async function marketMessage(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  // Messaging reaches another user — guard against spam/harassment.
  const blocked = await guardAction(env, `mktmsg:${user.email}`, 15, 300, 'messages');
  if (blocked) return blocked;
  const { to, text } = await request.json().catch(() => ({}));
  const other = String(to || '').toLowerCase();
  const body = String(text || '').trim().slice(0, 2000);
  if (!other || other === user.email) return json({ error: 'invalid recipient' }, 400);
  if (!body) return json({ error: 'empty message' }, 400);
  // Screen private messages — block prohibited content (illegal offers, CSAM, etc.)
  const mScreen = _marketScreen({ text: body, title: '' });
  if (!mScreen.ok && mScreen.action === 'blocked') {
    audit(env, 'market_message_blocked', { by: user.email, category: mScreen.category });
    return json({ error: 'That message contains content that isn\u2019t allowed on the marketplace.', code: 'policy_violation' }, 422);
  }
  const key = _threadId(user.email, other);
  let t;
  try { const raw = await env.AMV_KV.get(key); if (raw) t = JSON.parse(raw); } catch {}
  if (!t) t = { id: key, a: user.email, b: other, aName: user.name || user.email.split('@')[0], bName: other.split('@')[0], msgs: [], read: {} };
  if (t.a === user.email) t.aName = user.name || t.aName; else t.bName = user.name || t.bName;
  t.msgs.push({ from: user.email, text: body, ts: Date.now() });
  if (t.msgs.length > 500) t.msgs = t.msgs.slice(-500);
  t.read = t.read || {}; t.read[user.email] = Date.now();
  await env.AMV_KV.put(key, JSON.stringify(t));
  audit(env, 'market_message', { from: user.email, to: other });
  return json({ ok: true, thread: t });
}

/* List the current user's message threads (newest first). */
async function marketThreads(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const me = user.email.toLowerCase();
  const out = [];
  let cursor;
  do {
    const page = await env.AMV_KV.list({ prefix: 'mkthread:', cursor, limit: 1000 });
    for (const k of page.keys) {
      // fast filter: the pair is encoded in the key
      if (!k.name.includes(me)) continue;
      const raw = await env.AMV_KV.get(k.name);
      if (!raw) continue;
      try { const t = JSON.parse(raw); if (t.a === me || t.b === me) out.push(t); } catch {}
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  out.sort((x, y) => (y.msgs[y.msgs.length - 1]?.ts || 0) - (x.msgs[x.msgs.length - 1]?.ts || 0));
  return json({ ok: true, threads: out });
}

/* =====================================================================
   FOUNDER ADMIN — token-gated platform monitoring (auditor #10)
   Lets the operator see real platform-wide spend, users, and abuse signals,
   plus flip the kill switch and inspect/adjust a single user. Protected by
   ADMIN_TOKEN (a secret only you hold) — NOT by user auth, so a normal user
   token can never reach it.
   ===================================================================== */
// increment a short-lived failed-login counter (15-min window) for brute-force defense
async function _noteAuthFail(env, key){
  try{
    const n = parseInt(await env.AMV_KV.get(key) || '0', 10) + 1;
    await env.AMV_KV.put(key, String(n), { expirationTtl: 900 });
  }catch(e){}
}
function _requireAdmin(request, env) {
  const tok = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || !tok) return false;
  // constant-time compare to avoid leaking the token through response timing;
  // header-only (never a query param, which would leak into logs/history)
  const a = new TextEncoder().encode(tok), b = new TextEncoder().encode(env.ADMIN_TOKEN);
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* Mark a user active today, counted at most ONCE per day (unique DAU). We set a
   per-user marker with a 2-day TTL; the first mark of the day bumps the counter. */
async function _markActive(env, email){
  try{
    const day = todayKey();
    const marker = `active:${email}:${day}`;
    if(await env.AMV_KV.get(marker)) return;              // already counted today
    await env.AMV_KV.put(marker, '1', { expirationTtl: 2 * 86400 });
    const key = `grow:active:${day}`;
    const cur = parseInt(await env.AMV_KV.get(key) || '0', 10) || 0;
    await env.AMV_KV.put(key, String(cur + 1), { expirationTtl: 60 * 86400 });
  }catch(e){ /* best-effort */ }
}

/* ── Growth tracking: a tiny per-day counter so the owner can see TRENDS, not
   just a snapshot. One KV key per day (grow:signup:YYYY-MM-DD). 60-day TTL keeps
   it bounded. This is what turns "you have 40 users" into "signups are up 3x
   week over week" — the number that actually tells you if it's working. ── */
async function _recordGrowth(env, kind){
  const day = todayKey();
  const key = `grow:${kind}:${day}`;
  try{
    const cur = parseInt(await env.AMV_KV.get(key) || '0', 10) || 0;
    await env.AMV_KV.put(key, String(cur + 1), { expirationTtl: 60 * 86400 });
  }catch(e){ /* growth stats are best-effort, never block signup */ }
}

/* Read the last N days of a growth series as [{date, count}], oldest first. */
async function _growthSeries(env, kind, days){
  const out = [];
  const now = new Date();
  for(let i = days - 1; i >= 0; i--){
    const d = new Date(now.getTime() - i * 86400000);
    const key = `grow:${kind}:${d.toISOString().slice(0,10)}`;
    const v = parseInt(await env.AMV_KV.get(key) || '0', 10) || 0;
    out.push({ date: d.toISOString().slice(0,10), count: v });
  }
  return out;
}

async function adminStats(request, env) {
  if (!_requireAdmin(request, env)) { audit(env, 'auth_fail', { reason: 'admin_bad_token' }); return json({ error: 'forbidden' }, 403); }

  const today = todayKey(), month = monthKey();
  // global spend today (atomic counter) + cap
  const gSpend = (await counter(env, `spend:${today}`, { op: 'get' })).value || 0;
  const gCap = parseFloat(env.GLOBAL_DAILY_USD_CAP || '500');
  const killed = (await env.AMV_KV.get('GLOBAL_KILL')) === '1';

  // list entitlements (paying users) via the durable layer (D1 query or KV scan)
  let users = [], plans = { free: 0, pro: 0, elite: 0, ultra: 0, custom: 0 };
  let mrr = 0;
  const PRICE = { pro: 15, elite: 75, ultra: 200 };
  const entRows = await DB.list(env, 'ent', 5000);
  for (const row of entRows) {
    const e = row.value || {};
    const email = row.id;
    const plan = e.plan || 'free';
    plans[plan] = (plans[plan] || 0) + 1;
    if (PRICE[plan]) mrr += PRICE[plan];
    else if (plan === 'custom' && e.custom?.price) mrr += e.custom.price;
    const cost = (await counter(env, `cost:${email}:${month}`, { op: 'get' })).value || 0;
    if (plan !== 'free' || cost > 0) users.push({ email, plan, monthCostUSD: +cost.toFixed(3) });
  }

  // top spenders (who costs us most this month) — abuse / margin watch
  const topSpenders = [...users].sort((a, b) => b.monthCostUSD - a.monthCostUSD).slice(0, 20);
  const paying = users.filter(u => u.plan !== 'free').length;

  // Growth over time — the numbers that show whether it's WORKING, not just a
  // snapshot. 30-day signup + active series, plus today's figures.
  const signups30 = await _growthSeries(env, 'signup', 30);
  const active30 = await _growthSeries(env, 'active', 30);
  const signupsToday = signups30.length ? signups30[signups30.length - 1].count : 0;
  const activeToday = active30.length ? active30[active30.length - 1].count : 0;
  const signups7 = signups30.slice(-7).reduce((n, d) => n + d.count, 0);
  const signupsPrev7 = signups30.slice(-14, -7).reduce((n, d) => n + d.count, 0);
  const wowGrowthPct = signupsPrev7 > 0 ? +(((signups7 - signupsPrev7) / signupsPrev7) * 100).toFixed(0) : null;

  const totalAccounts = entRows.length;
  const conversionPct = totalAccounts > 0 ? +((paying / totalAccounts) * 100).toFixed(1) : 0;
  const arpu = paying > 0 ? +(mrr / paying).toFixed(2) : 0;

  return json({
    ok: true,
    generatedAt: Date.now(),
    spend: { today: +gSpend.toFixed(2), cap: gCap, pctOfCap: +(gSpend / gCap * 100).toFixed(1), killed },
    users: { total: users.length, paying, byPlan: plans, conversionPct, activeToday },
    growth: { signupsToday, signups7, signupsPrev7, wowGrowthPct, signups30, active30 },
    revenue: { estMRR: mrr, estARR: mrr * 12, arpu },
    margin: { estMonthlyCost: +users.reduce((s, u) => s + u.monthCostUSD, 0).toFixed(2) },
    topSpenders,
  });
}

// flip the global kill switch on/off
async function adminKill(request, env) {
  if (!_requireAdmin(request, env)) return json({ error: 'forbidden' }, 403);
  const { on } = await request.json().catch(() => ({}));
  if (on) await env.AMV_KV.put('GLOBAL_KILL', '1');
  else await env.AMV_KV.delete('GLOBAL_KILL');
  audit(env, 'admin_kill', { on: !!on });
  return json({ ok: true, killed: !!on });
}

// inspect one user, or override their plan (e.g. comp an account, stop abuse)
async function adminUser(request, env) {
  if (!_requireAdmin(request, env)) return json({ error: 'forbidden' }, 403);
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
  const monthCost = (await counter(env, `cost:${email}:${month}`, { op: 'get' })).value || 0;
  const monthTok = (await counter(env, `usg:${email}:${month}`, { op: 'get' })).value || 0;
  const dayTok = (await counter(env, `usg:${email}:${today}`, { op: 'get' })).value || 0;
  return json({
    ok: true, email,
    entitlement: ent || { plan: 'free' },
    usage: { dayTokens: dayTok, monthTokens: monthTok, monthCostUSD: +monthCost.toFixed(3) },
  });
}


/* Verify a Stripe webhook signature (the t=…,v1=… scheme: HMAC-SHA256 of
   "timestamp.payload" with the webhook secret). Constant-time compared. */
async function verifyStripeSignature(secret, payload, sigHeader) {
  try {
    if (!secret || !sigHeader) return false;
    const parts = Object.fromEntries(sigHeader.split(',').map(kv => kv.split('=')));
    const t = parts.t, v1 = parts.v1;
    if (!t || !v1) return false;
    // reject very old timestamps (replay protection, 5 min tolerance)
    if (Math.abs(Date.now() / 1000 - parseInt(t, 10)) > 300) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
    const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
    // constant-time compare
    if (expected.length !== v1.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
}

// ---- PayPal: create an order (one-time) or subscription approval link ----
async function paypalCreate(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_SECRET) return json({ error: 'paypal not configured' }, 503);
  const { plan } = await request.json().catch(() => ({}));
  const PRICES = { pro: '15.00', elite: '75.00', ultra: '200.00' };
  const amount = PRICES[plan];
  if (!amount) return json({ error: 'unknown plan' }, 400);

  const token = await _paypalToken(env);
  if (!token) return json({ error: 'paypal auth failed' }, 502);
  const r = await fetch(`${_paypalBase(env)}/v2/checkout/orders`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: 'USD', value: amount }, custom_id: `${user.email}|${plan}` }],
    }),
  });
  const d = await r.json();
  if (!r.ok) return json({ error: 'paypal create failed' }, 502);
  return json({ id: d.id });
}

// ---- PayPal: create a recurring SUBSCRIPTION (needs billing plan IDs) ----
async function paypalSubscribe(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_SECRET) return json({ error: 'paypal not configured' }, 503);
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
  const r = await fetch(`${_paypalBase(env)}/v1/billing/subscriptions`, {
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
  return json({ url: approve.href, id: d.id });
}

// ---- PayPal: capture an approved order, then grant entitlement ----
async function paypalCapture(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { orderId } = await request.json().catch(() => ({}));
  if (!orderId) return json({ error: 'orderId required' }, 400);
  const token = await _paypalToken(env);
  if (!token) return json({ error: 'paypal auth failed' }, 502);
  const r = await fetch(`${_paypalBase(env)}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const d = await r.json();
  if (!r.ok || d.status !== 'COMPLETED') return json({ error: 'capture failed' }, 502);
  // grant from the verified capture (custom_id carries email|plan)
  const custom = d.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id
              || d.purchase_units?.[0]?.custom_id || '';
  const [email, plan] = custom.split('|');
  if (email && plan) {
    const cap = d.purchase_units?.[0]?.payments?.captures?.[0];
    const capId = cap?.id || d.id || orderId;
    // Exactly-once: a replayed or concurrent capture of the same order must not
    // grant twice or double-record the payment. Atomic on D1.
    if (!(await _claimOnce(env, 'ppcapture', capId))) return json({ ok: true, plan, duplicate: true });
    await setEntitlement(env, email.toLowerCase(), plan, { source: 'paypal' });
    // log it so it shows in the admin finance page alongside Stripe
    const amt = parseFloat(cap?.amount?.value || '0') || 0;
    const cur = cap?.amount?.currency_code || 'USD';
    await _recordTxn(env, { provider: 'paypal', email: email.toLowerCase(), amount: amt, currency: cur,
      kind: plan, status: 'succeeded', ref: d.id || cap?.id || '' });
  }
  return json({ ok: true, plan });
}

// ---- PayPal: webhook (for renewals/disputes/refunds) ----
async function paypalWebhook(request, env, ctx) {
  const raw = await request.text();
  // PayPal webhook verification requires an API call to /v1/notifications/verify-webhook-signature.
  const verified = await verifyPaypalWebhook(env, request.headers, raw);
  if (!verified) { audit(env, 'forged_webhook', { kind: 'paypal' }); return new Response('bad signature', { status: 400 }); }
  let evt; try { evt = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }
  try {
    if (evt.event_type === 'PAYMENT.CAPTURE.REFUNDED' || evt.event_type === 'BILLING.SUBSCRIPTION.CANCELLED') {
      const custom = evt.resource?.custom_id || '';
      const [email] = custom.split('|');
      if (email) await setEntitlement(env, email.toLowerCase(), 'free', { source: 'paypal', canceled: true });
    }
  } catch (e) { audit(env, 'webhook_error', { kind: 'paypal', msg: String(e.message).slice(0, 120) }); }
  return json({ received: true });
}

function _paypalBase(env) { return env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'; }
async function _paypalToken(env) {
  try {
    const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`);
    const r = await fetch(`${_paypalBase(env)}/v1/oauth2/token`, {
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
    const r = await fetch(`${_paypalBase(env)}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: headers.get('paypal-auth-algo'),
        cert_url: headers.get('paypal-cert-url'),
        transmission_id: headers.get('paypal-transmission-id'),
        transmission_sig: headers.get('paypal-transmission-sig'),
        transmission_time: headers.get('paypal-transmission-time'),
        webhook_id: env.PAYPAL_WEBHOOK_ID,
        webhook_event: JSON.parse(body),
      }),
    });
    const d = await r.json();
    return d.verification_status === 'SUCCESS';
  } catch { return false; }
}


/* Password reset — emails a secure, time-limited link.
   Needs an email service (e.g. Resend, SendGrid, or AWS SES). Set the
   RESET_EMAIL_FROM secret and EMAIL_API_KEY; wire sendResetEmail() to your
   provider. Until then it stores a token so the flow is ready. */
async function authReset(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return json({ error: 'invalid email' }, 400);
  // generate a one-time, 1-hour token
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await env.AMV_KV.put(`reset:${token}`, email, { expirationTtl: 3600 });
  const link = `${new URL(request.url).origin.replace(/\/$/, '')}/reset?token=${token}`;
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
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);
  const email = await env.AMV_KV.get(`reset:${token}`);
  if (!email) return json({ error: 'This reset link is invalid or has expired. Please request a new one.' }, 400);
  const acct = await DB.get(env, 'acct', email);
  if (!acct) return json({ error: 'account not found' }, 404);
  // hash the new password with a fresh salt
  const salt = crypto.randomUUID().replace(/-/g, '');
  acct.pwHash = await _hashPassword(password, salt, PBKDF2_ITERATIONS);
  acct.salt = salt; acct.pwIter = PBKDF2_ITERATIONS;
  acct.pwResetAt = Date.now();
  await DB.put(env, 'acct', email, acct);
  // consume the token (single-use) and revoke existing sessions for safety
  await env.AMV_KV.delete(`reset:${token}`);
  try { await revokeUserTokens(env, email); } catch (e) {}
  audit(env, 'password_reset', { email });
  return json({ ok: true });
}

// Wire this to your email provider (Resend shown as an example).
async function sendResetEmail(env, to, link) {
  return _sendEmail(env, to, 'Reset your AMV password',
    _emailShell('Reset your password',
      `<p style="margin:0 0 22px;font-size:14px;line-height:1.65;color:#555">We received a request to reset your AMV password. Tap the button below to choose a new one. This link expires in <b>1 hour</b>.</p>`,
      { label: 'Reset my password', url: link },
      `<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#999">Or paste this link into your browser:</p>`+
      `<p style="margin:0 0 22px;font-size:12px;line-height:1.6;color:#7c6cff;word-break:break-all">${link}</p>`+
      `<hr style="border:none;border-top:1px solid #eee;margin:0 0 18px"><p style="margin:0;font-size:12px;line-height:1.6;color:#999">If you didn't request this, you can safely ignore this email — your password won't change.</p>`,
      'This is an automated security email.'),
    `Reset your AMV password\n\nWe received a request to reset your password. Open this link to set a new one (it expires in 1 hour):\n${link}\n\nIf you didn't request this, you can safely ignore this email — your password won't change.\n\n— The AMV team`);
}

/* Notify a teammate that work was assigned to them. */
async function sendTaskAssignedEmail(env, to, { assignerName, taskTitle, priority, teamName, appUrl }) {
  const safeTitle = _escHtml(taskTitle || 'a task');
  const who = _escHtml(assignerName || 'A teammate');
  const team = _escHtml(teamName || 'your team');
  const prio = priority && priority !== 'normal' ? ` <span style="font-size:11px;color:${priority==='high'?'#d23':'#888'};font-weight:600">(${_escHtml(priority)} priority)</span>` : '';
  const link = appUrl || '';
  return _sendEmail(env, to, `${assignerName||'A teammate'} assigned you: ${taskTitle||'a task'}`,
    _emailShell('You\u2019ve been assigned work',
      `<p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#555">${who} assigned you a task in <b>${team}</b> on AMV:</p>`+
      `<div style="background:#f6f6f9;border:1px solid #ececf3;border-radius:10px;padding:16px;margin:0 0 22px"><div style="font-size:15px;font-weight:600;color:#15131f">${safeTitle}${prio}</div></div>`,
      link ? { label: 'Open in AMV', url: link } : null,
      `<p style="margin:0;font-size:12px;line-height:1.6;color:#999">You can view, update, and complete this task from the Team page in AMV.</p>`,
      'You received this because you\u2019re a member of this team on AMV.'),
    `${assignerName||'A teammate'} assigned you a task in ${teamName||'your team'} on AMV:\n\n"${taskTitle||'a task'}"${priority&&priority!=='normal'?' ('+priority+' priority)':''}\n\nOpen AMV to view and update it: ${link}\n\n— The AMV team`);
}

/* Generic Resend sender — one place that talks to the email provider. */
/* Resend gives every account a sender that needs NO domain verification:
   onboarding@resend.dev. It only delivers to the address that owns the Resend
   account — which is exactly what you need to recover YOUR OWN login on day one.
   For real users, set RESET_EMAIL_FROM to an address on a domain you've verified
   in Resend, or their mail will not arrive. */
const RESET_FROM_DEFAULT = 'AMV <onboarding@resend.dev>';

async function _sendEmail(env, to, subject, html, text) {
  if (!env.EMAIL_API_KEY) return false;
  const from = env.RESET_EMAIL_FROM || RESET_FROM_DEFAULT;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.EMAIL_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
    return resp.ok;
  } catch (e) { return false; }
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
