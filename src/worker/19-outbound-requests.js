     what AMV may spend on their behalf, and the screen where they set it says
     it resets on the 1st. Moving it onto their billing anniversary would make
     their own control mean something they did not choose, to fix a problem
     they do not have: this cap is theirs, and it is not sold by the month. */
  return null;
}

const SPEND_MONTH_TTL_MS = 86400000 * 70;
const _spendMonthKey = (email) => `spendmo:${email}:${monthKey()}`;

/* BOOK the money, atomically, against the monthly cap.

   Deliberately the CALENDAR month, unlike the plan allowance elsewhere. This is
   not something anybody bought - it is the limit a person set on what AMV may
   spend on their behalf, and the screen where they set it says it resets on the
   1st. Moving it onto their billing anniversary would make their own control
   mean something they did not choose, to fix a problem they do not have.

   Returns { ok } or { refused }. The reservation is real money held: whoever
   takes one owns releasing it. */
async function _spendReserve(env, email, amount, clientLimit){
  const amt = +amount || 0;
  if(!(amt > 0)) return { ok:true, reserved:0 };
  const refused = await _spendAllowed(env, email, amt, clientLimit);
  if(refused) return { refused };

  const L = await _spendLimits(env, email);
  const cap = +L.monthlyCap || 0;
  const r = await _reserveUSD(env, _spendMonthKey(email), amt, cap, SPEND_MONTH_TTL_MS);
  if(r.allowed) return { ok:true, reserved: amt };

  /* AMV-032: a counter that could not answer is not a counter that said yes.
     Refusing to spend somebody's money because the ledger is unreachable is the
     right way round to be wrong. */
  if(r.unavailable)
    return { refused:{ code:'spend_unavailable',
      need:'AMV cannot check your spending limit right now, so it will not spend anything.',
      message:'Try again in a moment - nothing was charged.' } };

  const left = Math.max(0, cap - (r.value || 0));
  return { refused:{ code:'over_monthly',
    need:'This would take you past your $' + cap.toFixed(2) + ' monthly limit - $'
      + left.toFixed(2) + ' is left this month.',
    message:'The month resets on the 1st, or you can raise the limit in Settings.' } };
}

/* Give it back. A run that never reached a purchase must not have eaten the
   month, and a run that failed to start must not have eaten anything. */
async function _spendRelease(env, email, amount){
  await _releaseUSD(env, _spendMonthKey(email), +amount || 0, SPEND_MONTH_TTL_MS);
}

/* Kept for the callers that spend outside a reservation. Inside browserRun the
   money is reserved up front instead, because a check and a booking that are
   two calls are two calls something can happen between. */
async function _spendRecord(env, email, amount){
  const amt = +amount || 0;
  if(!(amt > 0)) return;
  try{ await counter(env, _spendMonthKey(email), { op:'incr', amount: amt, ttlMs: SPEND_MONTH_TTL_MS }); }catch(e){}
}

const WEB_MAX_STEPS = 24;
const WEB_MAX_MS = 90000;
const WEB_ALLOWED_VERBS = ['goto','click','type','select','press','scroll','extract','submit','done','blocked'];
// Verbs that are always irreversible.
const WEB_CONSEQUENTIAL = ['submit'];
// A click is USUALLY navigation, but "Place order" / "Delete account" / "Send"
// are irreversible too. Approval is decided by what the control actually says,
// not by the verb alone - otherwise the agent could buy or delete without asking.
const WEB_CONSEQUENTIAL_LABEL = /\b(buy|purchase|order|pay|checkout|subscribe|confirm|submit|send|post|publish|apply|delete|remove|cancel|deactivate|transfer|withdraw|donate|bid|book|reserve|accept|agree|sign)\b/i;
// Enter/Return in a focused field SUBMITS the form on most sites, so it is
// exactly as irreversible as clicking Submit and must be approved the same way.
// (Without this, the whole approval gate is bypassable with a keystroke.)
const WEB_SUBMIT_KEYS = /^(enter|return|numpadenter)$/i;
function _webIsConsequential(verb, label, text){
  if(WEB_CONSEQUENTIAL.indexOf(verb) >= 0) return true;
  if(verb === 'press' && WEB_SUBMIT_KEYS.test(String(text || 'Enter'))) return true;
  if((verb === 'click' || verb === 'press') && label && WEB_CONSEQUENTIAL_LABEL.test(String(label))) return true;
  return false;
}

