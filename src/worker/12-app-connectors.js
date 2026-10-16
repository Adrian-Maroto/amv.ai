    let joined;
    try{
      joined = await _withTeam(env, team.id, (fresh) => {
        if(!fresh) return { error:'gone' };
        fresh.members = fresh.members || [];
        if(fresh.members.find(m => m.email === email)) return { already:true };
        const limit = _teamSeatLimit(_teamPlan(fresh), fresh.customCfg);
        if(fresh.members.length >= limit) return { error:'seat_limit' };
        fresh.members.push({ email, role:'member', joinedAt: Date.now(), via:'sso' });
        return { joined:true };
      });
    }catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
    if(joined && joined.error === 'seat_limit')
      return json({ error:'Your company’s AMV team has no free seats. Ask whoever runs it to add one.', code:'seat_limit' }, 402);
    if(joined && joined.error) return json({ error:'Your company no longer signs in this way.', code:'sso_off' }, 400);
    try{
      await env.AMV_KV.put('userteam:' + email, team.id);
      await _setUserTeam(env, email, team.id);
    }catch(e){
      try{ await _withTeam(env, team.id, (fresh) => { if(fresh) fresh.members = (fresh.members || []).filter(m => m.email !== email); return true; }); }catch(_){}
      return json({ error:'AMV could not finish signing you in. Nothing was changed - please try again.', code:'join_incomplete' }, 503);
    }
    if(joined && joined.joined) await _teamAudit(env, team, email, 'member_joined', { via:'sso' });
  }
  audit(env, 'sso_signed_in', { team: team.id });
  await _userEvent(env, request, email, 'signed_in', { reason: 'company sign-in' });
  const tokens = await issueTokens(env, email, acct.name || name, await _sessOpen(env, request, email));
  return _tokenResponse(env, tokens, { email, name: acct.name || name, team: team.name || '' });
}

async function googlePickerConfig(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const clientId = String(env.GOOGLE_CLIENT_ID || ''), apiKey = String(env.GOOGLE_PICKER_API_KEY || '');
  const appId = String(env.GOOGLE_PROJECT_NUMBER || '').trim();
  if(!clientId || !apiKey || !/^\d{6,20}$/.test(appId)) return json({ ok:true, configured:false });
  return json({ ok:true, configured:true, clientId, apiKey, appId });
}

async function connRemove(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  /* This reaches a third party - the provider's revoke endpoint - so it is
     bounded like everything else that does. Generous, because disconnecting is
     something somebody should never feel discouraged from doing, and bounded,
     because an unbounded outbound call is an unbounded outbound call even when
     the intent behind it is good. */
  const blocked = await guardAction(env, 'connrm:' + user.email, 20, 200, 'disconnections');
  if(blocked) return blocked;

  const body = await request.json().catch(()=>({}));
  const id = String(body.id||'');
  const all = (await DB.get(env, CONN_KV, user.email)) || {};
  const c = all[id];
  if(!c) return json({ error:'not_found' }, 404);
  const p = CONN_PROVIDERS[c.provider] || {};

  let revoked = false, why = '';
  if(p.revoke){
    try{
      const tok = await connOpen(env, c.sealed);
      const r = await _connRevokeRequest(env, p, tok);
      revoked = r.ok;
      if(!revoked) why = 'http_' + (r.status || 'no_response');
    }catch(e){ why = String((e && e.message) || 'failed').slice(0, 60); }
  }

  /* Forgotten either way. Keeping a token AMV could not revoke would be holding
     a credential the person has asked it to stop holding - the honest failure
     is to drop it here and tell them to finish the job at the provider. */
  await _connMerge(env, user.email, (rec) => { delete rec[id]; });
  audit(env, 'conn_removed', { by:user.email, provider:c.provider, revoked, why });

  return json({ ok:true, revoked,
    message: revoked
      ? 'Disconnected, and the grant was revoked at ' + (p.name||c.provider) + '.'
      : (p.revoke
          ? 'AMV forgot this account, but ' + (p.name||c.provider) + ' did not confirm the grant was revoked' + (why?' ('+why+')':'') + '. Remove it in your ' + (p.name||c.provider) + ' account to be certain.'
          : 'AMV forgot this account and can no longer use it. ' + (p.revokeNote || (p.name||c.provider) + ' has no revoke endpoint, so end it there too if you want the grant gone.')) });
}

/* ══════════════════════════════════════════════════════════════════════════
   APP CONNECTORS: SIGNING IN TO AN APP'S OWN CONNECTOR.

   The owner asked for AMV to connect to the apps people use the way the best
   assistants do - press Connect, sign in at the app, done. Many of the largest
   apps now publish an official remote connector (MCP over HTTP) whose sign-in
   is standard OAuth with DYNAMIC CLIENT REGISTRATION: AMV registers itself with
   the app on first use, so there is no per-app key for anybody to paste. That
   is what makes it scale - the alternative, a client id and secret registered
   by hand with every provider, is how CONN_PROVIDERS works and why it has
   three rows.

   WHICH APPS, AND HOW THEY WERE CHOSEN. Each entry below was read from the
   official MCP registry (registry.modelcontextprotocol.io), and each is
   published under the app's own verified namespace - `com.notion`,
   `app.linear`, `io.github.getsentry` - which the registry grants only to
   whoever proves they own that domain or organisation. Look-alikes published
   by third parties (there are many, and some proxy a real app through their
   own servers) are not here. A connector somebody else runs in front of your
   Notion is a stranger holding your Notion token.

   WHAT AMV HOLDS. Per person, per app: the access and refresh token, sealed
   with the same deployment key as Connected accounts (CONNECT_KEY), under
   `rmcp:<email>`. The browser never receives either - it asks the server to
   list an app's tools or run one, and gets the result.

   WHAT EVERY OUTBOUND REQUEST GOES THROUGH. fetchGuarded: public https hosts
   only, every redirect hop re-checked, and no Authorization header across an
   origin boundary. The discovery documents an app serves are addresses chosen
   by that app, so each endpoint they name is checked the same way before it is
   used - an https host that is not internal, or nothing.

   WHAT IT DOES NOT DO. Run anything on its own. Tools are offered to chat, and
   each call is asked for, with its arguments shown, before it runs - the same
   rule as a connector on somebody's computer, because AMV cannot judge the
   risk of a tool somebody else wrote.
   ══════════════════════════════════════════════════════════════════════════ */
