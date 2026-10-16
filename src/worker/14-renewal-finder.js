/* ── WHAT IS RENEWING, AND WHAT IT COSTS ──────────────────────────────────
   READ BY RULE, NOT BY PROMPT.

   "Auto Cancel Subscriptions" starts with knowing what somebody is paying
   for. The obvious way to answer that is to hand the inbox to a model and ask
   - and it is the wrong way, for the same reason `_investCheckin` does its
   arithmetic itself: this is MONEY. A model given twenty-five subject lines
   will produce a confident number, and the number will sometimes be the price
   in an advertisement, or last month's, or one it rounded. Somebody then
   cancels the wrong thing, or does not cancel the right one.

   So the extraction is deterministic. It costs nothing to run, it cannot be
   talked into anything by the contents of a message, and every figure it
   reports can be pointed back at the exact text it came from. What it cannot
   work out, it says it cannot work out.

   THE FALSE POSITIVE IS THE EXPENSIVE ONE. Calling a one-off purchase a
   subscription puts a thing on somebody's cancel list that was never
   recurring, so BOTH a recurring signal and an amount are required before a
   charge is claimed. A merchant that looks like a subscription with no
   readable amount is reported WITHOUT one rather than with a guess.

   Deliberately not here: any attempt to decide whether a subscription is
   worth keeping. That is the person's call and it is not one an inbox can
   answer - a service somebody uses twice a year may be the most valuable
   thing on the list. */
const SUB_MAX = 40;

/* Words that mean "this is a recurring charge", not "this is a charge". A
   receipt on its own is a receipt; a receipt for a SUBSCRIPTION is what this
   is looking for. Kept as whole words so "renewal" does not match "renewals
   are closed" in a newsletter about something else. */
const _SUB_RECUR_RE = /\b(subscription|subscribed|renew(?:s|ed|al|ing)?|auto-?renew\w*|recurring|billing cycle|next payment|membership|plan renews)\b/i;
/* And the words that mean money moved or is about to. Without one of these a
   message mentioning a subscription is talk about one, not a charge. */
