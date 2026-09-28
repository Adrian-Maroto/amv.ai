/* THE INBOX PEOPLE THERE ACTUALLY USE.

   Asked for: the top of Crew in the US should say "check Gmail", and in China
   whatever China uses. Two things have to be true for that to be more than a
   label:

     1. the catalogue knows, per country, which mailboxes people use - most
        used first, each one something AMV can really connect;
     2. an unattended job can READ that mailbox. It could not: mail.read meant
        a Google grant and nothing else, so a "summarise my QQ Mail" job
        switched on in Beijing would have run every evening on nothing.

   The second is proved against a scripted IMAP server, through the real cron
   and the real runner, with the model call captured - so the assertion is on
   what the job actually saw. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'inbox-there.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _mailEncrypt, COUNTRY_MAIL, MAIL_PROVIDERS, _mailboxUse };\nexport function __setMailConnector(fn){ _mailConnector = fn; }\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const USER = 'li@example.com';
let sent = [];
globalThis.fetch = async (url, opts) => {
  if (/model\.example/.test(String(url))) {
    sent.push(JSON.parse(String((opts && opts.body) || '{}')));
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 10, output_tokens: 10 } }) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};
function mkEnv() {
  const m = new Map(); const vals = new Map(); sent = [];
  return {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example', JWT_SECRET: 'j', ADMIN_TOKEN: 'a',
    APP_URL: 'https://amv.test', MAIL_CRED_KEY: 'a-long-test-key-for-mail-credentials-0123456789',
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) { const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })); return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true }; },
    },
    AMV_COUNTER: { idFromName: (n) => n, get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
      if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) })); }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
      return new Response(JSON.stringify({ allowed: true, value: cur }));
    } }) },
  };
}
const mkCtx = () => ({ waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } });
const get = (env, path) => worker.fetch(new Request('https://api.amv.test' + path, { headers: { 'CF-Connecting-IP': '62.62.62.62' } }), env, mkCtx());

/* A scripted IMAP server: greeting, login, select, one FETCH, logout. */
const enc = new TextEncoder(), dec = new TextDecoder();
const literal = (t) => '{' + enc.encode(t).length + '}\r\n' + t;
let wrote = [];
function script(replies) {
  const q = replies.slice(); wrote = [];
  W.__setMailConnector(async () => ({
    readable: { getReader: () => ({ async read() { return q.length ? { value: enc.encode(q.shift()), done: false } : { value: undefined, done: true }; } }) },
    writable: { getWriter: () => ({ async write(b) { wrote.push(dec.decode(b)); }, async close() {} }) },
    close() {},
  }));
}
const head = 'From: 招商银行 <bill@cmbchina.com>\r\nSubject: =?UTF-8?B?5L+h55So5Y2h6LSm5Y2V?=\r\nDate: Mon, 28 Sep 2026 09:00:00 +0800\r\n\r\n';
const QQ = [
  '* OK IMAP4rev1 ready\r\n', 'a1 OK LOGIN completed\r\n', '* 1 EXISTS\r\na2 OK [READ-WRITE] SELECT completed\r\n',
  '* 1 FETCH (UID 7 FLAGS () BODY[HEADER.FIELDS (FROM TO SUBJECT DATE)] ' + literal(head) + ')\r\na3 OK FETCH completed\r\n',
  'zz OK LOGOUT completed\r\n',
];

section('Which mailbox, country by country');
{
  const env = mkEnv();
  const order = async (cc) => ((await (await get(env, '/v1/everyday?country=' + cc)).json()).inbox || []).map(m => m.id);
  const cn = await order('CN'), us = await order('US'), de = await order('DE'), kr = await order('KR'), ru = await order('RU');
  ok(cn[0] === 'qq' && cn.includes('netease163'), 'China: QQ Mail first, NetEase 163 with it', cn);
  ok(us[0] === 'gmail' && us.includes('yahoo') && us.includes('outlook'), 'United States: Gmail first, then Yahoo and Outlook', us);
  ok(de[0] === 'webde' && de.includes('gmx'), 'Germany: WEB.DE and GMX, ahead of Gmail', de);
  ok(kr[0] === 'naver', 'Korea: Naver', kr);
  ok(ru[0] === 'mailru' && ru.includes('yandex'), 'Russia: Mail.ru and Yandex', ru);
  const all = Object.values(W.COUNTRY_MAIL).flat();
  ok(all.every(id => W.MAIL_PROVIDERS[id]), 'every mailbox named is one AMV can actually connect', all.filter(id => !W.MAIL_PROVIDERS[id]));
  const how = (await (await get(env, '/v1/everyday?country=CN')).json()).inbox[0].how;
  ok(how === 'mail:qq', 'and QQ Mail connects by its own app password, not by a Google sign-in', how);
  const usBank = (await (await get(env, '/v1/everyday?country=US')).json()).bank;
  const cnBank = (await (await get(env, '/v1/everyday?country=CN')).json()).bank;
  ok(usBank === true && cnBank === false, 'a bank can be linked in the US and not in China, and the page is told which', { usBank, cnBank });
}

