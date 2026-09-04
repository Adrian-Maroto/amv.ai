/* "ONLY A DEV FALLBACK", SAID THE COMMENT, TO CODE THAT CANNOT TELL.

   The three payment redirects read `APP_URL || APP_ORIGIN || request Origin`,
   under a comment saying the request Origin is "only a dev fallback when no
   APP_URL is configured". That is an intention. Nothing in the code knows
   whether a deployment is development - a production instance that simply never
   set APP_URL took the post-payment redirect from a header the caller sends,
   and nothing authenticates that header.

   What it is worth: start a checkout with `Origin: https://amv-billing.example`
   and that address goes into Stripe's success_url. The customer really pays, to
   the real Stripe, and is returned to a page the attacker controls at the exact
   moment they expect to be asked to confirm something. A phishing page with
   perfect timing and a genuine transaction behind it.

   AND THE BLOCK THAT OUTLIVED ITS REASON (AMV-SP-07). A blocked account is two
   records: an `abuse` row saying why, and `ent.blocked`, which is the copy every
   request actually reads. Clearing the flag updated both. DELETING the record -
   the stronger of the two operator actions - updated only the first. So "remove"
   left the account refused everywhere with the evidence gone: an operator
   looking at an empty screen while the customer cannot use anything, and nothing
   left to work back from.

   AND TWO THINGS THAT WERE NOT CODE (AMV-058, AMV-059, AMV-SP-12). The CI
   workflow ran actions pinned to a mutable major tag, under a note saying they
   should be pinned to commit SHAs "once you've verified them" - the fix written
   down instead of made. The deploy script called a wrangler nobody declared. And
   the dependency audit was something a person ran by hand, in an environment
   somebody had to arrange, which means it happens once. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'devfallback.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, issueTokens, marketBuy, stripeCheckout, stripePortal, abuseClear,' +
  ' _paymentReturnOrigin, _paymentOriginMissing, getEntitlement };\n');
const W = await import(harness + '?t=' + Date.now());

const ADMIN = 'a-long-random-admin-token';
const realFetch = globalThis.fetch;
let stripeForms = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (/api\.stripe\.com/.test(u)) {
    stripeForms.push(String((init && init.body) || ''));
    return { ok: true, status: 200, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv(extra = {}) {
  const m = new Map(); const vals = new Map();
  return Object.assign({
    JWT_SECRET: 'x'.repeat(40), ADMIN_TOKEN: ADMIN,
    STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_PRO: 'price_pro',
    _map: m,
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, String(v)); },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) {
        return { keys: [...m.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'claim') { if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false })); vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true, owner: 'o' })); }
        if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ released: true })); }
        if (b.op === 'rateCheck') { const nx = cur + 1; vals.set(n, nx); return new Response(JSON.stringify({ allowed: nx <= (b.limit || 9999) })); }
        if (b.op === 'reserve') { const nx = cur + (b.amount || 0); if (nx > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur })); vals.set(n, nx); return new Response(JSON.stringify({ allowed: true, value: nx })); }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  }, extra);
}
const EMAIL = 'buyer@example.com';
const tokFor = async (env) => (await W.issueTokens(env, EMAIL, 'B')).token;
const buyReq = async (env, origin) => new Request('https://api.amv.test/v1/stripe/checkout', {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.1.1.1',
                           Authorization: 'Bearer ' + (await tokFor(env)) },
                         origin ? { Origin: origin } : {}),
  body: JSON.stringify({ plan: 'pro', email: EMAIL }),
});
const read = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

section('A configured deployment sends people back to its own address');
{
  const env = mkEnv({ APP_URL: 'https://amv.homes' });
  stripeForms = [];
  const r = await read(await W.stripeCheckout(await buyReq(env, 'https://amv-billing.example'), env));
  ok(r.status === 200, 'the checkout starts', r.status);
  const form = stripeForms.join('\n');
  ok(/success_url=https%3A%2F%2Famv\.homes/.test(form), 'and returns to the real app', form.slice(0, 200));
  ok(!/amv-billing\.example/.test(form),
     'not to the address the caller put in a header', form.match(/success_url=[^&]*/));
}

