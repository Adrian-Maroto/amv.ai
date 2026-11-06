
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
  /* Every change, by anybody: what a restore runs under (27a-nightly-backup.js,
     Nov 3 audit DR-009). Reading, signing in and the owner's console go on. */
  writes:      { what: 'Saving changes',                prefixes: [] },          // by method, see _switchForRequest
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
  /* Any change, while a restore runs (feature:writes): refused, honestly,
     whoever makes it - a payment provider's webhook retries later. The
     owner's console is the only thing that writes. */
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS'
      && !path.startsWith('/admin/') && !path.startsWith('/v1/admin/')) {
    const w = await _switchedOff(env, 'feature:writes');
    if (w) return json({ error: 'AMV is being restored from a backup, so changes are paused for a few minutes. Nothing you had is lost - try again shortly.', code: 'paused', switch: w.name }, 503, { 'Retry-After': '300' });
  }
  const f = _switchForRequest(request, path);
  if (!f) return null;
  const hit = await _switchedOff(env, f.name);
  return hit ? _switchRefusal(hit, f.what) : null;
}

/* POST /v1/admin/switch {name, off, why}   - flip one
   GET  /v1/admin/switches                  - what exists and what is off
   Admin token only, rate limited by _adminGate, every flip audited and
   alerted, and the record keeps who-when-why so a switch left off is found. */
/* BROWNOUT: shed the heavy work, keep the product (Oct 31 audit, item 63).
   When the model provider is rationing capacity, or a launch brings more
   people than AMV can serve, the right move is not to stop everything
   (GLOBAL_KILL) but to stop what costs the most per person, so sign-in,
   payments and ordinary chat on the everyday engines keep working for
   everybody. One owner action switches these off together:
     - the engines priced above amv-core (derived from ENGINES, so a new
       expensive engine is shed without editing this list);
     - background jobs, the cloud computer, AMV's browser, speech and
       searching by meaning - the long-running and per-minute-billed work.
   Each is an ordinary switch, so people see the ordinary honest message
   ("this part of AMV is paused") and nothing is quietly swapped for
   something else. The record remembers which switches brownout turned off,
   so ending it turns back on exactly those - never a switch the owner had
   off for another reason. */
const BROWNOUT_FEATURES = ['automations', 'computer', 'browser', 'speech', 'meaning'];
const BROWNOUT_KEY = 'brownout';
function _brownoutShed() {
  const base = (ENGINES['amv-core'] || {}).outCost || 10;
  const heavy = Object.entries(ENGINES).filter(([, e]) => (e.outCost || 0) > base).map(([k]) => 'model:' + k);
  return BROWNOUT_FEATURES.map(f => 'feature:' + f).concat(heavy);
}
async function _brownoutSet(request, env, on, why) {
  let prev = null;
  try { prev = JSON.parse((await env.AMV_KV.get(BROWNOUT_KEY)) || 'null'); } catch (e) {
    return json({ error: 'The brownout record could not be read, so nothing was changed. Try again.', code: 'switches_unread' }, 503);
  }
  let current = {};
  try { current = JSON.parse((await env.AMV_KV.get(SWITCH_KEY)) || '{}') || {}; } catch (e) {
    return json({ error: 'The switches could not be read, so nothing was changed. Try again.', code: 'switches_unread' }, 503);
  }
  /* ALL AT ONCE (Nov 1 audit SEC-012). A brownout used to flip its switches
     one by one, each its own switchboard write: half-way through, servers saw
     half a brownout, and a failure part of the way left the record saying
     less than what was off. Now the whole set is ONE switchboard write and
     ONE KV write, and the record names exactly what was changed. With the
     switchboard unreachable, turning a brownout ON still lands in KV (an
     emergency brake within a minute) and says so; turning it OFF is refused,
     as for any one switch. */
  const reason = on ? 'brownout' + (why ? ': ' + why : '') : 'brownout over';
  const names = on ? _brownoutShed().filter(n => !(current[n] && current[n].off)) : ((prev && prev.shed) || []);
  if (on && prev && prev.on) return json({ ok: true, brownout: true, shed: prev.shed, note: 'Brownout was already on.' });
  if (!on && (!prev || !prev.on)) return json({ ok: true, brownout: false, restored: [], note: 'Brownout was not on.' });
  let strong = !env.AMV_COUNTER ? 'none' : 'ok';
  let m = Object.assign({}, current);
  if (env.AMV_COUNTER && names.length) {
    try {
      const r = await counter(env, SWITCHBOARD, { op: 'swSet', names, off: on, why: reason, strict: true });
      if (r && r.map) { m = Object.assign({}, m, r.map); _swStrong = { at: Date.now(), map: r.map }; _swStrongAsked = Date.now(); }
      else strong = 'failed';
    } catch (e) { strong = 'failed'; }
  }
  if (strong === 'failed' && !on)
    return json({ error: 'The switchboard could not be written, so the brownout was left on. Try again in a minute.', code: 'switchboard_unavailable' }, 503);
  for (const n of names) { if (on) m[n] = { off: true, why: reason, at: Date.now() }; else delete m[n]; }
  await env.AMV_KV.put(SWITCH_KEY, JSON.stringify(m));
  _swCache = { at: Date.now(), map: m };
  if (on) {
    await env.AMV_KV.put(BROWNOUT_KEY, JSON.stringify({ on: true, shed: names, why, at: Date.now() }));
    audit(env, 'brownout_on', { shed: names.join(','), why });
    try { await alertOnce(env, 'brownout:on', 'BROWNOUT ON: ' + names.length + ' heavy part(s) paused (' + names.join(', ') + ')' + (why ? ' - ' + why : '') + '. Sign-in, payments and chat on the everyday engines keep working.', 1); } catch (e) {}
    const body = { ok: strong !== 'failed', brownout: true, shed: names, failed: [] };
    if (strong === 'failed') Object.assign(body, { pending: true, reaches: 'every server within about a minute: the switchboard could not be written' });
    return json(body, strong === 'failed' ? 202 : 200);
  }
  await env.AMV_KV.put(BROWNOUT_KEY, JSON.stringify({ on: false, shed: [], endedAt: Date.now() }));
  audit(env, 'brownout_off', { restored: names.join(',') });
  try { await alertOnce(env, 'brownout:off', 'Brownout over: ' + names.length + ' part(s) switched back on.', 1); } catch (e) {}
  return json({ ok: true, brownout: false, restored: names, failed: [] });
}

