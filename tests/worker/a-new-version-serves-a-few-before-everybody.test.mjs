/* A NEW VERSION SERVES A FEW PEOPLE BEFORE IT SERVES EVERYBODY
   (scripts/canary-deploy.mjs, Oct 31 audit items 83-84).

   Driven against a stand-in wrangler (a script that records every call and
   prints what the real one prints) and a stand-in readiness endpoint that
   answers per pinned version, so every branch runs without a Cloudflare
   account:
     - a ready canary goes 10% -> 100% and the schedule is applied;
     - the readiness checks are pinned to the NEW version, not whichever
       version a request lands on;
     - a canary that is not ready puts the old version back at 100%, never
       promotes, and fails;
     - one blip that a retry clears does not abort a release;
     - a migration, or no serving version, deploys the ordinary way;
     - an upload failure changes nothing and fails;
     - the workflow runs it only behind AMV_CANARY, and the ordinary deploy
       only without it. */
import { spawn } from 'child_process';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, readFileSync, mkdtempSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'canary-deploy.mjs');
const { servingVersion, uploadedVersion } = await import(SCRIPT);

const OLD = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';

section('The serving version and the uploaded one are read from what wrangler prints');
{
  ok(servingVersion({ id: 'd', versions: [{ version_id: NEW, percentage: 10 }, { version_id: OLD, percentage: 90 }] }) === OLD, 'the one with most traffic');
  ok(servingVersion({ versions: [] }) === '', 'none, as none');
  ok(servingVersion({ versions: [{ version_id: 'not-an-id', percentage: 100 }] }) === '', 'a malformed id is not an id');
  ok(uploadedVersion('Uploaded amv-ai\nWorker Version ID: ' + NEW + '\nVersion Preview URL: x') === NEW, 'the uploaded id');
  ok(uploadedVersion('Uploaded amv-ai') === '', 'and none when there is none');
}

/* The stand-in readiness endpoint: ready per pinned version. */
let readyFor = {}, blips = 0, shape = {};
const pins = [];
const server = createServer((req, res) => {
  const pin = String(req.headers['cloudflare-workers-version-overrides'] || '');
  pins.push(pin);
  const m = /amv-ai="([^"]+)"/.exec(pin);
  let ready = !!(m && readyFor[m[1]]);
  if (ready && blips > 0) { blips--; ready = false; }
  const sh = m && shape[m[1]];
  if (sh) { res.writeHead(sh.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(sh.body)); return; }
  res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ready, failed: ready ? [] : ['kv'] }));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const READY_URL = 'http://127.0.0.1:' + server.address().port + '/v1/health/ready';

