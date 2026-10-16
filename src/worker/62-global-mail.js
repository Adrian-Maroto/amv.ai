/* ═══════════════════════════════════════════════════════════════════════
   GLOBAL MAIL - every integration AMV shipped was American.

   Google, Microsoft 365, Slack, Discord, GitHub, Notion, Canvas. Somebody in
   Chengdu, Seoul, Warsaw or Sao Paulo opens the integrations page and finds
   nothing they use. That is not a marketing gap, it is the product being
   unusable for most of the world.

   Mail is the one that can be fixed properly, because it is the one built on
   an open protocol. QQ Mail, NetEase 163, Naver, Yandex, GMX, Libero, Seznam,
   WP.pl, Rediffmail, UOL and the rest all speak IMAP and SMTP, and all of them
   issue an app password for exactly this. So AMV does not need a partnership
   or an API key from any of them - it needs to speak the protocol, once, and
   then it works everywhere.

   What is deliberately NOT here: WeChat has no API for personal accounts and
   automating one gets it banned; Wallapop has no public API at all. Both were
   asked for. Shipping a fake version of either would break the rule that
   nothing in AMV pretends to work, so they are absent and said out loud rather
   than half-built.
   ═══════════════════════════════════════════════════════════════════════ */

/* WHERE EACH PROVIDER LIVES, AND HOW A PERSON GETS IN.

   `setup` is not documentation padding - it is the field that decides whether
   this feature works for a real person. Every one of these providers uses a
   different word for the same thing and hides it in a different place: QQ
   calls it an authorisation code and puts it behind an SMS check, 163 calls it
   a client authorisation password, Naver makes you switch IMAP on first. A
   person who pastes their ordinary login password gets a failure that looks
   like a bug in AMV, so the instruction has to be right there at the moment
   they are asked for it. */
