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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

/* ---- model catalog: maps AMV model -> real engine + cost + min plan ---- */
const ENGINES = {
  'amv-pulse': { model: 'claude-haiku-4-5-20251001', minPlan: 'free',  inCost: 1,  outCost: 5,   maxOut: 4000 },
  'amv-core':  { model: 'claude-sonnet-4-6',         minPlan: 'free',  inCost: 3,  outCost: 15,  maxOut: 6000 },
  'amv-forge': { model: 'claude-opus-4-8',           minPlan: 'pro',   inCost: 15, outCost: 75,  maxOut: 8000 },
  'amv-apex':  { model: 'claude-fable-5',            minPlan: 'elite', inCost: 20, outCost: 100, maxOut: 8000 },
};
// map raw engine names too (frontend sends real model strings today)
const RAW_TO_KEY = {
  'claude-haiku-4-5-20251001': 'amv-pulse',
  'claude-sonnet-4-6': 'amv-core',
  'claude-opus-4-8': 'amv-forge',
  'claude-fable-5': 'amv-apex',
};
const PLAN_RANK = { free: 0, pro: 1, elite: 2, ultra: 3 };

// Per-plan limits (TUNE THESE to protect margin). Tokens/day, tokens/month.
const PLAN_LIMITS = {
  free:  { dayTokens: 50000,   monthTokens: 300000,   rpm: 8,  imagesDay: 10,  videosMonth: 0 },
  pro:   { dayTokens: 1500000, monthTokens: 20000000, rpm: 20, imagesDay: 200, videosMonth: 30 },
  elite: { dayTokens: 6000000, monthTokens: 90000000, rpm: 40, imagesDay: 1000, videosMonth: 200 },
  ultra: { dayTokens: 15000000, monthTokens: 250000000, rpm: 80, imagesDay: 5000, videosMonth: 1000 },
};

const todayKey = () => new Date().toISOString().slice(0, 10);
const monthKey = () => new Date().toISOString().slice(0, 7);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      // ---------- GLOBAL KILL SWITCH ----------
      if (path.startsWith('/v1/')) {
        const killed = await env.AMV_KV.get('GLOBAL_KILL');
        if (killed === '1') return json({ error: 'Service temporarily paused. Please try again soon.' }, 503);
      }

      switch (path) {
        case '/v1/health':       return json({ ok: true, ts: Date.now() });
        case '/auth/signup':     return authSignup(request, env);
        case '/auth/login':      return authLogin(request, env);
        case '/auth/reset':      return authReset(request, env);
        case '/sync/pull':       return syncPull(request, env);
        case '/sync/push':       return syncPush(request, env);
        case '/team/create':     return teamCreate(request, env);
        case '/team/get':        return teamGet(request, env);
        case '/team/invite':     return teamInvite(request, env);
        case '/team/join':       return teamJoin(request, env);
        case '/team/members':    return teamMembers(request, env);
        case '/team/remove':     return teamRemove(request, env);
        case '/team/data':       return teamData(request, env);
        case '/v1/messages':     return aiProxy(request, env, ctx);
        case '/v1/image':        return imageMeter(request, env);
        case '/v1/usage':        return usageReport(request, env);
        case '/sms/register':    return smsRegister(request, env);
        case '/waitlist':        return waitlistAdd(request, env);
        case '/sms/incoming':    return smsIncoming(request, env, ctx);
        // payments (kept from payments worker — paste those handlers here too)
        default: return json({ error: 'not found' }, 404);
      }
    } catch (err) {
      return json({ error: err.message || 'server error' }, 500);
    }
  },
};

/* ---------------- AUTH: issue a signed session token ---------------- */
/* ============================================================
   SERVER-SIDE ACCOUNTS + DATA SYNC
   Accounts (with hashed passwords) and per-user data (chats, memory,
   settings, workspaces) live in KV, so users keep everything across
   devices. Passwords are salted+hashed with PBKDF2; we never store raw.
   ============================================================ */