section('THE FINDING: an unconfigured one refuses rather than trusting a header');
{
  /* Nothing in the code can tell development from production. A deployment that
     simply never set APP_URL used to take the redirect from the request. */
  const env = mkEnv();   // no APP_URL, no APP_ORIGIN
  stripeForms = [];
  const r = await read(await W.stripeCheckout(await buyReq(env, 'https://amv-billing.example'), env));

  ok(r.status === 503, 'the payment does not start', r.status);
  ok(r.body.code === 'needs_service', 'and it is a configuration problem, said as one', r.body.code);
  ok(/APP_URL/.test(r.body.error || ''), 'naming the setting that is missing', r.body.error);
  ok(stripeForms.length === 0, 'and Stripe was never asked, so no session exists to be paid', stripeForms.length);
}

section('There is no header anywhere that can choose where a payment returns');
{
  const helper = codeOnly(functionBody(src, '_paymentReturnOrigin') || '');
  ok(helper.length > 20, 'the origin helper was read', helper.length);
  ok(!/headers/.test(helper) && !/Origin/.test(helper.replace(/APP_ORIGIN/g, '')),
     'it reads only what the deployment configured', helper);

  ok(W._paymentReturnOrigin({ APP_URL: 'https://a.test/' }) === 'https://a.test', 'a trailing slash is trimmed');
  ok(W._paymentReturnOrigin({ APP_ORIGIN: 'https://b.test' }) === 'https://b.test', 'APP_ORIGIN works too');
  ok(W._paymentReturnOrigin({}) === '', 'and nothing configured is nothing');
  ok(W._paymentReturnOrigin(null) === '', 'even with no env at all');

  /* And no payment route reaches for the header any more. */
  const whole = codeOnly(src);
  ok(!/env\.APP_ORIGIN \|\| request\.headers\.get\('Origin'\)/.test(whole),
     'no route falls back to the request Origin for a redirect', true);
  ok((whole.match(/_paymentReturnOrigin\(env\)/g) || []).length >= 3,
     'and every payment redirect goes through the one helper',
     (whole.match(/_paymentReturnOrigin\(env\)/g) || []).length);
}

section('Deleting an abuse record lifts the block it was there to explain');
{
  const env = mkEnv({ APP_URL: 'https://amv.homes' });
  const BAD = 'flagged@example.com';
  await W.DB.put(env, 'abuse', BAD, { blocked: true, reason: 'chargeback', disputes: 1 });
  await W.DB.put(env, 'ent', BAD, { plan: 'pro', blocked: true, blockedReason: 'chargeback', blockedAt: Date.now() });

  const clear = async (body) => read(await W.abuseClear(new Request('https://api.amv.test/admin/abuse/clear', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ADMIN, 'CF-Connecting-IP': '3.1.1.1' },
    body: JSON.stringify(body),
  }), env));

  const r = await clear({ email: BAD, remove: true });
  ok(r.status === 200 && r.body.ok === true, 'the operator removes the record', r.body);
  ok(r.body.unblocked === true, 'and is told the account is usable again', r.body);

  ok(!(await W.DB.get(env, 'abuse', BAD)), 'the abuse record is gone', true);
  const ent = await W.DB.get(env, 'ent', BAD);
  ok(!ent.blocked, 'and so is the block every request actually reads', ent);
  ok(!ent.blockedReason && !ent.blockedAt, 'with nothing left of it', ent);
  ok(ent.plan === 'pro', 'while the plan they paid for is untouched', ent.plan);
}

section('And clearing the flag without removing it does the same');
{
  const env = mkEnv({ APP_URL: 'https://amv.homes' });
  const BAD = 'flagged2@example.com';
  await W.DB.put(env, 'abuse', BAD, { blocked: true, reason: 'chargeback' });
  await W.DB.put(env, 'ent', BAD, { plan: 'pro', blocked: true, blockedReason: 'chargeback' });

  const r = await read(await W.abuseClear(new Request('https://api.amv.test/admin/abuse/clear', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ADMIN, 'CF-Connecting-IP': '3.1.1.2' },
    body: JSON.stringify({ email: BAD }),
  }), env));
  ok(r.body.unblocked === true, 'the account is usable again', r.body);
  const abuse = await W.DB.get(env, 'abuse', BAD);
  ok(abuse && abuse.blocked === false, 'the record is kept, with the flag down', abuse);
  ok(abuse.clearedAt > 0, 'and when it was cleared', abuse.clearedAt);
  const ent = await W.DB.get(env, 'ent', BAD);
  ok(!ent.blocked, 'and the fast copy agrees', ent);
}

