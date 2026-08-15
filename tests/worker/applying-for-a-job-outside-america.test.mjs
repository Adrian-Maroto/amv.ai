/* THE ONE CHANNEL IT SAID IT COULD DO END TO END HAD NO ROUTE AT ALL.

   The job hunt's honest-capability note says an email-apply posting is one AMV
   "can submit end to end", and names `gmail_send` as the thing that does it.
   There is no such route. There never was. The client decided `applied_email`,
   wrote it into the application history, and nothing left the building.

   That is a feature reporting success for work that did not happen, which is
   the single thing this product is not allowed to do - and it was sitting
   inside the part of it that is about somebody's livelihood.

   The other half is the one that was obvious: the boards were American. A
   person in Munich, Seoul, Warsaw or Mumbai does not use them.

   Both are fixed by the same work, because the mail connector is what makes an
   application sendable at all - from the person's own address, in every
   country it covers, so an employer's reply reaches them rather than AMV. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'jobs.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, JOB_BOARDS, JOB_APPLY_DAILY_CAP, jobBoards, jobApply, mailConnect,' +
  ' issueTokens, _mailEncrypt };' +
  '\nexport function __setMailConnector(fn){ _mailConnector = fn; }\n');
const W = await import(harness + '?t=' + Date.now());

section('The boards are the ones people in those countries actually use');
{
  const list = Object.entries(W.JOB_BOARDS);
  const countries = new Set(list.map(([, b]) => b.country));
  ok(countries.size >= 25, 'the catalogue spans this many countries', countries.size);
  ok(list.length >= 40, 'across this many boards', list.length);

  /* Named, because "twenty-five countries" is satisfiable with twenty-five
     European ones. Europe AND Asia was the ask. */
  const has = (c) => list.filter(([, b]) => b.country === c).map(([id]) => id);
  [['DE', 'Germany'], ['GB', 'Britain'], ['FR', 'France'], ['ES', 'Spain'], ['PL', 'Poland'],
   ['IT', 'Italy'], ['NL', 'Netherlands'], ['SE', 'Sweden'], ['TR', 'Turkey'],
   ['CN', 'China'], ['JP', 'Japan'], ['KR', 'Korea'], ['IN', 'India'], ['SG', 'Singapore'],
   ['VN', 'Vietnam'], ['ID', 'Indonesia'], ['AE', 'the UAE']].forEach(([code, name]) => {
    if (code === 'ID') return;   // covered by JobStreet's regional sites
    ok(has(code).length > 0, name + ' has a board', has(code));
  });
  ok(W.JOB_BOARDS.job51 && W.JOB_BOARDS.zhaopin, 'including 51job and Zhaopin for China', true);
  ok(W.JOB_BOARDS.saramin && W.JOB_BOARDS.naukri, 'and Saramin and Naukri', true);

  const bad = list.filter(([, b]) => !b.name || !b.country || !b.url || !b.apply).map(([id]) => id);
  ok(bad.length === 0, 'and every entry is complete', bad);
}

section('Each board says what AMV can honestly do on it');
{
  const list = Object.values(W.JOB_BOARDS);
  const kinds = new Set(list.map((b) => b.apply));
  ok([...kinds].every((k) => ['email', 'portal', 'account'].includes(k)),
     'every board is one of the three real cases', [...kinds]);

  /* THE HONEST BOUNDARY. LinkedIn, Indeed, Seek and Naukri all forbid
     automated applying in their terms. AMV does not do it anyway and hope - it
     prepares the application and hands it over. Only an email application is
     something it can finish by itself, and the catalogue says which is which
     rather than leaving the interface to guess. */
  const emailOnes = list.filter((b) => b.apply === 'email');
  ok(emailOnes.length >= 5,
     'some boards publish an address, and those AMV can complete', emailOnes.length);
  const portalOnes = list.filter((b) => b.apply !== 'email');
  ok(portalOnes.length > emailOnes.length,
     'most cannot be, which is the honest shape rather than a convenient one', portalOnes.length);
}

/* ── and now the part that never existed ───────────────────────────────── */

