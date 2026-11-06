/* =====================================================================
   SUPPORT SEES THE ACCOUNT, NOT WHAT IS IN IT (Nov 1 audit OPS-001).

   POST /admin/support/account { email, reason }
     What support needs to resolve a billing or account problem - the plan
     and its state, when the account was made, this period's usage, how many
     jobs, agents, connections and files there are, the sign-in methods -
     and nothing anybody wrote: no chat, no file name, no job text, no
     token. Operator token only, rate limited, a reason required.

   GET /v1/account/access
     The person's own record of every time support looked, with the reason
     given. Nobody looks at an account without the account being told.

   There is no support route that reads content. The only way to content is
   the operator's whole-namespace backup, which exists for disaster
   recovery, is bounded to ten a minute, and is audited.
   ===================================================================== */
/* APPEND-ONLY (Nov 3 audit SUPPORT-001). The record of looks was one list,
   read, changed and written back: two looks at once lost one, a failed read
   started the list again from nothing, and anything that could write the
   list could rewrite it. Each look is now a key of its own, written once
   and never changed (`accesslog:<email>:<when>-<random>`), so a look can be
   added and never taken away by another write. An older single list is
   still read alongside. */
async function _accessLogAdd(env, email, entry){
  const id = String(Date.now()).padStart(13, '0') + '-' + [...crypto.getRandomValues(new Uint8Array(4))].map(b => b.toString(16).padStart(2, '0')).join('');
  await env.AMV_KV.put(`accesslog:${email}:${id}`, JSON.stringify(entry), { expirationTtl: 400 * 86400 });
}
async function _accessLogRead(env, email){
  const out = [];
  try { const old = JSON.parse((await env.AMV_KV.get(`accesslog:${email}`)) || '[]'); if (Array.isArray(old)) out.push(...old); } catch(e) { /* an unreadable record is treated as absent here, and the caller fails closed on absent */ }
  let cursor;
  do {
    const page = await env.AMV_KV.list({ prefix: `accesslog:${email}:`, cursor, limit: 1000 });
    for (const k of page.keys || []) { try { const v = JSON.parse((await env.AMV_KV.get(k.name)) || 'null'); if (v) out.push(v); } catch (e) { out.push({ at: +(k.name.split(':').pop() || '').slice(0, 13) || 0, who: 'AMV support', what: 'a look whose record could not be read', reason: '' }); } }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < 500);
  return out.sort((a, b) => (+a.at || 0) - (+b.at || 0));
}

async function supportAccount(request, env){
  const gate = await _adminGate(request, env, 'support', 30, 500);
  if (gate) return gate;
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const reason = String(body.reason || '').replace(/\s+/g, ' ').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Which account? Give its address.', code: 'bad_email' }, 400);
  if (reason.length < 10) return json({ error: 'Say why you are looking - the person will see it.', code: 'reason_required' }, 400);
  const acct = await DB.get(env, 'acct', email);
  if (!acct) return json({ error: 'There is no account with that address.', code: 'not_found' }, 404);
  /* Told before it is shown: if the record of the look cannot be written,
     nothing is shown. */
  try { await _accessLogAdd(env, email, { at: Date.now(), who: 'AMV support', what: 'account details (no content)', reason: reason.slice(0, 300) }); }
  catch (e) { return json({ error: 'The look could not be recorded, so nothing was shown.', code: 'not_recorded' }, 503); }
  audit(env, 'support_viewed', { email, reason: reason.slice(0, 120) });

  const ent = (await DB.get(env, 'ent', email)) || { plan: 'free' };
  const auto = (await DB.get(env, 'auto', _autoKey(email))) || { items: [] };
  const agents = (await DB.get(env, 'agents', email)) || { list: [] };
  const conns = (await DB.get(env, CONN_KV, email)) || {};
  const lib = (await DB.get(env, LIB_KIND, email)) || { files: [] };
  let monthUsed = null;
  try { monthUsed = +((await counter(env, `usg:${email}:${_periodKeyFor(ent.renewedAt, ent.plan, ent.customCfg)}`, { op: 'get' })).value || 0); } catch (e) { monthUsed = null; }
  return json({ ok: true, account: {
    email, created: acct.created || null, name: acct.name ? true : false,
    signIn: { password: !!acct.pwHash, passkeys: Array.isArray(acct.passkeys) ? acct.passkeys.length : 0, authenticator: !!acct.totp, google: !!acct.google },
    plan: { plan: _planOf(ent), sold: ent.plan || 'free', source: ent.source || '', renewedAt: ent.renewedAt || null, status: ent.status || '', cancelAt: ent.cancelAt || null },
    usage: { periodTokens: monthUsed },
    counts: { jobs: (auto.items || []).length, agents: (agents.list || []).filter(a => a && !a.deleted).length,
              connections: Object.keys(conns).length, files: (lib.files || []).length },
    connectedProviders: [...new Set(Object.values(conns).map(c => c && c.provider).filter(Boolean))],
  }, recorded: true });
}

async function accountAccessLog(request, env){
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  let list;
  try { list = await _accessLogRead(env, String(user.email).toLowerCase()); }
  catch (e) { return json({ error: 'Your record of support access could not be read right now. Try again in a moment.', code: 'unavailable' }, 503); }
  return json({ ok: true, access: list.slice().reverse() });
}
