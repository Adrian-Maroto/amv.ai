/* =====================================================================
   DEPLOY
   1. npm i -g wrangler && wrangler login
   2. wrangler kv:namespace create AMV_KV   → put id in wrangler.toml
   3. Secrets:
        wrangler secret put AMV_MODEL_KEY
        wrangler secret put JWT_SECRET           (LONG random string - 32+ chars)

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