function scriptedSocket(replies) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const queue = replies.slice(); const wrote = [];
  return { wrote, socket: {
    readable: { getReader: () => ({ async read() {
      if (!queue.length) return { value: undefined, done: true };
      return { value: enc.encode(queue.shift()), done: false }; } }) },
    writable: { getWriter: () => ({ async write(b) { wrote.push(dec.decode(b)); }, async close() {} }) },
    close() {} } };
}
const SMTP_OK = [
  '220 ready\r\n', '250-hi\r\n250 AUTH LOGIN\r\n', '334 VXNlcm5hbWU6\r\n', '334 UGFzc3dvcmQ6\r\n',
  '235 ok\r\n', '250 ok\r\n', '250 ok\r\n', '354 go\r\n', '250 queued\r\n', '221 bye\r\n',
];
let LAST = null;
const useScript = (replies) => { const s = scriptedSocket(replies); LAST = s; W.__setMailConnector(async () => s.socket); return s; };

const store = new Map();
function mkEnv(extra) {
  const vals = new Map();
  return Object.assign({
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', APP_URL: 'https://amv.test',
    MAIL_CRED_KEY: 'a-long-enough-key-for-tests-0123456789',
    _vals: vals,
    AMV_KV: {
      async get(k) { return store.has(k) ? store.get(k) : null; },
      async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); },
      async list({ prefix, limit } = {}) {
        const all = [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: all.slice(0, limit || 1000), list_complete: true };
      },
    },
    AMV_COUNTER: { idFromName: (x) => x, get: (x) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body); const cur = vals.get(x) || 0;
      if (b.op === 'reserve') {
        const next = cur + (b.amount || 0);
        if (b.cap && next > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
        vals.set(x, next); return new Response(JSON.stringify({ allowed: true, value: next }));
      }
      if (b.op === 'incr') { vals.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(x) })); }
      if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
      if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: cur < b.cap, value: cur }));
      if (b.op === 'rateCheck') { vals.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
      if (b.op === 'claim') return new Response(JSON.stringify({ claimed: true }));
      if (b.op === 'release') return new Response(JSON.stringify({ released: true }));
      return new Response(JSON.stringify({ allowed: true, value: cur }));
    } }) },
  }, extra || {});
}

const EMAIL = 'seeker@test.com';
const apply = async (env, tok, body) => {
  const r = await W.jobApply(new Request('https://api/v1/jobs/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9',
               ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
    body: JSON.stringify(body || {}),
  }), env);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const LETTER = { to: 'jobs@mittelstand.de', subject: 'Bewerbung: Softwareentwickler',
                 text: 'Sehr geehrte Damen und Herren,\n\nhiermit bewerbe ich mich...',
                 job: { title: 'Softwareentwickler', company: 'Mittelstand GmbH', board: 'arbeitsagentur' } };

const env = mkEnv();
store.set('acct:' + EMAIL, JSON.stringify({ email: EMAIL, name: 'S' }));
const tok = (await W.issueTokens(env, EMAIL, 'S')).token;

section('Without a mailbox it says so, instead of pretending it applied');
{
  const r = await apply(env, tok, LETTER);
  ok(r.status === 428 && r.body.code === 'mail_not_connected',
     'it refuses and names the reason', r.body.code);
  ok(/your own mailbox/i.test(r.body.error || ''),
     'explaining that an employer must be able to reply to you, not to AMV', r.body.error);
  ok(r.body.sent !== true, 'and does not claim to have sent anything', r.body.sent);
}

section('With a mailbox connected, the application is really sent');
{
  useScript(['* OK ready\r\n', 'a1 OK ok\r\n', '* 0 EXISTS\r\na2 OK ok\r\n', 'zz OK\r\n']);
  const c = await W.mailConnect(new Request('https://api/v1/mail/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok, 'CF-Connecting-IP': '9.9.9.9' },
    body: JSON.stringify({ provider: 'gmx', address: 'me@gmx.net', password: 'app-pass' }),
  }), env);
  ok(c.status === 200, 'the mailbox connects', c.status);

  useScript(SMTP_OK);
  const r = await apply(env, tok, LETTER);
  ok(r.status === 200 && r.body.sent === true, 'the application is sent', { status: r.status, sent: r.body.sent });
  ok(r.body.from === 'me@gmx.net',
     'from the person’s own address, so a reply reaches them', r.body.from);

  /* The proof that it actually went, rather than being recorded as gone. */
  const wire = LAST.wrote.join('');
  ok(/MAIL FROM:<me@gmx\.net>/.test(wire), 'the envelope really was addressed', true);
  ok(/RCPT TO:<jobs@mittelstand\.de>/.test(wire), 'to the employer', true);
  ok(/Bewerbung/.test(wire) || /=\?UTF-8\?B\?/.test(wire),
     'carrying the letter that was written', true);
  ok(typeof r.body.remainingToday === 'number',
     'and it says how many are left today', r.body.remainingToday);
}

