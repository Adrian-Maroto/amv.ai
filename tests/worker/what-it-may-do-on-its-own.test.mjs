/* THE THREE LEVELS HAVE TO BE THREE DIFFERENT THINGS.

   "Suggest only / ask me first / do it" is a promise about what happens while
   nobody is watching, and it is the easiest promise in the product to render as
   a label and never enforce. A dropdown with three options where two of them
   behave identically is worse than a dropdown with two, because somebody picks
   the safest-sounding one and stops worrying.

   So each level is asserted on what the run actually DOES:
     suggest  the model is never called. Nothing generated, nothing spent.
     require  the work is done and stops before delivery, in the queue.
     auto     the work is done and goes out.

   And then the ceiling, which is the part that makes this a safety control
   rather than a preference. An account can cap the highest level any of its
   jobs may reach. A job set to auto under a ceiling of require must execute as
   require - including a job created afterwards, and including one edited
   afterwards, because a limit that any later edit can walk past is not a limit.

   The last section is the timeline: a run that failed has to leave a trace. It
   used to set a field on the job and nothing else, so a week of nightly
   failures and a week of having nothing to say looked identical - and they call
   for opposite responses. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'levels.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, AUTO_APPROVALS, _autoEffective, _autoBucketAdd };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const USER = 'levels@example.com';
const PW = 'A-real-Passw0rd!';

let sent = [];
let emails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/model\.example/.test(u)) {
    sent.push(JSON.parse(String((opts && opts.body) || '{}')));
    return { ok: true, status: 200, json: async () => ({
      content: [{ type: 'text', text: 'the finished work' }],
      usage: { input_tokens: 100, output_tokens: 200 },
    }) };
  }
  if (/mail|resend|sendgrid|postmark/i.test(u)) { emails.push(u); return { ok: true, status: 200, json: async () => ({}) }; }
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv(extra) {
  const m = new Map(); const vals = new Map(); sent = []; emails = [];
  return Object.assign({
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body);
        const cur = vals.get(n) || 0;
        if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) })); }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  }, extra || {});
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '70.70.70.70',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);

async function setup(env) {
  const d = await (await call(env, '/auth/signup', { email: USER, name: 'L', password: PW })).json();
  await W.DB.put(env, 'ent', USER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return d.token;
}
async function jobAt(env, approval, extra) {
  const rec = (await W.DB.get(env, 'auto', USER)) || { items: [], results: [] };
  rec.items = [Object.assign({ id: 'j1', detail: 'Write my weekly summary', active: true,
                               next: Date.now() - 60000, interval: 86400000, kind: 'task',
                               approval, notify: 'app' }, extra || {})];
  await W.DB.put(env, 'auto', USER, rec);
  return rec;
}
async function tick(env) {
  const c = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
  await worker.scheduled({ cron: '*/5 * * * *' }, env, c);
  await c.settle();
}
const results = async (env) => ((await W.DB.get(env, 'auto', USER)) || {}).results || [];
const approvals = async (env) => ((await W.DB.get(env, 'approvals', USER)) || {}).items || [];

section('Suggest only does not run the job, and therefore costs nothing');
{
  /* The whole difference. If the model is called at this level then "suggest
     only" is a delivery preference wearing a permission's name, and the person
     who chose it to stay in control of spend is paying anyway. */
  const env = mkEnv();
  await setup(env);
  await jobAt(env, 'suggest');
  await tick(env);

  ok(sent.length === 0, 'the model was never called', sent.length);
  ok(emails.length === 0, 'nothing was sent anywhere', emails.length);
  ok((await approvals(env)).length === 0, 'and nothing was queued for approval', true);

  const r = await results(env);
  ok(r.length === 1, 'but they are told it came due', r.length);
  ok(r[0].kind === 'suggestion', 'as a suggestion rather than as work', r[0].kind);
  ok(/has not run it/i.test(r[0].out), 'saying plainly that it did not run', String(r[0].out).slice(0, 90));
  ok(r[0].costUSD === 0, 'and it cost nothing', r[0].costUSD);
}

section('Ask first does the work and stops before delivery');
{
  const env = mkEnv({ EMAIL_API_KEY: 'e' });
  await setup(env);
  await jobAt(env, 'require', { notify: 'email' });
  await tick(env);

  ok(sent.length === 1, 'the work was done', sent.length);
  const ap = await approvals(env);
  ok(ap.length === 1, 'and it is waiting for them', ap.length);
  ok(emails.length === 0, 'having NOT been emailed out', emails.length);
  const r = await results(env);
  ok(r[0].outcome === 'waiting', 'the record says it is waiting', r[0].outcome);
}