section('A remove that cannot lift the block does not delete the evidence');
{
  /* The recoverable order to fail in: if the block cannot be lifted, the record
     saying why must still be there for the next attempt. */
  const env = mkEnv({ APP_URL: 'https://amv.homes' });
  const BAD = 'stuck@example.com';
  await W.DB.put(env, 'abuse', BAD, { blocked: true, reason: 'chargeback' });
  await W.DB.put(env, 'ent', BAD, { plan: 'pro', blocked: true });
  const broken = Object.assign({}, env, {
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body);
      /* The record lock cannot be taken, so the entitlement cannot be written.
         Rate limiting still answers, or the gate refuses first and this tests
         nothing. */
      if (b.op === 'claim') return new Response(JSON.stringify({ claimed: false }));
      return new Response(JSON.stringify({ allowed: true, value: 0 }));
    } }) },
  });
  const r = await read(await W.abuseClear(new Request('https://api.amv.test/admin/abuse/clear', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ADMIN, 'CF-Connecting-IP': '3.1.1.3' },
    body: JSON.stringify({ email: BAD, remove: true }),
  }), broken));

  ok(r.status === 503, 'the operator is told it did not work', r.status);
  ok(r.body.code === 'unblock_failed', 'with a code', r.body.code);
  ok(!!(await W.DB.get(env, 'abuse', BAD)),
     'and the record explaining the block is still there to try again from', true);
}

