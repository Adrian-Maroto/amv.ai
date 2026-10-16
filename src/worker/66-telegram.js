  const f = COUNTRY_FACTS[cc]; if(!f) return '';
  return Object.keys(FACT_LABELS).filter(k => f[k]).map(k => FACT_LABELS[k] + ': ' + f[k]).join('; ');
}


/* Everything AMV can do, per country, derived. */
function _coverage() {
  const mailGlobal = Object.values(MAIL_PROVIDERS).filter((p) => p.global);
  const mailNational = {};
  for (const p of Object.values(MAIL_PROVIDERS)) {
    if (p.global || p.custom || !p.country) continue;
    (mailNational[p.country] = mailNational[p.country] || []).push(p.name);
  }
  const boards = {};
  /* Global boards belong to every country, not to a country called "".
     Without this they collect under an empty code and appear as a country
     with no name on no continent - which the coverage test already refuses,
     and rightly. */
  const boardsGlobal = [];
  for (const [id, b] of Object.entries(JOB_BOARDS)) {
    const row = { id, name: b.name, apply: b.apply };
    if (b.global || !b.country) { boardsGlobal.push(row); continue; }
    (boards[b.country] = boards[b.country] || []).push(row);
  }

  /* A country counts as reached if AMV does ANYTHING there, and the everyday
     jobs are the thing most people would use. Deriving the list from mail and
     boards alone would hide a country that has five jobs written for it behind
     the fact that no national ISP there runs a mail service - while the global
     mail providers and the worldwide boards serve it perfectly well. */
  const codes = new Set([...Object.keys(mailNational), ...Object.keys(boards),
                         ...Object.keys(EVERYDAY_BY_COUNTRY)]);
  const countries = [...codes].map((c) => {
    const jb = boards[c] || [];
    return {
      code: c,
      name: COUNTRY_NAME[c] || c,
      continent: CONTINENT_OF[c] || 'Other',
      mail: { national: (mailNational[c] || []).length, global: mailGlobal.length,
              names: (mailNational[c] || []).slice(0, 4) },
      jobs: { boards: jb.length, global: boardsGlobal.length,
              names: jb.slice(0, 4).map((x) => x.name),
              /* The one fact that changes what somebody expects overnight. */
              autoApply: jb.concat(boardsGlobal).some((x) => x.apply === 'email') },
      /* And what somebody there actually does every week. */
      everyday: (EVERYDAY_BY_COUNTRY[c] || []).length + EVERYDAY_UNIVERSAL.length,
    };
  })
  /* BY NAME, not by code. Sorting the two-letter codes put Europe in the
     order Austria, Belgium, Switzerland, Czechia, Germany, Denmark, Spain -
     AT, BE, CH, CZ, DE, DK, ES - which is perfectly ordered and reads as
     random to the one person this page exists for, who is scanning it for
     their own country. localeCompare so accented names sort where a reader
     expects rather than after Z. */
  .sort((a, b) => a.name.localeCompare(b.name));

  const byContinent = {};
  for (const c of countries) (byContinent[c.continent] = byContinent[c.continent] || []).push(c);
  return {
    countries, byContinent,
    totals: {
      countries: countries.length,
      continents: Object.keys(byContinent).length,
      mailProviders: Object.keys(MAIL_PROVIDERS).length,
      jobBoards: Object.keys(JOB_BOARDS).length,
      jobBoardsGlobal: boardsGlobal.length,
      everydayJobs: EVERYDAY_UNIVERSAL.length
        + Object.values(EVERYDAY_BY_COUNTRY).reduce((n, l) => n + l.length, 0),
      /* Said plainly: every country can use mail, because the global providers
         work everywhere. It is the honest headline and it is also true. */
      mailGlobal: mailGlobal.length,
    },
  };
}

async function coverageMap(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  return json(Object.assign({ ok: true }, _coverage()));
}

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

