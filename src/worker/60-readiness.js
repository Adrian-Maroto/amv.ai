/* =====================================================================
   AMV-084  GO-LIVE READINESS - what is actually switched on

   The Go-Live screen was a list of guesses made in the browser. Three of its
   rows were hardcoded to "not set up" whatever the truth was, and the row for
   the AI engine reported whether THIS BROWSER had a session - which says
   nothing at all about whether the Worker holds an API key. So the one screen
   whose entire job is to tell the owner whether the product is real could not
   see a single server secret, and confidently said so.

   This reports the truth from the only place that knows it. It returns
   whether each secret EXISTS - never a value, never a prefix, never a length,
   because a screen that leaks the shape of a key is worse than one that
   guesses. Each entry also carries what it turns on and the exact command to
   set it, so "not set up" is a next action rather than a verdict.
   ===================================================================== */

/* Present and non-empty. A secret set to the empty string is not configured,
   and treating it as configured is how a deploy silently half-works. */
function _has(env, name) { return !!String((env && env[name]) || '').trim(); }

/* The Worker's own name, so the dashboard path below points at the thing this
   code is running as rather than at a guess. It matches `name` in
   wrangler.toml; a deployment that renamed one and not the other would send
   somebody to a page that is not theirs. */
const WORKER_NAME = 'amv-ai';

