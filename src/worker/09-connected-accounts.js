/* ══════════════════════════════════════════════════════════════════════════
   CONNECTED ACCOUNTS  -  tokens AMV holds so work can run with the tab closed.

   THE DECISION THIS IMPLEMENTS, AND WHAT IT COSTS.

   Until now a provider token lived in the browser and AMV's servers never saw
   anybody's mail. That is a real privacy property, and it is the honest reason
   the Crew screen said mailbox jobs run only while AMV is open.

   The owner chose the other side deliberately: work that runs with the tab
   closed. That is worth a great deal and it is not free - it means AMV holds a
   key to somebody's mailbox, and one breach of AMV would otherwise expose every
   connected account at once. Everything below exists because of that sentence.

   WHAT MAKES IT SAFE, concretely, rather than as an adjective:

   1. ENCRYPTED AT REST, with a key that is not in the database. KV records are
      plaintext to anything that can read KV - a stolen namespace, a mistaken
      export, an operator query. The refresh token is the crown jewel here, so
      it is sealed with AES-GCM under CONNECT_KEY, a Worker secret. Somebody who
      walks off with the whole store gets ciphertext.
   2. NEVER IN A BACKUP. `conn:` joins BACKUP_NEVER. A backup is a file somebody
      downloads; a long-lived mailbox grant does not belong in one.
   3. NEVER RETURNED TO A CLIENT. Every read path answers with metadata only -
      provider, scopes, when connected, when last used, by which job. There is
      no route that hands a token to a browser, deliberately, so no bug in the
      interface can leak one.
   4. DECRYPTED ONLY TO CALL THE PROVIDER, in the request that needs it, and
      never logged. `_connAudit` records the connection id and the job, never
      the material.
   5. REVOCATION IS REAL. Disconnecting calls the provider's revoke endpoint
      first. Deleting our row while the grant stays live at Google is a lie
      told to somebody who believed they had ended it.
   6. THE PAUSE REACHES IT. Autonomy paused means no unattended run may open a
      connection - the emergency stop has to stop the thing that motivated it.

   Without CONNECT_KEY configured nothing here pretends to work: connecting is
   refused with a message naming the missing secret, rather than storing a token
   in the clear and calling it degraded.                                        */

const CONN_KV = 'conn';            // conn:<email> -> { [connId]: record }
const CONN_VER = 2;                // sealed-payload version, so a format change is detectable

/* AES-GCM under a Worker secret. Returns a compact string that carries its own
   IV and version, because a ciphertext whose IV lives somewhere else is one
   migration away from being undecryptable. */
/* ── ROTATION, WHICH IS THE ONLY REASON THIS IS MORE THAN ONE KEY ────────────

   Every stored token was sealed under one secret with nothing recorded about
   WHICH secret. That is fine until the day the secret has to change - and the
   day it has to change is the day somebody thinks it leaked, which is the worst
   possible day to discover that the only way to rotate it is to make every
   customer reconnect every account. A control that can only be used at that
   cost is a control nobody uses, so in practice the key would never rotate.

   So the sealed payload carries a KEY ID: eight hex characters of the hash of
   the secret, which identifies the key without being derivable back into it.
   CONNECT_KEY is the primary, CONNECT_KEY_PREV is one retired key kept readable
   during a rotation. Records re-seal under the primary the next time they are
   used, so a rotation drains itself and CONNECT_KEY_PREV can be dropped once
   the connections have been touched.

   What this deliberately does NOT claim: it does not shrink the blast radius.
   Whoever holds the primary key can open every record, exactly as before.
   Per-record data keys wrapped by a master key would not change that either -
   the master still unwraps everything - and the thing that would (a KMS holding
   material AMV never sees) is not available here and would put a network call
   on the critical path of every unattended job. Rotation is the honest win;
   pretending to more would be worse than saying so. */
async function _connKeyFor(raw){
  const enc = new TextEncoder();
  const bits = await crypto.subtle.digest('SHA-256', enc.encode(String(raw)));
  /* The id is a hash of the HASH, so the stored id is two rounds away from the
     secret rather than one - and it never shares bytes with the key material
     that is actually imported. */
  const idBits = await crypto.subtle.digest('SHA-256', new Uint8Array(bits));
  const id = [...new Uint8Array(idBits).slice(0, 4)].map(b => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', bits, { name:'AES-GCM' }, false, ['encrypt','decrypt']);
  return { id, key };
}
/* Primary first, then any retired key that is still configured. */
async function _connKeys(env){
  const out = [];
  const primary = String((env && env.CONNECT_KEY) || '');
  if(!primary) return out;
  out.push(await _connKeyFor(primary));
  const prev = String((env && env.CONNECT_KEY_PREV) || '');
  if(prev && prev !== primary) out.push(await _connKeyFor(prev));
  return out;
}
async function _connKey(env){
  const ks = await _connKeys(env);
  return ks.length ? ks[0].key : null;
}
function _b64(buf){ let s=''; const b=new Uint8Array(buf); for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s); }
function _unb64(str){ const s=atob(String(str)); const b=new Uint8Array(s.length); for(let i=0;i<s.length;i++) b[i]=s.charCodeAt(i); return b; }

async function connSeal(env, obj){
  const ks = await _connKeys(env);
  if(!ks.length) throw new Error('connect_key_missing');
  const { id, key } = ks[0];                       // always seal under the primary
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, pt);
  return CONN_VER + '.' + id + '.' + _b64(iv) + '.' + _b64(ct);
}
/* Which key a stored record is sealed under, without opening it. Callers use
   this to decide whether to write the record back re-sealed. */