async function withMailbox(env, provider) {
  const secret = await W._mailEncrypt(env, 'qq-authorisation-code');
  await W.DB.put(env, 'mailcfg', USER, { address: 'li@qq.com', secret, imap: 'imap.qq.com', smtp: 'smtp.qq.com', provider });
  await W.DB.put(env, 'ent', USER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  await W.DB.put(env, 'user', USER, { email: USER, name: 'Li', created: Date.now() });
}
async function due(env, extra) {
  await W.DB.put(env, 'auto', USER, Object.assign({ items: [{ id: 'j1', detail: 'Summarise my inbox', uses: ['mail.read'], active: true,
    next: Date.now() - 60000, interval: 86400000, kind: 'task', approval: 'require' }], results: [] }, extra || {}));
  const c = mkCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.settle();
  return JSON.stringify((sent[sent.length - 1] || {}).messages || []);
}

section('A job reads the QQ Mail inbox somebody connected - with no Google anywhere');
{
  const env = mkEnv(); await withMailbox(env, 'qq'); script(QQ);
  const turn = await due(env);
  ok(sent.length === 1, 'the job ran', sent.length);
  ok(/REAL INBOX - QQ Mail/.test(turn), 'and was handed the real QQ Mail inbox', turn.slice(0, 200));
  ok(/信用卡账单/.test(turn) && /招商银行/.test(turn), 'with the actual message - the Chinese subject decoded, the sender intact', turn.slice(0, 300));
  ok(!/COULD NOT SEE/.test(turn), 'and was not told the mailbox was missing', turn.slice(0, 200));
  ok(/BODY\.PEEK/.test(wrote.join('')), 'read with PEEK, so the run marks nothing as read', true);
}

section('Paused means paused, for this mailbox too');
{
  const env = mkEnv(); await withMailbox(env, 'qq'); script(QQ);
  await W.DB.put(env, 'auto', USER, { paused: true, items: [], results: [] });
  const rec = await W.DB.get(env, 'auto', USER);
  rec.items = [{ id: 'j1', detail: 'Summarise my inbox', uses: ['mail.read'], active: true, next: Date.now() - 60000, interval: 86400000, kind: 'task', approval: 'require' }];
  await W.DB.put(env, 'auto', USER, rec);
  const c = mkCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.settle();
  const turn = JSON.stringify((sent[sent.length - 1] || {}).messages || []);
  ok(!/REAL INBOX/.test(turn) && wrote.length === 0, 'a paused account opens no mailbox', { ran: sent.length, wrote: wrote.length });
}

section('The mailbox door checks the pause itself, not only the scheduler in front of it');
{
  /* The cron already skips a paused account, so the case above never reaches
     this door. A second path to it (a job run by hand, a future caller) must
     not find it open - so the door is asked directly. */
  const env = mkEnv(); await withMailbox(env, 'qq');
  await W.DB.put(env, 'auto', USER, { paused: true, items: [], results: [] });
  const r = await W._mailboxUse(env, USER, 'j1');
  ok(r.ok === false && r.code === 'autonomy_paused', 'paused: the door stays shut', r);
  await W.DB.put(env, 'auto', USER, { paused: false, items: [], results: [] });
  const r2 = await W._mailboxUse(env, USER, 'j1');
  ok(r2.ok === true && r2.cfg && r2.cfg.provider === 'qq', 'unpaused: it opens, onto the QQ Mail box', r2.ok);
}

section('No mailbox at all still says so');
{
  const env = mkEnv();
  await W.DB.put(env, 'ent', USER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  await W.DB.put(env, 'user', USER, { email: USER, name: 'Li', created: Date.now() });
  const turn = await due(env);
  const rec = await W.DB.get(env, 'auto', USER);
  const r0 = (rec.results || [])[0] || {};
  ok(sent.length === 0, 'nothing connected: the model is never called, so nothing is spent inventing an inbox', sent.length);
  ok(r0.outcome === 'needs_access' && /mailbox/.test(JSON.stringify(r0.needs || '')), 'and the person is told to connect their mailbox', r0.outcome);
}

report();
done();