function _readinessReport(env, seen) {
  seen = seen || {};
  /* AN INSTRUCTION THE READER CAN ACTUALLY CARRY OUT.

     Every row said `wrangler secret put NAME`. That is correct and it is
     useless to the person this screen exists for: setting a secret needs Node
     and a terminal, and this deployment's owner is on a managed laptop that
     cannot install either - which is exactly why the deploy runs in CI rather
     than from a machine.

     So the screen named the one thing blocking the entire product, marked it
     blocking, and then gave a way out that required software the reader does
     not have. That is LESSONS 349 again - the launch checklist that told
     somebody to buy things AMV cannot use - and the same rule applies: a
     document that tells you to DO something is code with a slower compiler,
     and an instruction nobody can follow is a bug.

     The dashboard route comes first because it needs nothing but a browser.
     The command stays, second, for whoever does have a terminal - dropping it
     would trade one unusable instruction for another. The Worker name is the
     one in wrangler.toml, so the path is the real path and not a guess. */
  const put = (n, hint) =>
    'Cloudflare dashboard > Workers & Pages > ' + WORKER_NAME
    + ' > Settings > Variables and Secrets > Add > type Secret, named ' + n
    + (hint ? ' (value: ' + hint + ')' : '')
    + '. With a terminal instead: wrangler secret put ' + n;
  /* `blocking` means the product does not do its core job without it.
     Everything else is a real feature that degrades honestly. */
  const items = [
    { id: 'ai', name: 'AI engine', blocking: true, on: !!_modelKey(env),
      turnsOn: 'Every answer, agent, build, document and scheduled task.',
      how: put('AMV_MODEL_KEY') },
    { id: 'auth', name: 'Accounts and sessions', blocking: true, on: _has(env, 'JWT_SECRET'),
      turnsOn: 'Sign-in, sync and every authenticated route. Without it no token can be issued or verified.',
      how: put('JWT_SECRET') },
    { id: 'admin', name: 'Operator access', blocking: false, on: _has(env, 'ADMIN_TOKEN'),
      turnsOn: 'The founder dashboard, platform stats, the kill switch and the weekly digest.',
      how: put('ADMIN_TOKEN') },
    { id: 'ownerEmail', name: 'Owner address', blocking: false, on: _has(env, 'OWNER_EMAIL'),
      turnsOn: 'The weekly digest, and operator privileges for that account.',
      how: put('OWNER_EMAIL') },
    /* Not green while the provider is refusing every message: a key that is
       set and a key that delivers are different facts, and the screen showed
       this row live directly above the row saying nothing was delivered. */
    { id: 'email', name: 'Email delivery', blocking: false, on: _has(env, 'EMAIL_API_KEY') && !seen.senderRefused,
      ...(seen.senderRefused ? { problem: 'The key works, but the provider is refusing the sender - see "Email actually reaches people" below.' } : {}),
      turnsOn: 'Password resets, the weekly digest, and automation results reaching an inbox instead of only the app.',
      how: put('EMAIL_API_KEY') },
    /* AMV-193: CONFIGURED IS NOT THE SAME AS DELIVERABLE.
       The line above goes green the moment a Resend key exists. But the default
       sender is onboarding@resend.dev, which Resend only delivers to the
       address that owns the Resend account - so with a key and no verified
       domain, password resets reach the operator and NOBODY ELSE. Every other
       person who forgets their password is locked out for good, and the screen
       that exists to say what works reported email as on.
       Preflight warns about this; a running deployment could not see it. */
    /* Set is not the same as accepted: the provider can refuse the sender's
       domain outright, and then the sign-in code, every reset and every other
       email fail for everyone. Its own words are shown when it has. */
    { id: 'emailSender', name: 'Email actually reaches people', blocking: false,
      on: _has(env, 'EMAIL_API_KEY') && _has(env, 'RESET_EMAIL_FROM') && !seen.senderRefused,
      ...(seen.senderRefused ? { problem: 'The email provider refuses this sender: ' + String(seen.senderRefused.said || '').slice(0, 240)
        + ' Until the domain is verified there, nobody receives mail and sign-in codes are skipped.' } : {}),
      turnsOn: 'Mail to anyone other than you - the sign-in code that proves an address and a new device, password resets, Crew results by email, and "email me when AMV is done". '
             + 'Without a sender on a domain you have verified, the default address only delivers to the owner of the '
             + 'email account, so AMV offers none of those to anybody else until this is set.',
      /* Refused is fixed at the provider, not here: the secret is already set,
         and telling the operator to set it again sent them to the wrong place. */
      how: seen.senderRefused
        ? 'In Resend: Domains > Add Domain > ' + ((/@([^>\s]+)/.exec(String(env.RESET_EMAIL_FROM || '')) || [])[1] || 'your domain')
          + ' > add the DNS records it shows (or "Sign in to Cloudflare" to add them for you) > Verify. Then press "Send me a test email" below.'
        : put('RESET_EMAIL_FROM') },
    { id: 'appUrl', name: 'App address', blocking: false, on: _has(env, 'APP_URL'),
      turnsOn: 'Correct links in every email, invite links, and shared conversation URLs.',
      how: put('APP_URL') },
    { id: 'payments', name: 'Payments', blocking: false, on: _has(env, 'STRIPE_SECRET_KEY'),
      turnsOn: 'Checkout, subscriptions and the billing portal. Nobody can pay you without it.',
      how: put('STRIPE_SECRET_KEY') },
    /* BLOCKING once payments are switched on, and only then. A deployment not
       selling anything yet does not need a webhook; one that IS selling and
       has no webhook is the worse half of a broken pair. Nothing else grants a
       plan on payment, and nothing else revokes one on cancellation, refund or
       chargeback - so money arrives and nobody gets what they bought, while
       anybody who ever did get a plan keeps it for ever. Taking payments with
       no way to end what they bought is the one configuration that can put a
       deployment in front of a customer's bank. */
    { id: 'paymentsHook', name: 'Payment webhooks', blocking: _has(env, 'STRIPE_SECRET_KEY'),
      on: _has(env, 'STRIPE_WEBHOOK_SECRET'),
      turnsOn: _has(env, 'STRIPE_SECRET_KEY') && !_has(env, 'STRIPE_WEBHOOK_SECRET')
        ? 'REQUIRED NOW - you are taking payments without it. Nothing grants a plan when somebody pays, and nothing revokes one when they cancel, are refunded, or charge back. The daily renewal sweep is a backstop, not a substitute.'
        : 'Plans granted on payment, and revoked on cancellation, refund or chargeback. Without it a payment never reaches the account that made it.',
      how: put('STRIPE_WEBHOOK_SECRET') },
    { id: 'modelFallback', name: 'Model failover', blocking: false, on: _has(env, 'MODEL_API_FALLBACK_URL'),
      turnsOn: 'A second endpoint AMV falls back to when the primary cannot answer. Non-streaming requests are retried there; a stream that already sent words is never retried, because repeating them is worse than an honest error. It is sent the same key in the same format as the primary, so it must be an address that accepts that key - a gateway or another region of the same service, not a different provider.',
      how: put('MODEL_API_FALLBACK_URL') },
    /* THE SECRET THAT DECIDES WHETHER TOKENS ARE STORED IN THE CLEAR.

       Not blocking, because AMV is fully usable without connected accounts and
       refusing to boot over an optional feature would be the wrong trade. It is
       listed loudly instead: without it, connecting is refused outright rather
       than falling back to plaintext storage, which is the only degradation
       that would actually be dishonest here. */
    { id: 'connectKey', name: 'Connected accounts (encryption)', blocking: false,
      on: _has(env, 'CONNECT_KEY'),
      turnsOn: 'Holding account tokens so Crew jobs run with the tab closed. The key seals every stored token with AES-GCM, so a stolen copy of the database is ciphertext rather than mailboxes. Without it AMV refuses to connect an account at all - it will not store a token unencrypted.',
      how: put('CONNECT_KEY') },
    /* A ROTATION IN PROGRESS IS A STATE, AND STATES BELONG ON THIS SCREEN.

       CONNECT_KEY_PREV being set is not a missing capability - it is a rotation
       that has started and has not finished. Left off this list, the only way
       to know AMV is still able to read records sealed under an old secret
       would be to remember setting it, and the whole point of the screen is
       that nothing about the deployment is only in somebody's head. It reports
       "on" when it is ABSENT, because absent is the settled state. */
    { id: 'connectKeyPrev', name: 'Connected accounts (key rotation)', blocking: false,
      on: !_has(env, 'CONNECT_KEY_PREV'),
      turnsOn: _has(env, 'CONNECT_KEY_PREV')
        ? 'A ROTATION IS IN PROGRESS. CONNECT_KEY_PREV is set, so records sealed under the previous key can still be read; each one re-seals under the current key the next time it is used. Remove CONNECT_KEY_PREV once every connection has been used, and check the audit log for conn_resealed before you do.'
        : 'Nothing to do - no rotation is in progress. To rotate: put the new value in CONNECT_KEY and the old one in CONNECT_KEY_PREV, leave it a while, then remove CONNECT_KEY_PREV. Rotating without it makes every stored connection unreadable and every customer reconnect every account.',
      how: 'Only during a rotation: ' + put('CONNECT_KEY_PREV') },
    /* Each provider is its own line, because "connected accounts is on" is not
       a thing - Google can be live while Microsoft is dark, and the operator
       needs to see which. */
    { id: 'connectGoogle', name: 'Connect Google', blocking: false,
      on: _has(env, 'GOOGLE_CLIENT_ID') && _has(env, 'GOOGLE_CLIENT_SECRET'),
      turnsOn: 'Gmail, Calendar and Drive as connected accounts. Needs an app registered with Google and both halves pasted here; until then Google shows as not set up rather than opening a flow that fails.',
      how: put('GOOGLE_CLIENT_ID') + ' and ' + put('GOOGLE_CLIENT_SECRET') },
    { id: 'googlePicker', name: 'Edit the Google Docs and Sheets people choose', blocking: false,
      on: _has(env, 'GOOGLE_CLIENT_ID') && _has(env, 'GOOGLE_PICKER_API_KEY') && /^\d{6,20}$/.test(String(env.GOOGLE_PROJECT_NUMBER || '').trim()),
      turnsOn: 'Google\u2019s own file picker, so somebody can hand AMV one Doc or Sheet to read and edit - and only that one. Until then AMV edits only the Google files it made itself.',
      how: put('GOOGLE_PICKER_API_KEY') + ' (a browser key with the Picker API, limited to your site) and ' + put('GOOGLE_PROJECT_NUMBER') + ' (the number of the same Google Cloud project as GOOGLE_CLIENT_ID)' },
    { id: 'cloudComputer', name: 'AMV\u2019s cloud workspace', blocking: false,
      on: _computerOn(env),
      turnsOn: 'A computer of their own in AMV\u2019s cloud for Pro plans and above - the same commands and files as connecting their own, without installing anything. One container each, asleep after five idle minutes and cleared when it sleeps; the minutes it is awake count against the plan (Pro 600, Elite 3,000, Ultra 6,000 a month).',
      how: 'deploy the cloud/ folder (needs Workers Paid with Containers), then ' + put('AMV_COMPUTER_KEY') + ' (32+ random characters, the same in both Workers) and uncomment the AMV_COMPUTER binding in wrangler.toml' },
    { id: 'connectMicrosoft', name: 'Connect Microsoft', blocking: false,
      on: _has(env, 'MS_CLIENT_ID') && _has(env, 'MS_CLIENT_SECRET'),
      turnsOn: 'Outlook mail and calendar as connected accounts.',
      how: put('MS_CLIENT_ID') + ' and ' + put('MS_CLIENT_SECRET') },
    { id: 'teamSeats', name: 'Teams (per-seat billing)', blocking: false, on: _has(env, 'STRIPE_PRICE_TEAM_SEAT'),
      turnsOn: 'Selling Teams by the seat at $' + TEAM_SEAT_PRICE_USD + '/seat/month. Without it Teams is still usable on Elite and Ultra, and the per-seat plan says it is not switched on rather than failing at checkout.',
      how: put('STRIPE_PRICE_TEAM_SEAT') },
    /* BOTH halves, deliberately. This line used to read TURNSTILE_SECRET alone
       and report "on", which is the one answer that is never true: the secret
       verifies a token, the SITE KEY is what renders the widget that produces
       one. With only the secret set, no browser can produce a token, so the
       captcha is skipped rather than refusing every sign-up - and this line is
       how an operator finds out it is skipped. */
    { id: 'captcha', name: 'Signup verification (Turnstile)', blocking: false,
      on: _has(env, 'TURNSTILE_SECRET') && _has(env, 'TURNSTILE_SITE_KEY'),
      turnsOn: _has(env, 'TURNSTILE_SECRET') && !_has(env, 'TURNSTILE_SITE_KEY')
        ? 'HALF SET UP - the secret is set but the site key is not, so no browser can produce a token. The captcha is being SKIPPED rather than blocking every sign-up; only the honeypot and rate limits apply. Set TURNSTILE_SITE_KEY to switch it on.'
        : 'Bot protection on signup and sign-in. Needs BOTH halves: the secret verifies here, the site key renders the widget in the browser. Until they are set, only the honeypot and rate limits apply.',
      how: put('TURNSTILE_SITE_KEY') + ' and ' + put('TURNSTILE_SECRET') },
    { id: 'googleAuth', name: 'Google sign-in', blocking: false, on: _has(env, 'GOOGLE_CLIENT_ID'),
      turnsOn: 'Sign in with Google. It fails closed until set, rather than trusting an unverified token.',
      how: put('GOOGLE_CLIENT_ID') },
    { id: 'alerts', name: 'Operator alerts', blocking: false, on: _has(env, 'ALERT_WEBHOOK'),
      turnsOn: 'Being paged when spend caps are hit, checkout breaks, or the model rejects a request.',
      how: put('ALERT_WEBHOOK') },

    /* =================================================================
       AMV-402  THE THIRTY CAPABILITIES THIS SCREEN COULD NOT SEE

       Everything below was already BUILT and reachable in the Worker, and
       none of it had a line here. The screen listed sixteen things; the
       Worker read forty-nine names. So the one screen whose entire job is
       to say what this deployment can do was silent about GitHub connect,
       every PayPal path, text messages, the three Stripe price ids, error
       reporting, product analytics, the audit stream, bank connections and
       the key that lets a mailbox credential be stored at all.

       That is worse than a screen with gaps. An operator reading "Core
       product is live, 2 optional capabilities are still off" reasonably
       concludes there are two things left to do. There were thirty-two,
       and the ones missing included the three price ids without which the
       Payments row goes green and nobody can actually buy anything.

       A stage in the gate now fails when a name the Worker reads has no
       row here, so this cannot drift again by anybody adding a capability
       and forgetting this file.
       ================================================================= */

    /* PAYMENTS GREEN AND NOTHING BUYABLE.

       STRIPE_SECRET_KEY alone turns the Payments row green. Checkout then
       refuses every plan, honestly and by name, because the price id was
       never set - which is the right refusal at the endpoint and the wrong
       thing to learn from a customer. Same shape as the Turnstile and
       Resend rows above: the capability is half-configured, and the half
       that is missing is the half that takes the money. */
    { id: 'stripePrices', name: 'Plan prices (Stripe)', blocking: false,
      on: _has(env, 'STRIPE_PRICE_PRO') && _has(env, 'STRIPE_PRICE_ELITE') && _has(env, 'STRIPE_PRICE_ULTRA'),
      turnsOn: (_has(env, 'STRIPE_SECRET_KEY')
        && !(_has(env, 'STRIPE_PRICE_PRO') && _has(env, 'STRIPE_PRICE_ELITE') && _has(env, 'STRIPE_PRICE_ULTRA')))
        ? 'REQUIRED NOW - payments are switched on but at least one plan has no price, so choosing it at checkout is refused. Nothing is charged and the refusal says why, but the plan is on your own pricing page and cannot be bought.'
        : 'Buying Pro, Elite and Ultra. Each is a price object created once in the Stripe dashboard; without its id that plan cannot be sold even though payments are on.',
      how: put('STRIPE_PRICE_PRO') + ', ' + put('STRIPE_PRICE_ELITE') + ' and ' + put('STRIPE_PRICE_ULTRA') },

    /* YEARLY IS OPTIONAL, AND THE ROW SAYS SO RATHER THAN LOOKING BROKEN.

       Monthly is what the product must be able to sell; yearly is a second
       recurring price per plan and a deployment without them sells monthly
       exactly as before. So this is never "REQUIRED NOW" - an amber row for a
       thing nobody has to do is how an operator learns to ignore amber rows.

       The page only offers the yearly choice for plans that HAVE a yearly
       price, which is why this row matters at all: with none set, the toggle
       is simply absent and nobody is walked into a refusal. Half-set is the
       state worth seeing here - Pro yearly but not Elite means one card on the
       pricing page can be bought by the year and the others cannot, for a
       reason that is invisible from the outside. */
    { id: 'stripePricesYearly', name: 'Yearly plan prices (Stripe)', blocking: false,
      on: _has(env, 'STRIPE_PRICE_PRO_YEAR') && _has(env, 'STRIPE_PRICE_ELITE_YEAR') && _has(env, 'STRIPE_PRICE_ULTRA_YEAR'),
      turnsOn: 'Buying a plan by the year instead of by the month. Each is a second price object on the same product in Stripe, with a yearly interval - AMV never computes a yearly amount of its own, it opens checkout with whichever price you created, so the discount is whatever you set it to. Plans with no yearly price are simply not offered yearly.',
      how: put('STRIPE_PRICE_PRO_YEAR') + ', ' + put('STRIPE_PRICE_ELITE_YEAR') + ' and ' + put('STRIPE_PRICE_ULTRA_YEAR')
           + ' (and ' + put('STRIPE_PRICE_TEAM_SEAT_YEAR') + ' for Teams)' },

    { id: 'paypal', name: 'PayPal', blocking: false,
      on: _has(env, 'PAYPAL_CLIENT_ID') && _has(env, 'PAYPAL_SECRET'),
      turnsOn: 'A second way to pay, for people who will not hand over a card. Needs an app in the PayPal developer dashboard; both halves, or the checkout says PayPal is not set up rather than opening a flow that fails.',
      how: put('PAYPAL_CLIENT_ID') + ' and ' + put('PAYPAL_SECRET') },

    { id: 'paypalPlans', name: 'PayPal plan ids', blocking: false,
      on: _has(env, 'PAYPAL_PLAN_PRO') && _has(env, 'PAYPAL_PLAN_ELITE') && _has(env, 'PAYPAL_PLAN_ULTRA'),
      turnsOn: 'Which PayPal billing plan each AMV plan maps to, in both directions - starting a subscription, and recognising which plan a webhook is about. Without them PayPal can take a payment it cannot attribute.',
      how: put('PAYPAL_PLAN_PRO') + ', ' + put('PAYPAL_PLAN_ELITE') + ' and ' + put('PAYPAL_PLAN_ULTRA') },

    /* The PayPal half of the Stripe webhook row, and blocking for the same
       reason: a subscription nothing can cancel is the configuration that
       ends up in front of somebody's bank. */
    { id: 'paypalHook', name: 'PayPal webhooks', blocking: _has(env, 'PAYPAL_CLIENT_ID') && _has(env, 'PAYPAL_SECRET'),
      on: _has(env, 'PAYPAL_WEBHOOK_ID'),
      turnsOn: (_has(env, 'PAYPAL_CLIENT_ID') && _has(env, 'PAYPAL_SECRET') && !_has(env, 'PAYPAL_WEBHOOK_ID'))
        ? 'REQUIRED NOW - PayPal is switched on and its webhooks cannot be verified, so every one of them is rejected. A PayPal subscription can start and nothing will ever grant the plan, cancel it, or notice a refund.'
        : 'Verifying that a PayPal webhook really came from PayPal. Plans are granted and revoked from these; an unverified webhook is refused rather than trusted.',
      how: put('PAYPAL_WEBHOOK_ID') },

    /* A STATE, NOT A CAPABILITY - the same shape as the key-rotation row.
       PAYPAL_MODE decides sandbox versus live, it defaults to SANDBOX, and
       a sandbox default is the correct default. It is on this screen
       because "we launched and no PayPal money ever arrived" is the exact
       thing this screen exists to prevent somebody discovering later. It
       reports the MODE, never any value that is a secret - the mode is
       observable from the outside anyway. */
    { id: 'paypalLive', name: 'PayPal is taking real money', blocking: false,
      on: String((env && env.PAYPAL_MODE) || '') === 'live',
      turnsOn: String((env && env.PAYPAL_MODE) || '') === 'live'
        ? 'PayPal is pointed at the live API. Real money moves.'
        : 'PayPal is in SANDBOX, which is the default. Checkouts complete against PayPal\u2019s test servers and no real money arrives. Set it to live when you are ready to be paid - only after the webhook above is verified.',
      how: put('PAYPAL_MODE', 'live') },

    { id: 'speech', name: 'Voice: hearing audio and speaking answers', blocking: false,
      on: _speechListenOn(env) || _speechSpeakOn(env),
      turnsOn: 'Transcribing recordings and audio files with timestamps, and answers spoken in a natural voice that can be interrupted - on every browser, in every language the supplier hears. Without it AMV uses the browser\u2019s own voice where there is one, and says audio files cannot be read. Billed per minute heard and per character spoken against the plan allowance, at the prices you set.',
      how: put('AMV_SPEECH_KEY') + '; then, as plain variables: AMV_SPEECH_URL (the supplier\u2019s https base), AMV_SPEECH_LISTEN_MODEL and AMV_SPEECH_LISTEN_USD_PER_MIN for hearing, AMV_SPEECH_VOICE_MODEL, AMV_SPEECH_VOICE and AMV_SPEECH_VOICE_USD_PER_1K_CHARS for speaking. A half without its price stays off.' },
    { id: 'sms', name: 'Text messages', blocking: false,
      on: _has(env, 'TWILIO_ACCOUNT_SID') && _has(env, 'TWILIO_AUTH_TOKEN') && _has(env, 'TWILIO_FROM_NUMBER'),
      turnsOn: 'Sending a result to a phone instead of only to the app. Needs a Twilio account and a number you own, billed per message. All three parts, or nothing sends.',
      how: put('TWILIO_ACCOUNT_SID') + ', ' + put('TWILIO_AUTH_TOKEN') + ' and ' + put('TWILIO_FROM_NUMBER') },

    { id: 'support', name: 'Support address', blocking: false, on: _has(env, 'SUPPORT_EMAIL'),
      turnsOn: 'Where a person reaches a human when AMV cannot help them. Without it the escalation path ends at a screen rather than an inbox.',
      how: put('SUPPORT_EMAIL') },

    { id: 'auditHook', name: 'Audit stream', blocking: false, on: _has(env, 'AUDIT_WEBHOOK'),
      turnsOn: 'High-signal audit events pushed somewhere off this deployment as they happen - so the record of who did what survives losing the deployment itself. Separate from operator alerts, which page you about breakage.',
      how: put('AUDIT_WEBHOOK') },

    /* The apps with a public API and no official connector - one row each,
       because each is switched on separately: registering AMV with Slack does
       nothing for Spotify. Each goes live with an app registered with that
       provider (free) and both halves pasted here; until then its row on the
       Integrations page says it is not set up rather than opening a flow that
       fails. */
    { id: 'connect_slack', name: 'Connect Slack', blocking: false,
      on: _has(env, 'SLACK_CLIENT_ID') && _has(env, 'SLACK_CLIENT_SECRET'),
      turnsOn: _apiAppTurnsOn('Slack'), how: put('SLACK_CLIENT_ID') + ' and ' + put('SLACK_CLIENT_SECRET') },
    { id: 'connect_discord', name: 'Connect Discord', blocking: false,
      on: _has(env, 'DISCORD_CLIENT_ID') && _has(env, 'DISCORD_CLIENT_SECRET'),
      turnsOn: _apiAppTurnsOn('Discord'), how: put('DISCORD_CLIENT_ID') + ' and ' + put('DISCORD_CLIENT_SECRET') },
    { id: 'connect_spotify', name: 'Connect Spotify', blocking: false,
      on: _has(env, 'SPOTIFY_CLIENT_ID') && _has(env, 'SPOTIFY_CLIENT_SECRET'),
      turnsOn: _apiAppTurnsOn('Spotify'), how: put('SPOTIFY_CLIENT_ID') + ' and ' + put('SPOTIFY_CLIENT_SECRET') },
    { id: 'connect_dropbox', name: 'Connect Dropbox', blocking: false,
      on: _has(env, 'DROPBOX_CLIENT_ID') && _has(env, 'DROPBOX_CLIENT_SECRET'),
      turnsOn: _apiAppTurnsOn('Dropbox'), how: put('DROPBOX_CLIENT_ID') + ' and ' + put('DROPBOX_CLIENT_SECRET') },
    { id: 'connect_hubspot', name: 'Connect HubSpot', blocking: false,
      on: _has(env, 'HUBSPOT_CLIENT_ID') && _has(env, 'HUBSPOT_CLIENT_SECRET'),
      turnsOn: _apiAppTurnsOn('HubSpot'), how: put('HUBSPOT_CLIENT_ID') + ' and ' + put('HUBSPOT_CLIENT_SECRET') },
    { id: 'connect_asana', name: 'Connect Asana', blocking: false,
      on: _has(env, 'ASANA_CLIENT_ID') && _has(env, 'ASANA_CLIENT_SECRET'),
      turnsOn: _apiAppTurnsOn('Asana'), how: put('ASANA_CLIENT_ID') + ' and ' + put('ASANA_CLIENT_SECRET') },
    { id: 'connect_zoom', name: 'Connect Zoom', blocking: false,
      on: _has(env, 'ZOOM_CLIENT_ID') && _has(env, 'ZOOM_CLIENT_SECRET'),
      turnsOn: _apiAppTurnsOn('Zoom'), how: put('ZOOM_CLIENT_ID') + ' and ' + put('ZOOM_CLIENT_SECRET') },
    { id: 'connect_box', name: 'Connect Box', blocking: false,
      on: _has(env, 'BOX_CLIENT_ID') && _has(env, 'BOX_CLIENT_SECRET'),
      turnsOn: _apiAppTurnsOn('Box'), how: put('BOX_CLIENT_ID') + ' and ' + put('BOX_CLIENT_SECRET') },
    { id: 'connect_strava', name: 'Connect Strava', blocking: false,
      on: _has(env, 'STRAVA_CLIENT_ID') && _has(env, 'STRAVA_CLIENT_SECRET'),
      turnsOn: _apiAppTurnsOn('Strava'), how: put('STRAVA_CLIENT_ID') + ' and ' + put('STRAVA_CLIENT_SECRET') },
    { id: 'connect_reddit', name: 'Connect Reddit', blocking: false,
      on: _has(env, 'REDDIT_CLIENT_ID') && _has(env, 'REDDIT_CLIENT_SECRET'),
      turnsOn: _apiAppTurnsOn('Reddit'), how: put('REDDIT_CLIENT_ID') + ' and ' + put('REDDIT_CLIENT_SECRET') },
    { id: 'connect_pinterest', name: 'Connect Pinterest', blocking: false,
      on: _has(env, 'PINTEREST_CLIENT_ID') && _has(env, 'PINTEREST_CLIENT_SECRET'),
      turnsOn: _apiAppTurnsOn('Pinterest'), how: put('PINTEREST_CLIENT_ID') + ' and ' + put('PINTEREST_CLIENT_SECRET') },
    { id: 'connect_calendly', name: 'Connect Calendly', blocking: false,
      on: _has(env, 'CALENDLY_CLIENT_ID') && _has(env, 'CALENDLY_CLIENT_SECRET'),
      turnsOn: _apiAppTurnsOn('Calendly'), how: put('CALENDLY_CLIENT_ID') + ' and ' + put('CALENDLY_CLIENT_SECRET') },
    { id: 'connectGithub', name: 'Connect GitHub', blocking: false,
      on: _has(env, 'GH_CLIENT_ID') && _has(env, 'GH_CLIENT_SECRET'),
      turnsOn: 'Repositories as a connected account, so a build can read and write real code. Needs an OAuth app registered with GitHub and both halves pasted here.',
      how: put('GH_CLIENT_ID') + ' and ' + put('GH_CLIENT_SECRET') },

    /* The connected-accounts framework has CONNECT_KEY. The three
       credential connectors that are NOT OAuth - a mailbox, a school, a
       Telegram bot - have this one, and without it they refuse to store a
       credential at all rather than storing it in the clear. Which is the
       right refusal, and the reason it belongs on a screen rather than
       being found by the first person who tries to connect a mailbox. */
    { id: 'mailCredKey', name: 'Stored credentials (encryption)', blocking: false,
      on: _has(env, 'MAIL_CRED_KEY'),
      turnsOn: 'Holding a mailbox password, a school token or a Telegram bot token. Each is sealed with this key; without it those three connectors refuse outright rather than storing a credential unencrypted.',
      how: put('MAIL_CRED_KEY') },

    { id: 'finance', name: 'Bank connections', blocking: false,
      on: _has(env, 'FINANCE_CLIENT_ID') && _has(env, 'FINANCE_SECRET'),
      turnsOn: 'Reading balances and transactions from a connected bank account. Needs an account with a bank-data provider, which is a paid, application-reviewed product, not a key you can self-serve in an afternoon.',
      how: put('FINANCE_CLIENT_ID') + ' and ' + put('FINANCE_SECRET') },

    { id: 'errors', name: 'Error reporting', blocking: false, on: _has(env, 'SENTRY_DSN'),
      turnsOn: 'Server errors reaching you with a stack rather than being counted and forgotten. Without it a crash is only visible as somebody telling you about it.',
      how: put('SENTRY_DSN') },

    { id: 'product', name: 'Product analytics', blocking: false, on: _has(env, 'POSTHOG_KEY'),
      turnsOn: 'Which features are actually used, so a decision to build or cut one is measured. Off by default and it stays off until you set this - nothing is collected in the meantime.',
      how: put('POSTHOG_KEY') },

    /* A STATE ROW. ALLOWED_ORIGIN defaults to '*', which is correct for a
       deployment with an unknown front end and wrong for a launched one:
       it means any site on the internet can call this API from a browser.
       The value is not a secret - it is in a response header on every
       request - so reporting whether it is pinned leaks nothing. */
    /* THE VALUE'S SHAPE IS REPORTED, NOT JUST WHETHER IT IS SET.

       `Access-Control-Allow-Origin` must match the browser's `Origin` header
       character for character, and that header is only ever scheme + host.
       `https://amv.homes/` is what a person types, and it matches nothing - so
       the row that said "pinned" would be describing an API no browser could
       call, on the deployment that had just launched. `_corsOrigin` normalises
       it so the site stays up; this says so, so it gets fixed at the source. */
    { id: 'apiOrigin', name: 'API is pinned to your site', blocking: false,
      on: !!_originOf(env && env.ALLOWED_ORIGIN) && _originOf(env && env.ALLOWED_ORIGIN) !== '*',
      turnsOn: (() => {
        const raw = String((env && env.ALLOWED_ORIGIN) || '');
        const eff = _originOf(raw);
        if (!eff || eff === '*')
          return 'Cross-origin calls are currently allowed from ANY site, which is the default. Every browser-side control still applies and the server is still the authority, but another site can call this API with a visitor\u2019s credentials in the browser. Pin it to your own origin before launch.';
        const line = 'Browser calls to this API are accepted only from ' + eff
          + '. Anything served from a different host - www. against the bare domain, or your host\u2019s own preview address - is refused by the browser, so check the address people actually use.';
        return raw.trim() === eff ? line
          : line + ' NOTE: the value is set to \u201c' + raw + '\u201d, which is not an origin; it is being read as ' + eff
                 + '. Set it to exactly ' + eff + ' - no trailing slash, no path, no spaces.';
      })(),
      how: put('ALLOWED_ORIGIN', 'your site\u2019s origin, exactly - e.g. https://amv.homes, no trailing slash') },
  ];

  /* A PROVIDER'S OWN KEYS ARE HALF OF IT.

     Every Connect row asked only whether that provider's id and secret were
     set - and reported Google, Slack and the rest as "live" on a deployment
     with no CONNECT_KEY, where connStart refuses every one of them because it
     will not store a token unencrypted. The operator read "live", tried it,
     and got "not switched on". Each such row now names the missing key as its
     reason, and is not counted as on until it is set. */
  if (!connConfigured(env)) {
    for (const it of items) {
      if (!/^connect(Google|Microsoft|Github|_)/.test(it.id) || !it.on) continue;
      it.on = false;
      it.blockedBy = 'CONNECT_KEY';
      it.how = 'Its own keys are set - it is waiting for CONNECT_KEY (Connected accounts, encryption), which every connection needs. ' + put('CONNECT_KEY');
    }
  }

  /* Storage is bound, not pasted, so it is reported separately - and what each
     binding buys is a correctness property, not a feature. */
  const storage = [
    { id: 'kv', name: 'KV namespace', on: !!(env && env.AMV_KV),
      turnsOn: 'All persistence. Nothing works without it.', how: 'Bind AMV_KV in wrangler.toml', blocking: true },
    { id: 'cloudLibrary', name: 'Files in the account, on every device', on: libConfigured(env),
      turnsOn: 'The files people send in chat kept in their account, so the phone sees what the laptop uploaded. Limits per plan are enforced here: Free 100 files and 200 MB, Pro 2,000 and 5 GB, Elite 10,000 and 20 GB, Ultra 25,000 and 50 GB. Without it files stay on each device, and the library says so.',
      how: 'Create an R2 bucket named amv-files (Cloudflare dashboard > R2), then bind it as AMV_FILES in wrangler.toml', blocking: false },
    { id: 'jobQueue', name: 'Background work through a queue', on: _jobQueueOn(env),
      turnsOn: 'Each account with work due runs on its own, in parallel, retried with a growing delay, with a dead-letter queue for what keeps failing. Without it the cron tick runs every account in turn inside 25 seconds - fine for thousands of busy accounts, late beyond that, and the tick says so when it runs out of time.',
      how: 'Run `npx wrangler queues create amv-jobs` and `npx wrangler queues create amv-jobs-dead`, then uncomment the queues block in wrangler.toml (binding AMV_JOBS)', blocking: false },
    { id: 'd1', name: 'D1 database', on: DB._hasD1(env),
      turnsOn: 'Guaranteed sync writes: without it two devices saving at the same instant cannot be arbitrated, only merged.',
      how: DB._d1Bound(env)
        ? 'DB is bound but not in use: it becomes the store only when DATA_STORE = "d1" is set, and only after the existing data has been copied into it and checked - otherwise every account would read as empty'
        : 'Bind DB in wrangler.toml, copy the existing data into it, then set DATA_STORE = "d1"', blocking: false },
    /* BLOCKING once money is being taken, and only then - the same shape as
       the payment webhook above and for the same reason.

       Without the Durable Object every `reserve` degrades to a read followed by
       a write. That is the exact race the reservation exists to close: twenty
       requests arriving together all read the same total, all decide they fit,
       and all proceed, so the overshoot is bounded only by how many arrive at
       once. The daily spend ceiling, every plan's token allowance and every
       exactly-once claim are all built on it.

       On a machine with no customers that is a documented degradation and
       refusing to run there would mean AMV does not work without a paid
       Cloudflare plan. On a deployment taking payments it is the difference
       between a bill with a ceiling and a bill without one, and the operator
       has to be told that before the first customer rather than by the
       invoice. */
    { id: 'counter', name: 'Atomic counter', on: !!(env && env.AMV_COUNTER),
      blocking: _has(env, 'STRIPE_SECRET_KEY'),
      turnsOn: (_has(env, 'STRIPE_SECRET_KEY') && !(env && env.AMV_COUNTER))
        ? 'REQUIRED NOW - you are taking payments without it. Every spend ceiling and token allowance falls back to read-then-write, so requests arriving together all pass the same check and the day\u2019s ceiling can be overshot by however many arrive at once. It is the one control standing between AMV and an unbounded bill.'
        : 'Race-free usage limits, spend caps and one-time claims. Without it they are a read followed by a write, which is the race they exist to close.',
      how: 'Bind AMV_COUNTER (the AMVCounter Durable Object) in wrangler.toml' },
    /* Bound rather than pasted, like the three above, which is why it sits
       here and not with the secrets. Without it the two surfaces that need a
       real browser refuse and say so; with it they render a page server-side. */
    { id: 'render', name: 'AMV\u2019s browser (Browser Rendering)', on: !!(env && env.BROWSER), blocking: false,
      turnsOn: 'AMV doing tasks on websites in its own browser, handing it to the person for a sign-in or a check, Teach AMV and Run it now, and turning a live page into a PDF or a screenshot. Without it each of these says it is not switched on rather than pretending.',
      how: 'Workers Paid ($5 a month), then uncomment the [browser] binding (BROWSER) in wrangler.toml' },
    /* Bound, like the rows above. Off is a working state - searches use words
       and the engine's other phrasings - so it never blocks. */
    { id: 'meaning', name: 'Searching by meaning (Workers AI)', on: _meaningOn(env), blocking: false,
      turnsOn: 'File and project searches that find a passage saying the same thing in other words or another language (bge-m3, nothing stored). Without it searches use words and the other phrasings the engine passes.',
      how: 'Uncomment the [ai] binding (AI) in wrangler.toml - Workers AI is on every Cloudflare account' },
  ];

  /* GROUPING, BECAUSE THIRTY-SIX ROWS IN ONE COLUMN IS NOT A SCREEN.

     Kept as a map beside the rows rather than a field on each one, so adding a
     capability is one entry in the list above and one here - and so the gate
     stage can check that every row landed in a real group instead of the
     'Other' bucket, which is how a row goes quietly missing from a heading. */
  const GROUPS = {
    ai: 'Core', auth: 'Core', appUrl: 'Core', admin: 'Core', ownerEmail: 'Core',
    partnerUrl: 'Core', partnerKey: 'Core', partnerEngines: 'Core',
    speech: 'Core', speechUrl: 'Core', speechKey: 'Core', speechListenModel: 'Core', speechListenPrice: 'Core',
    speechVoiceModel: 'Core', speechVoice: 'Core', speechVoicePrice: 'Core',
    payments: 'Taking money', paymentsHook: 'Taking money', stripePrices: 'Taking money',
    stripePricesYearly: 'Taking money',
    teamSeats: 'Taking money', paypal: 'Taking money', paypalPlans: 'Taking money',
    paypalHook: 'Taking money', paypalLive: 'Taking money',
    email: 'Reaching people', emailSender: 'Reaching people', sms: 'Reaching people',
    support: 'Reaching people', alerts: 'Reaching people', auditHook: 'Reaching people',
    googleAuth: 'Signing in', captcha: 'Signing in', apiOrigin: 'Signing in',
    connectKey: 'Connected accounts', connectKeyPrev: 'Connected accounts',
    connectGoogle: 'Connected accounts', googlePicker: 'Connected accounts', cloudComputer: 'Core', cloudLibrary: 'Core', jobQueue: 'Core', meaning: 'Core', connectMicrosoft: 'Connected accounts',
    connectGithub: 'Connected accounts', mailCredKey: 'Connected accounts',
    connect_slack: 'Connected accounts', connect_discord: 'Connected accounts', connect_spotify: 'Connected accounts', connect_dropbox: 'Connected accounts', connect_hubspot: 'Connected accounts', connect_asana: 'Connected accounts', connect_zoom: 'Connected accounts', connect_box: 'Connected accounts', connect_strava: 'Connected accounts', connect_reddit: 'Connected accounts', connect_pinterest: 'Connected accounts', connect_calendly: 'Connected accounts',
    finance: 'Connected accounts',
    modelFallback: 'Watching it run', errors: 'Watching it run', product: 'Watching it run',
  };
  const GROUP_ORDER = ['Core', 'Taking money', 'Reaching people', 'Signing in',
                       'Connected accounts', 'Watching it run', 'Other'];
  for (const i of items) i.group = GROUPS[i.id] || 'Other';

  /* SETTINGS, NOT CAPABILITIES.

     Each of these has a working default, so on/off is the wrong shape for it -
     reporting GLOBAL_DAILY_USD_CAP as "not set up" would be a red row for a
     deployment behaving exactly as intended. They are here because they are
     still things somebody has to know exist before launch, and because a name
     the Worker reads with nowhere on this screen to appear is the drift the
     gate stage now refuses.

     `set` is the only thing reported. Never the value: a spend ceiling is not
     a secret, but a screen that prints one env var's value is a screen that
     will print the next one's. */
  const tuning = [
    { id: 'spendCap', name: 'Daily spend ceiling', env: 'GLOBAL_DAILY_USD_CAP', set: _has(env, 'GLOBAL_DAILY_USD_CAP'),
      effect: 'The most AMV will spend on model calls in one day across every account before it starts refusing. Defaults to $500.' },
    { id: 'writeCap', name: 'Non-essential write budget', env: 'NONESSENTIAL_WRITE_CAP', set: _has(env, 'NONESSENTIAL_WRITE_CAP'),
      effect: 'How many writes a day telemetry and the waitlist may spend before they are dropped, so they cannot exhaust the storage budget the product runs on.' },
    { id: 'partnerUrl', name: 'Partner models: endpoint', env: 'AMV_PARTNER_URL', set: _has(env, 'AMV_PARTNER_URL'),
      effect: 'A second model supplier speaking the shared chat-completions protocol. With the key and the engine list, its models are sold as AMV engines.' },
    { id: 'partnerKey', name: 'Partner models: key', env: 'AMV_PARTNER_KEY', set: _has(env, 'AMV_PARTNER_KEY'),
      effect: 'The partner supplier\u2019s key. Read only by the server.' },
    { id: 'partnerEngines', name: 'Partner models: engines', env: 'AMV_PARTNER_ENGINES', set: _has(env, 'AMV_PARTNER_ENGINES'),
      effect: 'Which partner models AMV sells, under which AMV names and at which prices. An engine appears only once the partner\u2019s own model list confirms it.' },
    { id: 'speechUrl', name: 'Voice: endpoint', env: 'AMV_SPEECH_URL', set: _has(env, 'AMV_SPEECH_URL'),
      effect: 'The speech supplier\u2019s https base, speaking the shared /audio/transcriptions and /audio/speech protocol.' },
    { id: 'speechKey', name: 'Voice: key', env: 'AMV_SPEECH_KEY', set: _has(env, 'AMV_SPEECH_KEY'),
      effect: 'The speech supplier\u2019s key. Read only by the server.' },
    { id: 'speechListenModel', name: 'Voice: hearing model', env: 'AMV_SPEECH_LISTEN_MODEL', set: _has(env, 'AMV_SPEECH_LISTEN_MODEL'),
      effect: 'The supplier\u2019s model that turns audio into text.' },
    { id: 'speechListenPrice', name: 'Voice: price per minute heard', env: 'AMV_SPEECH_LISTEN_USD_PER_MIN', set: _has(env, 'AMV_SPEECH_LISTEN_USD_PER_MIN'),
      effect: 'What one minute of audio costs you, in US dollars, charged against the plan allowance. Hearing stays off without it.' },
    { id: 'speechVoiceModel', name: 'Voice: speaking model', env: 'AMV_SPEECH_VOICE_MODEL', set: _has(env, 'AMV_SPEECH_VOICE_MODEL'),
      effect: 'The supplier\u2019s model that turns text into speech.' },
    { id: 'speechVoice', name: 'Voice: which voice', env: 'AMV_SPEECH_VOICE', set: _has(env, 'AMV_SPEECH_VOICE'),
      effect: 'The name of the supplier\u2019s voice AMV speaks with.' },
    { id: 'speechVoicePrice', name: 'Voice: price per 1,000 characters spoken', env: 'AMV_SPEECH_VOICE_USD_PER_1K_CHARS', set: _has(env, 'AMV_SPEECH_VOICE_USD_PER_1K_CHARS'),
      effect: 'What 1,000 characters of speech cost you, in US dollars, charged against the plan allowance. Speaking stays off without it.' },
    { id: 'modelUrl', name: 'Model endpoint', env: 'MODEL_API_URL', set: _has(env, 'MODEL_API_URL'),
      effect: 'Where AMV sends model requests. Defaults to the standard endpoint; set it only to point at a proxy or a region you have been given.' },
    { id: 'appOrigin', name: 'App address (fallback)', env: 'APP_ORIGIN', set: _has(env, 'APP_ORIGIN'),
      effect: 'Read only when APP_URL is unset. Two names for one thing, kept because a deployment may already have set either.' },
    { id: 'analyticsHost', name: 'Analytics host', env: 'POSTHOG_HOST', set: _has(env, 'POSTHOG_HOST'),
      effect: 'Where product analytics are sent. Defaults to the US host; set it for the EU one, or for a self-hosted instance.' },
    { id: 'financeHost', name: 'Bank data host', env: 'FINANCE_API_URL', set: _has(env, 'FINANCE_API_URL'),
      effect: 'Which environment of the bank-data provider to call. Defaults to production; point it at their sandbox while testing.' },
    { id: 'financeCountries', name: 'Bank-link countries', env: 'FINANCE_COUNTRIES', set: _has(env, 'FINANCE_COUNTRIES'),
      effect: 'Countries where people can link a bank, e.g. "US,CA,GB,ES". Defaults to the United States. Add a country only once your bank-data provider has approved it for your account; anything the provider does not cover is ignored.' },
  ];

  /* THE ONE THING EVERY PROVIDER ASKS WHEN AN APP IS REGISTERED, AND THAT NO ROW
     SAID: the redirect URL. Every connection comes back to the site's own
     address and the provider compares it character for character, so the
     exact string is given - trailing slash included - rather than left for the
     owner to guess at a registration form. */
  const back = _originOf(env && (env.APP_URL || env.APP_ORIGIN));
  if (back) for (const i of items) {
    if (/^connect[A-Z]/.test(i.id) && !/^connectKey/.test(i.id))
      i.how = String(i.how || '') + '. When registering the app, set its redirect URL to exactly ' + back + '/';
  }
  const all = items.concat(storage);
  const missingBlocking = all.filter(i => i.blocking && !i.on);
  /* A row held off on purpose (it carries a `tag`) is not something the owner
     can configure, so it does not count as "still off". */
  const missingOptional = all.filter(i => !i.blocking && !i.on && !i.tag);
  return {
    items, storage, tuning, groupOrder: GROUP_ORDER,
    summary: {
      on: all.filter(i => i.on).length,
      total: all.length,
      blockingMissing: missingBlocking.length,
      // The single sentence that answers "can I launch".
      verdict: missingBlocking.length
        ? 'Not ready: ' + missingBlocking.map(i => i.name).join(', ') + ' still missing.'
        : (missingOptional.length
            ? 'Core product is live. ' + missingOptional.length + ' optional capabilit' + (missingOptional.length === 1 ? 'y is' : 'ies are') + ' still off.'
            : 'Everything is configured.'),
    },
  };
}

