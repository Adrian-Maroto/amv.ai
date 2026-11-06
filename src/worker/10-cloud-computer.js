/* ══ AMV'S CLOUD COMPUTER ════════════════════════════════════════════════════

   A machine of the person's own, in AMV's cloud: one container each, running
   the same bridge people run on their own computers (cloud/, --cloud mode).
   The app drives it with the same calls it already makes to a bridge - run a
   command, read and write a file - and they arrive here first, so:

     it exists only where the deployment has it (the AMV_COMPUTER binding and
     a key of real length), and says so plainly where it does not;
     it is a plan's to use (Pro and above), checked here, not in the page;
     the time it is AWAKE is counted against the plan's monthly minutes -
     that is what the cloud provider bills, so it is what is metered: a file
     read every few minutes keeps a machine up as surely as a build does -
     and once they are spent nothing more is sent to it;
     each person reaches only their own container - its name is derived here
     from the signed-in account, never taken from the request. */
const COMPUTER_MIN_PLAN = 'pro';
const COMPUTER_MINUTES = { pro: 600, elite: 3000, ultra: 6000 };
/* How long a machine stays up after its last request (sleepAfter in
   cloud/computer.mjs). Billed when the request is made, so the meter is never
   behind what the provider charges. */
const COMPUTER_AWAKE_S = 300;
function _computerOn(env){ return !!(env && env.AMV_COMPUTER && String(env.AMV_COMPUTER_KEY || '').length >= 32); }
function _computerCap(user){
  const rank = _planRankOf(user.plan, user.customCfg);
  return rank >= PLAN_RANK.ultra ? COMPUTER_MINUTES.ultra : rank >= PLAN_RANK.elite ? COMPUTER_MINUTES.elite
       : rank >= PLAN_RANK.pro ? COMPUTER_MINUTES.pro : 0;
}
async function _computerName(email){
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('amv-computer:' + String(email).toLowerCase()));
  return 'u:' + [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}
/* A CALL SIGNED FOR ONE MACHINE (Nov 1 audit COMP-006). The computer Worker
   accepts a call only with a token signed with AMV_COMPUTER_KEY for that
   machine's id and that path, good for a minute and once (cloud/computer.mjs,
   _callOk) - so nothing that reaches one machine can be replayed at another.
   The plain key is still sent beside it, which only a computer Worker from
   before this change reads; the current one ignores it and never passes it
   on. It goes when every deployment has redeployed cloud/. */
async function _computerStub(env, email){
  const id = env.AMV_COMPUTER.idFromName(await _computerName(email));
  const stub = env.AMV_COMPUTER.get(id);
  return Object.assign(Object.create(stub), { _amvId: String(id), fetch: (req) => stub.fetch(req) });
}
async function _computerCall(env, stub, path, init){
  /* The id the stub was made from (_computerStub): what the machine reads as its own. */
  const id = String(stub._amvId || stub.id || '');
  const exp = String(Date.now() + 60000);
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(env.AMV_COMPUTER_KEY)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(['amv-computer-call', 'v1', id, path, exp, nonce].join('\n'))))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const headers = Object.assign({}, (init && init.headers) || {}, { 'X-AMV-Bridge-Token': String(env.AMV_COMPUTER_KEY), 'X-AMV-Computer-Call': ['v1', exp, nonce, sig].join('.') });
  return stub.fetch(new Request('http://amv-computer' + path, Object.assign({ method: 'POST' }, init || {}, { headers })));
}
/* Erasing an account: the computer Worker deletes the saved workspace and
   stops the machine (cloud/computer.mjs, /amv-workspace/forget). True when
   it said so. */
