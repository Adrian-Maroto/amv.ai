  let digits = d.replace(/^\+/, '');
  if (!hasPlus) {
    // assume US/Canada if 10 digits; if 11 starting with 1, keep as-is
    if (digits.length === 10) digits = '1' + digits;
  }
  // E.164: 8-15 digits, leading digit 1-9 (no leading zero on country code)
  if (digits.length < 8 || digits.length > 15) return '';
  if (!/^[1-9]\d{7,14}$/.test(digits)) return '';
  return '+' + digits;
}

/* Verify a Twilio webhook signature (HMAC-SHA1 over URL + sorted POST params,
   base64-encoded). Constant-time compare. Returns true only if it matches. */
async function verifyTwilioSignature(authToken, url, params, signature) {
  try {
    if (!signature) return false;
    // Twilio concatenates the full URL, then each sorted param key+value.
    const sortedKeys = Object.keys(params).sort();
    let data = url;
    for (const k of sortedKeys) data += k + params[k];
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(authToken),
      { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    // base64 (standard, not url-safe) - matches Twilio's encoding
    let bin = ''; const bytes = new Uint8Array(mac);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const expected = btoa(bin);
    // constant-time compare
    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
}

function twiml(message) {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><Response><Message>' +
    String(message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
    '</Message></Response>';
  return new Response(xml, { headers: { 'Content-Type': 'text/xml' } });
}

/* Waitlist - captures interest for not-yet-launched apps (Chrome, iOS, etc.).
   Stored in KV so you have a real list to email when each product ships. */
async function waitlistAdd(request, env) {
  // AMV-060: rate-limit per IP so the public waitlist can't be used to spam
  // third-party addresses or inflate signups.
  /* PER PERSON WHEN WE KNOW THE PERSON.

     Five a minute and fifty a day per IP was written for the anonymous form,
     where the risk is somebody signing strangers up. A signed-in person tapping
     "Notify me" down the Integrations list hit it on the sixth app - and a
     school or an office shares one address, so fifty a day was the whole
     building's allowance, on the counts that decide which apps get built.
     Signed in, the limit is per account and the address is the account's own,
     so it cannot be used to put anybody else on a list. */
  const user = await requireUser(request, env).catch(() => null);
  const wl = user
    ? await limitAction(env, `waitlist:u:${user.email}`, 30, 600)
    : await limitAction(env, `waitlist:${_rlIp(request)}`, 5, 50);
  if (!wl.ok && wl.unavailable)
    return json({ error: 'We could not add you to the list just now. Please try again in a moment.', code: 'limit_unavailable' }, 503);
  if (!wl.ok) return json({ error: 'Too many requests. Please try again later.' }, 429);
  const body = await request.json().catch(() => ({}));
  const email = user ? String(user.email).toLowerCase() : String(body.email || '').toLowerCase().trim();
  const product = String(body.product || 'general').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
  if (!email || !/^[^\s@:]{1,64}@[^\s@:]+\.[^\s@:]{2,}$/.test(email))
    return json({ error: 'That does not look like an email address. Check it and try again.' }, 400);
  /* Shares the non-essential ceiling with telemetry. A waitlist entry is worth
     having and is worth nothing at all compared to sign-up still working, so it
     is refused before the storage budget is spent - and says so, rather than
     pretending it was recorded. */
  if (!await _nonEssentialWrite(env, 'a waitlist sign-up'))
    return json({ error: 'We could not add you to the list just now. Please try again later.',
                  code: 'needs_service' }, 503);
  await env.AMV_KV.put(`waitlist:${product}:${email}`, JSON.stringify({ email, product, ts: Date.now() }));
  return json({ ok: true });
}

/* =====================================================================
   PAYMENTS - real Stripe + PayPal with webhook-driven entitlement sync.

   The flow that actually grants access:
     1. Frontend calls /v1/stripe/checkout -> we create a Stripe Checkout
        Session (subscription) and return its URL. User pays on Stripe.
     2. Stripe calls /v1/stripe/webhook (signed) on success/renewal/cancel.
        We VERIFY the signature, then write ent:<email> = { plan, ... }.
     3. requireUser() reads ent:<email>, so the new plan takes effect on the
        very next API call. No client-trust: the plan is set ONLY by a
        verified webhook from the payment processor, never by the browser.

   This is the critical link the app was missing - without the webhook,
   a paid user would never actually get upgraded.
   ===================================================================== */

// Map your plans to Stripe Price IDs (create these in the Stripe dashboard).
/* MONTHLY OR YEARLY, AND STRIPE DECIDES THE AMOUNT EITHER WAY.

   A yearly plan is not a discount this file applies - it is a second recurring
   price in Stripe, and the only thing here that changes is WHICH price id the
   checkout session is opened with. That matters: if AMV computed a yearly
   figure of its own, the page and the charge would be two numbers maintained
   in two places, which is the drift this repository keeps finding. The amount
   somebody is charged is the amount on the price the operator created.

   Yearly is optional. A deployment that has not created those prices sells
   monthly exactly as before, and asking for yearly there is answered by
   _planUnsellable naming the secret to set rather than by a failed checkout. */
function _stripePriceId(env, plan, cycle) {
  const map = String(cycle || '') === 'year' ? {
    pro:   env.STRIPE_PRICE_PRO_YEAR,
    elite: env.STRIPE_PRICE_ELITE_YEAR,
    ultra: env.STRIPE_PRICE_ULTRA_YEAR,
    team:  env.STRIPE_PRICE_TEAM_SEAT_YEAR,
  } : {
    pro:   env.STRIPE_PRICE_PRO,
    elite: env.STRIPE_PRICE_ELITE,
    ultra: env.STRIPE_PRICE_ULTRA,
