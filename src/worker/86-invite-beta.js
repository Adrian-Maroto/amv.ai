/* AN INVITE-ONLY BETA THAT GROWS BY ITSELF (owner yes, Nov 7).

   With SIGNUP_INVITE_ONLY=1 a new account needs a code, and two kinds count:
     - one the owner made (POST /admin/invites), good for a set number of
       sign-ups - the seed;
     - any existing person's referral code - so everybody in the beta can
       bring people in, and every new account is credited to who brought it
       (the referral record does that, as it always has).
   Off, sign-up is open exactly as before. Signing in to an account that
   exists is never affected, and company sign-in (SSO) is not gated: a team
   that set it up is already invited. The code travels the way a referral
   link always has (?ref=CODE, sent as `ref`), so the page needs nothing new. */
const BETA_INV_MAX_PER_CALL = 200;
const BETA_INV_MAX_USES = 50;
function _inviteOnly(env){ return String((env && env.SIGNUP_INVITE_ONLY) || '') === '1'; }
const _inviteCode = (raw) => String(raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 12);

/* Whether a code lets somebody in: 'beta', 'ref', or '' - and a beta code's
   use is taken here, atomically, so fifty people cannot share one ten-use
   code by arriving at once. */
async function _inviteTake(env, raw){
  const code = _inviteCode(raw);
  if(!code) return '';
  let beta = null;
  try { beta = JSON.parse((await env.AMV_KV.get('betainv:' + code)) || 'null'); } catch (e) { beta = null; }
  if(beta && +beta.uses > 0){
    const r = await counter(env, 'betainvuse:' + code, { op: 'reserve', amount: 1, cap: +beta.uses, ttlMs: 400 * 86400000 });
    return r && r.allowed ? 'beta' : '';
  }
  try { if(await env.AMV_KV.get('refcode:' + code)) return 'ref'; } catch (e) { return ''; }
  return '';
}
/* Null when the sign-up may go ahead; otherwise the refusal. */
async function _inviteGate(env, raw, where){
  if(!_inviteOnly(env)) return null;
  const kind = await _inviteTake(env, raw).catch(() => '');
  if(kind){ audit(env, 'invite_used', { kind, where }); return null; }
  audit(env, 'invite_refused', { where });
  return json({ error: 'AMV is invite-only for now. Open the invite link somebody sent you, or ask a friend who uses AMV for theirs.', code: 'invite_required' }, 403);
}

/* POST /admin/invites { count, uses } -> { codes, links } */
async function adminInvitesCreate(request, env){
  const gate = await _adminGate(request, env, 'invites', 10, 100);
  if(gate) return gate;
  const body = await request.json().catch(() => ({}));
  const count = Math.max(1, Math.min(BETA_INV_MAX_PER_CALL, parseInt(body.count, 10) || 1));
  const uses = Math.max(1, Math.min(BETA_INV_MAX_USES, parseInt(body.uses, 10) || 1));
  const origin = String(env.APP_URL || env.APP_ORIGIN || '').replace(/\/$/, '');
  const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const codes = [];
  for(let i = 0; i < count; i++){
    const b = crypto.getRandomValues(new Uint8Array(9));
    const code = 'B' + [...b].map(x => ALPHA[x % ALPHA.length]).join('');
    await env.AMV_KV.put('betainv:' + code, JSON.stringify({ uses, at: Date.now() }));
    codes.push(code);
  }
  audit(env, 'invites_created', { count, uses });
  return json({ ok: true, uses, codes, links: origin ? codes.map(c => origin + '/?ref=' + c) : [] });
}