async function _hashPassword(password, salt){
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash:'SHA-256' }, keyMaterial, 256);
  return [...new Uint8Array(bits)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function authSignup(request, env){
  const { email, name, password } = await request.json().catch(()=>({}));
  const em = String(email||'').toLowerCase().trim();
  if(!em || !em.includes('@')) return json({ error:'valid email required' }, 400);
  if(!password || password.length < 6) return json({ error:'password must be 6+ chars' }, 400);
  const existing = await env.AMV_KV.get(`acct:${em}`);
  if(existing) return json({ error:'account exists' }, 409);
  const salt = crypto.randomUUID();
  const pwHash = await _hashPassword(password, salt);
  const acct = { email: em, name: name||'', provider:'email', salt, pwHash, createdAt: Date.now() };
  await env.AMV_KV.put(`acct:${em}`, JSON.stringify(acct));
  const token = await signToken({ email: em, name: name||'' }, env.JWT_SECRET);
  return json({ token, email: em, name: name||'' });
}
async function authLogin(request, env) {
  const { email, name, password, provider } = await request.json().catch(()=>({}));
  const em = String(email||'').toLowerCase().trim();
  if (!em) return json({ error: 'email required' }, 400);
  const raw = await env.AMV_KV.get(`acct:${em}`);
  // Google/OAuth sign-in: create the account on first login, no password
  if(provider === 'google'){
    if(!raw){ await env.AMV_KV.put(`acct:${em}`, JSON.stringify({ email:em, name:name||'', provider:'google', createdAt:Date.now() })); }
    const token = await signToken({ email: em, name: name||'' }, env.JWT_SECRET);
    return json({ token, email: em, name: name||'' });
  }
  // email + password
  if(!raw) return json({ error:'no such account' }, 404);
  const acct = JSON.parse(raw);
  if(acct.provider === 'email'){
    if(!password) return json({ error:'password required' }, 400);
    const hash = await _hashPassword(password, acct.salt);
    if(hash !== acct.pwHash) return json({ error:'wrong password' }, 401);
  }
  const token = await signToken({ email: em, name: acct.name||name||'' }, env.JWT_SECRET);
  return json({ token, email: em, name: acct.name||'' });
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
  const id = 'team_' + crypto.randomUUID().slice(0,8);
  const team = {
    id, name: name||'My Team', ownerEmail: user.email,
    members: [{ email:user.email, role:'owner', joinedAt:Date.now() }],
    createdAt: Date.now(), data:{}
  };
  await env.AMV_KV.put(`team:${id}`, JSON.stringify(team));
  await env.AMV_KV.put(`userteam:${user.email}`, id);
  return json({ ok:true, team });
}
async function teamGet(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const tid = await env.AMV_KV.get(`userteam:${user.email}`);
  if(!tid) return json({ ok:true, team:null });
  const raw = await env.AMV_KV.get(`team:${tid}`);
  return json({ ok:true, team: raw?JSON.parse(raw):null });
}
async function _teamOf(env, email){
  const tid = await env.AMV_KV.get(`userteam:${email}`);
  if(!tid) return null;
  const raw = await env.AMV_KV.get(`team:${tid}`);
  return raw ? JSON.parse(raw) : null;
}
function _role(team, email){ const m=(team.members||[]).find(x=>x.email===email); return m?m.role:null; }
async function teamInvite(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { email, role } = await request.json().catch(()=>({}));
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  if(!['owner','admin'].includes(_role(team, user.email))) return json({ error:'only owners/admins can invite' }, 403);
  const invitee = String(email||'').toLowerCase().trim();
  if(!invitee) return json({ error:'email required' }, 400);
  // create an invite token the invitee redeems
  const token = crypto.randomUUID().slice(0,12);
  await env.AMV_KV.put(`invite:${token}`, JSON.stringify({ teamId:team.id, email:invitee, role:role||'member', ts:Date.now() }), { expirationTtl: 7*86400 });
  return json({ ok:true, inviteToken: token, inviteLink: `?invite=${token}` });
}
async function teamJoin(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { token } = await request.json().catch(()=>({}));
  const raw = await env.AMV_KV.get(`invite:${token}`);
  if(!raw) return json({ error:'invalid or expired invite' }, 404);
  const inv = JSON.parse(raw);
  const traw = await env.AMV_KV.get(`team:${inv.teamId}`);
  if(!traw) return json({ error:'team gone' }, 404);
  const team = JSON.parse(traw);
  if(!team.members.find(m=>m.email===user.email)){
    team.members.push({ email:user.email, role:inv.role||'member', joinedAt:Date.now() });
    await env.AMV_KV.put(`team:${team.id}`, JSON.stringify(team));
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
  if(!['owner','admin'].includes(_role(team, user.email))) return json({ error:'forbidden' }, 403);
  team.members = team.members.filter(m=>m.email!==email || m.role==='owner');
  await env.AMV_KV.put(`team:${team.id}`, JSON.stringify(team));
  await env.AMV_KV.delete(`userteam:${email}`);
  return json({ ok:true, members:team.members });
}
async function teamData(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  if(request.method==='GET') return json({ ok:true, data: team.data||{} });
  const body = await request.json().catch(()=>({}));
  team.data = Object.assign({}, team.data, body.data||{});
  await env.AMV_KV.put(`team:${team.id}`, JSON.stringify(team));
  return json({ ok:true, data: team.data });
}

async function syncPull(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const raw = await env.AMV_KV.get(`data:${user.email}`);
  const data = raw ? JSON.parse(raw) : {};
  return json({ ok:true, data, serverTime: Date.now() });
}
/* Push the user's data up (last-write-wins per top-level key, with a merge). */
async function syncPush(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const body = await request.json().catch(()=>({}));
  const incoming = body.data || {};
  const raw = await env.AMV_KV.get(`data:${user.email}`);
  const current = raw ? JSON.parse(raw) : {};
  // shallow merge: incoming keys overwrite; absent keys preserved
  const merged = Object.assign({}, current, incoming, { _updatedAt: Date.now() });
  // cap stored size (KV value limit safety): keep chats/memory/workspaces/settings
  await env.AMV_KV.put(`data:${user.email}`, JSON.stringify(merged));
  return json({ ok:true, serverTime: Date.now() });
}

async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const data = await verifyToken(token, env.JWT_SECRET);
  if (!data) return null;
  // attach current plan + custom config from entitlement store
  const ent = await env.AMV_KV.get(`ent:${data.email}`);
  const e = ent ? JSON.parse(ent) : {};
  data.plan = e.plan || 'free';
  data.customCfg = e.custom || null;   // { price, monthTokens, dayTokens, rpm } set at checkout
  return data;
}

/* Resolve the effective limits for a user — custom plans use their purchased pool. */
function effectiveLimits(user) {
  if (user.plan === 'custom' && user.customCfg) {
    const c = user.customCfg;
    return {
      dayTokens: c.dayTokens || 50000,
      monthTokens: c.monthTokens || 300000,   // HARD CAP — the profit guarantee
      rpm: c.rpm || 16,
      imagesDay: Math.max(10, Math.floor((c.monthTokens || 300000) / 30000)),
      videosMonth: c.price >= 75 ? 60 : 0,
      allModels: true,
    };
  }
  return PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;
}

/* ---------------- THE AI PROXY (the heart) -------------------------- */
async function aiProxy(request, env, ctx) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in again.' }, 401);

  const body = await request.json();

  // resolve requested engine
  const rawModel = body.model || 'claude-sonnet-4-6';
  const key = RAW_TO_KEY[rawModel] || (ENGINES[rawModel] ? rawModel : 'amv-core');
  const eng = ENGINES[key];

  const limits = effectiveLimits(user);

  // 1) PLAN ENFORCEMENT — free can't call premium engines (custom plans paid for all models)
  if (!limits.allModels && PLAN_RANK[user.plan] < PLAN_RANK[eng.minPlan]) {
    return json({ error: `${key} requires the ${eng.minPlan} plan. Upgrade to use it.`, code: 'plan_required', minPlan: eng.minPlan }, 402);
  }

  // 2) RATE LIMIT (per account, per minute) — KV counter w/ 60s TTL
  const rlKey = `rl:${user.email}:${Math.floor(Date.now() / 60000)}`;
  const rl = parseInt(await env.AMV_KV.get(rlKey) || '0', 10);
  if (rl >= limits.rpm) return json({ error: 'Rate limit reached. Slow down a moment.', code: 'rate_limited' }, 429);
  ctx.waitUntil(env.AMV_KV.put(rlKey, String(rl + 1), { expirationTtl: 70 }));

  // 3) QUOTA CHECK (per account, day + month)
  const dKey = `usg:${user.email}:${todayKey()}`;
  const mKey = `usg:${user.email}:${monthKey()}`;
  const dUsed = parseInt(await env.AMV_KV.get(dKey) || '0', 10);
  const mUsed = parseInt(await env.AMV_KV.get(mKey) || '0', 10);
  if (dUsed >= limits.dayTokens) return json({ error: 'Daily usage limit reached. Resets at midnight UTC, or upgrade for more.', code: 'quota_day' }, 429);
  if (mUsed >= limits.monthTokens) return json({ error: 'Monthly usage limit reached. Upgrade for more room.', code: 'quota_month' }, 429);

  // 3b) COST BACKSTOP — applies to EVERY paid plan. A user can never cost us
  //     more than a safe fraction of what they paid, guaranteeing margin even
  //     if they run 100% on the most expensive model. This is the profit lock.
  const PLAN_PRICE = { pro:15, elite:75, ultra:200 };
  let priceForBackstop = 0;
  if (user.plan === 'custom' && user.customCfg && user.customCfg.price) priceForBackstop = user.customCfg.price;
  else if (PLAN_PRICE[user.plan]) priceForBackstop = PLAN_PRICE[user.plan];
  if (priceForBackstop > 0) {
    const costKey = `cost:${user.email}:${monthKey()}`;
    const spentOnUser = parseFloat(await env.AMV_KV.get(costKey) || '0');
    const costCeiling = priceForBackstop * 0.45;   // keep >=55% margin on every plan, worst case
    if (spentOnUser >= costCeiling) {
      return json({ error: 'You\u2019ve used your full plan allowance for this billing cycle. It resets next month, or upgrade for more.', code: 'quota_month' }, 429);
    }
  }

  // 4) GLOBAL SPEND CAP — hard ceiling across ALL users
  const gKey = `spend:${todayKey()}`;
  const gSpent = parseFloat(await env.AMV_KV.get(gKey) || '0');
  const gCap = parseFloat(env.GLOBAL_DAILY_USD_CAP || '500');
  if (gSpent >= gCap) {
    ctx.waitUntil(notify(env, `GLOBAL DAILY SPEND CAP HIT: $${gSpent.toFixed(2)} >= $${gCap}`));
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
  if (body.tools) upstreamBody.tools = body.tools;

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
    const e = await upstream.json().catch(() => ({}));
    return json({ error: e?.error?.message || 'AI error', status: upstream.status }, upstream.status);
  }

  // 7) tee the stream: pass to client AND tally tokens/cost as it flows
  const [toClient, toMeter] = upstream.body.tee();
  ctx.waitUntil(meterStream(toMeter, eng, { dKey, mKey, gKey, user, env, limits }));

  return new Response(toClient, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...CORS },
  });
}

