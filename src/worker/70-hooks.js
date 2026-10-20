/* ── A JOB ANOTHER SERVICE CAN START ───────────────────────────────────────

   "When a payment comes in, when a form is filled in, when the shop gets an
   order - do this." Mail, calendar and page triggers each need AMV to go and
   look; most services can instead SAY that something happened, by sending a
   request to an address. A trigger with source `hook` is a Crew job with an
   address of its own, and a request to that address starts it.

   THE ADDRESS IS THE KEY. It carries the account, the job and a nonce, sealed
   with AES-GCM under CONNECT_KEY (connSeal), so it names nobody in a log and
   cannot be made up or altered - and it needs no index to look up, because
   everything required to find the job is inside it. The nonce lives on the
   job; "new address" replaces it, and the old address then opens to a job that
   no longer matches, which is a 404 like any address that never existed.

   WHAT A REQUEST CAN DO, and every bound is enforced here rather than hoped:
     - start ONE unattended run of the job's own instruction. Unattended runs
       read and write text; they cannot send, buy, book or touch an account
       (AUTO_USES_ALLOWED), so a stranger holding the address can cost money
       and nothing else - and the money goes through the same spend gate,
       plan, daily ceiling and kill switch as every other run;
     - and no more often than one run every HOOK_GAP_MS. Requests that arrive
       in between wait together and are read in the same run;
     - at most HOOK_PENDING_MAX waiting at once, HOOK_BODY_MAX bytes each, and
       a per-address rate limit;
     - a request whose words do not match the job's filter costs nothing and
       is not kept;
     - the same request sent twice (a retry) is one request;
     - nothing credential-shaped is kept, ever: such a request is refused
       whole, as a job detail would be;
     - what was sent is read by the model fenced, as material and never as
       instructions, and deleted from the job as soon as the run that read it
       is written back. */
const HOOK_BODY_MAX = 32 * 1024;
const HOOK_KEEP_CHARS = 8000;
const HOOK_PENDING_MAX = 10;
const HOOK_GAP_MS = 5 * 60e3;
const HOOK_IDLE_MS = 30 * 86400e3;
const HOOK_SEEN_MAX = 30;
const HOOK_PER_MIN = 20;
const HOOK_PER_DAY = 500;

