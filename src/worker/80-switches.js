
/* =====================================================================
   SWITCHES - TURN ONE THING OFF, NOT EVERYTHING (scale audit #70, Oct 26)

   GLOBAL_KILL stops everything that spends. That is the right tool when the
   bill is running away and the wrong one when one supplier misbehaves: if a
   mail provider starts returning wrong results, or one engine starts failing,
   the owner should be able to stop exactly that - in seconds, from the
   console, without a deploy - while everything else keeps working.

   A switch is a name, and only these shapes exist:
     feature:<name>     one area of the product (SWITCH_FEATURES below)
     model:<engine>     one engine, by its AMV key
     connector:<app>    one connected app or account provider
     write:<action>     one kind of write on a connected account

   Held in KV as one record, read at most every ten seconds per isolate, so a
   flip reaches everybody within about a minute (KV's own spread) and costs
   nothing on the hot path. A read that fails keeps the last answer this
   isolate had, and is said: a switch that silently stops working is a switch
   somebody trusted at 3am.

   What a person sees is the truth without the internals: that this part of
   AMV is paused, and to try again later - and the code `paused`, so the page
   can say it in their language. Nothing that is off is quietly replaced by
   something else.
   ===================================================================== */
const SWITCH_KEY = 'switches';
const SWITCH_TTL_MS = 10000;
const SWITCH_NAME_RE = /^(feature|model|connector|write):[a-z0-9][a-z0-9._-]{0,59}$/;
/* Each feature, and the routes it covers. A route not listed here is covered
   by GLOBAL_KILL only. */
const SWITCH_FEATURES = {
  browser:     { what: 'AMV’s browser',            prefixes: ['/v1/browser'] },
  computer:    { what: 'The cloud computer',            prefixes: ['/v1/computer'] },
  library:     { what: 'Files in your account',         prefixes: ['/v1/library'] },
  widget:      { what: 'The website widget',            prefixes: ['/v1/widget/chat'] },
  speech:      { what: 'Speech',                        prefixes: ['/v1/audio'] },
  meaning:     { what: 'Searching by meaning',          prefixes: ['/v1/meaning'] },
  marketplace: { what: 'Buying in the marketplace',     prefixes: ['/v1/market/buy'] },
  finance:     { what: 'Bank connections',              prefixes: ['/v1/finance'] },
  telegram:    { what: 'Telegram',                      prefixes: ['/v1/telegram'] },
  sms:         { what: 'Text messages',                 prefixes: ['/sms/'] },
  api:         { what: 'The AMV API (API keys)',        prefixes: [] },          // by credential, see _switchForRequest
  automations: { what: 'Background jobs',               prefixes: ['/auto/create'] }, // and the scheduler itself
};
let _swCache = { at: 0, map: null };
async function _switches(env) {
  const now = Date.now();
  if (_swCache.map && now - _swCache.at < SWITCH_TTL_MS) return _swCache.map;
  try {
    const raw = await env.AMV_KV.get(SWITCH_KEY);
    const m = raw ? JSON.parse(raw) : {};
    _swCache = { at: now, map: (m && typeof m === 'object') ? m : {} };
  } catch (e) {
    try { audit(env, 'switches_unread', { error: String((e && e.message) || e).slice(0, 120) }); } catch (_) {}
    try { await alertOnce(env, 'switches_unread', 'The switches record could not be read; the last answer this server had is still in force.', 30); } catch (_) {}
    _swCache = { at: now, map: _swCache.map || {} };
  }
  return _swCache.map;
}
/* STRONG WHERE IT HAS TO BE (audit, Oct 31). "Within about a minute" is
   fine for a feature that is glitchy and not for a connector that is
   deleting people's data. With the counter objects bound, the switchboard
   object is the authority: read at most every SWITCH_STRONG_TTL_MS per
   server, so a flip reaches every server within seconds. If it cannot be
   asked, the KV copy answers - except for `write:` switches, where not
   knowing is treated as off: a write on somebody's account that might have
   been stopped is not made. A switchboard that answers without a map (only a
   stand-in does) is "no strong answer", and the KV copy is used. */
const SWITCH_STRONG_TTL_MS = 5000;
const SWITCHBOARD = 'switchboard';
let _swStrong = { at: 0, map: null };
/* One object everybody's request would ask - the hot key the load probe
   exists to catch - so the answer is held for SWITCH_STRONG_TTL_MS whatever it
   was, a map or "no strong answer": calls stay at one per server every few
   seconds, never one per request. A throw is not cached (the next request
   asks again, and a write meanwhile is refused). */