section('The CI actions are pinned to commits, not to a tag somebody can move');
{
  const wf = join(ROOT, '.github', 'workflows', 'test.yml');
  ok(existsSync(wf), 'the workflow exists', wf);
  const yml = readFileSync(wf, 'utf8');
  const uses = [...yml.matchAll(/uses:\s*([^\s#]+)/g)].map(m => m[1]);
  ok(uses.length > 0, 'it uses some actions', uses);
  for (const u of uses) {
    ok(/@[0-9a-f]{40}$/.test(u), u.split('@')[0] + ' is pinned to a full commit SHA', u);
  }
  ok(!/@v\d+\s*$/m.test(yml.replace(/#.*$/gm, '')), 'and nothing is left on a major tag', true);
  /* The version each SHA is, kept beside it, so an upgrade is a deliberate edit
     rather than something that happens to a workflow nobody touched. */
  for (const line of yml.split('\n').filter(l => /uses:/.test(l))) {
    ok(/#\s*v\d+\.\d+/.test(line), 'and says which version it is', line.trim());
  }
  /* And the note telling somebody to do this LATER is gone, because a comment
     describing the fix is not the fix. */
  ok(!/once you've verified them/.test(yml), 'the note promising to pin them is gone', true);
}

section('Everything the project needs to run is declared, including the deploy tool');
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  ok(/wrangler/.test(pkg.scripts.deploy || ''), 'deploying uses wrangler', pkg.scripts.deploy);
  const declared = Object.assign({}, pkg.dependencies, pkg.devDependencies);
  ok(!!declared.wrangler,
     'and wrangler is declared, so it is not whatever happens to be installed globally', declared.wrangler);
  ok(!!pkg.dependencies['@cloudflare/puppeteer'],
     'the browser driver stays a runtime dependency, because the Worker bundles it',
     Object.keys(pkg.dependencies));

  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  ok(!!lock.packages['node_modules/wrangler'], 'and it is in the lockfile, at a resolved version', true);
}

section('The deploy checklist does not name a secret nothing reads');
{
  /* IT DID, AND OBEYING IT COST MONEY.

     GO-LIVE.md listed IMAGE_API_URL / IMAGE_API_KEY / IMAGE_API_MODEL and
     VIDEO_API_URL / VIDEO_API_KEY / VIDEO_MODEL as secrets to set, DEPLOY.md
     had a whole section of `wrangler secret put` commands for the video three,
     and GO-LIVE priced IMAGE_COST_USD and VIDEO_COST_USD as spend knobs. Image
     and video generation were removed from this product end to end. The Worker
     reads none of those names anywhere.

     So the checklist told somebody to open an account with a generation
     provider, pay for it, and put three secrets into Cloudflare that nothing
     would ever read - and then wonder why the feature never appeared. A
     checklist naming a secret nothing reads is worse than one that omits it,
     because it costs money to obey.

     The rule: every ALL-CAPS name the deploy docs present in backticks must
     appear in the Worker. Names the docs explicitly describe as REMOVED are
     exempt, because saying "this is gone, do not set it" is the opposite of the
     mistake and is worth writing down. */
  const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  const goLive = readFileSync(join(ROOT, 'GO-LIVE.md'), 'utf8');
  const deploy = readFileSync(join(ROOT, 'DEPLOY.md'), 'utf8');

  /* The section that documents the removal names them on purpose. */
  const removalNote = /removed[\s\S]{0,2000}?reads none of those names|Video and images - removed/i;
  const exempt = new Set();
  const note = /## Video and images - removed[\s\S]*?(?=\n## )/.exec(deploy);
  if (note) for (const m of note[0].matchAll(/`([A-Z][A-Z0-9_]{4,})`/g)) exempt.add(m[1]);
  ok(exempt.size > 0, 'the removal note is present and names what it removed', exempt.size);

  const PLACEHOLDERS = new Set(['REPLACE_WITH_YOUR_KV_NAMESPACE_ID']);
  const dead = [];
  for (const src of [goLive, deploy])
    for (const m of src.matchAll(/`([A-Z][A-Z0-9_]{4,})`/g)) {
      const n = m[1];
      if (exempt.has(n) || PLACEHOLDERS.has(n)) continue;
      if (!worker.includes(n) && !dead.includes(n)) dead.push(n);
    }
  ok(dead.length === 0,
     'every secret the checklist tells you to set is one the Worker reads', dead.join(', '));

  /* And the other direction for the one that actually blocks a launch. */
  ok(/AMV_MODEL_KEY/.test(goLive) && worker.includes('AMV_MODEL_KEY'),
     'and the one secret that blocks launch is on the checklist', true);
}

section('The dependency audit is a script, so it happens more than once');
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  ok(/audit-deps/.test(pkg.scripts.audit || ''), 'there is a command for it', pkg.scripts.audit);
  ok(existsSync(join(ROOT, 'audit-deps.mjs')), 'and a script behind it', true);

  const s = readFileSync(join(ROOT, 'audit-deps.mjs'), 'utf8');
  ok(/const ACCEPTED = \{/.test(s), 'with a list of advisories somebody has assessed', true);

  /* EVERY ENTRY HAS A REASON AND A DATE - INCLUDING WHEN THERE ARE NONE.

     This used to be `/why:/.test(s) && /since:/.test(s)`, which is not that
     claim: it asks whether those two words appear anywhere in the file, so one
     entry with a reason passed it on behalf of five without. Worse, it made an
     EMPTY roster a failure - and empty is the correct state the moment the last
     stale exemption is deleted, which is what the sibling assertion two lines
     down demands. Two suites in this repository disagreed, and the one that was
     wrong was the one greping for a substring.

     So read the object instead: brace-match the literal, take its top-level
     keys, and require each to carry both fields. Vacuously true for zero
     entries, genuinely checked for any number above that. */
  const acc = (() => {
    const at = s.indexOf('const ACCEPTED = {');
    if (at < 0) return null;
    let i = s.indexOf('{', at), depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}' && --depth === 0) return s.slice(i + 1, j);
    }
    return null;
  })();
  ok(acc !== null, 'and the list is a literal that can be read, not just matched', true);
  const entries = [...String(acc || '').matchAll(/(?:'([^']+)'|"([^"]+)"|([\w@\/.-]+))\s*:\s*\{([\s\S]*?)\n  \}/g)];
  const bare = entries.filter(m => !/since:/.test(m[4]) || !/why:/.test(m[4]))
                      .map(m => m[1] || m[2] || m[3]);
  ok(bare.length === 0, 'each with a written reason and a date',
     entries.length ? entries.length + ' assessed, ' + bare.length + ' without' : 'none exempted');
  ok(/unexpected\.length/.test(s), 'anything unassessed fails it', true);
  ok(/stale\.length/.test(s), 'and an exemption for something no longer flagged fails it too', true);
  ok(/SKIP/.test(s) && /registry is not reachable/.test(s),
     'while being offline is a skip, because a gate that goes red on a train gets ignored', true);

  const gate = readFileSync(join(ROOT, 'check.mjs'), 'utf8');
  ok(/audit-deps\.mjs/.test(gate), 'and the shippability gate runs it', true);
}

globalThis.fetch = realFetch;
if (report('the-fallback-that-was-never-only-for-development') > 0) process.exitCode = 1;
done();
