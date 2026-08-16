/* EVERY INTEGRATION AMV SHIPPED WAS AMERICAN.

   Google, Microsoft 365, Slack, Discord, GitHub, Notion, Canvas, Twilio.
   Somebody in Chengdu, Seoul, Warsaw or Sao Paulo opens the integrations page
   and finds nothing they use. Mail is the piece that can be fixed properly,
   because it is the one built on an open protocol: QQ, 163, Naver, Yandex,
   GMX, Libero, Seznam, WP.pl, Rediffmail, UOL and the rest all speak IMAP and
   SMTP and all of them issue an app password for exactly this.

   So this is not an integration with anybody. It is the protocol, once.

   The tests drive a scripted socket rather than the network, because a suite
   that needs an internet connection and somebody's real password is a suite
   that gets skipped. What is scripted is a real IMAP conversation, literals
   and all, taken from what these servers actually answer. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'mail.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, MAIL_PROVIDERS, _mailEncrypt, _mailDecrypt, _mailPublic, _mimeWord,' +
  ' _imapInbox, _imapMessage, _smtpSend, mailProviders, mailConnect, mailStatus, mailInbox,' +
  ' mailSend, mailDisconnect, issueTokens, PER_USER_KINDS, BACKUP_NEVER };' +
  '\nexport function __setMailConnector(fn){ _mailConnector = fn; }\n');
const W = await import(harness + '?t=' + Date.now());

/* ── a scripted mail server ────────────────────────────────────────────
   Emits its replies in order and records everything the client sent, so the
   commands can be asserted as well as the parsing. */
function scriptedSocket(replies) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const queue = replies.slice();
  const wrote = [];
  return {
    wrote,
    socket: {
      readable: { getReader: () => ({
        async read() {
          if (!queue.length) return { value: undefined, done: true };
          return { value: enc.encode(queue.shift()), done: false };
        },
      }) },
      writable: { getWriter: () => ({
        async write(bytes) { wrote.push(dec.decode(bytes)); },
        async close() {},
      }) },
      close() {},
    },
  };
}
const useScript = (replies) => {
  const s = scriptedSocket(replies);
  W.__setMailConnector(async () => s.socket);
  return s;
};

/* A literal is announced in OCTETS. Built with TextEncoder so the number is
   the real byte count rather than the character count, which is the whole
   point of the byte-accuracy case below. */
const literal = (text) => '{' + new TextEncoder().encode(text).length + '}\r\n' + text;

section('The catalogue covers the world, not one country');
{
  const list = Object.entries(W.MAIL_PROVIDERS);
  const countries = new Set(list.map(([, p]) => p.country).filter(Boolean));
  ok(countries.size >= 20,
     'at least twenty countries have a provider somebody there actually uses', countries.size);
  ok(list.length >= 30, 'across this many providers', list.length);

  /* Named individually, because "twenty countries" is satisfiable with twenty
     European ISPs. These are the ones that were asked for and the ones with
     the most people behind them. */
  const byCountry = (c) => list.filter(([, p]) => p.country === c).map(([id]) => id);
  [['CN', 'China'], ['KR', 'Korea'], ['JP', 'Japan'], ['RU', 'Russia'], ['IN', 'India'],
   ['BR', 'Brazil'], ['PL', 'Poland'], ['DE', 'Germany'], ['FR', 'France'], ['TR', 'Turkey'],
   ['ZA', 'South Africa']].forEach(([code, name]) => {
    ok(byCountry(code).length > 0, name + ' has a provider', byCountry(code));
  });
  ok(W.MAIL_PROVIDERS.qq && W.MAIL_PROVIDERS.netease163,
     'including QQ Mail and NetEase 163, which is what China actually uses', true);

  /* The instruction is not documentation padding. Every one of these providers
     words "app password" differently and hides it somewhere different, and a
     person who pastes their ordinary password gets a failure that reads like a
     bug in AMV. */
  const noSetup = list.filter(([, p]) => !p.setup || p.setup.length < 30).map(([id]) => id);
  ok(noSetup.length === 0, 'every provider says how to get the password it needs', noSetup);
  const noHost = list.filter(([id, p]) => !p.custom && (!p.imap || !p.smtp)).map(([id]) => id);
  ok(noHost.length === 0, 'and every non-custom provider has both servers', noHost);

  ok(!!W.MAIL_PROVIDERS.custom,
     'and anyone whose provider is not listed can still enter their own server', true);
}

