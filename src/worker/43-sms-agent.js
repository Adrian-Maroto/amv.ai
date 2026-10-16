
        # OPTIONAL - connected accounts. CONNECT_KEY seals every stored
        # provider token with AES-GCM; without it AMV refuses to connect an
        # account rather than storing a token in the clear.
        # To ROTATE it: put the new value in CONNECT_KEY, the old one in
        # CONNECT_KEY_PREV, and leave both for as long as it takes every
        # connection to be used once - each re-seals under the new key when it
        # is. Then remove CONNECT_KEY_PREV. Rotating WITHOUT setting PREV makes
        # every stored connection unreadable and every customer has to
        # reconnect every account.
        wrangler secret put CONNECT_KEY
        wrangler secret put CONNECT_KEY_PREV     (only during a rotation)

   4. wrangler.toml config:
        [vars]
        GLOBAL_DAILY_USD_CAP = "500"             (your hard ceiling)
        ALERT_WEBHOOK = "https://hooks.slack..." (optional)

        # Durable Object - ATOMIC rate limits & quotas (no race conditions)
        [[durable_objects.bindings]]
        name = "AMV_COUNTER"
        class_name = "AMVCounter"

        [[migrations]]
        tag = "v1"
        new_sqlite_classes = ["AMVCounter"]
   5. wrangler deploy  → get https://amv-api.<you>.workers.dev
   6. In AMV → Settings → Live/Backend, paste that URL.
      Now: key is hidden, plans enforced, quotas + spend cap live & atomic.

   NOTE: If AMV_COUNTER is not bound, the Worker still runs but falls back
   to (non-atomic) KV counters. Bind the Durable Object for production -
   it's what makes rate limits and quotas race-proof under parallel load.

   PAYMENTS (real money) - set these secrets:
     wrangler secret put STRIPE_SECRET_KEY        (sk_live_…)
     wrangler secret put STRIPE_WEBHOOK_SECRET    (whsec_… from the webhook)
     [vars] STRIPE_PRICE_PRO / STRIPE_PRICE_ELITE / STRIPE_PRICE_ULTRA
            (Price IDs you create in the Stripe dashboard)
     In Stripe → Developers → Webhooks, add endpoint:
       https://<your-worker>/v1/stripe/webhook
       events - ALL TEN. This list named four of them, and the other six are
       handled here in code that would simply never run: an operator following
       it subscribed to a quarter of what AMV listens for and had no way to
       know. Each one is money moving in a direction somebody has to know about.
         checkout.session.completed              a card paid, grant the plan
         checkout.session.async_payment_succeeded a voucher or direct debit
                                                  finally cleared - WITHOUT
                                                  this, a customer who paid by
                                                  OXXO or SEPA pays and is
                                                  never granted anything
         checkout.session.async_payment_failed    it did not clear; close it out
         customer.subscription.updated            seats, plan or state changed
         customer.subscription.deleted            it ended
         invoice.paid                             a renewal went through
         invoice.payment_failed                   a renewal was declined
         charge.refunded                          money went back
         refund.created                           the same, newer event shape
         charge.dispute.created                   a chargeback was opened
   PayPal (optional):
     wrangler secret put PAYPAL_CLIENT_ID / PAYPAL_SECRET / PAYPAL_WEBHOOK_ID
     [vars] PAYPAL_MODE = "live"  (or "sandbox")
     Webhook endpoint: https://<your-worker>/v1/paypal/webhook

   HOW ACCESS IS GRANTED: the plan is written to ent:<email> ONLY by a
   signature-verified webhook from Stripe/PayPal. The browser can never
   grant itself a paid plan - requireUser() reads ent:<email> on every call.

   FOUNDER ADMIN (your private dashboard):
     wrangler secret put ADMIN_TOKEN   (a long random string only YOU hold)
     Then in AMV: open with ?owner=1, go to Settings -> Founder Dashboard,
     paste the token to see platform spend / users / revenue / top spenders,
     flip the kill switch, or override a user's plan. The token is never
     stored in the browser. Endpoints: /v1/admin/stats, /v1/admin/kill,
     /v1/admin/user - all 403 without the exact ADMIN_TOKEN.

   KILL SWITCH (instant stop):
     wrangler kv:key put --binding=AMV_KV GLOBAL_KILL 1     (halt)
     wrangler kv:key delete --binding=AMV_KV GLOBAL_KILL    (resume)
   ===================================================================== */

