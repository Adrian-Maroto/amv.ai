/* WHEN IT ARRIVES, AMV ACTS - AND WHEN NOTHING DOES, IT COSTS NOTHING.

   A trigger is a background job with a condition: "when mail from my landlord
   arrives, summarise what it asks for". Driven through the real create route
   and the real tick, against a stand-in Gmail that honours the query windows
   and a model whose every call is counted, so what is asserted is when AMV
   spends, on what, and what it leaves behind:

     - its first look only learns where the inbox is: mail already there is
       not new, and does not fire it;
     - a check that finds nothing matching makes no model call, costs nothing
       and posts no result - only the time it looked;
     - a match runs the instruction on the matching mail and nothing else;
     - it keeps its own place, so a digest of the same inbox is unaffected;
     - a mailbox it cannot watch for new mail is named, not watched badly. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'when.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { runDueAutomations, issueTokens, _whenMatch, _whenClean, INGEST_SRC_MAIL };
export function __setConnUse(fn){ connUse = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'watcher@test.com';
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
      const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
      if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) })); }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      return new Response(JSON.stringify({ allowed: true, ok: true, value: cur }));
    } }),
  } };
const ctx = { waitUntil(){}, passThroughOnException(){} };
store.set('ent:' + ME, JSON.stringify({ plan: 'ultra', renewedAt: Date.now() }));
const pair = await W.issueTokens(env, ME, 'Watcher');
let connMode = 'gmail';
W.__setConnUse(async () => connMode === 'gmail' ? ({ ok: true, token: 'tok' }) : ({ ok: false, code: 'not_connected' }));

/* Gmail, honouring after:/before: as the real one does. */
let INBOX = [];
let prompts = [];
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  if (!/googleapis\.com$/.test(u.hostname)) {
    let b = {}; try { b = JSON.parse(String((init && init.body) || '{}')); } catch (e) {}
    const m = (b.messages || [])[0];
    prompts.push(typeof (m && m.content) === 'string' ? m.content : JSON.stringify(m && m.content));
    return new Response(JSON.stringify({ content: [{ text: 'Your landlord asks for the meter reading by Friday.' }], usage: { input_tokens: 900, output_tokens: 40 } }), { status: 200 });
  }
  if (u.pathname.endsWith('/messages')) {
    const q = u.searchParams.get('q') || '';
    const a = /after:(\d+)/.exec(q), bf = /before:(\d+)/.exec(q);
    const lo = a ? Number(a[1]) * 1000 : 0, hi = bf ? Number(bf[1]) * 1000 : Infinity;
    const hits = INBOX.filter(x => x.at > lo && x.at < hi).sort((x, y) => y.at - x.at).slice(0, 25).map(x => ({ id: x.id }));
    return new Response(JSON.stringify({ messages: hits }), { status: 200 });
  }
  const id = decodeURIComponent(u.pathname.split('/').pop());
  const msg = INBOX.find(x => x.id === id);
  if (!msg) return new Response('{}', { status: 404 });
  return new Response(JSON.stringify({ id: msg.id, internalDate: String(msg.at), snippet: msg.snippet || '', labelIds: ['INBOX', 'UNREAD'],
    payload: { headers: [{ name: 'From', value: msg.from }, { name: 'Subject', value: msg.subject }, { name: 'Date', value: new Date(msg.at).toUTCString() }] } }), { status: 200 });
};
let n = 0;
const mail = (from, subject, at, snippet = '') => ({ id: 'm' + (++n), from, subject, at, snippet });
let ip = 1;
const post = async (path, body) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pair.token, Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.4.' + (ip++) },
    body: JSON.stringify(body) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const rec = () => JSON.parse(store.get('auto:' + ME) || '{"items":[],"results":[]}');
const spent = () => [...vals.entries()].filter(([k]) => k.startsWith('cost:' + ME)).reduce((a, [, v]) => a + v, 0);
/* Each tick at a distinct instant past the job's due time, as real ticks are. */
const tick = async () => { const r = rec(); const due = Math.max(...r.items.filter(i => i.active).map(i => i.next || 0), Date.now()); await W.runDueAutomations(env, due + 1000); return rec(); };

section('The condition, by rule');
{
  const w = W._whenClean({ from: ['Landlord@Homes.example'], words: ['meter', 'rent'] });
  ok(w && w.from[0] === 'landlord@homes.example', 'kept lower-case', w);
  ok(W._whenMatch(w, { from: 'Ms Lee <landlord@homes.example>', subject: 'Quick one', snippet: 'please send the meter reading' }), 'right sender and a word in it: matches');
  ok(!W._whenMatch(w, { from: 'Ms Lee <landlord@homes.example>', subject: 'Hello', snippet: 'nice weather' }), 'right sender, none of the words: does not');
  ok(!W._whenMatch(w, { from: 'spam@else.example', subject: 'rent', snippet: '' }), 'a word, wrong sender: does not');
  ok(W._whenClean({}) === null && W._whenClean({ from: [] }) === null, 'and a condition that says nothing is not a condition');
}

