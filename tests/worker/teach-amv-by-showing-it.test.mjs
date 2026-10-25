/* TEACH AMV BY SHOWING IT - AND WHAT IS TYPED INTO A SECRET FIELD IS NEVER KEPT.

   Audit #34. "Watch me do this": AMV's browser opens at a site the person
   names and is handed straight to them; each click and each thing typed
   comes back described, the page lists the steps, and they become a skill
   the person reads before it is saved (web-live.js). Driven through the real
   routes with a stand-in browser that has sessions:

     - /v1/browser/teach opens the site with a keep-alive, hands it over (let
       go of, not closed) and charges the time it is held;
     - an address that is not allowed is refused before a browser starts, and
       a deployment without a browser says so before anything is charged;
     - a click comes back as the thing clicked, named as the page names it,
       with where it happened - and never the query string;
     - text typed into an ordinary field is part of the step; text typed into
       a password, one-time-code or card field is NOT, anywhere - not in the
       answer, any record or any log - and the step says a secret was typed;
     - only a browser opened to be taught describes anything: a run handed
       over at a captcha does not; and the handle is the account's own. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'webteach.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { issueTokens, WEB_HOLD_MS, WEB_BROWSER_USD_PER_HOUR };
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'surfer@test.com', OTHER = 'other@test.com';
const store = new Map();
const vals = new Map();
const logs = [];
const origLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); };
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  CONNECT_KEY: 'a-connect-key-for-sealing-at-least-32-chars', AMV_MODEL_KEY: 'k', AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k, v){ store.set(k, v); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
      if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: cur + b.amount })); }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      return new Response(JSON.stringify({ allowed: true, ok: true, value: cur }));
    } }),
  } };
store.set('ent:' + ME, JSON.stringify({ plan: 'pro', renewedAt: Date.now() }));
store.set('ent:' + OTHER, JSON.stringify({ plan: 'pro', renewedAt: Date.now() }));
const pair = await W.issueTokens(env, ME, 'Surfer');
const other = await W.issueTokens(env, OTHER, 'Other');

/* A browser service with sessions: launch (with options), connect by id, and
   a session that lives until it is closed. One connection at a time. */
let S;
function fakeService() {
  const s = { launches: [], connects: 0, closed: 0, disconnects: 0, gotos: [], typed: [], clicks: [], keys: [], described: [], intercepts: 0, alive: true, connected: false, captcha: true, landAt: null };
  const page = { u: 'about:blank',
    async setViewport(){}, async setRequestInterception(){ s.intercepts++; }, on(){},
    async goto(u){ s.gotos.push(u); this.u = u; }, async url(){ return this.u; },
    async setCookie(){}, async cookies(){ return []; },
    async evaluate(x){
      if (typeof x === 'string' && /elementFromPoint/.test(x)) { s.described.push(x); return S.under; }
      if (typeof x === 'string' && /document\.activeElement/.test(x)) { s.described.push(x); return S.focused; }
      if (typeof x === 'string' && /getBoundingClientRect/.test(x))
        return { url: this.u, title: 'Sign in', text: s.captcha ? 'Are you a robot?' : 'Welcome back, Kim.', captcha: s.captcha, elements: [{ ref: 1, tag: 'a', type: '', label: 'Account' }] };
    },
    async click(){}, async type(){}, async select(){},
    mouse: { async click(x, y){ s.clicks.push([x, y]); if (s.landAt) page.u = s.landAt; } },
    keyboard: { async type(t){ s.typed.push(t); }, async press(k){ s.keys.push(k); if (k === 'Enter') s.captcha = false; } },
    async screenshot(){ return Buffer.from('jpeg').toString('base64'); } };
  const browser = { sessionId(){ return 'sess-1'; },
    async newPage(){ return page; }, async pages(){ return [page]; },
    async close(){ s.closed++; s.alive = false; s.connected = false; },
    async disconnect(){ s.disconnects++; s.connected = false; } };
  S = s;
  return {
    async launch(opts){ s.launches.push(opts || null); s.connected = true; return browser; },
    async connect(id){ if (!s.alive || id !== 'sess-1' || s.connected) throw new Error('no such session'); s.connects++; s.connected = true; return browser; },
  };
}
let decisions = [];
globalThis.fetch = async () => {
  const d = decisions.length ? decisions.shift() : { verb: 'done', why: 'Signed in and read it.' };
  return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(d) }], stop_reason: 'end_turn',
    usage: { input_tokens: 3000, output_tokens: 60 } }), { status: 200 });
};
const pending = [];
const ctx = { waitUntil(p){ pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException(){} };
let ip = 1;
const req = (path, body, tok = pair.token) => W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.7.' + (ip++ % 250) },
  body: JSON.stringify(body) }), env, ctx);
const endOf = async (r) => {
  const text = await r.text(); await Promise.all(pending.splice(0));
  const ends = text.split('\n\n').filter(c => c.startsWith('data: ')).map(c => JSON.parse(c.slice(6))).filter(e => e.type === 'end');
  return ends[0] || {};
};
const take = async (handle, act, tok) => { const r = await req('/v1/browser/takeover', { handle, act }, tok); return { status: r.status, d: await r.json().catch(() => ({})) }; };
const spent = () => [...vals.entries()].filter(([k]) => k.startsWith('cost:' + ME)).reduce((a, [, v]) => a + v, 0);
const GOAL = { url: 'https://shop.example.com/account', goal: 'Read my newest account message.' };


