import { sayLine } from './say.mjs';
/* Minimal assertions + reporting. No dependencies beyond Playwright itself,
   so the suite stays runnable anywhere with `node`. */

let passed = 0, failed = 0;
const failures = [];

export function ok(cond, label, detail) {
  if (cond) {
    passed++;
    sayLine(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed++;
    failures.push(label);
    sayLine(`  \x1b[31m✗\x1b[0m ${label}`);
    if (detail !== undefined) sayLine(`      got: ${JSON.stringify(detail)}`);
  }
  return cond;
}

export function eq(actual, expected, label) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  return ok(same, label, same ? undefined : { actual, expected });
}

export function section(name) {
  sayLine(`\n\x1b[1m${name}\x1b[0m`);
}

export function report() {
  sayLine('');
  if (failed === 0) {
    sayLine(`\x1b[32m${passed} passed, 0 failed\x1b[0m`);
  } else {
    sayLine(`\x1b[31m${passed} passed, ${failed} FAILED\x1b[0m`);
    failures.forEach(f => sayLine(`  \x1b[31m- ${f}\x1b[0m`));
  }
  return failed;
}

export function done() {
  const code = failed > 0 ? 1 : 0;
  process.exit(code);
}
