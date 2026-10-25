/* THE FIRST EMAIL AMV SENDS IS IN THE LANGUAGE THE PERSON IS USING.

   The sign-in code and the password reset code are the emails nobody can get
   in without, and they were English in all seventeen languages AMV speaks -
   the first thing AMV ever said to most of the world, with a code and a
   "never share this" warning, in a language they may not read.

   The page says its language (X-AMV-Lang); without it the browser's own
   (Accept-Language); without either, English. Run against the Worker, with
   every email captured:
   - a sign-up from a Spanish page gets the code in Spanish, and a resend of
     that code stays Spanish whatever the resend request says;
   - a page that says nothing, in a Japanese browser, gets Japanese;
   - Arabic is written right to left - the code itself left to right;
   - a reset code from a German page is German;
   - a language AMV does not speak, or none, is English. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'emaillang.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _emailLang };\n');
const W = await import(harness + '?t=' + Date.now());

let sent = [];
globalThis.fetch = async (url, opts) => {
  sent.push({ url: String(url), body: String((opts && opts.body) || '') });
  return { ok: true, status: 200, json: async () => ({ id: 'em_1' }), text: async () => '{}' };
};
function makeKV() {
  const m = new Map();
  return { _map: m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
    async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } };
}
const env = { AMV_KV: makeKV(), JWT_SECRET: 'test-jwt-secret', APP_URL: 'https://amv.test', EMAIL_API_KEY: 'em-key', RESET_EMAIL_FROM: 'AMV <no-reply@amv.test>',
  AMV_COUNTER: { idFromName: n => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0, claimed: true })); } }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
let ip = 10;
const call = (path, body, headers) => W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.' + (ip++) }, headers || {}), body: JSON.stringify(body || {}) }), env, ctx);
const lastMail = () => { const s = sent[sent.length - 1]; try { return JSON.parse(s.body); } catch (e) { return { raw: s && s.body }; } };
const signup = (email, headers) => call('/auth/signup', { email, name: 'N', password: 'A-real-Passw0rd!' }, headers);

section('A sign-up from a Spanish page gets its code in Spanish, and a resend stays Spanish');
{
  sent = [];
  const r = await signup('ana@example.com', { 'X-AMV-Lang': 'es', 'Accept-Language': 'en-US,en;q=0.9' });
  const d = await r.json();
  const m = lastMail();
  ok(d.needsCode && /^Tu código de AMV: \d{6}$/.test(m.subject || ''), 'the subject is Spanish - the page’s language wins over the browser’s', m.subject);
  ok(/Introduce este código/.test(m.html || '') && /Nunca compartas este código/.test(m.html || ''), 'and so is the body, warning included', (m.html || '').slice(0, 80));
  ok(/Introduce este código/.test(m.text || ''), 'and the plain-text part', (m.text || '').slice(0, 80));
  /* The resend waits 30 seconds after a send; the record is aged instead of waited out. */
  const key = 'signincode:' + d.challenge; const rec = JSON.parse(env.AMV_KV._map.get(key)); rec.at = rec.sentAt = Date.now() - 31000; env.AMV_KV._map.set(key, JSON.stringify(rec));
  sent = [];
  const rr = await call('/auth/login/resend', { challenge: d.challenge }, { 'X-AMV-Lang': 'de' });
  ok(rr.status === 200 && /^Tu código de AMV/.test(lastMail().subject || ''), 'a resend is in the language the code was first sent in', [rr.status, lastMail().subject]);
}

section('No language from the page: the browser’s');
{
  sent = [];
  await signup('kenji@example.com', { 'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.5' });
  ok(/^AMV の確認コード：\d{6}$/.test(lastMail().subject || ''), 'a Japanese browser gets Japanese', lastMail().subject);
}

section('Arabic reads right to left; the code itself left to right');
{
  sent = [];
  await signup('sara@example.com', { 'X-AMV-Lang': 'ar' });
  const h = lastMail().html || '';
  ok(/<html lang="ar" dir="rtl">/.test(h) && /<body dir="rtl"/.test(h), 'the email is marked right to left', h.slice(0, 60));
  ok(/<div dir="ltr"[^>]*>\d{6}</.test(h), 'and the six digits stay in order', (h.match(/<div dir="ltr"[^>]*>\d{6}</) || [''])[0].slice(0, 40));
}

section('A reset code from a German page is German');
{
  sent = [];
  await signup('max@example.com');
  sent = [];
  const r = await call('/auth/reset/code', { email: 'max@example.com' }, { 'X-AMV-Lang': 'de' });
  const m = lastMail();
  ok(r.status === 200 && /Zurücksetzen des AMV-Passworts/.test(m.subject || ''), 'the reset subject is German', [r.status, m.subject]);
  ok(/neues Passwort festzulegen/.test(m.html || ''), 'and its body', (m.html || '').slice(0, 60));
}

section('A language AMV does not speak, or none, is English');
{
  const lang = (h) => W._emailLang(new Request('https://x.test', { headers: h }));
  ok(lang({}) === 'en' && lang({ 'X-AMV-Lang': 'xx', 'Accept-Language': 'sw-KE' }) === 'en', 'unknown and missing fall back to English', [lang({}), lang({ 'X-AMV-Lang': 'xx' })]);
  ok(lang({ 'Accept-Language': 'pt-BR,pt;q=0.9' }) === 'pt' && lang({ 'Accept-Language': 'sw, fr;q=0.8' }) === 'fr', 'a regional tag is its language, and the first one AMV speaks is taken', [lang({ 'Accept-Language': 'pt-BR' }), lang({ 'Accept-Language': 'sw, fr;q=0.8' })]);
  sent = [];
  await signup('nobody@example.com');
  ok(/^Your AMV code: \d{6}$/.test(lastMail().subject || ''), 'and the email is English', lastMail().subject);
}

if (report('the-first-email-is-in-your-language') > 0) process.exitCode = 1;
done();
