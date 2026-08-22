/* EVERY LIMIT IN THE WORKER ASKS "HOW OFTEN MAY YOU DO THIS".
   NONE OF THEM ASKED "HOW MUCH MAY THEY BE SENT".

   That is the right shape for cost and for abuse of AMV, and the wrong shape
   for abuse of a person. Email is the only thing in this product that leaves
   the building, lands somewhere we do not control, and arrives with our domain
   on it.

   Three ways that showed up, none of which any existing test covered:

     marketMessage is guarded at 300 messages a day. The guard works exactly as
     written, and the result is still three hundred emails into one stranger's
     inbox in a day.

     Team task assignment had no limit at all - create, assign, delete, repeat.

     An Ultra account may run 100 automations at a ten-minute interval, each
     able to mail its result: fourteen thousand emails a day, every one of them
     asked for, none of them counted.

   And the reset-code route capped 5 per hour per address with a read-then-write
   in KV, which a parallel burst walks straight through - while the OTHER reset
   route already used the atomic reserve, with a comment explaining why.

   The first section is the one that matters in a year: a new sender cannot join
   without declaring what it is, and cannot declare a class that has no budget. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'inbox.harness.mjs');
writeFileSync(harness, src +
  '\nexport { _sendEmail, _emailBudgetOk, EMAIL_DAY_CAP, DB };\n' +
  '\nexport { default as worker } from "./inbox.harness.mjs";\n'.replace(/^.*$/, ''));
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

/* A counter that behaves like the Durable Object: one op at a time, each
   complete before the next begins, with a real await inside so an
   implementation that reads and then writes has a genuine window to be
   interleaved in - and cannot be, because this chain holds it. Without this
   the harness falls back to the KV path, which IS the race, and a burst test
   would pass by accident on a cap that does not hold. */
function mkEnv(extra) {
  const m = new Map(); const vals = new Map();
  let chain = Promise.resolve();
  const serialise = (fn) => (chain = chain.then(fn, fn));
  return Object.assign({
    EMAIL_API_KEY: 'test-key',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list() { return { keys: [], list_complete: true }; },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ fetch(_u, init) {
        return serialise(async () => {
          await Promise.resolve();
          const b = JSON.parse(init.body);
          const cur = vals.get(n) || 0;
          if (b.op === 'reserve') {
            const amt = Number(b.amount);
            if (!Number.isFinite(amt) || amt < 0) return new Response(JSON.stringify({ allowed: false, value: cur }));
            if (b.cap != null && cur + amt > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
            vals.set(n, cur + amt); return new Response(JSON.stringify({ allowed: true, value: cur + amt }));
          }
          if (b.op === 'incr') { vals.set(n, Math.max(0, cur + (b.amount || 0))); return new Response(JSON.stringify({ value: vals.get(n) })); }
          if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
          if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: cur + 1 <= b.limit })); }
          return new Response(JSON.stringify({ allowed: true, value: cur }));
        });
      } }),
    },
  }, extra || {});
}

const realFetch = globalThis.fetch;
let sent = [];
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.resend.com')) {
    sent.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ id: 'x' }) };
  }
  return realFetch(url, opts);
};