function _hookIsOn(item){ return !!(item && item.when && item.when.source === 'hook'); }
function _hookNonce(){
  return [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
}
/* base64url, because connSeal's own alphabet has '+', '/' and '=' in it. */
function _hookB64u(s){ return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function _hookUnB64u(s){
  const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  return atob(t + '==='.slice((t.length + 3) % 4));
}
async function _hookAddress(env, request, email, item){
  const sealed = await connSeal(env, { e: String(email).toLowerCase(), j: item.id, n: item.hook.n });
  return new URL(request.url).origin + '/v1/hook/' + _hookB64u(sealed);
}
async function _hookOpen(env, token){
  if(!/^[A-Za-z0-9_-]{40,600}$/.test(String(token || ''))) return null;
  try{
    const o = await connOpen(env, _hookUnB64u(token));
    return o && typeof o.e === 'string' && typeof o.j === 'string' && typeof o.n === 'string' ? o : null;
  }catch(e){ return null; }
}
/* What has arrived since the last run read anything, oldest first. */
function _hookPending(item){
  const upto = Number(item && item.watch && item.watch.upto) || 0;
  return ((item && item.hookIn) || []).filter(d => d && d.at > upto);
}
function _hookNextAt(item, now){
  return Math.max(now, (Number(item && item.watch && item.watch.at) || 0) + HOOK_GAP_MS);
}

/* Applied to the job as it is inside the tick's write-back lock, after the
   run's own fields are carried across. The waiting list is NOT one of those
   fields and must never be: it belongs to the delivery route, and the run's
   copy of it is stale by definition - carrying it back would erase every
   request that arrived while the run was reading. So what the run read
   (everything up to `watch.upto`) is deleted here, what arrived since is
   kept, and that books the next run. */
function _hookAfterRun(item, now){
  item.hookIn = _hookPending(item);
  if(item.hookIn.length && item.active !== false) item.next = _hookNextAt(item, now);
}

/* ── A SIGNED REQUEST: THE ADDRESS IS NOT THE ONLY KEY ─────────────────────

   An address can leak - into a proxy's log, a screenshot, a ticket, an
   observability tool - and whoever reads it can start the job. That is
   bounded above (one unattended text run, rate-limited, nothing sent or
   bought), and it is still the wrong strength for a job fed by billing, a
   CRM or a deploy. So a job can also require that every request be SIGNED by
   the service that sends it, with a secret that never appears in a URL:

     - amv     the Standard Webhooks scheme (webhook-id, webhook-timestamp,
               webhook-signature "v1,<base64>"), with a secret AMV makes;
     - github  X-Hub-Signature-256, with a secret AMV makes or one pasted;
     - stripe  Stripe-Signature (t=..., v1=...), the secret Stripe shows;
     - slack   X-Slack-Signature (v0=...), the app's signing secret.

   Once a job is signed an unsigned request is refused, whoever holds the
   address. Three things make a signature worth having, and each is here:
     - a TIME WINDOW where the scheme carries a time (all but GitHub's):
       older or newer than HOOK_SIG_WINDOW_S is refused, so a captured request
       is good for minutes, not for ever;
     - NO REPLAY: the request's identity comes only from what was signed (the
       signed id, or the body itself - never an unsigned header a replayer
       could change), and an identity already queued is a duplicate, for
       HOOK_SIG_MEMORY_S, which is what covers GitHub's scheme with no time;
     - ROTATION: a new secret leaves the old one valid for HOOK_SIG_OVERLAP_MS,
       so the sending service can be updated without dropping a request.
   The secret is sealed under CONNECT_KEY like a connected account's grant, is
   shown once when AMV makes it, and never leaves the server again: the job
   list says only which scheme is on (_hookShown). */
const HOOK_SIG_KINDS = ['amv', 'github', 'stripe', 'slack'];
const HOOK_SIG_WINDOW_S = 300;
const HOOK_SIG_OVERLAP_MS = 24 * 3600e3;
const HOOK_SIG_MEMORY_S = 30 * 86400;
const _hookEnc = new TextEncoder();
function _hookHex(u8){ return [...u8].map(b => b.toString(16).padStart(2, '0')).join(''); }
function _hookB64(u8){ let s = ''; for(const b of u8) s += String.fromCharCode(b); return btoa(s); }
function _hookUnB64(s){ try{ const t = atob(String(s)); return Uint8Array.from(t, c => c.charCodeAt(0)); }catch(e){ return null; } }
async function _hookMac(keyBytes, text){
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, _hookEnc.encode(text)));
}
/* Equal bytes, compared in a time that does not depend on where they differ. */
function _hookSame(a, b){ return !!(a && b) && timingSafeEqual(a, b); }
function _hookFromHex(h){ return /^[0-9a-f]+$/i.test(h) && h.length % 2 === 0 ? Uint8Array.from(h.match(/../g), x => parseInt(x, 16)) : null; }
function _hookNewSecret(kind){
  const r = crypto.getRandomValues(new Uint8Array(32));
  return kind === 'amv' ? 'whsec_' + _hookB64(r) : _hookHex(r);
}
/* What a pasted secret must look like, so a typo is caught when it is saved
   rather than as every delivery failing afterwards. */
function _hookSecretShape(kind, secret){
  if(kind === 'stripe') return /^whsec_[A-Za-z0-9+/=_-]{16,200}$/.test(secret);
  if(kind === 'slack') return /^[0-9a-f]{32}$/i.test(secret);
  if(kind === 'github') return secret.length >= 16 && secret.length <= 200 && !/\s/.test(secret);
  return false;
}
/* Checks one request against the secrets in force. Answers { ok, id } with
   the request's identity taken only from signed material, or { ok:false,
   why, code }. `body` is the raw text exactly as it arrived. */
