  const referrals7 = referrals30.slice(-7).reduce((n, d) => n + d.count, 0);
  const signups7 = signups30.slice(-7).reduce((n, d) => n + d.count, 0);
  const signupsPrev7 = signups30.slice(-14, -7).reduce((n, d) => n + d.count, 0);
  const wowGrowthPct = signupsPrev7 > 0 ? +(((signups7 - signupsPrev7) / signupsPrev7) * 100).toFixed(0) : null;

  /* EVERY account, not every entitlement row.

     This read `entRows.length`, and a free signup creates no entitlement row -
     so the denominator was essentially the set of people who had already paid,
     and conversion reported ~100% no matter what the funnel was really doing.
     On a fixture of twenty free accounts and one payer it said 100% where the
     truth was 4.8%: the single most decision-corrupting number the dashboard
     could produce, because it says the funnel is perfect and there is nothing
     to fix.

     The maintained counter is exact at any size. It falls back to the scan on
     a deployment that predates it, where the old wrong answer is still better
     than none - and `basis` says which one this is, because a number whose
     meaning changes silently is how the first version of this got believed. */
  const popAccounts = (await counter(env, 'popaccounts', { op: 'get' })).value || 0;
  const countedAccounts = popAccounts > 0 ? popAccounts : entRows.length;
  const conversionBasis = popAccounts > 0 ? 'accounts' : 'entitlements';
  const conversionPct = countedAccounts > 0 ? +((paying / countedAccounts) * 100).toFixed(1) : 0;
  const arpu = paying > 0 ? +(mrr / paying).toFixed(2) : 0;
  const appRequests = await _appRequestCounts(env);

  return json({
    ok: true,
    generatedAt: Date.now(),
    /* Which apps people pressed Notify me on, most asked-for first. The
       Integrations page promises the most-asked-for are connected next; this
       is the list that promise is kept from. */
    appRequests,
    spend: { today: +gSpend.toFixed(2), cap: gCap, pctOfCap: +(gSpend / gCap * 100).toFixed(1), killed },
    users: { total: truncated ? popTotal : users.length, paying, byPlan: plans,
             conversionPct, conversionBasis, accounts: countedAccounts, activeToday },
    /* Say plainly whether the per-account lists below are everything or a
       sample. The alternative is a number that is quietly wrong. */
    scan: { rows: entRows.length, limit: SCAN_LIMIT, truncated,
            note: truncated
              ? 'More accounts than one page can read. Revenue and population come from maintained counters and are exact; the per-account lists are the first ' + entRows.length + '.'
              : 'Every account was read.' },
    growth: { signupsToday, signups7, signupsPrev7, wowGrowthPct, signups30, active30,
              referrals7, referrals30, visits7, visits30,
              /* Of the people who arrived, how many became accounts. Null
                 rather than 0 when nothing has been counted yet, because "no
                 visitors recorded" and "nobody converted" are different facts
                 and showing 0% for the first is a lie about the product. */
              visitToSignupPct: visits7 > 0 ? +((signups7 / visits7) * 100).toFixed(1) : null,
              // What share of the last week's signups came through an invite.
              referralSharePct: signups7 > 0 ? +((referrals7 / signups7) * 100).toFixed(1) : null },
    /* Signup -> activated -> returned -> paid. The question every piece of
       onboarding work is trying to move, and the only one that says whether it
       did (AMV-101). */
    funnel: await _funnelReport(env),
    revenue: { estMRR: mrr, estARR: mrr * 12, arpu, pastDueAccounts: pastDue, mrrAtRisk: atRisk,
               teamSeatsSold: seatsSold, teamSeatMRR: seatsSold * TEAM_SEAT_PRICE_USD },
    margin: (() => {
      const scanCost = +users.reduce((s, u) => s + u.monthCostUSD, 0).toFixed(2);
      /* The maintained total is exact; the scanned sum is only exact when the
         scan saw everything. Prefer the counter, and fall back to the sum if it
         has not been populated yet (an existing deployment before this shipped). */
      const totalCost = +(totalCost0 > 0 ? totalCost0 : scanCost).toFixed(2);
      return {
        estMonthlyCost: totalCost,
        grossMargin: +(mrr - totalCost).toFixed(2),
        grossMarginPct: mrr > 0 ? +(((mrr - totalCost) / mrr) * 100).toFixed(1) : null,
        costPerPayingUser: paying > 0 ? +(totalCost / paying).toFixed(3) : 0,
        freeUserCost: freeCost,
        byPlan: byPlanEconomics,
        featureCost,
        cacheSavedUSD: cacheSaved,
        unprofitableAccounts: unprofitable,
      };
    })(),
    quality,
    speed,
    topSpenders,
  });
}

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

