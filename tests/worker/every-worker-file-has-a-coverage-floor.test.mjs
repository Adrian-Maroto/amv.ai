/* EVERY WORKER FILE HAS A COVERAGE FLOOR (Nov 3 audit TEST-004).

   CI runs `node scripts/coverage.mjs --enforce`, which fails when a Worker
   file has no floor in docs/coverage-floors.json. The local gate does not run
   coverage (it takes minutes more), so a new file passed here and failed in
   CI, and the deploy waited. This is the cheap half, run by the gate: every
   file in src/worker/ has a floor, and no floor names a file that is gone.
   The measurement itself stays in CI. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const floors = JSON.parse(readFileSync(join(ROOT, 'docs', 'coverage-floors.json'), 'utf8')).files || {};
const files = readdirSync(join(ROOT, 'src', 'worker')).filter(f => f.endsWith('.js'));

section('Every Worker file has a floor, and every floor a file');
{
  const missing = files.filter(f => !(f in floors));
  ok(files.length > 50, 'the Worker’s files were found', files.length);
  ok(missing.length === 0, 'none is without a floor - run node scripts/coverage.mjs --update-floors and commit docs/coverage-floors.json', missing);
  const gone = Object.keys(floors).filter(f => !files.includes(f));
  ok(gone.length === 0, 'and no floor is left for a file that is gone', gone);
  const bad = Object.entries(floors).filter(([, v]) => !(Number.isFinite(v) && v >= 0 && v <= 100));
  ok(bad.length === 0, 'each floor is a percentage', bad);
}

report();
done();
