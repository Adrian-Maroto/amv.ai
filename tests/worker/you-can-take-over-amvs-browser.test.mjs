/* YOU CAN TAKE OVER AMV'S BROWSER - AND IT STAYS AS SAFE IN YOUR HANDS.

   A run that meets a captcha, or a sign-in AMV has nothing for, used to close
   the browser and say "solve it yourself" with nowhere to do it. In a run
   somebody is watching, the browser is now handed over (72-web-takeover.js):
   kept open, the person clicks and types into it through AMV, and the run
   carries on in the same browser. Driven through the real routes with a
   stand-in browser that has sessions, as Cloudflare's does:

     - the browser is launched with a keep-alive, and at a captcha it is let
       go of, not closed, with a handle - and the holding time is charged;
     - the handle works only for the account it was made for, and not once
       the browser has gone;
     - every action re-applies the request isolation BEFORE acting, and a page
       that lands somewhere it must not ends the browser;
     - what is typed reaches the page and is in no log, record or answer;
     - "carry on" continues in the same browser without opening the page
       again; a run nobody watches still closes, as before. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'webtake.harness.mjs');
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
  const s = { launches: [], connects: 0, closed: 0, disconnects: 0, gotos: [], typed: [], clicks: [], keys: [], intercepts: 0, alive: true, connected: false, captcha: true, landAt: null };
  const page = { u: 'about:blank',
    async setViewport(){}, async setRequestInterception(){ s.intercepts++; }, on(){},
    async goto(u){ s.gotos.push(u); this.u = u; }, async url(){ return this.u; },
    async setCookie(){}, async cookies(){ return []; },
    async evaluate(x){
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

let handle = '';
section('At a captcha, a watched run hands the browser over instead of closing it');
{
  env.BROWSER = fakeService();
  const before = spent();
  const e = await endOf(await req('/v1/browser/run?live=1', GOAL));
  handle = e.takeover || '';
  ok(S.launches[0] && S.launches[0].keep_alive === W.WEB_HOLD_MS, 'the browser was started with a keep-alive', S.launches);
  ok(e.code === 'needs_human' && handle && e.takeoverForMs === W.WEB_HOLD_MS, 'the answer carries a handle to take over with', [e.code, !!handle]);
  ok(S.closed === 0 && S.disconnects === 1 && S.alive, 'the browser was let go of, not closed', S);
  ok(!handle.includes('sess-1') && !handle.includes('surfer'), 'the handle names neither the session nor the account', handle.slice(0, 40));
  ok(spent() - before >= (W.WEB_HOLD_MS / 3600000) * W.WEB_BROWSER_USD_PER_HOUR - 1e-9, 'and the time it is held is charged to the run', spent() - before);
}

section('A run nobody watches still closes, as before');
{
  env.BROWSER = fakeService();
  const r = await req('/v1/browser/run', GOAL);
  const d = await r.json();
  ok(d.code === 'needs_human' && !d.takeover && S.closed === 1 && !S.launches[0], 'no handle, browser closed, no keep-alive', [d.takeover, S.closed, S.launches]);
  env.BROWSER = fakeService();
  S.alive = true;
  const e = await endOf(await req('/v1/browser/run?live=1', GOAL));
  handle = e.takeover || '';
}

section('The person’s hands: click, type, keys - isolation first, every time');
{
  const intercepts = S.intercepts;
  const look = await take(handle, { kind: 'look' });
  ok(look.status === 200 && look.d.shot && S.intercepts === intercepts + 1, 'a look reconnects, isolates first, and shows the page', [look.status, S.intercepts]);
  ok(S.disconnects >= 2 && S.closed === 0, 'and lets go again afterwards', S.disconnects);
  const c = await take(handle, { kind: 'click', x: 640, y: 300 });
  ok(c.status === 200 && S.clicks.at(-1).join() === '640,300', 'a tap on the picture is a click there', S.clicks);
  const PASSWORD = 'Hunter2-correct-horse';
  const t = await take(handle, { kind: 'type', text: PASSWORD });
  ok(t.status === 200 && S.typed.at(-1) === PASSWORD, 'what they type reaches the page', S.typed.length);
  ok(!JSON.stringify(t.d).includes(PASSWORD) && ![...store.values()].some(v => String(v).includes(PASSWORD)) && !logs.some(l => l.includes(PASSWORD)),
    'and is in no answer, no record and no log', true);
  const k = await take(handle, { kind: 'key', key: 'Enter' });
  ok(k.status === 200 && S.keys.at(-1) === 'Enter', 'keys are pressed', S.keys);
  const bad = await take(handle, { kind: 'key', key: 'Control+w' });
  const far = await take(handle, { kind: 'click', x: 99999, y: 5 });
  const long = await take(handle, { kind: 'type', text: 'x'.repeat(501) });
  ok(bad.status === 400 && far.status === 400 && long.status === 400, 'anything outside the known keys, the page or the length is refused', [bad.status, far.status, long.status]);
}

section('The handle is the account’s own, and only while the browser lives');
{
  const theirs = await take(handle, { kind: 'look' }, other.token);
  ok(theirs.status === 410, 'another account cannot use it', theirs.status);
  const made = await take('2.abcd.' + 'A'.repeat(40), { kind: 'look' });
  ok(made.status === 410, 'nor can a made-up one', made.status);
}

section('Carry on: the same browser, not the page again');
{
  const gotos = S.gotos.length, launches = S.launches.length;
  decisions = [{ verb: 'done', why: 'Your newest message is about two lamps.' }];
  const e = await endOf(await req('/v1/browser/run?live=1', Object.assign({ resume: handle }, GOAL)));
  ok(e.ok === true && /two lamps/.test(e.result || ''), 'the run finishes from where they left it', JSON.stringify(e).slice(0, 160));
  ok(S.launches.length === launches && S.gotos.length === gotos && S.connects >= 1, 'no new browser, and the page was not opened again', [S.launches.length, S.gotos.length]);
  ok(S.closed === 1, 'and the browser is closed at the end', S.closed);
  const after = await take(handle, { kind: 'look' });
  ok(after.status === 410, 'after which the handle reaches nothing', after.status);
  const resumeGone = await req('/v1/browser/run?live=1', Object.assign({ resume: handle }, GOAL));
  const r2 = await endOf(resumeGone);
  ok(r2.code === 'takeover_gone', 'and carrying on again says the browser has closed', r2.code);
}

section('A page that lands somewhere it must not ends the browser');
{
  env.BROWSER = fakeService();
  const e = await endOf(await req('/v1/browser/run?live=1', GOAL));
  S.landAt = 'http://169.254.169.254/latest/meta-data';
  const r = await take(e.takeover, { kind: 'click', x: 10, y: 10 });
  ok(r.status === 400 && r.d.code === 'blocked_url' && S.closed === 1, 'refused, and the browser is closed', [r.status, S.closed]);
}

section('Close is the person’s too');
{
  env.BROWSER = fakeService();
  const e = await endOf(await req('/v1/browser/run?live=1', GOAL));
  const r = await take(e.takeover, { kind: 'close' });
  ok(r.status === 200 && r.d.closed && S.closed === 1, 'closing ends the browser', S.closed);
}

console.log = origLog;
if (report('you-can-take-over-amvs-browser') > 0) process.exitCode = 1;
done();