section('Auto-run does the work and delivers it');
{
  const env = mkEnv({ EMAIL_API_KEY: 'e' });
  await setup(env);
  await jobAt(env, 'auto', { notify: 'email' });
  await tick(env);

  ok(sent.length === 1, 'the work was done', sent.length);
  ok((await approvals(env)).length === 0, 'nothing is waiting', true);
  const r = await results(env);
  ok(r[0].outcome === 'emailed', 'and the record says it went out', r[0].outcome);
}

section('The ceiling holds a job back from what the job itself says');
{
  /* The reason the ceiling exists. Somebody sets "nothing sends on its own"
     once, and it has to survive every job they already have. */
  const env = mkEnv({ EMAIL_API_KEY: 'e' });
  const tok = await setup(env);
  await jobAt(env, 'auto', { notify: 'email' });

  const r0 = await call(env, '/auto/update', { action: 'ceiling', ceiling: 'require' }, tok);
  const d0 = await r0.json();
  ok(r0.status === 200 && d0.ceiling === 'require', 'the ceiling is accepted', d0);
  ok(d0.restrains === 1, 'and it says how many of their jobs it actually holds back', d0.restrains);

  await tick(env);
  ok(sent.length === 1, 'the job still runs', sent.length);
  ok(emails.length === 0, 'but it does NOT send, even though the job says auto', emails.length);
  ok((await approvals(env)).length === 1, 'it waits for approval instead', true);
  const rr = await results(env);
  ok(rr[0].approval === 'require', 'and the run is recorded at the level it really executed at', rr[0].approval);
}

section('A ceiling of suggest stops the spending too');
{
  const env = mkEnv();
  const tok = await setup(env);
  await jobAt(env, 'auto');
  await call(env, '/auto/update', { action: 'ceiling', ceiling: 'suggest' }, tok);
  await tick(env);
  ok(sent.length === 0, 'a job set to auto under a suggest ceiling calls nothing', sent.length);
  ok((await results(env))[0].kind === 'suggestion', 'and only suggests', true);
}

section('A job created AFTER the ceiling inherits it');
{
  /* Otherwise the setting means "the jobs I had when I set it", which is not
     what anybody reads it as. */
  const env = mkEnv({ EMAIL_API_KEY: 'e' });
  const tok = await setup(env);
  await call(env, '/auto/update', { action: 'ceiling', ceiling: 'require' }, tok);
  await call(env, '/auto/create', { detail: 'A job made later', repeat: 'daily', approval: 'auto', notify: 'email' }, tok);

  const rec = await W.DB.get(env, 'auto', USER);
  rec.items[0].next = Date.now() - 60000;
  await W.DB.put(env, 'auto', USER, rec);
  /* The tick reads a due-time index now instead of every account, so moving
     a due time means telling the index - which every route that moves one
     does. This writes the record behind the product's back, which nothing in
     the product does, so it says so itself. Without it the account is
     invisible until the next full sweep, and the sweep is the floor under
     this path rather than the path being tested here. */
  await W._autoBucketAdd(env, USER, rec.items[0].next);
  await tick(env);

  ok(emails.length === 0, 'the new job does not send either', emails.length);
  ok((await approvals(env)).length === 1, 'it waits like the rest', true);
}

section('And editing a job cannot walk past it');
{
  /* A limit any later edit can raise is not a limit. The cap is applied where
     the work happens, so setting the job back to auto changes the job and
     changes nothing about tonight. */
  const env = mkEnv({ EMAIL_API_KEY: 'e' });
  const tok = await setup(env);
  await jobAt(env, 'require', { notify: 'email' });
  await call(env, '/auto/update', { action: 'ceiling', ceiling: 'require' }, tok);

  const up = await call(env, '/auto/update', { id: 'j1', action: 'edit', approval: 'auto' }, tok);
  ok(up.status === 200, 'the edit is allowed - their job, their setting', up.status);

  await tick(env);
  ok(emails.length === 0, 'and it still does not send', emails.length);
  ok((await approvals(env)).length === 1, 'because the ceiling is read where the work happens', true);
}

