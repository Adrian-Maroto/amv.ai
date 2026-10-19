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
  let text = new TextDecoder().decode(buf);
  try{ text = JSON.stringify(JSON.parse(text), null, 1); }catch(e){}
  const kinds = _detailSecrets(text);
  if(kinds.length) return json({ error:'AMV does not keep passwords, card numbers or security codes. Nothing was kept.', code:'credentials_in_body', kinds }, 422);
  /* A sender's own delivery id when it gives one, else the request itself:
     either way a retry of the same request is the same request. */
  const given = String(request.headers.get('Idempotency-Key') || request.headers.get('X-GitHub-Delivery')
                       || request.headers.get('X-Request-Id') || '').slice(0, 120);
  const id = given || [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
  const low = text.toLowerCase();
  const now = Date.now();
  let outcome = 'gone', queued = 0;
  await _withAuto(env, _autoKey(at.e), (fresh) => {
    if(!fresh) return;
    const it = (fresh.items || []).find(x => x && x.id === at.j);
    if(!it || !_hookIsOn(it) || !it.hook || it.hook.n !== at.n){ outcome = 'gone'; return; }
    if(it.done || it.active === false){ outcome = 'off'; return; }
    const words = it.when.words || [];
    if(words.length && !words.some(w => low.indexOf(w) >= 0)){ outcome = 'skipped'; return; }
    const seen = Array.isArray(it.hook.seen) ? it.hook.seen : [];
    if(seen.includes(id)){ outcome = 'duplicate'; return; }
    const pend = _hookPending(it);
    if(pend.length >= HOOK_PENDING_MAX){ outcome = 'backlog'; return; }
    /* Strictly increasing, so "everything after what the last run read" can
       never skip a request that landed in the same millisecond. */
    const stamp = Math.max(now, ...pend.map(d => d.at + 1));
    it.hookIn = pend.concat({ id, at: stamp, body: text.slice(0, HOOK_KEEP_CHARS), cut: text.length > HOOK_KEEP_CHARS });
    it.hook = Object.assign({}, it.hook, { seen: seen.concat(id).slice(-HOOK_SEEN_MAX), last: now });
    it.next = _hookNextAt(it, now);
    outcome = 'queued'; queued = it.hookIn.length;
  }, { items:[], results:[] });
  if(outcome === 'gone') return json({ error:'not found' }, 404);
  if(outcome === 'off') return json({ error:'The job at this address is paused or finished.', code:'not_listening' }, 410);
  if(outcome === 'skipped') return json({ ok:true, matched:false }, 202);
  if(outcome === 'duplicate') return json({ ok:true, duplicate:true }, 200);
  if(outcome === 'backlog') return json({ error:'Requests are already waiting for this job. Try again in a few minutes.', code:'backlog' }, 429);
  audit(env, 'hook_received', { job: at.j, queued });
  return json({ ok:true, queued, runsWithinMin: Math.ceil(HOOK_GAP_MS / 60e3) }, 202);
}

/* The owner's half: the address again, or a new one in its place. */
async function autoHook(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  if(!connConfigured(env)) return json({ error:'This deployment does not run jobs from other services.', code:'hook_unavailable' }, 503);
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  const renew = body.action === 'renew';
  let item = null;
  await _withAuto(env, _autoKey(user.email), (fresh) => {
    if(!fresh) return;
    const it = (fresh.items || []).find(x => x && x.id === id);
    if(!it || !_hookIsOn(it)) return;
    if(renew || !it.hook || !it.hook.n) it.hook = { n: _hookNonce() };
    item = it;
  }, { items:[], results:[] });
  if(!item) return json({ error:'not found' }, 404);
  if(renew) audit(env, 'hook_address_renewed', { email: user.email, job: id });
  return json({ ok:true, url: await _hookAddress(env, request, user.email, item), renewed: renew });
}