const MAIL_PROVIDERS = {
  /* ── China ───────────────────────────────────────────────────────── */
  qq:       { name: 'QQ Mail (QQ邮箱)', country: 'CN', flag: '🇨🇳',
              imap: 'imap.qq.com', smtp: 'smtp.qq.com',
              setup: 'Open QQ Mail on the web, go to Settings, Account, and switch on IMAP/SMTP. QQ then sends an SMS and gives you a 16-character authorisation code. Paste that code here, not your QQ password.' },
  netease163:{ name: 'NetEase 163 Mail (网易163邮箱)', country: 'CN', flag: '🇨🇳',
              imap: 'imap.163.com', smtp: 'smtp.163.com',
              setup: 'In 163 Mail go to Settings, POP3/SMTP/IMAP, and switch IMAP on. 163 gives you a client authorisation password (客户端授权密码). Paste that, not your login password.' },
  netease126:{ name: 'NetEase 126 Mail (网易126邮箱)', country: 'CN', flag: '🇨🇳',
              imap: 'imap.126.com', smtp: 'smtp.126.com',
              setup: 'In 126 Mail go to Settings, POP3/SMTP/IMAP, switch IMAP on, and copy the client authorisation password it gives you.' },
  sina:     { name: 'Sina Mail (新浪邮箱)', country: 'CN', flag: '🇨🇳',
              imap: 'imap.sina.com', smtp: 'smtp.sina.com',
              setup: 'In Sina Mail go to Settings, Client / POP3-IMAP-SMTP, and switch IMAP on. Use the authorisation code it shows you.' },
  aliyun:   { name: 'Alibaba Mail (阿里邮箱)', country: 'CN', flag: '🇨🇳',
              imap: 'imap.aliyun.com', smtp: 'smtp.aliyun.com',
              setup: 'In Alibaba Mail settings, enable IMAP and create a client-specific password.' },

  /* ── Korea and Japan ─────────────────────────────────────────────── */
  naver:    { name: 'Naver Mail (네이버 메일)', country: 'KR', flag: '🇰🇷',
              imap: 'imap.naver.com', smtp: 'smtp.naver.com',
              setup: 'In Naver Mail open 환경설정 (Settings), then POP3/IMAP, and set IMAP to 사용함 (on). Naver uses your normal account password once IMAP is enabled, and requires two-factor to be configured.' },
  daum:     { name: 'Daum / Hanmail (다음 한메일)', country: 'KR', flag: '🇰🇷',
              imap: 'imap.daum.net', smtp: 'smtp.daum.net',
              setup: 'In Daum Mail settings, open IMAP/POP3 and switch IMAP on.' },
  yahoojp:  { name: 'Yahoo! Japan Mail (ヤフーメール)', country: 'JP', flag: '🇯🇵',
              imap: 'imap.mail.yahoo.co.jp', smtp: 'smtp.mail.yahoo.co.jp',
              setup: 'In Yahoo! Japan Mail settings, enable IMAP/SMTP access and create a separate app password (アプリパスワード).' },

  /* ── Russia, Ukraine ─────────────────────────────────────────────── */
  yandex:   { name: 'Yandex Mail (Яндекс Почта)', country: 'RU', flag: '🇷🇺',
              imap: 'imap.yandex.com', smtp: 'smtp.yandex.com',
              setup: 'In Yandex ID open Security, then App passwords, and create one for Mail. Paste that app password here, not your account password.' },
  /* Turkey. Mynet Mail's IMAP host no longer exists; after Gmail and Outlook
     the mailbox people in Turkey use is Yandex (yandex.com.tr addresses),
     served by the same Yandex IMAP host as everywhere else. */
  yandextr: { name: 'Yandex Mail (Yandex Posta)', country: 'TR', flag: '🇹🇷',
              imap: 'imap.yandex.com', smtp: 'smtp.yandex.com',
              setup: 'In Yandex ID open Security, then App passwords, and create one for Mail. Paste that app password here, not your account password.' },
  mailru:   { name: 'Mail.ru (Почта Mail.ru)', country: 'RU', flag: '🇷🇺',
              imap: 'imap.mail.ru', smtp: 'smtp.mail.ru',
              setup: 'In Mail.ru open Settings, All settings, Password and security, and create an app password (пароль для внешнего приложения).' },
  ukrnet:   { name: 'UKR.NET', country: 'UA', flag: '🇺🇦',
              imap: 'imap.ukr.net', smtp: 'smtp.ukr.net',
              setup: 'In UKR.NET settings open IMAP/SMTP and generate a password for external programs.' },

  /* ── Germany, Switzerland, Austria ───────────────────────────────── */
  gmx:      { name: 'GMX', country: 'DE', flag: '🇩🇪',
              imap: 'imap.gmx.net', smtp: 'mail.gmx.net',
              setup: 'In GMX open Einstellungen, POP3/IMAP Abruf, and tick the box that allows access by external programs.' },
  webde:    { name: 'WEB.DE', country: 'DE', flag: '🇩🇪',
              imap: 'imap.web.de', smtp: 'smtp.web.de',
              setup: 'In WEB.DE open Einstellungen, POP3/IMAP, and enable access for external mail programs.' },
  tonline:  { name: 'T-Online', country: 'DE', flag: '🇩🇪',
              imap: 'secureimap.t-online.de', smtp: 'securesmtp.t-online.de',
              setup: 'In your Telekom account create an app password (Passwort für E-Mail-Programme) and use that.' },
  bluewin:  { name: 'Bluewin (Swisscom)', country: 'CH', flag: '🇨🇭',
              imap: 'imaps.bluewin.ch', smtp: 'smtpauths.bluewin.ch',
              setup: 'Use your Swisscom login. If you have two-factor on, create an app password in your Swisscom account first.' },

  /* ── France, Belgium, Netherlands ────────────────────────────────── */
  orange:   { name: 'Orange', country: 'FR', flag: '🇫🇷',
              imap: 'imap.orange.fr', smtp: 'smtp.orange.fr',
              setup: 'In your Orange mail settings, enable access by an external client and generate a dedicated password if two-factor is on.' },
  free:     { name: 'Free', country: 'FR', flag: '🇫🇷',
              imap: 'imap.free.fr', smtp: 'smtp.free.fr',
              setup: 'Use your Free account login and password. IMAP is enabled by default.' },
  laposte:  { name: 'La Poste', country: 'FR', flag: '🇫🇷',
              imap: 'imap.laposte.net', smtp: 'smtp.laposte.net',
              setup: 'In your laposte.net mailbox settings, enable IMAP access for external software.' },
  telenet:  { name: 'Telenet', country: 'BE', flag: '🇧🇪',
              imap: 'imap.telenet.be', smtp: 'smtp.telenet.be',
              smtpPort: 587, smtpMode: 'starttls',
              setup: 'Use your Telenet mail address and password. IMAP is available by default.' },
  kpn:      { name: 'KPN Mail', country: 'NL', flag: '🇳🇱',
              imap: 'imap.kpnmail.nl', smtp: 'smtp.kpnmail.nl',
              setup: 'Use your KPN mail address and password.' },
  ziggo:    { name: 'Ziggo', country: 'NL', flag: '🇳🇱',
              imap: 'imap.ziggo.nl', smtp: 'smtp.ziggo.nl',
              setup: 'Use your Ziggo mail address and password.' },

  /* ── Southern Europe ─────────────────────────────────────────────── */
  libero:   { name: 'Libero Mail', country: 'IT', flag: '🇮🇹',
              imap: 'imapmail.libero.it', smtp: 'smtp.libero.it',
              setup: 'Use your Libero address and password. If you have two-factor on, generate an app password in your Libero account first.' },
  tiscali:  { name: 'Tiscali', country: 'IT', flag: '🇮🇹',
              imap: 'imap.tiscali.it', smtp: 'smtp.tiscali.it',
              setup: 'Use your Tiscali address and password.' },
  sapo:     { name: 'SAPO Mail', country: 'PT', flag: '🇵🇹',
              imap: 'imap.sapo.pt', smtp: 'smtp.sapo.pt',
              setup: 'Use your SAPO address and password. IMAP is enabled by default.' },
  telefonica:{ name: 'Movistar / Telefónica', country: 'ES', flag: '🇪🇸',
              imap: 'imap.telefonica.net', smtp: 'smtp.telefonica.net',
              setup: 'Use your Movistar mail address and password.' },

  /* ── Central and Eastern Europe ──────────────────────────────────── */
  seznam:   { name: 'Seznam.cz', country: 'CZ', flag: '🇨🇿',
              imap: 'imap.seznam.cz', smtp: 'smtp.seznam.cz',
              setup: 'In Seznam Email open Nastavení, then POP3/IMAP, and switch IMAP on.' },
  wppl:     { name: 'WP.pl Poczta', country: 'PL', flag: '🇵🇱',
              imap: 'imap.wp.pl', smtp: 'smtp.wp.pl',
              setup: 'In WP Poczta open Ustawienia, Dostęp POP3/IMAP, switch IMAP on, and generate a dedicated password for external programs.' },
  onet:     { name: 'Onet Poczta', country: 'PL', flag: '🇵🇱',
              imap: 'imap.poczta.onet.pl', smtp: 'smtp.poczta.onet.pl',
              setup: 'In Onet Poczta settings enable IMAP and create a password for external applications.' },
  interia:  { name: 'Interia Poczta', country: 'PL', flag: '🇵🇱',
              imap: 'poczta.interia.pl', smtp: 'poczta.interia.pl',
              setup: 'In Interia Poczta settings enable IMAP access for external programs.' },

  /* ── Nordics, UK, Turkey, Israel ─────────────────────────────────── */
  telia:    { name: 'Telia', country: 'SE', flag: '🇸🇪',
              imap: 'mailin.telia.com', smtp: 'mailout.telia.com',
              setup: 'Use your Telia mail address and password.' },
  btinternet:{ name: 'BT Internet', country: 'GB', flag: '🇬🇧',
              imap: 'mail.btinternet.com', smtp: 'mail.btinternet.com',
              setup: 'In your BT Mail settings, create an app password if two-step is on, otherwise use your BT ID password.' },

  /* ── India, Brazil, Africa ───────────────────────────────────────── */
  /* Rediff offers IMAP only on Rediffmail Pro; a free @rediffmail.com
     address cannot be read by any app, and the old imap.rediffmail.com host
     no longer exists. Named as what it is, so nobody on a free account
     tries and gets a failure that looks like a wrong password. */
  rediff:   { name: 'Rediffmail Pro', country: 'IN', flag: '🇮🇳',
              imap: 'imap.rediffmailpro.com', smtp: 'smtp.rediffmailpro.com',
              setup: 'Only Rediffmail Pro accounts can be connected - Rediff does not allow any app to read a free Rediffmail account. Use your Rediffmail Pro address and password.' },
  zoho:     { name: 'Zoho Mail', country: 'IN', flag: '🇮🇳',
              imap: 'imap.zoho.com', smtp: 'smtp.zoho.com',
              setup: 'In Zoho Mail open Settings, Mail Accounts, and enable IMAP. Then create an app-specific password under My Account, Security.' },
  uol:      { name: 'UOL Mail', country: 'BR', flag: '🇧🇷',
              imap: 'imap.uol.com.br', smtp: 'smtps.uol.com.br',
              setup: 'Use your UOL address and password. IMAP is available on UOL Mail accounts.' },
  bol:      { name: 'BOL Mail', country: 'BR', flag: '🇧🇷',
              imap: 'imap.bol.com.br', smtp: 'smtps.bol.com.br',
              setup: 'BOL lets apps read mail only on its paid BOL Completo plan - a free BOL account is webmail only. On BOL Completo, use your BOL address and password.' },
  mweb:     { name: 'Mweb', country: 'ZA', flag: '🇿🇦',
              imap: 'imap.mweb.co.za', smtp: 'smtp.mweb.co.za',
              setup: 'Use your Mweb address and password.' },

  /* ── North America ───────────────────────────────────────────────── */
  comcast:  { name: 'Xfinity (Comcast)', country: 'US', flag: '🇺🇸',
              imap: 'imap.comcast.net', smtp: 'smtp.comcast.net',
              setup: 'In Xfinity settings, turn on third-party access for email programs, then use your Xfinity password.' },
  bell:     { name: 'Bell / Sympatico', country: 'CA', flag: '🇨🇦',
              imap: 'imap.bell.net', smtp: 'smtp.bell.net',
              setup: 'Use your Bell email address and password.' },

  /* ── Oceania ─────────────────────────────────────────────────────── */
  telstra:  { name: 'Telstra (BigPond)', country: 'AU', flag: '🇦🇺',
              imap: 'imap.telstra.com', smtp: 'smtp.telstra.com',
              setup: 'Use your Telstra Mail address and password.' },

  /* ── ONLY REACHABLE NOW THAT SMTP CAN UPGRADE ────────────────────────
     Every one of these offers submission on 587 with STARTTLS and does not
     answer implicit TLS on 465, which is why they were left out of the
     catalogue rather than added with a port that would have failed silently
     at 7am in the middle of a scheduled run. They are consumer ISPs, which
     is to say they are what a large number of ordinary people in Canada,
     Australia and the United States actually have. */
  /* PAUSED, NOT REMOVED. From 29 Sep 2026 the daily connector check
     (tools/connector-health.mjs) found imap.shaw.ca presenting a certificate
     that does not verify (UNABLE_TO_VERIFY_LEAF_SIGNATURE) on three days of
     four - Rogers is folding Shaw mail into its own systems. Turning the check
     off would hand a Shaw customer's password to anyone in the middle, so
     connecting is refused with the reason instead. The daily check keeps
     testing it and prints RESUME when the certificate verifies again; then
     this line comes out. */
  shaw:     { name: 'Shaw / Rogers', country: 'CA', flag: '🇨🇦',
              imap: 'imap.shaw.ca', smtp: 'smtp.shaw.ca', smtpPort: 587, smtpMode: 'starttls',
              setup: 'Use your Shaw email address and password.',
              paused: { since: '2026-09-29', why: 'Shaw’s mail server is presenting a security certificate that does not verify, so AMV will not send your password to it. AMV checks it every day and turns it back on when it verifies again. Meanwhile, you can sign in to Shaw webmail on your own computer from the Connect card.' } },
  telus:    { name: 'TELUS', country: 'CA', flag: '🇨🇦',
              imap: 'imap.telus.net', smtp: 'smtp.telus.net', smtpPort: 587, smtpMode: 'starttls',
              setup: 'Use your TELUS email address and password.' },
  att:      { name: 'AT&T / Yahoo hosted', country: 'US', flag: '🇺🇸',
              imap: 'imap.mail.att.net', smtp: 'smtp.mail.att.net', smtpPort: 587, smtpMode: 'starttls',
              setup: 'AT&T requires a secure mail key rather than your account password. Create one in your AT&T profile under Sign-in info.' },
  spectrum: { name: 'Spectrum (Charter)', country: 'US', flag: '🇺🇸',
              imap: 'mobile.charter.net', smtp: 'mobile.charter.net', smtpPort: 587, smtpMode: 'starttls',
              setup: 'Use your Spectrum email address and password.' },
  /* Cox moved every cox.net mailbox to Yahoo Mail; imap.cox.net is gone. */
  cox:      { name: 'Cox (now Yahoo Mail)', country: 'US', flag: '🇺🇸',
              imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com',
              setup: 'Cox addresses now live in Yahoo Mail. Sign in to Yahoo with your cox.net address, open Account security, create an app password, and paste that here - not your Cox password.' },
  bt:       { name: 'BT Mail', country: 'GB', flag: '🇬🇧',
              imap: 'mail.btinternet.com', smtp: 'mail.btinternet.com', smtpPort: 587, smtpMode: 'starttls',
              setup: 'Use your BT email address and password.' },
  xs4all:   { name: 'Freedom / XS4ALL', country: 'NL', flag: '🇳🇱',
              imap: 'imap.freedom.nl', smtp: 'smtp.freedom.nl', smtpPort: 587, smtpMode: 'starttls',
              setup: 'Use your Freedom email address and password.' },

  /* ── EVERYWHERE. ──────────────────────────────────────────────────────
     These are not one country's providers, they are the ones somebody in
     Lagos, Jakarta, Riyadh, Buenos Aires or Mexico City is most likely to
     actually be using - and until now the connector had no entry for any of
     them, which meant an American or an Indonesian could not use the feature
     at all while a Pole could. Marked `global` so the coverage board counts
     them for every country rather than pretending mail is unavailable where a
     national ISP does not run a mail service. */
  gmail:    { name: 'Gmail', country: '', flag: '🌐', global: true,
              imap: 'imap.gmail.com', smtp: 'smtp.gmail.com',
              setup: 'Google requires an App Password here, not your normal one. Turn on 2-Step Verification in your Google Account, then go to Security, App passwords, and create one for Mail.' },
  outlook:  { name: 'Outlook / Hotmail / Live', country: '', flag: '🌐', global: true,
              imap: 'outlook.office365.com', smtp: 'smtp.office365.com',
              setup: 'If you use two-step verification, create an app password at account.microsoft.com under Security, Advanced security options. Otherwise use your normal password.' },
  yahoo:    { name: 'Yahoo Mail', country: '', flag: '🌐', global: true,
              imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com',
              setup: 'Yahoo requires an app password. Go to Account Security, then Generate app password.' },
  aol:      { name: 'AOL Mail', country: '', flag: '🌐', global: true,
              imap: 'imap.aol.com', smtp: 'smtp.aol.com',
              setup: 'AOL requires an app password, created under Account Security.' },
  icloud:   { name: 'iCloud Mail', country: '', flag: '🌐', global: true,
              imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com',
              setup: 'Apple requires an app-specific password. Sign in at account.apple.com, then App-Specific Passwords, and generate one.' },
  fastmail: { name: 'Fastmail', country: '', flag: '🌐', global: true,
              imap: 'imap.fastmail.com', smtp: 'smtp.fastmail.com',
              setup: 'In Fastmail go to Settings, Privacy & Security, App Passwords, and create one for IMAP/SMTP.' },
  mailcom:  { name: 'mail.com', country: '', flag: '🌐', global: true,
              imap: 'imap.mail.com', smtp: 'smtp.mail.com',
              setup: 'In mail.com settings, enable POP3/IMAP access for external programs.' },

  /* ── Anywhere else ───────────────────────────────────────────────── */
  /* The honest answer to "does it support my provider". Every host still goes
     through the same private-address guard the web agent uses, so this cannot
     be pointed at something inside the network. */
  custom:   { name: 'Any other provider (enter the server yourself)', country: '', flag: '🌍',
              imap: '', smtp: '', custom: true,
              setup: 'Your provider publishes these as "IMAP server" and "SMTP server", usually in a help page called something like "set up mail on another device". Ports are 993 for IMAP and 465 for SMTP.' },
};

