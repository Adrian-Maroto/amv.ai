
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
     sealed with AES-GCM under CONNECT_KEY, the seal connected accounts use;
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
const AGENT_MONEY_BRAND = /(^|[.-])(paypal|venmo|zelle|stripe|squareup|cash\.app|wise|revolut|monzo|n26|chime|klarna|afterpay|affirm|coinbase|binance|kraken|gemini|robinhood|schwab|fidelity|vanguard|etrade|ibkr|interactivebrokers|chase|wellsfargo|bankofamerica|citi|citibank|hsbc|barclays|santander|capitalone|amex|americanexpress|discover|visa|mastercard|usbank|pnc|truist|ally|sofi|plaid)([.-]|$)/i;
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

/* The agent's saved sign-ins, as cookies to put in a browser: only its listed
   sites, only unexpired, nothing at all when it does not keep sign-ins or the
   record cannot be opened. */
async function _agentJarLoad(env, email, agent){
  if(!agent || !agent.browser || !agent.browser.keep || !connConfigured(env)) return [];
  const raw = await env.AMV_KV.get(_agentJarKey(email, agent.id));
  if(!raw) return [];
  let rec = null; try{ rec = await connOpen(env, raw); }catch(e){ rec = null; }
  if(!rec || !rec.sites) return [];
  const now = Date.now(), out = [];
  for(const [site, v] of Object.entries(rec.sites)){
    if(!(agent.browser.sites || []).includes(site)) continue;
    if(!v || !(v.at > 0) || now - v.at > AGENT_JAR_TTL_S * 1000) continue;
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
  let rec = { sites: {} };
  try{ const raw = await env.AMV_KV.get(_agentJarKey(email, agent.id)); if(raw) rec = (await connOpen(env, raw)) || rec; }catch(e){ rec = { sites: {} }; }
  rec.sites = rec.sites || {};
  for(const s of Object.keys(rec.sites)) if(!sites.includes(s)) delete rec.sites[s];
  for(const s of kept) rec.sites[s] = { at: Date.now(), cookies: bySite[s] };
  await env.AMV_KV.put(_agentJarKey(email, agent.id), await connSeal(env, rec), { expirationTtl: AGENT_JAR_TTL_S });
  audit(env, 'agent_signins_kept', { email, agent: agent.id, sites: kept });
  return kept;
}
/* Which sites an agent holds a sign-in for, and until when - never the
   cookies themselves. */
async function _agentSignInsShown(env, email, agent){
  if(!agent || !agent.browser || !agent.browser.keep || !connConfigured(env)) return [];
  let rec = null;
  try{ const raw = await env.AMV_KV.get(_agentJarKey(email, agent.id)); if(raw) rec = await connOpen(env, raw); }catch(e){ rec = null; }
  if(!rec || !rec.sites) return [];
  const now = Date.now();
  return Object.entries(rec.sites)
    .filter(([s, v]) => (agent.browser.sites || []).includes(s) && v && now - v.at <= AGENT_JAR_TTL_S * 1000)
    .map(([s, v]) => ({ site: s, savedAt: v.at, expiresAt: v.at + AGENT_JAR_TTL_S * 1000 }));
}
async function _agentJarForget(env, email, id, site){
  const key = _agentJarKey(email, id);
  if(!site){ await env.AMV_KV.delete(key); return true; }
  let rec = null;
  try{ const raw = await env.AMV_KV.get(key); if(raw) rec = await connOpen(env, raw); }catch(e){ rec = null; }
  if(!rec || !rec.sites || !rec.sites[site]) return false;
  delete rec.sites[site];
  if(!Object.keys(rec.sites).length) await env.AMV_KV.delete(key);
  else await env.AMV_KV.put(key, await connSeal(env, rec), { expirationTtl: AGENT_JAR_TTL_S });
  return true;
}
/* Every agent's, at once: "sign out everywhere" and erasing the account. */
async function _agentJarForgetAll(env, email){
  const prefix = 'agentjar:' + String(email || '').toLowerCase() + ':';
  let cursor;
  do {
    const page = await env.AMV_KV.list({ prefix, cursor });
    for(const k of (page.keys || [])) await env.AMV_KV.delete(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while(cursor);
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
  await _agentJarForget(env, email, agent.id, site);
  audit(env, 'agent_signins_forgotten', { email, agent: agent.id, site: site || 'all' });
  return json({ ok: true, signIns: await _agentSignInsShown(env, email, agent) });
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