section('A subject line that is not in English arrives readable');
{
  /* The one feature built for people outside the US must not render their
     inbox as punctuation soup. */
  ok(W._mimeWord('=?UTF-8?B?5L2g5aW95LiW55WM?=') === '你好世界',
     'a base64 UTF-8 subject decodes', W._mimeWord('=?UTF-8?B?5L2g5aW95LiW55WM?='));
  ok(W._mimeWord('=?UTF-8?Q?Gr=C3=BC=C3=9Fe_aus_Berlin?=') === 'Grüße aus Berlin',
     'and a quoted-printable one, underscores and all', W._mimeWord('=?UTF-8?Q?Gr=C3=BC=C3=9Fe_aus_Berlin?='));
  ok(W._mimeWord('Plain subject') === 'Plain subject', 'and plain text is left alone', true);
}

section('A real IMAP conversation, literals and all');
{
  /* Raw UTF-8 in the header block on purpose: the sender's name is four bytes
     longer than it is characters long, so a reader that counts characters
     instead of octets misaligns here and every response after it is wrong.
     That is the classic way a hand-written IMAP client passes a demo and then
     mangles somebody's real inbox. */
  const head1 = 'From: 张伟 <zhang@qq.com>\r\nSubject: =?UTF-8?B?5L2g5aW9?=\r\nDate: Mon, 3 Aug 2026 09:00:00 +0800\r\n\r\n';
  const head2 = 'From: Anna <anna@wp.pl>\r\nSubject: Faktura\r\nDate: Mon, 3 Aug 2026 10:00:00 +0200\r\n\r\n';
  const s = useScript([
    '* OK IMAP4rev1 ready\r\n',
    'a1 OK LOGIN completed\r\n',
    '* 2 EXISTS\r\na2 OK [READ-WRITE] SELECT completed\r\n',
    '* 1 FETCH (UID 101 FLAGS (\\Seen) BODY[HEADER.FIELDS (FROM TO SUBJECT DATE)] ' + literal(head1) + ')\r\n' +
    '* 2 FETCH (UID 102 FLAGS () BODY[HEADER.FIELDS (FROM TO SUBJECT DATE)] ' + literal(head2) + ')\r\n' +
    'a3 OK FETCH completed\r\n',
    'zz OK LOGOUT completed\r\n',
  ]);

  const out = await W._imapInbox({ address: 'me@qq.com', password: 'authcode', imap: 'imap.qq.com', smtp: 'smtp.qq.com' }, 20);
  ok(out.total === 2, 'the mailbox size is read', out.total);
  ok(out.messages.length === 2, 'both messages came back', out.messages.length);

  const newest = out.messages[0];
  ok(newest.uid === 102, 'newest first, which is the order a person reads', newest.uid);
  ok(newest.seen === false, 'and unread is unread', newest.seen);

  const chinese = out.messages.find((m) => m.uid === 101);
  ok(chinese.subject === '你好', 'the Chinese subject is decoded, not mangled', chinese.subject);
  ok(chinese.from.includes('张伟'),
     'and the sender survives the byte-counted literal intact', chinese.from);
  ok(chinese.seen === true, 'a read message is marked read', chinese.seen);

  const sent = s.wrote.join('');
  ok(/a1 LOGIN "me@qq\.com" "authcode"/.test(sent), 'it logged in with the address and app password', true);
  ok(/BODY\.PEEK\[/.test(sent),
     'and PEEKed the headers, so reading somebody’s inbox does not mark it read', true);
  ok(/zz LOGOUT/.test(sent),
     'and logged out - a session left open is a connection these providers count', true);
}

section('The four ways it fails are four different answers');
{
  useScript(['* OK ready\r\n', 'a1 NO [AUTHENTICATIONFAILED] Invalid credentials\r\n', 'zz OK\r\n']);
  let kind = '';
  try { await W._imapInbox({ address: 'a@qq.com', password: 'wrong', imap: 'imap.qq.com', smtp: 'smtp.qq.com' }, 5); }
  catch (e) { kind = e.kind; }
  ok(kind === 'auth', 'a refused password is an auth failure', kind);

  useScript(['* OK ready\r\n', 'a1 NO IMAP service is not enabled for this account\r\n', 'zz OK\r\n']);
  kind = '';
  try { await W._imapInbox({ address: 'a@163.com', password: 'x', imap: 'imap.163.com', smtp: 'smtp.163.com' }, 5); }
  catch (e) { kind = e.kind; }
  ok(kind === 'disabled',
     'but IMAP being switched off is a different problem with a different fix', kind);

  /* These two are the ones a person cannot tell apart from an error that just
     says "could not connect", and they need opposite actions: fix your
     password, or go and switch IMAP on. */
}

section('The password is encrypted, and never comes back out');
{
  const env = { MAIL_CRED_KEY: 'a-long-enough-key-for-tests-0123456789' };
  const blob = await W._mailEncrypt(env, 'my-app-password');
  ok(!!blob && !blob.includes('my-app-password'),
     'the stored form does not contain the password', String(blob).slice(0, 24));
  ok(await W._mailDecrypt(env, blob) === 'my-app-password', 'and it round-trips', true);

  /* A rotated key must read as "reconnect", not as "wrong password". */
  ok(await W._mailDecrypt({ MAIL_CRED_KEY: 'a-different-key-entirely-0123456789' }, blob) === null,
     'a different key cannot read it', true);

  ok(await W._mailEncrypt({}, 'x') === null,
     'and with no key configured it refuses to encrypt rather than storing it in the clear', true);

  const pub = W._mailPublic({ provider: 'qq', address: 'a@qq.com', imap: 'imap.qq.com', smtp: 'smtp.qq.com', secret: blob });
  ok(!JSON.stringify(pub).includes(blob) && !JSON.stringify(pub).includes('secret'),
     'and what the browser is given carries no trace of it', Object.keys(pub));
}

section('A mailbox password is not in a backup, and does go when the person does');
{
  ok(W.BACKUP_NEVER.includes('mailcfg:'),
     'one leaked export file is not a way into every connected inbox', true);
  ok(W.PER_USER_KINDS.includes('mailcfg'),
     'and erasing an account erases the credential with it', true);
}

section('Sending speaks SMTP properly');
{
  const s = useScript([
    '220 smtp.163.com ready\r\n',
    '250-smtp.163.com\r\n250 AUTH LOGIN PLAIN\r\n',
    '334 VXNlcm5hbWU6\r\n',
    '334 UGFzc3dvcmQ6\r\n',
    '235 Authentication successful\r\n',
    '250 OK\r\n',
    '250 OK\r\n',
    '354 End data with <CR><LF>.<CR><LF>\r\n',
    '250 OK queued\r\n',
    '221 Bye\r\n',
  ]);
  const out = await W._smtpSend(
    { address: 'me@163.com', password: 'authpass', smtp: 'smtp.163.com' },
    { to: ['friend@naver.com'], subject: '你好', text: 'Line one\n.\nLine three' });
  ok(out.sent === true, 'the message is accepted', out.sent);

  const sent = s.wrote.join('');
  ok(/AUTH LOGIN/.test(sent) && /MAIL FROM:<me@163\.com>/.test(sent), 'it authenticated and addressed', true);
  ok(/RCPT TO:<friend@naver\.com>/.test(sent), 'and named the recipient', true);
  ok(/Subject: =\?UTF-8\?B\?/.test(sent),
     'a non-English subject is encoded rather than sent raw, which is what makes it arrive readable', true);
  /* A line that is a single dot ends the message. Sending one unescaped
     truncates the mail there and the rest is silently lost. */
  ok(/\r\n\.\.\r\n/.test(sent), 'and a lone dot in the body is escaped, so nothing is truncated', true);
  ok(/\r\n\.\r\nQUIT/.test(sent) || /\r\n\.\r\n/.test(sent), 'the message is terminated properly', true);
}

section('Connecting is refused before it can store a password unsafely');
{
  const store = new Map();
  const mkEnv = (extra) => Object.assign({
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', APP_URL: 'https://amv.test',
    AMV_KV: {
      async get(k) { return store.has(k) ? store.get(k) : null; },
      async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); },
      async list({ prefix, limit } = {}) {
        const all = [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: all.slice(0, limit || 1000), list_complete: true };
      },
    },
  }, extra || {});
  const post = async (env, fn, body, tok) => {
    const r = await fn(new Request('https://api/v1/mail/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '8.8.8.8',
                 ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
      body: JSON.stringify(body || {}),
    }), env);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const EMAIL = 'person@test.com';
  const envNoKey = mkEnv({});
  store.set('acct:' + EMAIL, JSON.stringify({ email: EMAIL, name: 'P' }));
  const tok = (await W.issueTokens(envNoKey, EMAIL, 'P')).token;

  /* With nowhere safe to put it, AMV does not take it at all. A feature that
     quietly weakens its own encryption because a setting is missing is worse
     than one that says it is not ready. */
  const noKey = await post(envNoKey, W.mailConnect, { provider: 'qq', address: 'a@qq.com', password: 'secret' }, tok);
  ok(noKey.status === 503 && noKey.body.code === 'needs_service',
     'with no MAIL_CRED_KEY set, the password is refused rather than stored', noKey.body.code);
  ok(!JSON.stringify(noKey.body).includes('secret'), 'and is not echoed back', true);

  /* A custom server is somebody typing a hostname, which is the shape of an
     SSRF. It goes through the same gate the web agent uses. */
  const envKey = mkEnv({ MAIL_CRED_KEY: 'a-long-enough-key-for-tests-0123456789' });
  for (const host of ['localhost', '127.0.0.1', '169.254.169.254', '10.0.0.5']) {
    const r = await post(envKey, W.mailConnect,
      { provider: 'custom', address: 'a@b.com', password: 'p', imap: host, smtp: host }, tok);
    ok(r.status === 400 && r.body.code === 'blocked_host',
       'a custom server pointed at ' + host + ' is refused', r.body.code);
  }

  /* And the stored record never hands the password back, through any route. */
  useScript(['* OK ready\r\n', 'a1 OK ok\r\n', '* 0 EXISTS\r\na2 OK ok\r\n', 'zz OK\r\n']);
  const good = await post(envKey, W.mailConnect,
    { provider: 'netease163', address: 'me@163.com', password: 'client-auth-code' }, tok);
  ok(good.status === 200, 'a real connection is accepted', { status: good.status, body: good.body });
  ok(!JSON.stringify(good.body).includes('client-auth-code'),
     'and the answer carries no trace of the password', true);

  const st = await W.mailStatus(new Request('https://api/v1/mail/status', {
    headers: { Authorization: 'Bearer ' + tok } }), envKey);
  const stBody = await st.json();
  ok(stBody.connected === true, 'status says it is connected', stBody.connected);
  ok(!JSON.stringify(stBody).includes('client-auth-code'),
     'without ever returning the password', true);

  const stored = store.get('mailcfg:' + EMAIL) || '';
  ok(stored && !stored.includes('client-auth-code'),
     'and what is on disk is ciphertext, not the password', stored.slice(0, 30));
}