const MAIL_IMAP_PORT = 993;
const MAIL_SMTP_PORT = 465;

const MAIL_TIMEOUT_MS = 15000;
const MAIL_MAX_LIST   = 50;

/* THE PASSWORD TO SOMEBODY'S WHOLE MAILBOX.

   An IMAP app password is not a scope-limited token like an OAuth grant - it
   opens the entire mailbox, and for most of these providers it opens the
   account behind it too. So it is encrypted at rest under a key that lives in
   the environment and nowhere else, it is never returned to the browser in any
   response, and it never reaches an audit line.

   AES-GCM with a random 12-byte nonce per record. The key is derived from
   MAIL_CRED_KEY rather than used raw, so a short or low-entropy value set by
   hand still produces a full-strength key.

   With no MAIL_CRED_KEY configured, storing one is REFUSED rather than stored
   in the clear. That is the honest-degradation rule applied to the one place
   it matters most: a feature that quietly weakens its own encryption because a
   setting is missing is worse than a feature that says it is not ready. */
/* AMV-048: THE SALT WAS THE SAME ON EVERY DEPLOYMENT AMV HAS EVER HAD.

   `salt: 'amv-mail-credentials-v1'`, hard-coded, identical everywhere. A salt's
   whole job is to make precomputation useless, and a constant one in shipped
   source is a constant an attacker has too: work done once against it applies
   to every AMV instance in the world at the same time. The iteration count is
   respectable and it is being spent on a table somebody can build once.

   The salt is derived from the deployment's own key now, so it differs
   everywhere without needing a new setting or a migration. That does not add
   entropy - it cannot, it comes from the same secret - and it is not what it is
   for: it makes the precomputation per-deployment, which is the exact property
   a shared constant threw away.

   Old ciphertexts keep working. Anything written under v1 still decrypts,
   because a key rotation that silently locks people out of their own mailbox is
   a worse outcome than the thing being fixed. New writes use v2.

   AND THE SECRET ITSELF. `length < 16` was the only check, so
   MAIL_CRED_KEY=aaaaaaaaaaaaaaaa passed - sixteen characters and about four
   bits. PBKDF2 over that is a formality. A key this weak is refused outright
   and said so, rather than being stretched into a false sense of safety: mail
   degrades honestly on a bad key, exactly as it does on a missing one. */
