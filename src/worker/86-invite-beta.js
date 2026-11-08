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
  /* Revoked or past its date: not an invite any more (Nov 8 audit BETA-002). */
  if(beta && (beta.revoked || (+beta.exp && Date.now() > +beta.exp))) return '';
  if(beta && +beta.uses > 0){
    const r = await counter(env, 'betainvuse:' + code, { op: 'reserve', amount: 1, cap: +beta.uses, ttlMs: 400 * 86400000 });
    return r && r.allowed ? 'beta' : '';
  }
  try { if(await env.AMV_KV.get('refcode:' + code)) return 'ref'; } catch (e) { return ''; }
  return '';
}

/* A USE IS SPENT ONLY ON AN ACCOUNT THAT WAS MADE (Nov 8 audit: a sign-up
   refused for a typo used up a one-use code, and the real sign-up after it
   was turned away). Every sign-up door now takes the use as its last check,
   after the address, password and everything else it can refuse on, and
   hands it back whenever no account came of it - refused, already taken, or
   the write failing. The give-back carries a once-only name, so a retry of a
   lost answer cannot hand back two. A Worker stopping between taking and
   making loses that one use; that is the rare direction, and the owner can
   make more, where the other direction let a sign-up past the limit. */
async function _inviteHold(env, raw, where){
  if(!_inviteOnly(env)) return { refusal: null, done: async () => {} };
  const kind = await _inviteTake(env, raw).catch(() => '');
  if(!kind){
    audit(env, 'invite_refused', { where });
    return { refusal: json({ error: 'AMV is invite-only for now. Open the invite link somebody sent you, or ask a friend who uses AMV for theirs.', code: 'invite_required' }, 403), done: async () => {} };
  }
  const code = _inviteCode(raw), hold = crypto.randomUUID();
  let settled = false;
  return { refusal: null, async done(made){
    if(settled) return; settled = true;
    if(made){ audit(env, 'invite_used', { kind, where }); return; }
    if(kind !== 'beta') return;
    try { await counter(env, 'betainvuse:' + code, { op: 'incr', amount: -1, once: 'back:' + hold, ttlMs: 400 * 86400000 }); }
    catch (e) { audit(env, 'invite_not_returned', { where }); }
  } };
}
/* Null when the sign-up may go ahead; otherwise the refusal. Kept for a door
   that makes the account in the same step it checks. */
async function _inviteGate(env, raw, where){
  const h = await _inviteHold(env, raw, where);
  if(h.refusal) return h.refusal;
  await h.done(true);
  return null;
}

/* POST /admin/invites { count, uses } -> { codes, links } */
async function adminInvitesCreate(request, env){
  const gate = await _adminGate(request, env, 'invites', 10, 100);
  if(gate) return gate;
  const body = await request.json().catch(() => ({}));
  const count = Math.max(1, Math.min(BETA_INV_MAX_PER_CALL, parseInt(body.count, 10) || 1));
  const uses = Math.max(1, Math.min(BETA_INV_MAX_USES, parseInt(body.uses, 10) || 1));
  /* A date after which it lets nobody in: 1 to 365 days, 30 if not said. */
  const days = Math.max(1, Math.min(365, parseInt(body.days, 10) || 30));
  const exp = Date.now() + days * 86400000;
  const origin = String(env.APP_URL || env.APP_ORIGIN || '').replace(/\/$/, '');
  const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const codes = [];
  for(let i = 0; i < count; i++){
    const b = crypto.getRandomValues(new Uint8Array(9));
    const code = 'B' + [...b].map(x => ALPHA[x % ALPHA.length]).join('');
    await env.AMV_KV.put('betainv:' + code, JSON.stringify({ uses, at: Date.now(), exp }));
    codes.push(code);
  }
  audit(env, 'invites_created', { count, uses, days });
  return json({ ok: true, uses, expires: exp, codes, links: origin ? codes.map(c => origin + '/?ref=' + c) : [] });
}

/* POST /admin/invites/list -> every invite the owner made, with how many of
   its uses are spent, when it ends and whether it was revoked. */
async function adminInvitesList(request, env){
  const gate = await _adminGate(request, env, 'invites', 30, 300);
  if(gate) return gate;
  const out = [];
  let cursor, pages = 0;
  do {
    const page = await env.AMV_KV.list({ prefix: 'betainv:', cursor });
    for(const k of (page.keys || [])){
      let rec = null; try { rec = JSON.parse((await env.AMV_KV.get(k.name)) || 'null'); } catch (e) { rec = null; }
      if(!rec) continue;
      const code = k.name.slice('betainv:'.length);
      let used = null; try { const r = await counter(env, 'betainvuse:' + code, { op: 'get' }); used = +((r && r.value) || 0); } catch (e) { used = null; }
      out.push({ code, uses: +rec.uses || 0, used, made: rec.at || null, expires: rec.exp || null, revoked: !!rec.revoked,
        open: !rec.revoked && !(+rec.exp && Date.now() > +rec.exp) && (used == null || used < (+rec.uses || 0)) });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while(cursor && ++pages < 20);
  return json({ ok: true, invites: out, complete: !cursor });
}

/* POST /admin/invites/revoke { code } -> it lets nobody else in. Sign-ups
   it already let in are kept. */
async function adminInvitesRevoke(request, env){
  const gate = await _adminGate(request, env, 'invites', 30, 300);
  if(gate) return gate;
  const body = await request.json().catch(() => ({}));
  const code = _inviteCode(body.code);
  let rec = null; try { rec = JSON.parse((await env.AMV_KV.get('betainv:' + code)) || 'null'); } catch (e) { rec = null; }
  if(!code || !rec) return json({ error: 'There is no invite with that code.', code: 'not_found' }, 404);
  rec.revoked = true; rec.revokedAt = Date.now();
  await env.AMV_KV.put('betainv:' + code, JSON.stringify(rec));
  audit(env, 'invite_revoked', {});
  return json({ ok: true, code, revoked: true });
}
