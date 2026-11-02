
/* ══════════════════════════════════════════════════════════════════════════
   AN AGENT'S SAVED SIGN-INS (owner decision #46, Oct 31).

   The hosted browser keeps a person signed in by handing the site's cookies
   back to THEIR browser, sealed with a key that never leaves the device. That
   needs the device. An agent working while every device is off needs the
   server to hold the sign-in - which is a store of other services'
   credentials, so every rule below exists to make it worth less to anybody
   who is not the person (docs/AGENT-SIGN-INS.md, for the outside review):

     opt-in per agent, and only for the sites it lists (at most ten);
     never a site that moves money - banks, payments, brokerages, crypto;
     sealed with AES-GCM under a key of the agent's own (below), itself
     sealed under CONNECT_KEY - forgetting destroys that key;
     each site's sign-in expires 30 days after a watched run last refreshed it;
     never in a backup; erased with the agent, the account, and on "sign out
     everywhere";
     put into and taken out of the browser by the Worker - never in a prompt,
     a log, an audit line or a result;
     saved only from a run the person watched; used unattended only to READ
     (16-agent-jobs below), never to submit, buy, send or change. */
const AGENT_SITES_MAX = 10;
const AGENT_JAR_TTL_S = 30 * 86400;
/* Sites that move money. Matched on the host's own words, so a bank's
   regional domain is caught as well as its main one. Refused when a site is
   added and again when a cookie is stored. */
/* The words a bank's address is built from match anywhere in the host
   ("mybank", "bankofireland"); a brand matches only as itself. Erring towards
   refusing a harmless site is the right way round for a store of sign-ins. */
const AGENT_MONEY_WORD = /bank|banco|banque|sparkasse|creditunion|credit-union|brokerage|crypto|wallet/i;
const AGENT_MONEY_BRAND = /(^|[.-])(paypal|venmo|zelle|stripe|squareup|cash\.app|wise|revolut|monzo|n26|chime|klarna|afterpay|affirm|coinbase|binance|kraken|robinhood|schwab|fidelity|vanguard|etrade|ibkr|interactivebrokers|chase|wellsfargo|bankofamerica|citi|citibank|hsbc|barclays|santander|capitalone|amex|americanexpress|discover|visa|mastercard|usbank|pnc|truist|ally|sofi|plaid)([.-]|$)/i;
const AGENT_MONEY_SITE = { test: (host) => AGENT_MONEY_WORD.test(String(host || '')) || AGENT_MONEY_BRAND.test(String(host || '')) };

function _agentSiteClean(raw){
  let host = String(raw || '').trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  if(!/^[a-z0-9.-]{3,253}$/.test(host) || host.indexOf('.') < 0) return { error: 'That is not a website address.' };
  if(AGENT_MONEY_SITE.test(host)) return { error: host + ' moves money, so an agent never keeps a sign-in for it. Connect it through AMV’s bank link instead, or do it yourself.', code: 'money_site' };
  if(!_webHostAllowed('https://' + host + '/').ok) return { error: host + ' is not a site AMV’s browser may open.', code: 'site_blocked' };
  return { host };
}
/* A cookie belongs to one of the agent's sites when its domain is that site
   or under it - never a sibling that happens to share a word. */
function _agentSiteOf(domain, sites){
  const d = String(domain || '').replace(/^\./, '').toLowerCase();
  return (sites || []).find(s => d === s || d.endsWith('.' + s)) || '';
}
const _agentJarKey = (email, id) => 'agentjar:' + String(email || '').toLowerCase() + ':' + id;

/* ── ONE KEY PER AGENT (Nov 1 audit AGENT-010) ─────────────────────────────

   Every agent's jar used to be sealed directly under CONNECT_KEY, so one key
   opened every stored sign-in of every person. Now each agent has a random
   256-bit key of its own (`browser.dek` on the agent's record, kept sealed
   under CONNECT_KEY - so changing CONNECT_KEY re-seals small keys, never a
   sign-in), and its jar is sealed under that key, bound to the account and
   the agent: a jar copied under another agent's name does not open.
   Forgetting every sign-in of an agent destroys its key in the same locked
   write that fences the jar, so a stale copy anywhere is unreadable for good;
   the next watched run makes a new key. A jar in the earlier format is not
   opened: it lapses, and the next watched run signs in again.
   What this does not do is keep the key that seals the keys outside the
   Worker - that is a key service, the owner's choice (OWNER-DECISIONS). */