async function _hookVerify(kind, secrets, headers, body, nowS){
  const h = (n) => String(headers.get(n) || '');
  const fresh = (t) => /^\d{1,12}$/.test(t) && Math.abs(nowS - Number(t)) <= HOOK_SIG_WINDOW_S;
  const bodyId = async () => 'b' + _hookHex(new Uint8Array(await crypto.subtle.digest('SHA-256', _hookEnc.encode(body)))).slice(0, 32);
  const none = (header) => ({ ok:false, code:'signature_required', why:'This job accepts only signed requests. The ' + header + ' header is missing.' });
  const bad = { ok:false, code:'bad_signature', why:'The signature does not match this job’s secret.' };
  const stale = { ok:false, code:'stale_signature', why:'The request’s time is more than ' + (HOOK_SIG_WINDOW_S / 60) + ' minutes from now. Check the sending server’s clock.' };
  if(kind === 'github'){
    const got = h('X-Hub-Signature-256');
    if(!got) return none('X-Hub-Signature-256');
    const want = _hookFromHex(got.replace(/^sha256=/, ''));
    for(const s of secrets) if(_hookSame(await _hookMac(_hookEnc.encode(s), body), want)) return { ok:true, id: await bodyId() };
    return bad;
  }
  if(kind === 'stripe'){
    const got = h('Stripe-Signature');
    if(!got) return none('Stripe-Signature');
    const parts = got.split(',').map(x => x.trim().split('='));
    const t = (parts.find(p => p[0] === 't') || [])[1] || '';
    const v1 = parts.filter(p => p[0] === 'v1').map(p => _hookFromHex(p[1] || '')).filter(Boolean);
    if(!fresh(t)) return stale;
    for(const s of secrets){ const mac = await _hookMac(_hookEnc.encode(s), t + '.' + body); if(v1.some(v => _hookSame(mac, v))) return { ok:true, id: await bodyId() }; }
    return bad;
  }
  if(kind === 'slack'){
    const got = h('X-Slack-Signature'), t = h('X-Slack-Request-Timestamp');
    if(!got || !t) return none(got ? 'X-Slack-Request-Timestamp' : 'X-Slack-Signature');
    if(!fresh(t)) return stale;
    const want = _hookFromHex(got.replace(/^v0=/, ''));
    for(const s of secrets) if(_hookSame(await _hookMac(_hookEnc.encode(s), 'v0:' + t + ':' + body), want)) return { ok:true, id: await bodyId() };
    return bad;
  }
  if(kind === 'amv'){
    const id = h('webhook-id'), t = h('webhook-timestamp'), got = h('webhook-signature');
    if(!id || !t || !got) return none(!id ? 'webhook-id' : !t ? 'webhook-timestamp' : 'webhook-signature');
    if(id.length > 120) return bad;
    if(!fresh(t)) return stale;
    const sigs = got.split(' ').filter(x => x.startsWith('v1,')).map(x => _hookUnB64(x.slice(3))).filter(Boolean);
    for(const s of secrets){
      const key = _hookUnB64(s.replace(/^whsec_/, ''));
      if(!key) continue;
      const mac = await _hookMac(key, id + '.' + t + '.' + body);
      if(sigs.some(v => _hookSame(mac, v))) return { ok:true, id: 'i' + id };
    }
    return bad;
  }
  return bad;
}
/* The secrets a request may be signed with right now: the current one, and
   the one it replaced until the overlap ends. */
async function _hookSecrets(env, sig, now){
  const out = [];
  try{ const o = await connOpen(env, sig.s); if(o && typeof o.k === 'string') out.push(o.k); }catch(e){}
  if(sig.p && Number(sig.pUntil) > now){ try{ const o = await connOpen(env, sig.p); if(o && typeof o.k === 'string') out.push(o.k); }catch(e){} }
  return out;
}
/* A job as the page may see it: which scheme is on, never the secret, the
   address's nonce or what has been delivered. */
function _hookShown(item){
  if(!item || !item.hook) return item;
  const sig = item.hook.sig;
  const { hook, hookIn, ...rest } = item;
  return Object.assign(rest, { hook: { signed: sig ? sig.kind : null,
    ...(sig && Number(sig.pUntil) > Date.now() ? { oldSecretUntil: Number(sig.pUntil) } : {}) },
    ...(Array.isArray(hookIn) ? { hookWaiting: _hookPending(item).length } : {}) });
}

