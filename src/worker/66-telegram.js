/* ═══════════════════════════════════════════════════════════════════════
   TELEGRAM - one integration, and a large part of the world.

   AMV can be reached by text message, which costs money per message and is
   really a United States and Western Europe assumption. Telegram is the
   default messenger across Russia, Ukraine, Iran, much of Central Asia, and
   is enormous in Brazil, India, Indonesia and Nigeria. Its Bot API is
   official, free, needs no business verification, and is a plain HTTPS call -
   which makes it the single widest reach available for the least work.

   It is the person's OWN bot: they create it with @BotFather, paste the
   token, and AMV talks through it. So the messages come from something they
   control and can revoke, and AMV is not a middleman holding one bot that
   every customer shares.
   ═══════════════════════════════════════════════════════════════════════ */

const TELEGRAM_API = 'https://api.telegram.org';

/* The shape BotFather gives out, in one place because two paths depend on it:
   the connect, which checks what somebody pasted, and the send, which checks
   what came back out of storage.

   It is also what makes it safe to put the token straight into the URL. The
   Telegram API is addressed as /bot<token>/METHOD with the token RAW - and a
   token contains a colon, which encodeURIComponent turns into %3A. Every
   character this pattern admits is already legal unencoded in a URL path
   segment (RFC 3986 pchar includes ':'), and nothing that could change the
   path - a slash, a dot segment, a query or a fragment - can get through it.

   NOT verified against Telegram itself: api.telegram.org is unreachable from
   the environment this was written in, so this rests on the documented URL
   form and on the grammar, not on a live call. */
const TELEGRAM_TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;

/* The token is a credential that can send as their bot, so it is encrypted at
   rest exactly like a mailbox password, under the same key. */
async function telegramConnect(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const g = await guardAction(env, 'tgconn:' + user.email, 6, 300, 'Telegram connection attempts');
  if (g) return g;
  if (!(await _mailCredKey(env))) {
    return json({ error: 'AMV cannot store a bot token safely on this deployment yet, so it will not store one at all. MAIL_CRED_KEY has to be set first, to a long random value - at least 24 characters of real randomness, not a phrase.',
                  code: 'needs_service' }, 503);
  }
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  const chatId = String(body.chatId || '').trim().slice(0, 40);
  if (!TELEGRAM_TOKEN_RE.test(token)) {
    return json({ error: 'That does not look like a bot token. BotFather gives you one shaped like 123456789:AA...', code: 'bad_token' }, 400);
  }
  if (!/^-?\d{1,20}$/.test(chatId)) {
    return json({ error: 'AMV needs the chat id to send to. Message your bot once, then open api.telegram.org/bot<token>/getUpdates to find it.', code: 'bad_chat' }, 400);
  }

  /* Proved before it is stored, like the mailbox: a token that fails at 7am
     during a scheduled run is worse than an error while somebody is sitting
     here able to fix it. */
  let who = null;
  try {
    const r = await fetchDeadline(`${TELEGRAM_API}/bot${token}/getMe`, { method: 'GET' }, 10000);
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) {
      return json({ error: 'Telegram refused that token. Check you copied the whole thing from BotFather.', code: 'tg_auth' }, 401);
    }
    who = d.result || {};
  } catch (e) {
    return json({ error: 'AMV could not reach Telegram just now. Nothing was saved - try again in a moment.', code: 'tg_unreachable' }, 502);
  }

  const enc = await _mailEncrypt(env, token);
  if (!enc) return json({ error: 'AMV could not encrypt that token, so it did not store it.', code: 'needs_service' }, 503);
  await _withKV(env, 'telegram', user.email, (rec) => {
    rec.secret = enc; rec.chatId = chatId;
    rec.botName = String(who.username || '').slice(0, 60);
    rec.connectedAt = Date.now();
  }, {});
  audit(env, 'telegram_connected', { by: user.email, bot: String(who.username || '').slice(0, 40) });
  return json({ ok: true, bot: who.username || '', chatId });
}

async function telegramDisconnect(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  await DB.del(env, 'telegram', user.email);
  audit(env, 'telegram_disconnected', { by: user.email });
  return json({ ok: true, connected: false });
}

async function telegramStatus(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const rec = await DB.get(env, 'telegram', user.email);
  /* The token never comes back, in any response. */
  return json({ ok: true, connected: !!(rec && rec.secret),
                bot: (rec && rec.botName) || '', chatId: (rec && rec.chatId) || '' });
}

/* Send, used by the route below and available to scheduled work. */
async function _telegramSend(env, email, text) {
  const rec = await DB.get(env, 'telegram', email);
  if (!rec || !rec.secret) return { sent: false, reason: 'not_connected' };
  const token = await _mailDecrypt(env, rec.secret);
  if (!token) return { sent: false, reason: 'unreadable' };
  /* Checked AGAIN on the way out. The connect proved this token before storing
     it, but what is interpolated here came back from storage rather than from
     the check, and a value that goes into a URL should be proved by the code
     that builds the URL - not by a different function that ran days ago. */
  if (!TELEGRAM_TOKEN_RE.test(token)) return { sent: false, reason: 'unreadable' };
  const form = new URLSearchParams();
  form.set('chat_id', rec.chatId);
  form.set('text', String(text || '').slice(0, 4000));
  form.set('disable_web_page_preview', 'true');
  const r = await fetchDeadline(`${TELEGRAM_API}/bot${token}/sendMessage`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() }, 10000);
  const d = await r.json().catch(() => ({}));
  return { sent: !!(r.ok && d.ok), reason: d.description || '' };
}

async function telegramSend(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const held = await _accountHold(env, user, 'telegram_send');
  if (held) return held;
  const g = await guardAction(env, 'tgsend:' + user.email, 30, 300, 'Telegram messages');
  if (g) return g;
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || '');
  if (!text.trim()) return json({ error: 'The message is empty.', code: 'bad_body' }, 400);
  let out;
  try { out = await _telegramSend(env, user.email, text); }
  catch (e) { return json({ error: 'AMV could not reach Telegram just now.', code: 'tg_unreachable' }, 502); }
  if (!out.sent) {
    if (out.reason === 'not_connected') return json({ error: 'No Telegram bot is connected yet.', code: 'tg_not_connected' }, 428);
    return json({ error: 'Telegram did not accept that message. ' + (out.reason || ''), code: 'tg_failed' }, 502);
  }
  return json({ ok: true, sent: true });
}