const AGENT_JAR_FMT = 'dek1';
const _agentJarAad = (email, id) => new TextEncoder().encode('amv-agentjar\n' + String(email || '').toLowerCase() + '\n' + id);
async function _agentDekImport(env, wrapped){
  const o = await connOpen(env, wrapped);
  if(!o || typeof o.k !== 'string') throw new Error('agent_key_unreadable');
  const raw = _unb64(o.k);
  if(raw.length !== 32) throw new Error('agent_key_unreadable');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
/* The agent's key, read (or made) under the record lock - never from a copy
   of the record somebody read earlier, which may hold a key since destroyed. */
async function _agentDek(env, email, id, create){
  let wrapped = '';
  if(create){
    const fresh = crypto.getRandomValues(new Uint8Array(32));
    const sealed = await connSeal(env, { k: _b64(fresh), at: Date.now() });
    await _withKind(env, 'agents', String(email).toLowerCase(), (rec) => {
      const a = ((rec && rec.list) || []).find(x => x && x.id === id);
      if(!a) return;
      a.browser = a.browser || { keep: false, sites: [] };
      if(!a.browser.dek) a.browser.dek = sealed;
      wrapped = a.browser.dek;
    });
  } else {
    const rec = await DB.get(env, 'agents', String(email).toLowerCase());
    const a = ((rec && rec.list) || []).find(x => x && x.id === id);
    wrapped = (a && a.browser && a.browser.dek) || '';
  }
  return wrapped ? _agentDekImport(env, wrapped) : null;
}
async function _agentJarSeal(key, email, id, rec){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: _agentJarAad(email, id) }, key, new TextEncoder().encode(JSON.stringify(rec)));
  return AGENT_JAR_FMT + '.' + _b64(iv) + '.' + _b64(ct);
}
/* Opens with the agent's key, or answers null: no key (destroyed, or never
   made), another format, or not this agent's jar. */
async function _agentJarOpen(key, email, id, raw){
  const parts = String(raw || '').split('.');
  if(!key || parts.length !== 3 || parts[0] !== AGENT_JAR_FMT) return null;
  try{
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _unb64(parts[1]), additionalData: _agentJarAad(email, id) }, key, _unb64(parts[2]));
    return JSON.parse(new TextDecoder().decode(pt));
  }catch(e){ return null; }
}
async function _agentJarRead(env, email, id){
  const raw = await env.AMV_KV.get(_agentJarKey(email, id));
  if(!raw) return { raw: null, rec: null, key: null };
  let key = null; try{ key = await _agentDek(env, email, id, false); }catch(e){ key = null; }
  return { raw, rec: await _agentJarOpen(key, email, id, raw), key };
}

/* The agent's saved sign-ins, as cookies to put in a browser: only its listed
   sites, only unexpired, nothing at all when it does not keep sign-ins or the
   record cannot be opened. */
/* REVOKED BEFORE DELETED (Nov 1 audit AGENT-008/011). Forgetting a sign-in
   first stamps the agent's own record - which every use reads anyway, under
   the record lock - with when it was revoked; a jar entry saved at or before
   that moment is never used again, wherever in the world a stale copy of the
   jar is still being read and even if deleting it failed. */