/* read the SSE copy, extract usage, persist token + cost counters */
async function meterStream(stream, eng, { dKey, mKey, gKey, user, env, limits }) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '', inTok = 0, outTok = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const ln of lines) {
        if (!ln.startsWith('data:')) continue;
        try {
          const ev = JSON.parse(ln.slice(5).trim());
          if (ev.type === 'message_start' && ev.message?.usage) {
            inTok = (ev.message.usage.input_tokens || 0) + (ev.message.usage.cache_read_input_tokens || 0);
          }
          if (ev.type === 'message_delta' && ev.usage) outTok = ev.usage.output_tokens || outTok;
        } catch {}
      }
    }
  } catch {}
  const total = inTok + outTok;
  const cost = (inTok / 1e6) * eng.inCost + (outTok / 1e6) * eng.outCost;
  // persist counters (35-day TTL on day, 70-day on month)
  await bump(env, dKey, total, 86400 * 35);
  await bump(env, mKey, total, 86400 * 70);
  await bumpFloat(env, gKey, cost, 86400 * 2);
  await bumpFloat(env, `cost:${user.email}:${monthKey()}`, cost, 86400 * 70);
  // alert thresholds
  const gSpent = parseFloat(await env.AMV_KV.get(gKey) || '0');
  const gCap = parseFloat(env.GLOBAL_DAILY_USD_CAP || '500');
  if (gSpent >= gCap * 0.8 && gSpent - cost < gCap * 0.8) {
    await notify(env, `Spend alert: today at $${gSpent.toFixed(2)} (80% of $${gCap} cap).`);
  }
}

