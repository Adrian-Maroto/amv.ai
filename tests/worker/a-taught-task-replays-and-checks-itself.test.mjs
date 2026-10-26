/* A TAUGHT TASK REPLAYS EXACTLY, AND CHECKS ITSELF AS IT GOES.

   Oct 26 audit: Teach AMV, upgraded from "steps the engine reads" to steps
   that can be run as recorded. Through the real routes, with a stand-in
   browser whose page has elements at known places:
     - teaching records how to find each thing again (its id, test id, name,
       label), and a check the person adds is kept only if the page shows it;
     - /v1/browser/replay runs the steps in order, clicking where each
       recorded element IS now - found by what was recorded, never guessed;
     - a step whose element is gone stops the run there, says which and why,
       and nothing after it happens;
     - a check that the page does not satisfy stops it the same way;
     - a secret step types what the person gives for this run - and that
       value is in no answer, record or log - and without it the run stops
       and asks;
     - steps that are not what teaching produces are refused before a
       browser starts, and the browser's time is charged. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'replay.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { issueTokens };
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'teacher@test.com';
const store = new Map(); const vals = new Map(); const logs = [];
const origLog = console.log; console.log = (...a) => { logs.push(a.join(' ')); };
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  CONNECT_KEY: 'a-connect-key-for-sealing-at-least-32-chars', AMV_MODEL_KEY: 'k', AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; }, async put(k, v){ store.set(k, v); }, async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: { idFromName: (n) => n, get: (n) => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
    if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: cur + b.amount })); }
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
    return new Response(JSON.stringify({ allowed: true, ok: true, value: cur }));
  } }) } };
store.set('ent:' + ME, JSON.stringify({ plan: 'pro', renewedAt: Date.now() }));
const pair = await W.issueTokens(env, ME, 'Teacher');

/* A page with elements by id, test id and label, each at a known point, and
   whatever text it currently shows. Locating runs the recorded finder: the
   stand-in reads the JSON it was given and answers as a page would. */
let S;
function fakeService() {
  const s = { launches: 0, closed: 0, disconnects: 0, gotos: [], clicks: [], typed: [], keys: [],
    elements: [{ id: 'won', label: 'Mark as won', x: 400, y: 220 }, { testid: 'note', label: 'Note', x: 300, y: 500 }, { name: 'pw', label: 'Password', x: 300, y: 600 }],
    text: 'Deals · Acme renewal', under: null, afterClick: {} };
  const page = { u: 'about:blank',
    async setViewport(){}, async setRequestInterception(){}, on(){}, async setCookie(){},
    async goto(u){ s.gotos.push(u); this.u = u; }, async url(){ return this.u; },
    async evaluate(x){
      if (typeof x !== 'string') return null;
      if (/elementFromPoint|document\.activeElement/.test(x)) return s.under;
      const shows = x.match(/\.includes\((".*")\)\)\(\)$/);
      if (shows) return s.text.toLowerCase().includes(JSON.parse(shows[1]));
      const f = x.match(/const f = (\{.*?\});/);
      if (f) {
        const find = JSON.parse(f[1]);
        const el = s.elements.find(e => (find.id && e.id === find.id) || (find.testid && e.testid === find.testid) || (find.name && e.name === find.name) || (find.label && e.label === find.label));
        return el ? { x: el.x, y: el.y } : null;
      }
      return null;
    },
    mouse: { async click(x, y){ s.clicks.push([x, y]); const after = s.afterClick[x + ',' + y]; if (after) after(); } },
    keyboard: { async type(t){ s.typed.push(t); }, async press(k){ s.keys.push(k); } },
    async screenshot(){ return Buffer.from('jpeg').toString('base64'); } };
  const browser = { sessionId(){ return 'sess-1'; }, async newPage(){ return page; }, async pages(){ return [page]; },
    async close(){ s.closed++; }, async disconnect(){ s.disconnects++; } };
  S = s;
  return { async launch(){ s.launches++; return browser; }, async connect(){ return browser; } };
}
globalThis.fetch = async () => new Response('{}', { status: 200 });
const ctx = { waitUntil(){}, passThroughOnException(){} };
let ip = 1;
const req = async (path, body) => { const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pair.token, Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.6.' + (ip++ % 250) },
  body: JSON.stringify(body) }), env, ctx); return { status: r.status, d: await r.json().catch(() => ({})) }; };
const spent = () => [...vals.entries()].filter(([k]) => k.startsWith('cost:' + ME)).reduce((a, [, v]) => a + v, 0);
const URL0 = 'https://crm.example.com/deals';

section('Teaching records how to find each thing again, and keeps a check only if it is true');
{
  env.BROWSER = fakeService();
  const t = await req('/v1/browser/teach', { url: URL0 });
  const handle = t.d.handle;
  S.under = { tag: 'button', type: '', role: '', label: 'Mark as won', ac: '', find: { id: 'won', testid: '', name: '', aria: '', ph: '' } };
  const c = await req('/v1/browser/takeover', { handle, act: { kind: 'click', x: 400, y: 220 } });
  ok(c.d.step && c.d.step.find && c.d.step.find.id === 'won' && c.d.step.find.label === 'Mark as won', 'the step carries the button’s id and label', c.d.step);
  const yes = await req('/v1/browser/takeover', { handle, act: { kind: 'check', text: 'Acme renewal' } });
  ok(yes.d.check && yes.d.check.shown === true, 'a check the page satisfies says so', yes.d);
  const no = await req('/v1/browser/takeover', { handle, act: { kind: 'check', text: 'Order cancelled' } });
  ok(no.d.check && no.d.check.shown === false, 'and one it does not, says that', no.d);
  ok(S.clicks.length === 1, 'a check clicks nothing', S.clicks);
}