function _agentJarRevoked(agent, site, v){
  const b = (agent && agent.browser) || {};
  const at = +(v && v.at) || 0;
  if(at <= (+b.revokedAt || 0)) return true;
  return at <= (+((b.revokedSites || {})[site]) || 0);
}
async function _agentJarLoad(env, email, agent){
  if(!agent || !agent.browser || !agent.browser.keep || !connConfigured(env)) return [];
  let rec = null; try{ rec = (await _agentJarRead(env, email, agent.id)).rec; }catch(e){ rec = null; }
  if(!rec || !rec.sites) return [];
  const now = Date.now(), out = [];
  for(const [site, v] of Object.entries(rec.sites)){
    if(!(agent.browser.sites || []).includes(site)) continue;
    if(!v || !(v.at > 0) || now - v.at > AGENT_JAR_TTL_S * 1000) continue;
    if(_agentJarRevoked(agent, site, v)) continue;
    for(const c of _webJarIn(v.cookies)) if(_agentSiteOf(c.domain, [site])) out.push(c);
  }
  return out;
}
/* Kept from a watched run: the cookies of the agent's listed sites, replacing
   what it held for those sites, each stamped with now. Returns the sites it
   kept, so the run can say so. */
async function _agentJarSave(env, email, agent, cookies){
  if(!agent || !agent.browser || !agent.browser.keep || !connConfigured(env)) return [];
  const sites = agent.browser.sites || [];
  const bySite = {};
  for(const c of _webJarIn(cookies)){
    const s = _agentSiteOf(c.domain, sites);
    if(!s || AGENT_MONEY_SITE.test(String(c.domain || ''))) continue;
    (bySite[s] = bySite[s] || []).push(c);
  }
  const kept = Object.keys(bySite);
  if(!kept.length) return [];
  const key = await _agentDek(env, email, agent.id, true);
  if(!key) return [];
  let rec = { sites: {} };
  try{ const raw = await env.AMV_KV.get(_agentJarKey(email, agent.id)); if(raw) rec = (await _agentJarOpen(key, email, agent.id, raw)) || rec; }catch(e){ rec = { sites: {} }; }
  rec.sites = rec.sites || {};
  for(const s of Object.keys(rec.sites)) if(!sites.includes(s)) delete rec.sites[s];
  for(const s of kept) rec.sites[s] = { at: Date.now(), cookies: bySite[s] };
  await env.AMV_KV.put(_agentJarKey(email, agent.id), await _agentJarSeal(key, email, agent.id, rec), { expirationTtl: AGENT_JAR_TTL_S });
  audit(env, 'agent_signins_kept', { email, agent: agent.id, sites: kept });
  return kept;
}
/* Which sites an agent holds a sign-in for, and until when - never the
   cookies themselves. */
async function _agentSignInsShown(env, email, agent){
  if(!agent || !agent.browser || !agent.browser.keep || !connConfigured(env)) return [];
  let rec = null;
  try{ rec = (await _agentJarRead(env, email, agent.id)).rec; }catch(e){ rec = null; }
  if(!rec || !rec.sites) return [];
  const now = Date.now();
  return Object.entries(rec.sites)
    .filter(([s, v]) => (agent.browser.sites || []).includes(s) && v && now - v.at <= AGENT_JAR_TTL_S * 1000 && !_agentJarRevoked(agent, s, v))
    .map(([s, v]) => ({ site: s, savedAt: v.at, expiresAt: v.at + AGENT_JAR_TTL_S * 1000 }));
}
/* The stamp itself, under the agents record lock. Throws if it cannot be
   written: a forget that cannot fence the credential must not say it did. */
async function _agentJarRevoke(env, email, ids, site){
  const now = Date.now();
  const want = ids ? new Set(ids) : null;
  await _withKind(env, 'agents', String(email).toLowerCase(), (rec) => {
    for(const a of (rec && rec.list) || []){
      if(!a || (want && !want.has(a.id))) continue;
      a.browser = a.browser || { keep: false, sites: [] };
      if(site){ a.browser.revokedSites = Object.assign({}, a.browser.revokedSites || {}, { [site]: now }); }
      else { a.browser.revokedAt = now; delete a.browser.dek; }
    }
    /* No record, nothing written: an erased account must not get an empty
       agents record back from the forget that runs after it is deleted. */
  });
  return now;
}
/* FORGET, AND SAY WHAT IS TRUE (AGENT-008/009). Revoked first, then
   deleted, then read back. Answers { held, removed }: `held` - there was a
   sign-in to forget; `removed` - the stored copy is confirmed gone. Not
   removed means it is fenced (unusable) and queued for another try
   (`agentjarpend:`), which the cron retries until it is gone. */
