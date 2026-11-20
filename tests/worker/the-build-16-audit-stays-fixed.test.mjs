/* THE BUILD 16 AUDIT STAYS FIXED (Nov 18 audit, imported Nov 20).

   The audit reproduced its state findings against the real Worker with
   injected storage faults (tests/audit/build16-state.mjs, its own script).
   An audit's reproduction is a suite, not a folder beside the suites
   (LESSONS 636): this runs it inside the gate.

   For every finding, `reproduced` must be false - the defect is gone - and
   every control must keep passing. A finding still being repaired is named in
   OPEN, where it must still REPRODUCE: if one stops reproducing, this fails
   too, so the list cannot go stale - take it off when it is fixed. */
import { spawnSync } from 'child_process';
import { readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/* Still being repaired. Each must still reproduce until it is taken off. */
const OPEN = new Set(['STATE16-02', 'STATE16-03', 'STATE16-04', 'STATE16-05']);
const out = mkdtempSync(join(tmpdir(), 'b16-'));

for (const name of ['build16-state']) {
  section(name);
  const file = join(out, name + '.json');
  const r = spawnSync(process.execPath, [join(ROOT, 'tests/audit', name + '.mjs'), ROOT, file], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
  let res = null; try { res = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { res = null; }
  const list = (res && res.results) || [];
  ok(Array.isArray(list) && list.length >= 10, 'the reproductions ran and wrote their results', [r.status, (r.stderr || '').slice(-400)]);
  for (const c of list) {
    if (c.harnessError) { ok(false, c.id + ' ran without a harness error', c.harnessError); continue; }
    if ('controlPassed' in c) { ok(c.controlPassed === true, c.id + ' (control) ' + c.title, c); continue; }
    if (OPEN.has(c.id)) ok(c.reproduced === true, c.id + ' is still open (take it off OPEN once fixed): ' + c.title, c.reproduced);
    else ok(c.reproduced === false, c.id + ' ' + c.title, c);
  }
}

if (report('the-build-16-audit-stays-fixed') > 0) process.exitCode = 1;
done();
