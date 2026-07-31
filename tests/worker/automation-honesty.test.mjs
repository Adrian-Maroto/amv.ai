/* AUTOMATIONS - the promise made at scheduling has to be the one kept.

   Two gaps, both of the same kind: the product said something would happen and
   then it did not.

   1. Background work is charged against the plan's monthly ceiling, and an
      account with no paid budget has a ceiling of zero. The cron knew that and
      deactivated such automations on their first due run - silently. So a free
      user scheduled a daily brief, got "Scheduled - it'll run in the
      background", and it never ran once.

   2. Results were delivered in-app by default. "Have it ready every morning,
      even with AMV closed" is only true if it arrives somewhere the user looks
      while AMV is closed - and email delivery needs a provider configured. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'autohonesty.harness.mjs');
writeFileSync(harness, src + `
export { autoCreate, autoList, _autoBudget, setEntitlement, signToken, DB, AUTO_MAX_PER_USER, _autoEmailResult };
`);
const W = await import(harness + '?t=' + Date.now());

function makeEnv(extra) {
  const kv = new Map();
  return Object.assign({
    _kv: kv, JWT_SECRET: 'test-secret-abcdefghijklmnop',
    AMV_KV: {
      get: async k => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })) }),
    },
  }, extra || {});
}
const tokenFor = (env, email) => W.signToken({ email }, env.JWT_SECRET, 3600, env, 'access');
const create = (env, token, body) => W.autoCreate(new Request('https://w/auto/create', {
  method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify(body) }), env);
const list = (env, token) => W.autoList(new Request('https://w/auto/list', {
  method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: '{}' }), env);

const DAILY = { detail: 'Brief me on the semiconductor market', repeat: 'daily', kind: 'research' };

section('An account that cannot run background work is told, at the moment it asks');
{
  const env = makeEnv();
  const token = await tokenFor(env, 'free@x.com');
  const r = await create(env, token, DAILY);
  const d = await r.json();
  ok(r.status === 402, 'the request is refused rather than accepted and quietly killed later', r.status);
  ok(d.code === 'plan_required', 'with a code the app can act on, not prose it has to match', d.code);
  ok(/paid plan/i.test(d.error), 'and a reason a person can read', d.error);

  const after = await (await list(env, token)).json();
  ok((after.items || []).length === 0, 'and nothing is left behind pretending to be scheduled');
}

section('A paying account schedules normally');
{
  const env = makeEnv();
  await W.setEntitlement(env, 'pro@x.com', 'pro');
  const token = await tokenFor(env, 'pro@x.com');
  const d = await (await create(env, token, DAILY)).json();
  ok(d.ok === true, 'it is created');
  ok(d.item && d.item.active === true, 'and active');
  ok(d.item.repeat === 'daily', 'on the schedule that was asked for', d.item.repeat);
}

section('A lapsed subscription cannot keep scheduling new background work');
{
  /* _planOf drops a plan to free once the grace period is past. The budget has
     to read the plan as it stands now, not the one that was sold. */
  const env = makeEnv();
  await W.setEntitlement(env, 'lapsed@x.com', 'pro');
  const ent = await W.DB.get(env, 'ent', 'lapsed@x.com');
  ent.pastDueSince = Date.now() - 30 * 86400000;
  await W.DB.put(env, 'ent', 'lapsed@x.com', ent);

  const token = await tokenFor(env, 'lapsed@x.com');
  const r = await create(env, token, DAILY);
  ok(r.status === 402, 'a long-lapsed account is refused like any other unpaid one', r.status);
  ok(W._autoBudget(ent).ceiling === 0, 'because the budget follows the effective plan', W._autoBudget(ent));
}