async function adminSwitch(request, env, gated) {
  if (!gated) { const g = await _adminGate(request, env, 'switch', 30, 500); if (g) return g; }
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const body = await request.json().catch(() => ({}));
  /* POST {brownout: true|false, why} - the preset above. */
  if (typeof body.brownout === 'boolean') return _brownoutSet(request, env, body.brownout, String(body.why || '').slice(0, 200));
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
  /* NOT REPORTED AS DONE WHEN IT IS NOT (Nov 1 audit SEC-011). Switching
     something back ON with the switchboard unreachable is refused outright:
     the switchboard would still hold it off and servers would disagree.
     Switching something OFF still goes to KV - an emergency stop that lands
     within a minute beats one that never lands - but the answer says it is
     not in force everywhere yet (202, ok:false), never a plain success. */
  if (strong === 'failed' && !off) {
    audit(env, 'switch_not_flipped', { name, off, why: 'switchboard unreachable' });
    return json({ error: 'The switchboard could not be written, so ' + name + ' was left off. Try again in a minute.', code: 'switchboard_unavailable' }, 503);
  }
  if (off) m[name] = { off: true, why, at: Date.now() };
  else delete m[name];
  await env.AMV_KV.put(SWITCH_KEY, JSON.stringify(m));
  _swCache = { at: Date.now(), map: m };          // this isolate knows at once
  audit(env, 'switch_flipped', { name, off, why });
  try { await alertOnce(env, 'switch:' + name + ':' + (off ? 'off' : 'on'), (off ? 'Switched OFF: ' : 'Switched back on: ') + name + (why ? ' - ' + why : ''), 1); } catch (e) {}
  if (strong === 'failed') return json({ ok: false, pending: true, code: 'switchboard_unavailable', name, off, switches: m,
    reaches: 'every server within about a minute: the switchboard could not be written, so until then some servers may still have it on' }, 202);
  return json({ ok: true, name, off, switches: m,
    reaches: strong === 'ok' ? 'every server within seconds' : 'every server within about a minute' });
}
async function adminSwitches(request, env) {
  { const g = await _adminGate(request, env, 'read', 60, 2000); if (g) return g; }
  let m = {};
  try { m = JSON.parse((await env.AMV_KV.get(SWITCH_KEY)) || '{}') || {}; } catch (e) {}
  let brownout = null;
  try { brownout = JSON.parse((await env.AMV_KV.get(BROWNOUT_KEY)) || 'null'); } catch (e) {}
  return json({ ok: true, off: m, brownout: { on: !!(brownout && brownout.on), shed: (brownout && brownout.shed) || [], wouldShed: _brownoutShed() },
    features: Object.fromEntries(Object.entries(SWITCH_FEATURES).map(([k, f]) => [k, f.what])),
    models: Object.keys(ENGINES),
    shapes: ['feature:<name>', 'model:<engine>', 'connector:<app>', 'write:<action>'] });
}