async function _computerForget(env, email){
  const stub = await _computerStub(env, email);
  const r = await _computerCall(env, stub, '/amv-workspace/forget', {});
  if (!r.ok) return false;
  const d = await r.json().catch(() => null);
  return !!(d && d.forgotten);
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
/* Everything a request must pass before it reaches somebody's machine: signed
   in, switched on, a plan that has it, not hammering it, minutes left. Shared
   by every route that reaches the container, so none of them can skip one.
   Returns { user, stub } or { res } - the refusal to send back. */
async function _computerOpen(request, env, route){
  const user = await requireUser(request, env);
  if(!user) return { res: json({ error:'unauthorized' }, 401) };
  if(!_computerOn(env)) return { res: json({ error: 'AMV’s cloud workspace is not switched on for this deployment yet. You can still connect your own computer.', code: 'needs_service' }, 503) };
  const cap = _computerCap(user);
  if(!cap) return { res: json({ error: 'The cloud workspace comes with Pro and above.', code: 'plan_required', minPlan: COMPUTER_MIN_PLAN }, 402) };
  const limited = await guardAction(env, 'computer:' + user.email, 120, 2000, 'requests to your cloud workspace');
  if(limited) return { res: limited };
  /* Spent: nothing more reaches the machine, because anything that reaches it
     keeps it awake. Disconnecting still goes through - it stops what runs. */
  /* Discarding unsaved work is also how a held machine is stopped, so it is
     never refused for minutes spent (Nov 3 audit COMP-016). */
  if(route !== 'revoke' && route !== 'discard'){
    const used = await _computerUsedSeconds(env, user.email);
    if(used >= cap * 60)
      return { res: json({ error: `You have used this month’s ${cap} minutes of cloud workspace time. It starts again next month, or upgrade for more.`,
                    code: 'computer_minutes', minutes: { used: Math.ceil(used / 60), cap } }, 429) };
  }
  let stub;
  try{ stub = await _computerStub(env, user.email); }
  catch(e){ return { res: json({ error: 'The cloud workspace could not be reached. Try again in a minute.', code: 'computer_unavailable' }, 503) }; }
  return { user, stub };
}
/* EARLIER COPIES OF THE WORKSPACE (Oct 31 audit, item 33). The list, and
   putting one back, go to the computer Worker with AMV's key after the same
   checks as every other request - the person's sign-in names the machine.
   Neither wakes the container, so neither is billed as awake time. */
async function computerVersions(request, env, which){
  const open = await _computerOpen(request, env, which);
  if(open.res) return open.res;
  const { user, stub } = open;
  const body = which === 'rollback' ? await request.json().catch(() => ({})) : {};
  const path = which === 'rollback' ? 'rollback' : which === 'fresh' ? 'fresh' : which === 'discard' ? 'discard' : which === 'trust' ? 'trust' : 'versions';
  let r, d;
  try{
    r = await _computerCall(env, stub, '/amv-workspace/' + path, {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: String(body.id || '') }) });
    d = await r.json().catch(() => null);
  }catch(e){ d = null; }
  if(!d) return json({ error: 'The saved copies could not be reached. Try again in a minute.', code: 'computer_unavailable' }, 503);
  if(which === 'rollback' && d.restored) audit(env, 'computer_rolled_back', { by: user.email, to: d.id });
  if(which === 'fresh' && d.fresh) audit(env, 'computer_started_fresh', { by: user.email });
  if(which === 'discard' && d.discarded) audit(env, 'computer_discarded_unsaved', { by: user.email });
  if(which === 'trust' && d.trusted) audit(env, 'computer_trusted_unverified', { by: user.email });
  return json(Object.assign({ ok: r.ok }, d), r.status);
}
async function computerRoute(request, env, route){
  const open = await _computerOpen(request, env, route);
  if(open.res) return open.res;
  const { user, stub } = open;
  const raw = await request.text();
  if(raw.length > 8 * 1024 * 1024) return json({ error: 'That is too large to send to the cloud workspace.', code: 'too_large' }, 413);
  await _computerBillAwake(env, user.email, Date.now());
  let r, text;
  try{
    r = await _computerCall(env, stub, '/amv-bridge/' + route, {
      headers: { 'Content-Type': 'application/json' }, body: raw || '{}' });
    text = await r.text();
  }catch(e){
    audit(env, 'computer_unavailable', { by: user.email, route });
    return json({ error: 'The cloud workspace did not start. Try again in a minute.', code: 'computer_unavailable' }, 503);
  }
  let d; try{ d = JSON.parse(text); }catch(e){ d = null; }
  /* EVERY MACHINE IS IN USE. The container library answers 503 with its own
     sentence when the account has reached max_instances (cloud/wrangler.toml).
     That is a capacity ceiling, not a fault: the person is told plainly and
     asked to try in a few minutes, and the operator is told once an hour,
     because the fix is theirs - raise the ceiling - and nobody else will
     notice a queue of people being turned away. */
  if(!d && r.status === 503 && /no Container instance available/i.test(text || '')){
    audit(env, 'computer_capacity', { by: user.email, route });
    try{ await alertOnce(env, 'computer_capacity',
      'Every cloud computer is in use: people are being asked to try again in a few minutes. '
      + 'Raise max_instances in cloud/wrangler.toml and deploy cloud/ again if this keeps happening.', 60); }catch(e){}
    return json({ error: 'Every cloud workspace is busy right now. Try again in a few minutes - nothing ran.', code: 'computer_busy' }, 503, { 'Retry-After': '120' });
  }
  if(!d || typeof d !== 'object') return json({ error: 'The cloud workspace answered with something AMV could not read.', code: 'computer_unavailable' }, 502);
  /* The container refusing AMV's key means the two Workers hold different
     keys - a deployment fault, not the person's session. Passed through as a
     401 it would read as "signed out" and send them to sign in again. */
  if(r.status === 401){
    audit(env, 'computer_key_mismatch', { by: user.email, route });
    return json({ error: 'The cloud workspace is not set up correctly on this deployment. Nothing ran.', code: 'computer_unavailable' }, 503);
  }
  /* A long command kept it awake past the window billed when it started, so
     the window is extended from when it finished. */
  if(route === 'exec'){
    await _computerBillAwake(env, user.email, Date.now());
    if(r.ok) audit(env, 'computer_exec', { by: user.email, ms: +d.ms || 0, exit: d.exitCode });
  }
  return json(d, r.status);
}

