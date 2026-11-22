/* Every place the Worker turns a failure into an answer, counted per function.

   Two shapes: a `catch` that returns a value (null, false, [], a default
   object, a refusal) and a `catch` with nothing in it. Most are right - a
   stream cancelled during cleanup, a log line that must never decide
   anything, a parse that falls back to the strict answer. Some were not: a
   year of payouts read as $0 when storage failed, a kill switch read as off,
   a cookie defence handing back the request untouched (failure sweep, Nov 22).

   The difference cannot be told by a pattern, only by reading. So the
   baseline in docs/silenced-failures.json records how many each function had
   when they were read, and check.mjs fails when a function gains one: the
   new one is read, and the baseline is raised on purpose with `--write`.

     node scripts/silenced-failures.mjs           print the counts
     node scripts/silenced-failures.mjs --write   record them as read */
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = join(ROOT, 'docs', 'silenced-failures.json');

export function silencedFailures(root = ROOT) {
  const dir = join(root, 'src', 'worker');
  const RET = /catch\s*\(\s*[\w$]*\s*\)\s*\{\s*return\b[^;{}]*;?\s*\}/g;
  const EMPTY = /catch\s*\(\s*[\w$]*\s*\)\s*\{\s*\}/g;
  const DEF = /^(?:async\s+)?function\s+([\w$]+)|^const\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\(|function)|^\s{2}(?:async\s+)?([\w$]+)\s*\([^)]*\)\s*\{\s*$/;
  const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'return']);
  const out = {};
  for (const f of readdirSync(dir).filter(x => x.endsWith('.js')).sort()) {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n');
    lines.forEach((l, i) => {
      const n = (l.match(RET) || []).length + (l.match(EMPTY) || []).length;
      if (!n) return;
      let fn = '(top)';
      for (let j = i; j >= 0; j--) { const d = DEF.exec(lines[j]); if (d && !KEYWORDS.has(d[1] || d[2] || d[3])) { fn = d[1] || d[2] || d[3]; break; } }
      const k = f + ':' + fn;
      out[k] = (out[k] || 0) + n;
    });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const now = silencedFailures();
  const total = Object.values(now).reduce((a, b) => a + b, 0);
  if (process.argv.includes('--write')) {
    writeFileSync(BASELINE, JSON.stringify({
      note: 'Silenced failures in src/worker, per function, as last read by a person. '
        + 'check.mjs fails when a function gains one. Read the new one: if it turns a failure '
        + 'into an answer that grants, sends, spends or skips a check, fix it; if it is cleanup, '
        + 'logging or the strict answer, run node scripts/silenced-failures.mjs --write.',
      read: new Date().toISOString().slice(0, 10), total, sites: now }, null, 1) + '\n');
    console.log('recorded ' + total + ' in ' + Object.keys(now).length + ' functions');
  } else {
    for (const [k, v] of Object.entries(now)) console.log(String(v).padStart(3) + '  ' + k);
    console.log(total + ' in ' + Object.keys(now).length + ' functions');
  }
}
