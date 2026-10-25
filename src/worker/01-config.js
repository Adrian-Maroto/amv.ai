/* =====================================================================
   AMV.AI - PRODUCTION BACKEND (Cloudflare Worker)
   The real, fundable backend. Makes every feature WORK and SAFE:
     • AI proxy (/v1/messages)  - streaming, key hidden server-side
     • Server-side PLAN enforcement (free can't call premium models)
     • Per-account token QUOTAS (daily + monthly) - real margin control
     • Per-account + per-IP RATE LIMITS
     • GLOBAL spend cap + KILL SWITCH
     • Usage + cost tracking per user (KV)
     • Payments (Stripe + PayPal) - from the payments worker
   ---------------------------------------------------------------------
   This is what converts AMV from "demo" to "live product you can fund."
   Deploy guide at the bottom.
   ===================================================================== */

// CORS - wildcard origin is fine for a token-authenticated public API (the
// token, not the origin, is the security boundary). To lock the browser API
// to ONLY your frontend in production, replace '*' with your domain, e.g.
// 'https://app.yourdomain.com'. Webhooks are server-to-server and need no CORS.
/* AN ORIGIN IS A SCHEME AND A HOST. NOTHING ELSE, AND NOTHING AROUND IT.

   The browser's `Origin` header is exactly `https://amv.homes` - never with a
   trailing slash, never with a path, never padded. `Access-Control-Allow-Origin`
   has to match it character for character or the browser rejects the response,
   so `https://amv.homes/` - one keystroke, and the shape a person naturally
   types or copies out of an address bar - takes every browser call to this API
   down at once, for everybody, on the deployment that has just launched.

   `wrangler secret put` reads the value from stdin, which is the other way this
   arrives wrong: a trailing newline is invisible and equally fatal.

   Normalised rather than refused. The intent of `https://amv.homes/` is not in
   doubt, and a launched site staying up beats being right about punctuation.
   The readiness screen reports the correction so it gets fixed at the source
   instead of living here forever. */
const _originOf = (raw) => {
  const v = String(raw == null ? '' : raw).trim();
  if (!v || v === '*') return v;
  try {
    const u = new URL(v);
    return u.origin;                    // scheme + host + non-default port
  } catch (e) {
    return v.replace(/\/+$/, '');       // not a URL at all - hand it back trimmed
  }
};
const _corsOrigin = (env) => _originOf(env && env.ALLOWED_ORIGIN) || '*';
/* THE SAME SERVER, ALSO AT THE SITE'S OWN ADDRESS.

   The API lives on its own host. Safari counts a cookie set by a host on a
   different network address as third party and deletes it after seven days,
   so a person who opens AMV once a week on an iPhone signed in every visit.
   The cure is to serve the API from the site's own address under `/api`, where
   its cookies are first party.

   Mounted by HOST, not by path alone: this server already has routes named
   `/api/jobs` and friends, and on its own host those must keep their names. On
   the site's host the server is reached only through `/api`, so there the
   prefix is the mount and nothing else. Everything below the router sees the
   path it always saw; the response's cookies are re-scoped to the mount, and
   links the server writes to itself carry it (`_publicOrigin`). */
