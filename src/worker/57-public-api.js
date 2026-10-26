/* =====================================================================
   AMV-097  THE API - selling AMV to programs, not only to people

   Everything an API needs already existed: metering, per-plan quotas, the
   monthly cost backstop, atomic reservation, abuse controls, engine routing.
   What was missing was a way for a customer to reach any of it without a
   browser session, which is the difference between a $20 seat and a line item
   in someone's infrastructure budget.

   The design is deliberately boring, because the interesting parts are already
   solved:
     - A key is a credential for an ACCOUNT. It spends that account's quota and
       counts against that account's cost ceiling. There is no second budget to
       reason about, and no way for a leaked key to cost more than the plan.
     - Only the HASH is stored. A key is shown once, at creation, and can never
       be read back - because a store that can show you your key can show it to
       whoever reads the store.
     - A key can be scoped and revoked, and its last use is recorded, so a
       customer can tell a live key from a forgotten one.
   ===================================================================== */

const API_KEY_MAX_PER_USER = 10;
const API_KEY_PREFIX = 'amv_sk_';

function _newApiKey() {
  return API_KEY_PREFIX + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
/* SHA-256 of the key. Not a password - it is 48 random hex characters, so there
   is nothing to brute force and no salt to add; the hash exists so the store
   never holds the credential itself. */
async function _apiKeyHash(key) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(key)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
/* What a customer can see about their own key: enough to recognise it, never
   enough to use it. */
function _apiKeyPublic(k) {
  return { id: k.id, name: k.name, last4: k.last4, created: k.created,
           lastUsed: k.lastUsed || null, revoked: !!k.revoked, calls: k.calls || 0 };
}

/* POST /v1/keys/create { name } -> the key, ONCE */
async function apiKeyCreate(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  /* An API key is how an account is spent without anyone watching, so a lapsed
     or free account does not get one - the same rule the rest of the paid
     surface uses, applied where it can be explained. */
  const budget = await _budgetFor(env, user);
  if (budget.free) {
    return json({ error: 'API keys are part of a paid plan. Upgrade and you can create one straight away.',
                  code: 'plan_required' }, 402);
  }
  const blocked = await guardAction(env, `keycreate:${user.email}`, 5, 20, 'API keys');
  if (blocked) return blocked;

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || 'API key').slice(0, 60).trim() || 'API key';

  const key = _newApiKey();
  const hash = await _apiKeyHash(key);
  /* The hash is kept on the record too, and it has to be: revoking marks this
     item AND deletes the lookup the request path reads. Without the hash here
     there would be nothing to delete, so a "revoked" key would keep working -
     which is the worst possible way for a revoke button to fail. It is a hash,
     not the key, and _apiKeyPublic never returns it. */
  const item = { id: 'k_' + crypto.randomUUID().slice(0, 12), name, hash,
                 last4: key.slice(-4), created: Date.now(), calls: 0 };
  /* AMV-053: THE CAP AND THE APPEND ARE ONE DECISION.

     This read the key list, counted the live ones, compared them to the cap and
     wrote the list back - four steps with three gaps. Two creates arriving
     together both read the same list, both decide they are under the cap, and
     both write: the cap is exceeded, and worse, the second write is made from a
     list that does not contain the first key. That key is LOST from the record
     while its lookup row still exists, so it goes on authenticating and cannot
     be revoked through the product, because nothing lists it.

     The lock roster excused this handler on the grounds that two creates at
     once is one person double-clicking and "the cap below refuses the second
     anyway". A double-click is exactly how it happens, and the cap is read
     inside the same window it is supposed to close - so it refuses nothing.
     Same shape as the signup exemption, and wrong for the same reason.

     The lookup row is written after the lock, deliberately: it is a different
     key, and a failure between them leaves a key that is listed and does not
     work - visible and revocable - rather than one that works and is invisible. */
  let capped = false;
  await _withKind(env, 'apikeys', user.email, (rec) => {
    const live = (rec.items || []).filter(k => !k.revoked);
    if (live.length >= API_KEY_MAX_PER_USER) { capped = true; return; }
    rec.items = (rec.items || []).concat(item);
  }, { items: [] });
  if (capped) {
    return json({ error: 'You can have up to ' + API_KEY_MAX_PER_USER + ' active keys. Revoke one to create another.' }, 429);
  }
  // The lookup the request path uses: hash -> which account, which key.
  await env.AMV_KV.put(`apikey:${hash}`, JSON.stringify({ email: user.email, id: item.id }));
  audit(env, 'apikey_created', { email: user.email, id: item.id });
  await _userEvent(env, request, user.email, 'api_key_created');
  /* The only time this value exists anywhere outside the caller's memory. */
  return json({ ok: true, key, item: _apiKeyPublic(item),
                note: 'Copy this now. It is not stored and cannot be shown again.' });
}

