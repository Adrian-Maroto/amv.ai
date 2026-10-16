  form.set('metadata[plan]', plan);
  if (plan === 'team') {
    form.set('metadata[seats]', String(seats));
    // let the customer change the seat count from Stripe's own portal too
    form.set('subscription_data[metadata][email]', user.email);
    form.set('subscription_data[metadata][plan]', 'team');
  }

  const r = await fetchDeadline('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const d = await r.json();
  if (!r.ok) {
    // A customer just tried to PAY and Stripe refused. That's lost revenue you
    // need to know about now, not from a support ticket. Throttled so a Stripe
    // outage doesn't spam you.
    await alertOnce(env, 'stripe_checkout_fail', `💳 Stripe checkout failing: ${d.error?.message || 'unknown'} - customers may be unable to subscribe.`, 15);
    return json({ error: d.error?.message || 'stripe error' }, 502);
  }
  /* Remembered until the webhook grants the plan. A dropped delivery would
     otherwise leave somebody who has paid sitting on the free tier with
     nothing watching, so the sweep asks Stripe directly. */
  await _pendStart(env, d.id, { provider:'stripe', kind:'plan', email:user.email, plan });
  return json({ url: d.url, id: d.id });
}

// ---- Stripe: customer billing portal (manage/cancel subscription) ----
async function stripePortal(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const sp = await guardAction(env, `stripepo:${user.email}`, 10, 100, 'billing portal sessions');
  if (sp) return sp;
  /* Same fact, same words as the checkout route above. */
  if (!env.STRIPE_SECRET_KEY)
    return json({ error: 'Payments are not connected on this deployment yet, so the billing portal cannot open.',
                  code: 'needs_service' }, 503);
  const custId = await env.AMV_KV.get(`stripecust:${user.email}`);
  if (!custId) return json({ error: 'no subscription found' }, 404);
  // AMV-025 / AMV-SP-09: the server-configured origin is authoritative for
  // payment redirects, and there is no fallback to the request Origin.
  const origin = _paymentReturnOrigin(env);
  if (!origin) return _paymentOriginMissing();
  const form = new URLSearchParams({ customer: custId, return_url: origin });
  const r = await fetchDeadline('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const d = await r.json();
  if (!r.ok) return json({ error: d.error?.message || 'stripe error' }, 502);
  return json({ url: d.url });
}

/* ---- Stripe: turn auto-renew off, or back on ----

   A subscription renews by itself; that is what a subscription is. So "auto
   renew" is really one question - does this one stop at the end of the period
   it is already paid for - and Stripe answers it with a single field,
   `cancel_at_period_end`. This route writes that field and nothing else.

   WHY NOT JUST SEND THEM TO THE PORTAL. The billing portal is there and stays
   there, but it is a page somewhere else that has to be configured in the
   Stripe dashboard before it opens at all, and it cannot answer the question
   on AMV's own screen. This can, and more importantly the result is READ BACK:
   what gets written to the entitlement is what Stripe's response says the
   subscription now is, not what was asked for. An action AMV cannot read back
   is an action AMV cannot claim.

   WHOSE SUBSCRIPTION. `subId` is put on the entitlement by the webhook for
   this account, so it is this account's by construction - but "by
   construction" is how an IDOR gets written. The customer on Stripe's response
   is compared against the customer id stored for this email, and a mismatch is
   refused and audited rather than quietly corrected. Nothing about the
   subscription is taken from the request: the body carries one boolean.

   NOTHING IS CHARGED OR REFUNDED HERE. Turning it off leaves the plan running
   to the end of the period already paid for; turning it back on resumes the
   schedule. That is why off is reversible right up to the last day, and the
   response says when that day is. */
/* ══════════════════════════════════════════════════════════════════════════
   CALENDARS THAT ARE NOT GOOGLE OR OUTLOOK.

   Calendar support was two providers, and both of them are the ones a
   particular kind of office uses. Everywhere else - iCloud on a phone, a
   Fastmail or Zoho account, a Nextcloud a co-op runs itself, Yandex across
   Russia and Central Asia, a university timetable, a league fixture list,
   national holidays - publishes a feed instead, and AMV could read none of it.
   Saying "connect your calendar" to somebody whose calendar is one of those
   is telling them the product is not for them.

   A SUBSCRIPTION, NOT A LOGIN, AND THAT IS THE RIGHT TRADE HERE. A feed URL
   is read-only by construction: it cannot create, move or delete anything,
   and losing it loses a view of somebody's week rather than control of it.
   What AMV does with a calendar is READ - the week ahead, what collides, what
   needs preparing - so read-only costs nothing it was using, and a password
   would buy write access nobody asked for at a far worse price if it leaked.

   The URL is a secret even so: for most providers it is unguessable and
   whoever holds it can see the calendar. So it is stored sealed with the same
   deployment key the mailbox passwords use, never returned to the browser
   after it is saved, and shown back only as the host it points at.
   ══════════════════════════════════════════════════════════════════════════ */

/* Where somebody finds the feed, per provider. Not a list of hosts to connect
   to - any of them can be typed by hand - but the instruction that turns "I
   don't know where to get that" into thirty seconds of clicking. */
const CAL_FEED_PROVIDERS = {
  icloud:    { name: 'Apple iCloud', flag: '🌍',
               how: 'On iCloud.com open Calendar, click the radio icon beside the calendar name, tick Public Calendar and copy the link. It starts webcal:// - paste it as it is.' },
  fastmail:  { name: 'Fastmail', flag: '🌍',
               how: 'In Fastmail go to Settings, Calendars, pick the calendar, then Sharing, and copy the secret address under Subscribe.' },
  nextcloud: { name: 'Nextcloud / ownCloud', flag: '🌍',
               how: 'Open Calendar, click the three dots beside the calendar, choose Copy subscription link. Works with any Nextcloud, including one you run yourself.' },
  yandex:    { name: 'Yandex Calendar (Яндекс Календарь)', flag: '🇷🇺',
               how: 'In Yandex Calendar open the calendar list, choose the calendar, then Export, and copy the iCal link.' },
  zoho:      { name: 'Zoho Calendar', flag: '🇮🇳',
               how: 'In Zoho Calendar go to Settings, My Calendars, pick the calendar, then Share, and copy the Private Address in iCal format.' },
  mailru:    { name: 'Mail.ru Calendar (Календарь Mail.ru)', flag: '🇷🇺',
               how: 'In Mail.ru Calendar open the calendar settings and copy the export link (ссылка для экспорта).' },
  proton:    { name: 'Proton Calendar', flag: '🇨🇭',
               how: 'In Proton Calendar go to Settings, Calendars, choose Share, and copy the link under Share with anyone.' },
  posteo:    { name: 'Posteo', flag: '🇩🇪',
               how: 'In Posteo open Calendar, then the calendar’s settings, and copy the published iCal address.' },
  generic:   { name: 'Any other calendar', flag: '🌍',
               how: 'Almost every calendar can publish a link ending in .ics - look for Export, Subscribe, Publish or "secret address". A university timetable, a fixture list or a holiday calendar works the same way.' },
};

const CAL_MAX_FEEDS = 8;
const CAL_MAX_ICS_BYTES = 2 * 1024 * 1024;

/* `webcal://` is the same URL over https and nothing else. Every Apple
   instruction in the world says to copy a webcal link, so refusing it would
   make the most common case look broken for a scheme difference. */
function _calNormalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (/^webcal:\/\//i.test(u)) u = 'https://' + u.slice(9);
  return u;
}

/* One line of an ICS file, unfolded and unescaped. The format wraps at 75
   octets with a leading space, so a summary longer than that arrives in
   pieces and reads as truncated unless it is put back together. */
function _icsUnfold(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}
function _icsValue(v) {
  return String(v || '').replace(/\\n/gi, ' ').replace(/\\,/g, ',')
                        .replace(/\;/g, ';').replace(/\\\\/g, '\\').trim();
}
/* ICS times come as 20260115T090000Z, as a floating local time, or as a bare
   date for an all-day event. Anything unparseable returns null and the event
   is dropped rather than dated to 1970 - a wrong date in a calendar is worse
   than a missing one, because it gets acted on. */
function _icsDate(v) {
  const raw = String(v || '').trim();
  let m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (m) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return Number.isFinite(t) ? t : null;
  }
  m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/* Events inside a window, from one feed's text. Bounded on purpose: a public
   holiday feed carries decades of entries and nobody asked for 2043. */
function _icsEvents(text, fromMs, toMs, limit) {
  const out = [];
  const body = _icsUnfold(text);
  const blocks = body.split('BEGIN:VEVENT').slice(1);
  for (const b of blocks) {
    const chunk = b.split('END:VEVENT')[0];
    const get = (k) => {
      const m = chunk.match(new RegExp('^' + k + '(?:;[^:\\n]*)?:(.*)$', 'mi'));
      return m ? _icsValue(m[1]) : '';
    };
    const start = _icsDate(get('DTSTART'));
    if (start === null) continue;                    // undated: dropped, never guessed
    if (start < fromMs || start > toMs) continue;
    const end = _icsDate(get('DTEND'));
    out.push({
      title: get('SUMMARY').slice(0, 200) || '(no title)',
      start, end: end === null ? null : end,
      location: get('LOCATION').slice(0, 200),
      allDay: /^\d{8}$/.test((chunk.match(/^DTSTART(?:;[^:\n]*)?:(.*)$/mi) || [, ''])[1].trim()),
    });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a.start - b.start);
}

async function calFeedAdd(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in first', code: 'needs_auth' }, 401);
  const blocked = await guardAction(env, 'caladd:' + user.email, 20, 900, 'calendar subscriptions');
  if (blocked) return blocked;
  /* The URL is a secret for most providers, so it is sealed - and refusing to
     store one at all is the honest answer on a deployment that cannot. */
  if (!(await _mailCredKey(env))) {
    return json({ error: 'AMV cannot store a calendar link safely on this deployment yet, so it will not store one at all. MAIL_CRED_KEY has to be set first.',
                  code: 'needs_service' }, 503);
  }

  const body = await request.json().catch(() => ({}));
  const url = _calNormalizeUrl(body.url);
  const label = String(body.label || '').slice(0, 60);

  /* The SAME gate the browsing agent uses, rather than a second one written
     here. A user-supplied URL that the SERVER fetches is the textbook shape of
     an SSRF, and the difference between the two gates would be the hole. */
  const gate = _webHostAllowed(url);
  if (!gate.ok) return json({ error: gate.why, code: 'bad_url' }, 400);

  const rec = (await DB.get(env, 'cal', user.email)) || { feeds: [] };