/* GET /admin/readiness - admin-gated, and it never returns a secret value. */
/* SEND ONE REAL EMAIL AND SAY WHAT THE PROVIDER ANSWERED.

   "The reset email never showed up" has four causes that look identical from
   the inbox: no key, a key the provider rejects, a sender on a domain it has
   not verified, or a message that was accepted and filtered as spam. Only the
   provider's own answer tells them apart, and every ordinary send swallows it
   (on purpose - a stranger must not learn whether an address exists). So the
   operator, with the admin token, can send one test to OWNER_EMAIL (or an
   address they type) and read the provider's status and message verbatim.
   Never the key itself. Rate limited like every admin surface. */
async function adminEmailTest(request, env) {
  { const g = await _adminGate(request, env, 'emailtest', 3, 30); if (g) return g; }
  const body = await request.json().catch(() => ({}));
  const to = String(body.to || env.OWNER_EMAIL || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to))
    return json({ ok: false, error: 'No address to send to: type one, or set OWNER_EMAIL.' }, 400);
  if (!env.EMAIL_API_KEY) return json({ ok: false, step: 'key', error: 'EMAIL_API_KEY is not set on this Worker.' });
  const from = env.RESET_EMAIL_FROM || RESET_FROM_DEFAULT;
  let status = 0, said = '';
  try {
    const r = await fetchDeadline('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.EMAIL_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: 'AMV test email',
        text: 'This is a test from AMV. If you are reading it, email from AMV reaches this inbox.',
        html: _emailShell('Email works', '<p style="margin:0;font-size:14px;color:#333">This is a test from AMV. If you are reading it, email from AMV reaches this inbox.</p>', null, null, 'Test email.') }),
    });
    status = r.status;
    said = String((await r.text().catch(() => '')) || '').slice(0, 400);
  } catch (e) { said = 'The email provider could not be reached: ' + String(e && e.message || e).slice(0, 200); }
  audit(env, 'admin_email_test', { to, status });
  const ok = status >= 200 && status < 300;
  /* The same record _sendEmail keeps: a test that goes through after the
     domain is verified is what switches sign-in codes back on, straight away. */
  try {
    if (ok) await env.AMV_KV.delete('emailhealth:sender');
    else if (/domain is not verified|verify (your )?domain|not verified/i.test(said))
      await env.AMV_KV.put('emailhealth:sender', JSON.stringify({ at: Date.now(), said: said.slice(0, 300) }), { expirationTtl: 86400 });
  } catch (e) {}
  /* EVERY INBOX, NOT ONE. A verified domain is accepted by the provider, and
     Gmail takes it - but Outlook, Hotmail and Yahoo also look for SPF, DKIM
     and a DMARC policy on the sending domain, and file mail without them as
     junk. Resend's verification adds the first two; DMARC is the one left out.
     So the test reads all three, from public DNS, and names what is missing. */
  const domain = ((/@([^>\s]+)/.exec(from) || [])[1] || '').toLowerCase();
  const inboxes = domain ? await _mailDnsHealth(domain) : null;
  const fixes = [];
  if (inboxes) {
    if (inboxes.dmarc === false) fixes.push('Add a TXT record named _dmarc with the value: v=DMARC1; p=none;  - Outlook, Hotmail and Yahoo junk mail from a domain without one.');
    if (inboxes.dkim === false) fixes.push('The DKIM record (resend._domainkey) is missing - re-run "Verify DNS Records" in Resend.');
    if (inboxes.spf === false) fixes.push('The SPF record on send.' + domain + ' is missing - re-run "Verify DNS Records" in Resend.');
  }
  let hint = '';
  if (!ok && /domain/i.test(said)) hint = 'The sender\u2019s domain is not verified with the email provider. Verify it there, or set RESET_EMAIL_FROM to an address on a verified domain.';
  else if (!ok && (status === 401 || status === 403) && /key|auth/i.test(said)) hint = 'The provider rejected EMAIL_API_KEY. Create a new key there and set it again.';
  else if (ok) hint = 'Accepted by the provider. If it is not in the inbox within a minute, check spam - and the provider\u2019s log for that message.';
  return json({ ok, status, from, to, provider: said, hint, domain, inboxes, fixes });
}

