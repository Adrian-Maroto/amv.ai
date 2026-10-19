/* ═══════════════════════════════════════════════════════════════════════
   WHAT THIS RUN NEEDS, ASKED BEFORE IT RUNS.

   A scheduled job discovers what it needs while it is running, and until now
   it had no way to say so. "Every day at 7pm check Canvas and do my work"
   needs different things on different days: Monday's quiz needs nothing but
   the Canvas token, Tuesday's essay needs Drive to make a copy of the
   worksheet, Thursday's group project needs an address to send it to. A job
   that cannot ask for the second and third half-finishes, and the person finds
   out by looking.

   So the question is asked PER RUN. The set is computed from this run's own
   instruction and from whatever the run has already discovered, every time it
   fires - which is the only way Tuesday can ask for something Monday did not.

   Three rules, each a real failure in the keyword check this replaces:

     - it runs on the SERVER, because the cron has no browser and unattended
       work is exactly where this matters;
     - it is asked BEFORE any money is spent, so a run that cannot finish does
       not bill somebody for the half that worked;
     - a run stopped for a missing permission is NOT a failure. Failures count
       towards switching a job off after five, and somebody who has not pasted
       a token yet has not broken anything.

   And it only claims what the SERVER can actually check. Google, mail and
   Canvas are held here and are genuinely verifiable. GitHub and Slack are
   connected in the browser and nowhere else, so a scheduled run cannot use
   them at all - and saying that plainly is better than a nightly job quietly
   producing text that goes nowhere, which is what happened before.
   ═══════════════════════════════════════════════════════════════════════ */