/* POST /v1/keys/list */
async function apiKeyList(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const rec = (await DB.get(env, 'apikeys', user.email)) || { items: [] };
  return json({ ok: true, keys: (rec.items || []).map(_apiKeyPublic), max: API_KEY_MAX_PER_USER });
}

/* POST /v1/keys/revoke { id } */
async function apiKeyRevoke(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { id } = await request.json().catch(() => ({}));
  /* AMV-210: the hot path stamps lastUsed on this same record once a minute
     per key, so a revoke could be written back over. The KEY still stopped
     working either way - the lookup row below is what the request path reads,
     and deleting it is what revocation really is - but the record would show a
     revoked key as active, which is a screen telling somebody the opposite of
     the truth about a credential. */
  let hash = '';
  const found = await _withKind(env, 'apikeys', user.email, (rec) => {
    const item = (rec.items || []).find(k => k.id === id);
    if (!item) return false;
    hash = item.hash || '';
    if (!item.revoked) item.revoked = Date.now();
    return true;
  }, { items: [] });
  if (!found) return json({ error: 'not found' }, 404);
  /* Delete the lookup too - this is what the request path reads, and deleting
     it is what revocation really is. Marking the record without removing this
     would leave the key working. */
  if (hash) { try { await env.AMV_KV.delete(`apikey:${hash}`); } catch (e) {} }
  /* AND IN ONE PLACE EVERY LOCATION READS AT ONCE (scale audit, owner yes,
     Oct 26). The KV delete above can take a minute or more to be seen
     everywhere, and for that minute the key still worked somewhere. A key's
     own object, raised once, is what _userFromApiKey asks first. Failing to
     raise it is said, and the KV delete still ends the key within the minute. */
  if (hash && env.AMV_COUNTER) {
    try { await counter(env, 'apikeyrev:' + hash, { op: 'incr', amount: 1, keep: true, strict: true }); }
    catch (e) { audit(env, 'apikey_revoke_slow', { email: user.email, id, error: String((e && e.message) || e).slice(0, 120) }); }
  }
  audit(env, 'apikey_revoked', { email: user.email, id });
  await _userEvent(env, request, user.email, 'api_key_revoked');
  return json({ ok: true, id, revoked: true });
}

/* Resolve `Authorization: Bearer amv_sk_...` to the account it belongs to, in
   the same shape requireUser returns - so every quota, cost cap and plan check
   downstream applies to an API call exactly as it does to a browser one. */
async function _userFromApiKey(request, env) {
  const raw = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
           || request.headers.get('X-AMV-Key') || '';
  if (!raw.startsWith(API_KEY_PREFIX)) return null;
  let ref = null;
  const keyHash = await _apiKeyHash(raw);
  try { ref = JSON.parse(await env.AMV_KV.get(`apikey:${keyHash}`) || 'null'); } catch (e) {}
  if (!ref || !ref.email) return null;
  /* Revoked anywhere is revoked here, now (see apiKeyRevoke). An object that
     cannot be asked leaves the KV answer standing - an API outage over one
     object is worse than the minute it covers - and is said. */
  if (env.AMV_COUNTER) {
    try {
      const rv = await counter(env, 'apikeyrev:' + keyHash, { op: 'get', strict: true });
      if (rv && +rv.value > 0) return null;
    } catch (e) { audit(env, 'apikey_revocation_unread', { error: String((e && e.message) || e).slice(0, 120) }); }
  }

  const rec = (await DB.get(env, 'apikeys', ref.email)) || { items: [] };
  const item = (rec.items || []).find(k => k.id === ref.id);
  if (!item || item.revoked) return null;

  /* The account still has to exist. Erasure now clears these, but a key that
     authenticates on the strength of a lookup row alone is one orphaned record
     away from being a credential belonging to nobody - and this is the check
     that makes that impossible rather than merely tidy. */
  const acct = await DB.get(env, 'acct', ref.email);
  if (!acct) return null;

  // Last use, so a customer can tell a live key from a forgotten one. Written
  // at most once a minute: this is on the hot path of every API request.
  const now = Date.now();
  if (!item.lastUsed || now - item.lastUsed > 60000) {
    /* Under the lock, and re-found inside it: this runs on every authenticated
       API request, so it is the write most likely to be racing a revoke. */
    try {
      await _withKind(env, 'apikeys', ref.email, (rec2) => {
        const cur = (rec2.items || []).find(k => k.id === ref.id);
        if (!cur) return null;
        cur.lastUsed = now;
        cur.calls = (cur.calls || 0) + 1;
      }, { items: [] });
    } catch (e) {}
    item.lastUsed = now;
  }

  /* The SAME principal a browser session gets. This used to return five fields
     of its own and nothing else, so an API key carried no billing subject, no
     block, and no family limit - see _principalOf. */
  return await _principalOf(env, ref.email, null, { via: 'apikey', keyId: ref.id });
}