async function _agentJarForget(env, email, id, site){
  const key = _agentJarKey(email, id);
  const j = await _agentJarRead(env, email, id).catch(() => ({ raw: null, rec: null, key: null }));
  /* The whole jar: held if anything is stored, opened or not - with its key
     destroyed below it is unreadable either way. One site: only if it is in it. */
  const held = site ? !!(j.rec && j.rec.sites && j.rec.sites[site]) : !!j.raw;
  if(!held) return { held: false, removed: true };
  await _agentJarRevoke(env, email, [id], site);
  try{
    if(!site || Object.keys(j.rec.sites || {}).length <= 1) await env.AMV_KV.delete(key);
    else { delete j.rec.sites[site]; await env.AMV_KV.put(key, await _agentJarSeal(j.key, email, id, j.rec), { expirationTtl: AGENT_JAR_TTL_S }); }
  }catch(e){ /* read back below decides */ }
  let gone = false;
  try{
    const raw = await env.AMV_KV.get(key);
    if(!raw) gone = true;
    else if(site){ const after = await _agentJarOpen(j.key, email, id, raw); gone = !(after && after.sites && after.sites[site]); }
  }catch(e){ gone = false; }
  if(!gone){
    try{ await env.AMV_KV.put('agentjarpend:' + String(email).toLowerCase() + ':' + id, JSON.stringify({ site: site || '', at: Date.now() })); }catch(e){}
    audit(env, 'agent_signin_delete_pending', { email, agent: id, site: site || 'all' });
  }
  return { held: true, removed: gone };
}
/* Every agent's, at once: "sign out everywhere" and erasing the account.
   Fenced first for every agent, then deleted and checked; what is left is
   queued. Answers { removed } - false when anything is still stored. */