const MAIL_CRED_MIN = 24;

/* Enough different characters that this is a generated secret rather than
   somebody holding a key down. Deliberately crude: it cannot measure entropy,
   and it can refuse the shapes that obviously have none. */
function _mailCredWeak(secret) {
  const s = String(secret || '');
  if (s.length < MAIL_CRED_MIN) return 'shorter than ' + MAIL_CRED_MIN + ' characters';
  if (new Set(s).size < 8) return 'made of too few different characters';
  if (/^(.)\1+$/.test(s)) return 'the same character repeated';
  if (/^(?:0123456789|abcdefghij|password|changeme|secret|test)/i.test(s)) return 'a placeholder rather than a secret';
  return null;
}

/* The count v1 was written with. Read-only: see _mailCredKey. */
const MAIL_CRED_V1_ITERATIONS = 120000;

async function _mailCredSalt(secret) {
  /* Per deployment, from the deployment's own key. Not stored, so there is
     nothing to migrate and nothing to lose. */
  const bytes = new TextEncoder().encode('amv-mail-credentials-v2:' + secret);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

async function _mailCredKey(env, version) {
  const secret = String((env && env.MAIL_CRED_KEY) || '');
  if (_mailCredWeak(secret)) return null;
  const enc = new TextEncoder();
  const salt = version === 1
    ? enc.encode('amv-mail-credentials-v1')   // only ever used to READ what v1 wrote
    : await _mailCredSalt(secret);
  /* THE ITERATION COUNT IS PART OF THE FORMAT, NOT A SETTING.

     v2 derived at 120000, which the Workers runtime refuses - it caps PBKDF2 at
     100000 - so this threw the first time anybody stored a mailbox password,
     the same defect as PBKDF2_ITERATIONS on a different route. v2 is now at the
     cap.

     v1 KEEPS ITS NUMBER. This branch exists for one purpose: to read what v1
     wrote. Changing the count changes the key, and a key that does not open the
     ciphertext is not a migration, it is a loss - the person's mailbox password
     simply stops being readable and they are never told why. That it also
     exceeds the runtime's cap is true and does not change the answer: on a
     deployed Worker there can be no v1 ciphertext to read, because a Worker
     that could write it could never have run. Where v1 data does exist, this is
     the only number that opens it. */
  const iterations = version === 1 ? MAIL_CRED_V1_ITERATIONS : PBKDF2_MAX_ITERATIONS;
  const material = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function _mailEncrypt(env, plain) {
  const key = await _mailCredKey(env);
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0); out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}

async function _mailDecrypt(env, blob) {
  if (!blob) return null;
  const raw0 = (() => {
    try { return Uint8Array.from(atob(String(blob)), (c) => c.charCodeAt(0)); }
    catch (e) { return null; }
  })();
  if (!raw0) return null;
  /* v2 and the v1 that came before it. Trying both is what makes this a
     rotation rather than a lockout - a mailbox connected last week must keep
     working, and its owner should never find out this changed. */
  for (const version of [2, 1]) {
    const key = await _mailCredKey(env, version);
    if (!key) return null;
    try {
      const iv = raw0.subarray(0, 12), ct = raw0.subarray(12);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      return new TextDecoder().decode(pt);
    } catch (e) { /* wrong key for this blob; try the older one */ }
  }
  return null;
}

/* What the browser is allowed to know about a connection. Everything except
   the one field that matters, which never leaves the Worker. */
function _mailPublic(rec) {
  if (!rec) return null;
  const p = MAIL_PROVIDERS[rec.provider] || null;
  return {
    provider: rec.provider,
    providerName: p ? p.name : rec.provider,
    flag: p ? p.flag : '🌍',
    country: p ? p.country : '',
    address: rec.address,
    imap: rec.imap, smtp: rec.smtp,
    connectedAt: rec.connectedAt || 0,
    lastOkAt: rec.lastOkAt || 0,
    lastError: rec.lastError || '',
  };
}

/* ── the wire ──────────────────────────────────────────────────────────
   Replaced wholesale in tests, so the suite drives real IMAP and SMTP
   conversations without touching the network. The import is dynamic and not
   top-level on purpose: `cloudflare:sockets` does not exist under Node, and
   the gate loads this file under Node to prove the Worker still parses. */
let _mailConnector = null;
async function _mailSocket(host, port, mode) {
  if (_mailConnector) return _mailConnector(host, port, mode);
  const { connect } = await import('cloudflare:sockets');
  /* TWO WAYS TO GET AN ENCRYPTED SMTP SESSION, AND PROVIDERS DISAGREE.

     Implicit TLS on 465 is encrypted from the first byte. STARTTLS on 587
     opens in the clear, announces itself, and upgrades - and an enormous
     number of consumer ISPs offer only that one. Speaking just 465 meant
     every such provider was unreachable, which is why Shaw, TELUS and Optus
     were left out of the catalogue rather than added with a port that would
     fail at 7am in the middle of a scheduled run.

     `starttls` opens the socket unencrypted and hands back one that can be
     upgraded. Nothing secret is written before the upgrade - see _smtpSend,
     which sends only EHLO and STARTTLS in the clear and re-issues EHLO after,
     because the server's capability list before and after the upgrade are
     different documents and AUTH is commonly only offered in the second. */
  return connect({ hostname: host, port: +port },
                 { secureTransport: mode === 'starttls' ? 'starttls' : 'on' });
}

/* A byte-accurate reader over the socket.

   Bytes, not characters. IMAP announces a literal as `{123}` meaning exactly
   123 OCTETS, and a subject line with one non-ASCII character makes the
   character count smaller than the byte count - so a string-based buffer reads
   the wrong amount and every response after it is off by one. Mail from the
   countries this feature exists for is precisely the mail that is not ASCII. */
/* AMV-047: A SIZE THE OTHER END DECLARED IS NOT A SIZE TO ALLOCATE.

   IMAP announces a literal as `{123}` and the reader believed the number: it
   pulled from the socket until it had that many octets, with no ceiling. The
   number comes from the mail server, and the mail server's address comes from
   the person connecting their mailbox - so `{4294967295}` was an instruction to
   buffer four gigabytes in a Worker with a 128MB limit, and the only thing that
   stopped it was the process dying.

   The same reader had two siblings of the same shape. `line()` scanned for CRLF
   and pulled forever if none came, so a server that answers with an endless
   line of anything else is the same attack without needing a literal at all.
   And `_imapCmd` collects response lines until it sees its tag, so a server
   that simply never sends the tag grows an array instead of a buffer.

   Three ceilings, and one budget across the whole session so that none of them
   can be walked past in instalments. Every one of them ends the session with a
   sentence about what happened, rather than truncating - a truncated literal
   puts the reader out of step with the stream, and every response after it
   would be parsed against the wrong bytes. */
const MAIL_MAX_LITERAL = 1000000;      // one literal block; a mail body's text part is far under this
const MAIL_MAX_LINE    = 64 * 1024;    // an IMAP/SMTP line; the protocol's own limit is far smaller
const MAIL_MAX_LINES   = 2000;         // response lines before the tagged completion
const MAIL_MAX_SESSION = 4000000;      // everything read from one connection

function _mailTooBig(what, n) {
  return Object.assign(new Error('mail_too_big:' + what + ':' + n), { kind: 'toobig' });
}

function _mailWire(socket) {
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const enc = new TextEncoder(), dec = new TextDecoder();
  let buf = new Uint8Array(0);
  let read = 0;
  const until = Date.now() + MAIL_TIMEOUT_MS;

  const pull = async () => {
    if (Date.now() > until) throw new Error('mail_timeout');
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('mail_closed');
    /* Counted as it arrives, so a server cannot stay under every individual
       ceiling and still stream without end. */
    read += value.length;
    if (read > MAIL_MAX_SESSION) throw _mailTooBig('session', read);
    const next = new Uint8Array(buf.length + value.length);
    next.set(buf, 0); next.set(value, buf.length);
    buf = next;
  };
  return {
    async write(s) { await writer.write(enc.encode(s)); },
    async line() {
      for (;;) {
        for (let i = 0; i + 1 < buf.length; i++) {
          if (buf[i] === 13 && buf[i + 1] === 10) {
            const out = dec.decode(buf.subarray(0, i));
            buf = buf.subarray(i + 2);
            return out;
          }
        }
        /* No line ending yet, and more of it than a line is allowed to be. */
        if (buf.length > MAIL_MAX_LINE) throw _mailTooBig('line', buf.length);
        await pull();
      }
    },
    async bytes(n) {
      const want = Number(n);
      /* Checked BEFORE anything is read, because the whole point is not to
         start. A size that is not a plain non-negative integer is refused for
         the same reason a huge one is: it did not come from us. */
      if (!Number.isInteger(want) || want < 0) throw _mailTooBig('literal', n);
      if (want > MAIL_MAX_LITERAL) throw _mailTooBig('literal', want);
      while (buf.length < want) await pull();
      const out = dec.decode(buf.subarray(0, want));
      buf = buf.subarray(want);
      return out;
    },
    async close() {
      try { await writer.close(); } catch (e) {}
      try { if (socket && typeof socket.close === 'function') await socket.close(); } catch (e) {}
    },
  };
}

/* Four different problems with four different fixes.

   "It did not work" is useless to somebody who has just pasted a password:
   they cannot tell a wrong code from IMAP being switched off from the provider
   being down, and those need three different actions. The provider's own
   refusal text is matched here so the answer names the actual cause. */
function _mailFailure(kind, provider) {
  const p = MAIL_PROVIDERS[provider];
  const how = p && p.setup ? ' ' + p.setup : '';
  if (kind === 'auth') {
    return { code: 'mail_auth', error: 'That address and password were refused by your provider. Most providers need a separate app password here rather than the one you sign in with.' + how };
  }
  if (kind === 'disabled') {
    return { code: 'mail_imap_off', error: 'Your provider answered, but IMAP is switched off for this mailbox, so nothing can read it yet.' + how };
  }
  if (kind === 'timeout') {
    return { code: 'mail_unreachable', error: 'Your mail provider did not answer in time. Nothing was changed - try again in a moment.' };
  }
  if (kind === 'toobig') {
    /* AMV-047. Said plainly, because the honest answer is that AMV stopped
       rather than that the provider is broken - and because a mailbox that
       really does hold something enormous is a support conversation, not a
       retry. */
    return { code: 'mail_too_big', error: 'Your mail server sent more in one go than AMV will read, so it stopped. Nothing was changed. If this keeps happening, the mailbox may hold a message far larger than AMV handles.' };
  }
  return { code: 'mail_unreachable', error: 'AMV could not reach that mail server. Check the server address, or try again shortly.' };
}

/* SUBJECT LINES THAT ARE NOT IN ENGLISH.

   A mail header can only carry ASCII, so anything else arrives encoded:
   `=?UTF-8?B?5L2g5aW9?=` is "你好". Skipping this would mean the one feature
   built for people outside the US shows every one of their subject lines as
   punctuation soup, which is a worse first impression than not shipping it.
   Both encodings are handled: B is base64, Q is quoted-printable with
   underscore standing in for space. */
function _mimeWord(s) {
  return String(s || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset, kind, data) => {
    try {
      let bytes;
      if (kind === 'B' || kind === 'b') {
        bytes = Uint8Array.from(atob(data.replace(/\s/g, '')), (c) => c.charCodeAt(0));
      } else {
        const txt = data.replace(/_/g, ' ');
        const out = [];
        for (let i = 0; i < txt.length; i++) {
          if (txt[i] === '=' && /[0-9A-Fa-f]{2}/.test(txt.slice(i + 1, i + 3))) {
            out.push(parseInt(txt.slice(i + 1, i + 3), 16)); i += 2;
          } else out.push(txt.charCodeAt(i));
        }
        bytes = new Uint8Array(out);
      }
      /* The charset the header names, so Chinese sent as GBK and Japanese sent
         as ISO-2022-JP decode as themselves rather than as UTF-8 wreckage. */
      const label = String(charset || 'utf-8').toLowerCase();
      try { return new TextDecoder(label).decode(bytes); }
      catch (e) { return new TextDecoder('utf-8').decode(bytes); }
    } catch (e) { return whole; }
  }).replace(/\?=\s+=\?/g, '');
}