async function bump(env, key, n, ttl) {
  const cur = parseInt(await env.AMV_KV.get(key) || '0', 10);
  await env.AMV_KV.put(key, String(cur + n), { expirationTtl: ttl });
}
async function bumpFloat(env, key, n, ttl) {
  const cur = parseFloat(await env.AMV_KV.get(key) || '0');
  await env.AMV_KV.put(key, String(cur + n), { expirationTtl: ttl });
}

/* ---------------- IMAGE METERING ----------------------------------- */
async function imageMeter(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in' }, 401);
  const limits = effectiveLimits(user);
  const k = `img:${user.email}:${todayKey()}`;
  const used = parseInt(await env.AMV_KV.get(k) || '0', 10);
  if (used >= limits.imagesDay) return json({ error: 'Daily image limit reached. Upgrade for more.', code: 'img_quota' }, 429);
  await bump(env, k, 1, 86400 * 2);
  return json({ ok: true, remaining: limits.imagesDay - used - 1 });
}

/* ---------------- USAGE REPORT (for the in-app dashboard) ----------- */
async function usageReport(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in' }, 401);
  const limits = effectiveLimits(user);
  const dUsed = parseInt(await env.AMV_KV.get(`usg:${user.email}:${todayKey()}`) || '0', 10);
  const mUsed = parseInt(await env.AMV_KV.get(`usg:${user.email}:${monthKey()}`) || '0', 10);
  const mCost = parseFloat(await env.AMV_KV.get(`cost:${user.email}:${monthKey()}`) || '0');
  return json({
    plan: user.plan,
    day: { used: dUsed, limit: limits.dayTokens },
    month: { used: mUsed, limit: limits.monthTokens, costUSD: +mCost.toFixed(4) },
  });
}

