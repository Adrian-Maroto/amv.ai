       : rank >= PLAN_RANK.pro ? COMPUTER_MINUTES.pro : 0;
}
async function _computerName(email){
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('amv-computer:' + String(email).toLowerCase()));
  return 'u:' + [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}
async function _computerUsedSeconds(env, email){
  return +((await counter(env, `cmin:${email}:${monthKey()}`, { op: 'get' })).value || 0);
}
/* AWAKE TIME, AS THE UNION OF WINDOWS. Each request keeps the machine up
   until COMPUTER_AWAKE_S after it - so a request inside a window bills only
   the extension, and one after a gap bills a fresh window. `cwake:` holds where
   the billed time ends. An extension under 30 seconds is not written: the mark
   stays put, so the next request bills it from there and nothing is lost -
   and a burst of requests does not become a burst of writes to one key. */
async function _computerBillAwake(env, email, atMs){
  const key = `cwake:${email}`;
  const billedTo = +(await env.AMV_KV.get(key).catch(() => null)) || 0;
  const end = atMs + COMPUTER_AWAKE_S * 1000;
  const add = Math.ceil((end - Math.max(billedTo, atMs)) / 1000);
  if(add < 30) return 0;
  await env.AMV_KV.put(key, String(end), { expirationTtl: 2 * 86400 });
  await counter(env, `cmin:${email}:${monthKey()}`, { op: 'incr', amount: add, ttlMs: 40 * 86400000 });
  return add;
}
async function computerInfo(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const cap = _computerCap(user);
  return json({ ok: true, available: _computerOn(env), allowed: cap > 0, minPlan: COMPUTER_MIN_PLAN,
                minutes: { used: Math.ceil((await _computerUsedSeconds(env, user.email)) / 60), cap } });
}
async function computerRoute(request, env, route){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  if(!_computerOn(env)) return json({ error: 'AMV’s cloud computer is not switched on for this deployment yet. You can still connect your own computer.', code: 'needs_service' }, 503);
  const cap = _computerCap(user);
  if(!cap) return json({ error: 'The cloud computer comes with Pro and above.', code: 'plan_required', minPlan: COMPUTER_MIN_PLAN }, 402);
  const limited = await guardAction(env, 'computer:' + user.email, 120, 2000, 'requests to your cloud computer');
  if(limited) return limited;
  /* Spent: nothing more reaches the machine, because anything that reaches it
     keeps it awake. Disconnecting still goes through - it stops what runs. */
  if(route !== 'revoke'){
    const used = await _computerUsedSeconds(env, user.email);
    if(used >= cap * 60)
      return json({ error: `You have used this month’s ${cap} minutes of cloud computer time. It starts again next month, or upgrade for more.`,
                    code: 'computer_minutes', minutes: { used: Math.ceil(used / 60), cap } }, 429);
  }
  const raw = await request.text();
  if(raw.length > 8 * 1024 * 1024) return json({ error: 'That is too large to send to the cloud computer.', code: 'too_large' }, 413);
  let stub;
  try{ stub = env.AMV_COMPUTER.get(env.AMV_COMPUTER.idFromName(await _computerName(user.email))); }
  catch(e){ return json({ error: 'The cloud computer could not be reached. Try again in a minute.', code: 'computer_unavailable' }, 503); }
  await _computerBillAwake(env, user.email, Date.now());
  let r, text;
  try{
    r = await stub.fetch(new Request('http://amv-computer/amv-bridge/' + route, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AMV-Bridge-Token': String(env.AMV_COMPUTER_KEY) }, body: raw || '{}' }));
    text = await r.text();
  }catch(e){
    audit(env, 'computer_unavailable', { by: user.email, route });
    return json({ error: 'The cloud computer did not start. Try again in a minute.', code: 'computer_unavailable' }, 503);
  }
  let d; try{ d = JSON.parse(text); }catch(e){ d = null; }
  if(!d || typeof d !== 'object') return json({ error: 'The cloud computer answered with something AMV could not read.', code: 'computer_unavailable' }, 502);
  /* The container refusing AMV's key means the two Workers hold different
     keys - a deployment fault, not the person's session. Passed through as a
     401 it would read as "signed out" and send them to sign in again. */
  if(r.status === 401){
    audit(env, 'computer_key_mismatch', { by: user.email, route });
    return json({ error: 'The cloud computer is not set up correctly on this deployment. Nothing ran.', code: 'computer_unavailable' }, 503);
  }
  /* A long command kept it awake past the window billed when it started, so
     the window is extended from when it finished. */
  if(route === 'exec'){
    await _computerBillAwake(env, user.email, Date.now());
    if(r.ok) audit(env, 'computer_exec', { by: user.email, ms: +d.ms || 0, exit: d.exitCode });
  }
  return json(d, r.status);
}

/* ══ COMPANY SIGN-IN (single sign-on over OpenID Connect) ═══════════════════

   A team signs its people in through its own identity provider - Okta,
   Microsoft Entra, Google Workspace, anything that speaks OpenID Connect -
   instead of each person keeping an AMV password.

   THE ONE THING THAT MUST NOT HAPPEN is a team owner signing in as somebody
   who is not theirs. The identity provider is chosen by the team, so whatever
   it asserts is only as good as the team's claim to the addresses it vouches
   for. Hence:

     a team names ONE email domain, and proves it owns it with a DNS record
     before anything else happens - an unproved domain signs nobody in;
     a domain anybody can register an address at (gmail.com and friends) can
     never be claimed, proved or not;
     only addresses AT that domain are accepted from its provider - an id token
     for anybody else is refused, whatever it says;
     a domain is held by one team; a second team cannot prove it away.

   The id token is checked here, not trusted: its signature against the
   provider's published keys (RS256 or ES256 - never `none`, never a shared
   secret), the issuer, the audience, the expiry, and the nonce this request
   was started with. The request itself is bound with state and PKCE, and the
   state is spent on first use.

   "Require company sign-in" turns off passwords and Google for the domain, so
   an employee who leaves loses AMV with their company account. The team's
   owner is exempt, so a provider that breaks cannot lock out the one person
   able to switch it off. */
const SSO_STATE_TTL_S = 600;
/* The address providers send people back to: the site root, exactly as the
   go-live guide tells everybody to register it. */
function _appRoot(env){
  const u = String(env.APP_URL || env.APP_ORIGIN || '').replace(/\/$/, '');
  return u ? u + '/' : '';
}
const SSO_PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'gmx.net',
  'mail.com', 'yandex.ru', 'yandex.com', 'qq.com', '163.com', '126.com', 'naver.com', 'zoho.com', 'web.de', 'mail.ru',
  'fastmail.com', 'hey.com', 'tutanota.com', 'tuta.io', 'hotmail.co.uk', 'yahoo.co.uk', 'yahoo.co.jp', 'outlook.es',
  'hotmail.es', 'hotmail.fr', 'libero.it', 'orange.fr', 'free.fr', 't-online.de', 'rediffmail.com', 'sina.com',
]);
function _ssoDomain(d){
  d = String(d || '').toLowerCase().trim().replace(/\.$/, '');
  return /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d) ? d : '';
}
const _ssoDomainOf = (email) => _ssoDomain(String(email || '').toLowerCase().split('@')[1] || '');
/* The value the team puts in DNS: derived from the team and the domain under
   the server's secret, so it cannot be guessed, and proving one domain proves
   nothing about another. */