const REMOTE_APPS = {
  notion:    { name: 'Notion',              reg: 'com.notion/mcp',                     url: 'https://mcp.notion.com/mcp' },
  linear:    { name: 'Linear',              reg: 'app.linear/linear',                  url: 'https://mcp.linear.app/mcp' },
  canva:     { name: 'Canva',               reg: 'com.canva.mcp/mcp',                  url: 'https://mcp.canva.com/mcp' },
  atlassian: { name: 'Jira and Confluence', reg: 'com.atlassian/atlassian-mcp-server', url: 'https://mcp.atlassian.com/v1/mcp' },
  sentry:    { name: 'Sentry',              reg: 'io.github.getsentry/sentry-mcp',     url: 'https://mcp.sentry.dev/mcp' },
  stripe:    { name: 'Stripe',              reg: 'com.stripe/mcp',                     url: 'https://mcp.stripe.com' },
  paypal:    { name: 'PayPal',              reg: 'com.paypal.mcp/mcp',                 url: 'https://mcp.paypal.com/mcp' },
  webflow:   { name: 'Webflow',             reg: 'com.webflow/mcp',                    url: 'https://mcp.webflow.com/mcp' },
  wix:       { name: 'Wix',                 reg: 'com.wix/mcp',                        url: 'https://mcp.wix.com/mcp' },
  monday:    { name: 'Monday.com',          reg: 'com.monday/monday.com',              url: 'https://mcp.monday.com/mcp' },
  figma:     { name: 'Figma',               reg: 'com.figma.mcp/mcp',                  url: 'https://mcp.figma.com/mcp' },
  zapier:    { name: 'Zapier',              reg: 'com.zapier/mcp',                     url: 'https://mcp.zapier.com/api/v1/connect' },
  vercel:    { name: 'Vercel',              reg: 'com.vercel/vercel-mcp',              url: 'https://mcp.vercel.com' },
  airtable:  { name: 'Airtable',            reg: 'com.airtable/mcp',                   url: 'https://mcp.airtable.com/mcp' },
  gitlab:    { name: 'GitLab',              reg: 'com.gitlab/mcp',                     url: 'https://gitlab.com/api/v4/mcp' },
  supabase:  { name: 'Supabase',            reg: 'com.supabase/mcp',                   url: 'https://mcp.supabase.com/mcp' },
  postman:   { name: 'Postman',             reg: 'com.postman/postman-mcp-server',     url: 'https://mcp.postman.com/mcp' },
  close:     { name: 'Close',               reg: 'com.close/close-mcp',                url: 'https://mcp.close.com/mcp' },
  /* The second sweep, across every app still on Notify me - the same rule:
     the registry entry sits under the app's own verified namespace. */
  todoist:   { name: 'Todoist',             reg: 'net.todoist/mcp',                    url: 'https://ai.todoist.net/mcp' },
  miro:      { name: 'Miro',                reg: 'io.github.miroapp/mcp-server',       url: 'https://mcp.miro.com/' },
  craft:     { name: 'Craft',               reg: 'do.craft.mcp/server',                url: 'https://mcp.craft.do/my/mcp' },
  zomato:    { name: 'Zomato',              reg: 'com.zomato/mcp',                     url: 'https://mcp-server.zomato.com/mcp' },
  typeform:  { name: 'Typeform',            reg: 'com.typeform/typeform',              url: 'https://api.typeform.com/mcp' },
  jotform:   { name: 'Jotform',             reg: 'com.jotform/mcp',                    url: 'https://mcp.jotform.com/' },
  make:      { name: 'Make',                reg: 'com.make/mcp-server',                url: 'https://mcp.make.com' },
  ifttt:     { name: 'IFTTT',               reg: 'com.ifttt/mcp',                      url: 'https://ifttt.com/mcp' },
  amplitude: { name: 'Amplitude',           reg: 'com.amplitude/mcp-server',           url: 'https://mcp.amplitude.com/mcp' },
  cloudflare:{ name: 'Cloudflare',          reg: 'com.cloudflare.mcp/mcp',             url: 'https://bindings.mcp.cloudflare.com/mcp' },
  grafana:   { name: 'Grafana',             reg: 'io.github.grafana/mcp-grafana',      url: 'https://mcp.grafana.com/mcp' },
  uptimerobot:{ name: 'UptimeRobot',        reg: 'com.uptimerobot/uptimerobot',        url: 'https://mcp.uptimerobot.com/mcp' },
  virustotal:{ name: 'VirusTotal',          reg: 'io.github.VirusTotal/virustotal-mcp', url: 'https://ai.virustotal.com/mcp' },
  pandadoc:  { name: 'PandaDoc',            reg: 'com.pandadoc.mcp/mcp',               url: 'https://mcp.pandadoc.com/v1/mcp' },
  cypress:   { name: 'Cypress Cloud',       reg: 'io.cypress.mcp/cypress-cloud',       url: 'https://mcp.cypress.io/mcp' },
  lambdatest:{ name: 'LambdaTest',          reg: 'io.github.LambdaTest/mcp',           url: 'https://mcp.lambdatest.com/mcp' },
  newrelic:  { name: 'New Relic',           reg: 'com.newrelic/mcp-server',            url: 'https://mcp.newrelic.com/mcp' },
};
const RMCP_KV = 'rmcp';                     // rmcp:<email> -> { [slug]: { sealed, at, lastUsed, broken } }
const RMCP_STATE_TTL_MS = 5 * 60 * 1000;
const RMCP_PROTOCOL = '2025-06-18';
const RMCP_MAX_BYTES = 400000;              // one reply from an app, however chatty
const RMCP_MAX_TOOLS = 100;
const RMCP_MAX_OUT = 60000;                 // characters of a tool's result handed back

/* An endpoint an app's own metadata named: https, a public host, no userinfo.
   Anything else is refused rather than fetched. */
function _rmcpSafeUrl(u){
  try {
    const x = new URL(String(u || ''));
    if (x.protocol !== 'https:' || x.username || x.password) return '';
    return _webHostAllowed(x.toString()).ok ? x.toString() : '';
  } catch (e) { return ''; }
}
/* A bounded read. An app that streams forever gets RMCP_MAX_BYTES, not the
   Worker's memory. */
async function _rmcpText(res, cap){
  const reader = res && res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) { try { return String(await res.text()).slice(0, cap); } catch (e) { return ''; } }
  const dec = new TextDecoder(); let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
    if (out.length > cap) { try { reader.cancel(); } catch (e) {} break; }
  }
  return out.slice(0, cap);
}
async function _rmcpGetJSON(url){
  const u = _rmcpSafeUrl(url); if (!u) return null;
  try {
    const g = await fetchGuarded(u, { headers: { Accept: 'application/json', 'MCP-Protocol-Version': RMCP_PROTOCOL } }, 10000);
    if (g.blocked || !g.response.ok) return null;
    return JSON.parse(await _rmcpText(g.response, 200000));
  } catch (e) { return null; }
}
/* RFC 8414 and 9728 put the well-known segment between the host and the path;
   older servers only answer at the root. Both, in that order. */
function _rmcpWellKnown(base, name){
  const u = new URL(base);
  const path = u.pathname.replace(/\/+$/, '');
  return path ? [u.origin + '/.well-known/' + name + path, u.origin + '/.well-known/' + name]
              : [u.origin + '/.well-known/' + name];
}

/* HOW TO SIGN IN TO THIS APP, ASKED OF THE APP.

   The resource says where its authorization server is (a 401 naming its
   metadata, or the well-known document); the authorization server says where
   to authorize, exchange and register. If an app publishes none of that, the
   older spec's defaults at its origin are tried - and if those are not real,
   registration fails and the person is told so, rather than sent to a page
   that 404s. */
async function _rmcpDiscover(app){
  let prm = null;
  try {
    const g = await fetchGuarded(app.url, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': RMCP_PROTOCOL },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: RMCP_PROTOCOL, capabilities: {}, clientInfo: { name: 'AMV', version: '1.0' } } }) }, 10000);
    if (!g.blocked) {
      const h = g.response.headers.get('www-authenticate') || '';
      const m = h.match(/resource_metadata="([^"]+)"/i);
      try { g.response.body && g.response.body.cancel(); } catch (e) {}
      if (m) prm = await _rmcpGetJSON(new URL(m[1], app.url).toString());
    }
  } catch (e) {}
  if (!prm) for (const w of _rmcpWellKnown(app.url, 'oauth-protected-resource')) { prm = await _rmcpGetJSON(w); if (prm) break; }
  const issuer = _rmcpSafeUrl(prm && Array.isArray(prm.authorization_servers) && prm.authorization_servers[0]) || new URL(app.url).origin;
  let as = null;
  for (const w of [..._rmcpWellKnown(issuer, 'oauth-authorization-server'), ..._rmcpWellKnown(issuer, 'openid-configuration')]) {
    const d = await _rmcpGetJSON(w);
    if (d && d.authorization_endpoint && d.token_endpoint) { as = d; break; }
  }
  if (!as) { const o = new URL(issuer).origin; as = { authorization_endpoint: o + '/authorize', token_endpoint: o + '/token', registration_endpoint: o + '/register' }; }
  /* PKCE with S256 is required of every MCP sign-in. An app that says it
     supports something else and not that is one AMV will not half-trust. */
  if (Array.isArray(as.code_challenge_methods_supported) && as.code_challenge_methods_supported.length
      && !as.code_challenge_methods_supported.includes('S256')) throw new Error('no_s256');
  /* The resource named in the token request is the connector itself. The app's
     own statement of it is used only when it is the same origin - a document
     that names a different resource is asking AMV to mint a token for it. */
  let resource = app.url;
  const said = _rmcpSafeUrl(prm && prm.resource);
  if (said) { try { if (new URL(said).origin === new URL(app.url).origin) resource = said; } catch (e) {} }
  const meta = {
    authorize: _rmcpSafeUrl(as.authorization_endpoint), token: _rmcpSafeUrl(as.token_endpoint),
    register: _rmcpSafeUrl(as.registration_endpoint || ''), revoke: _rmcpSafeUrl(as.revocation_endpoint || ''),
    resource,
    scopes: (prm && Array.isArray(prm.scopes_supported)) ? prm.scopes_supported.map(String).filter(s => /^[\x21-\x7e]{1,80}$/.test(s)).slice(0, 20) : [],
  };
  if (!meta.authorize || !meta.token) throw new Error('no_auth_server');
  return meta;
}