const STEPS = [
  { kind: 'click', label: 'Mark as won', find: { id: 'won', label: 'Mark as won' } },
  { kind: 'type', label: 'Note', text: 'Signed the renewal', find: { testid: 'note', label: 'Note' } },
  { kind: 'check', text: 'Deal won' },
  { kind: 'type', label: 'Password', secret: true, find: { name: 'pw', label: 'Password' } },
  { kind: 'key', key: 'Enter' },
];

section('Steps that are not what teaching makes are refused before anything starts');
{
  env.BROWSER = fakeService();
  const bad = await req('/v1/browser/replay', { url: URL0, steps: [{ kind: 'eval', code: 'alert(1)' }] });
  ok(bad.status === 400 && bad.d.code === 'bad_steps' && S.launches === 0, 'an unknown step is refused and no browser starts', bad.status + ' ' + bad.d.code);
  const nofind = await req('/v1/browser/replay', { url: URL0, steps: [{ kind: 'click' }] });
  ok(nofind.status === 400 && S.launches === 0, 'a click with nothing to find it by is refused', nofind.status);
  const blocked = await req('/v1/browser/replay', { url: 'http://localhost/admin', steps: STEPS });
  ok(blocked.status === 400 && blocked.d.code === 'blocked_url', 'an address AMV may not go to is refused', blocked.status);
  delete env.BROWSER;
  const none = await req('/v1/browser/replay', { url: URL0, steps: STEPS });
  ok(none.status === 503 && none.d.code === 'needs_service', 'a deployment without the browser says so', none.status);
}

section('Replayed exactly, where each thing is now');
{
  env.BROWSER = fakeService();
  S.elements[0].x = 640; S.elements[0].y = 140;
  S.afterClick['640,140'] = () => { S.text += ' · Deal won'; };
  const before = spent();
  const r = await req('/v1/browser/replay', { url: URL0, steps: STEPS, secrets: { 3: 'Hunter2-secret!' } });
  ok(r.status === 200 && r.d.ok === true && r.d.ran === 5, 'every step ran and passed', JSON.stringify(r.d).slice(0, 200));
  ok(S.clicks[0].join() === '640,140', 'the button was clicked where it is now, found by its id - not where it was when taught', S.clicks);
  ok(S.typed[0] === 'Signed the renewal' && S.keys[0] === 'Enter', 'the text was typed and the key pressed', [S.typed, S.keys]);
  ok(S.typed[1] === 'Hunter2-secret!', 'the secret given for this run was typed into its field', S.typed.length);
  const everywhere = JSON.stringify(r.d) + [...store.values()].join('') + logs.join('');
  ok(!/Hunter2-secret/.test(everywhere), 'and it is in no answer, record or log');
  ok(S.closed === 1, 'the browser is closed when it ends', S.closed);
  ok(spent() > before, 'and its time is charged', spent() - before);
  ok(r.d.shot, 'with the page as the run left it', !!r.d.shot);
}

section('A thing that is gone stops the run there, and nothing after it happens');
{
  env.BROWSER = fakeService();
  S.elements = S.elements.filter(e => e.id !== 'won');
  const r = await req('/v1/browser/replay', { url: URL0, steps: STEPS, secrets: { 3: 'x-secret-value' } });
  ok(r.d.ok === false && r.d.failedAt === 0 && /Mark as won/.test(r.d.why), 'it stops at step 1, naming what it could not find', r.d);
  ok(S.clicks.length === 0 && S.typed.length === 0 && S.keys.length === 0, 'and clicks, types and presses nothing - not even somewhere near', [S.clicks, S.typed, S.keys]);
}

section('A check the page does not satisfy stops it the same way');
{
  env.BROWSER = fakeService();
  const r = await req('/v1/browser/replay', { url: URL0, steps: STEPS, secrets: { 3: 'x-secret-value' } });
  ok(r.d.ok === false && r.d.failedAt === 2 && /Deal won/.test(r.d.why), 'it stops at the check, saying what the page did not show', r.d);
  ok(S.typed.length === 1 && S.keys.length === 0, 'the secret is never typed and Enter never pressed', [S.typed.length, S.keys]);
}

section('A secret step without its value stops and asks');
{
  env.BROWSER = fakeService();
  S.afterClick['400,220'] = () => { S.text += ' · Deal won'; };
  const r = await req('/v1/browser/replay', { url: URL0, steps: STEPS });
  ok(r.d.ok === false && r.d.failedAt === 3 && r.d.need === 'secret', 'it stops at the secret step and says it needs the value', r.d);
  ok(S.keys.length === 0, 'and does not press Enter on a form it did not fill', S.keys);
}

console.log = origLog;
if (report('a-taught-task-replays-and-checks-itself') > 0) process.exitCode = 1;
done();