section('Email delivery is offered only where it can actually happen');
{
  const withEmail = makeEnv({ EMAIL_API_KEY: 'k' });
  await W.setEntitlement(withEmail, 'pro@x.com', 'pro');
  const t1 = await tokenFor(withEmail, 'pro@x.com');
  const d1 = await (await create(withEmail, t1, { ...DAILY, notify: 'email' })).json();
  ok(d1.item.notify === 'email', 'with a provider configured, email is honoured', d1.item.notify);
  ok(d1.emailReady === true, 'and the app is told delivery is available');
  ok(d1.deliveryDowngraded === false, 'nothing was downgraded');

  const noEmail = makeEnv();
  await W.setEntitlement(noEmail, 'pro@x.com', 'pro');
  const t2 = await tokenFor(noEmail, 'pro@x.com');
  const d2 = await (await create(noEmail, t2, { ...DAILY, notify: 'email' })).json();
  ok(d2.item.notify === 'app', 'without one, it falls back to in-app rather than delivering nowhere', d2.item.notify);
  ok(d2.emailReady === false, 'the app is told email is unavailable');
  ok(d2.deliveryDowngraded === true, 'and told SPECIFICALLY that this request was downgraded, so it can say so');
}

section('The app is told what it may promise before it promises anything');
{
  const env = makeEnv({ EMAIL_API_KEY: 'k' });
  await W.setEntitlement(env, 'pro@x.com', 'pro');
  const paid = await (await list(env, await tokenFor(env, 'pro@x.com'))).json();
  ok(paid.canSchedule === true, 'a paying account can schedule');
  ok(paid.emailReady === true, 'and results can reach an inbox');

  const free = await (await list(env, await tokenFor(env, 'free2@x.com'))).json();
  ok(free.canSchedule === false, 'a free account is told up front that it cannot', free.canSchedule);
  ok(free.plan === 'free', 'along with the plan that decided it', free.plan);
}

section('The capability report leaks nothing');
{
  const env = makeEnv({ EMAIL_API_KEY: 'super-secret-provider-key' });
  await W.setEntitlement(env, 'pro@x.com', 'pro');
  const body = await (await list(env, await tokenFor(env, 'pro@x.com'))).text();
  ok(!body.includes('super-secret-provider-key'), 'the provider key never reaches the client - only whether one exists');
}

section('The result email renders as something a person can read');
{
  /* The bold and newline patterns here were written with doubled backslashes.
     An escaped backslash followed by a star means "zero or more backslashes",
     not a literal star - so the bold pattern matched every character and the
     newline patterns matched a literal backslash-n that never occurs. The email
     arrived as one unbroken, entirely-bold blob. It is the artifact a paying
     customer receives on a schedule. */
  let sent = null;
  const env = makeEnv({ EMAIL_API_KEY: 'k', APP_URL: 'https://amv.example/' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), body: init && init.body };
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await W._autoEmailResult(env, 'pro@x.com',
      { kind: 'research', detail: 'semiconductor market' },
      'Line one\nLine two\n\nA new paragraph with **one bold phrase** in it.');
  } finally { globalThis.fetch = realFetch; }

  ok(!!sent, 'an email is actually sent');
  const payload = sent.body || '';
  const bolds = (payload.match(/<b>/g) || []).length;
  ok(bolds < 8, 'the message is not wrapped in bold character by character', bolds);
  ok(payload.includes('<b>one bold phrase</b>'), 'the one phrase that WAS bold is bold');
  ok(payload.includes('<br>'), 'a single newline becomes a line break');
  ok(/<\/p><p /.test(payload), 'and a blank line becomes a new paragraph');
  ok(!payload.includes('\\\\n'), 'no literal backslash-n survives into the message');
  ok(payload.includes('https://amv.example'), 'and there is a way back into AMV - otherwise the email is a dead end');
}

section('With no app URL configured, no broken link is invented');
{
  let sent = null;
  const env = makeEnv({ EMAIL_API_KEY: 'k' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent = init && init.body; return new Response('{}', { status: 200 }); };
  try {
    await W._autoEmailResult(env, 'pro@x.com', { kind: 'task', detail: 'x' }, 'result text');
  } finally { globalThis.fetch = realFetch; }
  ok(!!sent, 'the email still goes out');
  ok(!/href="(\s|")*"/.test(sent), 'with no empty link stub in it');
}

report('automation-honesty');
done();