section('SMTP can upgrade, and never writes a password before it has');
{
  /* WHY THIS EXISTS. Implicit TLS on 465 is encrypted from the first byte.
     STARTTLS on 587 opens in the CLEAR and upgrades on request - and a great
     many consumer ISPs offer only the second. Speaking one dialect meant Shaw,
     TELUS, Optus, AT&T, BT, Telenet, Bluewin and the rest were unreachable.

     The dangerous half of adding it is the order of operations. If AUTH is
     sent before the upgrade, or if a refused STARTTLS is allowed to continue,
     the password crosses the wire unencrypted - and it works, so nothing
     reports a problem. That is the failure this section is about. */
  const send = codeOnly(functionBody(src, '_smtpSend'));
  ok(/STARTTLS/.test(send), 'the sender can request an upgrade', true);
  ok(/socket\.startTls\(\)/.test(send), 'and actually performs it', true);

  /* Order, measured rather than described: the upgrade must appear before the
     first AUTH in the source of this function. */
  const iTls = send.indexOf('startTls()');
  const iAuth = send.indexOf('AUTH LOGIN');
  ok(iTls > -1 && iAuth > -1 && iTls < iAuth,
     'and the upgrade happens BEFORE any credential is written', { startTls: iTls, auth: iAuth });

  /* A refusal must end the attempt. Continuing after a failed upgrade is how a
     password gets sent in the clear while everything still appears to work. */
  ok(/typeof socket\.startTls !== 'function'/.test(send) && /throw /.test(send),
     'and a connection that cannot be upgraded fails instead of continuing', true);

  /* EHLO twice: the capability list before and after an upgrade are different
     documents, and AUTH is frequently absent from the first. */
  ok((send.match(/EHLO amv/g) || []).length >= 2,
     'and EHLO is re-issued on the encrypted channel', (send.match(/EHLO amv/g) || []).length);

  /* The dialect has to survive being written down. A scheduled send happens
     days later and cannot re-derive the port from a hostname. */
  const code = codeOnly(src);
  ok(/rec\.smtpMode = p\.smtpMode/.test(code),
     'the provider dialect is stored with the account, not guessed later', true);
  ok(/smtpMode: rec\.smtpMode \|\| 'tls'/.test(code),
     'and an account saved before this existed still defaults to what it connected with', true);

  const starttls = Object.values(W.MAIL_PROVIDERS).filter((p) => p.smtpMode === 'starttls');
  ok(starttls.length >= 10, 'providers that need the upgrade are now reachable', starttls.length);
  ok(starttls.every((p) => p.smtpPort === 587),
     'and each names the port it actually answers on', starttls.map((p) => p.name + ':' + p.smtpPort));
  ok(Object.values(W.MAIL_PROVIDERS).filter((p) => !p.custom && !p.smtpMode).every((p) => !p.smtpPort),
     'while the implicit-TLS ones are left alone', true);
}

if (report('mail-works-outside-america') > 0) process.exitCode = 1;
done();