/* AMV, REGISTERED WITH THE APP, ONCE PER RETURN ADDRESS.

   Kept per deployment rather than per person: the registration describes AMV,
   not anybody's account, and registering again for every sign-in would leave
   thousands of identical clients in each app's list. Sealed, because some apps
   issue a client secret. */
async function _rmcpClient(env, slug, meta, redirect){
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(redirect + '|' + meta.register));
  const key = slug + '|' + [...new Uint8Array(d)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
  const cached = await DB.get(env, 'rmcpcli', key);
  if (cached && cached.sealed) { try { return await connOpen(env, cached.sealed); } catch (e) {} }
  if (!meta.register) throw new Error('no_registration');
  const g = await fetchGuarded(meta.register, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_name: 'AMV', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: 'none' }) }, 15000);
  if (g.blocked) throw new Error('registration_blocked');
  let r = {}; try { r = JSON.parse(await _rmcpText(g.response, 50000)); } catch (e) {}
  if (!g.response.ok || !r.client_id) throw new Error('registration_refused');
  const cli = { id: String(r.client_id).slice(0, 300), secret: r.client_secret ? String(r.client_secret).slice(0, 500) : '',
                auth: String(r.token_endpoint_auth_method || (r.client_secret ? 'client_secret_post' : 'none')) };
  await DB.put(env, 'rmcpcli', key, { sealed: await connSeal(env, cli), at: Date.now() });
  return cli;
}

/* The token endpoint, for both the first exchange and every refresh. */
async function _rmcpToken(meta, cli, params){
  const body = new URLSearchParams(Object.assign({ client_id: cli.id }, params));
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (cli.secret) {
    if (cli.auth === 'client_secret_basic') headers.Authorization = 'Basic ' + btoa(encodeURIComponent(cli.id) + ':' + encodeURIComponent(cli.secret));
    else body.set('client_secret', cli.secret);
  }
  let g;
  try { g = await fetchGuarded(meta.token, { method: 'POST', headers, body: body.toString() }, 15000); }
  catch (e) { return { ok: false, why: 'unreachable' }; }
  if (g.blocked) return { ok: false, why: 'blocked' };
  let d = {}; try { d = JSON.parse(await _rmcpText(g.response, 100000)); } catch (e) {}
  if (!g.response.ok || !d.access_token) return { ok: false, why: String(d.error || ('http_' + g.response.status)).slice(0, 80) };
  return { ok: true, access: String(d.access_token), refresh: d.refresh_token ? String(d.refresh_token) : '',
           exp: _connExpiry(d) };
}

/* A usable token for this person and app, refreshed when it is about to lapse.
   A refresh the app refuses marks the connection broken, so the page can say
   "reconnect" instead of failing every call with no reason given. */
/* THREE WAYS THIS USED TO DISCONNECT A SIGN-IN THAT WAS FINE.

   A token with no expires_in was given an hour - the same guess LESSONS 524
   records for GitHub - and an hour later a connector with no refresh token was
   marked broken while its token still worked. No expiry stated is 0: it does
   not lapse on a clock, and the app says so with a 401 if that ever changes.

   A 401 from the app was final even when a refresh token was in hand. Tokens
   end early for ordinary reasons; `force` refreshes once before giving up.

   Two requests refreshing at once with a rotating refresh token: the second
   presents a token the first just spent, is refused, and used to mark the
   connection broken - after the first had renewed it. A refused refresh now
   looks again, and a newer token saved in the meantime is used. */
async function _rmcpAccess(env, email, slug, opts){
  const force = !!(opts && opts.force);
  const all = (await DB.get(env, RMCP_KV, email)) || {};
  const c = all[slug];
  if (!c) return { error: 'not_connected' };
  let tok; try { tok = await connOpen(env, c.sealed); } catch (e) { return { error: 'reconnect' }; }
  if (!force && (!tok.exp || tok.exp > Date.now() + 60000)) return { tok };
  const r = tok.refresh ? await _rmcpToken(tok.meta, tok.cli, { grant_type: 'refresh_token', refresh_token: tok.refresh, resource: tok.meta.resource }) : { ok: false };
  if (!r.ok) {
    /* The request that won is still writing when this one is refused, so it
       is looked for a few times over about a second and a half - only on this
       path, which is otherwise the end of the connection. */
    for (const wait of [0, 400, 1200]) {
      if (wait) await new Promise(res => setTimeout(res, wait));
      try {
        const now = (await DB.get(env, RMCP_KV, email)) || {};
        if (now[slug] && now[slug].sealed !== c.sealed) {
          const fresh = await connOpen(env, now[slug].sealed);
          if (fresh.access !== tok.access && (!fresh.exp || fresh.exp > Date.now() + 60000)) return { tok: fresh };
        }
      } catch (e) {}
    }
    await _rmcpMarkBroken(env, email, slug); return { error: 'reconnect' };
  }
  tok = Object.assign({}, tok, { access: r.access, refresh: r.refresh || tok.refresh, exp: r.exp });
  const sealed = await connSeal(env, tok);
  await _withKind(env, RMCP_KV, email, (rec) => { if (rec && rec[slug]) { rec[slug].sealed = sealed; rec[slug].broken = false; } }, {});
  return { tok };
}
/* Run fn with the token; if the app answers 401, refresh once and run it
   again. Marked broken only when the refresh is refused too, or the renewed
   token is also turned away. */
async function _rmcpOnce(env, email, slug, tok, fn){
  try { return await fn(tok.access); }
  catch (e) {
    if (!e || e.code !== 'unauthorized') throw e;
    const again = tok.refresh ? await _rmcpAccess(env, email, slug, { force: true }) : { error: 'reconnect' };
    if (again.error) { await _rmcpMarkBroken(env, email, slug); throw e; }
    try { return await fn(again.tok.access); }
    catch (e2) { if (e2 && e2.code === 'unauthorized') await _rmcpMarkBroken(env, email, slug); throw e2; }
  }
}
async function _rmcpMarkBroken(env, email, slug){
  try { await _withKind(env, RMCP_KV, email, (rec) => { if (rec && rec[slug]) rec[slug].broken = true; }, {}); } catch (e) {}
}

/* ONE JSON-RPC MESSAGE TO AN APP'S CONNECTOR, over streamable HTTP.

   The reply may be plain JSON or an event stream; a stream is read only until
   the reply with this id arrives, because a server may keep it open for other
   messages and waiting for it to close would wait for the timeout. */