/* What the big inbox providers check on a sending domain, read from public
   DNS (Cloudflare's DNS-over-HTTPS). true / false per record, or null for
   "could not ask" - which is never reported as missing. */
async function _dohTxt(name) {
  try {
    const r = await fetchDeadline('https://cloudflare-dns.com/dns-query?type=TXT&name=' + encodeURIComponent(name),
      { headers: { accept: 'application/dns-json' } }, 5000);
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    if (!d || typeof d.Status !== 'number') return null;
    return (d.Answer || []).filter(a => a && a.type === 16)
      .map(a => String(a.data || '').replace(/"\s*"/g, '').replace(/^"|"$/g, ''));
  } catch (e) { return null; }
}
async function _mailDnsHealth(domain) {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  const [dmarc, dkim, spf] = await Promise.all([
    _dohTxt('_dmarc.' + domain), _dohTxt('resend._domainkey.' + domain), _dohTxt('send.' + domain)]);
  const has = (list, re) => list == null ? null : list.some(t => re.test(t));
  return { dmarc: has(dmarc, /^v=DMARC1/i), dkim: has(dkim, /p=/), spf: has(spf, /^v=spf1/i) };
}

async function adminReadiness(request, env) {
  { const g = await _adminGate(request, env, 'read', 60, 2000); if (g) return g; }
  return json(Object.assign({ ok: true, checkedAt: Date.now() }, _readinessReport(env, { senderRefused: await _emailSenderRefused(env) })));
}