/* One IMAP command, including the literal blocks a naive reader breaks on.

   A server announces `{123}` at the end of a line and then sends exactly 123
   octets, and the rest of the response continues after them. Reading that as
   lines loses the boundary and every later response is misaligned, which is
   the classic way a hand-written IMAP client appears to work in testing and
   then mangles somebody's real inbox. */
async function _imapCmd(wire, tag, cmd) {
  await wire.write(tag + ' ' + cmd + '\r\n');
  const lines = [];
  for (;;) {
    let line = await wire.line();
    for (;;) {
      const lit = /\{(\d+)\}$/.exec(line);
      if (!lit) break;
      const body = await wire.bytes(+lit[1]);
      line = line.slice(0, lit.index) + body + (await wire.line());
    }
    if (line.startsWith(tag + ' ')) {
      const rest = line.slice(tag.length + 1);
      return { ok: /^OK\b/i.test(rest), status: rest, lines };
    }
    /* AMV-047: a server that never sends the tagged completion grows this
       array instead of the buffer, which is the same failure one level up. */
    if (lines.length >= MAIL_MAX_LINES) throw _mailTooBig('lines', lines.length);
    lines.push(line);
  }
}

/* Open a mailbox, do something, and always close it.

   LOGOUT and the socket close are in a finally: a session left open holds a
   connection at the provider, and several providers count those and start
   refusing new ones - so a failure path that skips the close turns one error
   into an account that cannot connect at all for a while. */
