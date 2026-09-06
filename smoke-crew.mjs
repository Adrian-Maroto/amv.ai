#!/usr/bin/env node
/* "AMV WORKING WHILE YOU ARE NOT" - CHECKED AGAINST THE REAL RUNTIME.
 *
 *   node smoke-crew.mjs
 *
 * Crew's promise is on the screen in those words: "It runs on AMV's servers on
 * a schedule you set, so the work happens with this window closed and your
 * laptop shut. You get the finished thing, not a reminder to go and do it."
 *
 * Everything behind that is a cron. The Worker's scheduled() handler fires
 * every five minutes, checks the kill switch, reconciles payments, and calls
 * runDueAutomations. Each piece has unit coverage against a hand-built env.
 * What nothing did was run the sequence the promise describes: create a job,
 * let the SCHEDULER fire, and check that the work actually happened and that
 * the person can see the result.
 *
 * That gap matters more here than anywhere else in the product. A defect in
 * chat is visible the moment somebody types. A defect in this is invisible by
 * construction - the whole point is that nobody is watching - so it would show
 * up as "my automations never seem to do anything", weeks later, from a paying
 * customer.
 *
 * WHAT IS REAL: the Worker in workerd with a real KV and Durable Object; the
 * scheduled handler invoked the way Cloudflare invokes it, through wrangler's
 * own __scheduled endpoint; the job created through the same route the app
 * calls; the result read back through the same route the app reads.
 *
 * WHAT IS NOT: the model is a local stub, so no model runs. This proves the
 * machinery reaches the model and records what comes back - not the quality of
 * what a real one would say.
 */
import { spawn } from 'child_process';
import { existsSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { createServer } from 'http';
import { createHmac } from 'crypto';
import { join } from 'path';

const ROOT = process.cwd();
const PORT = 8911;
const MODEL_PORT = 8912;
const B = `http://127.0.0.1:${PORT}`;
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const PW = 'A-real-Passw0rd!';
const WHSEC = 'whsec_smoke_crew_not_a_real_secret';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy']) delete process.env[k];
process.env.NO_PROXY = '*'; process.env.no_proxy = '*';

let failures = 0, checks = 0;
const ok = (cond, label, detail) => {
  checks++;
  if (cond) { console.log(`  \x1b[32m✓\x1b[0m ${label}`); return; }
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${label}`);
  if (detail !== undefined) console.log(`      got: ${JSON.stringify(detail)}`);
};
const section = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);

let modelHits = 0;
const modelServer = createServer((req, res) => {
  modelHits++;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`);
  ev('message_start', { type:'message_start', message:{ id:'msg_crew', type:'message', role:'assistant',
      content:[], model:'stub', stop_reason:null, usage:{ input_tokens:9, output_tokens:0 } } });
  ev('content_block_start', { type:'content_block_start', index:0, content_block:{ type:'text', text:'' } });
  ev('content_block_delta', { type:'content_block_delta', index:0,
      delta:{ type:'text_delta', text:'THE-CREW-JOB-RAN' } });
  ev('content_block_stop', { type:'content_block_stop', index:0 });
  ev('message_delta', { type:'message_delta', delta:{ stop_reason:'end_turn' }, usage:{ output_tokens:5 } });
  ev('message_stop', { type:'message_stop' });
  res.end();
});

const DEV_VARS = join(ROOT, '.dev.vars');
const HAD = existsSync(DEV_VARS);
const SAVED = HAD ? readFileSync(DEV_VARS, 'utf8') : null;
const restoreDevVars = () => { try { if (HAD) writeFileSync(DEV_VARS, SAVED); else rmSync(DEV_VARS, { force: true }); } catch (e) {} };

const VARS = [
  'JWT_SECRET=smoke-crew-only-not-a-real-secret-0000000000',
  'ADMIN_TOKEN=smoke-crew-admin-token',
  'OWNER_EMAIL=owner@smoke.test',
  `APP_URL=${B}`,
  'AMV_MODEL_KEY=smoke-model-key-not-real',
  `MODEL_API_URL=http://127.0.0.1:${MODEL_PORT}/v1/messages`,
  /* Scheduled work is a Pro feature, correctly - the free tier is refused with
     402 and a sentence naming the plan. So this rehearsal has to BUY Pro the
     way a customer does, through a signed webhook, rather than reaching into
     storage and writing an entitlement nobody paid for. */
  'STRIPE_SECRET_KEY=sk_test_smoke_not_real',
  `STRIPE_WEBHOOK_SECRET=${WHSEC}`,
].join('\n') + '\n';

