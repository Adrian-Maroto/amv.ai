
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
/* MORE THAN MONEY (Nov 1 audit AGENT-012). A kept sign-in is worth whatever
   the site can do, and three more kinds of site are worth more than any
   one inbox:
     - an identity provider: signed in there is signed in everywhere it vouches
       for - the master key, not one room;
     - government: taxes, benefits, immigration, licences - acts in a person's
       legal name, and a stolen session there is identity theft;
     - health: medical records and prescriptions, the most sensitive data
       there is and the hardest to take back.
   Refused when a site is added and again when a cookie is kept, like money. */
const AGENT_IDENTITY_SITE = /(^|\.)(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com|idmsa\.apple\.com|okta\.com|oktapreview\.com|auth0\.com|onelogin\.com|duosecurity\.com|pingidentity\.com|login\.gov|id\.me|accounts\.firefox\.com|github\.com\/login)$/i;
const AGENT_GOV_SITE = /(^|\.)(gov|mil|gouv\.[a-z]{2}|gob\.[a-z]{2}|gov\.[a-z]{2}|govt\.[a-z]{2}|go\.[a-z]{2}|gc\.ca|admin\.ch|bund\.de|service\.gov\.uk|europa\.eu)$/i;
const AGENT_HEALTH_SITE = /mychart|patient|health|medical|clinic|hospital|pharmacy|doctor|epiccare|kaiserpermanente|cerner|athena(health)?|teladoc|zocdoc|cvs|walgreens|nhs\.uk/i;
function _agentSiteRisk(host){
  const h = String(host || '').toLowerCase();
  if(AGENT_MONEY_SITE.test(h)) return 'money';
  if(AGENT_IDENTITY_SITE.test(h)) return 'identity';
  if(AGENT_GOV_SITE.test(h)) return 'government';
  if(AGENT_HEALTH_SITE.test(h)) return 'health';
  return '';
}

