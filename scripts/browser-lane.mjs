#!/usr/bin/env node
/* THE SAME SUITES IN SAFARI'S AND FIREFOX'S ENGINES.

   Every browser suite runs in Chromium. People use Safari - on every iPhone it
   is the only engine there is - and Firefox, and AMV already carries comments
   about Safari-specific cookie behaviour: a Chromium-only matrix cannot see
   any of that.

   `node scripts/browser-lane.mjs --engine=webkit` (or firefox) runs every
   e2e suite that can run in another engine - the ones that drive the page
   through the shared harnesses and use nothing Chromium-only (CDP sessions,
   virtual authenticators, a direct `chromium` launch) - with AMV_BROWSER set,
   and reports which pass.

   A RATCHET, NOT A WALL. Nobody knows yet what fails in WebKit; a lane that
   went red on day one for every one of those would be switched off by the
   end of the week. So it fails only on a REGRESSION: a suite listed as
   passing in tests/browser-lanes.json for that engine that no longer does.
   Everything else is reported - what passes, what fails, and the suites
   newly passing that can be added to the list - so the list only grows.

   Options: --engine=webkit|firefox (required), --jobs=N (default 3),
   --only=<substring> for a subset, --update to write the newly passing suites
   into the list. */
import { spawn } from 'child_process';
import { readFileSync, readdirSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const ENGINE = arg('engine', '');
/* chromium is accepted too, so the runner itself can be checked on a machine
   with only Chromium installed. */
if (!['webkit', 'firefox', 'chromium'].includes(ENGINE)) { console.error('--engine=webkit or --engine=firefox'); process.exit(2); }
const ONLY = arg('only', '');
const JOBS = Math.max(1, Number(arg('jobs', 3)) || 3);
const UPDATE = process.argv.includes('--update');
const LIST = join(ROOT, 'tests', 'browser-lanes.json');

/* What can run in another engine at all. Read from the suite's own source: a
   CDP session, a virtual authenticator or a direct chromium launch are
   Chromium's alone, and running those elsewhere would report the engine,
   not AMV. */
const CHROMIUM_ONLY = /newCDPSession|WebAuthn\.|chromium\.launch|from 'playwright'|from "playwright"/;
const DIR = join(ROOT, 'tests', 'e2e');
const all = readdirSync(DIR).filter(f => f.endsWith('.test.mjs')).sort();
const eligible = all.filter(f => f.includes(ONLY) && !CHROMIUM_ONLY.test(readFileSync(join(DIR, f), 'utf8')));

const listed = (() => { try { return JSON.parse(readFileSync(LIST, 'utf8')); } catch (e) { return {}; } })();
const passingBefore = new Set((listed[ENGINE] || []).filter(f => eligible.includes(f)));

console.error(ENGINE + ': ' + eligible.length + ' of ' + all.length + ' browser suites can run here; running ' + JOBS + ' at a time…');
const results = {};
let next = 0, n = 0;
await new Promise((resolve) => {
  const one = () => {
    if (next >= eligible.length) { if (n === eligible.length) resolve(); return; }
    const s = eligible[next++];
    const p = spawn(process.execPath, [join('tests', 'e2e', s)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, AMV_BROWSER: ENGINE } });
    let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    const kill = setTimeout(() => p.kill('SIGKILL'), 240000);
    p.on('exit', (code) => {
      clearTimeout(kill);
      /* The first failing assertion, so the summary says WHAT broke. */
      const lines = out.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
      const at = lines.findIndex(l => /✗|Error:|TypeError|Timeout/.test(l));
      /* And what it got, when the assertion said: "zero uncaught page errors"
         alone does not say which error, and that is the part to fix. */
      const got = at >= 0 && /^\s*got:/.test(lines[at + 1] || '') ? ' - ' + lines[at + 1].trim() : '';
      const first = at < 0 ? '' : (lines[at].trim() + got).slice(0, 400);
      /* What the engine said, for a failing suite: the first few console
         errors (harness.mjs prints them in these lanes). */
      const said = [...new Set(lines.filter(l => /\[(webkit|firefox) console\]/.test(l)).map(l => l.replace(/^.*console\]\s*/, '').slice(0, 200)))].slice(0, 4);
      if (code !== 0 && said.length) results[s] = { ok: false, first, said };
      if (!results[s]) results[s] = { ok: code === 0, first };
      n++; process.stderr.write('\r[' + n + '/' + eligible.length + ']'); one();
    });
  };
  for (let i = 0; i < Math.min(JOBS, eligible.length); i++) one();
  if (!eligible.length) resolve();
});
console.error('');

const pass = eligible.filter(s => results[s] && results[s].ok);
const fail = eligible.filter(s => !(results[s] && results[s].ok));
const regressed = [...passingBefore].filter(s => !pass.includes(s));
const newly = pass.filter(s => !passingBefore.has(s));

let md = '## ' + ENGINE + ': ' + pass.length + ' of ' + eligible.length + ' suites pass\n\n'
  + (regressed.length ? '**Regressed** (passed before, fail now):\n' + regressed.map(s => '- `' + s + '`: ' + (results[s].first || 'failed')).join('\n') + '\n\n' : 'No regressions.\n\n')
  + (newly.length ? 'Newly passing - add with `--update`:\n' + newly.map(s => '- `' + s + '`').join('\n') + '\n\n' : '')
  + (fail.length ? '<details><summary>Failing in ' + ENGINE + ' (' + fail.length + ')</summary>\n\n' + fail.map(s => '- `' + s + '`: ' + (results[s].first || 'failed') + ((results[s].said || []).length ? '\n  - the browser said: ' + results[s].said.map(x => '`' + x.replace(/`/g, "'") + '`').join('; ') : '')).join('\n') + '\n\n</details>\n' : '');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
if (UPDATE) {
  listed[ENGINE] = [...new Set([...passingBefore, ...newly])].filter(s => pass.includes(s) || passingBefore.has(s)).sort();
  writeFileSync(LIST, JSON.stringify(listed, null, 2) + '\n');
  console.error('wrote ' + listed[ENGINE].length + ' ' + ENGINE + ' suites to tests/browser-lanes.json');
}
process.exit(regressed.length ? 1 : 0);
