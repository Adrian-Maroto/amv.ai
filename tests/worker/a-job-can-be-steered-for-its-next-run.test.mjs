/* A JOB CAN BE STEERED FOR ITS NEXT RUN (Oct 31 audit, item 28).

   Driven through /auto/update and the real runner, with the model stood in
   for and every request it receives kept:
     - a note left on a job reaches its next run, fenced as the person's text;
     - it is used once: the run after that does not see it;
     - the job itself is not changed by it;
     - a new note after that is used again, once;
     - an empty note removes one not yet used;
     - a note carrying a card number is refused, and so is one too long. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'steer.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `\nexport { runDueAutomations, issueTokens };\n`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'steer@test.com';
const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  AMV_MODEL_KEY: 'k', AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; }, async put(k, v){ store.set(k, v); }, async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
const ctx = { waitUntil(){}, passThroughOnException(){} };
store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
const pair = await W.issueTokens(env, ME, 'Steer');
let ip = 1;
const post = async (path, body) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pair.token, Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.8.' + (ip++) },
    body: JSON.stringify(body) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const rec = () => JSON.parse(store.get('auto:' + ME) || '{"items":[],"results":[]}');
const asked = [];
let stop = 'end_turn';
globalThis.fetch = async (u, init) => {
  try { const b = JSON.parse(init.body); if (b && b.messages) asked.push(JSON.stringify(b.messages)); } catch (e) {}
  return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Here are the listings.' }], stop_reason: stop, usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200 });
};
let t = Date.now();
const runNext = async () => { const it = rec().items[0]; t = Math.max(t, it.next) + 60e3; asked.length = 0; await W.runDueAutomations(env, t); return asked.join('\n'); };

const made = await post('/auto/create', { detail: 'Find two-bedroom flats to rent in Lisbon under 1500 euros', repeat: 'daily', approval: 'auto' });
ok(made.status === 200 && made.d.item, 'a daily job is created', made.status);
const id = made.d.item.id;

section('A note reaches the next run, once');
{
  const s = await post('/auto/update', { action: 'steer', id, note: 'This time only Alfama and Graça, and skip anything without a lift.' });
  ok(s.status === 200, 'the note is saved', s.status);
  const it = s.d.items.find(x => x.id === id);
  ok(it.detail === 'Find two-bedroom flats to rent in Lisbon under 1500 euros' && it.repeat === 'daily', 'the job itself is unchanged');
  const first = await runNext();
  ok(/FOR THIS RUN ONLY, THE USER ADDED/.test(first) && /Alfama and Graça/.test(first), 'the next run reads it', first.slice(0, 300));
  ok(/Find two-bedroom flats/.test(first), 'alongside the job as it always is');
  const second = await runNext();
  ok(second.length > 0 && !/Alfama/.test(second) && !/FOR THIS RUN ONLY/.test(second), 'the run after that does not see it', second.slice(0, 200));
}

section('A new note is used again, once; an empty one removes a note not yet used');
{
  await post('/auto/update', { action: 'steer', id, note: 'Include Belém this time.' });
  ok(/Include Belém/.test(await runNext()), 'a new note reaches the next run');
  ok(!/Belém/.test(await runNext()), 'and only that one');
  await post('/auto/update', { action: 'steer', id, note: 'Only Estrela.' });
  const cleared = await post('/auto/update', { action: 'steer', id, note: '' });
  ok(cleared.status === 200 && !cleared.d.items.find(x => x.id === id).steer, 'an empty note removes it');
  ok(!/Estrela/.test(await runNext()), 'so the next run never sees it');
}

section('A note is checked like everything else a job carries');
{
  const card = await post('/auto/update', { action: 'steer', id, note: 'Pay the deposit with 4111 1111 1111 1111' });
  ok(card.status === 400 && /credentials/.test(card.d.error || ''), 'a card number is refused', card.d);
  const long = await post('/auto/update', { action: 'steer', id, note: 'x'.repeat(1001) });
  ok(long.status === 400 && long.d.code === 'too_long', 'and so is a note longer than 1000 characters', long.d);
  ok(!rec().items[0].steer, 'neither was stored');
}

section('A result cut off at its length limit says so');
{
  stop = 'max_tokens';
  await runNext();
  const last = (rec().results || []).filter(x => x.autoId === id).slice(-1)[0] || {};
  ok(/reached its length limit and is cut off here/.test(last.out || ''), 'the person reading it later is told it is incomplete', (last.out || '').slice(-120));
  stop = 'end_turn';
  await runNext();
  const next = (rec().results || []).filter(x => x.autoId === id).slice(-1)[0] || {};
  ok(!/length limit/.test(next.out || ''), 'and a complete one does not say it', (next.out || '').slice(-80));
}

report();
done();