/* =====================================================================
   SMS / TEXT-MESSAGE AGENT  (Poke-style "run agents from your phone")
   ---------------------------------------------------------------------
   Lets users text a phone number and get AI replies - "check project X",
   "summarize my latest task", etc. Profit-safe: SMS users consume the
   same metered, capped credit pool as everyone else.

   HOW IT WORKS (the part only a backend can do):
   1. You rent a number from Twilio and point its "A MESSAGE COMES IN"
      webhook to:  https://<your-worker>/sms/incoming
   2. A user registers their phone in the website (Settings → Text Messages),
      which links that number to their AMV account.
   3. When they text the number, Twilio POSTs here, we run the AI under
      THEIR account + limits, and text the reply back.

   SECRETS to set (wrangler secret put ...):
     TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER

   SECURITY: When TWILIO_AUTH_TOKEN is set, every inbound /sms/incoming
   request is verified against Twilio's X-Twilio-Signature (HMAC-SHA1 over
   URL + params). Forged requests get a 403. ALWAYS set TWILIO_AUTH_TOKEN
   in production - without it, anyone could POST here and trigger AI spend.
   Also ensure your webhook URL in the Twilio console EXACTLY matches the
   deployed URL (scheme + host + path), since it's part of the signature.
   ===================================================================== */

// Link a phone number to an AMV account (called by the website after the
// user verifies they own the number). Stored as phone -> email in KV.
/* AMV-025: how many guesses a six-digit code is worth. Five, like the reset
   code, because the two are the same thing for the same reason. */
const SMS_CODE_MAX_ATTEMPTS = 5;