async function hookDeliver(request, env, token){
  if(request.method !== 'POST')
    return json({ error:'Send a POST to this address.', code:'method_not_allowed', allow:'POST' }, 405, { Allow: 'POST' });
  if(!connConfigured(env)) return json({ error:'This deployment does not run jobs from other services.', code:'hook_unavailable' }, 503);
  const at = await _hookOpen(env, token);
  /* One answer for an address that never existed, one that was tampered with
     and one that was replaced: none of them tells a stranger which it was. */
  if(!at) return json({ error:'not found' }, 404);
  const lim = await limitAction(env, 'hook:' + at.j, HOOK_PER_MIN, HOOK_PER_DAY);
  /* Closed when the counter cannot be read: every request here can start a
     paid run, and a limit that cannot be checked is not one. */
  if(!lim.ok) return json({ error: lim.unavailable ? 'Try again in a moment.' : 'Too many requests to this address. Try again later.',
                            code: lim.unavailable ? 'limit_unavailable' : lim.code }, lim.unavailable ? 503 : 429);
  const declared = Number(request.headers.get('Content-Length') || 0);
  if(declared > HOOK_BODY_MAX) return json({ error:'That request is larger than ' + (HOOK_BODY_MAX / 1024) + 'KB.', code:'too_large' }, 413);
  const buf = new Uint8Array(await request.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if(buf.length > HOOK_BODY_MAX) return json({ error:'That request is larger than ' + (HOOK_BODY_MAX / 1024) + 'KB.', code:'too_large' }, 413);
  const raw = new TextDecoder().decode(buf);
  let text = raw;
  try{ text = JSON.stringify(JSON.parse(raw), null, 1); }catch(e){}
  const now = Date.now();
  /* A signed job is checked before anything is kept. Read outside the lock
     (verifying is several HMACs and must not hold it); the lock below
     refuses the request if signing changed in between. */
  const rec0 = await DB.get(env, 'auto', _autoKey(at.e));
  const it0 = rec0 && (rec0.items || []).find(x => x && x.id === at.j);
  if(!it0 || !_hookIsOn(it0) || !it0.hook || it0.hook.n !== at.n) return json({ error:'not found' }, 404);
  const sig0 = it0.hook.sig || null;
  let signedId = '';
  if(sig0){
    const secrets = await _hookSecrets(env, sig0, now);
    if(!secrets.length) return json({ error:'This job’s signing secret could not be read. Set it again in AMV.', code:'signing_unavailable' }, 503);
    const v = await _hookVerify(sig0.kind, secrets, request.headers, raw, Math.floor(now / 1000));
    if(!v.ok){ audit(env, 'hook_refused', { job: at.j, code: v.code }); return json({ error: v.why, code: v.code }, 401); }
    signedId = v.id;
    /* Slack proves the address once, when the app is set up, by asking for
       a word back. It is signed like everything else, so it is answered only
       for a job that holds the app's secret. */
    if(sig0.kind === 'slack'){
      let o = null; try{ o = JSON.parse(raw); }catch(e){}
      if(o && o.type === 'url_verification' && typeof o.challenge === 'string') return json({ challenge: o.challenge.slice(0, 200) }, 200);
    }
    if(await env.AMV_KV.get('hookdel:' + at.j + ':' + signedId)) return json({ ok:true, duplicate:true }, 200);
  }
  const kinds = _detailSecrets(text);
  if(kinds.length) return json({ error:'AMV does not keep passwords, card numbers or security codes. Nothing was kept.', code:'credentials_in_body', kinds }, 422);
  /* A sender's own delivery id when it gives one, else the request itself:
     either way a retry of the same request is the same request. On a signed
     job only what was signed counts - an unsigned header is the one thing a
     replayer can change. */
  const given = signedId || String(request.headers.get('Idempotency-Key') || request.headers.get('X-GitHub-Delivery')
                       || request.headers.get('X-Request-Id') || '').slice(0, 120);
  const id = given || [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
  const low = text.toLowerCase();
  let outcome = 'gone', queued = 0;
  await _withAuto(env, _autoKey(at.e), (fresh) => {
    if(!fresh) return;
    const it = (fresh.items || []).find(x => x && x.id === at.j);
    if(!it || !_hookIsOn(it) || !it.hook || it.hook.n !== at.n){ outcome = 'gone'; return; }
    if(((it.hook.sig && it.hook.sig.at) || 0) !== ((sig0 && sig0.at) || 0)){ outcome = 'changed'; return; }
    if(it.done || it.active === false){ outcome = 'off'; return; }
    const words = it.when.words || [];
    if(words.length && !words.some(w => low.indexOf(w) >= 0)){ outcome = 'skipped'; return; }
    const seen = Array.isArray(it.hook.seen) ? it.hook.seen : [];
    if(seen.includes(id)){ outcome = 'duplicate'; return; }
    const pend = _hookPending(it);
    if(pend.length >= HOOK_PENDING_MAX){ outcome = 'backlog'; return; }
    /* Strictly increasing, so "everything after what the last run read" can
       never skip a request that landed in the same millisecond. */
    const stamp = Math.max(now, (Number(it.watch && it.watch.upto) || 0) + 1, ...pend.map(d => d.at + 1));
    it.hookIn = pend.concat({ id, at: stamp, body: text.slice(0, HOOK_KEEP_CHARS), cut: text.length > HOOK_KEEP_CHARS });
    it.hook = Object.assign({}, it.hook, { seen: seen.concat(id).slice(-HOOK_SEEN_MAX), last: now });
    it.next = _hookNextAt(it, now);
    outcome = 'queued'; queued = it.hookIn.length;
  }, { items:[], results:[] });
  if(outcome === 'gone') return json({ error:'not found' }, 404);
  if(outcome === 'changed') return json({ error:'This job’s signing changed while the request arrived. Send it again.', code:'signing_changed' }, 409);
  if(outcome === 'off') return json({ error:'The job at this address is paused or finished.', code:'not_listening' }, 410);
  if(outcome === 'skipped') return json({ ok:true, matched:false }, 202);
  if(outcome === 'duplicate') return json({ ok:true, duplicate:true }, 200);
  if(outcome === 'backlog') return json({ error:'Requests are already waiting for this job. Try again in a few minutes.', code:'backlog' }, 429);
  /* Remembered past the window and past the job's short list of recent ids,
     so a signed request captured today is still a duplicate next month. */
  if(signedId){ try{ await env.AMV_KV.put('hookdel:' + at.j + ':' + signedId, '1', { expirationTtl: HOOK_SIG_MEMORY_S }); }catch(e){} }
  audit(env, 'hook_received', { job: at.j, queued, signed: sig0 ? sig0.kind : null });
  return json({ ok:true, queued, runsWithinMin: Math.ceil(HOOK_GAP_MS / 60e3) }, 202);
}

/* The owner's half: the address again, or a new one in its place; and
   whether requests to it must be signed, by whom. A new address keeps the
   signing, and a new secret keeps the old one working for a day. */
async function autoHook(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  if(!connConfigured(env)) return json({ error:'This deployment does not run jobs from other services.', code:'hook_unavailable' }, 503);
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  const renew = body.action === 'renew', sign = body.action === 'sign', unsign = body.action === 'unsign';
  const kind = String(body.kind || '');
  if(sign && !HOOK_SIG_KINDS.includes(kind)) return json({ error:'Choose who signs the requests: AMV’s standard, GitHub, Stripe or Slack.', code:'bad_kind' }, 400);
  let secret = '', made = false;
  if(sign){
    const pasted = String(body.secret || '').trim();
    if(kind === 'stripe' || kind === 'slack' || (kind === 'github' && pasted)){
      if(!_hookSecretShape(kind, pasted)) return json({ error: kind === 'stripe' ? 'Paste the signing secret Stripe shows for this endpoint. It starts with whsec_.'
        : kind === 'slack' ? 'Paste the Signing Secret from your Slack app’s Basic Information page: 32 letters and numbers.'
        : 'A GitHub secret is 16 to 200 characters with no spaces. Leave it empty and AMV makes one.', code:'bad_secret' }, 400);
      secret = pasted;
    } else { secret = _hookNewSecret(kind); made = true; }
  }
  const sealed = sign ? await connSeal(env, { k: secret }) : '';
  let item = null, rotated = false;
  await _withAuto(env, _autoKey(user.email), (fresh) => {
    if(!fresh) return;
    const it = (fresh.items || []).find(x => x && x.id === id);
    if(!it || !_hookIsOn(it)) return;
    if(renew || !it.hook || !it.hook.n) it.hook = Object.assign({}, it.hook, { n: _hookNonce() });
    if(sign){
      const old = it.hook.sig, now = Date.now();
      rotated = !!(old && old.kind === kind);
      it.hook = Object.assign({}, it.hook, { sig: { kind, s: sealed, at: now,
        ...(rotated ? { p: old.s, pUntil: now + HOOK_SIG_OVERLAP_MS } : {}) } });
    }
    if(unsign && it.hook.sig){ const { sig, ...rest } = it.hook; it.hook = rest; }
    item = it;
  }, { items:[], results:[] });
  if(!item) return json({ error:'not found' }, 404);
  if(renew) audit(env, 'hook_address_renewed', { email: user.email, job: id });
  if(sign) audit(env, 'hook_signing_on', { email: user.email, job: id, kind, rotated });
  if(unsign) audit(env, 'hook_signing_off', { email: user.email, job: id });
  const sig = item.hook.sig;
  return json({ ok:true, url: await _hookAddress(env, request, user.email, item), renewed: renew,
    signed: sig ? sig.kind : null,
    /* Shown once, and only when AMV made it: a pasted secret is already in
       the hands of the person who pasted it. */
    ...(made ? { secret } : {}),
    ...(rotated ? { oldSecretUntil: sig.pUntil } : {}) });
}
