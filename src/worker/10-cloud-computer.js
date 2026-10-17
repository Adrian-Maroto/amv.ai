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
  if(!_computerOn(env)) return json({ error: 'AMV’s cloud workspace is not switched on for this deployment yet. You can still connect your own computer.', code: 'needs_service' }, 503);
  const cap = _computerCap(user);
  if(!cap) return json({ error: 'The cloud workspace comes with Pro and above.', code: 'plan_required', minPlan: COMPUTER_MIN_PLAN }, 402);
  const limited = await guardAction(env, 'computer:' + user.email, 120, 2000, 'requests to your cloud workspace');
  if(limited) return limited;
  /* Spent: nothing more reaches the machine, because anything that reaches it
     keeps it awake. Disconnecting still goes through - it stops what runs. */
  if(route !== 'revoke'){
    const used = await _computerUsedSeconds(env, user.email);
    if(used >= cap * 60)
      return json({ error: `You have used this month’s ${cap} minutes of cloud workspace time. It starts again next month, or upgrade for more.`,
                    code: 'computer_minutes', minutes: { used: Math.ceil(used / 60), cap } }, 429);
  }
  const raw = await request.text();
  if(raw.length > 8 * 1024 * 1024) return json({ error: 'That is too large to send to the cloud workspace.', code: 'too_large' }, 413);
  let stub;
  try{ stub = env.AMV_COMPUTER.get(env.AMV_COMPUTER.idFromName(await _computerName(user.email))); }
  catch(e){ return json({ error: 'The cloud workspace could not be reached. Try again in a minute.', code: 'computer_unavailable' }, 503); }
  await _computerBillAwake(env, user.email, Date.now());
  let r, text;
  try{
    r = await stub.fetch(new Request('http://amv-computer/amv-bridge/' + route, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AMV-Bridge-Token': String(env.AMV_COMPUTER_KEY) }, body: raw || '{}' }));
    text = await r.text();
  }catch(e){
    audit(env, 'computer_unavailable', { by: user.email, route });
    return json({ error: 'The cloud workspace did not start. Try again in a minute.', code: 'computer_unavailable' }, 503);
  }
  let d; try{ d = JSON.parse(text); }catch(e){ d = null; }
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