async function smsRegister(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const body = await request.json().catch(() => ({}));
  const phone = normalizePhone(body.phone || '');
  if (!phone) return json({ error: 'invalid phone number' }, 400);
  const email = user.email.toLowerCase();

  // AMV-033: a phone number is not self-asserted identity. Never bind a number to
  // an account on an unverified claim (that would send an unsolicited SMS and let
  // an attacker link a victim's number). Require a one-time code AND enforce
  // one-account-per-phone uniqueness.
  const existing = await env.AMV_KV.get(`sms:phone:${phone}`);
  if (existing && existing !== email) return json({ error: 'that phone number is already linked to another account' }, 409);

  const code = String(body.code || '').trim();
  if (!code) {
    if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER))
      return json({ error: 'SMS is not configured on this workspace yet.', code: 'sms_unconfigured' }, 503);
    const rl = await limitAction(env, `smsverify:${phone}`, 3, 10);
    if (!rl.ok && rl.unavailable) return json({ error: 'Codes cannot be sent just now. Please try again in a moment.', code: 'limit_unavailable' }, 503);
    if (!rl.ok) return json({ error: 'Too many codes requested. Please wait a few minutes.' }, 429);
    /* AMV-025: NOT Math.random.

       Math.random is a fast generator, not an unpredictable one - its internal
       state is recoverable from a handful of outputs, and here the outputs are
       handed to whoever asks for a code. Three requests to your own number, and
       the next code sent to somebody else's is predictable. It is the same
       crypto.getRandomValues the reset codes have always used; there was never
       a reason for these two to differ. */
    const vcode = _sixDigitCode();
    await env.AMV_KV.put(`smsverify:${email}:${phone}`,
      JSON.stringify({ code: vcode, attempts: 0, at: Date.now() }), { expirationTtl: 600 });
    try { await sendSms(env, phone, `Your AMV verification code is ${vcode}. It expires in 10 minutes.`); }
    catch (e) { return json({ error: 'Could not send the verification code.' }, 502); }
    return json({ ok: true, pending: true });
  }

  /* AMV-025: A SIX-DIGIT CODE WITH NO ATTEMPT LIMIT IS A FOUR-MINUTE LOCK.

     There was no cap on guesses at all. A million possibilities sounds like a
     lot until nothing is counting: the code lives for ten minutes and the only
     thing between an attacker and somebody else's number was how fast they
     could send requests.

     Counted inside the record lock, for the reason AMV-018 found on the reset
     code: a read, a compare, an increment and a write is four steps with three
     gaps, and guesses arriving together all read the same number and all decide
     they are under the limit. */
  let verdict;
  try {
    verdict = await _withKV(env, 'smsverify', `${email}:${phone}`, (rec) => {
      if (!rec || !rec.code) return { gone: true };
      if ((rec.attempts || 0) >= SMS_CODE_MAX_ATTEMPTS) return { exhausted: true };
      rec.attempts = (rec.attempts || 0) + 1;
      const match = timingSafeEqual(new TextEncoder().encode(code), new TextEncoder().encode(String(rec.code)));
      if (!match) return { wrong: true, left: Math.max(0, SMS_CODE_MAX_ATTEMPTS - rec.attempts) };
      rec.used = true;
      return { ok: true };
    }, null);
  } catch (e) {
    if (_isBusy(e)) return _busyJson('phone verification');
    /* A verification code is a throwaway, so a record that cannot be read is
       answered as an expired one rather than as a server error - re-requesting
       is the recovery, and it works. Anything else is a real fault. */
    if (e instanceof UnreadableRecordError) verdict = { gone: true };
    else throw e;
  }

  if (!verdict || verdict.gone) return json({ error: 'Incorrect or expired code.' }, 401);
  if (verdict.exhausted)
    return json({ error: 'Too many incorrect codes. Request a new one.', code: 'code_exhausted' }, 429);
  if (verdict.wrong)
    return json({ error: 'Incorrect or expired code. ' + verdict.left + ' attempt' + (verdict.left === 1 ? '' : 's') + ' left.' }, 401);

  await env.AMV_KV.delete(`smsverify:${email}:${phone}`);

  /* AMV-025: THE UNIQUENESS CHECK WAS READ AT THE TOP AND WRITTEN AT THE BOTTOM.

     "one account per number" was decided from a read taken before the code was
     even checked, and enforced by a `put` that overwrites whatever is there. Two
     accounts verifying the same number in the same minute both passed the check
     and the second write won - so one number ends up linked to two accounts,
     with the loser's link silently gone and the winner able to text as them.

     Claimed atomically instead: the first one through owns the number. */
  const claimedBy = await _claimPhone(env, phone, email);
  if (claimedBy && claimedBy !== email)
    return json({ error: 'that phone number is already linked to another account' }, 409);

  /* AMV-024: THE NUMBER THEY JUST REPLACED WAS STILL LINKED.

     `sms:user:<email>` was overwritten with the new number and
     `sms:phone:<old>` was left exactly as it was. That row is the one
     /sms/incoming reads to decide whose account a text belongs to - so somebody
     who changed their number because they LOST the old handset, or sold it, or
     left a shared phone behind, had just told AMV a new number and left the old
     one able to spend their allowance and read their assistant. The screen said
     the number was changed. Both of them worked.

     The old link is removed here, after the new one is safely claimed, so a
     failure in between leaves them reachable rather than locked out. */
  const previous = await env.AMV_KV.get(`sms:user:${email}`);
  await env.AMV_KV.put(`sms:user:${email}`, phone);
  if (previous && previous !== phone) {
    try {
      const ownedBy = await env.AMV_KV.get(`sms:phone:${previous}`);
      if (ownedBy === email) await env.AMV_KV.delete(`sms:phone:${previous}`);
      audit(env, 'sms_number_replaced', { email, had: previous.slice(-4), now: phone.slice(-4) });
      await _userEvent(env, request, email, 'phone_changed', { endsWith: phone.slice(-4) });
    } catch (e) { /* the new number is live either way; this must not undo it */ }
  }
  return json({ ok: true, phone, verified: true, replaced: previous && previous !== phone ? true : false });
}