const _SUB_CHARGE_RE = /\b(receipt|invoice|payment|charged?|billed?|order confirmation|payment confirmation|we(?:'| ha)?ve charged|will be charged|amount due)\b/i;
/* The direction matters: a refund or a cancellation notice is not a renewal,
   and reporting one as an active charge is how somebody cancels a thing they
   already cancelled. */
const _SUB_NEGATIVE_RE = /\b(refund(?:ed|s)?|cancell?(?:ed|ation)|expired?|has ended|will not renew|won'?t renew|failed|declined|unpaid|trial ends?)\b/i;

/* Cadence, in the words people's providers actually use. Absent is a real
   answer - plenty of receipts do not say - and it is left null rather than
   assumed monthly, which would silently multiply an annual charge by twelve
   on any screen that adds these up. */
/* HOW OFTEN, NOT WHEN.

   The first version of this matched a bare `week`, so "your plan renews next
   week" - which says nothing about frequency and is perfectly normal on an
   ANNUAL plan - came back as a weekly charge. Off by fifty-two on any screen
   that adds these up, from a sentence that was not about frequency at all.
   Bare `month` and `year` had the same fault: "next month", "last year".

   So only the forms that can ONLY mean frequency are here: the -ly words,
   `per X`, `/X`, `every X`, `each X`. Deliberately absent is `a month`, as in
   "£9 a month" - it is common and it is also how "renews in a month" reads,
   and there is no way to tell them apart from a subject line. An unread
   cadence is reported as unknown, which is the honest answer and the one that
   cannot misprice anything.

   And the boundaries are per branch, not wrapped around the whole group. The
   first version put `\b` before an alternation whose branches begin with `/` -
   a slash is not a word character, so ` / mo` never had a boundary to match
   and the commonest way anybody writes a monthly price silently did nothing. */
const _SUB_CADENCE = [
  /* Yearly first: "12 months" is a year, and testing monthly first would claim
     it as a monthly charge. */
  [/\b(?:yearly|annually|annual)\b|\bper (?:year|annum)\b|\/\s?(?:yr|year)\b|\b(?:every|each) year\b|\b12 months?\b/i, 'yearly'],
  [/\bquarterly\b|\bper quarter\b|\b(?:every|each) (?:quarter|3 months?)\b/i, 'quarterly'],
  [/\bweekly\b|\bper week\b|\/\s?(?:wk|week)\b|\b(?:every|each) week\b/i, 'weekly'],
  [/\bmonthly\b|\bper month\b|\/\s?(?:mo|month)\b|\b(?:every|each) month\b/i, 'monthly'],
];

/* Currency by symbol and by code. Symbols first because that is how they are
   written; the code form catches "USD 9.99" and "12.99 EUR". */
const _SUB_SYMBOLS = { '$': 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY', '₹': 'INR', '₩': 'KRW', '₽': 'RUB', '₦': 'NGN', '₱': 'PHP', '₪': 'ILS' };
const _SUB_CODES = ['USD','EUR','GBP','JPY','CAD','AUD','NZD','CHF','SEK','NOK','DKK','PLN','CZK','HUF','RON','TRY','ILS','AED','SAR','INR','PKR','BDT','THB','VND','IDR','MYR','SGD','HKD','TWD','KRW','CNY','PHP','ZAR','NGN','KES','GHS','EGP','MAD','BRL','MXN','ARS','CLP','COP','PEN','UYU','RUB','UAH','KZT'];

/* A NUMBER A HUMAN WROTE, IN WHATEVER CONVENTION THEIR COUNTRY USES.

   `12,99` is twelve euros ninety-nine in most of Europe and twelve thousand
   nine hundred in none of them; `1,299.00` is one thousand two hundred and
   ninety-nine everywhere that writes it that way. Reading either wrongly is
   off by a factor of a hundred on a screen about somebody's money, so both
   conventions are handled explicitly rather than by hoping parseFloat is
   right. Returns null when it cannot tell, which is the only honest answer
   for something like `1,234` on its own. */
function _subAmount(raw){
  let t = String(raw || '').trim();
  if(!t) return null;
  const hasDot = t.indexOf('.') >= 0, hasComma = t.indexOf(',') >= 0;
  if(hasDot && hasComma){
    /* Whichever separator comes LAST is the decimal one: 1.299,00 is European
       and 1,299.00 is not. */
    t = t.lastIndexOf(',') > t.lastIndexOf('.')
      ? t.replace(/\./g, '').replace(',', '.')
      : t.replace(/,/g, '');
  } else if(hasComma){
    const after = t.length - t.lastIndexOf(',') - 1;
    /* Exactly two digits after a lone comma is a decimal comma. Three is a
       thousands separator. Anything else is unreadable, and unreadable is
       reported as unknown rather than guessed. */
    if(after === 2) t = t.replace(',', '.');
    else if(after === 3) t = t.replace(/,/g, '');
    else return null;
  }
  const n = Number(t);
  if(!Number.isFinite(n) || n <= 0) return null;
  /* Rounded to the minor unit. A fraction of a penny in a receipt is a parse
     that went wrong, not a price. */
  return Math.round(n * 100) / 100;
}

/* The money in one line of text, with its currency. Returns null rather than a
   number with no currency attached: "9.99" alone could be dollars or euros and
   putting the wrong symbol on somebody's money is worse than saying unknown. */
function _subMoney(text){
  const t = String(text || '');
  const sym = Object.keys(_SUB_SYMBOLS).map(c => '\\' + c).join('');
  let m = new RegExp('([' + sym + '])\\s?([0-9][0-9.,]*)').exec(t);
  if(m){ const v = _subAmount(m[2]); if(v !== null) return { amount: v, currency: _SUB_SYMBOLS[m[1]] }; }
  const codes = _SUB_CODES.join('|');
  m = new RegExp('\\b(' + codes + ')\\s?([0-9][0-9.,]*)', 'i').exec(t);
  if(m){ const v = _subAmount(m[2]); if(v !== null) return { amount: v, currency: m[1].toUpperCase() }; }
  m = new RegExp('([0-9][0-9.,]*)\\s?\\b(' + codes + ')\\b', 'i').exec(t);
  if(m){ const v = _subAmount(m[1]); if(v !== null) return { amount: v, currency: m[2].toUpperCase() }; }
  return null;
}

/* Who charged. The display name if the sender has one, otherwise the sending
   domain with the obvious noise stripped - `billing@mail.spotify.com` is
   Spotify, not "mail". Never the local part: `no-reply` is not a merchant. */
function _subMerchant(from){
  const f = String(from || '').trim();
  const named = /^\s*"?([^"<]+?)"?\s*</.exec(f);
  if(named){
    const n = named[1].trim().replace(/\s+/g, ' ');
    if(n && !/^(no-?reply|do-?not-?reply|info|support|billing|accounts?)$/i.test(n)) return n.slice(0, 60);
  }
  const at = /@([A-Za-z0-9.-]+)/.exec(f);
  if(!at) return '';
  const parts = at[1].toLowerCase().split('.').filter(p => !/^(mail|email|e|mailer|send|smtp|news|notify|notifications|billing|no-?reply|www|m|t)$/.test(p));
  /* Drop the public suffix, one label or two (`co.uk`). Whatever is left at
     the end is the name people would recognise. */
  if(parts.length >= 3 && /^(co|com|org|net|gov|ac)$/.test(parts[parts.length - 2])) parts.splice(-2);
  else if(parts.length >= 2) parts.pop();
  const name = parts[parts.length - 1] || '';
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
}

/* ── WHERE A CANCELLATION COULD ACTUALLY GO ────────────────────────────────
   THE ADDRESS IS READ, NEVER INVENTED.

   A cancellation has to be addressed to somebody, and there are exactly two
   honest sources for that address: the person, or the message the charge was
   found in. Anything else - `support@` + the merchant's domain, a model asked
   where to write - is a guess, and a guess here means somebody's cancellation
   goes to a stranger who now has their name and their account details. This
   takes the sender of the receipt, verbatim, or returns nothing.

   The card then says WHERE the address came from, because "the address on the
   receipt" and "an address you gave me" are different levels of confidence and
   the person is the only one who can close that gap. */
function _subFromAddr(from){
  const m = /<\s*([^<>\s]+@[^<>\s]+)\s*>/.exec(String(from || ''))
         || /([^<>\s,;]+@[^<>\s,;]+)/.exec(String(from || ''));
  if(!m) return '';
  const a = m[1].trim().replace(/[.,;]+$/, '');
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(a) ? a.toLowerCase().slice(0, 200) : '';
}

/* AND WHETHER WRITING TO IT CAN POSSIBLY WORK.

   This is the part that decides whether the feature is real or a demo. Most
   subscription receipts come from an unattended mailbox: a cancellation posted
   to `no-reply@` is a letter into a void, and drafting one without saying so
   is the "says it did something and did not" failure this product forbids -
   worse than useless, because somebody stops looking for the real cancel
   button believing it is handled.

   Matched on the LOCAL PART only. A domain called `noreply.example.com` is a
   sending domain, and plenty of them accept replies routed elsewhere; the
   local part is where a mailbox actually declares itself unattended. */
const _CANCEL_NOREPLY_RE = /^(no-?reply|do-?not-?reply|donotreply|noreply|bounce[sd]?|mailer-?daemon|notifications?|automated|auto-?confirm|postmaster)([.+_-]|$)/i;
function _cancelDeliverable(addr){
  const a = String(addr || '').trim().toLowerCase();
  if(!a) return { ok: false, why: 'no_address' };
  const local = a.split('@')[0] || '';
  if(_CANCEL_NOREPLY_RE.test(local)) return { ok: false, why: 'no_reply' };
  return { ok: true, why: '' };
}

/* ── THE NEVER LIST ────────────────────────────────────────────────────────
   A BOUND WRITTEN AS A REFUSAL, WHICH IS THE ONLY KIND PEOPLE ACTUALLY WRITE.

   The policy engine has understood `allowed_destinations` since it was written
   and nothing ever passed one, for a good reason: an ALLOWLIST of everybody
   AMV may contact is a list nobody can finish. People do not think "here are
   the eleven addresses you may write to". They think "never my employer",
   "never that bank", "never anyone at the school" - a short list of the places
   where being wrong would be expensive.

   WHAT IT BINDS TO, precisely, because overstating this would be the whole
   defect. AMV cannot send to a third party at all: `_autoEmailResult` takes the
   address from the ACCOUNT, and `AUTO_USES_ALLOWED` has no send in it. So this
   is not a send filter - there are no sends to filter. It governs what AMV
   PROPOSES: the cancellation letters it writes and puts in front of somebody
   with the address already filled in and a button that opens their mail app.

   That is worth governing on its own. Those addresses are read out of MAIL -
   content somebody else wrote - so the destination of a draft is the one field
   in this product that an outsider has any influence over. A person who says
   "never write to my bank" has said something exact about a real risk, and the
   answer must not be a letter to their bank sitting one tap from sent. */
const NEVER_MAX = 40;
const NEVER_ENTRY_MAX = 200;

/* One entry, normalised. Three shapes a person would actually type: a whole
   address, `@domain`, or a bare domain - the last because nobody types the at
   sign when they mean "anyone at this company". Anything else is refused
   rather than half-understood: a pattern AMV interprets loosely is a bound
   whose meaning only AMV knows. */
const _NEVER_LOCAL = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+";
const _NEVER_DOMAIN = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\\.[A-Za-z]{2,}';
const _NEVER_ADDR_RE = new RegExp('^' + _NEVER_LOCAL + '@' + _NEVER_DOMAIN + '$');
const _NEVER_DOM_RE = new RegExp('^@?' + _NEVER_DOMAIN + '$');
function _neverNorm(entry){
  let s = String(entry == null ? '' : entry).trim().toLowerCase().slice(0, NEVER_ENTRY_MAX);
  if(!s) return '';
  /* "*@bank.com" is what somebody types when they mean everybody there, and
     the first version of this accepted it as a literal ADDRESS - `*` is a legal
     local-part character - so it was stored as a rule that could never match
     anything. A bound that silently matches nothing is worse than a refused
     one: the person believes they are covered. */
  if(s.indexOf('*@') === 0) s = s.slice(1);
  /* The character classes are real address characters, not "anything without
     an at sign". `http://bank.com` passed the loose version and was stored as
     `@http://bank.com` - garbage kept as if it were a rule. */
  if(_NEVER_ADDR_RE.test(s)) return s;                       // a whole address
  if(_NEVER_DOM_RE.test(s)) return s.indexOf('@') === 0 ? s : '@' + s;
  return '';
}
function _neverList(rec){
  const raw = rec && Array.isArray(rec.never) ? rec.never : [];
  return raw.map(_neverNorm).filter(Boolean).slice(0, NEVER_MAX);
}
/* The entry that blocks this address, or ''. Domain entries match the domain
   and every subdomain of it, because somebody who wrote "never @bank.com"
   did not mean "except mail.bank.com" - and a receipt's sender is very often
   exactly that subdomain. */
function _neverBlocks(list, addr){
  const a = String(addr || '').trim().toLowerCase();
  if(!a) return '';
  const at = a.indexOf('@');
  const dom = at >= 0 ? a.slice(at + 1) : '';
  for(const e of (list || [])){
    if(e.indexOf('@') === 0){
      const d = e.slice(1);
      if(dom === d || dom.endsWith('.' + d)) return e;
    } else if(a === e) return e;
  }
  return '';
}

/* ── ASKING THE SAME QUESTION FOREVER IS NOT RESPECT ───────────────────────
   THE LAST OF THE BOUNDS, AND THE ONLY ONE AMV PROPOSES ITSELF.

   Somebody who has approved the same job's result every morning for a week has
   answered that question. Asking an eighth time is not caution, it is a tax on
   having set the job up at all - and the person is the only one who can say
   whether the answer is now a rule.

   SYMMETRIC, AND THAT IS THE WHOLE POINT. An offer that only ever points
   towards MORE autonomy is a growth nudge wearing the costume of helpfulness,
   and it would be worth more to AMV than to the person. So a run of REJECTIONS
   is offered the opposite: pause the job, because a job whose output you keep
   throwing away is a job costing money to produce rubbish. If only one
   direction had shipped, this would be the wrong feature.

   OFFERED ONCE. A prompt somebody declined and then sees again is not an
   offer, it is pestering, and the honest reading of "no" is "stop asking about
   this". `offered` is set when it is shown and never cleared.

   Counted here rather than inferred from the results list, because a result
   records what the RUN did and this is about what the PERSON said - and the
   two are different questions that would drift apart the moment either changed
   shape. */
const OFFER_AFTER_YES = 5;
const OFFER_AFTER_NO = 3;
/* Five identical mornings, counted as the first plus four repeats. Chosen to be
   past coincidence: two the same is normal for a weekly summary read daily,
   five is the job telling you it has nothing to say. */
const OFFER_AFTER_SAME = 4;

/* ── "IT SAID THE SAME THING AGAIN" ────────────────────────────────────────
   THE ONLY RULE HERE WITH NOTHING TO GUESS ABOUT.

   The milestone this belongs to is written as "interruption scoring", and a
   score is the wrong shape twice over. A model asked how urgent something is
   returns a confident number with nothing behind it, and a number nobody can
   trace is worse than none because it gets acted on. But a RULE-based score is
   barely better: it still hides a threshold the person cannot see, so somebody
   who asked to be emailed daily and was not has no way to find out why.

   What a run actually knows for free is whether it produced the same thing as
   last time. That is checkable by anybody, it is not an opinion, and it is the
   single strongest signal that an email is not worth sending. It is used as an
   OFFER rather than as an override - see `_offerFor` - because overriding
   somebody's explicit "email me daily" silently is the failure that loses an
   account, and one boring email is not.

   NORMALISATION IS DELIBERATELY THIN. Stripping more would make two genuinely
   different results look identical, and suppressing a real change is the
   dangerous direction of this error; missing a repeat only costs an offer
   nobody was owed. So: the date stamp a run writes onto its own output, and
   whitespace. Nothing that could be content.

   A BARE CLOCK TIME IS CONTENT, and the first version of this stripped it. That
   made "your next meeting is at 9:00" and "your next meeting is at 14:30"
   identical, so a calendar or a departure-board job - the jobs whose entire
   purpose is to report a time - would have been called unchanged and held back
   from somebody who had asked to hear when it changed. Nothing AMV writes into
   a result stamps a bare HH:MM; the only stamp is a date. So the strip could
   only ever remove content, which is exactly the direction this comment says
   not to go. The full ISO form is still removed because its time half belongs
   to the stamp it is part of. */
function _runDigest(text){
  const s = String(text || '')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '')   // the ISO stamp a run writes
    .replace(/\d{4}-\d{2}-\d{2}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if(!s) return '';
  /* FNV-1a over the normalised text. Not a security hash and never used as
     one - it answers "is this the same string", where a collision costs one
     offer that is not made. */
  let h = 0x811c9dc5;
  for(let i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36) + '-' + s.length.toString(36);
}

/* WAS THAT WORTH TELLING ME. A SEPARATE COUNT, DELIBERATELY.

   The obvious thing is to feed this into the tally above and be done. It is
   wrong: that tally counts APPROVALS - "yes, send this" - and this counts
   whether a result was worth an interruption. Somebody can approve a
   cancellation every time and still not want an email about it, and somebody
   can find a result useful and decline to act on it. Two different questions
   answered with the same word would make both counts mean nothing, and the
   thing they drive is a change to somebody's delivery.

   Same shape as the tally: streaks, not totals, and the opposite answer resets.
   No log of individual answers - nothing here needs them, and a log of
   somebody's opinions is a thing to be careful with. */
const OFFER_AFTER_MEH = 3;
function _feelOf(rec, jobId){
  const all = (rec && rec.feel) || {};
  const f = all[String(jobId || '')] || {};
  return { up: Number(f.up) || 0, down: Number(f.down) || 0, offered: !!f.offered };
}
function _feelRecord(rec, jobId, said){
  const id = String(jobId || '');
  if(!id) return;
  if(!rec.feel || typeof rec.feel !== 'object') rec.feel = {};
  const f = rec.feel[id] || { up: 0, down: 0, offered: false };
  if(said === 'up'){ f.up = (Number(f.up) || 0) + 1; f.down = 0; }
  else { f.down = (Number(f.down) || 0) + 1; f.up = 0; }
  rec.feel[id] = f;
}

/* One person's answering history for one job. Deliberately tiny: two streaks
   and a flag. Not a log - a log of somebody's decisions is a thing to be
   careful with, and nothing here needs the individual answers. */
function _tallyOf(rec, jobId){
  const all = (rec && rec.tally) || {};
  const t = all[String(jobId || '')] || {};
  return { yes: Number(t.yes) || 0, no: Number(t.no) || 0, offered: !!t.offered };
}
function _tallyRecord(rec, jobId, said){
  const id = String(jobId || '');
  if(!id) return;
  if(!rec.tally || typeof rec.tally !== 'object') rec.tally = {};
  const t = rec.tally[id] || { yes: 0, no: 0, offered: false };
  /* A STREAK, not a total. Somebody who approved something four times, once
     said no, and has approved twice since has not answered the same way seven
     times - and the "no" is the most informative answer in that sequence. The
     opposite streak resets, so the count always describes an unbroken run. */
  if(said === 'yes'){ t.yes = (Number(t.yes) || 0) + 1; t.no = 0; }
  else { t.no = (Number(t.no) || 0) + 1; t.yes = 0; }
  rec.tally[id] = t;
}

/* What, if anything, is worth offering about this job - computed, never
   stored, so it cannot go stale against the record it describes.

   `ceiling` is respected: offering to make a job autonomous under an account
   that holds everything at "ask first" would be offering something that cannot
   happen, and a person who accepted it would have been lied to twice. */
function _offerFor(rec, item){
  if(!item || item.active === false) return null;
  const t = _tallyOf(rec, item.id);
  if(t.offered) return null;
  const ceiling = _autoApprovalOf(rec && rec.ceiling, 'auto');
  if(t.no >= OFFER_AFTER_NO) return {
    job: item.id, kind: 'pause', count: t.no,
    say: 'You have turned down what this job produced ' + t.no + ' times in a row. '
       + 'It runs whether or not you use the result, so it is costing you money to make something '
       + 'you keep throwing away. Pause it?',
    accept: 'Pause it', decline: 'Keep it running',
  };
  if(t.yes >= OFFER_AFTER_YES && String(item.approval || 'require') !== 'auto' && ceiling === 'auto') return {
    job: item.id, kind: 'auto', count: t.yes,
    say: 'You have approved this job ' + t.yes + ' times in a row without changing anything. '
       + 'AMV can deliver it without asking from now on. You can put it back to asking at any time, '
       + 'and nothing else about the job changes.',
    accept: 'Stop asking me', decline: 'Keep asking',
  };
  /* WHAT A RUN OF "NOT WORTH TELLING ME" EARNS.

     One offer, chosen by what the job actually does, rather than a menu. A
     three-way choice about a notification somebody did not want is itself an
     interruption, and the whole point is to make the product quieter.

     The job emails: the complaint is almost certainly the email, so the offer
     is to stop emailing and leave the results in AMV - the smallest change that
     answers what they said. The job is already in-app only: there is no
     interruption left to remove, so what is left is a job costing money to
     produce something they have told AMV three times running they do not want.
     That one is offered a pause.

     Placed ABOVE the repeat offer so an explicit answer beats an inference. */
  const f = _feelOf(rec, item.id);
  if(!f.offered && f.down >= OFFER_AFTER_MEH) return {
    job: item.id, kind: item.notify === 'email' ? 'inapp' : 'stop', count: f.down,
    say: item.notify === 'email'
      ? 'You have told AMV this was not worth telling you about ' + f.down + ' times in a row. '
        + 'It can keep running and stop emailing you - every result still lands in AMV, so nothing '
        + 'is lost and nothing arrives uninvited.'
      : 'You have told AMV this was not worth telling you about ' + f.down + ' times in a row. '
        + 'It still runs, and running it costs you money to produce something you keep saying you '
        + 'do not want. Pause it?',
    accept: item.notify === 'email' ? 'Stop emailing me this' : 'Pause it',
    decline: item.notify === 'email' ? 'Keep emailing me' : 'Keep it running',
  };
  /* AND THE OTHER DIRECTION, which is what stops this being a one-way ratchet.

     They accepted "email me only when it changes", and then said a result they
     were NOT emailed about was worth telling them. That is direct evidence the
     suppression was the wrong call, from the only person who can judge it, so
     AMV offers to undo its own bargain rather than waiting to be found in a
     settings screen. */
  if(!f.offered && item.quietUnchanged && f.up >= OFFER_AFTER_MEH) return {
    job: item.id, kind: 'unquiet', count: f.up,
    say: 'AMV has been holding this back when the answer does not change, and you have said the '
       + 'last ' + f.up + ' were worth telling you about. That was AMV\u2019s call and it looks wrong. '
       + 'Go back to emailing you every time?',
    accept: 'Email me every time', decline: 'Leave it as it is',
  };

  /* THE QUIET OFFER, AND WHY IT IS AN OFFER.

     A job that has produced the same text several mornings running is not
     telling anybody anything, and it is the clearest case in the product for
     not sending an email. It is still not AMV's call: the person said "email me
     daily", and deciding on their behalf that they did not mean it is how an
     account is lost. Nothing is suppressed until they tap.

     Only offered for a job set to email, because in-app results are not an
     interruption and there is nothing to trade away. */
  if(item.notify === 'email' && !item.quietUnchanged
     && (Number(item.sameRuns) || 0) >= OFFER_AFTER_SAME) return {
    job: item.id, kind: 'quiet', count: (Number(item.sameRuns) || 0) + 1,
    say: 'This job has said exactly the same thing ' + ((Number(item.sameRuns) || 0) + 1)
       + ' times in a row. AMV can keep running it every time and email you only when the answer '
       + 'actually changes - every run still lands in AMV either way, so you lose nothing by looking.',
    accept: 'Email me when it changes', decline: 'Email me every time',
  };
  return null;
}

/* ── THE CANCELLATION ITSELF ───────────────────────────────────────────────
   OPTION (a), AND EXACTLY WHAT IT IS.

   The owner's decision was (a) now, (c) as the path, (b) never - see
   docs/ROADMAP.md for why the bounded-unattended-send middle option is the
   trap rather than the compromise. What (a) means in code is this: an
   unattended run may build this and may not send it. That is not a rule
   somebody has to remember, it is `AUTO_USES_ALLOWED`, which does not contain
   `mail.send` - so the draft below can only ever reach a person, and the send
   happens on a path a human pressed a button on.

   THE LETTER IS WRITTEN HERE, NOT BY A MODEL. A cancellation is a legal-ish
   statement about somebody's money and it has exactly one job; a generated one
   would be fluent, would vary run to run, and would occasionally hedge - and a
   hedged cancellation is a cancellation the other side can decline to act on.
   The figures come from `_detectSubscriptions`, which reads them by rule, so
   nothing in this text is estimated either.

   It asks for two things the person actually needs and would forget to ask
   for: written confirmation, and the date billing stops. Without those, "I
   cancelled it" is a belief rather than a fact. */
const CANCEL_BODY_MAX = 1200;
function _cancelDraft(sub, accountEmail){
  const s = sub || {};
  const merchant = String(s.merchant || 'your service').slice(0, 60);
  const money = (s.amount !== null && s.amount !== undefined && s.currency)
    ? (s.currency + ' ' + Number(s.amount).toFixed(2)) : '';
  const every = s.cadence ? (' ' + s.cadence) : '';
  /* What is claimed is only what was read. No amount and no cadence means the
     letter simply does not mention them, rather than describing a charge in
     terms nobody verified. */
  const charge = money
    ? ('the' + every + ' charge of ' + money)
    : (s.cadence ? ('the' + every + ' charge') : 'the recurring charge');

  const lines = [
    'Hello,',
    '',
    'Please cancel my subscription and stop ' + charge + ' on this account'
      + (s.evidence ? ' (most recently: "' + String(s.evidence).slice(0, 120) + '")' : '') + '.',
    '',
    'Please confirm in writing that it is cancelled, and tell me the date the '
      + 'last billing period ends so I know when charges stop.',
    '',
    'If this address is not the right one for cancellations, please forward '
      + 'this or tell me where to send it.',
    '',
    'Thank you,',
    String(accountEmail || ''),
  ];
  return {
    subject: ('Cancel my subscription - ' + merchant).slice(0, 160),
    body: lines.join('\n').slice(0, CANCEL_BODY_MAX),
    to: String(s.from || ''),
    merchant,
  };
}

/* WHETHER SENDING IT CAN DO ANYTHING, IN WORDS THE PERSON CAN ACT ON.

   Three answers, and the middle one is the one that matters. A draft addressed
   to an unattended mailbox is not a smaller version of a cancellation - it is
   nothing at all, and presenting it as an action is how somebody stops looking
   for the real cancel button. So it is said before they press anything, on the
   card, with what to do instead.

   None of these three claims the subscription is cancelled. That sentence is
   not available on this route at all: emailing a request and being unbilled
   are different facts, and only (c) - the provider's own API, read back - can
   ever join them. */
function _cancelVerdict(sub){
  const s = sub || {};
  const d = _cancelDeliverable(s.from);
  if(d.why === 'no_address') return {
    can: false, code: 'no_address',
    say: 'AMV could not read a return address off that receipt, so there is nowhere to send this. '
       + 'Cancel it from ' + String(s.merchant || 'the provider') + '\u2019s own account page.',
  };
  if(d.why === 'no_reply') return {
    can: false, code: 'no_reply',
    say: 'That receipt came from ' + String(s.from || 'an unattended mailbox')
       + ', which is not read by anyone - sending this there would do nothing. '
       + 'Cancel it from ' + String(s.merchant || 'the provider') + '\u2019s own account page instead.',
  };
  return {
    can: true, code: 'ok',
    say: 'This goes to ' + String(s.from) + ', the address the receipt came from - not one AMV looked up. '
       + 'It is a request: it asks them to cancel and to confirm in writing. AMV cannot see whether they act on it, '
       + 'so check for their reply, and check your next statement.',
  };
}

/* ── WHAT IT ADDS UP TO ────────────────────────────────────────────────────
   THE NUMBER PEOPLE ACT ON, SO IT HAS TO BE THE RIGHT ONE.

   "You are paying 84 a month" is the sentence that makes somebody go and
   cancel something. Handing a model a list and letting it total that list is
   where this goes wrong quietly - it will add a yearly plan in as though it
   were monthly, and it will add pounds to dollars and put one symbol on the
   answer. So the arithmetic is done here, and what cannot be added is left
   out and COUNTED rather than folded in.

   Three rules, each of which is a way somebody would otherwise be told a wrong
   number about their own money:

   1. CURRENCIES ARE NEVER SUMMED. A total mixing GBP and USD is wrong in both.
      They are grouped, always, however inconvenient that is to display.
   2. A charge with no cadence is NOT assumed monthly. Assuming would report a
      yearly plan at twelve times its cost, which is the single largest error
      available here and it points at alarming somebody.
   3. A charge with no amount is not estimated from the others. It is counted
      as unknown so the answer can say "and three more I could not price".

   A month is 52/12 weeks, not four. Four is wrong by eight per cent - a whole
   month of a weekly subscription over a year - and it is wrong in the
   comfortable direction, which is how it survives review. */
const _SUB_PER_MONTH = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

function _subTotals(rows){
  const by = new Map();
  let priced = 0, noAmount = 0, noCadence = 0;
  for(const r of (Array.isArray(rows) ? rows : [])){
    if(!r) continue;
    if(r.amount === null || r.amount === undefined){ noAmount++; continue; }
    const per = _SUB_PER_MONTH[r.cadence];
    if(!per){ noCadence++; continue; }
    const cur = String(r.currency || '');
    if(!cur){ noAmount++; continue; }   /* money with no currency is not money */
    const e = by.get(cur) || { currency: cur, monthly: 0, count: 0 };
    /* Summed first, rounded once at the end. Rounding each row and then adding
       accumulates the error rather than removing it. */
    e.monthly += r.amount * per;
    e.count++;
    by.set(cur, e);
    priced++;
  }
  const byCurrency = [...by.values()]
    .map(e => ({ currency: e.currency, count: e.count,
                 monthly: Math.round(e.monthly * 100) / 100,
                 yearly: Math.round(e.monthly * 12 * 100) / 100 }))
    .sort((a, b) => b.monthly - a.monthly || a.currency.localeCompare(b.currency));
  return { byCurrency, priced, noAmount, noCadence };
}

/* One pass over what the mailbox already handed us. Nothing is fetched, so
   this costs no request and no token; it is reading text that was read
   anyway. */
/* ── THE SAME QUESTION, ASKED OF THE BANK ─────────────────────────────────

   `_detectSubscriptions` reads receipt emails, and that is an inference: the
   figure in a receipt is what a merchant SAID, in the month they said it, and
   a price rise announced in one message is invisible until the next one
   arrives. A bank transaction is what actually left the account. Where both
   exist the bank is simply better evidence, and "AMV found four subscriptions
   costing you 631 a year" stops being a reading of somebody's mail and becomes
   a statement about their money.

   IT STAYS DETERMINISTIC, for the reason written above `_SUB_RECUR_RE`: this
   is money, a model handed a list of charges will produce a confident number,
   and somebody then cancels the wrong thing. Nothing here asks a model
   anything. Recurrence is decided by arithmetic on dates and amounts, and
   every row can be pointed at the exact charges it came from.

   THE FALSE POSITIVE IS STILL THE EXPENSIVE ONE, so the bar is deliberately
   high: at least two charges to the same merchant, amounts within 5% of each
   other, and spacing that matches a real cadence inside a tolerance. Two
   unrelated purchases from the same shop are not a subscription, and a shop
   somebody happens to visit monthly is not either unless the amount holds.

   Currency is carried per row and never normalised - `_subTotals` already
   totals by currency, because adding euros to yen produces a number that is
   wrong in every currency. */
const _TXN_CADENCE = [
  { name:'weekly',  days:7,   tol:2 },
  { name:'monthly', days:30,  tol:4 },
  { name:'yearly',  days:365, tol:14 },
];
/* Same merchant, whatever the statement happened to append to it. Bank
   descriptors carry store numbers, cities and reference codes that differ per
   charge, so a raw string match would see one subscription as several. */
function _txnMerchant(t){
  const raw = String((t && (t.merchant_name || t.name)) || '').trim();
  if(!raw) return '';
  return raw
    .replace(/\s+#?\d{3,}\b/g, ' ')            // store or reference numbers
    .replace(/\b(?:pos|dbt|crd|ach|recur+ing|payment|purchase|visa|mastercard)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}&.' -]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 60);
}
function _txnDay(t){
  const d = Date.parse(String((t && (t.authorized_date || t.date)) || '') + 'T00:00:00Z');
  return Number.isFinite(d) ? Math.floor(d / 86400000) : null;
}
function _detectSubscriptionsFromTxns(txns){
  const byMerchant = new Map();
  for(const t of (Array.isArray(txns) ? txns : [])){
    /* Money OUT only. Plaid reports a debit as a positive amount and a refund
       or deposit as a negative one, so a credit is not a subscription and a
       refund must not cancel one out of existence either. */
    /* A pending charge and the posted one that replaces it are two rows for
       one payment. Counting both inflates the charge count this row reports as
       its evidence, and evidence that overstates itself is the thing the whole
       deterministic path exists to avoid. */
    if(t && t.pending) continue;
    const amt = Number(t && t.amount);
    if(!Number.isFinite(amt) || amt <= 0) continue;
    const merchant = _txnMerchant(t);
    if(!merchant) continue;
    const day = _txnDay(t);
    if(day === null) continue;
    const cur = String((t && t.iso_currency_code) || (t && t.unofficial_currency_code) || 'USD');
    const key = merchant.toLowerCase() + '|' + cur;
    if(!byMerchant.has(key)) byMerchant.set(key, { merchant, currency: cur, rows: [] });
    byMerchant.get(key).rows.push({ amount: amt, day });
  }
  const out = [];
  for(const g of byMerchant.values()){
    if(g.rows.length < 2) continue;
    g.rows.sort((a, b) => a.day - b.day);
    /* The amount has to hold. A merchant charged 4.99 then 71.00 is somebody
       shopping, not a subscription renewing. */
    const amounts = g.rows.map(r => r.amount);
    const mid = amounts.slice().sort((a, b) => a - b)[Math.floor(amounts.length / 2)];
    const steady = amounts.filter(a => Math.abs(a - mid) <= Math.max(0.01, mid * 0.05));
    if(steady.length < 2) continue;
    /* And the spacing has to match a cadence somebody would recognise. */
    const gaps = [];
    for(let i = 1; i < g.rows.length; i++) gaps.push(g.rows[i].day - g.rows[i - 1].day);
    let cadence = null;
    for(const c of _TXN_CADENCE){
      if(gaps.some(gp => Math.abs(gp - c.days) <= c.tol)){ cadence = c.name; break; }
    }
    if(!cadence) continue;
    const last = g.rows[g.rows.length - 1];
    out.push({
      merchant: g.merchant,
      amount: Math.round(mid * 100) / 100,
      currency: g.currency,
      cadence,
      /* Provenance, so the answer can say where the figure came from rather
         than presenting an exact charge and an inferred one as equals. */
      source: 'bank',
      charges: g.rows.length,
      evidence: g.rows.length + ' charges, last ' + new Date(last.day * 86400000).toISOString().slice(0, 10),
      from: '', deliverable: false,
    });
  }
  return out;
}

/* Bank rows win where a merchant appears in both. An exact debit is better
   evidence than a receipt, and a receipt with no amount is worse than either -
   but the mail row's cancellation address is kept, because that is the one
   thing the bank cannot supply. */
function _mergeSubscriptionSources(mailRows, bankRows){
  const out = (Array.isArray(bankRows) ? bankRows.slice() : []);
  const seen = new Set(out.map(r => String(r.merchant || '').toLowerCase()));
  for(const m of (Array.isArray(mailRows) ? mailRows : [])){
    const key = String(m.merchant || '').toLowerCase();
    const hit = seen.has(key) ? out.find(r => String(r.merchant || '').toLowerCase() === key) : null;
    if(hit){
      if(!hit.from && m.from){ hit.from = m.from; hit.deliverable = !!m.deliverable; }
      if(!hit.cadence && m.cadence) hit.cadence = m.cadence;
      continue;
    }
    seen.add(key);
    out.push(Object.assign({ source: 'mail' }, m));
  }
  return out;
}

function _detectSubscriptions(mail){
  const out = [];
  const seen = new Set();
  for(const m of (Array.isArray(mail) ? mail : [])){
    const line = String(m && m.subject || '') + ' — ' + String(m && m.snippet || '');
    if(!_SUB_RECUR_RE.test(line)) continue;
    if(_SUB_NEGATIVE_RE.test(line)) continue;
    const merchant = _subMerchant(m && m.from);
    if(!merchant) continue;
    const money = _SUB_CHARGE_RE.test(line) ? _subMoney(line) : null;
    let cadence = null;
    for(const [re, name] of _SUB_CADENCE){ if(re.test(line)){ cadence = name; break; } }
    /* One row per merchant: a provider that sends a receipt and a reminder for
       the same charge is one subscription, and listing it twice makes a total
       that is wrong in the direction of alarming somebody. The row that wins is
       the one that actually carries an amount. */
    const key = merchant.toLowerCase();
    const prev = seen.has(key) ? out.find(x => x.merchant.toLowerCase() === key) : null;
    if(prev){
      if(prev.amount === null && money){ prev.amount = money.amount; prev.currency = money.currency; prev.evidence = String(m && m.subject || '').slice(0, 120); }
      if(!prev.cadence && cadence) prev.cadence = cadence;
      /* A merchant that writes from a real mailbox as well as a no-reply one
         should be remembered by the address somebody can actually reply to.
         Upgrade only: a later no-reply must not overwrite a usable address, or
         the answer would depend on which receipt happened to arrive last. */
      if(!prev.deliverable){
        const alt = _subFromAddr(m && m.from);
        if(alt && _cancelDeliverable(alt).ok){ prev.from = alt; prev.deliverable = true; }
        else if(!prev.from && alt) prev.from = alt;
      }
      continue;
    }
    seen.add(key);
    const addr = _subFromAddr(m && m.from);
    out.push({
      merchant,
      amount: money ? money.amount : null,
      currency: money ? money.currency : null,
      cadence,
      at: Number(m && m.occurred_at) || 0,
      /* The only address a cancellation may be sent to, and where it came
         from. Carried on the row rather than looked up later, because looking
         it up later means looking it up somewhere other than the message. */
      from: addr,
      deliverable: _cancelDeliverable(addr).ok,
      /* The line this came from, so every figure can be checked against the
         message rather than believed. */
      evidence: String(m && m.subject || '').slice(0, 120),
    });
    if(out.length >= SUB_MAX) break;
  }
  return out;
}


/* WHERE EACH SOURCE GOT TO, AND WHAT IT HAS ALREADY SAID.

   Until this existed, every scheduled run asked Gmail for the newest 25 INBOX
   messages and handed all of them to the model, whatever it had seen before.
   Two failures came out of that, and the second is the serious one:

   1. A daily job reported the SAME message every day until it fell out of the
      top 25. "What needs a reply" answered with yesterday's answer, so the
      person learned to skim it, which is how the one new thing gets missed.
   2. If more than 25 arrived between runs, the older ones were never seen -
      and nothing recorded that they had been missed. The run read as complete.
      An inbox digest that quietly reports on a fraction looks identical to an
      inbox with nothing else in it.

   So each source keeps three things per account:

     cursor  the highest occurred_at actually DELIVERED to the person. Not the
             newest message seen, and never arrival time - a redelivery has a
             new arrival time and the same fact.
     seen    a bounded ring of source ids already reported. The fetch overlaps
             the cursor by a couple of minutes on purpose, because a boundary
             that has to be exact is a boundary that loses a message; the ring
             removes the overlap rather than trusting the arithmetic.
     gap     set when the window could not be read back to the cursor. It is
             stated to the model in words rather than logged, for the same
             reason `_fetchClassroom` names the classes it could not read.

   Within one source's bucket the source id IS the deduplication key - the
   connector and account are implied by which bucket it is in, so the hashed
   composite in the event model would only make the same statement in a form
   nobody can read in a stored record. */
const INGEST_SEEN_MAX = 300;
/* The fetch reaches back slightly BEFORE the cursor. Gmail's `after:` is a
   coarse instrument and clocks differ; asking for exactly what we do not have
   is how one message falls down the crack between two runs. Overlap, then
   dedupe. */
const INGEST_OVERLAP_MS = 120000;
const INGEST_SRC_MAIL = 'google.mail';

const _ingestEmpty = () => ({ v: 1, src: {} });

/* "COULD NOT BE READ" FALLS TOWARDS REPEATING, AND THIS ONE HEALS.

   AMV-012 says a record that could not be read must never be written over,
   because the original is then lost. That rule is about records that hold
   something - a wallet, an entitlement. This one holds a cursor and a list of
   ids AMV has already mentioned, and it is derived: everything in it can be
   rebuilt by simply reporting the newest mail again.

   So the trade runs the other way here, and deliberately. Refusing to write
   would leave a corrupt record corrupt for ever, which means deduplication
   never works again for that account - the daily repeat comes back and nothing
   ever fixes it. Replacing it costs exactly one repeated digest.

   What must never happen is the third option: treating an unreadable record as
   "has seen everything", which would silently drop mail. `DB.get` returns null
   for a corrupt value (audited and alerted, see its own comment) and the empty
   state means "has seen nothing", so the failure lands on the repeat. */
async function _ingestRead(env, email){
  const rec = await DB.get(env, 'ingest', String(email || '').toLowerCase());
  return rec && rec.src ? rec : _ingestEmpty();
}

async function _fetchGmailHeads(token, opts){
  const o = opts || {};
  const max = Math.max(1, Math.min(AUTO_MAIL_MAX, Number(o.max) || AUTO_MAIL_MAX));
  let url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=' + max + '&labelIds=INBOX';
  /* Two windows, and the second is what makes a missed batch recoverable.

     `since` walks FORWARD from the cursor - ordinary "what is new". `until`
     bounds the window from above, which is the only way to reach mail OLDER
     than what has already been reported: Gmail answers newest-first and caps
     the page, so a burst bigger than one page leaves a hole BELOW the newest
     25 and `after:` alone will return that same newest 25 for ever. */
  const since = Number(o.since) || 0;
  const until = Number(o.until) || 0;
  const q = [];
  /* The overlap belongs to the FRONTIER fetch only. It exists so a message
     landing either side of "now" is not lost between two runs - a real risk
     at a moving edge. A backfill is bounded on both sides and its lower bound
     is a cursor already trusted, so widening it there buys nothing and costs
     real page slots: the window fills up with mail that was reported long ago,
     and the walk crawls instead of converging. */
  if(since > 0) q.push('after:' + Math.floor(Math.max(0, until > 0 ? since : since - INGEST_OVERLAP_MS) / 1000));
  /* Ceil, so the boundary message itself is excluded rather than fetched again
     on every backfill pass - the one direction where an off-by-one does not
     just cost a duplicate, it stops the backfill making progress. */
  if(until > 0) q.push('before:' + Math.ceil(until / 1000));
  if(q.length) url += '&q=' + encodeURIComponent(q.join(' '));
  const r = await fetchDeadline(url, { headers: { Authorization: 'Bearer ' + token } }, 15000);
  if(!r.ok) throw new Error('gmail_' + r.status);
  const d = await r.json().catch(()=>({}));
  const ids = (d.messages || []).slice(0, max);
  const out = [];
  for(const m of ids){
    const mr = await fetchDeadline(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + m.id +
      '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date',
      { headers: { Authorization: 'Bearer ' + token } }, 10000).catch(()=>null);
    if(!mr || !mr.ok) continue;
    const md = await mr.json().catch(()=>({}));
    const h = (md.payload && md.payload.headers) || [];
    const g = n => (h.find(x => x.name === n) || {}).value || '';
    out.push({ id: String(md.id || m.id || ''),
               /* Gmail's own timestamp for the message, in ms. This is the
                  fact's time; `Date:` is a header the sender wrote and can say
                  anything at all. */
               occurred_at: Number(md.internalDate) || 0,
               from: g('From').slice(0,120), subject: g('Subject').slice(0,160),
               date: g('Date').slice(0,40),
               /* The snippet is Gmail's own one-line preview. Enough to judge
                  whether something needs a reply; not the message. */
               snippet: String(md.snippet || '').slice(0, AUTO_SNIPPET_MAX),
               unread: Array.isArray(md.labelIds) && md.labelIds.indexOf('UNREAD') >= 0 });
  }
  /* A full page means Gmail had at least this many in the window and may have
     had more. That is the only honest signal available without paging the
     whole history, and paging somebody's inbox because we happen to hold a
     token is exactly what the event model says not to do. */
  return { items: out, capped: (d.messages || []).length >= max };
}

async function _fetchCalendar(token){
  const now = new Date();
  const end = new Date(Date.now() + 7 * 86400000);
  const r = await fetchDeadline(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime' +
    '&maxResults=' + AUTO_EVENTS_MAX +
    '&timeMin=' + encodeURIComponent(now.toISOString()) +
    '&timeMax=' + encodeURIComponent(end.toISOString()),
    { headers: { Authorization: 'Bearer ' + token } }, 15000);
  if(!r.ok) throw new Error('calendar_' + r.status);
  const d = await r.json().catch(()=>({}));
  return (d.items || []).slice(0, AUTO_EVENTS_MAX).map(e => ({
    title: String(e.summary || '(no title)').slice(0, 140),
    start: (e.start && (e.start.dateTime || e.start.date)) || '',
    end: (e.end && (e.end.dateTime || e.end.date)) || '',
    where: String(e.location || '').slice(0, 100),
    guests: Array.isArray(e.attendees) ? e.attendees.length : 0,
  }));
}

const AUTO_COURSES_MAX = 12;
const AUTO_WORK_PER_COURSE = 30;