/* READY, NOT JUST ALIVE (scale audit, Oct 26).

   /v1/health answers "the Worker runs" and reads nothing, which is what
   liveness should be - and all a load balancer, an uptime monitor or the
   deploy's own post-check could ask. A Worker whose store is unreachable is
   alive and cannot serve anybody, and nothing said so.

   /v1/health/ready asks the two things every request depends on: KV (a
   read - this is a GET, and a GET writes nothing, which a-link-is-not-a-
   command holds every safe route to), and the Durable Object that holds
   every usage ceiling, asked
   directly rather than through counter(), whose fallback to KV is exactly
   the degradation this is meant to see. Then what this deployment has
   switched on, as booleans - the same facts the app already learns by
   using each feature, nothing about any account and no secret.

   Unauthenticated, so the answer is held for ten seconds per isolate:
   hitting it in a loop costs AMV the same as hitting it once. 503 when not
   ready, so a monitor needs no parsing to page somebody. */
let _readyMemo = { at: 0, body: null };
const READY_MEMO_MS = 10000, READY_STEP_MS = 3000;
function _readyStep(promise) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after ' + READY_STEP_MS + 'ms')), READY_STEP_MS))]);
}
async function healthReady(request, env) {
  const now = Date.now();
  if (_readyMemo.body && now - _readyMemo.at < READY_MEMO_MS) return json(_readyMemo.body, _readyMemo.body.ready ? 200 : 503);
  const checks = {};
  const probe = async (name, fn) => {
    const t = Date.now();
    try { await _readyStep(fn()); checks[name] = { ok: true, ms: Date.now() - t }; }
    catch (e) { checks[name] = { ok: false, ms: Date.now() - t, why: String((e && e.message) || e).slice(0, 120) }; }
  };
  await probe('kv', async () => {
    if (!env.AMV_KV) throw new Error('not bound');
    await env.AMV_KV.get('GLOBAL_KILL');
  });
  if (env.AMV_COUNTER) {
    await probe('counter', async () => {
      const stub = env.AMV_COUNTER.get(env.AMV_COUNTER.idFromName('health:probe'));
      const r = await stub.fetch('https://do/counter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'get' }) });
      if (!r.ok) throw new Error('answered ' + r.status);
      await r.json();
    });
  } else {
    /* Not a failure of this probe: preflight and the readiness screen say a
       deployment without it has limits that are suggestions. */
    checks.counter = { ok: true, skipped: 'not bound' };
  }
  if (DB._hasD1(env)) await probe('d1', async () => { await env.DB.prepare('SELECT 1').bind().first(); });
  const ready = Object.values(checks).every(c => c.ok);
  const body = {
    ready, ts: now, checks,
    capabilities: {
      model: _has(env, 'AMV_MODEL_KEY'),
      email: _has(env, 'EMAIL_API_KEY'),
      payments: _has(env, 'STRIPE_SECRET_KEY') && _has(env, 'STRIPE_WEBHOOK_SECRET'),
      browser: !!env.BROWSER,
      library: libConfigured(env),
      meaning: _meaningOn(env),
      cloud_computer: _computerOn(env),
    },
  };
  _readyMemo = { at: now, body };
  return json(body, ready ? 200 : 503);
}
