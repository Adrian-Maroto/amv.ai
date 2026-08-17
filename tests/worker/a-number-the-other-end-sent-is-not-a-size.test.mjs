/* THE MAIL SERVER SAID HOW MUCH TO ALLOCATE AND AMV BELIEVED IT.

   IMAP announces a literal as `{123}` and then sends exactly that many octets.
   The reader took the number and pulled from the socket until it had that many
   bytes, with nothing bounding it. The number comes from the mail server; the
   mail server's address comes from the person connecting their mailbox. So
   `{4294967295}` was an instruction to buffer four gigabytes inside a Worker
   with a 128MB limit, and the only thing that ever stopped it was the process
   dying - which takes the whole isolate, not just the one request.

   It does not need a hostile provider either. It needs one connection to a host
   somebody typed, and the feature exists specifically so people can type their
   own: the whole point of the mail connector is that AMV does not have an
   integration with their provider.

   The same reader had two siblings of the same shape, and neither needs a
   literal at all. `line()` scanned for CRLF and pulled forever if none came, so
   an endless line of anything is the same attack. And the command loop collects
   response lines until it sees its own tag, so a server that simply never sends
   the tag grows an array instead of a buffer.

   Everything below drives a scripted server, because a suite that needs the
   internet and somebody's real password is a suite that gets skipped. What is
   scripted is what a real IMAP server sends, with one number changed. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'maillimit.harness.mjs');
writeFileSync(harness, src +
  '\nexport { _imapInbox, _imapMessage, _mailFailure, MAIL_MAX_LITERAL, MAIL_MAX_LINE,' +
  ' MAIL_MAX_LINES, MAIL_MAX_SESSION };' +
  '\nexport function __setMailConnector(fn){ _mailConnector = fn; }\n');
const W = await import(harness + '?t=' + Date.now());

/* A server that answers from a script and counts what it was actually asked to
   put on the wire - which is the number that matters here. A ceiling that
   refuses AFTER reading a gigabyte is not a ceiling. */
function server(chunks) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const queue = chunks.slice();
  const s = {
    sent: 0, reads: 0, wrote: [],
    socket: {
      readable: { getReader: () => ({
        async read() {
          if (!queue.length) return { value: undefined, done: true };
          const next = queue.shift();
          const bytes = typeof next === 'function' ? next() : enc.encode(next);
          s.reads++; s.sent += bytes.length;
          return { value: bytes, done: false };
        },
      }) },
      writable: { getWriter: () => ({
        async write(b) { s.wrote.push(dec.decode(b)); },
        async close() {},
      }) },
      close() {},
    },
  };
  W.__setMailConnector(async () => s.socket);
  return s;
}

const CFG = { address: 'me@example.com', password: 'app-pw', imap: 'imap.example.com', smtp: 'smtp.example.com' };
const HELLO = ['* OK IMAP ready\r\n', 'a1 OK LOGIN completed\r\n'];
/* 64KB at a time, which is roughly what a socket really hands over. Endless. */
const forever = (byte) => () => new Uint8Array(64 * 1024).fill(byte);

const caught = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

section('The ceilings are real numbers, not absent');
{
  ok(W.MAIL_MAX_LITERAL > 0 && W.MAIL_MAX_LITERAL <= 4000000,
     'a single literal is bounded, and generously', W.MAIL_MAX_LITERAL);
  ok(W.MAIL_MAX_LINE > 0 && W.MAIL_MAX_LINE <= 1000000, 'and a line', W.MAIL_MAX_LINE);
  ok(W.MAIL_MAX_LINES > 0, 'and the number of response lines', W.MAIL_MAX_LINES);
  ok(W.MAIL_MAX_SESSION >= W.MAIL_MAX_LITERAL,
     'and the whole session, at least as much as one literal', W.MAIL_MAX_SESSION);
}

section('A literal larger than AMV reads is refused before anything is read');
{
  /* THE FINDING. The server announces four gigabytes and then starts sending.
     What must be true is not merely that this fails - it is that it fails
     having read almost nothing. */
  const s = server([...HELLO,
    '* 1 EXISTS\r\na2 OK [READ-WRITE] SELECT completed\r\n',
    '* 1 FETCH (UID 7 BODY[HEADER] {4294967295}\r\n',
    forever(65), forever(65), forever(65), forever(65)]);

  const e = await caught(() => W._imapInbox(CFG, 5));
  ok(e !== null, 'the read does not succeed', e);
  ok(e.kind === 'toobig', 'and says why', e && e.kind);
  ok(/literal/.test(String(e.message)), 'naming which ceiling', e && e.message);
  ok(s.sent < 200000,
     'and almost nothing came off the wire, which is the whole point', s.sent);
}

section('And so is one that is not a number at all');
{
  /* `{99999999999999999999}` parses to a float, and `{-1}` and `{1e9}` are the
     shapes a hand-written parser gets wrong in the permissive direction. */
  for (const declared of ['99999999999999999999', '000000000009999999']) {
    const s = server([...HELLO,
      '* 1 EXISTS\r\na2 OK SELECT completed\r\n',
      '* 1 FETCH (UID 7 BODY[HEADER] {' + declared + '}\r\n',
      forever(66), forever(66)]);
    const e = await caught(() => W._imapInbox(CFG, 5));
    ok(e && e.kind === 'toobig', '{' + declared.slice(0, 12) + '...} is refused', e && e.kind);
    ok(s.sent < 200000, 'without reading it', s.sent);
  }
}