/* One account per number, decided once rather than checked and later written.
   Returns the address that owns it - this one if the claim succeeded, somebody
   else's if it was already taken.

   Deliberately on the SAME key /sms/incoming reads, in the same bare-address
   format, rather than a second record beside it. A claim record and a lookup
   record that have to agree are two records that can disagree, which is the
   whole class of defect this file has spent a week removing. The lock and the
   write are on the one row that decides. */
async function _claimPhone(env, phone, email) {
  let owner = '';
  await _withRecord(env, 'smsphone', String(phone || ''),
    async (e, k) => (await e.AMV_KV.get(`sms:phone:${k}`)) || '',
    async (e, k) => { if (owner === email) await e.AMV_KV.put(`sms:phone:${k}`, email); },
    (current) => { owner = current || email; });
  return owner;
}

// Send an outbound SMS via Twilio's REST API.
async function sendSms(env, to, body) {
  const sid = env.TWILIO_ACCOUNT_SID, token = env.TWILIO_AUTH_TOKEN, from = env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) throw new Error('twilio_not_configured');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const form = new URLSearchParams({ To: to, From: from, Body: body });
  const resp = await fetchDeadline(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(sid + ':' + token),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!resp.ok) throw new Error('twilio_send_failed_' + resp.status);
  return resp.json();
}