section('A sender cannot join without saying what it is');
{
  const code = codeOnly(src);
  const classes = Object.keys(W.EMAIL_DAY_CAP);
  /* Every place the choke point or one of its named wrappers is CALLED. The
     definition itself, and the wrapper bodies that forward the class on, are
     the three things that are not call sites. */
  /* Matched by POSITION, not by trying to bracket a whole call with one
     regex: two of these argument lists run to a couple of thousand characters
     of email body, so a bounded quantifier silently matched neither - which is
     how a scan meant to find uncapped senders finds four out of six and calls
     it clean. The window is taken forward from each name instead. */
  const at = [...code.matchAll(/_sendEmail(_[a-z]+)?\(/g)];
  const calls = at
    .map(m => ({ name: '_sendEmail' + (m[1] || ''), text: code.slice(m.index, m.index + 3000) }))
    .filter(c => !/^_sendEmail\(env, to, subject, html, text, cls\)\s*\{/.test(c.text))
    .filter(c => !/^_sendEmail\(env, to, subject, html, text, cls\);/.test(c.text));
  ok(calls.length >= 6, 'every sender in the Worker is accounted for', calls.length);

  const bare = calls.filter(c => c.name === '_sendEmail'
    ? !classes.some(k => c.text.slice(0, c.text.indexOf(');') + 2).includes("'" + k + "'"))
    : !classes.includes(c.name.replace('_sendEmail_', '')));
  ok(bare.length === 0, 'and every one of them names a class that has a budget',
     bare.map(b => b.name + ': ' + b.text.slice(0, 70).replace(/\n/g, ' ')));

  /* The wrappers exist so a long argument list cannot hide a missing class.
     Each must forward a class this table knows. */
  const wrapped = [...code.matchAll(/const _sendEmail_([a-z]+)\s*=\s*\(env[^)]*\)\s*=>\s*_sendEmailAs\(env,\s*'([a-z]+)'/g)];
  ok(wrapped.length >= 3, 'the named wrappers are there', wrapped.length);
  ok(wrapped.every(w => w[1] === w[2] && classes.includes(w[2])),
     'each wrapper sends the class its own name promises', wrapped.map(w => w[1] + '->' + w[2]));

  /* The default is a real budget, not an escape hatch: a sender that forgets
     is capped, never uncapped. */
  ok(typeof W.EMAIL_DAY_CAP.other === 'number' && W.EMAIL_DAY_CAP.other > 0,
     'and forgetting entirely still lands on a budget', W.EMAIL_DAY_CAP.other);
}

section('A cap on the inbox, not only on the sender');
{
  const env = mkEnv();
  sent = [];
  const cap = W.EMAIL_DAY_CAP.message;
  let yes = 0, no = 0;
  for (let i = 0; i < cap + 8; i++) {
    (await W._sendEmail(env, 'victim@example.com', 's', '<p>h</p>', 't', 'message')) ? yes++ : no++;
  }
  ok(yes === cap, 'exactly the day cap gets through', yes + ' of ' + cap);
  ok(no === 8, 'and the rest are refused', no);
  ok(sent.length === cap, 'the provider was called only for the ones that passed', sent.length);
}

section('A parallel burst cannot outrun it either');
{
  const env = mkEnv();
  sent = [];
  const cap = W.EMAIL_DAY_CAP.task;
  const results = await Promise.all(
    Array.from({ length: cap + 20 }, () => W._sendEmail(env, 'burst@example.com', 's', '<p>h</p>', 't', 'task')));
  ok(results.filter(Boolean).length === cap, 'the cap holds when they all arrive at once', results.filter(Boolean).length);
}

section('One kind of mail cannot spend another kind s budget');
{
  /* The failure that would make the cap worse than nothing: somebody floods you
     with task notifications, and the password reset you are waiting for is the
     one that gets refused. */
  const env = mkEnv();
  const flood = [];
  for (let i = 0; i < W.EMAIL_DAY_CAP.task + 10; i++) {
    flood.push(await W._sendEmail(env, 'flooded@example.com', 's', '<p>h</p>', 't', 'task'));
  }
  /* Without this line the section passes when there is no cap at all: with
     nothing refusing anything, of course the reset code goes out. The claim is
     only worth making once the flood has actually been stopped. */
  ok(flood.filter(x => !x).length === 10, 'the flood really did hit its own ceiling',
     flood.filter(x => !x).length);
  sent = [];
  const got = await W._sendEmail(env, 'flooded@example.com', 'Your AMV password reset code', '<p>h</p>', 't', 'security');
  ok(got === true, 'and the reset code still goes out', got);
  ok(sent.length === 1, 'and really reached the provider', sent.length);
}

section('Two different people do not share one budget');
{
  const env = mkEnv();
  for (let i = 0; i < W.EMAIL_DAY_CAP.message + 5; i++) {
    await W._sendEmail(env, 'a@example.com', 's', '<p>h</p>', 't', 'message');
  }
  ok(await W._sendEmail(env, 'b@example.com', 's', '<p>h</p>', 't', 'message') === true,
     'somebody else s inbox is somebody else s', true);
}

section('When the counter is down, the split is the one we chose');
{
  /* The deliberate half of the design, and the half most likely to be wrong.
     An unenforceable cap is not a cap, which argues for refusing everything -
     but a reset code that cannot be sent is somebody locked out of their
     account by OUR outage. So security and owner mail goes and notification
     mail is held, and that is asserted rather than assumed. */
  const env = mkEnv({
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ fetch() { throw new Error('DO is down'); } }) },
  });
  sent = [];
  const held = await W._sendEmail(env, 'x@example.com', 's', '<p>h</p>', 't', 'message');
  const task = await W._sendEmail(env, 'x@example.com', 's', '<p>h</p>', 't', 'task');
  const sec  = await W._sendEmail(env, 'x@example.com', 's', '<p>h</p>', 't', 'security');
  const own  = await W._sendEmail(env, 'x@example.com', 's', '<p>h</p>', 't', 'owner');
  ok(held === false, 'a message notification is held', held);
  ok(task === false, 'so is a task notification', task);
  ok(sec === true, 'a password reset still goes, because the alternative is a lockout', sec);
  ok(own === true, 'and so does the operator s own mail', own);
  ok(sent.length === 2, 'exactly the two that should have reached the provider did', sent.length);
}

section('The reset limit is reserved, not read and rewritten');
{
  const body = codeOnly(functionBody(src, 'authResetCode'));
  ok(!/AMV_KV\.get\(rlKey\)/.test(body) && !/resetrl:/.test(body),
     'the read-then-write limiter is gone', body.slice(0, 0) || true);
  ok(/op:\s*'reserve'/.test(body), 'and the limit is an atomic reserve', /op:\s*'reserve'/.test(body));
  ok(/RESET_RL_MAX/.test(body), 'still capped at the documented number', true);
}

section('An automation whose email was held says so');
{
  const tick = codeOnly(src);
  ok(/wentOut\s*=\s*await\s*_autoEmailResult/.test(tick),
     'the tick reads the boolean the send answers with', true);
  ok(/lastError\s*=\s*wentOut\s*\?/.test(tick),
     'and records it when nothing was delivered, rather than showing the job green', true);
}

globalThis.fetch = realFetch;
report();
done();