async function _agentJarForgetAll(env, email){
  const em = String(email || '').toLowerCase();
  try{ await _agentJarRevoke(env, em, null, ''); }catch(e){ audit(env, 'agent_signin_revoke_failed', { email: em }); }
  const prefix = 'agentjar:' + em + ':';
  const left = [];
  let cursor;
  do {
    const page = await env.AMV_KV.list({ prefix, cursor });
    for(const k of (page.keys || [])){
      try{ await env.AMV_KV.delete(k.name); }catch(e){}
      try{ if(await env.AMV_KV.get(k.name)) left.push(k.name); }catch(e){ left.push(k.name); }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while(cursor);
  for(const k of left){
    try{ await env.AMV_KV.put('agentjarpend:' + k.slice('agentjar:'.length), JSON.stringify({ site: '', at: Date.now() })); }catch(e){}
  }
  if(left.length) audit(env, 'agent_signin_delete_pending', { email: em, left: left.length });
  return { removed: !left.length };
}
/* The retry, from the cron: every forget that could not be confirmed is
   tried again until the stored copy is gone. Already fenced meanwhile. */
async function runAgentJarCleanup(env){
  let cursor, done = 0, left = 0;
  do {
    const page = await env.AMV_KV.list({ prefix: 'agentjarpend:', cursor, limit: 200 });
    for(const k of (page.keys || [])){
      const rest = k.name.slice('agentjarpend:'.length);
      const i = rest.lastIndexOf(':');
      const email = rest.slice(0, i), id = rest.slice(i + 1);
      let site = '';
      try{ site = (JSON.parse((await env.AMV_KV.get(k.name)) || '{}').site) || ''; }catch(e){}
      const key = _agentJarKey(email, id);
      try{
        if(!site) await env.AMV_KV.delete(key);
        else { const j = await _agentJarRead(env, email, id);
          /* Unopenable (its key is gone): nothing in it can be used, so it goes whole. */
          if(j.raw && !j.rec) await env.AMV_KV.delete(key);
          else if(j.rec && j.rec.sites && j.rec.sites[site]){ delete j.rec.sites[site];
            if(Object.keys(j.rec.sites).length) await env.AMV_KV.put(key, await _agentJarSeal(j.key, email, id, j.rec), { expirationTtl: AGENT_JAR_TTL_S }); else await env.AMV_KV.delete(key); } }
        const after = await _agentJarRead(env, email, id);
        const gone = !after.raw || (site && after.rec && !((after.rec.sites || {})[site])) || (site && !after.rec);
        if(gone){ await env.AMV_KV.delete(k.name); done++; } else left++;
      }catch(e){ left++; }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while(cursor);
  if(left) audit(env, 'agent_signin_delete_still_pending', { left });
  return { done, left };
}

/* POST /v1/agents/signins/forget { id, site? } - one site, or all of them. */
async function agentSignInsForget(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error: 'unauthorized' }, 401);
  if(user.via === 'apikey') return json({ error: 'Agents are changed from AMV itself, not with an API key.', code: 'session_only' }, 403);
  const body = await request.json().catch(() => ({}));
  const email = String(user.email).toLowerCase();
  const agent = await _agentFind(env, email, String(body.id || ''));
  if(!agent) return json({ error: 'That agent does not exist.', code: 'agent_unknown' }, 404);
  const site = body.site ? String(body.site).toLowerCase() : '';
  let r;
  try{ r = await _agentJarForget(env, email, agent.id, site); }
  catch(e){ if(!_isBusy(e)) throw e; return json({ error: 'That sign-in could not be forgotten right now. Nothing changed - try again in a moment.', code: 'busy' }, 503); }
  if(!r.held) return json({ error: site ? 'This agent holds no sign-in for ' + site + '.' : 'This agent holds no sign-ins.', code: 'not_held' }, 404);
  audit(env, 'agent_signins_forgotten', { email, agent: agent.id, site: site || 'all', removed: r.removed });
  const fresh = await _agentFind(env, email, agent.id) || agent;
  return json({ ok: true, removed: r.removed,
    note: r.removed ? undefined : 'It can no longer be used. The stored copy is being deleted and will be gone shortly.',
    signIns: await _agentSignInsShown(env, email, fresh) });
}

/* READ, UNATTENDED: the pages of an agent's listed sites that its job names,
   opened with its saved sign-in and read as text - no click, no form, no
   typing. What a background run is allowed to do with a sign-in nobody is
   watching. Returns [] when there is nothing to read or no browser. */
const AGENT_READ_PAGES_MAX = 3;
const AGENT_READ_CHARS_MAX = 8000;
async function _agentReadSites(env, email, agent, detail){
  if(!env.BROWSER || !agent || !agent.browser || !agent.browser.keep) return [];
  const urls = [];
  for(const m of String(detail || '').matchAll(/https?:\/\/[^\s<>"')]+/g)){
    let u; try{ u = new URL(m[0]); }catch(e){ continue; }
    if(!_agentSiteOf(u.hostname, agent.browser.sites)) continue;
    if(!_webHostAllowed(u.href).ok || AGENT_MONEY_SITE.test(u.hostname)) continue;
    if(!urls.includes(u.href)) urls.push(u.href);
    if(urls.length >= AGENT_READ_PAGES_MAX) break;
  }
  if(!urls.length) return [];
  const cookies = await _agentJarLoad(env, email, agent);
  if(!cookies.length) return [];
  let browser = null; const out = [];
  try{
    browser = await _webLaunch(env);
    const page = await browser.newPage();
    if(typeof page.setCookie === 'function') await page.setCookie(...cookies).catch(() => {});
    for(const u of urls){
      try{
        await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const text = await page.evaluate(() => (document.body && document.body.innerText) || '');
        out.push({ url: u, text: String(text || '').replace(/\s+\n/g, '\n').slice(0, AGENT_READ_CHARS_MAX) });
      }catch(e){ out.push({ url: u, text: '', error: 'could not be read' }); }
    }
  }catch(e){ return []; }
  finally{ try{ if(browser) await browser.close(); }catch(e){} }
  audit(env, 'agent_signins_used', { email, agent: agent.id, sites: [...new Set(out.map(p => { try{ return _agentSiteOf(new URL(p.url).hostname, agent.browser.sites); }catch(e){ return ''; } }))] });
  return out;
}