// Twilio calls this when a text arrives. We reply with TwiML.
async function smsIncoming(request, env, ctx) {
  // Twilio sends application/x-www-form-urlencoded
  const form = await request.formData().catch(() => null);
  if (!form) return twiml('Sorry, could not read that message.');

  // --- SECURITY: verify this request actually came from Twilio ---
  // Without this, anyone could POST here and trigger AI spend on a linked
  // account. Twilio signs each webhook with HMAC-SHA1 over the URL + params.
  // FAIL CLOSED (AMV-033): never accept an inbound webhook we can't authenticate.
  // If TWILIO_AUTH_TOKEN isn't configured, reject rather than run the AI agent
  // (and incur model/Twilio cost) on a forged, unsigned request.
  if (!env.TWILIO_AUTH_TOKEN) { audit(env,'sms_unconfigured',{}); return new Response('Forbidden', { status: 403 }); }
  {
    const sig = request.headers.get('X-Twilio-Signature') || '';
    const params = {};
    for (const [k, v] of form.entries()) params[k] = v;
    const ok = await verifyTwilioSignature(env.TWILIO_AUTH_TOKEN, request.url, params, sig);
    if (!ok) { audit(env,'forged_webhook',{kind:'twilio'}); return new Response('Forbidden', { status: 403 }); }
  }

  const from = normalizePhone(form.get('From') || '');
  const text = (form.get('Body') || '').trim();
  if (!from || !text) return twiml('Send a message to get started.');
  if (text.length > 1600) return twiml('That message is too long. Please keep it under 1600 characters.');

  // who is this number linked to?
  const email = await env.AMV_KV.get(`sms:phone:${from}`);
  if (!email) {
    return twiml('This number isn\u2019t linked to an AMV account yet. Sign up at AMV and add your phone in Settings \u2192 Text Messages.');
  }

  // load their plan + enforce the SAME limits/caps as the web app
  const e = (await DB.get(env, 'ent', email)) || {};
  /* AMV-023: the SAME principal, not a hand-built one.

     This used to assemble six fields itself. The ceiling check further down
     calls the shared helper and carries a comment saying a parent's limit
     reaches SMS through it - and `family` was not one of the six, so the helper
     could only ever answer with the plan backstop. A child capped at $10 a
     month could text AMV all month against the plan's allowance instead, and
     the comment said otherwise. */
  const user = await _principalOf(env, email, e, { via: 'sms' });
  /* Answered in Twilio's own language rather than as JSON - this reply is read
     aloud to somebody's phone, and a 403 body would arrive as nothing at all. */
  if (await _accountHold(env, user, 'sms')) {
    return twiml('This account is on hold and cannot use paid features. Contact support if you think that is wrong.');
  }

  // rate-limit SMS per number (cheap abuse guard) - atomic test-and-increment
  const smsRlName = `sms:rl:${from}:${Math.floor(Date.now() / 60000)}`;
  const smsRl = await counter(env, smsRlName, { op: 'rateCheck', limit: 8, windowMs: 60000 });
  if (!smsRl.allowed) return twiml('You\u2019re sending messages too fast. Give it a minute.');
  // Daily cap per number - SMS costs real money (Twilio). Even at 8/min the
  // per-minute limit alone would allow thousands/day; this bounds the bill.
  const smsDayName = `sms:day:${from}:${todayKey()}`;
  const smsDay = await counter(env, smsDayName, { op: 'reserve', amount: 1, cap: 200, ttlMs: 86400000 * 2 });
  if (!smsDay.allowed) return twiml('You\u2019ve reached today\u2019s message limit. It resets tomorrow.');

  /* Monthly cost backstop - SMS shares the account's profit-safe ceiling.

     This used to be skipped entirely when the price was zero, which is exactly
     the case that needed it: a FREE account could run an agent turn per inbound
     message with no dollar ceiling at all, bounded only by 200 messages a day
     per number. Every plan gets a ceiling now, and a free one gets the same
     small real budget its automations get rather than an unlimited one.

     Keyed by the billing subject so a team's messages come out of the team's
     budget (AMV-100), which is also the only reading under which the seat the
     team paid for is the thing being spent. */
  const price = _planPriceUSD(user.plan, user.customCfg);
  const smsBook = {};
  {
    /* THROUGH THE ONE GATE, like every other path that spends.

       This used to do half of _spendGate's job inline: it asked the account's
       monthly ceiling and never asked the DAY'S. So the control that exists to
       stop a runaway bill could not see SMS at all, and SMS is the cheapest way
       to produce real concurrency against AMV - a script can post to this
       endpoint as fast as it likes. It also repeated the ceiling arithmetic,
       which is how the family limit came to be missing from it in the first
       place: a rule that lives at each call site is a rule the next call site
       will not have.

       AMV-004: booked, not read. Reserved at the tier's published rate for a
       full-length reply, settled below to what the turn really cost.

       The free case is passed in rather than looked up, because a free account
       has no plan backstop and the gate would otherwise leave it to the global
       free share alone - which is a budget for everybody, not for one number
       texting in a loop. */
    const smsEng = ENGINES['amv-pulse'];
    const reserveUSD = (SMS_EST_IN_TOK / 1e6) * smsEng.inCost + (SMS_MAX_OUT_TOK / 1e6) * smsEng.outCost;
    const refused = await _spendGate(env, user, 'sms', reserveUSD, smsBook,
                                     { fallbackCeilingUSD: FREE_AUTO_CEILING_USD });
    if (refused) {
      /* The gate answers in JSON because most callers are the web app. Over SMS
         the only thing that can be sent is a sentence, so the code is turned
         back into one here rather than a customer receiving a status number. */
      let code = '';
      try { code = (await refused.clone().json()).code || ''; } catch (e) {}
      if (code === 'account_blocked')
        return twiml('This account is on hold and cannot use paid features. Contact support if you think that is wrong.');
      if (code === 'family_cap')
        return twiml('You\u2019ve used the monthly limit set for your account. It resets next month, or whoever manages your family can raise it.');
      if (code === 'global_cap' || code === 'free_capacity')
        return twiml('AMV is unusually busy right now. Try again shortly.');
      return twiml(price > 0
        ? 'You\u2019ve used your plan\u2019s allowance for this cycle. It resets next month.'
        : 'You\u2019ve used what the free plan covers for texting this month. Upgrade for more, or it resets next month.');
    }
  }

  /* AMV-003 (second half): THE CEILING WAS CHECKED AND NEVER FED.

     The block above asks whether this account is under its monthly dollar
     ceiling. Nothing below ever told the counter that an SMS turn had cost
     anything, so the answer was always computed from web spend alone. An
     account that used AMV only by text had a cost counter of exactly zero for
     ever, and the ceiling it is measured against could never be reached.

     What actually bounded the bill was `sms:day` - 200 messages per number per
     day - which is a message count, not money, and does not care how many
     numbers are linked. Checking a limit while never incrementing it is the
     same defect as the wash-trading signal that read a field nobody wrote: it
     reads as a control and cannot fire.

     Recorded through _recordSpend like chat and the widget, so it lands in
     the account ceiling, the day's global spend, the platform total and the
     per-feature split - and 'sms' becomes a line the owner can see rather than
     a cost hidden inside somebody else's total. */
  let reply;
  let smsUsage = null;
  try {
    const out = await runSmsAgent(text, env);
    reply = out.text;
    smsUsage = out.usage;
  } catch (err) {
    reply = 'Something went wrong handling that. Try again in a moment.';
  }
  if (smsUsage) {
    const eng = ENGINES['amv-pulse'];
    const usd = (smsUsage.input / 1e6) * eng.inCost + (smsUsage.output / 1e6) * eng.outCost;
    await _recordSpend(env, user.billingSubject || email, usd, 'sms', smsBook.period,
                       smsBook);
  } else {
    /* The turn failed, so there is nothing to settle against - hand the whole
       reservation back rather than leaving somebody's allowance holding money
       for an answer they never got. Both halves, since the gate books the
       day's ceiling as well as the account's. */
    await _releaseSpendGate(env, smsBook);
  }
  // SMS segments are 160 chars; keep replies tight
  if (reply.length > 600) reply = reply.slice(0, 590) + '…';
  return twiml(reply);
}