const API_MOUNT = '/api';
const _mountedAt = new WeakMap();
function _mountRequest(request, env) {
  let u; try { u = new URL(request.url); } catch (e) { return null; }
  if (u.pathname !== API_MOUNT && !u.pathname.startsWith(API_MOUNT + '/')) return null;
  const site = [_originOf(env && env.ALLOWED_ORIGIN), _originOf(env && env.APP_URL)];
  if (!site.includes(u.origin)) return null;
  u.pathname = u.pathname.slice(API_MOUNT.length) || '/';
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const inner = new Request(u.toString(), { method: request.method, headers: request.headers,
    body: hasBody ? request.body : null, redirect: request.redirect, cf: request.cf, duplex: 'half' });
  _mountedAt.set(inner, API_MOUNT);
  return inner;
}
function _publicOrigin(request) {
  return new URL(request.url).origin + (_mountedAt.get(request) || '');
}
function _mountCookies(response, mounted) {
  if (!mounted) return response;
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (!cookies.some(c => /;\s*Path=\/auth\b/i.test(c))) return response;
  const out = new Response(response.body, response);
  out.headers.delete('Set-Cookie');
  for (const c of cookies) out.headers.append('Set-Cookie', c.replace(/;\s*Path=\/auth\b/i, '; Path=' + API_MOUNT + '/auth'));
  return out;
}
const corsFor = (env) => ({
  'Access-Control-Allow-Origin': _corsOrigin(env),
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-AMV-Request-Id',
});
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-AMV-Request-Id',
  // The browser cannot read a custom response header cross-origin unless it is
  // exposed. Without this the routed-engine name is invisible to the app.
  'Access-Control-Expose-Headers': 'X-AMV-Engine, X-AMV-Effort, X-AMV-Speed, X-AMV-Engine-Why, X-AMV-Answer-Cap',
};
// Security headers applied to every response. Protects users against clickjacking,
// MIME-sniffing, protocol downgrade, and referrer leakage. CSP here is API-appropriate
// (the API returns JSON, not HTML) - the static site sets its own page-level CSP.
const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-site',
};
/* `extra` is for headers that are part of the ANSWER rather than the policy -
   Retry-After on a refusal being the one that matters: a 429 with no idea how
   long to wait sends the caller straight back into the same wall. */
/* NO-STORE BY DEFAULT, BECAUSE THE CLIENT ALREADY HONOURS IT AND THE SERVER
   NEVER SAID IT.

   The service worker's caching rule reads Cache-Control and refuses to store
   anything marked no-store or private - its comment says that is "how a
   server says this is about one person". Every JSON answer here went out with
   no Cache-Control at all, so that rule had nothing to act on: `storable` was
   true for a wallet balance, a team roster and a chat list alike.

   Today that is latent rather than live. `amv-api-base` points at the Worker
   on its own origin, and the service worker returns early for anything
   cross-origin, so nothing of this kind is being cached right now. It stops
   being latent the moment somebody routes the Worker on the site's own
   domain, which is an ordinary Cloudflare setup and would need no change
   here to take effect. A header is a cheaper defence than remembering.

   It is a DEFAULT, not a policy: `extra` spreads last, so the handful of
   genuinely public answers that opt into `public, max-age=...` - the pricing
   page's counts, the model catalogue, the public config - still win. */
const json = (o, s = 200, extra) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...SECURITY_HEADERS, ...(extra || {}) } });

/* ---- model catalog: maps AMV model -> real engine + cost + min plan ---- */
/* ---- model catalog ---------------------------------------------------------
   AMV-067. Three things live here and each one is load-bearing:

   inCost/outCost are REAL published rates per million tokens. They were not:
   Forge was priced at 15/75 and Apex at 20/100 against actual rates of 5/25
   and 10/50. Nothing overcharged a customer, but the margin backstop below
   spends against these numbers - a Pro plan allows planPrice * 0.45 of model
   cost per month, so a 3x overstatement meant a paying user was cut off after
   burning a third of the allowance their money actually covers. Correct
   numbers mean the same protected margin buys two to three times the usage.

   cacheMin is the smallest prefix the model will actually cache; below it a
   cache_control marker is silently ignored while still costing a write.

   thinking/effort are explicit ON PURPOSE. On the current generation a request
   that simply omits `thinking` gets it enabled by default, and max_tokens caps
   thinking PLUS the answer - so inheriting an output cap sized for text alone
   truncates replies mid-sentence. Disabling it instead is worse here: with
   thinking off, a tool call can be written into the visible text and silently
   never run, which for a product with a live web-search tool means an answer
   that quietly did no research. So thinking stays on, effort controls the
   spend, and the output caps are sized to hold both.
   --------------------------------------------------------------------------- */