async function _rmcpRpc(url, token, sid, msg){
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
                    'MCP-Protocol-Version': RMCP_PROTOCOL, Authorization: 'Bearer ' + token };
  if (sid) headers['Mcp-Session-Id'] = sid;
  const g = await fetchGuarded(url, { method: 'POST', headers, body: JSON.stringify(msg) }, 30000);
  if (g.blocked) throw Object.assign(new Error('blocked'), { code: 'blocked' });
  const res = g.response;
  /* 401 is "who are you" - the sign-in. 403 is "not this" - one action the app
     will not allow, and the sign-in is fine. Treating both as the first
     disconnected an app because of one refused call. */
  if (res.status === 401) { try { res.body && res.body.cancel(); } catch (e) {} throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' }); }
  if (res.status === 403) { try { res.body && res.body.cancel(); } catch (e) {} throw Object.assign(new Error('forbidden'), { code: 'forbidden' }); }
  const nsid = res.headers.get('mcp-session-id') || sid || '';
  if (msg.id == null) { try { res.body && res.body.cancel(); } catch (e) {} return { sid: nsid, result: null }; }
  if (!res.ok) { try { res.body && res.body.cancel(); } catch (e) {} throw Object.assign(new Error('http_' + res.status), { code: 'http' }); }
  let reply = null;
  if (/text\/event-stream/i.test(res.headers.get('content-type') || '') && res.body && res.body.getReader) {
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '', seen = 0;
    while (!reply) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      seen += chunk.length; buf += chunk;
      if (seen > RMCP_MAX_BYTES) break;
      let cut;
      while ((cut = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, cut); buf = buf.slice(cut).replace(/^\r?\n\r?\n/, '');
        const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
        if (!data) continue;
        try { const m = JSON.parse(data); if (m && m.id === msg.id) { reply = m; break; } } catch (e) {}
      }
    }
    try { reader.cancel(); } catch (e) {}
  } else {
    try { const m = JSON.parse(await _rmcpText(res, RMCP_MAX_BYTES)); reply = Array.isArray(m) ? m.find(x => x && x.id === msg.id) : m; } catch (e) {}
  }
  if (!reply) throw Object.assign(new Error('no_reply'), { code: 'no_reply' });
  if (reply.error) throw Object.assign(new Error(String((reply.error && reply.error.message) || 'error').slice(0, 200)), { code: 'rpc' });
  return { sid: nsid, result: reply.result };
}
async function _rmcpSession(url, token){
  const init = await _rmcpRpc(url, token, '', { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: RMCP_PROTOCOL, capabilities: {}, clientInfo: { name: 'AMV', version: '1.0' } } });
  try { await _rmcpRpc(url, token, init.sid, { jsonrpc: '2.0', method: 'notifications/initialized' }); } catch (e) {}
  return init.sid;
}

/* What went wrong with an app, in words a person can act on. */
function _rmcpFail(app, e){
  const code = (e && e.code) || '';
  if (code === 'unauthorized') return json({ error: 'reconnect', message: app.name + ' no longer accepts AMV’s sign-in. Reconnect it in Integrations.' }, 401);
  if (code === 'forbidden') return json({ error: 'forbidden', message: app.name + ' did not allow that with the access it gave AMV. Nothing was changed.' }, 403);
  return json({ error: 'app_error', message: app.name + '’s connector did not answer properly' + (e && e.message ? ' (' + String(e.message).slice(0, 80) + ')' : '') + '. Nothing was changed; try again in a moment.' }, 502);
}

/* NOT WITH AN API KEY.

   These routes act on somebody's Notion, Slack or Stripe, and the promise that
   makes them safe is that each action is asked for in chat, with its arguments
   shown, by the person at the screen. An API key is automation - there is no
   screen and nobody to ask - so a key that could call these would turn every
   leaked key into a key to every app its owner connected. Refused here, on the
   server, the way deleting an account already is. Listing what is connected
   stays open: it is metadata, and a key can already see its own account. */
function _refuseApiKey(user, what){
  if(user && user.via === 'apikey')
    return json({ error: 'api_key_refused', code: 'session_required',
      message: 'An API key cannot ' + what + '. Sign in to AMV and do it from chat, where each action is asked for first.' }, 403);
  return null;
}

async function remoteList(request, env){
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const all = (await DB.get(env, RMCP_KV, user.email)) || {};
  return json({ ok: true, configured: connConfigured(env),
    apps: Object.keys(REMOTE_APPS).map(slug => ({ slug, name: REMOTE_APPS[slug].name, connected: !!all[slug],
      broken: !!(all[slug] && all[slug].broken), at: (all[slug] && all[slug].at) || 0, lastUsed: (all[slug] && all[slug].lastUsed) || 0 })) });
}

async function remoteStart(request, env){
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  { const k = _refuseApiKey(user, 'connect an app'); if (k) return k; }
  if (!connConfigured(env))
    return json({ error: 'not_configured', code: 'connect_key_missing',
      message: 'Connecting apps is not set up on this deployment. The CONNECT_KEY secret has to exist first, because without it a sign-in would be stored unencrypted.' }, 503);
  const blocked = await guardAction(env, 'rmcpstart:' + user.email, 10, 100, 'app connections');
  if (blocked) return blocked;
  const body = await request.json().catch(() => ({}));
  const slug = String(body.app || '');
  const app = Object.prototype.hasOwnProperty.call(REMOTE_APPS, slug) ? REMOTE_APPS[slug] : null;
  if (!app) return json({ error: 'unknown_app' }, 400);
  const back = _connReturnAddress(env, body);
  if (back.error) return back.error;
  const redirect = back.redirect;

  let meta, cli;
  try { meta = await _rmcpDiscover(app); }
  catch (e) {
    audit(env, 'rmcp_discover_failed', { by: user.email, app: slug, why: String((e && e.message) || '').slice(0, 40) });
    return json({ error: 'app_unreachable', message: app.name + ' did not say how to sign in to its connector just now, so AMV could not start. Nothing was changed. Try again in a moment.' }, 502);
  }
  try { cli = await _rmcpClient(env, slug, meta, redirect); }
  catch (e) {
    audit(env, 'rmcp_register_failed', { by: user.email, app: slug, why: String((e && e.message) || '').slice(0, 40) });
    return json({ error: 'app_refused', message: app.name + ' did not accept AMV as a connecting app. Some apps only allow ones they have approved in advance. Nothing was changed.' }, 502);
  }
  const state = 'r_' + _connRandom(24);
  const verifier = _connRandom(48);
  const challenge = await _pkceChallenge(verifier);
  await DB.put(env, 'rmcpstate', state, {
    sealed: await connSeal(env, { verifier, email: user.email, slug, redirect, meta, cli }),
    exp: Date.now() + RMCP_STATE_TTL_MS,
  });
  const q = new URLSearchParams({ response_type: 'code', client_id: cli.id, redirect_uri: redirect, state,
    code_challenge: challenge, code_challenge_method: 'S256', resource: meta.resource });
  if (meta.scopes.length) q.set('scope', meta.scopes.join(' '));
  audit(env, 'rmcp_start', { by: user.email, app: slug });
  return json({ ok: true, url: meta.authorize + (meta.authorize.includes('?') ? '&' : '?') + q.toString(), app: slug, name: app.name });
}