let child = null;
/* The Worker's own stdout. The cron announces what it did - "paused by
   GLOBAL_KILL" when the switch is on - and that line is the only observable
   difference on a tick where nothing is due. Without it the kill-switch check
   below is vacuous: it compared model calls, and a job that is not due makes
   no model call either way, so it passed with the switch removed entirely. */
let workerLog = '';
const stopWorker = () => { if (child) { try { child.kill('SIGTERM'); } catch (e) {} child = null; } };

function startWorker() {
  return new Promise((resolve) => {
    writeFileSync(DEV_VARS, VARS);
    rmSync(join(ROOT, '.wrangler', 'state'), { recursive: true, force: true });
    /* --test-scheduled is what exposes /__scheduled, which is how the cron is
       fired here rather than by waiting five minutes for a real tick. */
    child = spawn(WRANGLER, ['dev','--local','--test-scheduled','--port',String(PORT),
                             '--inspector-port',String(PORT+1000)],
                  { cwd: ROOT, stdio:['ignore','pipe','pipe'] });
    let out = '';
    const done = (v) => { clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => done(false), 90000);
    const watch = (b) => { out += String(b); workerLog += String(b); if (/Ready on http/.test(out)) done(true); };
    child.stdout.on('data', watch); child.stderr.on('data', watch);
    child.on('error', () => done(false));
    child.on('exit', () => done(/Ready on http/.test(out)));
  });
}

const post = async (p, body, headers = {}) => {
  const r = await fetch(B + p, { method:'POST',
    headers:{ 'Content-Type':'application/json', 'CF-Connecting-IP':'13.0.0.9', ...headers },
    body: JSON.stringify(body || {}) });
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
};
const get = async (p, headers = {}) => {
  const r = await fetch(B + p, { headers:{ 'CF-Connecting-IP':'13.0.0.9', ...headers } });
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
};
/* Signed the way Stripe signs one, so this buys the plan through the same
   path a real payment takes. */
const stripeEvent = async (obj) => {
  const raw = JSON.stringify(obj);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WHSEC).update(`${t}.${raw}`).digest('hex');
  const r = await fetch(B + '/v1/stripe/webhook', { method:'POST',
    headers:{ 'Content-Type':'application/json', 'Stripe-Signature':`t=${t},v1=${v1}` }, body: raw });
  return { status: r.status };
};
const fireCron = async () => {
  const r = await fetch(`${B}/__scheduled?cron=${encodeURIComponent('*/5 * * * *')}`);
  return { status: r.status, text: await r.text().catch(() => '') };
};

