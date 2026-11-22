/* A SCAN THAT DID NOT RUN IS NOT CLEAN, AND AN EXCEPTION COVERS ONLY WHAT IT
   NAMES (Build 16 audit OPS-01, OPS-02, Nov 21).

   audit-deps.mjs is run here against a stand-in `npm` on the PATH, which
   prints whatever this test chooses:
   - npm failing with an error object printed as JSON is "no audit was run",
     never "every advisory is absent or assessed" - and with
     AMV_AUDIT_REQUIRED=1 it fails;
   - a new advisory in a package that already has an exception fails;
   - the advisories the exceptions were written for still pass. */
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = mkdtempSync(join(tmpdir(), 'fake-npm-'));
const run = (json, code, env = {}) => {
  writeFileSync(join(bin, 'out.json'), JSON.stringify(json));
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\ncat "' + join(bin, 'out.json') + '"\nexit ' + code + '\n');
  chmodSync(join(bin, 'npm'), 0o755);
  const r = spawnSync(process.execPath, [join(ROOT, 'audit-deps.mjs')], { cwd: ROOT, encoding: 'utf8',
    env: Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH }, env) });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const via = (id, title) => ({ source: 1, name: 'x', title, url: 'https://github.com/advisories/' + id, severity: 'high', range: '<=9' });
const base = () => ({ auditReportVersion: 2, metadata: { vulnerabilities: { high: 7, critical: 0 } }, vulnerabilities: {
  '@cloudflare/puppeteer': { severity: 'high', via: ['@puppeteer/browsers'], range: '*' },
  '@puppeteer/browsers': { severity: 'high', via: ['extract-zip', 'proxy-agent'], range: '*' },
  'basic-ftp': { severity: 'high', via: [via('GHSA-c475-qrg2-pj4r', 'a'), via('GHSA-5pm8-86m8-9m6r', 'b'), via('GHSA-r4jh-29pc-gfqr', 'c')], range: '*' },
  'extract-zip': { severity: 'high', via: [via('GHSA-jmr9-qjv8-65gv', 'd'), via('GHSA-7pqw-9j4j-h8q3', 'e')], range: '*' },
  'get-uri': { severity: 'high', via: ['basic-ftp'], range: '*' },
  'pac-proxy-agent': { severity: 'high', via: ['get-uri'], range: '*' },
  'proxy-agent': { severity: 'high', via: ['pac-proxy-agent'], range: '*' },
} });

section('The advisories the exceptions were written for still pass');
{
  const r = run(base(), 1);
  ok(r.status === 0 && /OK\s+every advisory/.test(r.out), 'the assessed ones pass', r.out.slice(-300));
}

section('npm failing is not a clean report');
{
  /* On a laptop, which is what this case is: the suite itself may be running
     in CI, where a skip is a failure (Build 17 audit B17-015, below). */
  const laptop = { CI: '', GITHUB_ACTIONS: '', AMV_AUDIT_REQUIRED: '' };
  const r = run({ error: { code: 'E500', summary: 'The audit endpoint returned an error' } }, 1, laptop);
  ok(r.status === 0 && /^SKIP/m.test(r.out) && !/OK\s+every advisory/.test(r.out), 'it says no audit was run, not that everything is assessed', r.out.slice(-300));
  const ci = run({ error: { code: 'E500', summary: 'down' } }, 1, { CI: 'true', GITHUB_ACTIONS: '', AMV_AUDIT_REQUIRED: '' });
  ok(ci.status === 3 && /^SKIP/m.test(ci.out), 'and where a release is built, a skip fails the build', ci.status);
  const req = run({ error: { code: 'E500', summary: 'down' } }, 1, { AMV_AUDIT_REQUIRED: '1' });
  ok(req.status !== 0, 'and where an audit is required, it fails', req.status);
}

section('A new advisory in a package that already has an exception fails');
{
  const b = base();
  b.vulnerabilities['basic-ftp'].via.push(via('GHSA-new0-crit-0001', 'a new critical hole'));
  const r = run(b, 1);
  ok(r.status === 1 && /GHSA-new0-crit-0001/.test(r.out), 'the new one is named, and the scan fails', r.out.slice(-400));
  const c = base();
  c.vulnerabilities['get-uri'].via.push('some-new-package');
  const r2 = run(c, 1);
  ok(r2.status === 1 && /some-new-package/.test(r2.out), 'and so does a new path into an accepted package', r2.out.slice(-300));
}

if (report('a-scan-that-did-not-run-is-not-clean') > 0) process.exitCode = 1;
done();