async function remoteFinish(request, env){
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  { const k = _refuseApiKey(user, 'connect an app'); if (k) return k; }
  if (!connConfigured(env)) return json({ error: 'not_configured' }, 503);
  const blocked = await guardAction(env, 'rmcpfin:' + user.email, 10, 100, 'app connections');
  if (blocked) return blocked;
  const body = await request.json().catch(() => ({}));
  const state = String(body.state || ''), code = String(body.code || '');
  if (!state || !code) return json({ error: 'missing_code_or_state' }, 400);
  const rec = await DB.get(env, 'rmcpstate', state);
  /* Single use whatever happens next, like Connected accounts. */
  await DB.del(env, 'rmcpstate', state);
  if (!rec) return json({ error: 'unknown_state', message: 'That connection attempt is not one AMV started, or it has already been used.' }, 400);
  if (!rec.exp || rec.exp < Date.now()) return json({ error: 'expired_state', message: 'That took too long. Start the connection again.' }, 400);
  let st; try { st = await connOpen(env, rec.sealed); } catch (e) { return json({ error: 'state_unreadable' }, 400); }
  if (st.email !== user.email) { audit(env, 'rmcp_state_mismatch', { by: user.email }); return json({ error: 'state_mismatch' }, 400); }
  const app = REMOTE_APPS[st.slug];
  if (!app) return json({ error: 'unknown_app' }, 400);
  const t = await _rmcpToken(st.meta, st.cli, { grant_type: 'authorization_code', code, redirect_uri: st.redirect,
    code_verifier: st.verifier, resource: st.meta.resource });
  if (!t.ok) {
    audit(env, 'rmcp_exchange_failed', { by: user.email, app: st.slug, why: t.why });
    return json({ error: 'exchange_failed', app: st.slug, why: t.why,
      message: app.name + ' did not complete the sign-in (' + t.why + '). Nothing was connected.' }, 400);
  }
  const sealed = await connSeal(env, { access: t.access, refresh: t.refresh, exp: t.exp, meta: st.meta, cli: st.cli });
  await _withKind(env, RMCP_KV, user.email, (r) => { r[st.slug] = { sealed, at: Date.now(), lastUsed: 0, broken: false }; }, {});
  audit(env, 'rmcp_added', { by: user.email, app: st.slug, refresh: !!t.refresh });
  return json({ ok: true, app: st.slug, name: app.name });
}

async function remoteRemove(request, env){
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  { const k = _refuseApiKey(user, 'disconnect an app'); if (k) return k; }
  const blocked = await guardAction(env, 'rmcprm:' + user.email, 20, 200, 'disconnections');
  if (blocked) return blocked;
  const body = await request.json().catch(() => ({}));
  const slug = String(body.app || '');
  const all = (await DB.get(env, RMCP_KV, user.email)) || {};
  const c = all[slug];
  if (!c) return json({ error: 'not_found' }, 404);
  const name = (REMOTE_APPS[slug] || {}).name || slug;
  const revoked = await _rmcpRevoke(env, c);
  /* Forgotten either way, for the reason connRemove gives: keeping a token AMV
     could not revoke is holding a credential somebody asked it to let go of. */
  await _withKind(env, RMCP_KV, user.email, (r) => { if (r) delete r[slug]; }, {});
  audit(env, 'rmcp_removed', { by: user.email, app: slug, revoked });
  return json({ ok: true, revoked, message: revoked
    ? 'Disconnected, and ' + name + ' confirmed the sign-in was revoked.'
    : 'AMV forgot this connection and can no longer use it. ' + name + ' did not confirm it was revoked - remove AMV from the connected apps in your ' + name + ' account to be certain.' });
}
async function _rmcpRevoke(env, c){
  try {
    const tok = await connOpen(env, c.sealed);
    if (!tok.meta || !tok.meta.revoke) return false;
    const body = new URLSearchParams({ token: tok.refresh || tok.access, client_id: tok.cli.id });
    if (tok.cli.secret) body.set('client_secret', tok.cli.secret);
    const g = await fetchGuarded(tok.meta.revoke, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }, 15000);
    return !g.blocked && g.response.ok;
  } catch (e) { return false; }
}

async function remoteTools(request, env){
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  { const k = _refuseApiKey(user, 'use a connected app'); if (k) return k; }
  const blocked = await guardAction(env, 'rmcptools:' + user.email, 30, 1000, 'app connector listings');
  if (blocked) return blocked;
  const body = await request.json().catch(() => ({}));
  const slug = String(body.app || '');
  const app = Object.prototype.hasOwnProperty.call(REMOTE_APPS, slug) ? REMOTE_APPS[slug] : null;
  if (!app) return json({ error: 'unknown_app' }, 400);
  const a = await _rmcpAccess(env, user.email, slug);
  if (a.error === 'not_connected') return json({ error: 'not_connected' }, 404);
  if (a.error) return json({ error: 'reconnect', message: app.name + ' needs signing in again. Reconnect it in Integrations.' }, 401);
  let tools = [];
  try {
    await _rmcpOnce(env, user.email, slug, a.tok, async (access) => {
      tools = [];
      const sid = await _rmcpSession(app.url, access);
      let cursor = '';
      for (let page = 0; page < 5 && tools.length < RMCP_MAX_TOOLS; page++) {
        const r = await _rmcpRpc(app.url, access, sid, { jsonrpc: '2.0', id: 2 + page, method: 'tools/list', params: cursor ? { cursor } : {} });
        for (const t of ((r.result && r.result.tools) || [])) if (t && t.name != null) tools.push(t);
        cursor = (r.result && r.result.nextCursor) || '';
        if (!cursor) break;
      }
    });
  } catch (e) {
    return _rmcpFail(app, e);
  }
  /* Bounded like any other connector's list: a name, a description and a
     schema, each capped, and a schema too large to be a schema dropped for an
     empty one rather than passed on to the model. */
  const out = tools.slice(0, RMCP_MAX_TOOLS).map(t => {
    let schema = (t.inputSchema && typeof t.inputSchema === 'object') ? t.inputSchema : { type: 'object', properties: {} };
    try { if (JSON.stringify(schema).length > 20000) schema = { type: 'object', properties: {} }; } catch (e) { schema = { type: 'object', properties: {} }; }
    return { name: String(t.name).slice(0, 120), description: String(t.description || '').slice(0, 1000), inputSchema: schema };
  });
  return json({ ok: true, app: slug, name: app.name, tools: out });
}

async function remoteCall(request, env){
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  { const k = _refuseApiKey(user, 'use a connected app'); if (k) return k; }
  const blocked = await guardAction(env, 'rmcpcall:' + user.email, 60, 2000, 'app connector actions');
  if (blocked) return blocked;
  const body = await request.json().catch(() => ({}));
  const slug = String(body.app || '');
  const app = Object.prototype.hasOwnProperty.call(REMOTE_APPS, slug) ? REMOTE_APPS[slug] : null;
  if (!app) return json({ error: 'unknown_app' }, 400);
  const tool = String(body.tool || '');
  if (!tool || tool.length > 120) return json({ error: 'bad_tool' }, 400);
  const args = (body.args && typeof body.args === 'object' && !Array.isArray(body.args)) ? body.args : {};
  if (JSON.stringify(args).length > 50000) return json({ error: 'args_too_large' }, 413);
  const a = await _rmcpAccess(env, user.email, slug);
  if (a.error === 'not_connected') return json({ error: 'not_connected' }, 404);
  if (a.error) return json({ error: 'reconnect', message: app.name + ' needs signing in again. Reconnect it in Integrations.' }, 401);
  let r;
  try {
    /* Retried only when the app said 401 before doing anything - a refused
       sign-in is refused at the door, so the action has not happened and
       asking again cannot do it twice. */
    r = await _rmcpOnce(env, user.email, slug, a.tok, async (access) => {
      const sid = await _rmcpSession(app.url, access);
      return await _rmcpRpc(app.url, access, sid, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } });
    });
  } catch (e) {
    return _rmcpFail(app, e);
  }
  try { await _withKind(env, RMCP_KV, user.email, (rec) => { if (rec && rec[slug]) rec[slug].lastUsed = Date.now(); }, {}); } catch (e) {}
  /* The app and the tool are recorded; the arguments are not - they are
     somebody's documents and messages, and an audit log is not where those go. */
  audit(env, 'rmcp_call', { by: user.email, app: slug, tool: tool.slice(0, 80) });
  const res = r.result || {};
  let left = RMCP_MAX_OUT;
  const content = (Array.isArray(res.content) ? res.content : []).slice(0, 50).map(c => {
    if (c && c.type === 'text') { const t = String(c.text || '').slice(0, Math.max(0, left)); left -= t.length; return { type: 'text', text: t }; }
    return { type: String((c && c.type) || 'content').slice(0, 30) };
  });
  return json({ ok: true, isError: !!res.isError, content });
}