const dir = mkdtempSync(join(tmpdir(), 'amv-canary-'));
const log = join(dir, 'calls.log');
const fake = join(dir, 'wrangler.mjs');
writeFileSync(fake, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'fs';
const a = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, a.join(' ') + '\\n');
const mode = process.env.FAKE_MODE || '';
if (a[0] === 'deployments') {
  if (mode === 'first') { console.log('{}'); process.exit(0); }
  if (mode === 'statusfail') { console.error('Authentication error'); process.exit(1); }
  if (mode === 'statusodd') { console.log(JSON.stringify({ id: 'dep', versions: [{ version_id: 'not-an-id', percentage: 100 }] })); process.exit(0); }
  console.log(JSON.stringify({ id: 'dep', versions: [{ version_id: '${OLD}', percentage: 100 }] }));
  process.exit(0);
}
if (a[0] === 'versions' && a[1] === 'upload') {
  if (mode === 'migration') { console.error('You attempted to upload a version of a Worker that includes a Durable Object migration'); process.exit(1); }
  if (mode === 'uploadfail') { console.error('Authentication error'); process.exit(1); }
  console.log('Worker Version ID: ${NEW}'); process.exit(0);
}
if (a[0] === 'versions' && a[1] === 'deploy' && (mode === 'notvisible' || mode === 'splitfail')) {
  const tries = readFileSync(${JSON.stringify(log)}, 'utf8').split('\\n').filter(l => l.startsWith('versions deploy')).length;
  if (mode === 'splitfail') { console.error('Authentication error [code: 10000]'); process.exit(1); }
  if (tries <= 2) { console.error('The requested Worker version could not be found, please check the ID being passed and try again. [code: 100146]'); process.exit(1); }
}
process.exit(0);
`);
chmodSync(fake, 0o755);

function run(mode, ready, blipCount = 0, extra = {}, shapes = {}) {
  writeFileSync(log, '');
  readyFor = ready; blips = blipCount; pins.length = 0; shape = shapes;
  const env = { ...process.env, ...extra, WRANGLER: process.execPath + ' ' + fake, AMV_READY_URL: READY_URL, FAKE_MODE: mode,
    CANARY_WATCH_SECONDS: '0.3', CANARY_CHECK_EVERY_SECONDS: '0.1', CANARY_RETRY_SECONDS: '0.05', CANARY_VISIBLE_RETRY_SECONDS: '0.05', GITHUB_SHA: 'abcdef1234', GITHUB_STEP_SUMMARY: join(dir, 'summary.md') };
  writeFileSync(env.GITHUB_STEP_SUMMARY, '');
  return new Promise(resolve => {
    const p = spawn(process.execPath, [SCRIPT], { env });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    p.on('close', code => resolve({ code, out, calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean), summary: readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8') }));
  });
}

section('A ready canary goes from a tenth of traffic to all of it, and the schedule is applied');
{
  const r = await run('', { [NEW]: true });
  ok(r.code === 0, 'it succeeds');
  const i10 = r.calls.findIndex(c => c.startsWith('versions deploy ' + NEW + '@10% ' + OLD + '@90%'));
  const i100 = r.calls.findIndex(c => c.startsWith('versions deploy ' + NEW + '@100%'));
  ok(i10 >= 0, 'the new version first serves 10%, the old one keeping 90%');
  ok(i100 > i10, 'and only then everybody');
  ok(r.calls.indexOf('triggers deploy') > i100, 'and the cron schedule is applied after it');
  ok(!r.calls.includes('deploy'), 'with no all-at-once deploy');
  /* The first look is at the serving version, for what it can do (OPS-04);
     every check that decides is pinned to the new one. */
  ok(pins.length >= 3 && pins[0] === 'amv-ai="' + OLD + '"' && pins.slice(1).every(p => p === 'amv-ai="' + NEW + '"'), 'the serving version is read once, then every readiness check is pinned to the new version', pins);
  ok(/Released through a canary/.test(r.summary), 'and the run summary says so');
}

section('A canary that is not ready puts the old version back and is never promoted');
{
  const r = await run('', { [OLD]: true });
  ok(r.code === 1, 'it fails');
  ok(r.calls.some(c => c.startsWith('versions deploy ' + OLD + '@100%')), 'the old version serves everybody again');
  ok(!r.calls.some(c => c.startsWith('versions deploy ' + NEW + '@100%')), 'the new one never does');
  ok(!r.calls.includes('triggers deploy'), 'and nothing else is applied');
  ok(/Canary refused/.test(r.summary) && /Canary refused/.test(r.out), 'and both the log and the summary say why');
}

section('One blip that a retry clears does not stop a release');
{
  const r = await run('', { [NEW]: true }, 1);
  ok(r.code === 0, 'released');
  ok(r.calls.some(c => c.startsWith('versions deploy ' + NEW + '@100%')), 'to everybody');
}

section('A Durable Object migration is a deliberate full deploy; nothing serving yet deploys the ordinary way');
{
  /* Build 16 audit OPS-03: a migration replaces everything with no canary, so
     it is never taken on implicitly. */
  const no = await run('migration', {});
  ok(no.code === 1 && !no.calls.includes('deploy') && !no.calls.some(c => c.startsWith('versions deploy')), 'a migration without AMV_FULL_DEPLOY=1 deploys nothing', no.calls);
  const m = await run('migration', {}, 0, { AMV_FULL_DEPLOY: '1' });
  ok(m.code === 0 && m.calls.includes('deploy'), 'with it, a migration goes through a full deploy');
  ok(!m.calls.some(c => c.startsWith('versions deploy')), 'with no split attempted');
  ok(/Durable Object migration/.test(m.summary), 'and the summary says why');
  const f = await run('first', {});
  ok(f.code === 0 && f.calls.includes('deploy') && !f.calls.some(c => c.startsWith('versions')), 'the first deploy has nothing to fall back to and deploys plainly');
}

section('Not knowing what serves is not the same as nothing serving (OPS-03)');
{
  for (const mode of ['statusfail', 'statusodd']) {
    const r = await run(mode, { [NEW]: true });
    ok(r.code === 1 && !r.calls.includes('deploy') && !r.calls.some(c => c.startsWith('versions')), mode + ': nothing is deployed', r.calls);
  }
}

section('Ready means all of it (OPS-04)');
{
  const r503 = await run('', {}, 0, {}, { [NEW]: { status: 503, body: { ready: true } } });
  ok(r503.code === 1 && !r503.calls.some(c => c.startsWith('versions deploy ' + NEW + '@100%')), 'a 503 that says ready is not promoted', r503.calls.slice(-2));
  const chk = await run('', {}, 0, {}, { [NEW]: { status: 200, body: { ready: true, checks: { kv: { ok: true }, model: { ok: false } } } } });
  ok(chk.code === 1 && !chk.calls.some(c => c.startsWith('versions deploy ' + NEW + '@100%')), 'nor one with a failing check', chk.calls.slice(-2));
  const lost = await run('', {}, 0, {}, {
    [OLD]: { status: 200, body: { ready: true, checks: {}, capabilities: { model: true, email: true } } },
    [NEW]: { status: 200, body: { ready: true, checks: {}, capabilities: { model: true, email: false } } } });
  ok(lost.code === 1 && /email/.test(lost.out) && !lost.calls.some(c => c.startsWith('versions deploy ' + NEW + '@100%')), 'nor one that lost something the serving version can do', lost.out.slice(-200));
  const fine = await run('', {}, 0, {}, {
    [OLD]: { status: 200, body: { ready: true, checks: {}, capabilities: { model: true } } },
    [NEW]: { status: 200, body: { ready: true, checks: { kv: { ok: true } }, capabilities: { model: true, email: true } } } });
  ok(fine.code === 0 && fine.calls.some(c => c.startsWith('versions deploy ' + NEW + '@100%')), 'while a healthy one that can do as much is promoted', fine.calls.slice(-3));
}

section('A version Cloudflare cannot see yet is asked for again; any other refusal stops (Nov 22)');
{
  const r = await run('notvisible', { [NEW]: true });
  const splits = r.calls.filter(c => c.startsWith('versions deploy ' + NEW + '@10%'));
  ok(splits.length === 3 && r.code === 0, 'two "not found" answers, then the split goes ahead and the release continues', [r.code, splits.length, r.out.slice(-300)]);
  const f = await run('splitfail', { [NEW]: true });
  const fs = f.calls.filter(c => c.startsWith('versions deploy ' + NEW + '@10%'));
  ok(f.code === 1 && fs.length === 1 && /still serves everybody/.test(f.out), 'another refusal is not retried, and the old version keeps serving', [f.code, fs.length]);
}

section('An upload that fails changes nothing');
{
  const r = await run('uploadfail', { [NEW]: true });
  ok(r.code === 1, 'it fails');
  ok(!r.calls.some(c => c.startsWith('versions deploy')) && !r.calls.includes('deploy'), 'and no traffic moved');
}

section('The workflow runs the canary only behind AMV_CANARY, and the plain deploy only without it');
{
  const y = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
  const step = (name) => { const i = y.indexOf('name: ' + name); const j = y.indexOf('- name:', i + 1); return i < 0 ? '' : y.slice(i, j < 0 ? undefined : j); };
  const plain = step('Preflight, then deploy the Worker');
  ok(/vars\.AMV_CANARY != 'on'/.test(plain) && /npm run deploy/.test(plain), 'the ordinary deploy is skipped when the canary is on');
  const can = step('Preflight, then release through a canary');
  ok(/vars\.AMV_CANARY == 'on'/.test(can), 'the canary step runs only when it is on');
  ok(/npm run predeploy/.test(can) && can.indexOf('npm run predeploy') < can.indexOf('scripts/canary-deploy.mjs'), 'the deploy preflight runs first, as `npm run deploy` runs it');
  ok(/steps\.ready\.outputs\.not_ready == 'yes'/.test(y) && /wrangler rollback --yes/.test(y), 'a version that deployed and is not ready is rolled back');
}

server.close();
report();
done();