const AUTO_CAPABILITIES = [
  { id: 'google', label: 'use your Google account (Drive, Docs, Calendar or Gmail)',
    needs: 'your Google account connected to AMV',
    where: 'Integrations, then Google',
    match: /\b(gmail|google|drive|docs?|sheets?|spreadsheet|slides|calendar|meeting|appointment)\b/i,
    has: (c) => !!c.google },

  { id: 'mail', label: 'read your inbox or send from it',
    needs: 'your mailbox connected, using the app password your provider gives you',
    where: 'Integrations, then Mail worldwide',
    /* NOT the bare word "email". "Email me a summary" is a DELIVERY
       instruction, already handled by the job's notify setting, and matching it
       blocked jobs that never needed a mailbox at all - which is how a
       permission check stops being useful and starts being something people
       route around. This asks for reading or replying to somebody's own
       mailbox, which is the only thing that actually needs the credential. */
    match: /\b(my (?:e-?mails?|inbox|mailbox)|inbox|unread|reply to|read (?:my )?e-?mails?|check (?:my )?(?:e-?mail|mail)|qq ?mail|163 ?mail|naver|yandex|gmx)\b/i,
    has: (c) => !!c.mail },

  { id: 'school', label: 'read your Canvas coursework',
    needs: 'your school’s Canvas address and an access token',
    where: 'Integrations, then Canvas LMS',
    match: /\b(canvas|assignment|homework|coursework|lms|my class(?:es)?|due (?:today|tomorrow|this week))\b/i,
    has: (c) => !!c.school },

  /* Not an integration - a fact only the person has. A job told to send its
     work somewhere cannot invent the address, and the old behaviour was to
     produce the work and stop, without saying why. Satisfied by an address in
     the instruction itself, or by Canvas being connected, since AMV can look a
     course's teacher up there. */
  { id: 'recipient', label: 'send this to somebody',
    needs: 'the address it should go to - put it in the job’s instructions, or connect Canvas so AMV can look your teacher up',
    where: 'the job itself',
    match: /\b(send (?:it|this|them)?\s?(?:to|off)|submit (?:it|this)|hand (?:it )?in|email (?:it|this) to|email (?:my|the) (?:teacher|professor|tutor|boss|manager))\b/i,
    has: (c, item) => /[^@\s]+@[^@\s]+\.[^@\s]+/.test(String((item && item.detail) || '')) || !!c.school },

  /* GitHub is a Connected account, held on the server like Google, so a
     scheduled run CAN read a repository through it (`repo.read`). This row
     used to say it was connected in the browser only - true once, and left
     standing after it stopped being true, so a job watching a repository was
     told to connect an account the person had already connected. Reading is
     all a run does: an unattended run never changes a repository (owner
     decision #6), it writes text a person approves. */
  { id: 'github', label: 'read your GitHub repositories',
    needs: 'your GitHub account connected to AMV with permission to read repositories',
    where: 'Integrations, then GitHub',
    match: /\b(github|pull request|\bpr\b|repository|repo|commit|merge)\b/i,
    has: (c) => Array.isArray(c.scopes) && c.scopes.includes('repo.read') },
  /* Connected in the browser and nowhere else, so the cron genuinely cannot
     reach it. Stated rather than silently skipped. */
  { id: 'slack', label: 'post to Slack',
    needs: 'Slack connected on the server - today it is connected in your browser only, so scheduled runs cannot reach it',
    where: 'Integrations, then Slack',
    match: /\b(slack|post to (?:the )?channel|#[a-z0-9_-]{2,})\b/i,
    has: () => false, browserOnly: true },

  /* THE ONE CAPABILITY WITH NO TEXT MATCHER, and that is deliberate.

     Every other row above fires on words in the instruction. That cannot work
     here: "spending", "my money" and "what am I paying for" are things people
     ask expecting an answer from receipts, so a matcher would gate jobs that
     never needed a bank - and, worse, would be the signal that starts an
     unattended bank read off a typed phrase. `AUTO_USES_FROM_TEXT` refuses to
     derive `bank.read` for exactly that reason.

     So the signal is the DECLARATION: a job that asked for `bank.read` gets
     checked, and nothing else does. `_autoNeedsFor` seeds it from `item.uses`,
     which is the same list `_autoAccountContext` walks - so the screen that
     says "this will need X" and the runner that opens X are answering off one
     field instead of two, which is the failure mode this file has hit before.

     A regex that can never match, rather than no `match` key, because every
     other row has one and the shape is what the coverage suite reads. */
  { id: 'bank', label: 'read your real balances and transactions',
    needs: 'a bank account linked to AMV - the sign-in happens on your bank’s own page and AMV never sees your password',
    where: 'Spending, then Link an account',
    match: /(?!)/,
    has: (c) => !!c.bank },
];
/* The one bridge between a declared `use` and the gate's capabilities.

   Only `bank.read` and `repo.read` are here, on purpose - each has exactly
   one provider behind it, so the declared use and the row ask the same
   question. Mapping the others would look tidier
   and would break them: a calendar granted through Microsoft carries
   `calendar.read` with no Google connection behind it, and the row that would
   catch it asks for `c.google` - so the gate would tell somebody to connect an
   account they do not need and do not have. The text matchers already answer
   correctly for those. This exists for the one capability that has no text
   matcher at all. */
const AUTO_USE_TO_CAPABILITY = { 'bank.read': 'bank', 'repo.read': 'github' };

/* One pass over what this person has, so resolving a run's needs is a fixed
   handful of reads rather than one per capability - the tick runs this for
   every due job and the cost has to be flat. */
async function _autoConnected(env, email) {
  const get = async (kind) => { try { return await DB.get(env, kind, email); } catch (e) { return null; } };
  const [mail, school, conns, fin] = await Promise.all([
    get('mailcfg'), get('school'), get(CONN_KV), get('fin')]);

  /* WHAT THE PERSON HAS ACTUALLY CONNECTED, asked of the record that holds it.

     This used to answer from `goauth:` and `mailcfg:` alone. `goauth` is where
     `googleOAuthExchange` stored a refresh token - and that route was DELETED
     when Connected accounts replaced it, deliberately, because an endpoint that
     hands a provider token to a page is one somebody finds a use for. So
     nothing has written `goauth:` since, and `connected.google` was false for
     every account in existence.

     The effect was not a subtle one. `_autoNeedsFor` refuses a job whose text
     mentions Gmail, Drive, Docs, Calendar or a meeting unless `google` is true,
     so every calendar job and every mailbox job in the catalogue told people to
     connect an account they had already connected - while the READER, which
     goes through `connUse` and the `conn:` record, could have read it perfectly.
     A permission gate consulting a store nothing writes is a gate that is
     always shut.

     `mailcfg:` and `school:` are still ORed in, because those stores are still
     written - somebody whose mailbox is connected with an app password has a
     real connection, and it is not this function's business to decide theirs
     has stopped counting. `goauth:` is NOT, and that distinction is the whole
     lesson: a fallback to a store nothing writes can never fire, so keeping it
     does not make the function more forgiving, it makes it look like it has a
     safety net it does not have. (The dead branch also read `g.refresh_token`
     while the only other reader of that record writes `g.refreshToken` - two
     spellings of a field nobody could have been reading.) The gate stage 'No
     decision is read out of a store nothing writes' now refuses to let it
     back. */
  const byProvider = new Set();
  const scopes = new Set();
  for(const k of Object.keys(conns || {})){
    const c = conns[k];
    if(!c) continue;
    if(c.provider) byProvider.add(String(c.provider));
    if(Array.isArray(c.scopes)) c.scopes.forEach(s => scopes.add(String(s)));
  }

  return {
    google: byProvider.has('google'),
    mail:   scopes.has('mail.read')  || !!(mail && mail.secret),
    school: scopes.has('school.read') || !!(school && school.token),
    /* Asked of the record that actually holds the aggregator token, which is
       the same record `_bankUse` opens. One store, one answer - the gate and
       the runner cannot disagree about whether a bank is linked. */
    bank:   !!(fin && fin.accessToken),
    /* The exact grants, carried so a later, finer check can ask "does this
       connection cover Drive" rather than only "is Google connected" - the
       coarse answer is right for the remedy it prints ("connect your Google
       account") and is not right for ever. */
    scopes: [...scopes],
  };
}

/* What THIS run is missing.

   `extra` is how a run says what it worked out for itself: today's Canvas
   assignment turning out to be an essay adds 'google', even though the job's
   standing instruction never mentioned Drive. That is the whole reason this is
   computed per run rather than once when the job was created. */
function _autoNeedsFor(item, connected, extra) {
  const text = String((item && item.detail) || '');
  const asked = new Set((Array.isArray(extra) ? extra : []).map(String));
  /* What the job DECLARED it opens, folded in through the one table. `boosts`
     is deliberately not read: a source that only improves the answer is not a
     reason to tell somebody their job cannot run. */
  for(const u of (Array.isArray(item && item.uses) ? item.uses : [])){
    const cap = AUTO_USE_TO_CAPABILITY[String(u)];
    if(cap) asked.add(cap);
  }
  const missing = [];
  for (const cap of AUTO_CAPABILITIES) {
    if (!(asked.has(cap.id) || cap.match.test(text))) continue;
    if (cap.has(connected || {}, item)) continue;
    missing.push({ id: cap.id, label: cap.label, needs: cap.needs, where: cap.where,
                   browserOnly: !!cap.browserOnly,
                   why: asked.has(cap.id) ? 'discovered' : 'instruction' });
  }
  return { ready: missing.length === 0, missing };
}

/* The sentence somebody reads against the run that stopped.

   Dated on purpose. A job that runs every night and only tonight needs
   something new is unactionable as "I need access" - the person has to know it
   is TODAY'S run, and which one. */
function _autoNeedsMessage(item, missing, atMs) {
  const when = new Date(atMs || Date.now()).toISOString().slice(0, 10);
  const what = String((item && item.detail) || 'this job').slice(0, 140);
  const lines = missing.map((m) => '  • ' + m.needs + '\n    (so AMV can ' + m.label + ' — add it in ' + m.where + ')');
  return 'Important: AMV needs your permission before it can finish this.\n\n'
       + 'Job: ' + what + '\nRun: ' + when + '\n\n'
       + 'What it needs:\n' + lines.join('\n')
       + '\n\nNothing was run and nothing was charged. Add ' + (missing.length > 1 ? 'these' : 'this')
       + ' and it picks up on the next run.';
}