/* ── THE LADDER, AND WHAT THE CHEAPEST PAID RUNG IS ───────────────────────
   The paid floor runs the top-tier engine. That is a decision about what AMV
   is: the least somebody can spend to become a customer buys the best widely
   released model, and the tiers above it buy more of it rather than a better
   one. It costs twice what the previous paid floor cost per token, and the
   margin backstop below is unchanged, so the same money buys about half the
   tokens it used to - that is the trade, made deliberately, and the allowance
   is the owner's dial if it needs moving.

   Free stays on the cheaper engine, because free is where cost has no
   ceiling. A model that loses money on every request, on the tier with the
   most accounts and no revenue, is the decision that ends companies.

   Above the floor is the SUCCESSOR of the same family at the same published
   rate, which is the only honest way to sell a rung above a top model:
   nothing cheaper would be better, and nothing better is cheaper.

   COSTS ARE PUBLISHED RATES, CHECKED, NOT REMEMBERED. The core engine sat at
   3/15 - the previous generation's rate for a model that now bills 2/10. The
   backstop spends against these numbers, so a 1.5x overstatement cut a paying
   customer off after burning two thirds of what their money actually covers,
   silently, exactly as the note above this table warns. Corrected here.
   -------------------------------------------------------------------------- */
/* 2026-10-08: the 5.5 generation, from the published price list.

   Pulse moves to the newest small model. It is billed by prompt length - 0.10/
   0.50 up to 100k tokens, 0.50/2.50 above - and the backstop spends against
   ONE number per engine, so it is costed at the higher band. On a short prompt
   that overstates the cost five times, which only means the meter is cautious;
   the opposite choice would let a long prompt cost five times what it is
   counted as, and the backstop exists to make that impossible. Even at the
   higher band it is half of the previous small model.

   The new small model THINKS BY DEFAULT, and thinking counts against
   max_tokens - so leaving it as an engine with no thinking setting, as the old
   one was, would have given it medium-effort thinking inside a 4,000-token cap
   and cut quick answers off mid-sentence. It is now stated: adaptive thinking
   at LOW effort, the level its documentation names for chat and short tasks,
   with the same 16k headroom the other thinking engines have.

   Core moves to the next model of its line at the same published rate. Its
   effort levels were recalibrated, and medium remains the documented starting
   point for chat. Forge and Apex are unchanged: the top model is already the
   newest, and moving the paid floor is a pricing decision, not a version bump. */
/* `context` is how many tokens each engine reads in one request - one million
   on every engine here, from the provider's model table (it is also what the
   Models API reports as max_input_tokens). AMV capped every request at about
   150,000 tokens of input, so a long document was cut into parts and read as
   notes when the engine could have read it whole. aiProxy now checks a request
   against its engine's own context instead (_fitsContext). */
const ENGINE_CONTEXT_TOKENS = 1000000;
const ENGINES = {
  'amv-pulse': { model: 'claude-haiku-5-5',          minPlan: 'free', context: ENGINE_CONTEXT_TOKENS,  inCost: 0.5, outCost: 2.5, maxOut: 16000, cacheMin: 4096, thinking: true, effort: 'low' },
  'amv-core':  { model: 'claude-sonnet-5-5',         minPlan: 'free', context: ENGINE_CONTEXT_TOKENS,  inCost: 2,  outCost: 10,  maxOut: 16000, cacheMin: 1024, thinking: true, effort: 'medium' },
  'amv-forge': { model: 'claude-fable-5',            minPlan: 'pro', context: ENGINE_CONTEXT_TOKENS,   inCost: 10, outCost: 50,  maxOut: 32000, cacheMin: 512,  thinking: true, effort: 'high' },
  'amv-apex':  { model: 'claude-fable-5-1',          minPlan: 'elite', context: ENGINE_CONTEXT_TOKENS, inCost: 10, outCost: 50,  maxOut: 32000, cacheMin: 512,  thinking: true, effort: 'high' },
  /* SWIFT: a top engine answering at up to two and a half times the speed.
     Fast mode exists on one model family only and costs twice its standard
     rate, which is what these prices are. Still below Forge, so it sits on
     the paid floor. Low effort by default, because somebody who chose speed
     chose it. When fast capacity is busy the turn runs at standard speed and
     is billed at the standard rate - see the 429 handling in aiProxy. */
  'amv-swift': { model: 'claude-opus-5-5',           minPlan: 'pro', context: ENGINE_CONTEXT_TOKENS,   inCost: 8,  outCost: 40,  maxOut: 32000, cacheMin: 1024, thinking: true, effort: 'low', speed: 'fast', stdIn: 4, stdOut: 20 },
};
const FAST_MODE_BETA = 'fast-mode-2026-02-01';