function connSealedKeyId(sealed){
  const parts = String(sealed||'').split('.');
  return (parts.length === 4 && Number(parts[0]) === CONN_VER) ? parts[1] : '';
}
async function connIsPrimary(env, sealed){
  const ks = await _connKeys(env);
  return !!ks.length && connSealedKeyId(sealed) === ks[0].id;
}
async function connOpen(env, sealed){
  const ks = await _connKeys(env);
  if(!ks.length) throw new Error('connect_key_missing');
  const parts = String(sealed||'').split('.');
  if(parts.length !== 4 || Number(parts[0]) !== CONN_VER) throw new Error('connect_format');
  const kid = parts[1];
  const match = ks.find(k => k.id === kid);
  /* A record sealed under a key that is not configured any more. Named as
     exactly that, because the remedy is specific: put the old value back in
     CONNECT_KEY_PREV. Reporting it as corruption, or as "no connections", would
     send somebody to reconnect every account to fix a secret they changed. */
  if(!match) throw new Error('connect_key_retired');
  const iv = _unb64(parts[2]);
  const ct = _unb64(parts[3]);
  /* A failure HERE is a tampered record or a key id that collides, and both
     must be loud for the same reason. */
  const pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, match.key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

/* Whether this deployment can hold connections at all. Said once so every
   caller refuses the same way. */
function connConfigured(env){ return !!(env && env.CONNECT_KEY); }

/* ── PROVIDERS, AS DATA ──────────────────────────────────────────────────────

   Adding a provider is a row here, not a new code path. That is the whole
   reason this is a framework rather than eight integrations: eight hand-written
   auth flows is eight places to get PKCE, state, refresh and revoke subtly
   wrong, and auth is the last area that should be written eight times.

   `scopes` is the FULL set the provider can be asked for. Nothing requests all
   of it - a connection asks only for the scopes the jobs being switched on
   actually declare, so connecting for a calendar digest does not ask to send
   mail as you. `revoke` is required: a provider AMV cannot really disconnect
   from does not go in this table.

   Every one is dark until its client id and secret exist as Worker secrets.
   Dark means the interface says "not set up on this deployment" and the flow
   cannot be entered - not a button that 500s.                                  */
const CONN_PROVIDERS = {
  google: {
    name: 'Google',
    auth:   'https://accounts.google.com/o/oauth2/v2/auth',
    token:  'https://oauth2.googleapis.com/token',
    revoke: 'https://oauth2.googleapis.com/revoke',
    idEnv: 'GOOGLE_CLIENT_ID', secretEnv: 'GOOGLE_CLIENT_SECRET',
    /* offline + consent, because a refresh token is what makes the tab-closed
       promise true, and Google only issues one when both are asked for. */
    extra: { access_type: 'offline', prompt: 'consent' },
    scopes: {
      'mail.read':     'https://www.googleapis.com/auth/gmail.readonly',
      'mail.send':     'https://www.googleapis.com/auth/gmail.send',
      'calendar.read': 'https://www.googleapis.com/auth/calendar.readonly',
      'calendar.write':'https://www.googleapis.com/auth/calendar.events',
      'drive.read':    'https://www.googleapis.com/auth/drive.readonly',
      /* SCHOOL WORK, READ-ONLY BY SCOPE RATHER THAN BY RULE.

         What a student has been set and when it is due. AMV cannot turn
         anything in, and that is not a promise in a prompt - the permission
         that would allow it (classroom.coursework.me, WITHOUT .readonly) is
         never requested, so Google refuses the call. A rule can be argued with;
         a permission that was never granted cannot.

         courses.readonly lists the classes. coursework.me.readonly reads what
         THIS student was set - never coursework.students, which would read
         other people's work. This is a minor's school record and the narrowest
         access that does the job is the only one worth asking for. */
      'school.read':   'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly',
      /* THE NARROW WRITE, AND IT IS NARROW ON PURPOSE.

         drive.file reaches ONLY files this app created, or ones the person
         explicitly opened with it. It cannot read their Drive. The older flow
         asked for the full `drive` scope, which hands over everything somebody
         owns to do a job that needs one folder - and that is not coming back.

         It is what makes "turn the link your teacher sent into a copy you can
         work in" possible, and the copy AMV creates is the only thing it can
         then touch. A permission AMV does not need is a permission it will one
         day be asked to justify. */
      'drive.write':   'https://www.googleapis.com/auth/drive.file',
      /* YouTube and Google Tasks, asked for only by somebody who picks them. */
      'youtube.read':  'https://www.googleapis.com/auth/youtube.readonly',
      'tasks.write':   'https://www.googleapis.com/auth/tasks',
    },
    api: { base: 'https://www.googleapis.com/' },
  },
  microsoft: {
    name: 'Microsoft',
    auth:   'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token:  'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    /* Microsoft has no token-revocation endpoint in the OAuth sense: a grant is
       ended from the account's own app list. Saying so here keeps the rule
       above honest - AMV will state that plainly at disconnect rather than
       implying it revoked something it cannot. */
    revoke: null,
    revokeNote: 'Microsoft ends this from your account’s connected-apps page.',
    idEnv: 'MS_CLIENT_ID', secretEnv: 'MS_CLIENT_SECRET',
    extra: { response_mode: 'query' },
    scopes: {
      'mail.read':     'Mail.Read offline_access',
      'mail.send':     'Mail.Send offline_access',
      'calendar.read': 'Calendars.Read offline_access',
      'calendar.write':'Calendars.ReadWrite offline_access',
      /* OneDrive, read-only - the files a person picks the chat to look at. */
      'files.read':    'Files.Read offline_access',
    },
    api: { base: 'https://graph.microsoft.com/v1.0/' },
  },
  github: {
    name: 'GitHub',
    auth:   'https://github.com/login/oauth/authorize',
    token:  'https://github.com/login/oauth/access_token',
    revoke: null,
    revokeNote: 'GitHub ends this from Settings → Applications.',
    idEnv: 'GH_CLIENT_ID', secretEnv: 'GH_CLIENT_SECRET',
    /* GitHub grants one `repo` scope and it covers everything, so these
       capability names are AMV's own division of it rather than GitHub's.
       They are still worth keeping separate: `connUse` checks the capability
       before the call is made, so an account connected only for reading
       cannot be talked into a push by a prompt, even though the token it
       holds would technically allow one. The narrowing AMV can enforce is
       the narrowing AMV should offer. */
    scopes: { 'repo.read': 'repo', 'issues.write': 'repo', 'code.write': 'repo' },
    api: { base: 'https://api.github.com/', headers: { Accept: 'application/vnd.github+json' } },
  },

  /* ── APPS WITH A PUBLIC API AND NO OFFICIAL CONNECTOR ──────────────────────

     The owner asked for every app on the Integrations page to connect. The
     ones below publish no official connector (see REMOTE_APPS for those that
     do), so the real route is the app's own standard sign-in - the same shape
     as Google above: an app registered with the provider, its client id and
     secret as Worker secrets, and until then the row says it is not set up on
     this deployment rather than opening a flow that fails. Registering is free
     for every one of them.

     `api` is what makes a connection usable: chat is offered one tool per
     connected app that calls that app's API at `base` with the person's token,
     and every call is asked for with its method, path and body shown before it
     runs. The token's own scopes - chosen by the person at connect time - are
     the limit on what any call can do.

     The provider quirks are data, not code paths:
       tokenAuth    'basic' sends the client secret in an Authorization header,
                    which Spotify, Zoom, Reddit and Pinterest require
       scopeSep     how the provider joins scopes (Slack, Strava, Pinterest: ',')
       scopeParam   the parameter scopes go in (Slack's user token: user_scope)
       tokenPath    where the token sits in the reply (Slack: authed_user)
       noScope      scopes are fixed in the app's settings, not asked for
       revokeStyle  'bearer' posts to the revoke endpoint with the token as the
                    credential; 'access_token' names it that way (Strava);
                    default is a form field called `token`
       revokeClient the revoke request carries the client id and secret too  */
  slack: {
    name: 'Slack',
    auth: 'https://slack.com/oauth/v2/authorize', token: 'https://slack.com/api/oauth.v2.access',
    revoke: 'https://slack.com/api/auth.revoke', revokeStyle: 'bearer',
    idEnv: 'SLACK_CLIENT_ID', secretEnv: 'SLACK_CLIENT_SECRET',
    scopeSep: ',', scopeParam: 'user_scope', tokenPath: 'authed_user',
    scopes: { 'slack.read': 'channels:read,channels:history,groups:read,groups:history,im:read,im:history,users:read,search:read',
              'slack.write': 'chat:write' },
    api: { base: 'https://slack.com/api/' },
  },
  discord: {
    name: 'Discord',
    auth: 'https://discord.com/oauth2/authorize', token: 'https://discord.com/api/oauth2/token',
    revoke: 'https://discord.com/api/oauth2/token/revoke', revokeClient: true,
    idEnv: 'DISCORD_CLIENT_ID', secretEnv: 'DISCORD_CLIENT_SECRET',
    scopes: { 'discord.read': 'identify guilds' },
    api: { base: 'https://discord.com/api/v10/' },
  },
  spotify: {
    name: 'Spotify',
    auth: 'https://accounts.spotify.com/authorize', token: 'https://accounts.spotify.com/api/token',
    revoke: null, revokeNote: 'Spotify ends this from the Apps page of your Spotify account.',
    idEnv: 'SPOTIFY_CLIENT_ID', secretEnv: 'SPOTIFY_CLIENT_SECRET', tokenAuth: 'basic',
    scopes: { 'spotify.read': 'user-read-playback-state user-read-currently-playing user-read-recently-played playlist-read-private user-library-read user-top-read',
              'spotify.write': 'user-modify-playback-state playlist-modify-private playlist-modify-public' },
    api: { base: 'https://api.spotify.com/v1/' },
  },
  dropbox: {
    name: 'Dropbox',
    auth: 'https://www.dropbox.com/oauth2/authorize', token: 'https://api.dropboxapi.com/oauth2/token',
    revoke: 'https://api.dropboxapi.com/2/auth/token/revoke', revokeStyle: 'bearer',
    idEnv: 'DROPBOX_CLIENT_ID', secretEnv: 'DROPBOX_CLIENT_SECRET',
    extra: { token_access_type: 'offline' },
    scopes: { 'dropbox.read': 'account_info.read files.metadata.read files.content.read',
              'dropbox.write': 'files.content.write' },
    api: { base: 'https://api.dropboxapi.com/2/' },
  },
  hubspot: {
    name: 'HubSpot',
    auth: 'https://app.hubspot.com/oauth/authorize', token: 'https://api.hubapi.com/oauth/v1/token',
    revoke: null, revokeNote: 'HubSpot ends this from Connected Apps in your HubSpot account settings.',
    idEnv: 'HUBSPOT_CLIENT_ID', secretEnv: 'HUBSPOT_CLIENT_SECRET',
    scopes: { 'hubspot.read': 'crm.objects.contacts.read crm.objects.companies.read crm.objects.deals.read',
              'hubspot.write': 'crm.objects.contacts.write crm.objects.deals.write' },
    api: { base: 'https://api.hubapi.com/' },
  },
  asana: {
    name: 'Asana',
    auth: 'https://app.asana.com/-/oauth_authorize', token: 'https://app.asana.com/-/oauth_token',
    revoke: 'https://app.asana.com/-/oauth_revoke', revokeClient: true,
    idEnv: 'ASANA_CLIENT_ID', secretEnv: 'ASANA_CLIENT_SECRET',
    scopes: { 'asana.all': 'default' },
    api: { base: 'https://app.asana.com/api/1.0/' },
  },
  zoom: {
    name: 'Zoom',
    auth: 'https://zoom.us/oauth/authorize', token: 'https://zoom.us/oauth/token',
    revoke: 'https://zoom.us/oauth/revoke', tokenAuth: 'basic',
    idEnv: 'ZOOM_CLIENT_ID', secretEnv: 'ZOOM_CLIENT_SECRET', noScope: true,
    scopes: { 'zoom.all': '' },
    api: { base: 'https://api.zoom.us/v2/' },
  },
  box: {
    name: 'Box',
    auth: 'https://account.box.com/api/oauth2/authorize', token: 'https://api.box.com/oauth2/token',
    revoke: 'https://api.box.com/oauth2/revoke', revokeClient: true,
    idEnv: 'BOX_CLIENT_ID', secretEnv: 'BOX_CLIENT_SECRET', noScope: true,
    scopes: { 'box.all': '' },
    api: { base: 'https://api.box.com/2.0/' },
  },
  strava: {
    name: 'Strava',
    auth: 'https://www.strava.com/oauth/authorize', token: 'https://www.strava.com/oauth/token',
    revoke: 'https://www.strava.com/oauth/deauthorize', revokeStyle: 'access_token',
    idEnv: 'STRAVA_CLIENT_ID', secretEnv: 'STRAVA_CLIENT_SECRET', scopeSep: ',',
    scopes: { 'strava.read': 'read,activity:read_all,profile:read_all', 'strava.write': 'activity:write' },
    api: { base: 'https://www.strava.com/api/v3/' },
  },
  reddit: {
    name: 'Reddit',
    auth: 'https://www.reddit.com/api/v1/authorize', token: 'https://www.reddit.com/api/v1/access_token',
    revoke: 'https://www.reddit.com/api/v1/revoke_token', tokenAuth: 'basic',
    idEnv: 'REDDIT_CLIENT_ID', secretEnv: 'REDDIT_CLIENT_SECRET',
    extra: { duration: 'permanent' },
    scopes: { 'reddit.read': 'identity read mysubreddits history', 'reddit.write': 'submit edit vote' },
    /* Reddit refuses API calls without a descriptive User-Agent. */
    api: { base: 'https://oauth.reddit.com/', headers: { 'User-Agent': 'web:amv:1.0 (by AMV)' } },
  },
  pinterest: {
    name: 'Pinterest',
    auth: 'https://www.pinterest.com/oauth/', token: 'https://api.pinterest.com/v5/oauth/token',
    revoke: null, revokeNote: 'Pinterest ends this from Apps in your Pinterest security settings.',
    idEnv: 'PINTEREST_CLIENT_ID', secretEnv: 'PINTEREST_CLIENT_SECRET', tokenAuth: 'basic', scopeSep: ',',
    scopes: { 'pinterest.read': 'boards:read,pins:read,user_accounts:read', 'pinterest.write': 'boards:write,pins:write' },
    api: { base: 'https://api.pinterest.com/v5/' },
  },
  calendly: {
    name: 'Calendly',
    auth: 'https://auth.calendly.com/oauth/authorize', token: 'https://auth.calendly.com/oauth/token',
    revoke: 'https://auth.calendly.com/oauth/revoke', revokeClient: true,
    idEnv: 'CALENDLY_CLIENT_ID', secretEnv: 'CALENDLY_CLIENT_SECRET', noScope: true,
    scopes: { 'calendly.all': '' },
    api: { base: 'https://api.calendly.com/' },
  },
};
/* ONE TOKEN REQUEST FOR EVERY PROVIDER, first exchange and refresh alike, so
   a provider's quirks are handled in one place: where the client secret goes,
   and where the token sits in the reply. Returns the provider's reply with the
   token lifted to the top, or { error }. */
async function _connTokenRequest(env, p, params){
  const body = new URLSearchParams(Object.assign({ client_id: env[p.idEnv] }, params));
  const headers = { 'Content-Type':'application/x-www-form-urlencoded', 'Accept':'application/json' };
  if(p.tokenAuth === 'basic') headers.Authorization = 'Basic ' + btoa(env[p.idEnv] + ':' + env[p.secretEnv]);
  else body.set('client_secret', env[p.secretEnv]);
  const res = await fetchDeadline(p.token, { method:'POST', headers, body: body.toString() }, 20000).catch(()=>null);
  const raw = res ? await res.json().catch(()=>({})) : {};
  const d = (p.tokenPath && raw && raw[p.tokenPath] && raw[p.tokenPath].access_token) ? raw[p.tokenPath] : raw;
  if(!res || !res.ok || !d || !d.access_token)
    return { error: String((raw && raw.error) || (res ? 'http_' + res.status : 'unreachable')).slice(0, 120) };
  return d;
}
/* A token with no stated lifetime does not expire on a clock (GitHub, Slack
   without rotation). Treating it as an hour, which this used to, made every
   such connection report expired after sixty minutes with nothing to refresh. */
function _connExpiry(d){ const n = Number(d && d.expires_in); return n > 0 ? Date.now() + n * 1000 : 0; }
/* EVERY WRITE TO SOMEBODY'S CONNECTIONS IS A CHANGE TO THE RECORD AS IT IS NOW.

   Adding, removing and using a connection each used to read the whole map,
   wait - on a provider's token or revoke endpoint, for seconds - and save the
   whole map back. Whatever another request changed during the wait was undone:
   a token renewed, a connection added, one removed. So each is a mutation
   applied under the record lock; if the lock is busy it is applied to a fresh
   read, which is still the record as it is now rather than as it was. */
async function _connMerge(env, email, mutate){
  try{ return await _withKind(env, CONN_KV, email, mutate, {}); }
  catch(_l){
    const cur = (await DB.get(env, CONN_KV, email)) || {};
    const out = await mutate(cur);
    await DB.put(env, CONN_KV, email, cur);
    return out;
  }
}
/* And one revocation, for disconnecting and for account erasure. */
async function _connRevokeRequest(env, p, tok){
  if(!p || !p.revoke) return { tried:false, ok:false };
  const token = tok.refresh || tok.access;
  const headers = { 'Content-Type':'application/x-www-form-urlencoded' };
  let body;
  if(p.revokeStyle === 'bearer'){ headers.Authorization = 'Bearer ' + tok.access; body = ''; }
  else if(p.revokeStyle === 'access_token'){ body = new URLSearchParams({ access_token: tok.access }).toString(); }
  else {
    const f = new URLSearchParams({ token });
    if(p.tokenAuth === 'basic') headers.Authorization = 'Basic ' + btoa(env[p.idEnv] + ':' + env[p.secretEnv]);
    else if(p.revokeClient){ f.set('client_id', env[p.idEnv]); f.set('client_secret', env[p.secretEnv]); }
    body = f.toString();
  }
  const r = await fetchDeadline(p.revoke, { method:'POST', headers, body }, 15000).catch(()=>null);
  return { tried:true, ok: !!(r && r.ok), status: r ? r.status : 0 };
}

/* What registering one of the API apps switches on, said once for all of them. */
function _apiAppTurnsOn(n){
  return n + ' as a connected app: chat can use its API, asking before each call. Needs an app registered with ' + n
    + ' (free) and both halves pasted here; until then ' + n + ' shows as not set up rather than opening a flow that fails.';
}
function connProviderReady(env, id){
  const p = CONN_PROVIDERS[id];
  return !!(p && env && env[p.idEnv] && env[p.secretEnv]);
}

/* ── THE HANDSHAKE ───────────────────────────────────────────────────────────

   State and the PKCE verifier are held SERVER-SIDE, single use, five minutes.

   The existing Google flow keeps `amv_oauth_state` in localStorage, which is a
   CSRF guard that page script can read and rewrite - so it defends against a
   third-party site and not against anything that is already running on the
   page, which is the attacker that matters for an account-linking flow. The
   verifier must never be in localStorage either: PKCE exists so that a stolen
   authorization code is useless, and a verifier sitting beside it hands both to
   the same injection.

   The browser gets an opaque handle. Everything that proves the exchange is
   ours stays here.                                                             */
const CONN_STATE_TTL_MS = 5 * 60 * 1000;

function _connRandom(n){
  const b = crypto.getRandomValues(new Uint8Array(n));
  return _b64(b).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function _pkceChallenge(verifier){
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return _b64(d).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

/* WHERE A PROVIDER SENDS SOMEBODY BACK, checked once for every sign-in flow -
   Connected accounts and app connectors both. Returns { redirect } or
   { error: <response> }. */
function _connReturnAddress(env, body){
  const appUrl = String(env.APP_URL || env.APP_ORIGIN || '').replace(/\/$/,'');
  if(!appUrl) return { error: json({ error:'no_app_url',
    message:'APP_URL is not set, so there is no address for the provider to send anybody back to.' }, 503) };
  /* ONE DEFINITION OF "SAME ORIGIN", NOT TWO.

     This used to parse and compare the origins inline, which was correct - and
     was the second implementation of a comparison the Worker already had in
     _sameOrigin. The other one belonged to the older Google exchange; when that
     route was retired, _sameOrigin was left with no callers and this copy was
     left as the only live one, which is the exact arrangement where a fix
     applied to one of them silently misses the other.

     _sameOrigin is the survivor because it is the stricter of the two and its
     reasoning is written down: scheme, host and port are compared as parsed
     fields so nothing in one can reach across into another, and a URL carrying
     credentials (https://amv.homes@attacker.example) is refused outright rather
     than compared. The query/fragment rejection below is kept on top of it,
     because that is specific to a redirect target and not to origins in
     general: this exact string goes to the provider as redirect_uri, and it has
     to match what was registered byte for byte. */
  const redirect = String(body.redirect || appUrl);
  let clean = false;
  try{ const u = new URL(redirect); clean = !u.search && !u.hash; }catch(_e){ clean = false; }
  if(!clean || !_sameOrigin(redirect, appUrl))
    return { error: json({ error:'bad_redirect',
      message:'That return address is not this deployment.' }, 400) };
  return { redirect };

}

/* Begin a connection. Returns the URL to send the person to, and nothing that
   could be replayed: the state handle is meaningless without the record here. */
async function connStart(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  if(!connConfigured(env))
    return json({ error:'not_configured', code:'connect_key_missing',
      message:'Connected accounts are not set up on this deployment. The CONNECT_KEY secret has to exist before AMV can hold an account token, because without it the token would be stored unencrypted.' }, 503);

  const blocked = await guardAction(env, 'connstart:' + user.email, 10, 60, 'account connections');
  if(blocked) return blocked;

  const body = await request.json().catch(()=>({}));
  const pid = String(body.provider||'');
  const p = CONN_PROVIDERS[pid];
  if(!p) return json({ error:'unknown_provider' }, 400);
  if(!connProviderReady(env, pid))
    return json({ error:'provider_not_configured', provider:pid, name:p.name,
      message:p.name+' is not set up on this deployment. It needs an app registered with '+p.name+' and its client id and secret added as Worker secrets.' }, 503);

  /* LEAST PRIVILEGE, ENFORCED HERE RATHER THAN TRUSTED FROM THE CLIENT.
     The caller names the capabilities it wants; anything not in the provider's
     table is dropped rather than passed through, so a crafted request cannot
     widen its own grant by inventing a scope string. */
  const want = Array.isArray(body.scopes) ? body.scopes.map(String) : [];
  const granted = want.filter(k => Object.prototype.hasOwnProperty.call(p.scopes, k));
  if(!granted.length) return json({ error:'no_valid_scopes', available:Object.keys(p.scopes) }, 400);

  /* WHERE THE PROVIDER SENDS THEM BACK.

     Not a path AMV invents. This ships as a single-file app served from the
     root, so a redirect to `/connected` would 404 on the static host - and the
     value has to match what is registered with the provider byte for byte,
     including whether there is a trailing slash. So the browser sends the exact
     string it will actually return to, and the server checks it rather than
     trusting it: same origin as APP_URL, no query, no fragment. Without that
     check this parameter is an open redirect with an authorization code
     attached to it. */
  const back = _connReturnAddress(env, body);
  if(back.error) return back.error;
  const redirect = back.redirect;

  /* SELF-IDENTIFYING, and it stays that way now that it is the only return.

     It exists because two OAuth returns used to land on the same URL: the older
     Google grant also handled `?code=&state=` at the app root, both arrived
     looking identical, and the client had to guess which handler owned the
     response. That grant is retired, so today the prefix distinguishes this
     from nothing.

     Kept anyway, and deliberately. The next provider added to this framework
     returns to the same address, and a state that says which flow issued it is
     the difference between a handler that knows the response is not its own and
     one that consumes it and reports a failure to somebody whose connection
     actually worked. It is not a secret and does not need to be - the 24 bytes
     after it are. */
  const state = 'c_' + _connRandom(24);
  const verifier = _connRandom(48);
  const challenge = await _pkceChallenge(verifier);

  /* Sealed like the tokens themselves. A verifier in the clear in KV is a
     verifier available to anything that can read KV. */
  await DB.put(env, 'connstate', state, {
    sealed: await connSeal(env, { verifier, email:user.email, provider:pid, scopes:granted, redirect }),
    exp: Date.now() + CONN_STATE_TTL_MS,
  });

  const sep = p.scopeSep || ' ';
  const scopeStr = [...new Set(granted.map(k => p.scopes[k]).join(sep).split(sep === ' ' ? /\s+/ : sep))].filter(Boolean).join(sep);
  const q = new URLSearchParams(Object.assign({
    client_id: env[p.idEnv], redirect_uri: redirect, response_type: 'code',
    state, code_challenge: challenge, code_challenge_method: 'S256',
  }, p.extra || {}));
  if(!p.noScope && scopeStr) q.set(p.scopeParam || 'scope', scopeStr);
  audit(env, 'conn_start', { by:user.email, provider:pid, scopes:granted });
  return json({ ok:true, url: p.auth + '?' + q.toString(), provider:pid, scopes:granted });
}

/* Finish it. The code is exchanged HERE, so it never touches a browser that
   already handed it back through a URL. */
async function connFinish(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  if(!connConfigured(env)) return json({ error:'not_configured' }, 503);
  const blocked = await guardAction(env, 'connfin:' + user.email, 10, 60, 'account connections');
  if(blocked) return blocked;

  const body = await request.json().catch(()=>({}));
  const state = String(body.state||'');
  const code = String(body.code||'');
  if(!state || !code) return json({ error:'missing_code_or_state' }, 400);

  const rec = await DB.get(env, 'connstate', state);
  /* SINGLE USE, whatever happens next. Deleted before the exchange rather than
     after it, so a failed or replayed exchange cannot be retried against the
     same state. */
  await DB.del(env, 'connstate', state);
  if(!rec) return json({ error:'unknown_state', message:'That connection attempt is not one AMV started, or it has already been used.' }, 400);
  if(!rec.exp || rec.exp < Date.now()) return json({ error:'expired_state', message:'That took too long. Start the connection again.' }, 400);

  let st;
  try{ st = await connOpen(env, rec.sealed); }
  catch(_e){ return json({ error:'state_unreadable' }, 400); }

  /* The state belongs to the account that started it. Without this, somebody
     could finish their own handshake while signed in as anybody else and hang
     the resulting grant on that account. */
  if(st.email !== user.email){
    audit(env, 'conn_state_mismatch', { by:user.email });
    return json({ error:'state_mismatch' }, 400);
  }

  const p = CONN_PROVIDERS[st.provider];
  if(!p || !connProviderReady(env, st.provider)) return json({ error:'provider_not_configured' }, 503);

  const d = await _connTokenRequest(env, p, { code, redirect_uri: st.redirect, grant_type:'authorization_code',
    code_verifier: st.verifier });
  if(d.error){
    /* The provider's own words, not a generic failure - "redirect_uri_mismatch"
       is the difference between a five minute fix and an afternoon. The token
       is not in this object; the error field is safe to pass on. */
    audit(env, 'conn_exchange_failed', { by:user.email, provider:st.provider, why:String(d.error).slice(0,60) });
    return json({ error:'exchange_failed', provider:st.provider, why:String(d.error).slice(0,120) }, 400);
  }

  /* A provider that returned no refresh token cannot do the thing this whole
     feature exists for, and saying so now beats a job that quietly stops
     working in an hour. */
  const connId = st.provider + ':' + _connRandom(8);
  const entry = {
    provider: st.provider, scopes: st.scopes, at: Date.now(),
    unattended: !!d.refresh_token || !_connExpiry(d),
    sealed: await connSeal(env, {
      access: d.access_token, refresh: d.refresh_token || '',
      exp: _connExpiry(d),
    }),
    lastUsed: 0, lastJob: '',
  };
  await _connMerge(env, user.email, (rec) => { rec[connId] = entry; });
  const lasting = !!d.refresh_token || !_connExpiry(d);
  audit(env, 'conn_added', { by:user.email, provider:st.provider, scopes:st.scopes, unattended:lasting });

  return json({ ok:true, id:connId, provider:st.provider, name:p.name, scopes:st.scopes,
    unattended: lasting,
    note: lasting ? null
      : p.name+' did not return a long-lived token, so this connection only works while AMV is open. Disconnect and reconnect to try again.' });
}

/* ── USING A CONNECTION, WHICH IS THE PART THAT MATTERS ──────────────────────

   This is the only way anything in the worker gets a provider token, and it is
   deliberately awkward to call: you must name the job, and you must name the
   capability you need. Both are checked, both are recorded.

   A convenience accessor that just returned "the Google token" would make the
   scope list decoration - every job would hold every permission the connection
   was ever granted, and the reason for asking narrowly at connect time would be
   gone by the first call site. */
async function connUse(env, email, need, jobId, opts){
  const o = opts || {};
  if(!connConfigured(env)) return { ok:false, code:'connect_key_missing' };

  /* THE EMERGENCY STOP REACHES IN HERE.

     "Pause all autonomous" exists because somebody wants AMV to stop touching
     things. A pause that halted the schedule but still let a run in flight open
     a mailbox would be the pause failing at the one moment it is used. Attended
     calls pass `attended` and are unaffected - the person is present.

     Read from the record the pause is ACTUALLY written to. The first version
     of this checked `autonomyPaused` on the user row - a field that does not
     exist anywhere in this worker, so the emergency stop would have compiled,
     read undefined, and let every unattended run open a mailbox while the
     screen said everything was stopped. The pause lives on the automations
     record as `paused`, which is what autoPause writes and what the cron tick
     reads. Same failure as every other one this week: a claim in one file and
     its enforcement in another. */
  if(!o.attended){
    try{
      const rec = await DB.get(env, 'auto', _autoKey(email));
      if(rec && rec.paused) return { ok:false, code:'autonomy_paused' };
    }catch(_e){
      /* Cannot tell. Refuse: an unenforceable stop is not a stop, and the cost
         of being wrong here is a job that waits, not a mailbox that is read. */
      return { ok:false, code:'autonomy_unknown' };
    }
  }

  const all = (await DB.get(env, CONN_KV, email)) || {};
  /* ONE CONNECTION THAT CARRIES ALL OF THEM, not one per capability.

     Copying a school document needs two things at once: permission to read the
     document the teacher owns, and permission to create a file. Satisfying
     them from two different grants would mean a token that can do one half of
     the job, and the failure would arrive from Google in the middle of the
     operation - after the read, before the copy - which is the worst place for
     it. Asked as a set, refused as a set. */
  const needs = Array.isArray(need) ? need.filter(Boolean) : [need];
  const id = Object.keys(all).find(k => {
    const c = all[k];
    return c && Array.isArray(c.scopes) && needs.every(n => c.scopes.indexOf(n) >= 0)
        && (o.attended || c.unattended)
        /* Pinned to one provider when the caller names it. Capability names are
           shared - Google and Microsoft both have mail.read - so without this a
           call meant for one provider's API could be handed the other's token,
           and send it there. */
        && (!o.provider || c.provider === o.provider);
  });
  if(!id) return { ok:false, code:'not_connected', need: needs.join(' + ') };

  const c = all[id];
  const p = CONN_PROVIDERS[c.provider];
  if(!p || !connProviderReady(env, c.provider)) return { ok:false, code:'provider_not_configured' };

  let tok;
  try{ tok = await connOpen(env, c.sealed); }
  catch(_e){
    /* A record that will not open is a retired CONNECT_KEY, a tampered row, or
       a secret changed with no CONNECT_KEY_PREV set. All are loud: presenting
       it as "not connected" would send somebody to reconnect every account to
       fix a secret they changed. */
    const why = String((_e && _e.message) || 'unreadable');
    audit(env, 'conn_unreadable', { by:email, id, why });
    if(why === 'connect_key_retired'){
      try{ await alertOnce(env, 'connect_key_retired',
        'A stored connection is sealed under a CONNECT_KEY that is no longer configured, so it cannot be '
        + 'read. Put the previous value in CONNECT_KEY_PREV until every connection has been used once, '
        + 'then remove it. Nothing is lost while the old key exists.', 60); }catch(_a){}
    }
    return { ok:false, code:'unreadable' };
  }
  /* LAZY ROTATION. This record is about to be written back anyway - the last
     used stamp below - so a record sealed under a retired key is re-sealed
     under the primary here, at no extra write. A rotation therefore drains
     itself as connections get used, rather than needing a migration job that
     would have to hold every token in memory to run. */
  let reseal = false, refreshed = false;
  try{ reseal = !(await connIsPrimary(env, c.sealed)); }catch(_e){}

  /* Refreshed with a minute to spare, so a token does not expire between this
     check and the request it is about to be used for. */
  if(tok.exp && tok.exp - 60000 < Date.now()){
    if(!tok.refresh) return { ok:false, code:'expired_no_refresh', id };
    const d = await _connTokenRequest(env, p, { refresh_token: tok.refresh, grant_type:'refresh_token' });
    if(d.error){
      /* TWO AT ONCE IS NOT A REVOCATION.

         Zoom, Box and others rotate the refresh token on every use. Two
         requests renewing together: the first is answered and saves a new
         pair, the second presents the token the first just spent and is
         refused. This used to mark the connection broken - and it did so by
         writing back the map it read at the start, over the pair the first
         had just saved, so the connection really was dead afterwards. So a
         refused refresh looks for a newer token first, for about a second
         and a half, because the winner is still writing. */
      let won = null;
      for(const wait of [0, 400, 1200]){
        if(wait) await new Promise(res => setTimeout(res, wait));
        try{
          const cur = ((await DB.get(env, CONN_KV, email)) || {})[id];
          if(cur && cur.sealed !== c.sealed){
            const t2 = await connOpen(env, cur.sealed);
            if(t2.access !== tok.access && (!t2.exp || t2.exp - 60000 > Date.now())){ won = { cur, t2 }; break; }
          }
        }catch(_w){}
      }
      if(!won){
        /* A refresh that fails usually means the person revoked it at the
           provider. Marked so the interface can say "reconnect this" instead of
           a job failing silently every morning for a fortnight - and marked on
           the record as it is now, only if it is still the one that failed. */
        const why = String(d.error||'refresh_failed').slice(0,60);
        try{ await _connMerge(env, email, (rec) => { if(rec[id] && rec[id].sealed === c.sealed) rec[id].broken = why; }); }catch(_m){}
        audit(env, 'conn_refresh_failed', { by:email, id, why });
        return { ok:false, code:'refresh_failed', id, why };
      }
      tok = won.t2; c.sealed = won.cur.sealed; reseal = false;
    } else {
      tok.access = d.access_token;
      if(d.refresh_token) tok.refresh = d.refresh_token;   // providers that rotate
      tok.exp = _connExpiry(d);
      c.sealed = await connSeal(env, tok);
      refreshed = true;
    }
  }

  /* WHAT USED WHAT, AND WHEN. Never the token, and never what it read - the
     point is an account holder can see that a job opened their mailbox on
     Tuesday, not a copy of their mail in an audit log. */
  const lastJob = String(jobId||'').slice(0, 60);
  if(reseal){
    c.sealed = await connSeal(env, tok);
    audit(env, 'conn_resealed', { by:email, id });
  }
  /* Written into the record as it is NOW, not the map read at the top. That
     map is as old as this request, and saving it whole put back anything
     another request had changed meanwhile - a token it had just renewed, a
     connection it had just removed. */
  const write = refreshed || reseal;
  const stamp = (rec) => {
    const r = rec && rec[id];
    if(!r) return;
    r.lastUsed = Date.now(); r.lastJob = lastJob;
    if(write){ r.sealed = c.sealed; delete r.broken; }
  };
  /* A renewed token that is not saved is a spent refresh token and a dead
     connection, so this write is not skipped when the lock is busy. */
  await _connMerge(env, email, stamp);
  audit(env, 'conn_used', { by:email, id, provider:c.provider, need, job:c.lastJob, attended:!!o.attended });

  return { ok:true, id, provider:c.provider, token: tok.access };
}

/* What the account holder can see. Metadata only, and that is structural: there
   is no route in this worker that returns a provider token to a browser, so no
   mistake in the interface can leak one. */
async function connList(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const all = (await DB.get(env, CONN_KV, user.email)) || {};
  const items = Object.keys(all).map(id => {
    const c = all[id];
    const p = CONN_PROVIDERS[c.provider] || {};
    return { id, provider:c.provider, name:p.name || c.provider, scopes:c.scopes || [],
             at:c.at || 0, lastUsed:c.lastUsed || 0, lastJob:c.lastJob || '',
             unattended: !!c.unattended, broken: c.broken || null,
             revokeNote: p.revoke ? null : (p.revokeNote || null) };
  }).sort((a,b) => (b.at||0) - (a.at||0));
  const providers = Object.keys(CONN_PROVIDERS).map(id => ({
    id, name: CONN_PROVIDERS[id].name,
    ready: connProviderReady(env, id),
    scopes: Object.keys(CONN_PROVIDERS[id].scopes),
    api: CONN_PROVIDERS[id].api ? CONN_PROVIDERS[id].api.base : null,
  }));
  return json({ ok:true, configured: connConfigured(env), items, providers });
}

/* ── CALLING A CONNECTED APP'S API, FROM CHAT ───────────────────────────────

   The one tool chat is offered for each connected app with an `api` in the
   provider table. The person asked for this call - chat shows the method, the
   path and the body and waits for Allow once - and this is where it runs.

   What bounds it, on the server where it cannot be talked out of it:
     · the token comes from connUse and nowhere else, so the pause, the
       refresh, the broken marking and the audit line all apply;
     · the address is the provider's own API and nothing else - a path that
       names a scheme, a host, `..` or a backslash is refused, and the built
       URL must still start with the base after parsing;
     · the token's scopes, chosen by the person at connect time, are the limit
       on what any call can do;
     · the reply is bounded, and the arguments are never written to the audit
       log - they are somebody's messages and files. */
const CONN_API_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const CONN_API_MAX_OUT = 60000;
function _connApiUrl(base, path, query){
  const raw = String(path || '');
  if(!raw || raw.length > 500 || /[\u0000-\u001f\\]/.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return '';
  const rel = raw.replace(/^\/+/, '');
  if(rel.split(/[/?#]/)[0] === '..' || /(^|\/)\.\.(\/|$|\?)/.test(rel) || /%2e%2e|%2f/i.test(rel)) return '';
  let u;
  try { u = new URL(rel, base); } catch (e) { return ''; }
  const b = new URL(base);
  if(u.origin !== b.origin || !u.pathname.startsWith(b.pathname)) return '';
  if(query && typeof query === 'object' && !Array.isArray(query)){
    for(const [k, v] of Object.entries(query).slice(0, 40)){
      if(v === undefined || v === null) continue;
      u.searchParams.set(String(k).slice(0, 100), typeof v === 'object' ? JSON.stringify(v) : String(v).slice(0, 2000));
    }
  }
  return u.toString();
}
async function connApi(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  { const k = _refuseApiKey(user, 'use a connected app'); if (k) return k; }
  const blocked = await guardAction(env, 'connapi:' + user.email, 60, 2000, 'connected app actions');
  if(blocked) return blocked;
  const body = await request.json().catch(()=>({}));
  const pid = String(body.provider || '');
  const p = Object.prototype.hasOwnProperty.call(CONN_PROVIDERS, pid) ? CONN_PROVIDERS[pid] : null;
  if(!p || !p.api) return json({ error:'unknown_provider' }, 400);
  const method = String(body.method || 'GET').toUpperCase();
  if(CONN_API_METHODS.indexOf(method) < 0) return json({ error:'bad_method' }, 400);
  const url = _connApiUrl(p.api.base, body.path, body.query);
  if(!url) return json({ error:'bad_path', message:'That address is not part of ' + p.name + '\u2019s API.' }, 400);
  let payload;
  if(body.body !== undefined && body.body !== null && method !== 'GET'){
    payload = typeof body.body === 'string' ? body.body : JSON.stringify(body.body);
    if(payload.length > 50000) return json({ error:'body_too_large' }, 413);
  }
  const all = (await DB.get(env, CONN_KV, user.email)) || {};
  const rec = Object.values(all).find(c => c && c.provider === pid);
  if(!rec) return json({ error:'not_connected', message: p.name + ' is not connected. Connect it in Integrations.' }, 404);
  const u = await connUse(env, user.email, rec.scopes || [], 'chat', { attended: true, provider: pid });
  if(!u.ok){
    const again = ['refresh_failed', 'expired_no_refresh', 'unreadable'].indexOf(u.code) >= 0;
    return json({ error: u.code, message: again ? p.name + ' needs connecting again. Reconnect it in Integrations.'
                                                 : p.name + ' could not be used just now (' + u.code + ').' }, again ? 401 : 503);
  }
  /* Asserted as well as asked for: a token goes only to its own provider. */
  if(u.provider !== pid) return json({ error:'wrong_provider' }, 500);
  const headers = Object.assign({ Authorization: 'Bearer ' + u.token, Accept: 'application/json' }, p.api.headers || {});
  if(payload !== undefined) headers['Content-Type'] = /^\s*[\[{]/.test(payload) ? 'application/json; charset=utf-8' : 'application/x-www-form-urlencoded';
  let g;
  try { g = await fetchGuarded(url, { method, headers, body: payload }, 30000); }
  catch (e) { return json({ error:'app_unreachable', message: p.name + ' did not answer. Nothing was changed.' }, 502); }
  if(g.blocked) return json({ error:'blocked', message: g.why }, 400);
  const text = await _rmcpText(g.response, CONN_API_MAX_OUT);
  audit(env, 'conn_api', { by:user.email, provider:pid, method, path: new URL(url).pathname.slice(0, 120), status: g.response.status });
  return json({ ok:true, status: g.response.status, body: text });
}

/* Disconnect. Revokes at the provider FIRST, and only then forgets it.

   Deleting our row and reporting success is the version somebody writes when
   they are thinking about the database rather than about the person: the grant
   stays live at Google, AMV simply stops being able to see it, and the account
   holder has been told they ended something they did not. */
/* ── ACTING ON A CONNECTED ACCOUNT ───────────────────────────────────────────

   These six things - read the inbox, send a mail, read the calendar, add an
   event, list Drive files, read school work - used to run IN THE BROWSER with a
   Google token the page was holding. That is the older grant, and it is the
   thing Connected accounts exists to replace: a provider token that reaches a
   page is a token anything on that page can take, and it is gone the moment the
   tab closes, so nothing built on it can run overnight.

   Under this system the token never leaves the Worker. So the browser asks the
   Worker to act, and the Worker is the only thing that ever holds the key.

   ONE ROUTE RATHER THAN SIX, on purpose. The capability each action needs is
   declared beside it in a table instead of at each call site, so an action
   added later cannot be written without one - which is exactly how the old
   layer ended up calling Google with a token that had never been granted the
   scope. Everything goes through connUse, so every one of these lands in the
   account's activity as "this job opened your mailbox on Tuesday".

   Attended, because a person is waiting. The autonomy pause stops UNattended
   work: an emergency stop that also froze the button somebody just pressed
   would be a different feature with the same name. */
/* ── GITHUB ARGUMENT VALIDATION ──────────────────────────────────────────────
   Every one of these throws rather than coercing. A repo name that is nearly
   right, a branch with a slash in the wrong place, a path that climbs out of
   the tree - each is a request that should not be sent, and quietly repairing
   it is how a caller ends up pushing somewhere it did not mean to. */
const GH_MAX_FILES = 60;
const GH_MAX_BYTES = 2 * 1024 * 1024;
function _ghHeaders(token){
  return { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json',
           'Content-Type': 'application/json',
           'X-GitHub-Api-Version': '2022-11-28',
           /* GitHub refuses requests without one. */
           'User-Agent': 'AMV' };
}
function _ghRepo(v){
  const s = String(v || '').trim();
  if(!/^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/.test(s)) throw new Error('bad_repo');
  return s;
}
function _ghBranch(v){
  const s = String(v || '').trim();
  /* No leading or trailing slash, no `..`, no control characters, and no
     leading dash - which git itself would read as an option. */
  if(!/^[A-Za-z0-9._\/-]{1,200}$/.test(s)) throw new Error('bad_branch');
  if(s.startsWith('/') || s.endsWith('/') || s.startsWith('-') || s.indexOf('..') >= 0) throw new Error('bad_branch');
  return s;
}
function _ghPath(v){
  const s = String(v || '').trim().replace(/^\/+/, '');
  if(!s || s.length > 300) throw new Error('bad_path');
  if(s.indexOf('..') >= 0 || /^\.git(\/|$)/i.test(s)) throw new Error('bad_path');
  if(/[\0-\x1f]/.test(s)) throw new Error('bad_path');
  return s;
}


/* ── Google Docs and Sheets helpers (CONN_ACTIONS docs.* and sheets.*) ───── */
function _gFileId(args){
  const id = String((args && args.fileId) || '').slice(0, 200);
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) throw new Error('bad_file');
  return id;
}
/* A1 notation: an optional tab name (quoted when it has spaces) and cells. */
function _gRange(r){
  const s = String(r || '').trim();
  if (!/^(?:(?:'(?:[^']|'')+'|[A-Za-z0-9_]+)!)?(?:[A-Z]{1,3}[0-9]{0,7}(?::[A-Z]{1,3}[0-9]{0,7})?|[0-9]{1,7}:[0-9]{1,7})$/.test(s)
      && !/^'(?:[^']|'')+'$/.test(s)) throw new Error('bad_range');
  return s;
}
/* Google's answer, or an error that says which kind of no it was. A file AMV
   was not handed is a 403 or a 404 from Google, and both mean the same thing
   to the person: choose it first. */
async function _gJson(token, url, api, init){
  const r = await fetchDeadline(url, Object.assign({}, init || {}, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }), 20000);
  if (r.status === 403 || r.status === 404) throw new Error(api + '_not_chosen');
  if (!r.ok) throw new Error(api + '_' + r.status);
  return await r.json().catch(() => ({}));
}
/* A document's words, in order: paragraphs and the cells of tables. */
function _docText(d){
  const out = [];
  const walk = (content) => {
    for (const el of (content || [])) {
      if (el.paragraph) out.push((el.paragraph.elements || []).map(e => (e.textRun && e.textRun.content) || '').join(''));
      else if (el.table) for (const row of (el.table.tableRows || [])) for (const cell of (row.tableCells || [])) walk(cell.content);
      else if (el.tableOfContents) walk(el.tableOfContents.content);
    }
  };
  walk(d && d.body && d.body.content);
  return out.join('');
}

const CONN_ACTIONS = {
  'gmail.unread': {
    need: 'mail.read', writes: false,
    async run(token){
      const r = await fetchDeadline('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&labelIds=INBOX&q=is:unread',
        { headers: { Authorization: 'Bearer ' + token } }, 15000);
      if(!r.ok) throw new Error('gmail_' + r.status);
      const d = await r.json().catch(()=>({}));
      const ids = (d.messages || []).slice(0, 8);
      const out = [];
      for(const m of ids){
        const g = await fetchDeadline('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(m.id) + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From',
          { headers: { Authorization: 'Bearer ' + token } }, 15000);
        if(!g.ok) continue;
        const md = await g.json().catch(()=>({}));
        const h = (md.payload && md.payload.headers) || [];
        const pick = (n) => String(((h.find(x => x.name === n) || {}).value) || '').slice(0, 200);
        out.push({ id: md.id, from: pick('From'), subject: pick('Subject') });
      }
      return out;
    },
  },
  'gmail.send': {
    need: 'mail.send', writes: true,
    async run(token, args){
      const to = String(args.to || '').slice(0, 320);
      if(!HANDOFF_TO_RE.test(to)) throw new Error('bad_recipient');
      /* Header injection: a newline in a subject ends the header and starts
         another, which is how one message becomes a message with extra
         recipients nobody chose. The body is after the blank line and cannot
         do it; the subject is before it and can. */
      const subject = String(args.subject || '').replace(/[\r\n]+/g, ' ').slice(0, 200);
      const body = String(args.body || '').slice(0, 20000);
      const raw = ['To: ' + to, 'Subject: ' + subject, 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n');
      const b64 = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      const r = await fetchDeadline('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        { method:'POST', headers:{ Authorization:'Bearer ' + token, 'Content-Type':'application/json' },
          body: JSON.stringify({ raw: b64 }) }, 20000);
      if(!r.ok) throw new Error('gmail_' + r.status);
      const d = await r.json().catch(()=>({}));
      /* The send permission cannot read the mailbox, so the read-back is
         Gmail's own record of the message it created: an id, filed as SENT. */
      const verified = !!d.id && Array.isArray(d.labelIds) && d.labelIds.includes('SENT');
      return { sent: verified, id: d.id || '', verified };
    },
  },
  'calendar.list': {
    need: 'calendar.read', writes: false,
    async run(token){ return await _fetchCalendar(token); },
  },
  'calendar.create': {
    need: 'calendar.write', writes: true,
    async run(token, args){
      const start = String(args.start || '');
      if(!start || isNaN(Date.parse(start))) throw new Error('bad_start');
      const end = String(args.end || '') && !isNaN(Date.parse(String(args.end))) ? String(args.end) : start;
      const body = { summary: String(args.title || '(no title)').slice(0, 200),
                     description: String(args.description || '').slice(0, 4000),
                     start: { dateTime: start }, end: { dateTime: end } };
      const r = await fetchDeadline('https://www.googleapis.com/calendar/v3/calendars/primary/events',
        { method:'POST', headers:{ Authorization:'Bearer ' + token, 'Content-Type':'application/json' },
          body: JSON.stringify(body) }, 20000);
      if(!r.ok) throw new Error('calendar_' + r.status);
      const d = await r.json().catch(()=>({}));
      /* Read back from the calendar, not taken from the answer to the insert. */
      let verified = false;
      if(d.id){
        try{
          const g = await fetchDeadline('https://www.googleapis.com/calendar/v3/calendars/primary/events/' + encodeURIComponent(d.id),
            { headers:{ Authorization:'Bearer ' + token } }, 15000);
          if(g.status === 404) verified = false; else if(!g.ok) verified = null;
          else { const e = await g.json().catch(()=>({})); verified = e.id === d.id && e.status !== 'cancelled'; }
        }catch(e){ verified = null; }
      }
      return { created: verified !== false, id: d.id || '', link: d.htmlLink || '', verified };
    },
  },
  'drive.list': {
    need: 'drive.read', writes: false,
    async run(token){
      const r = await fetchDeadline('https://www.googleapis.com/drive/v3/files?pageSize=30&orderBy=modifiedTime%20desc&fields=files(name,mimeType,modifiedTime)',
        { headers: { Authorization: 'Bearer ' + token } }, 15000);
      if(!r.ok) throw new Error('drive_' + r.status);
      const d = await r.json().catch(()=>({}));
      return (d.files || []).slice(0, 30).map(f => ({ name: String(f.name || '').slice(0, 200),
        type: String(f.mimeType || '').split('/').pop(), modified: f.modifiedTime || '' }));
    },
  },
  'school.due': {
    need: 'school.read', writes: false,
    async run(token){ return await _fetchClassroom(token); },
  },
  /* TURN THE LINK A TEACHER SENT INTO A COPY YOU CAN WORK IN.

     Two capabilities, not one, and the pair is the honest requirement: reading
     the document the teacher owns needs drive.read, creating the copy needs
     drive.write (which is drive.file - only what AMV made). Declaring one of
     them would mean a token that can do half the job and a refusal from Google
     arriving mid-operation. */
  'drive.copy': {
    need: ['drive.read', 'drive.write'], writes: true,
    async run(token, args){
      const fileId = String(args.fileId || '').slice(0, 200);
      if(!/^[A-Za-z0-9_-]{5,}$/.test(fileId)) throw new Error('bad_file');
      const title = String(args.title || 'Copy').slice(0, 200);
      const r = await fetchDeadline(
        'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '/copy?fields=id,name,webViewLink',
        { method:'POST', headers:{ Authorization:'Bearer ' + token, 'Content-Type':'application/json' },
          body: JSON.stringify({ name: title }) }, 20000);
      if(!r.ok) throw new Error('drive_' + r.status);
      const d = await r.json().catch(()=>({}));
      let verified = false;
      if(d.id){
        try{
          const g = await fetchDeadline('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(d.id) + '?fields=id,trashed',
            { headers:{ Authorization:'Bearer ' + token } }, 15000);
          if(g.status === 404) verified = false; else if(!g.ok) verified = null;
          else { const f = await g.json().catch(()=>({})); verified = f.id === d.id && !f.trashed; }
        }catch(e){ verified = null; }
      }
      return { id: d.id || '', name: d.name || title, link: d.webViewLink || '', verified };
    },
  },
  /* Share the copy AMV made - never anything else. drive.file cannot reach a
     file this app did not create, so the permission this grants is bounded by
     the same scope that made the copy: there is no shape of arguments that
     turns this into sharing somebody's own documents. */
  'drive.share': {
    need: 'drive.write', writes: true,
    async run(token, args){
      const fileId = String(args.fileId || '').slice(0, 200);
      if(!/^[A-Za-z0-9_-]{5,}$/.test(fileId)) throw new Error('bad_file');
      const to = String(args.email || '').slice(0, 320);
      if(!HANDOFF_TO_RE.test(to)) throw new Error('bad_recipient');
      /* Reader or writer, and nothing else. `owner` transfers the document away
         from the student, which is not a share and is not undoable by them. */
      const role = args.role === 'reader' ? 'reader' : 'writer';
      const r = await fetchDeadline(
        'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '/permissions?sendNotificationEmail=true',
        { method:'POST', headers:{ Authorization:'Bearer ' + token, 'Content-Type':'application/json' },
          body: JSON.stringify({ type:'user', role, emailAddress: to }) }, 20000);
      if(!r.ok) throw new Error('drive_' + r.status);
      const p = await r.json().catch(()=>({}));
      /* The permission as Drive now holds it: this person, this role. */
      let verified = false;
      if(p.id){
        try{
          const g = await fetchDeadline('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId)
            + '/permissions/' + encodeURIComponent(p.id) + '?fields=id,role,emailAddress',
            { headers:{ Authorization:'Bearer ' + token } }, 15000);
          if(g.status === 404) verified = false; else if(!g.ok) verified = null;
          else { const q = await g.json().catch(()=>({}));
                 verified = q.role === role && String(q.emailAddress || '').toLowerCase() === to.toLowerCase(); }
        }catch(e){ verified = null; }
      }
      return { shared: verified !== false, role, verified };
    },
  },
  /* ── GOOGLE DOCS AND SHEETS, EDITED WHERE THEY ARE ─────────────────────────

     On the same narrow permission as the copy above: drive.file reaches the
     files AMV made and the ones the person CHOSE for it in Google's own file
     picker, and nothing else in their Drive. So "edit my budget sheet" means
     the sheet they picked, and there is no shape of arguments that reaches a
     file they did not hand over - Google refuses it, and that refusal is
     turned into a sentence that says how to hand it over.

     Every write is read back. What comes back to the person is what the file
     now says, not what the request said it would say. */
  'docs.read': {
    need: 'drive.write', writes: false,
    async run(token, args){
      const id = _gFileId(args);
      const d = await _gJson(token, 'https://docs.googleapis.com/v1/documents/' + id + '?fields=title,body', 'docs');
      return { id, title: String(d.title || '').slice(0, 200), text: _docText(d).slice(0, 60000),
               link: 'https://docs.google.com/document/d/' + id + '/edit' };
    },
  },
  'docs.edit': {
    need: 'drive.write', writes: true,
    async run(token, args){
      const id = _gFileId(args);
      const reps = (Array.isArray(args.replace) ? args.replace : []).slice(0, 20).map(r => ({
        find: String((r && r.find) || ''), to: String((r && (r.with != null ? r.with : r.to)) || ''), matchCase: !!(r && r.matchCase) }));
      if (reps.some(r => !r.find || r.find.length > 1000 || r.to.length > 20000)) throw new Error('bad_edit');
      const append = args.append == null ? '' : String(args.append);
      if (append.length > 20000) throw new Error('bad_edit');
      if (!reps.length && !append) throw new Error('bad_edit');
      const requests = reps.map(r => ({ replaceAllText: { containsText: { text: r.find, matchCase: r.matchCase }, replaceText: r.to } }));
      if (append) requests.push({ insertText: { endOfSegmentLocation: {}, text: '\n' + append } });
      const res = await _gJson(token, 'https://docs.googleapis.com/v1/documents/' + id + ':batchUpdate', 'docs',
                               { method: 'POST', body: JSON.stringify({ requests }) });
      const counts = reps.map((r, i) => ({ find: r.find.slice(0, 80),
        count: +(((res.replies || [])[i] || {}).replaceAllText || {}).occurrencesChanged || 0 }));
      /* What the document says now. A read-back that fails does not undo
         the edit, so it is reported as unconfirmed - never as nothing done. */
      let verified = null;
      try{
        const after = _docText(await _gJson(token, 'https://docs.googleapis.com/v1/documents/' + id + '?fields=body', 'docs'));
        verified = counts.every((c, i) => !c.count || !reps[i].to || after.includes(reps[i].to))
                && (!append || after.includes(append.trim()));
      }catch(e){}
      return { id, replaced: counts, appended: !!append, verified,
               link: 'https://docs.google.com/document/d/' + id + '/edit' };
    },
  },
  'sheets.read': {
    need: 'drive.write', writes: false,
    async run(token, args){
      const id = _gFileId(args);
      const meta = await _gJson(token, 'https://sheets.googleapis.com/v4/spreadsheets/' + id + '?fields=properties.title,sheets.properties.title', 'sheets');
      const tabs = (meta.sheets || []).map(t => String((t.properties || {}).title || '')).slice(0, 50);
      const range = args.range ? _gRange(args.range) : (tabs[0] ? "'" + tabs[0].replace(/'/g, "''") + "'" : '');
      const v = range ? await _gJson(token, 'https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(range), 'sheets') : {};
      const rows = (v.values || []).slice(0, 2000).map(r => (r || []).slice(0, 100).map(c => String(c).slice(0, 2000)));
      return { id, title: String((meta.properties || {}).title || '').slice(0, 200), tabs, range: v.range || range, rows,
               link: 'https://docs.google.com/spreadsheets/d/' + id + '/edit' };
    },
  },
  'sheets.write': {
    need: 'drive.write', writes: true,
    async run(token, args){
      const id = _gFileId(args);
      const range = _gRange(args.range);
      const values = Array.isArray(args.values) ? args.values : null;
      if (!values || !values.length || values.some(r => !Array.isArray(r))) throw new Error('bad_values');
      let cells = 0;
      const clean = values.map(r => r.map(c => {
        cells++;
        if (typeof c === 'number' || typeof c === 'boolean') return c;
        return String(c == null ? '' : c).slice(0, 50000);
      }));
      if (cells > 10000) throw new Error('too_many_cells');
      const res = await _gJson(token, 'https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(range)
        + '?valueInputOption=USER_ENTERED', 'sheets',
        { method: 'PUT', body: JSON.stringify({ range, majorDimension: 'ROWS', values: clean }) });
      /* What the range holds now, as entered - formulas as formulas. */
      let verified = null;
      try{
        const back = await _gJson(token, 'https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/'
          + encodeURIComponent(res.updatedRange || range) + '?valueRenderOption=FORMULA', 'sheets');
        const got = back.values || [];
        verified = clean.every((r, i) => r.every((c, j) => {
          const g = (got[i] || [])[j];
          return String(c) === '' ? (g == null || String(g) === '') : String(g) === String(c);
        }));
      }catch(e){}
      return { id, range: res.updatedRange || range, updatedCells: +res.updatedCells || 0, verified,
               link: 'https://docs.google.com/spreadsheets/d/' + id + '/edit' };
    },
  },
  /* ── GITHUB ────────────────────────────────────────────────────────────────
     GitHub was in the provider table with two capability names and NO actions,
     which is the same as not being there: an account could be connected and
     then do nothing at all. These are the three that make the loop close -
     find the repo, put the code somewhere, open the pull request.

     NOTHING HERE PUSHES TO A DEFAULT BRANCH. Every push goes to a branch this
     code names, created off the base, and the pull request is what asks for it
     to land. That is not a policy written in a prompt somewhere - `github.push`
     has no argument that could name an existing branch to overwrite, and the
     ref call below only ever CREATES. A tool that can move somebody's main
     branch is a tool that will eventually move somebody's main branch. */
  'github.repos': {
    need: 'repo.read', writes: false,
    async run(token){
      const r = await fetchDeadline(
        'https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
        { headers: _ghHeaders(token) }, 15000);
      if(!r.ok) throw new Error('github_' + r.status);
      const d = await r.json().catch(()=>[]);
      /* Only the ones a push could actually land in, and only the fields the
         picker needs - not the eighty a repo object carries. */
      return (Array.isArray(d) ? d : [])
        .filter(x => x && x.permissions && x.permissions.push)
        .slice(0, 100)
        .map(x => ({ full: x.full_name, private: !!x.private,
                     branch: x.default_branch || 'main' }));
    },
  },
  'github.push': {
    need: 'code.write', writes: true,
    async run(token, args){
      const repo = _ghRepo(args.repo);
      const base = _ghBranch(args.base || 'main');
      const branch = _ghBranch(args.branch);
      const message = String(args.message || 'Changes from AMV').slice(0, 500);
      const files = Array.isArray(args.files) ? args.files : [];
      if(!files.length) throw new Error('no_files');
      /* Bounded before anything leaves. Each file is a separate outbound call
         to somebody else's API, and the body of one is unbounded unless it is
         bounded here. */
      if(files.length > GH_MAX_FILES) throw new Error('too_many_files');
      let total = 0;
      for(const f of files){
        const path = _ghPath(f && f.path);
        const content = String((f && f.content) || '');
        total += content.length;
        if(total > GH_MAX_BYTES) throw new Error('too_large');
        f._path = path; f._content = content;
      }
      const H = _ghHeaders(token);
      const api = 'https://api.github.com/repos/' + repo;

      /* The commit is built through the Git Data API rather than by writing
         files one at a time. The contents endpoint would be fewer lines and
         would produce one commit PER FILE, which turns a single change into a
         wall of noise in somebody's history. */
      const rBase = await fetchDeadline(api + '/git/ref/heads/' + encodeURIComponent(base), { headers: H }, 15000);
      if(!rBase.ok) throw new Error('github_base_' + rBase.status);
      const baseSha = ((await rBase.json().catch(()=>({}))).object || {}).sha;
      if(!baseSha) throw new Error('github_base_missing');

      const tree = [];
      for(const f of files){
        const rb = await fetchDeadline(api + '/git/blobs', { method:'POST', headers: H,
          body: JSON.stringify({ content: f._content, encoding: 'utf-8' }) }, 20000);
        if(!rb.ok) throw new Error('github_blob_' + rb.status);
        const sha = (await rb.json().catch(()=>({}))).sha;
        if(!sha) throw new Error('github_blob_missing');
        tree.push({ path: f._path, mode: '100644', type: 'blob', sha });
      }
      const rt = await fetchDeadline(api + '/git/trees', { method:'POST', headers: H,
        body: JSON.stringify({ base_tree: baseSha, tree }) }, 20000);
      if(!rt.ok) throw new Error('github_tree_' + rt.status);
      const treeSha = (await rt.json().catch(()=>({}))).sha;
      if(!treeSha) throw new Error('github_tree_missing');

      const rc = await fetchDeadline(api + '/git/commits', { method:'POST', headers: H,
        body: JSON.stringify({ message, tree: treeSha, parents: [baseSha] }) }, 20000);
      if(!rc.ok) throw new Error('github_commit_' + rc.status);
      const commit = await rc.json().catch(()=>({}));
      if(!commit.sha) throw new Error('github_commit_missing');

      /* CREATE, never update. There is deliberately no branch-move here: this
         call fails if the branch already exists, and a caller that wants a
         second push picks a new name. Nothing AMV does can rewrite a ref that
         somebody else's work is sitting on. */
      const rr = await fetchDeadline(api + '/git/refs', { method:'POST', headers: H,
        body: JSON.stringify({ ref: 'refs/heads/' + branch, sha: commit.sha }) }, 20000);
      if(rr.status === 422) throw new Error('branch_exists');
      if(!rr.ok) throw new Error('github_ref_' + rr.status);

      /* The branch as GitHub now has it, pointing at this commit. */
      let verified = null;
      try{
        const g = await fetchDeadline(api + '/git/ref/heads/' + encodeURIComponent(branch), { headers: H }, 15000);
        if(g.status === 404) verified = false;
        else if(g.ok) verified = ((await g.json().catch(()=>({}))).object || {}).sha === commit.sha;
      }catch(e){}
      return { repo, branch, base, files: files.length, commit: commit.sha.slice(0, 7),
               url: 'https://github.com/' + repo + '/tree/' + branch, verified };
    },
  },
  /* The two the client already had tools for, and could never reach: both
     read a token out of localStorage under a key no flow has ever written, so
     every call threw "GitHub not connected" against an account that was.
     Rewired here, where the token actually lives. */
  'github.issues': {
    need: 'repo.read', writes: false,
    async run(token, args){
      const repo = _ghRepo(args.repo);
      const r = await fetchDeadline('https://api.github.com/repos/' + repo + '/issues?state=open&per_page=20',
        { headers: _ghHeaders(token) }, 15000);
      if(!r.ok) throw new Error('github_' + r.status);
      const d = await r.json().catch(()=>[]);
      return (Array.isArray(d) ? d : []).map(i => ({ number:i.number, title:i.title, url:i.html_url }));
    },
  },
  'github.issue.create': {
    need: 'issues.write', writes: true,
    async run(token, args){
      const repo = _ghRepo(args.repo);
      const title = String(args.title || '').trim().slice(0, 250);
      if(!title) throw new Error('bad_title');
      const r = await fetchDeadline('https://api.github.com/repos/' + repo + '/issues',
        { method:'POST', headers: _ghHeaders(token),
          body: JSON.stringify({ title, body: String(args.body || '').slice(0, 8000) }) }, 20000);
      if(!r.ok) throw new Error('github_' + r.status);
      const d = await r.json().catch(()=>({}));
      let verified = false;
      if(d.number){
        try{
          const g = await fetchDeadline('https://api.github.com/repos/' + repo + '/issues/' + d.number, { headers: _ghHeaders(token) }, 15000);
          if(g.status === 404) verified = false; else if(!g.ok) verified = null;
          else { const i = await g.json().catch(()=>({})); verified = i.number === d.number && i.title === title; }
        }catch(e){ verified = null; }
      }
      return { created: verified !== false, number: d.number || 0, url: d.html_url || '', verified };
    },
  },
  'github.pr': {
    need: 'code.write', writes: true,
    async run(token, args){
      const repo = _ghRepo(args.repo);
      const head = _ghBranch(args.head);
      const base = _ghBranch(args.base || 'main');
      const title = String(args.title || 'Changes from AMV').slice(0, 250);
      const body = String(args.body || '').slice(0, 8000);
      const r = await fetchDeadline('https://api.github.com/repos/' + repo + '/pulls',
        { method:'POST', headers: _ghHeaders(token),
          body: JSON.stringify({ title, head, base, body }) }, 20000);
      if(!r.ok) throw new Error('github_pr_' + r.status);
      const d = await r.json().catch(()=>({}));
      let verified = false;
      if(d.number){
        try{
          const g = await fetchDeadline('https://api.github.com/repos/' + repo + '/pulls/' + d.number, { headers: _ghHeaders(token) }, 15000);
          if(g.status === 404) verified = false; else if(!g.ok) verified = null;
          else { const q = await g.json().catch(()=>({}));
                 verified = q.number === d.number && q.state === 'open' && ((q.head || {}).ref === head); }
        }catch(e){ verified = null; }
      }
      return { number: d.number || 0, url: d.html_url || '', verified };
    },
  },
};

/* POST /v1/connect/act  { action, args } -> { ok, result } */
async function connAct(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  /* The same rule as the app-connector routes: this reads and sends somebody's
     mail and changes their calendar, and a key has nobody at a screen to ask. */
  { const k = _refuseApiKey(user, 'act on a connected account'); if (k) return k; }
  if(!connConfigured(env)) return json({ error:'not_configured' }, 503);

  const body = await request.json().catch(()=>({}));
  const name = String(body.action || '');
  const spec = CONN_ACTIONS[name];
  /* An unknown name is not a 500 and not a silent empty answer. Both of those
     read to a caller as "there was nothing there". */
  if(!spec) return json({ error:'unknown_action', message:'AMV does not know that action.' }, 400);

  /* Bounded, because every one of these is an outbound call to somebody else's
     API on somebody else's quota. Writes are bounded harder: reading your
     inbox forty times is a busy morning, sending forty mails is not. */
  const blocked = spec.writes
    ? await guardAction(env, 'connact:w:' + user.email, 10, 100, 'actions on your connected accounts')
    : await guardAction(env, 'connact:r:' + user.email, 60, 1000, 'actions on your connected accounts');
  if(blocked) return blocked;

  const got = await connUse(env, user.email, spec.need, 'action:' + name, { attended: true });
  if(!got.ok){
    /* The capability is the refusal, and it names itself. "Not connected" and
       "connected, but you did not grant that" are different problems with
       different fixes, and telling somebody the first when it is the second
       sends them to reconnect an account that is already fine. */
    const msg = got.code === 'not_connected'
        ? 'No connected account can do that yet. Connect one under Settings, Integrations, and tick the permission this needs.'
      : got.code === 'refresh_failed' || got.code === 'expired_no_refresh'
        ? 'That connection stopped working and needs reconnecting.'
      : got.code === 'unreadable'
        ? 'That connection could not be read on this deployment. Nothing has been disconnected.'
        : 'That could not be done (' + got.code + ').';
    return json({ error: got.code, need: spec.need, message: msg }, 409);
  }

  try{
    const result = await spec.run(got.token, body.args || {});
    /* VERIFY, THEN SAY IT HAPPENED.

       Every write reads its own result back from the provider and reports
       `verified`: true when the change is there, null when it could not be
       checked, false when the provider said yes and the change is not there.
       False is a failure, whatever the status code said - a provider that
       answers 200 and does nothing must not come back to the person as done.
       It is not "nothing was changed" either: AMV cannot know that, and saying
       so would invite a second send. */
    if(spec.writes){
      const v = result && typeof result === 'object' ? result.verified : undefined;
      if(v === undefined){
        audit(env, 'conn_action_unverifiable', { by: user.email, action: name });
        return json({ error:'not_verifiable', action: name,
          message:'AMV has no way to check that, so it is not reporting it as done. Look in the account itself.' }, 500);
      }
      if(v === false){
        audit(env, 'conn_action_not_confirmed', { by: user.email, action: name });
        return json({ error:'not_confirmed', action: name, result,
          message:'The account said yes, but when AMV checked, the change was not there. Look in the account before trying again, so it does not happen twice.' }, 502);
      }
    }
    return json({ ok: true, action: name, result });
  }catch(e){
    /* The provider's own message is logged and NOT returned. It can carry a
       quota name, an internal id, or a hint about the account, and none of that
       belongs in an answer to a browser. */
    audit(env, 'conn_action_failed', { by: user.email, action: name,
      error: String((e && e.message) || e).slice(0, 120) });
    /* AMV's OWN refusals - raised before any request, or naming a file that
       was never handed over - are said as what they are. */
    const why = String((e && e.message) || '');
    const own = {
      docs_not_chosen: 'AMV can only open Google files you chose for it, or ones it made. Choose the file first.',
      sheets_not_chosen: 'AMV can only open Google files you chose for it, or ones it made. Choose the file first.',
      bad_file: 'That is not a Google file AMV can open.',
      bad_range: 'That is not a range in a sheet, like Sheet1!A1:C10.',
      bad_values: 'The values to write must be rows of cells.',
      too_many_cells: 'That is more than 10,000 cells at once. Write it in parts.',
      bad_edit: 'Say what to find and what to replace it with, or what to add at the end.',
    }[why];
    if (own) return json({ error: why, action: name, message: own + ' Nothing was changed.' }, 400);
    return json({ error:'action_failed', action: name,
      message:'That did not work. Nothing was changed.' }, 502);
  }
}

/* WHAT GOOGLE'S FILE PICKER NEEDS IN THE BROWSER (picker.html). All three
   are public by design - a client id, a browser key limited by the site it is
   used from, and a project number - which is why they are handed to the page
   at all. Signed in only, so this is not a directory of the deployment's
   settings for anyone who asks. */
