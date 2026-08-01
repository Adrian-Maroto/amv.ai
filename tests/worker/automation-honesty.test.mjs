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
export { autoCreate, autoList, AUTO_MAX_BY_PLAN, _autoBudget, setEntitlement, signToken, DB, AUTO_MAX_PER_USER,
         _autoEmailResult, _autoExecute, FREE_AUTO_MAX, FREE_AUTO_REPEAT, FREE_AUTO_CEILING_USD, ENGINES };
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

section('Autonomy is a paid capability, and a free account is told which plan');
{
  /* AMV-087 gave the free tier one shaped weekly job, on the reasoning that
     background work is the strongest reason anyone comes back and you cannot
     convert somebody who never saw it. The owner's call is the other way: a job
     runs on a schedule whether or not anybody is watching, which makes it the
     most expensive thing AMV does and the one thing a free tier cannot carry.
     The plans page has always listed it under Pro.

     What matters either way is that the refusal is USEFUL: it names the plan,
     names what that plan gives, and never fails silently. */
  const env = makeEnv();
  const token = await tokenFor(env, 'free@x.com');
  const r = await create(env, token, DAILY);
  const d = await r.json();
  ok(r.status === 402, 'a free account cannot schedule background work', r.status);
  ok(d.code === 'plan_required', 'with a code the app can branch on', d.code);
  ok(d.requires === 'pro', 'naming the plan it needs', d.requires);
  ok(d.jobs > 0, 'and how many jobs that plan actually runs', d.jobs);
  ok(/Pro/.test(d.error), 'in a sentence a person can read', d.error);
  ok(!/risk/i.test(d.error), 'and with no talk of risk, which is not what they asked about');

  const after = await (await list(env, token)).json();
  ok((after.items || []).length === 0, 'nothing was created behind the refusal');
}

section('A paid plan says how many jobs it runs, and holds that number');
{
  /* A limit nobody can see is a limit they discover by hitting it. */
  const env = makeEnv();
  const token = await tokenFor(env, 'pro@x.com');
  await W.setEntitlement(env, 'pro@x.com', 'pro');

  const shown = await (await list(env, token)).json();
  ok(shown.maxAutomations === W.AUTO_MAX_BY_PLAN.pro,
     'the allowance is reported before anything is created', shown.maxAutomations);
  ok(shown.canSchedule === true, 'and a paid account can schedule');

  for (let i = 0; i < W.AUTO_MAX_BY_PLAN.pro; i++) {
    const ok2 = await create(env, token, { detail: 'Job ' + i, repeat: 'daily' });
    ok(ok2.status === 200, 'job ' + (i + 1) + ' is accepted', ok2.status);
  }
  const over = await create(env, token, { detail: 'One too many', repeat: 'daily' });
  const od = await over.json();
  ok(over.status === 429, 'and the one past the plan is refused', over.status);
  ok(od.code === 'job_limit', 'with a code, not a bare message', od.code);
  ok(od.have === W.AUTO_MAX_BY_PLAN.pro, 'that names the number they have', od.have);

  ok(W.AUTO_MAX_BY_PLAN.elite > W.AUTO_MAX_BY_PLAN.pro &&
     W.AUTO_MAX_BY_PLAN.ultra > W.AUTO_MAX_BY_PLAN.elite,
     'and paying more genuinely runs more', W.AUTO_MAX_BY_PLAN);
}

section('The free tier costs cents, by construction');
{
  const env = makeEnv();
  const b = W._autoBudget({ plan: 'free' });
  ok(b.free === true && b.max === W.FREE_AUTO_MAX, 'one automation', b);
  ok(b.ceiling === W.FREE_AUTO_CEILING_USD && b.ceiling <= 0.25,
     'against a hard monthly ceiling of a few cents - a marketing budget, not a leak', b.ceiling);

  /* And it runs on the cheapest engine, which is the other half of the cost. */
  let sent = null;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ content: [{ type:'text', text:'ok' }], usage:{} }), { status: 200 }); };
  try {
    await W._autoExecute(Object.assign(makeEnv(), { AMV_MODEL_KEY: 'k' }),
      { kind: 'research', detail: 'watch the market', tier: 'free' }, b);
  } finally { globalThis.fetch = real; }
  ok(sent.model === W.ENGINES['amv-pulse'].model, 'the cheapest engine runs it', sent.model);
  ok(!sent.tools, 'and it never searches the web, even if the job was created as research', sent.tools);
  ok(sent.max_tokens <= 1200, 'writing a bounded amount', sent.max_tokens);
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

section('A lapsed subscription drops to the free allowance, not the paid one');
{
  /* _planOf drops a plan to free once the grace period is past. The budget has
     to read the plan as it stands now, not the one that was sold - otherwise a
     dead card keeps buying daily background work for three weeks. */
  const env = makeEnv();
  await W.setEntitlement(env, 'lapsed@x.com', 'pro');
  const ent = await W.DB.get(env, 'ent', 'lapsed@x.com');
  ent.pastDueSince = Date.now() - 60 * 86400000;
  await W.DB.put(env, 'ent', 'lapsed@x.com', ent);

  const b = W._autoBudget(ent);
  ok(b.free === true, 'the budget follows the effective plan, not the sold one', b);
  ok(b.ceiling === W.FREE_AUTO_CEILING_USD, 'so it spends cents, not a paid ceiling', b.ceiling);

  /* And the same gate a never-paid account hits. A subscription that stopped
     paying must not keep buying scheduled compute through the grace window's
     far side - it is on the free plan now, and the free plan does not run
     background work at all. */
  const token = await tokenFor(env, 'lapsed@x.com');
  const r = await create(env, token, DAILY);
  const d = await r.json();
  ok(r.status === 402, 'a lapsed account cannot schedule new work', r.status);
  ok(d.code === 'plan_required', 'and is pointed at the plan that would restore it', d.code);
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
  ok(free.canSchedule === true, 'a free account CAN schedule now - one, weekly', free.canSchedule);
  ok(free.plan === 'free', 'along with the plan that decided the allowance', free.plan);
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

section('An unattended job cannot claim to have done what it cannot do');
{
  /* The runner writes text. It has no email, no browser, no card, no account
     access - so "apply to these roles overnight" comes back as the finished
     application, not as a report that it was submitted. The result is read hours
     later by somebody with no way to check, which is precisely when a made-up
     confirmation does the most damage. */
  let prompt = '';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    prompt = JSON.parse(init.body).system || '';
    return { ok: true, json: async () => ({ content: [{ text: 'ok' }], usage: {} }) };
  };
  try {
    await W._autoExecute({ AMV_MODEL_KEY: 'k' }, { kind: 'task', detail: 'apply to these roles' }, {}, 'p@x.com');
  } finally { globalThis.fetch = realFetch; }

  ok(/only produce text/i.test(prompt), 'it is told what it actually is', prompt.slice(0, 60));
  ok(/cannot send email/i.test(prompt) && /browse/i.test(prompt),
     'and named the things it cannot do rather than left to infer them');
  ok(/has NOT been sent/i.test(prompt),
     'so an action-shaped job returns the finished draft, labelled unsent');
  ok(/[Nn]ever invent a result, a number, or a confirmation/.test(prompt),
     'and inventing a confirmation is ruled out in those words');
}

report('automation-honesty');
done();
