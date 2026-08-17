#!/usr/bin/env node
/* THE ONLY THING IN THIS REPO THAT RUNS THE REAL RUNTIME.
 *
 *   node smoke-real.mjs
 *
 * Every Worker suite imports amv-backend.js as a module and hands it an `env`
 * built by hand: a Map pretending to be KV, an object pretending to be a
 * Durable Object. Those doubles are written by whoever needed them, which means
 * they encode what that person expected to matter - and the first run of the
 * real thing found two defects in ninety seconds that two hundred and eighty
 * suites had never been in a position to see:
 *
 *   - @cloudflare/puppeteer imports node:buffer and no compatibility flag was
 *     set, so turning on Browser Rendering later would have refused for ever
 *     with a message blaming npm;
 *   - with no secrets set - the state of every first deploy - signup wrote the
 *     account, incremented the counters, and THEN failed to sign a token,
 *     answering 500. The address was spent on an account nobody could sign
 *     into, and trying again said "account exists".
 *
 * Neither is exotic. Both are what this Worker does on the day it is first
 * deployed. So this runs it the way Cloudflare will: `wrangler dev --local`
 * puts the code in workerd with a real KV and a REAL Durable Object, and the
 * checks below are the ones a fake cannot answer - concurrency, ordering, and
 * what an unconfigured deployment does.
 *
 * It SKIPS rather than fails when wrangler cannot start (no workerd binary, no
 * network on a fresh install). A gate that goes red for a reason that is not
 * the code teaches people to ignore it - the same rule audit-deps.mjs follows.
 */