function _agentSiteClean(raw){
  let host = String(raw || '').trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  if(!/^[a-z0-9.-]{3,253}$/.test(host) || host.indexOf('.') < 0) return { error: 'That is not a website address.' };
  const risk = _agentSiteRisk(host);
  if(risk === 'money') return { error: host + ' moves money, so an agent never keeps a sign-in for it. Connect it through AMV’s bank link instead, or do it yourself.', code: 'money_site' };
  if(risk === 'identity') return { error: host + ' signs you in to other sites, so an agent never keeps a sign-in for it - it would be a key to everything else.', code: 'identity_site' };
  if(risk === 'government') return { error: host + ' acts in your legal name (taxes, benefits, documents), so an agent never keeps a sign-in for it.', code: 'government_site' };
  if(risk === 'health') return { error: host + ' looks like a health or medical site, so an agent never keeps a sign-in for it.', code: 'health_site' };
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
/* THREE ANSWERS, NOT TWO (Nov 3 audit AGENT-019). `state` is 'absent' (the
   store said there is nothing), 'present' (something is stored - `rec` is its
   contents when they opened, null when they did not) or 'unknown' (the store
   or the key could not be asked). A read that failed used to come back as
   "nothing here", and a forget then told the person no sign-in existed while
   the sealed copy stayed stored. */
async function _agentJarRead(env, email, id){
  let raw;
  try{ raw = await env.AMV_KV.get(_agentJarKey(email, id)); }
  catch(e){ return { state: 'unknown', raw: null, rec: null, key: null }; }
  if(!raw) return { state: 'absent', raw: null, rec: null, key: null };
  let key = null, keyUnknown = false;
  try{ key = await _agentDek(env, email, id, false); }catch(e){ key = null; keyUnknown = true; }
  return { state: 'present', raw, rec: await _agentJarOpen(key, email, id, raw), key, keyUnknown };
}

/* THE GENERATION, IN STRONG STORAGE (Nov 3 audit AGENT-011/020). Every forget
   moves a number on the agent's own counter object - strongly consistent, one
   writer - before it touches anything else: `all` for every site, `s:<site>`
   for one. A kept sign-in is stamped with the numbers it was kept under and
   is used only while they are still current. So:
     - a stale copy of the agent's record anywhere in the world cannot make a
       forgotten sign-in usable, because the number is not read from it;
     - a watched run that started before the forget and finishes after it
       keeps nothing - it carries the generation it began with, and saving
       under a generation that has moved is refused;
     - a number that cannot be read is a sign-in that is not used. */
const _agentGenName = (email, id) => 'agentgen:' + String(email || '').toLowerCase() + ':' + id;
async function _agentGen(env, email, id){
  const r = await counter(env, _agentGenName(email, id), { op: 'tallyFields' });
  if(!r || !r.fields || typeof r.fields !== 'object') throw new Error('agent_generation_unknown');
  return r.fields;
}
async function _agentGenBump(env, email, id, site){
  const r = await counter(env, _agentGenName(email, id), { op: 'tallyMany', fields: { [site ? 's:' + site : 'all']: 1 } });
  if(!r || !r.many) throw new Error('agent_generation_unwritten');
}
const _agentGenOf = (gen, site) => ({ g: +((gen || {}).all) || 0, sg: +((gen || {})['s:' + site]) || 0 });
function _agentGenCurrent(gen, site, v){
  const want = _agentGenOf(gen, site);
  return (+(v && v.g) || 0) === want.g && (+(v && v.sg) || 0) === want.sg;
}
/* The generation a run began with, by the agent object it was given. */
const _agentRunGen = new WeakMap();

/* The agent's saved sign-ins, as cookies to put in a browser: only its listed
   sites, only unexpired, nothing at all when it does not keep sign-ins or the
   record cannot be opened. */
/* REVOKED BEFORE DELETED (Nov 1 audit AGENT-008/011). Forgetting a sign-in
   first stamps the agent's own record - which every use reads anyway, under
   the record lock - with when it was revoked; a jar entry saved at or before
   that moment is never used again, wherever in the world a stale copy of the
   jar is still being read and even if deleting it failed. */
function _agentJarRevoked(agent, site, v, gen){
  if(gen && !_agentGenCurrent(gen, site, v)) return true;
  const b = (agent && agent.browser) || {};
  const at = +(v && v.at) || 0;
  if(at <= (+b.revokedAt || 0)) return true;
  return at <= (+((b.revokedSites || {})[site]) || 0);
}
async function _agentJarLoad(env, email, agent){
  if(!agent || !agent.browser || !agent.browser.keep || !connConfigured(env)) return [];
  let gen;
  try{ gen = await _agentGen(env, email, agent.id); }catch(e){ return []; }
  _agentRunGen.set(agent, gen);
  let rec = null; try{ rec = (await _agentJarRead(env, email, agent.id)).rec; }catch(e){ rec = null; }
  if(!rec || !rec.sites) return [];
  const now = Date.now(), out = [];
  for(const [site, v] of Object.entries(rec.sites)){
    if(!(agent.browser.sites || []).includes(site)) continue;
    if(!v || !(v.at > 0) || now - v.at > AGENT_JAR_TTL_S * 1000) continue;
    if(_agentJarRevoked(agent, site, v, gen)) continue;
    for(const c of _webJarIn(v.cookies)) if(_agentSiteOf(c.domain, [site])) out.push(c);
  }
  return out;
}
/* Kept from a watched run: the cookies of the agent's listed sites, replacing
   what it held for those sites, each stamped with now. Returns the sites it
   kept, so the run can say so. */
/* ONE SAVE AT A TIME, FROM THE COPY THAT IS THERE (Nov 8 audit). Two runs
   of one agent each read the jar, added their own site and wrote it back:
   the second write erased the first run's sign-in, and both were told it
   was kept. A save now holds the agent's jar lock for the read, the merge
   and the write, and the strongly consistent object remembers a
   fingerprint of the copy last written. A read that does not match it is a
   stale copy from this region's KV, so it is read again until it does; one
   that still does not match after the wait is not merged into, and the save
   says so. A fingerprint older than KV takes to settle everywhere is not
   trusted over KV, so a write that could not record one heals itself. */
const AGENT_JAR_SETTLE_MS = 90000;
async function _agentJarPrint(raw){
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(raw || ''))));
  return [...d.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const _agentJarRevName = (email, id) => 'agentjarrev:' + String(email).toLowerCase() + ':' + id;
async function _agentJarMark(env, email, id, raw){
  try{ await counter(env, _agentJarRevName(email, id), { op: 'revReset', rev: Date.now(), digest: (await _agentJarPrint(raw)) + '@' + Date.now() }); }
  catch(e){ audit(env, 'agent_jar_mark_failed', { email, agent: id }); }
}
/* The jar as last written, or throws: 'unknown' when the store cannot be
   read, 'settling' when only an older copy can be seen yet. */
async function _agentJarCurrent(env, email, id){
  let want = null;
  if(env.AMV_COUNTER){
    const r = await counter(env, _agentJarRevName(email, id), { op: 'revGet' });
    if(!r || r.unavailable) throw new Error('agent_jar_unknown');
    if(r.committed && r.digest){ const [h, at] = String(r.digest).split('@'); if(Date.now() - (+at || 0) < AGENT_JAR_SETTLE_MS) want = h; }
  }
  for(let i = 0; i < 8; i++){
    let raw;
    try{ raw = await env.AMV_KV.get(_agentJarKey(email, id)); }catch(e){ throw new Error('agent_jar_unknown'); }
    if(!want || (await _agentJarPrint(raw)) === want) return raw;
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('agent_jar_settling');
}
async function _agentJarSave(env, email, agent, cookies){
  if(!agent || !agent.browser || !agent.browser.keep || !connConfigured(env)) return [];
  const sites = agent.browser.sites || [];
  const bySite = {};
  for(const c of _webJarIn(cookies)){
    const s = _agentSiteOf(c.domain, sites);
    if(!s || _agentSiteRisk(String(c.domain || '').replace(/^\./, ''))) continue;
    (bySite[s] = bySite[s] || []).push(c);
  }
  let kept = Object.keys(bySite);
  if(!kept.length) return [];
  /* Kept only under the generation the run began with. A forget since then
     (of everything, or of one site) means that site is not kept - the run
     carried a sign-in the person has taken back. */
  const began = _agentRunGen.get(agent);
  let now;
  try{ now = await _agentGen(env, email, agent.id); }catch(e){ throw new Error('agent_generation_unknown'); }
  if(!began || _agentGenOf(now, '').g !== _agentGenOf(began, '').g){
    audit(env, 'agent_signins_not_kept', { email, agent: agent.id, why: began ? 'forgotten_during_run' : 'no_generation' });
    return [];
  }
  kept = kept.filter(s => _agentGenOf(now, s).sg === _agentGenOf(began, s).sg);
  if(!kept.length) return [];
  const key = await _agentDek(env, email, agent.id, true);
  if(!key) return [];
  /* WHAT IS THERE HAS TO BE READ BEFORE IT IS REPLACED (Nov 7 audit
     AGENT-023). A read that failed started from an empty jar, so saving one
     site wiped every other sign-in the agent held. Not known now means not
     saved; a jar that is stored and will not open with the agent's key is
     unusable already (its key was destroyed or it is damaged), so it is
     replaced, and said to be. */
  /* Another run saving this agent's jar is waited for, not overwritten. */
  let lk = { claimed: false };
  for(let i = 0; i < 8 && !lk.claimed; i++){
    lk = await _claimOnceDetail(env, 'agentjarlock', String(email).toLowerCase() + ':' + agent.id, 15);
    if(!lk.claimed && !lk.unavailable) await new Promise(r => setTimeout(r, 60 * (i + 1)));
    else if(lk.unavailable) break;
  }
  if(!lk.claimed){ audit(env, 'agent_signins_not_kept', { email, agent: agent.id, why: lk.unavailable ? 'lock_unknown' : 'another_save' }); return []; }
  try{
    let rec = { sites: {} }, raw;
    try{ raw = await _agentJarCurrent(env, email, agent.id); }
    catch(e){ audit(env, 'agent_signins_not_kept', { email, agent: agent.id, why: /settling/.test(String(e && e.message)) ? 'jar_settling' : 'jar_unknown' }); return []; }
    if(raw){
      const open = await _agentJarOpen(key, email, agent.id, raw);
      if(open) rec = open; else audit(env, 'agent_jar_replaced_unreadable', { email, agent: agent.id });
    }
    rec.sites = rec.sites || {};
    for(const s of Object.keys(rec.sites)) if(!sites.includes(s)) delete rec.sites[s];
    for(const s of kept) rec.sites[s] = Object.assign({ at: Date.now(), cookies: bySite[s] }, _agentGenOf(began, s));
    const sealed = await _agentJarSeal(key, email, agent.id, rec);
    await env.AMV_KV.put(_agentJarKey(email, agent.id), sealed, { expirationTtl: AGENT_JAR_TTL_S });
    await _agentJarMark(env, email, agent.id, sealed);
  } finally { await _releaseClaim(env, 'agentjarlock', String(email).toLowerCase() + ':' + agent.id, lk.owner || null); }
  /* REVOCATION WINS A RACE IT LOST BY A MOMENT (Nov 7 audit AGENT-022). A
     forget that moved the generation between the check above and this write
     has already deleted the jar - and this write put it back. Each entry is
     stamped with the generation it was kept under, so it could never be
     used; it is still not left stored. The generation is read again after
     the write, and a write it has overtaken is taken back and its deletion
     queued, as the forget's own would be. */
  let after = null;
  try{ after = await _agentGen(env, email, agent.id); }catch(e){ after = null; }
  if(!after || _agentGenOf(after, '').g !== _agentGenOf(began, '').g || kept.some(s => _agentGenOf(after, s).sg !== _agentGenOf(began, s).sg)){
    audit(env, 'agent_signins_not_kept', { email, agent: agent.id, why: after ? 'forgotten_during_save' : 'generation_unknown_after_save' });
    try{ await env.AMV_KV.delete(_agentJarKey(email, agent.id)); await _agentJarMark(env, email, agent.id, null); }
    catch(e){ try{ await _agentJarQueue(env, email, agent.id, ''); }catch(_){ /* fenced by its generation stamp either way; the forget's own retry finds it */ } }
    return [];
  }
  audit(env, 'agent_signins_kept', { email, agent: agent.id, sites: kept });
  return kept;
}
/* Which sites an agent holds a sign-in for, and until when - never the
   cookies themselves. */
/* NOT KNOWN IS NOT NONE (Nov 7 audit AGENT-024). A list that could not be
   read came back empty, and the screen then said "not signed in yet" beside
   every site - with no Forget button - while a sealed sign-in might still be
   stored. That throws instead (`agent_signins_unknown`): the caller says the
   sign-ins could not be checked, and Forget stays offered for every site. */
async function _agentSignInsShown(env, email, agent){
  if(!agent || !agent.browser || !agent.browser.keep || !connConfigured(env)) return [];
  let gen = null;
  try{ gen = await _agentGen(env, email, agent.id); }catch(e){ gen = null; }
  const j = await _agentJarRead(env, email, agent.id).catch(() => ({ state: 'unknown' }));
  if(j.state === 'absent') return [];
  if(j.state === 'unknown' || j.keyUnknown || !gen) throw new Error('agent_signins_unknown');
  /* Stored and will not open with the agent's key - its key destroyed by a
     forget, so its deletion is already fenced and queued: nothing usable,
     and that is known, not unknown. */
  const rec = j.rec;
  if(!rec || !rec.sites) return [];
  const now = Date.now();
  return Object.entries(rec.sites)
    .filter(([s, v]) => (agent.browser.sites || []).includes(s) && v && now - v.at <= AGENT_JAR_TTL_S * 1000 && !_agentJarRevoked(agent, s, v, gen))
    .map(([s, v]) => ({ site: s, savedAt: v.at, expiresAt: v.at + AGENT_JAR_TTL_S * 1000 }));
}
/* The stamp itself, under the agents record lock. Throws if it cannot be
   written: a forget that cannot fence the credential must not say it did. */
async function _agentJarRevoke(env, email, ids, site){
  const now = Date.now();
  const want = ids ? new Set(ids) : null;
  /* The strong fence first: if it cannot be moved, this throws and nothing
     claims to be forgotten. */
  if(ids) for(const id of ids) await _agentGenBump(env, email, id, site);
  else {
    const all = await DB.get(env, 'agents', String(email).toLowerCase());
    for(const a of ((all && all.list) || [])) if(a && a.id) await _agentGenBump(env, email, a.id, site);
  }
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
  const j = await _agentJarRead(env, email, id).catch(() => ({ state: 'unknown', raw: null, rec: null, key: null }));
  /* The whole jar: held if anything is stored, opened or not - with its key
     destroyed below it is unreadable either way. One site: only if it is in
     it, and unknown when the jar is stored but could not be opened.
     UNKNOWN IS NOT ABSENT (AGENT-019): the store or the key could not be
     asked, so the sign-in is fenced and its deletion queued exactly as if it
     were held, and the answer says pending - never "nothing here". */
  const unknown = j.state === 'unknown' || (site && j.state === 'present' && !j.rec);
  const held = unknown ? 'unknown' : (site ? !!(j.rec && j.rec.sites && j.rec.sites[site]) : !!j.raw);
  if(!held) return { held: false, removed: true };
  await _agentJarRevoke(env, email, [id], site);
  if(unknown){
    const queued = await _agentJarQueue(env, email, id, site);
    audit(env, 'agent_signin_delete_pending', { email, agent: id, site: site || 'all', why: 'unreadable' });
    return { held: 'unknown', removed: false, queued };
  }
  try{
    if(!site || Object.keys(j.rec.sites || {}).length <= 1){ await env.AMV_KV.delete(key); await _agentJarMark(env, email, id, null); }
    else { delete j.rec.sites[site]; const sealed = await _agentJarSeal(j.key, email, id, j.rec); await env.AMV_KV.put(key, sealed, { expirationTtl: AGENT_JAR_TTL_S }); await _agentJarMark(env, email, id, sealed); }
  }catch(e){ /* read back below decides */ }
  let gone = false;
  try{
    const raw = await env.AMV_KV.get(key);
    if(!raw) gone = true;
    else if(site){ const after = await _agentJarOpen(j.key, email, id, raw); gone = !(after && after.sites && after.sites[site]); }
  }catch(e){ gone = false; }
  let queued = true;
  if(!gone){
    queued = await _agentJarQueue(env, email, id, site);
    audit(env, 'agent_signin_delete_pending', { email, agent: id, site: site || 'all' });
  }
  return { held: true, removed: gone, queued };
}
/* The retry's entry. Answers whether it was written: when it was not, the
   sign-in is still fenced by its generation, and the answer says the copy
   could not be queued so nobody is told it will be gone shortly. */
async function _agentJarQueue(env, email, id, site){
  try{ await env.AMV_KV.put('agentjarpend:' + String(email).toLowerCase() + ':' + id, JSON.stringify({ site: site || '', at: Date.now() })); return true; }
  catch(e){ audit(env, 'agent_signin_queue_failed', { email, agent: id }); return false; }
}
/* Every agent's, at once: "sign out everywhere" and erasing the account.
   Fenced first for every agent, then deleted and checked; what is left is
   queued. Answers { removed } - false when anything is still stored. */
async function _agentJarForgetAll(env, email){
  const em = String(email || '').toLowerCase();
  /* (AGENT-021) A fence that could not be moved, or a listing that could not
     be finished, is not "all removed". */
  let fenced = true;
  try{ await _agentJarRevoke(env, em, null, ''); }catch(e){ fenced = false; audit(env, 'agent_signin_revoke_failed', { email: em }); }
  const prefix = 'agentjar:' + em + ':';
  const left = [];
  let cursor, listed = true;
  do {
    let page;
    try{ page = await env.AMV_KV.list({ prefix, cursor }); }
    catch(e){ listed = false; break; }
    for(const k of (page.keys || [])){
      try{ await env.AMV_KV.delete(k.name); await _agentJarMark(env, em, k.name.slice(prefix.length), null); }catch(e){ /* cleanup of a record already spent or fenced; it expires or is retried on its own */ }
      try{ if(await env.AMV_KV.get(k.name)) left.push(k.name); }catch(e){ left.push(k.name); }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while(cursor);
  for(const k of left){
    try{ await env.AMV_KV.put('agentjarpend:' + k.slice('agentjar:'.length), JSON.stringify({ site: '', at: Date.now() })); }catch(e) { /* already fenced by its generation; the next forget queues it again */ }
  }
  if(!listed){
    /* `*` for every agent: the retry runs this whole forget again. */
    try{ await env.AMV_KV.put('agentjarpend:' + em + ':*', JSON.stringify({ site: '', at: Date.now() })); }catch(e) { /* already fenced by its generation; the next forget queues it again */ }
    audit(env, 'agent_signin_list_failed', { email: em });
  }
  if(left.length) audit(env, 'agent_signin_delete_pending', { email: em, left: left.length });
  return { removed: fenced && listed && !left.length, fenced, listed, left: left.length };
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
      if(id === '*'){
        try{ const r = await _agentJarForgetAll(env, email); if(r.removed){ await env.AMV_KV.delete(k.name); done++; } else left++; }catch(e){ left++; }
        continue;
      }
      let site = '';
      try{ site = (JSON.parse((await env.AMV_KV.get(k.name)) || '{}').site) || ''; }catch(e) { /* an unreadable record is treated as absent here, and the caller fails closed on absent */ }
      const key = _agentJarKey(email, id);
      try{
        if(!site){ await env.AMV_KV.delete(key); await _agentJarMark(env, email, id, null); }
        else { const j = await _agentJarRead(env, email, id);
          /* Unopenable (its key is gone): nothing in it can be used, so it goes whole. */
          if(j.raw && !j.rec){ await env.AMV_KV.delete(key); await _agentJarMark(env, email, id, null); }
          else if(j.rec && j.rec.sites && j.rec.sites[site]){ delete j.rec.sites[site];
            if(Object.keys(j.rec.sites).length){ const sealed = await _agentJarSeal(j.key, email, id, j.rec); await env.AMV_KV.put(key, sealed, { expirationTtl: AGENT_JAR_TTL_S }); await _agentJarMark(env, email, id, sealed); }
            else { await env.AMV_KV.delete(key); await _agentJarMark(env, email, id, null); } } }
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
    note: r.removed ? undefined : r.queued === false
      ? 'It can no longer be used. The stored copy could not be deleted or queued for deletion yet; AMV will keep trying when you open this again.'
      : 'It can no longer be used. The stored copy is being deleted and will be gone shortly.',
    ...(await _agentSignInsShown(env, email, fresh).then(v => ({ signIns: v }), () => ({ signIns: null, signInsUnknown: true }))) });
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
    if(!_webHostAllowed(u.href).ok || _agentSiteRisk(u.hostname)) continue;
    if(!urls.includes(u.href)) urls.push(u.href);
    if(urls.length >= AGENT_READ_PAGES_MAX) break;
  }
  if(!urls.length) return [];
  const cookies = await _agentJarLoad(env, email, agent);
  if(!cookies.length) return [];
  /* THE SIGN-IN MUST BE IN THE BROWSER BEFORE ANYTHING IS READ (Nov 1 audit
     AGENT-013). A cookie that could not be set used to be ignored: the pages
     were opened signed out - a login screen, read as though it were the
     page - and the run was recorded as having used the sign-in. Now a
     sign-in that cannot be applied opens nothing, says so on every page it
     was for, and is recorded as not applied; "used" is recorded only for
     pages actually read. */
  const failAll = (why) => urls.map(u => ({ url: u, text: '', error: why }));
  let browser = null; const out = [];
  try{
    browser = await _webLaunch(env);
    const page = await browser.newPage();
    let applied = typeof page.setCookie === 'function';
    if(applied){ try{ await page.setCookie(...cookies); }catch(e){ applied = false; } }
    if(!applied){
      audit(env, 'agent_signins_not_applied', { email, agent: agent.id });
      return failAll('the saved sign-in could not be put into the browser, so this page was not opened');
    }
    for(const u of urls){
      try{
        await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const text = await page.evaluate(() => (document.body && document.body.innerText) || '');
        out.push({ url: u, text: String(text || '').replace(/\s+\n/g, '\n').slice(0, AGENT_READ_CHARS_MAX) });
      }catch(e){ out.push({ url: u, text: '', error: 'could not be read' }); }
    }
  }catch(e){ return failAll('the browser could not be started, so this page was not opened'); }
  finally{ try{ if(browser) await browser.close(); }catch(e){ /* cleanup: nothing depends on it */ } }
  const read = out.filter(p => p.text);
  if(read.length) audit(env, 'agent_signins_used', { email, agent: agent.id, sites: [...new Set(read.map(p => { try{ return _agentSiteOf(new URL(p.url).hostname, agent.browser.sites); }catch(e){ return ''; } }))] });
  return out;
}
