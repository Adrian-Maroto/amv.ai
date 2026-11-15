/* THE BUILD 15 AUDIT STAYS FIXED (Nov 15).

   The Build 15 audit came with its own fault-injection reproductions in
   tests/audit - twenty-six checks against the real Worker source. Seventeen
   repairs pass; three architectural failures (B15-09, B15-18, B15-19) are
   still open and were reported as blocking an unrestricted paid launch.

   An audit's reproduction is a suite, not a folder beside the suites
   (LESSONS 636): this runs both scripts inside the gate. Every check must
   pass EXCEPT the three named as open - and if one of those starts passing,
   this fails too, so the list cannot go stale: take it off when it is fixed. */
import { spawnSync } from 'child_process';
import { readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OPEN = new Set(['B15-09', 'B15-18', 'B15-19']);
const out = mkdtempSync(join(tmpdir(), 'b15-'));

for (const name of ['build15-regressions', 'build15-backup-regressions']) {
  section(name);
  const file = join(out, name + '.json');
  const r = spawnSync(process.execPath, [join(ROOT, 'tests/audit', name + '.mjs'), ROOT, file], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
  let res = null; try { res = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { res = null; }
  const list = (res && (res.results || res.checks)) || [];
  ok(Array.isArray(list) && list.length >= 6, 'the reproductions ran and wrote their results', [r.status, (r.stderr || '').slice(-300)]);
  for (const c of (Array.isArray(list) ? list : [])) {
    if (OPEN.has(c.id)) ok(!c.pass, c.id + ' is still open (take it off this list once it passes): ' + c.title, c.pass);
    else ok(!!c.pass, c.id + ' ' + c.title, c.error || c.evidence);
  }
}

if (report('the-build-15-audit-stays-fixed') > 0) process.exitCode = 1;
done();
