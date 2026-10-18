/* A WEB RUN IS WATCHED, AND PAID FOR.

   The web agent (/v1/browser/run) drives a hosted browser: up to 24 model
   decisions and 90 seconds of browser time per run. None of it was counted -
   not against the allowance, a family's limit, an account on hold or the day's
   ceiling. And it ran blind: the person saw the outcome, never the run.

   Driven end to end through the real route with a stand-in browser (an object
   with `launch`, which Cloudflare's binding never has - see _webLaunch) and a
   stand-in model, so what is asserted is what the run did, cost and showed:

     - a run reserves its most before a browser starts and settles at what it
       used, and the owner's figures see it;
     - over the allowance, no browser is ever started;
     - live mode streams every step with a picture of the page, then the same
       answer the plain call gives;
     - when the person stops watching, the run stops - and stops spending. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'webrun.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { issueTokens, ENGINES, WEB_BROWSER_USD_PER_HOUR };
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'surfer@test.com';
const store = new Map();
const vals = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  AMV_MODEL_KEY: 'k', AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k, v){ store.set(k, v); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body);
      const cur = vals.get(n) || 0;
      if (b.op === 'reserve') {
        if (b.cap != null && cur + b.amount > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
        vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: cur + b.amount }));
      }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      return new Response(JSON.stringify({ allowed: true, ok: true, value: cur }));
    } }),
  } };
store.set('ent:' + ME, JSON.stringify({ plan: 'pro', renewedAt: Date.now() }));
const pair = await W.issueTokens(env, ME, 'Surfer');

/* The browser: a page with two things on it, and a record of what happened. */
let B;
function fakeBrowser() {
  const s = { launched: 0, closed: 0, gotos: [], clicks: [], shots: 0, setBeforeGoto: null, set: [], jar: [] };
  const page = { u: 'about:blank',
    async setViewport(){}, async setRequestInterception(){}, on(){},
    async goto(u){ if (s.setBeforeGoto === null) s.setBeforeGoto = s.set.length; s.gotos.push(u); this.u = u; }, async url(){ return this.u; },
    async setCookie(...cs){ s.set.push(...cs); },
    async cookies(...urls){ s.cookieUrls = urls; return s.jar; },
    async evaluate(x){ if (typeof x === 'string' && /getBoundingClientRect/.test(x)) return { url: this.u, title: 'Gym prices', text: 'Monthly prices for the city gyms.', captcha: false,
      elements: [{ ref: 1, tag: 'a', type: '', label: 'Prices' }, { ref: 2, tag: 'button', type: 'button', label: 'Show more' }] }; },
    async click(sel){ s.clicks.push(sel); if (sel.includes('"1"')) s.jar = [
      { name: 'sid', value: 'SESSION-SECRET-7f3a', domain: '.gyms.example.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: -1 },
      { name: 'bad name', value: 'x', domain: '.gyms.example.com', path: '/' }]; }, async type(){}, async select(){}, keyboard: { async press(){} },
    async screenshot(){ s.shots++; return Buffer.from('jpeg-of-step-' + s.shots).toString('base64'); } };
  B = s;
  return { async launch(){ s.launched++; return { async newPage(){ return page; }, async close(){ s.closed++; } }; } };
}
/* The model: click, then done - or click for ever, for the run that is stopped. */
let decisions = [], modelCalls = 0, prompts = [];
globalThis.fetch = async (u, init) => {
  modelCalls++;
  prompts.push(String((init && init.body) || ''));
  const d = decisions.length ? decisions.shift() : { verb: 'click', ref: 2, why: 'show more' };
  return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(d) }], stop_reason: 'end_turn',
    usage: { input_tokens: 3000, output_tokens: 60 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const pending = [];
const ctx = { waitUntil(p){ pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException(){} };
let ip = 1;
const run = (body, q = '') => W.default.fetch(new Request('https://api.amv.test/v1/browser/run' + q, { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pair.token, Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.5.' + (ip++) },
  body: JSON.stringify(body) }), env, ctx);
const sum = (prefix) => [...vals.entries()].filter(([k]) => k.startsWith(prefix)).reduce((a, [, v]) => a + v, 0);
const GOAL = { url: 'https://gyms.example.com/', goal: 'Find the monthly price of the cheapest gym.' };

section('Not switched on: refused before anything is held');
{
  const r = await run(GOAL);
  const d = await r.json();
  ok(r.status === 503 && d.code === 'needs_service', 'no browser on this deployment says so', r.status);
  ok(sum('cost:' + ME) === 0, 'and nothing was reserved', sum('cost:' + ME));
}

section('A run is reserved for, then charged what it really used');
{
  env.BROWSER = fakeBrowser();
  decisions = [{ verb: 'click', ref: 1, why: 'open prices' }, { verb: 'done', why: 'The cheapest is 29 a month.' }];
  modelCalls = 0;
  const t0 = Date.now();
  const r = await run(GOAL);
  const d = await r.json();
  const ms = Date.now() - t0;
  ok(r.status === 200 && d.ok === true && /29 a month/.test(d.result), 'the run finishes', r.status + ' ' + JSON.stringify(d).slice(0, 120));
  ok(B.launched === 1 && B.closed >= 1, 'one browser, closed at the end', B);
  const eng = W.ENGINES['amv-pulse'];
  const model = modelCalls * ((3000 / 1e6) * eng.inCost + (60 / 1e6) * eng.outCost);
  const charged = sum('cost:' + ME);
  const browserMax = (ms / 3600000) * W.WEB_BROWSER_USD_PER_HOUR;
  ok(charged >= model - 1e-12 && charged <= model + browserMax + 1e-12, 'charged for its two decisions and its seconds of browser - not the reservation', { charged, model, browserMax });
  ok(Math.abs(sum('featcost:webagent:') - charged) < 1e-12, 'and it shows in the owner’s cost figures as web runs', sum('featcost:webagent:'));
}

section('Over the allowance, no browser is started');
{
  const name = [...vals.keys()].find(k => k.startsWith('cost:' + ME));
  vals.set(name, 1e6);
  env.BROWSER = fakeBrowser();
  const r = await run(GOAL);
  const d = await r.json();
  ok(r.status === 429 && /allowance|limit/i.test(d.error || ''), 'refused with the reason', r.status + ' ' + d.error);
  ok(B.launched === 0, 'and no browser was ever opened', B.launched);
  vals.clear();
}

section('Live: every step with a picture of the page, then the same answer');
{
  env.BROWSER = fakeBrowser();
  decisions = [{ verb: 'click', ref: 1, why: 'open prices' }, { verb: 'done', why: 'The cheapest is 29 a month.' }];
  const r = await run(GOAL, '?live=1');
  ok(r.status === 200 && /text\/event-stream/.test(r.headers.get('Content-Type') || ''), 'answered as a stream', r.headers.get('Content-Type'));
  const text = await r.text();
  await Promise.all(pending.splice(0));
  const evs = text.split('\n\n').filter(Boolean).map(b => JSON.parse(b.replace(/^data: /, '')));
  const steps = evs.filter(e => e.type === 'step');
  const end = evs[evs.length - 1];
  ok(steps.length >= 2 && steps[0].verb === 'open' && steps[1].verb === 'click', 'the page as it opened, then the click', steps.map(s => s.verb));
  ok(steps.every(s => Buffer.from(s.shot, 'base64').toString().startsWith('jpeg-of-step-')) && steps[1].url === 'https://gyms.example.com/', 'each with a picture of the page and where it was', steps.map(s => s.url));
  ok(end && end.type === 'end' && end.status === 200 && end.ok === true && /29 a month/.test(end.result), 'ending with exactly what the plain call returns', end);
}

section('Signed in once, signed in the next time - the sign-in going back to the person, nowhere else');
{
  vals.clear();
  const logs = []; const realLog = console.log; console.log = (...a) => logs.push(a.map(String).join(' '));
  env.BROWSER = fakeBrowser();
  decisions = [{ verb: 'click', ref: 1, why: 'sign in' }, { verb: 'done', why: 'Signed in and found it.' }];
  prompts = [];
  const r = await run(GOAL);
  const d = await r.json();
  console.log = realLog;
  const sid = (d.cookies || []).find(c => c.name === 'sid');
  ok(sid && sid.value === 'SESSION-SECRET-7f3a' && sid.domain === '.gyms.example.com' && sid.httpOnly === true, 'the run hands back the site’s sign-in', d.cookies);
  ok((d.cookies || []).every(c => c.name !== 'bad name'), 'and only cookies a browser would accept', (d.cookies || []).map(c => c.name));
  ok((B.cookieUrls || []).includes('https://gyms.example.com/'), 'asked for the sites the run was actually on', B.cookieUrls);
  const elsewhere = JSON.stringify(d.trace || []) + logs.join('\n') + prompts.join('\n') + [...store.values()].join('\n');
  ok(!elsewhere.includes('SESSION-SECRET-7f3a'), 'it is in no trace, no log line, no stored record, and nothing the model read', elsewhere.length);

  env.BROWSER = fakeBrowser();
  decisions = [{ verb: 'done', why: 'Already signed in.' }];
  const sent = [sid,
    { name: 'pivot', value: 'x', domain: '.internal', path: '/' },
    { name: 'meta', value: 'x', domain: '169.254.169.254', path: '/' },
    { name: 'inj', value: 'a;b', domain: '.gyms.example.com', path: '/' }];
  const r2 = await run(Object.assign({ cookies: sent }, GOAL));
  await r2.json();
  ok(B.set.length === 1 && B.set[0].name === 'sid' && B.set[0].value === 'SESSION-SECRET-7f3a', 'next time the sign-in is put back in the browser', B.set.map(c => c.name));
  ok(B.setBeforeGoto === 1, 'before the first page loads, so the site sees it from the start', B.setBeforeGoto);
  ok(!B.set.some(c => /internal|169\.254/.test(c.domain) || c.name === 'inj'), 'and a cookie for an internal address, or one a browser would refuse, is never set', B.set.map(c => c.domain));
}

section('Live mode carries the sign-in back too');
{
  env.BROWSER = fakeBrowser();
  decisions = [{ verb: 'click', ref: 1, why: 'sign in' }, { verb: 'done', why: 'Done.' }];
  const r = await run(GOAL, '?live=1');
  const text = await r.text();
  await Promise.all(pending.splice(0));
  const end = text.split('\n\n').filter(Boolean).map(b => JSON.parse(b.replace(/^data: /, ''))).pop();
  ok(end.type === 'end' && (end.cookies || []).some(c => c.name === 'sid'), 'in the final answer of the stream', end.cookies);
  const steps = text.split('\n\n').filter(Boolean).map(b => JSON.parse(b.replace(/^data: /, ''))).filter(e => e.type === 'step');
  ok(!JSON.stringify(steps).includes('SESSION-SECRET-7f3a'), 'and never in a step on the way', steps.length);
}

section('Signed out, live mode is a plain refusal, not a stream');
{
  const r = await W.default.fetch(new Request('https://api.amv.test/v1/browser/run?live=1', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.5.250' }, body: JSON.stringify(GOAL) }), env, ctx);
  ok(r.status === 401 && !/event-stream/.test(r.headers.get('Content-Type') || ''), '401, before any stream is opened', r.status + ' ' + r.headers.get('Content-Type'));
}

section('Stop watching, and it stops - and stops spending');
{
  vals.clear();
  env.BROWSER = fakeBrowser();
  decisions = [];             // it would click "Show more" for ever
  modelCalls = 0;
  const r = await run(GOAL, '?live=1');
  const reader = r.body.getReader();
  await reader.read();         // the first step arrives
  await reader.cancel();       // and the tab is closed
  await Promise.all(pending.splice(0));
  ok(modelCalls <= 3, 'it made at most a step or two more, not twenty-four', modelCalls);
  ok(B.closed >= 1, 'the browser was closed', B.closed);
  const eng = W.ENGINES['amv-pulse'];
  ok(sum('cost:' + ME) < 4 * ((3000 / 1e6) * eng.inCost + (60 / 1e6) * eng.outCost) + 0.001, 'and it was charged for what it did, not for a full run', sum('cost:' + ME));
}

if (report('a-web-run-is-watched-and-paid-for') > 0) process.exitCode = 1;
done();