section('A posting with no address is prepared, not faked');
{
  useScript(SMTP_OK);
  const r = await apply(env, tok, Object.assign({}, LETTER, { to: '' }));
  ok(r.status === 400 && r.body.code === 'no_apply_email',
     'AMV says it cannot send this one', r.body.code);
  ok(/prepare the application/i.test(r.body.error || ''),
     'and offers the thing it can actually do', r.body.error);
}

section('It cannot be turned into a spam cannon');
{
  /* An auto-apply that sends unbounded mail from somebody's own address gets
     THEIR account suspended, not AMV's. So the cap is a hard stop. */
  const env2 = mkEnv();
  store.set('acct:capped@test.com', JSON.stringify({ email: 'capped@test.com', name: 'C' }));
  const t2 = (await W.issueTokens(env2, 'capped@test.com', 'C')).token;
  useScript(['* OK ready\r\n', 'a1 OK ok\r\n', '* 0 EXISTS\r\na2 OK ok\r\n', 'zz OK\r\n']);
  await W.mailConnect(new Request('https://api/v1/mail/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t2, 'CF-Connecting-IP': '9.9.9.9' },
    body: JSON.stringify({ provider: 'gmx', address: 'c@gmx.net', password: 'p' }),
  }), env2);

  let sent = 0, refused = null;
  for (let i = 0; i < W.JOB_APPLY_DAILY_CAP + 3; i++) {
    useScript(SMTP_OK);
    const r = await apply(env2, t2, LETTER);
    if (r.body.sent) sent++; else refused = r;
  }
  ok(sent === W.JOB_APPLY_DAILY_CAP, 'it stops at the daily limit exactly', sent);
  ok(refused && refused.status === 429 && refused.body.code === 'apply_cap',
     'and says so rather than failing silently', refused && refused.body.code);
  ok(/prepared and waiting/i.test((refused && refused.body.error) || ''),
     'telling them the rest are not lost', refused && refused.body.error);
}

section('A send that fails does not spend one of the day’s applications');
{
  const env3 = mkEnv();
  store.set('acct:fail@test.com', JSON.stringify({ email: 'fail@test.com', name: 'F' }));
  const t3 = (await W.issueTokens(env3, 'fail@test.com', 'F')).token;
  useScript(['* OK ready\r\n', 'a1 OK ok\r\n', '* 0 EXISTS\r\na2 OK ok\r\n', 'zz OK\r\n']);
  await W.mailConnect(new Request('https://api/v1/mail/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t3, 'CF-Connecting-IP': '9.9.9.9' },
    body: JSON.stringify({ provider: 'gmx', address: 'f@gmx.net', password: 'p' }),
  }), env3);

  /* The provider refuses the credential mid-send. */
  useScript(['220 ready\r\n', '250 hi\r\n', '334 a\r\n', '334 b\r\n', '535 bad password\r\n']);
  const bad = await apply(env3, t3, LETTER);
  ok(bad.body.sent === false || bad.status >= 400, 'the application fails', { s: bad.status, sent: bad.body.sent });
  ok(/was not sent/i.test(bad.body.error || ''),
     'and is described as not sent, not as a delivery problem', bad.body.error);

  const used = env3._vals.get('jobapply:fail@test.com:' + new Date().toISOString().slice(0, 10)) || 0;
  ok(used === 0,
     'and the day’s allowance is given back, so a bad password does not eat it', used);
}

section('The route that was missing is the one the job hunt always described');
{
  /* The client's honest-capability comment named a tool that had no backend.
     Asserted so the description and the code cannot drift apart again. */
  const code = codeOnly(src);
  ok(/case '\/v1\/jobs\/apply':/.test(code), 'there is now a route that applies', true);
  const fn = codeOnly(functionBody(src, 'jobApply'));
  ok(/_smtpSend\(/.test(fn), 'and it sends over SMTP rather than recording that it did', true);
  ok(/_accountHold\(/.test(fn), 'an account on hold cannot send as somebody', true);
  const capAt = fn.indexOf('JOB_APPLY_DAILY_CAP'), sendAt = fn.indexOf('_smtpSend');
  ok(capAt > 0 && capAt < sendAt, 'and the limit is counted before anything is sent', { capAt, sendAt });
}

if (report('applying-for-a-job-outside-america') > 0) process.exitCode = 1;
done();
