/* EVERY WORKFLOW SCRIPT PARSES (Nov 1 audit follow-up).

   A deploy check once shipped with an unterminated quote: YAML was valid, the
   gate was green, and the deploy's readiness step died with a bash syntax
   error after the Worker was already live. Every `run:` block of every
   workflow is now handed to `bash -n` here, with the `${{ }}` expressions
   GitHub fills in replaced by a placeholder, so a script that cannot even be
   parsed never reaches main. */
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const WF = join(__dir, '..', '..', '.github', 'workflows');
const require = createRequire(import.meta.url);
let yaml = null; try { yaml = require('yaml'); } catch (e) { try { yaml = require('js-yaml'); } catch (e2) { yaml = null; } }

/* Without a YAML parser: take each `run: |` block by its indentation. */
function runBlocks(text) {
  if (yaml) {
    const doc = (yaml.parse || yaml.load)(text);
    const out = [];
    for (const [jn, job] of Object.entries((doc && doc.jobs) || {}))
      for (const st of (job.steps || [])) if (typeof st.run === 'string') out.push({ name: jn + ' / ' + (st.name || '?'), run: st.run, shell: st.shell || '' });
    return out;
  }
  const lines = text.split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*\|\s*$/.exec(lines[i]);
    if (!m) continue;
    const base = m[1].length; const body = [];
    let j = i + 1; let ind = null;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') { body.push(''); continue; }
      const k = l.length - l.trimStart().length;
      if (k <= base) break;
      if (ind === null) ind = k;
      body.push(l.slice(ind));
    }
    out.push({ name: 'line ' + (i + 1), run: body.join('\n'), shell: '' });
    i = j - 1;
  }
  return out;
}

section('Every run block of every workflow is valid shell');
{
  const dir = mkdtempSync(join(tmpdir(), 'amv-wf-'));
  const bad = []; let n = 0;
  for (const f of readdirSync(WF).filter(x => /\.ya?ml$/.test(x))) {
    for (const b of runBlocks(readFileSync(join(WF, f), 'utf8'))) {
      if (b.shell && !/bash|sh/.test(b.shell)) continue;
      n++;
      const script = b.run.replace(/\$\{\{[\s\S]*?\}\}/g, 'GHEXPR');
      const p = join(dir, 's' + n + '.sh'); writeFileSync(p, script);
      const r = spawnSync('bash', ['-n', p], { encoding: 'utf8' });
      if (r.status !== 0) bad.push(f + ' :: ' + b.name + ' :: ' + String(r.stderr).trim().split('\n')[0]);
    }
  }
  ok(n > 10, 'the run blocks were found', n);
  ok(bad.length === 0, 'and every one parses', bad);
}

if (report('every-workflow-script-parses') > 0) process.exitCode = 1;
done();