async function _imapSession(cfg, work) {
  let socket = null, wire = null;
  try {
    socket = await _mailSocket(cfg.imap, cfg.imapPort || MAIL_IMAP_PORT);
    wire = _mailWire(socket);
    const greeting = await wire.line();
    if (!/^\*\s+(OK|PREAUTH)/i.test(greeting)) throw Object.assign(new Error('greeting'), { kind: 'net' });

    const login = await _imapCmd(wire, 'a1', 'LOGIN ' + _imapQuote(cfg.address) + ' ' + _imapQuote(cfg.password));
    if (!login.ok) {
      /* Several providers answer an ordinary password with a note that IMAP
         itself is off, which is a different fix from a wrong password. */
      const t = String(login.status || '').toLowerCase();
      throw Object.assign(new Error('login'), {
        kind: /not enabled|disabled|unavailable|not open|not allowed|authorization code|授权码/.test(t) ? 'disabled' : 'auth' });
    }
    return await work(wire);
  } finally {
    try { if (wire) { await _imapCmd(wire, 'zz', 'LOGOUT'); } } catch (e) {}
    try { if (wire) await wire.close(); } catch (e) {}
  }
}

function _imapQuote(s) { return '"' + String(s == null ? '' : s).replace(/([\\"])/g, '\\$1') + '"'; }

/* The most recent messages, newest first. */
async function _imapInbox(cfg, limit) {
  const want = Math.max(1, Math.min(MAIL_MAX_LIST, +limit || 20));
  return _imapSession(cfg, async (wire) => {
    const sel = await _imapCmd(wire, 'a2', 'SELECT INBOX');
    if (!sel.ok) throw Object.assign(new Error('select'), { kind: 'disabled' });
    let exists = 0;
    for (const l of sel.lines) { const m = /^\*\s+(\d+)\s+EXISTS/i.exec(l); if (m) exists = +m[1]; }
    if (!exists) return { total: 0, messages: [] };

    const from = Math.max(1, exists - want + 1);
    const res = await _imapCmd(wire, 'a3',
      `FETCH ${from}:${exists} (UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])`);
    if (!res.ok) throw Object.assign(new Error('fetch'), { kind: 'net' });

    const messages = [];
    for (const line of res.lines) {
      if (!/\bFETCH\b/i.test(line)) continue;
      const uid = (/UID\s+(\d+)/i.exec(line) || [])[1];
      if (!uid) continue;
      /* NOT anchored to the start of a line.

         The literal is spliced back into the middle of the FETCH response, so
         the FIRST header lands directly after `BODY[...] ` on the same line
         and every later one starts a line of its own. Anchoring on `^` finds
         Subject and Date and silently misses From on every single message,
         which ships as an inbox where nobody sent anything. So the boundary is
         a line break OR the end of the BODY[...] section. */
      const head = (s, name) => {
        const m = new RegExp('(?:^|\\r?\\n|\\]\\s)' + name + ':[ \\t]*([^\\r\\n]*)', 'i').exec(s);
        return m ? _mimeWord(m[1].trim()) : '';
      };
      messages.push({
        uid: +uid,
        seen: /FLAGS\s*\([^)]*\\Seen/i.test(line),
        from: head(line, 'From'),
        to: head(line, 'To'),
        subject: head(line, 'Subject'),
        date: head(line, 'Date'),
      });
    }
    messages.reverse();
    return { total: exists, messages };
  });
}

/* One message's text. Attachments are deliberately not fetched: this exists so
   the model can read and answer mail, and pulling a 20MB attachment through a
   Worker to summarise a sentence is cost with no benefit. */
async function _imapMessage(cfg, uid) {
  return _imapSession(cfg, async (wire) => {
    const sel = await _imapCmd(wire, 'b1', 'SELECT INBOX');
    if (!sel.ok) throw Object.assign(new Error('select'), { kind: 'disabled' });
    const res = await _imapCmd(wire, 'b2', `UID FETCH ${+uid} (BODY.PEEK[TEXT])`);
    if (!res.ok) throw Object.assign(new Error('fetch'), { kind: 'net' });
    const line = res.lines.find((l) => /\bFETCH\b/i.test(l)) || '';
    const cut = line.indexOf('BODY[TEXT]');
    let body = cut >= 0 ? line.slice(cut + 'BODY[TEXT]'.length) : '';
    body = body.replace(/^\s*/, '').replace(/\)\s*$/, '');
    return { uid: +uid, body: body.slice(0, 200000) };
  });
}

/* Sending. AUTH LOGIN rather than PLAIN because it is the one every provider
   in the registry accepts. */
async function _smtpSend(cfg, msg) {
  let socket = null, wire = null;
  const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const expect = async (want) => {
    for (;;) {
      const line = await wire.line();
      if (/^\d{3}-/.test(line)) continue;            // multi-line greeting
      const code = +line.slice(0, 3);
      if (String(code)[0] !== String(want)[0]) {
        throw Object.assign(new Error(line), { kind: code === 535 || code === 534 ? 'auth' : 'net' });
      }
      return line;
    }
  };
  try {
    const port = +(cfg.smtpPort || MAIL_SMTP_PORT);
    const mode = (cfg.smtpMode === 'starttls' || port === 587 || port === 25)
      ? 'starttls' : 'tls';
    socket = await _mailSocket(cfg.smtp, port, mode);
    wire = _mailWire(socket);
    await expect(2);
    await wire.write('EHLO amv\r\n'); await expect(2);

    if (mode === 'starttls') {
      /* Upgrade BEFORE any credential is written. If the server refuses, the
         send fails here rather than continuing in the clear - a password sent
         unencrypted to save a round trip is not a trade worth making, and a
         silent downgrade is exactly how that happens. */
      await wire.write('STARTTLS\r\n'); await expect(2);
      if (typeof socket.startTls !== 'function') {
        throw Object.assign(new Error('This server needs STARTTLS and the connection cannot be upgraded.'),
                            { kind: 'net' });
      }
      socket = socket.startTls();
      wire = _mailWire(socket);
      /* EHLO again on the encrypted channel. The capability list before and
         after an upgrade are different documents, and AUTH is frequently
         absent from the first one. */
      await wire.write('EHLO amv\r\n'); await expect(2);
    }

    await wire.write('AUTH LOGIN\r\n'); await expect(3);
    await wire.write(b64(cfg.address) + '\r\n'); await expect(3);
    await wire.write(b64(cfg.password) + '\r\n'); await expect(2);
    await wire.write('MAIL FROM:<' + cfg.address + '>\r\n'); await expect(2);
    for (const to of msg.to) { await wire.write('RCPT TO:<' + to + '>\r\n'); await expect(2); }
    await wire.write('DATA\r\n'); await expect(3);
    /* A line that is a single dot ends the message, so a message containing
       one has to have it escaped or the mail is truncated there. */
    const body = String(msg.text || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    const headers =
      'From: ' + cfg.address + '\r\n' +
      'To: ' + msg.to.join(', ') + '\r\n' +
      'Subject: =?UTF-8?B?' + b64(String(msg.subject || '')) + '?=\r\n' +
      'MIME-Version: 1.0\r\n' +
      'Content-Type: text/plain; charset=UTF-8\r\n\r\n';
    await wire.write(headers + body + '\r\n.\r\n');
    await expect(2);
    await wire.write('QUIT\r\n');
    return { sent: true };
  } finally {
    try { if (wire) await wire.close(); } catch (e) {}
  }
}

/* ── routes ───────────────────────────────────────────────────────────── */

/* The catalogue a person picks from. No credentials involved, and nothing here
   is secret - it is hostnames and instructions - but it is behind auth anyway
   because there is no reason for it not to be. */
async function mailProviders(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const list = Object.entries(MAIL_PROVIDERS).map(([id, p]) => ({
    id, name: p.name, country: p.country, flag: p.flag, custom: !!p.custom, setup: p.setup,
    imap: p.imap, smtp: p.smtp, paused: p.paused ? String(p.paused.why || 'paused') : '',
    smtpPort: p.smtpPort || MAIL_SMTP_PORT, smtpMode: p.smtpMode || 'tls',
  }));
  const countries = new Set(list.map((p) => p.country).filter(Boolean));
  return json({ ok: true, providers: list, countries: countries.size,
                imapPort: MAIL_IMAP_PORT, smtpPort: MAIL_SMTP_PORT });
}

async function mailStatus(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const rec = await DB.get(env, 'mailcfg', user.email);
  return json({ ok: true, connected: !!rec, account: _mailPublic(rec),
                /* Said plainly, because with no key the connect route refuses
                   and the person deserves to know why before they type. */
                ready: !!(await _mailCredKey(env)) });
}

/* Connect, by actually connecting.

   The credential is proved before it is stored, not after: a record that says
   "connected" and fails at 6am when the scheduled run needs it is worse than
   an error at the moment somebody is sitting there able to fix it. */
async function mailConnect(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const g = await guardAction(env, 'mailconn:' + user.email, 6, 300, 'mail connection attempts');
  if (g) return g;

  if (!(await _mailCredKey(env))) {
    audit(env, 'mail_no_cred_key', { by: user.email });
    return json({ error: 'AMV cannot store mail passwords safely on this deployment yet, so it will not store one at all. MAIL_CRED_KEY has to be set first, to a long random value - at least 24 characters of real randomness, not a phrase.',
                  code: 'needs_service' }, 503);
  }

  const body = await request.json().catch(() => ({}));
  const provider = String(body.provider || '');
  const p = MAIL_PROVIDERS[provider];
  if (!p) return json({ error: 'Pick a mail provider from the list.', code: 'bad_provider' }, 400);
  /* Refused before a password is read: the server it would go to is the
     problem (see `paused` on the provider). */
  if (p.paused) return json({ error: String(p.paused.why || 'This provider is paused.'), code: 'provider_paused' }, 409);

  const address = String(body.address || '').trim().slice(0, 200);
  const password = String(body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return json({ error: 'That does not look like an email address.', code: 'bad_address' }, 400);
  if (!password) return json({ error: 'Enter the app password your provider gave you.', code: 'bad_password' }, 400);

  const imap = p.custom ? String(body.imap || '').trim().slice(0, 200) : p.imap;
  const smtp = p.custom ? String(body.smtp || '').trim().slice(0, 200) : p.smtp;
  if (!imap || !smtp) return json({ error: 'Enter both the IMAP and SMTP server addresses.', code: 'bad_host' }, 400);
  /* A custom host is somebody typing a hostname, which is the shape of an SSRF
     - so it goes through the same gate the web agent uses rather than a second
     opinion written here. */
  for (const h of [imap, smtp]) {
    const gate = _webHostAllowed('https://' + h);
    if (!gate.ok) return json({ error: gate.why, code: 'blocked_host' }, 400);
  }

  const cfg = { address, password, imap, smtp };
  try {
    await _imapInbox(cfg, 1);
  } catch (e) {
    const kind = (e && e.kind) || (String(e && e.message) === 'mail_timeout' ? 'timeout' : 'net');
    audit(env, 'mail_connect_failed', { by: user.email, provider, kind });
    return json(_mailFailure(kind, provider), kind === 'auth' ? 401 : 502);
  }

  const enc = await _mailEncrypt(env, password);
  if (!enc) return json({ error: 'AMV could not encrypt that password, so it did not store it.', code: 'needs_service' }, 503);
  /* Under the lock the read path already takes. A background run updating
     lastOkAt at the moment somebody reconnects would otherwise put back the
     record it read first, and the reconnection would vanish. */
  await _withKV(env, 'mailcfg', user.email, (rec) => {
    rec.provider = provider; rec.address = address; rec.imap = imap; rec.smtp = smtp;
    /* Carried from the catalogue, because the send happens days later on a
       schedule and cannot look the provider up again from a hostname alone.
       Without this a provider that only speaks STARTTLS on 587 would be dialled
       on 465 every night and fail in a way nobody is awake to see. */
    rec.smtpPort = p.smtpPort || MAIL_SMTP_PORT;
    rec.smtpMode = p.smtpMode || 'tls';
    rec.secret = enc; rec.connectedAt = Date.now(); rec.lastOkAt = Date.now(); rec.lastError = '';
  }, {});
  /* The password is not in this line, and must never be. */
  audit(env, 'mail_connected', { by: user.email, provider, country: p.country });
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