section('A literal AMV really does read still works');
{
  /* A ceiling that breaks the feature is a removal, not a control. This is the
     ordinary case, with a real literal and a non-ASCII subject - the mail this
     connector exists for is exactly the mail that is not ASCII. */
  const header = 'From: 田中 <t@example.jp>\r\nSubject: =?UTF-8?B?5L2g5aW9?=\r\nDate: Mon, 1 Jan 2026 00:00:00 +0000\r\n\r\n';
  const n = new TextEncoder().encode(header).length;
  server([...HELLO,
    '* 1 EXISTS\r\na2 OK SELECT completed\r\n',
    '* 1 FETCH (UID 7 FLAGS () BODY[HEADER.FIELDS (FROM TO SUBJECT DATE)] {' + n + '}\r\n'
      + header + ')\r\na3 OK FETCH completed\r\n',
    'zz OK LOGOUT\r\n']);

  const box = await W._imapInbox(CFG, 5);
  ok(box.total === 1, 'the mailbox is read', box.total);
  ok(box.messages.length === 1, 'and the message is there', box.messages.length);
  ok(box.messages[0].subject === '你好', 'with its subject decoded', box.messages[0].subject);
  ok(box.messages[0].uid === 7, 'and its id', box.messages[0].uid);
}

section('A line that never ends is not read forever');
{
  /* No literal involved. A server that answers the greeting with an endless
     run of bytes and no CRLF is the same unbounded buffer, reached without
     announcing anything. */
  const s = server([forever(88), forever(88), forever(88), forever(88), forever(88)]);
  const e = await caught(() => W._imapInbox(CFG, 5));
  ok(e !== null, 'the session ends', e);
  ok(e.kind === 'toobig' && /line/.test(String(e.message)), 'on the line ceiling', e && e.message);
  ok(s.sent <= W.MAIL_MAX_LINE + 100000,
     'having read about one line, not a mailbox', { sent: s.sent, cap: W.MAIL_MAX_LINE });
}

section('Nor is a response that never finishes');
{
  /* Every line is short and well-formed, and the tagged completion never
     arrives. The buffer stays small and the ARRAY grows instead - the same
     failure one level up, which is why it needs its own ceiling. */
  const chunk = '* 1 FETCH (UID 1)\r\n'.repeat(500);
  const s = server([...HELLO, '* 1 EXISTS\r\na2 OK SELECT completed\r\n',
                    chunk, chunk, chunk, chunk, chunk, chunk, chunk, chunk]);
  const e = await caught(() => W._imapInbox(CFG, 5));
  ok(e !== null, 'the session ends', e);
  ok(e.kind === 'toobig' && /lines/.test(String(e.message)), 'on the line-count ceiling', e && e.message);
}

section('And a server cannot get there in instalments');
{
  /* Each of the ceilings above is per-thing. A server that stays under all of
     them and simply keeps talking is the same denial of service assembled out
     of legal parts, so the session has a budget of its own. */
  const chunk = '* 1 OK ' + 'x'.repeat(30000) + '\r\n';
  const s = server([...HELLO, '* 1 EXISTS\r\na2 OK SELECT completed\r\n',
                    ...Array.from({ length: 400 }, () => chunk)]);
  const e = await caught(() => W._imapInbox(CFG, 5));
  ok(e !== null, 'the session ends', e);
  ok(e.kind === 'toobig', 'on a ceiling', e && e.kind);
  ok(s.sent <= W.MAIL_MAX_SESSION + 200000,
     'having read about the session budget and no more', { sent: s.sent, cap: W.MAIL_MAX_SESSION });
}

section('The person is told what happened, and it is not "your provider is down"');
{
  const f = W._mailFailure('toobig', 'qq');
  ok(f.code === 'mail_too_big', 'it has its own code', f.code);
  ok(!/could not reach/i.test(f.error), 'and does not blame the network', f.error);
  ok(/nothing was changed/i.test(f.error), 'and says nothing was changed', f.error);

  /* The three it must not be confused with. */
  ok(W._mailFailure('auth', 'qq').code === 'mail_auth', 'a wrong password is still its own answer');
  ok(W._mailFailure('disabled', 'qq').code === 'mail_imap_off', 'and IMAP being off is still its own');
  ok(W._mailFailure('timeout', 'qq').code === 'mail_unreachable', 'and so is a timeout');
}

section('A connection is closed on the way out, however it ended');
{
  /* Several providers count open connections and start refusing new ones, so a
     failure path that skips the close turns one refused read into a mailbox
     that cannot be opened at all for a while. */
  let closed = 0;
  const s = server([...HELLO, '* 1 EXISTS\r\na2 OK SELECT completed\r\n',
                    '* 1 FETCH (UID 7 BODY[HEADER] {4294967295}\r\n', forever(65), forever(65)]);
  s.socket.close = () => { closed++; };
  await caught(() => W._imapInbox(CFG, 5));
  ok(closed > 0, 'the socket is closed even when the read was refused', closed);
}

if (report('a-number-the-other-end-sent-is-not-a-size') > 0) process.exitCode = 1;
done();