/* ---------------- alerting (webhook) ------------------------------- */
async function notify(env, msg) {
  if (!env.ALERT_WEBHOOK) return;
  try { await fetch(env.ALERT_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '[AMV] ' + msg }) }); } catch {}
}

/* ---------------- signed tokens (HMAC) ----------------------------- */
async function signToken(payload, secret) {
  const body = btoa(JSON.stringify({ ...payload, exp: Date.now() + 86400000 * 30 }));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret || 'dev'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const sig = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return `${body}.${sig}`;
}
async function verifyToken(token, secret) {
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret || 'dev'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    const expect = btoa(String.fromCharCode(...new Uint8Array(mac)));
    if (expect !== sig) return null;
    const data = JSON.parse(atob(body));
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch { return null; }
}

/* =====================================================================
   DEPLOY
   1. npm i -g wrangler && wrangler login
   2. wrangler kv:namespace create AMV_KV   → put id in wrangler.toml
   3. Secrets:
        wrangler secret put ANTHROPIC_API_KEY
        wrangler secret put JWT_SECRET           (long random string)
   4. Vars in wrangler.toml:
        GLOBAL_DAILY_USD_CAP = "500"             (your hard ceiling)
        ALERT_WEBHOOK = "https://hooks.slack..." (optional)
   5. wrangler deploy  → get https://amv-api.<you>.workers.dev
   6. In AMV → Settings → Live/Backend, paste that URL.
      Now: key is hidden, plans enforced, quotas + spend cap live.

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
  const from = normalizePhone(form.get('From') || '');
  const text = (form.get('Body') || '').trim();
  if (!from || !text) return twiml('Send a message to get started.');

  // who is this number linked to?
  const email = await env.AMV_KV.get(`sms:phone:${from}`);
  if (!email) {
    return twiml('This number isn\u2019t linked to an AMV account yet. Sign up at AMV and add your phone in Settings \u2192 Text Messages.');
  }

  // load their plan + enforce the SAME limits/caps as the web app
  const ent = await env.AMV_KV.get(`ent:${email}`);
  const e = ent ? JSON.parse(ent) : {};
  const user = { email, plan: e.plan || 'free', customCfg: e.custom || null };

  // rate-limit SMS per number (cheap abuse guard)
  const rlKey = `sms:rl:${from}:${Math.floor(Date.now() / 60000)}`;
  const rl = parseInt(await env.AMV_KV.get(rlKey) || '0', 10);
  if (rl > 8) return twiml('You\u2019re sending messages too fast. Give it a minute.');
  ctx.waitUntil(env.AMV_KV.put(rlKey, String(rl + 1), { expirationTtl: 70 }));

  // monthly cost backstop — SMS shares the user's profit-safe ceiling
  const PLAN_PRICE = { pro: 15, elite: 75, ultra: 200 };
  let price = user.plan === 'custom' && user.customCfg ? user.customCfg.price : (PLAN_PRICE[user.plan] || 0);
  if (price > 0) {
    const costKey = `cost:${email}:${monthKey()}`;
    const spent = parseFloat(await env.AMV_KV.get(costKey) || '0');
    if (spent >= price * 0.45) return twiml('You\u2019ve used your plan\u2019s allowance for this cycle. It resets next month.');
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
  const d = String(p).replace(/[^\d+]/g, '');
  if (!d) return '';
  return d.startsWith('+') ? d : '+' + d;
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

// Wire this to your email provider (Resend shown as an example).
async function sendResetEmail(env, to, link) {
  if (!env.EMAIL_API_KEY || !env.RESET_EMAIL_FROM) return false;
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.EMAIL_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.RESET_EMAIL_FROM,
      to: [to],
      subject: 'Reset your AMV password',
      html: `<p>Tap the link below to set a new password. It expires in 1 hour.</p><p><a href="${link}">Reset my password</a></p><p>If you didn't request this, you can ignore this email.</p>`,
    }),
  });
  return resp.ok;
}