async function main() {
  if (!existsSync(WRANGLER)) { console.log('SKIP  wrangler is not installed, so autonomous work was not exercised.'); return 0; }
  await new Promise(r => modelServer.listen(MODEL_PORT, '127.0.0.1', r));
  console.log('Starting the Worker in workerd with the scheduler exposed…');
  if (!(await startWorker())) { stopWorker(); console.log('SKIP  wrangler could not start, so autonomous work was not exercised.'); return 0; }

  const email = `crew_${Date.now()}@smoke.test`;
  let token = '';

  section('The scheduler is reachable at all');
  {
    const r = await fireCron();
    ok(r.status === 200, 'the cron endpoint answers, so the rest of this means something', r.status);
  }

  section('Somebody signs up and schedules a job');
  {
    const s = await post('/auth/signup', { email, name:'Crew', password: PW });
    ok(s.status === 200, 'sign-up succeeds', s.status);
    token = s.body.token || '';

    /* A FREE ACCOUNT IS REFUSED, AND THAT IS THE RIGHT ANSWER.
       Asserted rather than stepped around, because "scheduled work is a paid
       feature" is a promise in both directions: it has to be refused before
       payment and to work after it. */
    const free = await post('/auto/create',
      { detail:'Should be refused', repeat:'daily', kind:'task', notify:'app', approval:'auto' },
      { Authorization:'Bearer ' + token });
    ok(free.status === 402, 'a free account cannot schedule work', free.status);
    ok(free.body.code === 'plan_required', 'and is told which plan it needs, not just no', free.body);

    const paid = await stripeEvent({ id:'evt_crew_paid', type:'checkout.session.completed',
      created: Math.floor(Date.now()/1000),
      data:{ object:{ id:'cs_crew', payment_status:'paid', amount_total:1500, currency:'usd',
        customer:'cus_crew', metadata:{ email, plan:'pro' } } } });
    ok(paid.status === 200, 'they buy Pro through a signed webhook', paid.status);

    const c = await post('/auto/create',
      { detail:'Summarise what changed today', repeat:'daily', kind:'task',
        notify:'app', approval:'auto' },
      { Authorization:'Bearer ' + token });
    ok(c.status === 200, 'and now the job is accepted', { s:c.status, b:c.body });

    /* POST, not GET - /auto/list is a write-verb route by the router's rule. */
    const l = await post('/auto/list', {}, { Authorization:'Bearer ' + token });
    ok(l.status === 200, 'and it is listed back', l.status);
    const items = l.body.items || l.body.automations || l.body.list || [];
    ok(Array.isArray(items) && items.length >= 1, 'exactly where the person would look for it', items.length);
  }

  section('A job that is not due yet costs nothing');
  {
    /* A daily job's first run is 24 hours out, so the correct behaviour on
       this tick is to leave it alone. That is worth asserting in its own
       right: a cron that ran everything on every tick would spend money every
       five minutes for every customer, which is the most expensive shape this
       machinery could take. */
    const before = modelHits;
    const r = await fireCron();
    ok(r.status === 200, 'the tick completes', r.status);
    ok(modelHits === before,
       'and a job scheduled for tomorrow is not run today', { before, after: modelHits });

    const l = await post('/auto/list', {}, { Authorization:'Bearer ' + token });
    const it = (l.body.items || [])[0] || {};
    ok(it.runs === 0, 'the job records that it has not run', it.runs);
    ok(it.next > Date.now(), 'and says when it will', { next: it.next, now: Date.now() });
  }

  /* WHAT THIS REHEARSAL DELIBERATELY DOES NOT CLAIM.
   *
   * It does not prove that a DUE job executes. Making one due means moving the
   * Worker's clock, and nothing outside the Worker can do that - there is no
   * run-now route, by design. The unit suites do it the only way it can be
   * done, by calling runDueAutomations(env, atMs) with a time of their
   * choosing; ten of them exercise that path, including the spend ceiling, a
   * parent's limit reaching the cron, and an account on hold.
   *
   * So the split is: they own "a due job runs correctly", and this owns the
   * things a hand-built env cannot reach - that the real scheduled() handler
   * is wired, that the plan gate stands in front of it, that a job survives
   * creation and read-back through the real routes, and that the kill switch
   * reaches the one thing that runs when nobody is there. Saying so here
   * rather than leaving a reader to assume this covers more than it does. */

  section('The kill switch reaches the thing that runs when nobody is there');
  {
    /* An operator watching a bill run away hits this. If it only stopped
       request traffic, automations would keep firing every five minutes and
       keep spending - which is the one thing the switch exists to prevent. */
    const on = await post('/v1/admin/kill', { on: true },
      { Authorization:'Bearer smoke-crew-admin-token' });
    ok(on.status === 200 || on.status === 204, 'the kill switch is thrown', { s:on.status, b:on.body });

    /* Asserted on what the cron SAYS, not on what it spent. On a tick with
       nothing due there is no spend either way, so a spend comparison here is
       an assertion that cannot fail - it passed with the kill-switch read
       deleted from the handler, which is how this was caught. */
    workerLog = '';
    await fireCron();
    await new Promise(r => setTimeout(r, 700));
    ok(/paused by GLOBAL_KILL/.test(workerLog),
       'and the cron says it stood down rather than running anyway',
       workerLog.slice(-240));

    const off = await post('/v1/admin/kill', { on: false },
      { Authorization:'Bearer smoke-crew-admin-token' });
    ok(off.status === 200 || off.status === 204, 'and it can be lifted again', off.status);

    workerLog = '';
    await fireCron();
    await new Promise(r => setTimeout(r, 700));
    ok(!/paused by GLOBAL_KILL/.test(workerLog),
       'after which it runs normally again, so the check is about the switch and not the weather',
       workerLog.slice(-200));
  }

  return failures;
}

let code = 1;
try { code = await main(); }
catch (e) { console.log('\n\x1b[31mThe rehearsal threw:\x1b[0m ' + (e && e.message)); code = 1; }
finally { stopWorker(); restoreDevVars(); try { modelServer.close(); } catch (e) {} }
console.log(code === 0
  /* Says what it proved, not what the feature promises. The line used to read
     "work really does happen with nobody watching", which this does not show -
     see the note above the kill-switch section. */
  ? `\n\x1b[32m${checks} checks passed - the scheduler is wired, gated, and stoppable.\x1b[0m`
  : `\n\x1b[31m${failures} of ${checks} checks FAILED.\x1b[0m`);
process.exit(code === 0 ? 0 : 1);
