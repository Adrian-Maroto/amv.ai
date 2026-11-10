/* THE BUILD-13 AUDIT STAYS FIXED.

   tests/audit/build13-integrity.mjs is the auditor's own reproduction of what
   they found in build 13 - restored sessions treated as local-only, a
   malformed spending total stored as zero, a failed bank refresh shown as
   "not linked", a reservation released against the wrong month, generic
   browser writes treated as safe by their label, a registry entry that could
   smuggle a launch argument. It lived outside the runner, so nothing ran it;
   the first time it was run after a revert, three of its findings were back.
   It is run here, unchanged, on every gate (LESSONS 634: keep the auditor's
   reproduction as a permanent suite). */
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
section('Every finding in the build-13 reproduction is still fixed');
const r = spawnSync(process.execPath, [join(ROOT, 'tests', 'audit', 'build13-integrity.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
let res = null;
try { res = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch (e) {}
const tests = (res && res.results) || [];
ok(tests.length >= 20, 'the reproduction ran and reported its scenarios', tests.length || (r.stderr || '').slice(0, 300));
for (const t of tests) ok(t.pass === true, t.id + ': ' + t.name, t.evidence);
ok(r.status === 0, 'and it exits cleanly', r.status);
report();
done();