const START = { url: 'https://crm.example.com/deals?token=abc' };
let handle = '';

section('Teaching opens the site and hands the browser straight over');
{
  env.BROWSER = fakeService();
  const before = spent();
  const r = await req('/v1/browser/teach', START);
  const d = await r.json();
  handle = d.handle || '';
  ok(r.status === 200 && handle && d.forMs === W.WEB_HOLD_MS && d.shot, 'a handle, the time it is held, and a picture of the page', [r.status, !!handle]);
  ok(S.launches[0] && S.launches[0].keep_alive === W.WEB_HOLD_MS && S.gotos[0] === START.url, 'launched with a keep-alive, at the site named', [S.launches, S.gotos]);
  ok(S.closed === 0 && S.disconnects === 1 && S.intercepts === 1, 'isolated before it opened the page, then let go of - not closed', S);
  ok(d.at === 'crm.example.com/deals', 'where it is, without the query string', d.at);
  ok(spent() - before >= (W.WEB_HOLD_MS / 3600000) * W.WEB_BROWSER_USD_PER_HOUR - 1e-9, 'and the time it is held is charged', spent() - before);
}

section('A click comes back as what was clicked');
{
  S.under = { tag: 'button', type: 'submit', role: '', label: 'Mark as won', ac: '' };
  const c = await take(handle, { kind: 'click', x: 400, y: 220 });
  ok(c.status === 200 && c.d.step && c.d.step.kind === 'click' && c.d.step.label === 'Mark as won' && c.d.step.tag === 'button', 'the step names the button as the page does', c.d.step);
  ok(S.described.at(-1).includes('elementFromPoint(400,220)') && S.clicks.at(-1).join() === '400,220', 'read at the point tapped, before the click', S.described.at(-1).slice(0, 60));
  ok(c.d.step.at === 'crm.example.com/deals', 'with where it happened, and no query string', c.d.step.at);
}

section('Ordinary text is part of the step; a secret never is');
{
  S.focused = { tag: 'input', type: 'text', role: '', label: 'Note', ac: '' };
  const t = await take(handle, { kind: 'type', text: 'Signed the renewal' });
  ok(t.d.step && t.d.step.text === 'Signed the renewal' && t.d.step.label === 'Note', 'what was typed, and where', t.d.step);
  const SECRET = 'Hunter2-correct-horse';
  for (const f of [{ type: 'password', label: 'Password', ac: '' }, { type: 'text', label: 'Code', ac: 'one-time-code' }, { type: 'text', label: 'Card number', ac: '' }, { type: 'tel', label: 'Your PIN', ac: '' }]) {
    S.focused = Object.assign({ tag: 'input', role: '' }, f);
    const p = await take(handle, { kind: 'type', text: SECRET });
    ok(p.status === 200 && S.typed.at(-1) === SECRET, f.label + ': the page still receives it', S.typed.length);
    ok(p.d.step && p.d.step.secret === true && !('text' in p.d.step), f.label + ': the step says a secret was typed, and nothing else', p.d.step);
  }
  ok(![...store.values()].some(v => String(v).includes(SECRET)) && !logs.some(l => l.includes(SECRET)), 'and it is in no record and no log', true);
}

section('Only a browser opened to be taught describes anything');
{
  env.BROWSER = fakeService();
  const e = await endOf(await req('/v1/browser/run?live=1', { url: 'https://shop.example.com/account', goal: 'Read my newest account message.' }));
  S.under = { tag: 'a', label: 'Orders' };
  const c = await take(e.takeover, { kind: 'click', x: 10, y: 10 });
  ok(c.status === 200 && !c.d.step && S.described.length === 0, 'a run handed over at a captcha records nothing', c.d);
  const theirs = await take(handle, { kind: 'look' }, other.token);
  ok(theirs.status === 410, 'and a teaching handle is the account’s own', theirs.status);
}

section('Refused before a browser starts, or before anything is charged');
{
  env.BROWSER = fakeService();
  const before = spent();
  const bad = await req('/v1/browser/teach', { url: 'http://127.0.0.1:8080/admin' });
  ok(bad.status === 400 && S.launches.length === 0, 'an address AMV may not visit opens nothing', [bad.status, S.launches.length]);
  delete env.BROWSER;
  const none = await req('/v1/browser/teach', START);
  const nd = await none.json();
  ok(none.status === 503 && nd.code === 'needs_service' && spent() === before, 'no browser on this deployment: said, and nothing charged', [none.status, spent() - before]);
  const anon = await W.default.fetch(new Request('https://api.amv.test/v1/browser/teach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(START) }), env, ctx);
  ok(anon.status === 401, 'and nobody signed out can start one', anon.status);
}

console.log = origLog;
if (report('teach-amv-by-showing-it') > 0) process.exitCode = 1;
done();