let _swStrongAsked = 0;
async function _switchesStrong(env) {
  const now = Date.now();
  if (now - _swStrongAsked < SWITCH_STRONG_TTL_MS) return _swStrong.map;
  const r = await counter(env, SWITCHBOARD, { op: 'swGet', strict: true });   // throws when unreachable
  const map = (r && r.map && typeof r.map === 'object') ? r.map : null;
  _swStrong = { at: now, map };
  _swStrongAsked = now;
  return map;
}
/* The first of `names` that is switched off, with why; null when none is. */
async function _switchedOff(env, ...names) {
  let m = null, unreachable = false;
  if (env && env.AMV_COUNTER) {
    try { m = await _switchesStrong(env); }
    catch (e) {
      unreachable = true;
      try { audit(env, 'switchboard_unread', { error: String((e && e.message) || e).slice(0, 120) }); } catch (_) {}
      try { await alertOnce(env, 'switchboard_unread', 'The switchboard object could not be read: writes on connected accounts are refused until it answers; other switches use the KV copy.', 15); } catch (_) {}
    }
  }
  if (!m) m = await _switches(env);
  for (const n of names) {
    if (!n) continue;
    if (m[n] && m[n].off) return { name: n, why: String(m[n].why || '') };
    if (unreachable && n.startsWith('write:')) return { name: n, why: 'the switchboard could not be read' };
  }
  return null;
}
function _switchRefusal(hit, what) {
  return json({ error: (what || 'This part of AMV') + ' is paused right now. Everything else is working. Try again a little later.',
                code: 'paused', switch: hit.name }, 503, { 'Retry-After': '300' });
}
/* Which feature switch covers this request, if any. */
function _switchForRequest(request, path) {
  for (const [id, f] of Object.entries(SWITCH_FEATURES)) {
    const hit = f.prefixes.some(p => p.endsWith('/') ? path.startsWith(p) : (path === p || path.startsWith(p + '/')));
    if (hit) return { name: 'feature:' + id, what: f.what };
  }
  const auth = request.headers.get('Authorization') || '';
  if (/^Bearer\s+amv_sk_/i.test(auth) || /^amv_sk_/.test(request.headers.get('X-AMV-Key') || '')) return { name: 'feature:api', what: SWITCH_FEATURES.api.what };
  return null;
}
async function _switchGate(request, env, path) {
  const f = _switchForRequest(request, path);
  if (!f) return null;
  const hit = await _switchedOff(env, f.name);
  return hit ? _switchRefusal(hit, f.what) : null;
}

/* POST /v1/admin/switch {name, off, why}   - flip one
   GET  /v1/admin/switches                  - what exists and what is off
   Admin token only, rate limited by _adminGate, every flip audited and
   alerted, and the record keeps who-when-why so a switch left off is found. */
async function adminSwitch(request, env) {
  { const g = await _adminGate(request, env, 'switch', 30, 500); if (g) return g; }
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '').toLowerCase().trim();
  if (!SWITCH_NAME_RE.test(name)) return json({ error: 'A switch is feature:, model:, connector: or write: followed by a name.', code: 'bad_switch' }, 400);
  if (name.startsWith('feature:') && !SWITCH_FEATURES[name.slice(8)])
    return json({ error: 'There is no feature called ' + name.slice(8) + '.', code: 'bad_switch', features: Object.keys(SWITCH_FEATURES) }, 400);
  const off = !!body.off;
  const why = String(body.why || '').slice(0, 200);
  let m = {};
  try { m = JSON.parse((await env.AMV_KV.get(SWITCH_KEY)) || '{}') || {}; } catch (e) {
    return json({ error: 'The switches could not be read, so nothing was changed. Try again.', code: 'switches_unread' }, 503);
  }
  /* The switchboard first: that is the moment the switch takes effect
     everywhere. KV is the copy the fallback reads. A switchboard that cannot
     take it is said - the KV copy still reaches everybody within a minute. */
  let strong = !env.AMV_COUNTER ? 'none' : 'ok';
  if (env.AMV_COUNTER) {
    try {
      const r = await counter(env, SWITCHBOARD, { op: 'swSet', name, off, why, strict: true });
      if (r && r.map) { m = Object.assign({}, m, r.map); if (!off) delete m[name]; _swStrong = { at: Date.now(), map: r.map }; _swStrongAsked = Date.now(); }
      else strong = 'failed';
    } catch (e) { strong = 'failed'; }
  }
  if (off) m[name] = { off: true, why, at: Date.now() };
  else delete m[name];
  await env.AMV_KV.put(SWITCH_KEY, JSON.stringify(m));
  _swCache = { at: Date.now(), map: m };          // this isolate knows at once
  audit(env, 'switch_flipped', { name, off, why });
  try { await alertOnce(env, 'switch:' + name + ':' + (off ? 'off' : 'on'), (off ? 'Switched OFF: ' : 'Switched back on: ') + name + (why ? ' - ' + why : ''), 1); } catch (e) {}
  return json({ ok: true, name, off, switches: m,
    reaches: strong === 'ok' ? 'every server within seconds' : 'every server within about a minute (the switchboard could not be written)' });
}
async function adminSwitches(request, env) {
  { const g = await _adminGate(request, env, 'read', 60, 2000); if (g) return g; }
  let m = {};
  try { m = JSON.parse((await env.AMV_KV.get(SWITCH_KEY)) || '{}') || {}; } catch (e) {}
  return json({ ok: true, off: m,
    features: Object.fromEntries(Object.entries(SWITCH_FEATURES).map(([k, f]) => [k, f.what])),
    models: Object.keys(ENGINES),
    shapes: ['feature:<name>', 'model:<engine>', 'connector:<app>', 'write:<action>'] });
}