section('Raising the ceiling gives every job back what it was set to');
{
  /* Nothing is rewritten when the ceiling moves, so a period of caution does
     not permanently flatten a configuration somebody spent time on. */
  const env = mkEnv({ EMAIL_API_KEY: 'e' });
  const tok = await setup(env);
  await jobAt(env, 'auto', { notify: 'email' });
  await call(env, '/auto/update', { action: 'ceiling', ceiling: 'suggest' }, tok);
  await tick(env);
  ok(sent.length === 0, 'held back while the ceiling was low', sent.length);

  const before = await W.DB.get(env, 'auto', USER);
  ok(before.items[0].approval === 'auto', 'the job still says what it always said', before.items[0].approval);

  await call(env, '/auto/update', { action: 'ceiling', ceiling: 'auto' }, tok);
  const rec = await W.DB.get(env, 'auto', USER);
  rec.items[0].next = Date.now() - 60000;
  await W.DB.put(env, 'auto', USER, rec);
  await W._autoBucketAdd(env, USER, rec.items[0].next);   // as every route that moves a due time does
  await tick(env);
  ok(sent.length === 1, 'and runs normally again once the ceiling is raised', sent.length);
  ok(emails.length === 1, 'delivering as it was configured to', emails.length);
}

section('The levels are the only levels');
{
  const env = mkEnv();
  const tok = await setup(env);
  const bad = await call(env, '/auto/update', { action: 'ceiling', ceiling: 'anything_goes' }, tok);
  ok(bad.status === 400, 'an invented level is refused', bad.status);
  const rec = await W.DB.get(env, 'auto', USER);
  ok(!rec || !rec.ceiling || W.AUTO_APPROVALS.includes(rec.ceiling), 'and never stored', rec && rec.ceiling);

  await call(env, '/auto/create', { detail: 'x', repeat: 'daily', approval: 'do_whatever' }, tok);
  const rec2 = await W.DB.get(env, 'auto', USER);
  ok(rec2.items[0].approval === 'require',
     'and a job asking for an invented level gets the careful default, not the free one', rec2.items[0].approval);
}

section('And a stranger cannot set somebody else’s ceiling');
{
  const env = mkEnv();
  const tok = await setup(env);
  await call(env, '/auto/update', { action: 'ceiling', ceiling: 'suggest' }, tok);
  const anon = await call(env, '/auto/update', { action: 'ceiling', ceiling: 'auto' });
  ok(anon.status === 401, 'not without signing in', anon.status);

  const other = await (await call(env, '/auth/signup', { email: 'other@example.com', name: 'O', password: PW })).json();
  await call(env, '/auto/update', { action: 'ceiling', ceiling: 'auto' }, other.token);
  const mine = await W.DB.get(env, 'auto', USER);
  ok(mine.ceiling === 'suggest', 'and not by being somebody else', mine.ceiling);
}

section('A run that failed leaves a trace');
{
  /* It used to set a field on the job and nothing else, so a week of nightly
     failures and a week of having nothing to say produced the same silence -
     and they call for opposite responses. */
  const env = mkEnv();
  await setup(env);
  await jobAt(env, 'auto');
  const keep = globalThis.fetch;
  globalThis.fetch = async (u) => {
    if (/model\.example/.test(String(u))) throw new Error('the model was unreachable');
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await tick(env);
  globalThis.fetch = keep;

  const r = await results(env);
  ok(r.length === 1, 'the failure is in the record', r.length);
  ok(r[0].kind === 'failed' && r[0].outcome === 'failed', 'marked as a failure', r[0].kind);
  ok(/unreachable/i.test(r[0].out), 'with the actual reason', String(r[0].out).slice(0, 90));
}

section('And the record says what each run cost');
{
  const env = mkEnv();
  await setup(env);
  await jobAt(env, 'auto');
  await tick(env);
  const r = await results(env);
  ok(typeof r[0].costUSD === 'number' && r[0].costUSD > 0,
     'a real run records what it spent', r[0].costUSD);
  ok(r[0].costUSD < 1, 'a plausible amount, not a placeholder', r[0].costUSD);
}

section('The account can read its own ceiling back');
{
  const env = mkEnv();
  const tok = await setup(env);
  const before = await (await call(env, '/auto/list', {}, tok)).json();
  ok(before.ceiling === 'auto', 'unset means nothing is held back', before.ceiling);
  await call(env, '/auto/update', { action: 'ceiling', ceiling: 'require' }, tok);
  const after = await (await call(env, '/auto/list', {}, tok)).json();
  ok(after.ceiling === 'require', 'and the screen can show the truth about tonight', after.ceiling);
}

globalThis.fetch = realFetch;
if (report('what-it-may-do-on-its-own') > 0) process.exitCode = 1;
done();
