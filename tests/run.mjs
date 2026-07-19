#!/usr/bin/env node
/* Runs every test suite and exits non-zero if anything fails.
   Usage:
     node tests/run.mjs            # everything
     node tests/run.mjs security   # only suites matching "security"
*/
import { spawn } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const filter = process.argv[2] || '';

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('\x1b[31mindex.html not found. Run `node build.mjs` first.\x1b[0m');
  process.exit(1);
}

const suites = [];
for (const dir of ['e2e', 'worker']) {
  const p = join(__dir, dir);
  if (!existsSync(p)) continue;
  for (const f of readdirSync(p)) {
    if (f.endsWith('.test.mjs') && f.includes(filter)) {
      suites.push({ name: `${dir}/${f}`, path: join(p, f) });
    }
  }
}

if (!suites.length) {
  console.error(`No suites matched "${filter}"`);
  process.exit(1);
}

const run = (s) => new Promise((resolve) => {
  console.log(`\n\x1b[1m\x1b[36m━━━ ${s.name} ━━━\x1b[0m`);
  const p = spawn('node', [s.path], { stdio: 'inherit', cwd: ROOT });
  p.on('close', (code) => resolve({ name: s.name, code }));
});

const results = [];
for (const s of suites) results.push(await run(s));

const failed = results.filter(r => r.code !== 0);
console.log('\n\x1b[1m════════ SUMMARY ════════\x1b[0m');
results.forEach(r => {
  console.log(r.code === 0
    ? `  \x1b[32m✓ ${r.name}\x1b[0m`
    : `  \x1b[31m✗ ${r.name}\x1b[0m`);
});

if (failed.length) {
  console.log(`\n\x1b[31m${failed.length} suite(s) FAILED\x1b[0m`);
  process.exit(1);
}
console.log(`\n\x1b[32mAll ${results.length} suites passed\x1b[0m`);
