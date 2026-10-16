  return json({ ok: true, account: _mailPublic({ provider, address, imap, smtp, connectedAt: Date.now() }) });
}

async function mailDisconnect(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  await DB.del(env, 'mailcfg', user.email);
  audit(env, 'mail_disconnected', { by: user.email });
  return json({ ok: true, connected: false });
}

/* Load a stored connection and put the password back together. Returns null
   when there is nothing stored or the key can no longer read it - a rotated
   MAIL_CRED_KEY makes every stored secret undecryptable, and that has to read
   as "reconnect" rather than as "wrong password". */
async function _mailCfgFor(env, email) {
  const rec = await DB.get(env, 'mailcfg', email);
  if (!rec || !rec.secret) return null;
  const password = await _mailDecrypt(env, rec.secret);
  if (!password) return null;
  return { address: rec.address, password, imap: rec.imap, smtp: rec.smtp,
           /* Records written before STARTTLS existed have neither field, and
              465 implicit TLS is what they were connected with, so that is the
              honest default rather than a guess. */
           smtpPort: rec.smtpPort || MAIL_SMTP_PORT, smtpMode: rec.smtpMode || 'tls',
           provider: rec.provider, rec };
}

async function _mailRun(request, env, work, what) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const g = await guardAction(env, 'mail:' + user.email, 30, 300, what);
  if (g) return g;
  const cfg = await _mailCfgFor(env, user.email);
  if (!cfg) return json({ error: 'No mailbox is connected to AMV yet.', code: 'mail_not_connected' }, 428);
  try {
    const out = await work(cfg, user);
    try { await _withKV(env, 'mailcfg', user.email, (r) => { if (r) { r.lastOkAt = Date.now(); r.lastError = ''; } }); } catch (e) {}
    return json(Object.assign({ ok: true }, out));
  } catch (e) {
    const kind = (e && e.kind) || (String(e && e.message) === 'mail_timeout' ? 'timeout' : 'net');
    const fail = _mailFailure(kind, cfg.provider);
    try { await _withKV(env, 'mailcfg', user.email, (r) => { if (r) r.lastError = fail.code; }); } catch (e2) {}
    audit(env, 'mail_failed', { by: user.email, what, kind });
    return json(fail, kind === 'auth' ? 401 : 502);
  }
}

async function mailInbox(request, env) {
  const body = await request.json().catch(() => ({}));
  return _mailRun(request, env, (cfg) => _imapInbox(cfg, body.limit), 'inbox reads');
}

async function mailMessage(request, env) {
  const body = await request.json().catch(() => ({}));
  const uid = +body.uid;
  if (!(uid > 0)) return json({ error: 'Which message?', code: 'bad_uid' }, 400);
  return _mailRun(request, env, (cfg) => _imapMessage(cfg, uid), 'message reads');
}

async function mailSend(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  /* Sending mail as somebody is an outward-facing action, so an account on
     hold does not get to do it. */
  const held = await _accountHold(env, user, 'mail_send');
  if (held) return held;
  const body = await request.json().catch(() => ({}));
  const to = (Array.isArray(body.to) ? body.to : [body.to])
    .map((x) => String(x || '').trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 20);
  if (!to.length) return json({ error: 'Who should this go to?', code: 'bad_to' }, 400);
  const subject = String(body.subject || '').slice(0, 300);
  const text = String(body.text || '').slice(0, 100000);
  if (!text.trim()) return json({ error: 'The message is empty.', code: 'bad_body' }, 400);
  return _mailRun(request, env, async (cfg) => {
    await _smtpSend(cfg, { to, subject, text });
    audit(env, 'mail_sent', { by: user.email, to: to.length, provider: cfg.provider });
    return { sent: true, to };
  }, 'messages sent');
}

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

  /* Connected in the browser and nowhere else, so the cron genuinely cannot
     reach them. Stated rather than silently skipped. */
  { id: 'github', label: 'change a repository',
    needs: 'GitHub connected on the server - today it is connected in your browser only, so scheduled runs cannot reach it',
    where: 'Integrations, then GitHub',
    match: /\b(github|pull request|\bpr\b|repository|repo|commit|merge)\b/i,
    has: () => false, browserOnly: true },
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

   Only `bank.read` is here, on purpose. Mapping the others would look tidier
   and would break them: a calendar granted through Microsoft carries
   `calendar.read` with no Google connection behind it, and the row that would
   catch it asks for `c.google` - so the gate would tell somebody to connect an
   account they do not need and do not have. The text matchers already answer
   correctly for those. This exists for the one capability that has no text
   matcher at all. */
const AUTO_USE_TO_CAPABILITY = { 'bank.read': 'bank' };

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
