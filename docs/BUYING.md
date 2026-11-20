# AMV buys things - design (owner decision, Nov 16: "Both, in phases")

## Contained, Nov 20 - the person presses the store's pay button (build 16 audit)

The build 16 audit (AG-01..AG-04) found that the "one armed press" design
depended on recognising a pay button by an English label list, in one surface
(chat) and only when this module was loaded; that an unreadable page passed as
an empty one; that a purchase card could approve the right number in the wrong
currency or a shipping line as the total; that a store and its parent domain
matched each other; and that a shopping-trip approval outlived its request.
Until a safe adapter exists for a store's own transaction API, the final press
is the person's:

- **AMV never presses a pay button.** Approved or not. The guard is in
  `runMcpTool` (38-mcp.js), the one door every surface uses to reach AMV's
  browser; it loads `shopping.js` first and refuses the write if it cannot.
  Labels are recognised in the seventeen interface languages and the common
  store wording of each; on a page that reads as a checkout, a control it
  cannot name (an icon, a missing reference), Enter, a submitted form and an
  accepted dialog are refused too. A page that cannot be read: nothing written.
- **The card is exact.** The store must be the page's host or a parent of it
  that is a real registrable name (never co.uk); the total must appear next to
  its currency and be the largest amount in that currency on the page.
- **Bought means confirmed.** Only an order number and total in the held
  currency found on the store's own page is Bought. Anything else is "Not
  confirmed" - still counted against the limits, the safe side if it went
  through - and says to check the store's email.
- **A trip is one request.** The approval belongs to this account, this
  conversation and this request, for twenty minutes at most; a new message,
  another conversation or signing out ends it.

Suite: `amv-never-presses-pay-without-your-tap` (32 checks; breaking the door
or the largest-amount rule fails it).

## Phase 1 - AMV shops, the person approves the payment with one tap (built Nov 16)

AMV does the whole purchase in **AMV's browser** on the person's own computer
(`amv-browser`, the pinned Playwright connector), where the person is signed in
to the store themselves. AMV never sees or stores a card: the store charges the
payment method the person already saved there.

1. **One approval per shopping trip.** The first browser action on a store asks
   once: "Let AMV shop on <store> for this request? It can search, open pages,
   fill your cart and checkout. It cannot pay - the last step needs your OK."
   After yes, AMV's browser acts on that store without a prompt per click, for
   this conversation. Any other site is asked again. Third-party connectors keep
   per-call consent - only AMV's own pinned browser, whose tools are known, gets
   a trip approval.
2. **Money buttons stay locked.** Before every click the page takes its own
   snapshot (not the model's) and reads the target's real label. A button or
   link named like buy / place order / pay / purchase / confirm order / submit
   order / checkout-and-pay is refused unless a purchase is armed for that store.
3. **The purchase card.** When the checkout is ready, AMV calls
   `propose_purchase` (store, item, total, currency). The page takes a snapshot
   and refuses if the page is not that store, or the total does not appear on
   it. Otherwise chat shows a card: item, store, total read from the page, and
   "Buy for $X" / "Not now".
4. **Held before it is clicked.** "Buy" asks the server to hold the amount
   against Spending (`/v1/spend/hold`): spending must be on, the amount within
   the per-purchase limit and what is left this month - the same limits as
   everything AMV pays for, enforced server-side and booked atomically. Only
   then is ONE money click armed, for that store, for three minutes.
5. **Read back.** AMV clicks the final button and calls `confirm_purchase`
   (order number, total). The page snapshots the confirmation page and checks
   the order number and total appear there; the hold is settled at the real
   total (`/v1/spend/settle`), and chat shows a receipt card saying what was
   checked. A total that differs from the approved one is shown as a warning,
   not hidden. Not confirmed within the window: the hold is released.

What this does NOT claim: a store page can still lie about what it charges. The
card shows what the page says; the receipt shows what the confirmation page
says; the bank statement is the final word. Phase 2 removes that gap.

## Phase 2 - AMV's own virtual cards (needs the owner)

Single-use Stripe Issuing cards, one per approved purchase, with
`spending_controls` capped at the approved amount and locked to the merchant
category; every authorization comes to AMV's webhook in real time and is
approved only if it matches the hold. The card network enforces the cap, so a
Crew job can buy within a limit without a tap, and the authorization record is
the read-back. **Needs the owner:** apply for Stripe Issuing (KYC; US/UK/EU),
fund the Issuing balance, and a legal review of paying merchants on users'
behalf. Until then nothing here issues a card.