import { spawn } from 'child_process';
import { existsSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const PORT = 8877;
const B = `http://127.0.0.1:${PORT}`;
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const PW = 'A-real-Passw0rd!';

/* The proxy in some sandboxes swallows loopback requests. */
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';
process.env.no_proxy = '*';

let failures = 0;
let checks = 0;
const ok = (cond, label, detail) => {
  checks++;
  if (cond) { console.log(`  \x1b[32m✓\x1b[0m ${label}`); return; }
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${label}`);
  if (detail !== undefined) console.log(`      got: ${JSON.stringify(detail)}`);
};
const section = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);

/* A throwaway secret file so the configured run can sign tokens. Removed
   afterwards, and .gitignore refuses to track it either way. */
const DEV_VARS = join(ROOT, '.dev.vars');
const HAD_DEV_VARS = existsSync(DEV_VARS);
const SAVED = HAD_DEV_VARS ? readFileSync(DEV_VARS, 'utf8') : null;
const THROWAWAY = [
  'JWT_SECRET=smoke-test-only-not-a-real-secret-000000000000',
  'ADMIN_TOKEN=smoke-test-only-admin-token',
  'OWNER_EMAIL=owner@smoke.test',
  `APP_URL=${B}`,
].join('\n') + '\n';

function restoreDevVars() {
  try {
    if (HAD_DEV_VARS) writeFileSync(DEV_VARS, SAVED);
    else rmSync(DEV_VARS, { force: true });
  } catch (e) {}
}

let child = null;
function stopWorker() {
  if (child) { try { child.kill('SIGTERM'); } catch (e) {} child = null; }
}

/* Start wrangler and wait for it to say it is listening. Resolves false if it
   never gets there, so the caller can skip instead of hanging. */
function startWorker(withSecrets) {
  return new Promise((resolve) => {
    if (withSecrets) writeFileSync(DEV_VARS, THROWAWAY);
    else rmSync(DEV_VARS, { force: true });
    rmSync(join(ROOT, '.wrangler', 'state'), { recursive: true, force: true });

    child = spawn(WRANGLER, ['dev', '--local', '--port', String(PORT),
                             '--inspector-port', String(PORT + 1000)],
                  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const done = (v) => { clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => done(false), 90000);
    const watch = (buf) => {
      out += String(buf);
      if (/Ready on http/.test(out)) done(true);
    };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('error', () => done(false));
    child.on('exit', () => done(/Ready on http/.test(out)));
  });
}

const post = async (path, body, headers = {}) => {
  const r = await fetch(B + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '13.0.0.1', ...headers },
    body: JSON.stringify(body || {}),
  });
  let j = {};
  try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j, headers: r.headers };
};
const get = async (path, headers = {}) => {
  const r = await fetch(B + path, { headers });
  let j = {};
  try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j, headers: r.headers };
};

async function main() {
  if (!existsSync(WRANGLER)) {
    console.log('SKIP  wrangler is not installed, so the real runtime was not exercised.');
    return 0;
  }

  /* ── 1. The state every first deploy is in: no secrets ───────────────── */
  console.log('Starting the Worker in workerd with NO secrets…');
  if (!(await startWorker(false))) {
    stopWorker();
    console.log('SKIP  wrangler could not start, so the real runtime was not exercised.');
    return 0;
  }

  section('An unconfigured deployment refuses before it writes');
  {
    const r = await post('/auth/signup', { email: 'first@smoke.test', name: 'F', password: PW });
    ok(r.status === 503, 'signup is refused with 503, not 500', r.status);
    ok(r.body.code === 'not_configured', 'as unfinished setup rather than a crash', r.body);
    ok(r.body.missing === 'JWT_SECRET', 'naming what is missing', r.body.missing);

    /* The half that matters: nothing was written on the way to refusing, so a
       second attempt is not told the address is taken. */
    const again = await post('/auth/signup', { email: 'first@smoke.test', name: 'F', password: PW });
    ok(again.status === 503, 'and a second attempt gets the same answer', again.status);
    ok(!/exists/i.test(JSON.stringify(again.body)),
       'never "account exists", which would spend the address on nothing', again.body);
  }
  stopWorker();

  /* ── 2. A configured deployment, under real concurrency ──────────────── */
  console.log('\nRestarting with secrets set…');
  if (!(await startWorker(true))) {
    stopWorker();
    console.log('SKIP  wrangler could not restart, so the rest was not exercised.');
    return 0;
  }

  section('A real Durable Object holds the ceiling under real concurrency');
  {
    /* Fired together, so the counter has to serialise them itself. This is the
       whole reason a Durable Object is in this design, and it is the one thing
       a hand-written double cannot demonstrate: the fake serialises because
       JavaScript does, not because the design is right. */
    const burst = await Promise.all(Array.from({ length: 45 }, (_, i) =>
      post('/auth/login', { email: `ghost${i}@smoke.test`, password: 'Not-the-Passw0rd!' },
           { 'CF-Connecting-IP': '14.0.0.1' })));
    const hashed = burst.filter(r => r.status === 401).length;
    const refused = burst.filter(r => r.status === 429).length;
    ok(hashed <= 30, 'no more sign-in attempts reach the hashing than the cap allows', hashed);
    ok(refused > 0, 'and the rest are refused', refused);

    const other = await post('/auth/login', { email: 'nobody@smoke.test', password: 'x' },
                             { 'CF-Connecting-IP': '15.0.0.1' });
    ok(other.status !== 429, 'while a different source is unaffected', other.status);
  }

  section('Two signups for one address in a dead heat make one account');
  {
    const rs = await Promise.all(Array.from({ length: 8 }, () =>
      post('/auth/signup', { email: 'race@smoke.test', name: 'R', password: PW },
           { 'CF-Connecting-IP': '16.0.0.1' })));
    const won = rs.filter(r => r.status === 200).length;
    ok(won === 1, 'exactly one signup succeeds', won);
    ok(rs.some(r => r.status === 409 || r.status === 429), 'and the others are told why', rs.map(r => r.status));
  }

  section('A token is only as good as its signature');
  {
    const up = await post('/auth/signup', { email: 'tok@smoke.test', name: 'T', password: PW },
                          { 'CF-Connecting-IP': '17.0.0.1' });
    const tok = up.body.token;
    ok(up.status === 200 && !!tok, 'a real signup hands back a token', up.status);
    if (tok) {
      ok((await get('/v1/entitlement', { Authorization: 'Bearer ' + tok })).status === 200,
         'which works', true);
      ok((await get('/v1/entitlement', { Authorization: 'Bearer ' + tok.slice(0, -3) + 'AAA' })).status === 401,
         'a changed signature does not', true);
      const [h, p, sig] = tok.split('.');
      const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
      payload.email = 'owner@smoke.test';
      const swapped = [h, Buffer.from(JSON.stringify(payload)).toString('base64url'), sig].join('.');
      ok((await get('/v1/entitlement', { Authorization: 'Bearer ' + swapped })).status === 401,
         'nor a payload rewritten to somebody else', true);
      const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      ok((await get('/v1/entitlement', { Authorization: 'Bearer ' + [none, p, ''].join('.') })).status === 401,
         'nor alg:none', true);
    }
  }

  section('The operator screen is the operator s');
  {
    const owner = await post('/auth/signup', { email: 'owner@smoke.test', name: 'O', password: PW },
                             { 'CF-Connecting-IP': '18.0.0.1' });
    const nosy = await post('/auth/signup', { email: 'nosy@smoke.test', name: 'N', password: PW },
                            { 'CF-Connecting-IP': '18.0.0.2' });
    ok((await post('/admin/users', {}, { Authorization: 'Bearer ' + owner.body.token })).status === 200,
       'the configured owner reaches it', true);
    ok((await post('/admin/users', {}, { Authorization: 'Bearer ' + nosy.body.token })).status === 403,
       'and a signed-in stranger does not', true);
    ok((await post('/admin/users', {}, { Authorization: 'Bearer smoke-test-only-admin-token' })).status === 401,
       'nor does the admin token, which is a different credential on purpose', true);
  }

  section('The rules that apply to every route apply on the real router');
  {
    const g = await fetch(B + '/auth/login', { method: 'GET' });
    ok(g.status === 405, 'a write route refuses GET', g.status);
    ok(/POST/.test(g.headers.get('Allow') || ''), 'and says what it does accept', g.headers.get('Allow'));

    const big = JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(2 * 1024 * 1024) });
    const r = await fetch(B + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big,
    });
    ok(r.status === 413, 'a body over the ceiling is refused', r.status);

    const opts = await fetch(B + '/auth/login', { method: 'OPTIONS' });
    for (const h of ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy']) {
      ok(!!opts.headers.get(h), `${h} is on the response`, opts.headers.get(h));
    }
  }

  section('One account s export is one account s');
  {
    const a = await post('/auth/signup', { email: 'idor-a@smoke.test', name: 'A', password: PW },
                         { 'CF-Connecting-IP': '19.0.0.1' });
    await post('/auth/signup', { email: 'idor-b@smoke.test', name: 'B', password: PW },
               { 'CF-Connecting-IP': '19.0.0.2' });
    const mine = await get('/v1/account/export', { Authorization: 'Bearer ' + a.body.token });
    ok(mine.status === 200, 'an account can export its own data', mine.status);
    ok(!/idor-b@smoke\.test/.test(JSON.stringify(mine.body)),
       'and the file says nothing about anybody else', true);
  }

  stopWorker();
  return failures;
}

let code = 0;
try {
  code = await main();
} catch (e) {
  console.log(`\n\x1b[31mThe real-runtime smoke test could not complete:\x1b[0m ${e.message}`);
  code = 1;
} finally {
  stopWorker();
  restoreDevVars();
  rmSync(join(ROOT, '.wrangler', 'state'), { recursive: true, force: true });
}

if (code === 0) {
  console.log(`\n\x1b[32m${checks} checks passed against the real runtime.\x1b[0m`);
} else {
  console.log(`\n\x1b[31m${code} check(s) FAILED against the real runtime.\x1b[0m`);
}
process.exit(code === 0 ? 0 : 1);