section('Set up from what was asked, reading the mailbox because it must');
{
  const bad = await post('/auto/create', { detail: 'Summarise it', repeat: '10min', when: { from: [] } });
  ok(bad.status === 400 && bad.d.code === 'when_empty', 'a trigger that watches for nothing is refused, saying what to give', bad.status);
  const r = await post('/auto/create', { detail: 'Summarise what my landlord is asking for and by when.', repeat: '10min', approval: 'auto', when: { from: ['landlord@homes.example'] } });
  ok(r.status === 200 && r.d.item.when && r.d.item.uses.includes('mail.read'), 'created, watching the mailbox', r.d.item && r.d.item.uses);
}

section('Its first look learns where the inbox is - old mail does not fire it');
{
  const T = Date.now() - 3600e3;
  INBOX = [mail('Ms Lee <landlord@homes.example>', 'Rent for October', T), mail('news@paper.example', 'Headlines', T + 1000)];
  prompts = [];
  const r = await tick();
  const it = r.items[0];
  ok(prompts.length === 0, 'no model call', prompts.length);
  ok(!(r.results || []).length, 'no result posted', (r.results || []).length);
  ok(it.lastCheckAt > 0, 'only the time it looked', it.lastCheckAt);
  ok(spent() === 0, 'and nothing spent', spent());
}

section('New mail that does not match: still nothing, still free');
{
  INBOX.push(mail('shop@store.example', 'Your order shipped', Date.now() - 1000));
  prompts = [];
  const r = await tick();
  ok(prompts.length === 0 && !(r.results || []).length && spent() === 0, 'checked, nothing matched, nothing run or charged', { calls: prompts.length, results: (r.results || []).length });
  ok(r.items[0].lastCheckSaw === 1, 'and the row knows it looked at one new message', r.items[0].lastCheckSaw);
}

section('Mail that matches: the instruction runs, on that mail only');
{
  INBOX.push(mail('Ms Lee <landlord@homes.example>', 'Meter reading please', Date.now() - 500, 'Could you send the meter reading by Friday?'));
  INBOX.push(mail('friend@pals.example', 'Dinner?', Date.now() - 400));
  prompts = [];
  const r = await tick();
  ok(prompts.length === 1, 'one model call', prompts.length);
  ok(/Meter reading please/.test(prompts[0]) && !/Dinner\?/.test(prompts[0]) && !/Rent for October/.test(prompts[0]), 'given the matching message, not the others and not the old one', prompts[0].slice(0, 400));
  ok(/MATCHED WHAT THEY ASKED AMV TO WATCH FOR/.test(prompts[0]), 'and told these are the ones it was watching for', true);
  ok((r.results || []).some(x => /meter reading by Friday/.test(x.out || '')), 'the result is posted', (r.results || []).length);
  ok(spent() > 0, 'and this run is the one that was paid for', spent());
  prompts = [];
  await tick();
  ok(prompts.length === 0, 'the next check does not fire on the same message again', prompts.length);
}

section('It keeps its own place: a digest of the same inbox is unaffected');
{
  const d = await post('/auto/create', { detail: 'Summarise my new mail.', repeat: '10min', approval: 'auto', uses: ['mail.read'] });
  ok(d.status === 200, 'a digest is added', d.status);
  const ing = JSON.parse(store.get('ingest:' + ME) || '{}');
  const keys = Object.keys(ing.src || {});
  ok(keys.some(k => k === W.INGEST_SRC_MAIL + ':' + rec().items[0].id) && !keys.includes(W.INGEST_SRC_MAIL), 'the trigger’s place is its own, and it never moved the account’s', keys);
  prompts = [];
  await tick();
  ok(prompts.some(p => /Dinner\?/.test(p)), 'so the digest still sees the mail the trigger passed over', prompts.length);
}

section('A mailbox it cannot watch for new mail is named, not watched badly');
{
  connMode = 'none';
  prompts = [];
  const r = await tick();
  const t = r.items.find(i => i.when);
  /* The digest added above also runs this tick, and may well ask; what must
     not happen is a call carrying the TRIGGER's instruction. */
  ok(!prompts.some(p => /what my landlord is asking for/.test(p)), 'a trigger that cannot look calls no model to say so', prompts.length);
  ok(t && /^not watching - /.test(t.lastError || ''), 'its row says it is not watching, and why', t && t.lastError);
  connMode = 'gmail';
}

if (report('when-it-arrives-amv-acts') > 0) process.exitCode = 1;
done();