/* ══════════════════════════════════════════════════════════════
   OUTBOUND REQUESTS: A DEADLINE, AND A GATE THAT SURVIVES A REDIRECT.

   Two things every fetch out of this Worker was missing.

   NO DEADLINE. There were 41 outbound fetches here and not one AbortSignal
   between them. The browser half of AMV has had fetchDeadline for as long as
   it has had a network call; the server half had nothing. A provider that
   accepts the connection and then says nothing holds the request until the
   platform kills it, and on the model path the caller's allowance is reserved
   the whole time - so a third party being slow costs the customer their quota
   and costs the operator the wall clock. Worst at a route that fetches a host
   the CALLER chose: point it at a black hole and the Worker waits.

   THE GATE ONLY GUARDED THE FIRST HOP. _webHostAllowed refuses localhost, the
   RFC1918 ranges, 169.254, the metadata host - and it was checked once,
   against the address somebody typed. fetch follows redirects by default, so
   a server that answers 302 http://169.254.169.254/ was followed with no
   second look, which is the whole gate walked around by one response header.
   Workers also forward the Authorization header across origins where a
   browser strips it, so the redirect takes the credential with it.

   So: hops are followed by hand, each one re-gated, and the credential is
   dropped the moment the origin changes. A redirect that leaves the origin is
   a different server, and it does not get to keep the key that was meant for
   the first one. */
const OUTBOUND_TIMEOUT_MS = 15000;
const OUTBOUND_MAX_HOPS = 5;

/* THE ONE EXEMPTION, STATED RATHER THAN LEFT IMPLICIT.

   _modelFetch is not wrapped. Aborting a signal aborts the response body too,
   so a deadline on a streamed answer does not bound a hang - it cuts the
   sentence somebody is reading, at a time that has nothing to do with whether
   anything is wrong. A chat that stops mid-word at fifteen seconds is a worse
   failure than the one this exists to prevent, and it would happen to every
   long answer rather than to the rare hung request. That call already accepts
   a caller's own signal, and the platform bounds the request either way. */

/* A fetch that cannot hang. Everything else here goes through it. */
function fetchDeadline(url, init, ms){
  return fetch(url, Object.assign({}, init || {}, {
    signal: AbortSignal.timeout(Math.max(1000, +ms || OUTBOUND_TIMEOUT_MS)),
  }));
}

/* A fetch to an address somebody else chose. Every hop is re-gated, and the
   Authorization header does not cross an origin boundary. */
async function fetchGuarded(rawUrl, init, ms){
  let target = String(rawUrl || '');
  let opts = Object.assign({}, init || {});
  const firstOrigin = (() => { try { return new URL(target).origin; } catch(e){ return ''; } })();
  for(let hop = 0; hop <= OUTBOUND_MAX_HOPS; hop++){
    const gate = _webHostAllowed(target);
    if(!gate.ok) return { blocked: true, why: gate.why, url: target, hop };
    const r = await fetchDeadline(gate.url, Object.assign({}, opts, { redirect: 'manual' }), ms);
    if(!(r.status >= 300 && r.status < 400)) return { blocked: false, response: r };
    const loc = r.headers.get('location');
    if(!loc) return { blocked: false, response: r };
    let next; try { next = new URL(loc, gate.url).toString(); } catch(e){ return { blocked: false, response: r }; }
    /* Leaving the origin the credential was issued for: the credential stays
       behind. A 302 is not a reason to hand somebody else's server a token. */
    let nextOrigin = ''; try { nextOrigin = new URL(next).origin; } catch(e){}
    if(nextOrigin !== firstOrigin && opts.headers){
      const h = {};
      for(const [k, v] of Object.entries(opts.headers)){
        if(!/^authorization$/i.test(k) && !/^cookie$/i.test(k)) h[k] = v;
      }
      opts = Object.assign({}, opts, { headers: h });
    }
    target = next;
  }
  return { blocked: true, why: 'That address redirected too many times.', url: target, hop: OUTBOUND_MAX_HOPS };
}

/* Same ORIGIN, decided by parsing rather than by comparing strings.

   Scheme, host and port each become a field of their own, so nothing in one of