async function _ssoProof(env, teamId, domain){
  const key = await _hmacKey(env.JWT_SECRET);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('amv-sso-proof:' + teamId + ':' + domain));
  return 'amv-verify=' + [...new Uint8Array(sig)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}
/* DNS over HTTPS, to a resolver AMV chooses - the domain's own name servers
   never get to answer an AMV request directly. */
async function _ssoDnsTxt(name){
  const r = await fetchDeadline('https://cloudflare-dns.com/dns-query?type=TXT&name=' + encodeURIComponent(name),
                                { headers: { Accept: 'application/dns-json' } }, 8000);
  if(!r.ok) throw new Error('sso_dns_unavailable');
  const d = await r.json().catch(() => ({}));
  return (Array.isArray(d.Answer) ? d.Answer : []).filter(a => a && a.type === 16)
    .map(a => String(a.data || '').replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
}
/* The provider's own description of itself. Every endpoint it names must be
   https on a public host, and it must say it is the issuer it was asked as. */
async function _ssoDiscover(issuer){
  const iss = _rmcpSafeUrl(issuer);
  if(!iss) throw new Error('sso_bad_issuer');
  const g = await fetchGuarded(iss.replace(/\/$/, '') + '/.well-known/openid-configuration', { headers: { Accept: 'application/json' } }, 10000);
  if(g.blocked || !g.response.ok) throw new Error('sso_discovery_failed');
  const d = _safeJson(await _rmcpText(g.response, 200000)) || {};
  if(String(d.issuer || '').replace(/\/$/, '') !== iss.replace(/\/$/, '')) throw new Error('sso_issuer_mismatch');
  const auth = _rmcpSafeUrl(d.authorization_endpoint), token = _rmcpSafeUrl(d.token_endpoint), jwks = _rmcpSafeUrl(d.jwks_uri);
  if(!auth || !token || !jwks) throw new Error('sso_discovery_incomplete');
  return { issuer: String(d.issuer), auth, token, jwks };
}
const SSO_ALGS = {
  RS256: { kty: 'RSA', imp: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, ver: { name: 'RSASSA-PKCS1-v1_5' } },
  ES256: { kty: 'EC', imp: { name: 'ECDSA', namedCurve: 'P-256' }, ver: { name: 'ECDSA', hash: 'SHA-256' } },
};
async function _ssoVerifyIdToken(idToken, cfg, nonce){
  const parts = String(idToken || '').split('.');
  if(parts.length !== 3 || idToken.length > 16000) throw new Error('sso_bad_token');
  const header = _safeJson(b64urlDecodeToString(parts[0])) || {};
  const claims = _safeJson(b64urlDecodeToString(parts[1])) || {};
  const alg = SSO_ALGS[header.alg];
  if(!alg) throw new Error('sso_bad_alg');
  const g = await fetchGuarded(cfg.jwks, { headers: { Accept: 'application/json' } }, 10000);
  if(g.blocked || !g.response.ok) throw new Error('sso_keys_unavailable');
  const keys = ((_safeJson(await _rmcpText(g.response, 200000)) || {}).keys || [])
    .filter(k => k && k.kty === alg.kty && (!k.use || k.use === 'sig'));
  const jwk = header.kid ? keys.find(k => k.kid === header.kid) : (keys.length === 1 ? keys[0] : null);
  if(!jwk) throw new Error('sso_unknown_key');
  const pub = alg.kty === 'RSA' ? { kty: 'RSA', n: jwk.n, e: jwk.e } : { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y };
  let ok = false;
  try{
    const key = await crypto.subtle.importKey('jwk', pub, alg.imp, false, ['verify']);
    ok = await crypto.subtle.verify(alg.ver, key, b64urlDecodeToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  }catch(e){ ok = false; }
  if(!ok) throw new Error('sso_bad_signature');
  if(claims.iss !== cfg.issuer) throw new Error('sso_wrong_issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if(!aud.includes(cfg.clientId) || (aud.length > 1 && claims.azp !== cfg.clientId)) throw new Error('sso_wrong_audience');
  const now = Math.floor(Date.now() / 1000);
  if(!(+claims.exp > now - 60)) throw new Error('sso_expired');
  if(+claims.iat > now + 300) throw new Error('sso_bad_token');
  if(!nonce || claims.nonce !== nonce) throw new Error('sso_bad_nonce');
  return claims;
}
const SSO_SAY = {
  sso_bad_issuer: 'That issuer is not an https address AMV can reach.',
  sso_discovery_failed: 'AMV could not read the sign-in settings at that issuer. Check the address - it is usually shown in your provider as "Issuer" or "OpenID configuration".',
  sso_issuer_mismatch: 'That provider describes itself as a different issuer. Use the issuer it names exactly.',
  sso_discovery_incomplete: 'That provider does not publish everything company sign-in needs.',
  sso_dns_unavailable: 'AMV could not look the record up just now. Try again in a minute.',
};

/* The team owner's settings: GET what is set, SET the provider, VERIFY the
   domain, REQUIRE or not, REMOVE. */
async function teamSso(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  if(String(team.ownerEmail || '').toLowerCase() !== user.email)
    return json({ error:'Only the team’s owner can change how it signs in.', code:'owner_only' }, 403);
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || 'get');
  const cur = team.sso || null;
  const view = async (s) => s ? { domain: s.domain, issuer: s.issuer, clientId: s.clientId, verified: !!s.verified,
    required: !!s.required, record: { name: '_amv-verify.' + s.domain, value: await _ssoProof(env, team.id, s.domain) } } : null;
  if(action === 'get') return json({ ok:true, sso: await view(cur), redirectUri: _appRoot(env) });

  if(action === 'set'){
    const limited = await guardAction(env, 'ssoset:' + user.email, 10, 60, 'changes to company sign-in');
    if(limited) return limited;
    const domain = _ssoDomain(body.domain);
    if(!domain) return json({ error:'That is not a domain, like yourcompany.com.', code:'bad_domain' }, 400);
    if(SSO_PUBLIC_DOMAINS.has(domain))
      return json({ error:'Anybody can make an address at ' + domain + ', so it cannot be a company’s domain.', code:'public_domain' }, 400);
    const clientId = String(body.clientId || '').trim();
    const secret = String(body.clientSecret || '');
    if(!clientId || clientId.length > 300) return json({ error:'Put in the client ID your provider gave you.', code:'bad_client' }, 400);
    if(!secret && !(cur && cur.sealed)) return json({ error:'Put in the client secret your provider gave you.', code:'bad_client' }, 400);
    if(secret.length > 2000) return json({ error:'That client secret is too long.', code:'bad_client' }, 400);
    let disc;
    try{ disc = await _ssoDiscover(body.issuer); }
    catch(e){ return json({ error: SSO_SAY[e.message] || 'AMV could not use that provider.', code: e.message }, 400); }
    let sealed = cur && cur.sealed;
    if(secret){
      try{ sealed = await connSeal(env, { s: secret }); }
      catch(e){ return json({ error:'Company sign-in needs this deployment’s connection key (CONNECT_KEY) to keep the secret safe.', code:'needs_service' }, 503); }
    }
    /* Changing the domain un-proves it: the proof was for the old one. */
    const sameDomain = !!(cur && cur.domain === domain);
    let out;
    try{
      out = await _withTeam(env, team.id, (fresh) => {
        if(!fresh) return null;
        fresh.sso = { domain, issuer: disc.issuer, clientId, sealed, verified: sameDomain && !!(fresh.sso && fresh.sso.verified),
                      required: sameDomain && !!(fresh.sso && fresh.sso.required), at: Date.now() };
        return fresh.sso;
      });
    }catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
    if(cur && cur.domain && !sameDomain) await _ssoReleaseDomain(env, cur.domain, team.id);
    await _teamAudit(env, team, user.email, 'sso_set', { domain, issuer: disc.issuer });
    return json({ ok:true, sso: await view(out), redirectUri: _appRoot(env) });
  }

  if(!cur) return json({ error:'Set up company sign-in first.', code:'not_set' }, 400);

  if(action === 'verify'){
    const limited = await guardAction(env, 'ssoverify:' + user.email, 10, 100, 'domain checks');
    if(limited) return limited;
    const want = await _ssoProof(env, team.id, cur.domain);
    let found;
    try{ found = await _ssoDnsTxt('_amv-verify.' + cur.domain); }
    catch(e){ return json({ error: SSO_SAY.sso_dns_unavailable, code:'sso_dns_unavailable' }, 503); }
    if(!found.includes(want))
      return json({ ok:true, verified:false, sso: await view(cur),
                    message:'AMV does not see the record yet. DNS changes can take up to an hour to show.' });
    /* One team per domain. A second team proving the same domain does not
       take it - the first has to let it go. */
    const holder = await env.AMV_KV.get('ssodom:' + cur.domain);
    if(holder && holder !== team.id)
      return json({ error:'Another AMV team already signs in with ' + cur.domain + '.', code:'domain_taken' }, 409);
    await env.AMV_KV.put('ssodom:' + cur.domain, team.id);
    let out;
    try{ out = await _withTeam(env, team.id, (fresh) => { if(fresh && fresh.sso && fresh.sso.domain === cur.domain){ fresh.sso.verified = true; } return fresh && fresh.sso; }); }
    catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
    await _teamAudit(env, team, user.email, 'sso_verified', { domain: cur.domain });
    return json({ ok:true, verified:true, sso: await view(out) });
  }

  if(action === 'require'){
    if(!cur.verified) return json({ error:'Prove the domain first, so nobody is locked out by a sign-in that cannot work.', code:'not_verified' }, 400);
    const on = body.on === true;
    let out;
    try{ out = await _withTeam(env, team.id, (fresh) => { if(fresh && fresh.sso) fresh.sso.required = on; return fresh && fresh.sso; }); }
    catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
    await _teamAudit(env, team, user.email, on ? 'sso_required' : 'sso_optional', { domain: cur.domain });
    return json({ ok:true, sso: await view(out) });
  }

  if(action === 'remove'){
    try{ await _withTeam(env, team.id, (fresh) => { if(fresh) delete fresh.sso; return true; }); }
    catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
    await _ssoReleaseDomain(env, cur.domain, team.id);
    await _teamAudit(env, team, user.email, 'sso_removed', { domain: cur.domain });
    return json({ ok:true, sso: null });
  }
  return json({ error:'unknown action' }, 400);
}
async function _ssoReleaseDomain(env, domain, teamId){
  if((await env.AMV_KV.get('ssodom:' + domain)) === teamId) await env.AMV_KV.delete('ssodom:' + domain);
}
/* The team that signs this address in, if its domain is proved. */
async function _ssoTeamFor(env, email){
  const domain = _ssoDomainOf(email);
  if(!domain) return null;
  const tid = await env.AMV_KV.get('ssodom:' + domain);
  if(!tid) return null;
  const team = await DB.get(env, 'team', tid);
  if(!team || !team.sso || !team.sso.verified || team.sso.domain !== domain) return null;
  return team;
}
/* Whether a password or Google sign-in for this address must go through the
   company instead. The owner is never refused: they are the way back in. */
async function _ssoRequiredFor(env, email){
  const team = await _ssoTeamFor(env, email).catch(() => null);
  if(!team || !team.sso.required) return null;
  if(String(team.ownerEmail || '').toLowerCase() === String(email || '').toLowerCase()) return null;
  return team;
}
const _ssoRequiredJson = (team) => json({ error:'Your company signs in to AMV through its own system. Use “Sign in with your company”.',
                                          code:'sso_required', domain: team.sso.domain }, 403);

/* AN ACCOUNT FOR AN ADDRESS SOMEBODY ELSE HAS JUST VERIFIED (Google, or a
   company's provider).

   A new one is written as it always was, without the account lock, because
   signing in with Google has to keep working while the lock's store is down
   (every-signup-is-counted, the-door-does-not-say-who-lives-here) - and two
   first sign-ins racing for one address write the same record.

   AN ADDRESS NOBODY CONFIRMED IS NOT THE PERSON'S YET. Somebody can sign up
   with another person's address and never enter the code; that account
   carries the squatter's password. The provider has now vouched for the
   address, so that password goes, and every session it opened - otherwise the
   real owner signs in to an account a stranger can still open. That change
   is made under the lock, and if the lock cannot be had the sign-in is
   refused as busy rather than going ahead with the password still on it. */
async function _federatedAccount(env, email, fresh){
  const cur = await DB.get(env, 'acct', email);
  if(!cur){ await DB.put(env, 'acct', email, fresh); return { acct: fresh, created: true, squatted: false }; }
  if((cur.provider || 'email') !== 'email' || cur.emailVerifiedAt || !cur.pwHash) return { acct: cur, created: false, squatted: false };
  let squatted = false, after = cur;
  await _withAcct(env, email, (rec) => {
    if(!rec) return;
    if((rec.provider || 'email') === 'email' && !rec.emailVerifiedAt && rec.pwHash){
      delete rec.pwHash; delete rec.salt; delete rec.pwIter; squatted = true;
    }
    if(!rec.emailVerifiedAt) rec.emailVerifiedAt = Date.now();
    after = Object.assign({}, rec);
  });
  if(squatted) await revokeUserTokens(env, email);
  return { acct: after, created: false, squatted };
}

/* Step one: where to send somebody who typed their work address. */
async function authSsoStart(request, env){
  const lim = await limitAction(env, 'ssostart:' + _rlIp(request), 20, 300);
  if(!lim.ok && !lim.unavailable) return json({ error:'Too many sign-in attempts from here. Give it a moment.', code:'rate_limited' }, 429, { 'Retry-After':'60' });
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  if(!/^[^@\s]+@[^@\s]+$/.test(email) || email.length > 254) return json({ error:'Put in your work email address.', code:'bad_email' }, 400);
  const team = await _ssoTeamFor(env, email);
  if(!team) return json({ ok:true, sso:false });
  let disc;
  try{ disc = await _ssoDiscover(team.sso.issuer); }
  catch(e){ audit(env, 'sso_discovery_failed', { team: team.id, why: e.message }); return json({ error:'Your company’s sign-in could not be reached. Try again, or tell whoever runs it.', code:'sso_unavailable' }, 503); }
  const rnd = () => b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const state = 's_' + rnd(), nonce = rnd(), verifier = rnd();
  const challenge = b64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  await env.AMV_KV.put('ssost:' + state, JSON.stringify({ teamId: team.id, nonce, verifier, at: Date.now() }), { expirationTtl: SSO_STATE_TTL_S });
  const u = new URL(disc.auth);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', team.sso.clientId);
  u.searchParams.set('redirect_uri', _appRoot(env));
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', state);
  u.searchParams.set('nonce', nonce);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('login_hint', email);
  return json({ ok:true, sso:true, url: u.toString(), team: team.name || '' });
}

/* Step two: the provider sent them back with a code. */
async function authSsoFinish(request, env){
  const lim = await limitAction(env, 'ssofin:' + _rlIp(request), 20, 300);
  if(!lim.ok && !lim.unavailable) return json({ error:'Too many sign-in attempts from here. Give it a moment.', code:'rate_limited' }, 429, { 'Retry-After':'60' });
  const body = await request.json().catch(() => ({}));
  const state = String(body.state || ''), code = String(body.code || '');
  if(!/^s_[A-Za-z0-9_-]{20,80}$/.test(state) || !code || code.length > 4096) return json({ error:'That sign-in link is not valid.', code:'sso_bad_state' }, 400);
  /* Spent on first use, before anything else, so a replayed return finds nothing. */
  const raw = await env.AMV_KV.get('ssost:' + state);
  if(!raw) return json({ error:'That sign-in expired or was already used. Start again.', code:'sso_bad_state' }, 400);
  await env.AMV_KV.delete('ssost:' + state);
  const st = _safeJson(raw) || {};
  if(Date.now() - (+st.at || 0) > SSO_STATE_TTL_S * 1000) return json({ error:'That sign-in expired. Start again.', code:'sso_bad_state' }, 400);
  const team = await DB.get(env, 'team', String(st.teamId || ''));
  if(!team || !team.sso || !team.sso.verified) return json({ error:'Your company no longer signs in this way.', code:'sso_off' }, 400);
  const refuse = (why, msg) => { audit(env, 'sso_refused', { team: team.id, why }); return json({ error: msg, code: why }, 401); };
  let disc, secret;
  try{ disc = await _ssoDiscover(team.sso.issuer); }catch(e){ return json({ error:'Your company’s sign-in could not be reached.', code:'sso_unavailable' }, 503); }
  if(disc.issuer !== team.sso.issuer) return refuse('sso_wrong_issuer', 'Your company’s sign-in settings changed. Ask whoever runs it to check them in AMV.');
  try{ secret = (await connOpen(env, team.sso.sealed)).s; }catch(e){ return json({ error:'Company sign-in is not set up correctly on this deployment.', code:'needs_service' }, 503); }
  let tok;
  try{
    const g = await fetchGuarded(disc.token, { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded', Accept:'application/json' },
      body: new URLSearchParams({ grant_type:'authorization_code', code, redirect_uri:_appRoot(env), client_id:team.sso.clientId,
                                  client_secret:secret, code_verifier:st.verifier }).toString() }, 15000);
    if(g.blocked) return json({ error:'Your company’s sign-in could not be reached.', code:'sso_unavailable' }, 503);
    tok = _safeJson(await _rmcpText(g.response, 200000)) || {};
    if(!g.response.ok || !tok.id_token) return refuse('sso_exchange_failed', 'Your company’s system did not confirm the sign-in. Try again.');
  }catch(e){ return json({ error:'Your company’s sign-in could not be reached.', code:'sso_unavailable' }, 503); }
  let claims;
  try{ claims = await _ssoVerifyIdToken(tok.id_token, { issuer: team.sso.issuer, clientId: team.sso.clientId, jwks: disc.jwks }, st.nonce); }
  catch(e){ return refuse(String(e.message || 'sso_bad_token'), 'Your company’s system sent a sign-in AMV could not verify, so you were not signed in.'); }
  const email = String(claims.email || '').toLowerCase().trim();
  if(!email) return refuse('sso_no_email', 'Your company’s system did not say which email address this is. Whoever runs it needs to include the email claim.');
  if(claims.email_verified === false || claims.email_verified === 'false') return refuse('sso_unverified', 'Your company’s system says this address is not verified.');
  /* Only the proved domain. The provider is the team's; addresses elsewhere are not. */
  if(_ssoDomainOf(email) !== team.sso.domain) return refuse('sso_wrong_domain', 'That account is not at ' + team.sso.domain + ', so it cannot sign in through this company.');
  const prior = await env.AMV_KV.get('userteam:' + email);
  if(prior && prior !== team.id){
    const other = await DB.get(env, 'team', prior);
    if(other && _role(other, email)) return json({ error:'This account is in another AMV team. Leave it first, then sign in with your company.', code:'already_in_team' }, 409);
  }
  const name = String(claims.name || email.split('@')[0]).slice(0, 120);
  let fed;
  try{ fed = await _federatedAccount(env, email, { email, name, provider:'sso', createdAt: Date.now(), sipHash: await _ipHash(env, request) }); }
  catch(e){ if(!_isBusy(e)) throw e; return _busyJson('account'); }
  if(fed.squatted) audit(env, 'sso_cleared_unconfirmed_password', { team: team.id });
  const acct = fed.acct, created = fed.created;
  if(created){
    try{ await counter(env, 'popaccounts', { op:'incr', amount:1 }); }catch(e){}
    try{ await _recordGrowth(env, 'signup'); await _funnelMark(env, email, 'signup'); }catch(e){ try{ await _workerError(env, 'authSso:accounting', e); }catch(_){} }
  }
  /* Into the company's team, if there is a seat. No seat is a refusal, not a
     personal account: the company is paying for these, and somebody signing in
     with the company's provider expects the company's AMV. */
  if(!_role(team, email)){