async function runSmsAgent(text, env) {
  const sys = 'You are AMV over SMS. Reply in plain text, no markdown, concise (a few sentences max, fits in a text message). The user may ask you to check tasks, summarize, draft, or answer questions. Be direct and useful. Never use em or en dashes; use a plain hyphen (-) instead. ACCURACY: never invent facts, numbers, prices, dates or sources, and never say you did something (checked, sent, booked, completed) unless it actually happened. If you are unsure or cannot verify, say so briefly instead of guessing.';
  const resp = await _modelFetch(env, {
    model: engineModel('amv-pulse'), // cheapest tier - SMS is short Q&A
    /* The same constant the pre-flight reservation prices against. Two literals
       would drift, and the one that drifts silently is the reservation - it
       would simply stop matching what a turn can cost. */
    max_tokens: SMS_MAX_OUT_TOK,
    system: sys,
    messages: [{ role: 'user', content: text }],
  });
  const data = await resp.json();
  /* Returns what it cost as well as what it said. The caller cannot price a
     turn it has no token counts for, and this is the only place they exist. */
  const u = data.usage || {};
  return {
    text: (data.content || []).map(b => b.text || '').join('').trim() || 'No response.',
    usage: { input: +u.input_tokens || 0, output: +u.output_tokens || 0 },
  };
}

function normalizePhone(p) {
  // Strip everything except digits and a leading '+', then validate as E.164.
  let d = String(p || '').trim().replace(/[^\d+]/g, '');
  if (!d) return '';
  // collapse any '+' that isn't the leading char
  const hasPlus = d.startsWith('+');
  d = (hasPlus ? '+' : '') + d.replace(/\+/g, '');