const CREW_POPULAR_MIN = 25;      // total jobs created before any ranking is shown
const JOBUSE_MAX_IDS = 2000;        // distinct job ids counted worldwide
const JOBUSE_MAX_IDS_COUNTRY = 300; // and per country

/* WHERE THE COUNTS LIVE.

   In the counter Durable Object: one tally for the world (`jobuse`) and one
   per country (`jobuse:<CC>`), so a country's page reads one small object and
   no two countries' creations touch the same one. The single KV record
   `stats:jobuse` held all of it until the day this moved; it is still READ,
   added in, so nothing counted before is lost, and never written again.

   Without a Durable Object bound (a development machine, most suites) the KV
   record is the store, exactly as before. A tally that cannot be reached is a
   lost count, not an error: this is a ranking, never money, and a job being
   created must not fail over it. */
async function _jobuseTally(env, name, payload){
  const stub = env.AMV_COUNTER.get(env.AMV_COUNTER.idFromName(name));
  const r = await stub.fetch('https://do/counter', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return await r.json();
}
async function _jobuseBump(env, srcId, country){
  try{
    if(env && env.AMV_COUNTER){
      await Promise.all([
        _jobuseTally(env, 'jobuse', { op:'tally', id: srcId, cap: JOBUSE_MAX_IDS }),
        country ? _jobuseTally(env, 'jobuse:' + country, { op:'tally', id: srcId, cap: JOBUSE_MAX_IDS_COUNTRY }) : null,
      ]);
      return;
    }
    await _withKV(env, 'stats', 'jobuse', (rec)=>{
      rec.counts = rec.counts || {};
      /* A BOUNDED RECORD. The id comes from the page and only its shape is
         checked, so an account creating and deleting jobs in a loop could
         mint a new id every time - and this record is read on every
         country page. Past the cap, ids already counted keep counting and
         new ones are not added. The catalogue is a few hundred ids; the
         caps are several times that. */
      const bump = (m, cap) => {
        if(Object.prototype.hasOwnProperty.call(m, srcId) || Object.keys(m).length < cap){ m[srcId] = (m[srcId]||0) + 1; return true; }
        return false;
      };
      bump(rec.counts, JOBUSE_MAX_IDS);
      rec.total = (rec.total||0) + 1;
      /* AND PER COUNTRY, so each country's top ten can be ordered by what
         people THERE switch on rather than by the whole world's taste. The
         same shape - an id and a number - under a two-letter code, and
         still nothing that could be turned back into a person. */
      if(country){
        rec.byCountry = rec.byCountry || {};
        const c = rec.byCountry[country] = rec.byCountry[country] || { counts:{}, total:0 };
        bump(c.counts, JOBUSE_MAX_IDS_COUNTRY);
        c.total = (c.total||0) + 1;
      }
    }, { counts:{}, total:0 });
  }catch(_e){}
}
/* The counts for one country, or for the world when `country` is empty:
   the Durable Object's tally plus whatever the old KV record held. */
async function _jobuseRead(env, country){
  const out = { counts:{}, total:0 };
  const add = (c) => {
    if(!c) return;
    for(const k of Object.keys(c.counts || {})) out.counts[k] = (out.counts[k] || 0) + (c.counts[k] | 0);
    out.total += (c.total | 0);
  };
  let rec = null;
  try{ rec = await DB.get(env, 'stats', 'jobuse'); }catch(_e){ rec = null; }
  add(country ? (rec && rec.byCountry && Object.prototype.hasOwnProperty.call(rec.byCountry, country) ? rec.byCountry[country] : null) : rec);
  if(env && env.AMV_COUNTER){
    try{ add(await _jobuseTally(env, country ? 'jobuse:' + country : 'jobuse', { op:'tallyGet' })); }catch(_e){}
  }
  return out;
}
async function crewPopular(request, env){
  /* PUBLIC AND UNAUTHENTICATED IS NOT THE SAME AS FREE.

     This endpoint takes no token on purpose - it is aggregate counts of a
     public catalogue, and requiring a login to read a leaderboard of your own
     product's features helps nobody. That is the argument for no auth. It is
     not an argument for no limit: every call is a KV read, and an endpoint
     anybody can reach with no credential is exactly the one worth hammering.

     Per IP, per minute, generous enough that a real person clicking around
     Crew never sees it. Behind it, a cache header, so a browser that visits
     the screen twice in a minute does not ask twice. */
  const ip = _rlIp(request);
  const blocked = await guardAction(env, 'crewpop:' + ip, 60, 0, 'this');
  if(blocked) return blocked;
  const rec = await _jobuseRead(env, '');
  const counts = rec.counts;
  const total = rec.total;
  if(total < CREW_POPULAR_MIN){
    return json({ enough:false, total, need: CREW_POPULAR_MIN, top: [] },
                200, { 'Cache-Control': 'public, max-age=300' });
  }
  const top = Object.keys(counts)
    .map(id => ({ id, n: counts[id]|0 }))
    .filter(x => x.n > 0)
    .sort((a,b) => b.n - a.n || (a.id < b.id ? -1 : 1))
    .slice(0, 10);
  /* Five minutes. A ranking that is five minutes stale is the same ranking;
     one that is re-read from KV on every page view is a bill. */
  return json({ enough:true, total, top }, 200, { 'Cache-Control': 'public, max-age=300' });
}

/* WHAT A STORED INSTRUCTION MAY NEVER CONTAIN.

   Mirrors findSecrets on the client deliberately: the client one exists to give
   somebody a helpful message before they press anything, and this one is the
   rule. Conservative on purpose - "reset my password on the supplier site" is
   an instruction and must go through, "password: hunter2" is a credential and
   must not. A separator followed by a value is the difference between the two. */
function _luhnOkSrv(d){
  let sum = 0, alt = false;
  for(let i = d.length - 1; i >= 0; i--){
    let n = d.charCodeAt(i) - 48;
    if(n < 0 || n > 9) return false;
    if(alt){ n *= 2; if(n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return d.length >= 13 && sum % 10 === 0;
}
const _SECRET_RULES_SRV = [
  ['private_key',    /-----BEGIN[ A-Z]*PRIVATE KEY-----/],
  ['api_key',        /\b(?:sk-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{10,}|rk_live_[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35})\b/],
  ['bearer_token',   /\bBearer\s+[A-Za-z0-9._-]{20,}/i],
  ['password',       /\b(?:password|passwd|pass\s?word|passphrase|pwd)\b\s*(?:is|=|:)\s*\S/i],
  ['pin',            /\b(?:pin|passcode|pass\s?code)\b\s*(?:is|=|:)\s*[0-9A-Za-z]/i],
  ['otp',            /\b(?:otp|one[\s-]?time\s?(?:code|password)|2fa\s?code|verification\s?code|security\s?code|auth\s?code)\b\s*(?:is|=|:)\s*[0-9A-Za-z]/i],
  ['card_cvv',       /\b(?:cvv|cvc|cv2|card\s?(?:security|verification)\s?(?:code|value))\b\s*(?:is|=|:)\s*\d{3,4}/i],
  ['secret_token',   /\b(?:api[\s_-]?key|secret[\s_-]?key|client[\s_-]?secret|access[\s_-]?token|refresh[\s_-]?token|auth[\s_-]?token|private[\s_-]?key)\b\s*(?:is|=|:)\s*\S{8,}/i],
  ['bank_details',   /\b(?:sort[\s-]?code|routing[\s-]?number|iban|account[\s-]?number|acct[\s.-]?(?:no|number)|swift|bic)\b\s*(?:is|=|:)\s*[0-9A-Z]/i],
  ['national_id',    /\b(?:social[\s-]?security(?:\s?number)?|ssn|national[\s-]?insurance(?:\s?number)?|nino|tax[\s-]?id|tin)\b\s*(?:is|=|:)\s*[0-9A-Z]/i],
  ['recovery_phrase',/\b(?:seed|recovery|mnemonic)\s?phrase\b\s*(?:is|=|:)?\s*(?:\b[a-z]{3,10}\b[\s,]+){11,}/i],
  ['security_answer',/\b(?:mother'?s\s?maiden\s?name|security\s?(?:question|answer)|memorable\s?(?:word|information))\b\s*(?:is|=|:)\s*\S/i],
];
function _detailSecrets(text){
  const t = String(text || '');
  if(!t) return [];
  const out = [];
  for(const [label, rx] of _SECRET_RULES_SRV){
    try{ if(rx.test(t) && out.indexOf(label) < 0) out.push(label); }catch(_e){}
  }
  /* A card number is structure rather than a label, so Luhn decides - a
     sixteen digit order reference is not a card and must not be refused. */
  try{
    const runs = t.match(/\b(?:\d[ -]?){12,22}\d\b/g) || [];
    for(const r of runs){
      const d = r.replace(/[^0-9]/g, '');
      if(d.length >= 13 && d.length <= 19 && _luhnOkSrv(d)){ out.push('card_number'); break; }
    }
  }catch(_e){}
  return out;
}


/* HOW LONG A RUNNING JOB'S INSTRUCTIONS MAY BE.

   A job re-reads its instructions on every run, for as long as it is on, so
   they are bounded - but 2,000 characters was about 350 words, short enough
   that a careful brief ("check these six sites, ignore these, format it like
   this") was refused. 8,000 is a page and a half, and costs a job about two
   thousand tokens a run. The refusal says why and where long material goes
   instead, rather than "detail too long". */
const CREW_DETAIL_MAX = 8000;
function _crewDetailTooLong(){
  return json({ error:'A running job keeps its instructions under ' + CREW_DETAIL_MAX.toLocaleString('en-US')
    + ' characters, because it re-reads them every time it runs. Shorten it, or paste the long material into chat and ask there.',
    code:'detail_too_long', limit: CREW_DETAIL_MAX }, 400);
}

async function autoCreate(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const body = await request.json().catch(()=>({}));
  const detail = String(body.detail||'').trim();
  const repeat = String(body.repeat||'daily').toLowerCase();
  const kind = (body.kind === 'research' || body.kind === 'invest') ? body.kind : 'task';
  const notify = (body.notify === 'email') ? 'email' : 'app';
  const approval = _autoApprovalOf(body.approval, 'require');
  const scope = (body.scope && typeof body.scope === 'object') ? body.scope : null;
  /* WHERE THE PERSON IS, STORED WITH THE JOB.

     A run happens on the cron, which has no request and so no network country
     to ask - so the country has to be written down now or it is never known.
     Taken from what the page says first (somebody in Spain who picked Mexico
     on purpose meant Mexico), else from the network, and accepted only when it
     is a country AMV actually has facts for: a free-text field that reaches
     the model is not somewhere to let an arbitrary string in. */
  const country = _jobCountry(body.country, request);
  /* WHICH CATALOGUE JOB THIS CAME FROM, IF ANY.

     A job is stored as free text, so nothing here could ever say which of the
     catalogue entries people actually reach for. The owner asked for a
     most-used list "based on actual data", and the data has to start existing
     before any such list can be real - so the catalogue id rides along.

     Validated to a short slug rather than trusted: it becomes part of an
     aggregate key. Absent for anything typed from scratch, which is most of
     them, and that is fine - the ranking is of catalogue entries. */
  const srcId = /^[a-z0-9_-]{1,40}$/i.test(String(body.srcId||'')) ? String(body.srcId) : '';
  /* WHICH CONNECTED ACCOUNT CAPABILITIES THIS JOB MAY DRAW ON.

     Filtered against the allow-list rather than stored as sent: this value
     decides what an unattended run is permitted to open, so a crafted create
     must not be able to name a capability the runner would then honour. It is
     a request, not a grant - connUse still checks the connection actually
     carries the scope, so naming one here cannot conjure access that was never
     given. */
  const asked = Array.isArray(body.uses)
    ? body.uses.map(String).filter(u => AUTO_USES_ALLOWED.indexOf(u) >= 0).slice(0, 4)
    : [];
  /* AND WHAT IT PLAINLY NEEDS, WHEN THE CALLER DID NOT SAY.

     `uses` is what `_autoAccountContext` walks: an empty list means the run
     opens nothing and the model is handed the job's instruction and no data at
     all. The Crew screen fills it in from the catalogue entry. The CHAT tool
     did not - `crew_add` posts detail, repeat, kind, approval and notify - so
     a job somebody set up by asking for it ("summarise my inbox each morning")
     ran every morning, spent real money, and summarised an empty string while
     its own instruction told the model to report an inbox. The permission gate
     said it was ready, because the gate reads the DETAIL and the reader reads
     `uses`: two answers to "what does this job need", and only one of them was
     being filled in.

     Derived here rather than in the tool, because the tool is one caller of
     three and the next one will forget too. It is a floor, not a cap: an
     explicit list still wins if it is larger, and `connUse` still refuses a
     scope the connection does not carry, so deriving one cannot conjure access
     nobody granted. */
  const derived = _autoUsesFromText(detail);
  const uses = [...new Set(asked.concat(derived))].slice(0, 4);
  /* WHAT WOULD MAKE THE ANSWER BETTER, kept apart from what it needs.

     Same allow-list, same filter, and never derived from text - a boost that a
     phrase could conjure would be a bank read nobody asked for. Anything
     already required is dropped rather than carried twice. See the comment on
     `boosts` in `_autoAccountContext` for why the two lists are not one. */
  const boosts = (Array.isArray(body.boosts)
    ? body.boosts.map(String).filter(u => AUTO_USES_ALLOWED.indexOf(u) >= 0 && uses.indexOf(u) < 0)
    : []).slice(0, 4);
  if(!detail) return json({ error:'detail required' }, 400);
  if(detail.length > CREW_DETAIL_MAX) return _crewDetailTooLong();
  /* NOTHING CREDENTIAL-SHAPED IS EVER WRITTEN TO KV.

     A job's detail is stored here and read by the model on every run for as
     long as the job is on, so a password pasted into it would be persisted and
     re-transmitted indefinitely. The client refuses it first; this is the half
     that matters, because a client check is a suggestion.

     The reply names the KIND and never echoes the text, and nothing about the
     refusal is logged beyond that - a rejection that quotes the secret back has
     stored it in a log instead of a record, which is not an improvement. */
  const _sec = _detailSecrets(detail);
  if(_sec.length){
    return json({ error:'credentials_in_detail', kinds:_sec,
      message:'AMV does not store passwords, card numbers or security codes. Nothing was saved. '+
              'Connect the account instead, or describe the task without the credential.' }, 400);
  }
  /* 'once' is a job with a time and no repeat: "remind me Friday at 9",
     "check the visa page on the 3rd". See _autoNextAfter for what happens to
     it once its time has come. */
  if(!AUTO_INTERVALS[repeat] && repeat !== 'once') return json({ error:'invalid repeat interval' }, 400);

  /* Every account can schedule background work; what differs is how much.
     A free account gets one, weekly, without web search - and is told exactly
     that at the moment it matters, rather than finding out from a cron. */
  const budget = await _budgetFor(env, user);
  /* Autonomous work needs a paid plan, and this is where that is decided.

     A job runs on a schedule whether or not anybody is watching, which makes it
     the most expensive thing AMV does and the one thing a free tier cannot
     carry. The free plan used to get one shaped weekly job; the owner's call is
     that autonomy is a paid capability, and the plans page has always listed it
     under Pro. Said plainly and once, with the plan named - not a silent
     failure, and not a warning about risk. */
  /* budget.plan, not user.plan: _budgetFor already resolved the effective plan
     - including a team's, and including a fallback read when the caller handed
       us a user object without one. Reading the raw field here would refuse a
     paying customer whenever it happened to be missing. */
  if(_planRankOf(budget.plan, user.customCfg) < _planRankOf(AUTO_MIN_PLAN)){
    return json({ error: 'Running work on a schedule is part of Pro. Upgrade and AMV starts doing this on its own.',
                  code: 'plan_required', requires: AUTO_MIN_PLAN,
                  jobs: AUTO_MAX_BY_PLAN[AUTO_MIN_PLAN] }, 402);
  }
  /* Email delivery is the whole point of "have it ready when I wake up", and it
     only works if an email provider is configured. Rather than accepting the
     request and delivering nowhere, we downgrade to in-app and SAY which one
     the user is getting. */
  const emailReady = await _emailReachesNow(env);
  const effectiveNotify = (notify === 'email' && !emailReady) ? 'app' : notify;

  const key = _autoKey(user.email);
  const rec = (await DB.get(env, 'auto', key)) || { items:[], results:[] };
  /* AMV-035: THE CAP IS READ HERE AND ENFORCED NOWHERE.

     The append below happens under the lock - correctly, and with a comment
     about why - and this count does not. Two creates arriving together both
     read the same list, both find room, and both append inside the lock one
     after the other: the lock keeps the list intact and the LIMIT is what
     breaks. A plan that runs one background job runs two, on a double-click.

     The check is re-made inside the lock below. This one stays because it is
     what produces the message naming their plan and the next one up, which
     needs the budget in scope; it is the early exit, not the enforcement. */
  /* A one-time job that has run is finished: it stays listed so its row can
     say so, and it no longer holds one of the plan's places. */
  if(_autoLiveCount(rec.items) >= budget.max){
    /* Name the number they have and the number the next plan gives, because
       "you have reached your limit" without either is an error a customer
       cannot act on. */
    return budget.free
      ? json({ error:'The free plan runs one job in the background, weekly. Pro runs '+AUTO_MAX_BY_PLAN.pro+
                     ', as often as every ten minutes.',
               code:'plan_limit', have: budget.max, next: AUTO_MAX_BY_PLAN.pro }, 402)
      : json({ error:'Your plan runs '+budget.max+' background job'+(budget.max===1?'':'s')+
                     '. Remove one to add another, or upgrade for more.',
               code:'job_limit', have: budget.max }, 429);
  }
  /* Shaped, not refused. The free tier runs weekly and does not search the web,
     because searching is the expensive part - and it is told so rather than
     silently getting something other than what it asked for. */
  /* A one-time job is not reshaped: one run is already less than a weekly one. */
  const shapedRepeat = (budget.free && repeat !== 'once') ? FREE_AUTO_REPEAT : repeat;
  /* An investing check-in is never reshaped into a plain task: a "task" version
     of it would be a model guessing at balances, which is the one outcome this
     must not have. It costs no model tokens either, so there is nothing to
     shape. */
  const shapedKind   = (budget.free && kind !== 'invest') ? 'task' : kind;
  const shaped = budget.free && kind !== 'invest' && (shapedRepeat !== repeat || kind !== 'task');

  // Honour the user's requested first-run time if given, else one interval out.
  const interval = Math.max(AUTO_MIN_INTERVAL, AUTO_INTERVALS[shapedRepeat] || AUTO_INTERVALS.daily);
  let next = Date.now() + interval, firstGiven = false;
  if(body.firstRunAt && Number.isFinite(+body.firstRunAt)){
    const t = +body.firstRunAt;
    if(t > Date.now() - 60e3 && t < Date.now() + 366*86400e3){ next = t; firstGiven = true; }
  }
  /* THE TIME THEY SAID, ON THEIR CLOCK. See _schedNextAt. The zone is the
     one their device reports, else the one their network is in; a schedule
     with neither is kept in UTC and says so in `tz`. A first run given as an
     instant with a daily or weekly repeat is turned into the same thing, so
     every door that sets "tomorrow at 8" ends up at 8 every day after. */
  const tzHere = _tzOk(body.tz) || _tzOk(request.cf && request.cf.timezone);
  /* A job that runs once has its instant and nothing else: there is no "next
     time" to keep on anybody's clock. Without an instant it is refused rather
     than run "in a day", which is not what anybody who said a time meant. */
  if(shapedRepeat === 'once' && !firstGiven)
    return json({ error:'A one-time job needs the date and time it should run, within the next year.', code:'once_needs_time' }, 400);
  let sched = shapedRepeat === 'once' ? null : _schedClean(body.sched, tzHere);
  if(!sched && firstGiven && (shapedRepeat === 'daily' || shapedRepeat === 'weekly') && tzHere){
    const lp = _zoneParts(tzHere, next);
    sched = _schedClean({ cad: shapedRepeat, hour: lp.h, minute: lp.mi, days: [lp.wd], tz: tzHere });
  }
  /* A free account runs one job once a week. It keeps the time and the day
     it asked for - the first of them - rather than losing the schedule. */
  if(sched && budget.free && kind !== 'invest'){
    if(sched.cad === 'daily') sched = Object.assign({}, sched, { cad: 'weekly', days: [_zoneParts(sched.tz, _schedNextAt(sched, Date.now())).wd] });
    else if(sched.cad === 'weekly') sched = Object.assign({}, sched, { days: sched.days.slice(0, 1) });
  }
  if(sched) next = _schedNextAt(sched, Date.now());
  const item = {
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2,7),
    detail, repeat: shapedRepeat, interval, next, kind: shapedKind, notify: effectiveNotify, approval, scope,
    ...(sched ? { sched } : {}),
    ...(shapedRepeat === 'once' ? { onceAt: next } : {}),
    /* Stored, so an unattended run knows which connected account it may open.
       Empty for the overwhelming majority of jobs, which are web research and
       need nobody's mailbox. */
    uses,
    /* And which it would be BETTER with. Stored beside `uses` rather than
       folded into it, because a missing one of these is a note about the
       evidence and a missing `use` is a broken job. */
    boosts,
    country,
    tier: budget.free ? 'free' : 'paid',
    created: Date.now(), runs: 0, lastError: null, active: true
  };
  /* Under the lock the cron takes. A run holds this record for the length of
     a job, and creating one here read it before that started and wrote the
     whole thing back after - so a result the tick produced meanwhile is
     erased, and so is a `next` it had just moved. Appending inside the lock
     touches only the list this request is adding to. */
  let overBudget = false;
  await _withAuto(env, key, (fresh) => {
    if(!fresh) return;
    /* AMV-035: decided HERE, against the list as it is at this moment, not
       against the copy read before the lock was taken. */
    if(_autoLiveCount(fresh.items) >= budget.max){ overBudget = true; return; }
    fresh.items = (fresh.items||[]).concat(item);
  }, { items:[], results:[] });
  /* COUNTS ONLY, AND NOTHING THAT SAYS WHO.

     One record, a map of catalogue id to a number. No email, no job text, no
     timestamp per user - there is nothing in here that could be turned back
     into a person, which is the whole reason it is safe to aggregate across
     everybody. Written after the job actually exists, so a refused create does
     not inflate the count. */
  if(srcId && !overBudget) await _jobuseBump(env, srcId, country);
  if(overBudget){
    return budget.free
      ? json({ error:'The free plan runs one job in the background, weekly. Pro runs '+AUTO_MAX_BY_PLAN.pro+
                     ', as often as every ten minutes.',
               code:'plan_limit', have: budget.max, next: AUTO_MAX_BY_PLAN.pro }, 402)
      : json({ error:'Your plan runs '+budget.max+' background job'+(budget.max===1?'':'s')+
                     '. Remove one to add another, or upgrade for more.',
               code:'job_limit', have: budget.max }, 429);
