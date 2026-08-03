/* ONE PLACE DECIDES WHICH ENGINE RUNS.

   The tier table exists so that switching to a cheaper provider is one edit.
   Three worker paths hardcoded a model id instead and therefore ignored it:

     - the browser agent's per-step decision, which runs up to WEB_MAX_STEPS
       times in a single browser run;
     - the SMS agent;
     - the chat default when the client sends no engine.

   So retuning the tiers missed exactly the paths that fire most often, and the
   highest-frequency call in the product was pinned to whatever literal happened
   to be typed at the call site. This is a standing check: a model id may appear
   in the tier table and in the alias map that translates old client strings,
   and nowhere else. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');

/* The two blocks a model id is allowed to live in. */
const enginesAt = src.indexOf('const ENGINES = {');
const aliasEnd = src.indexOf('const PLAN_RANK');
const allowed = src.slice(enginesAt, aliasEnd);

section('A model id appears only where the tiers are defined');
{
  const lines = src.split('\n');
  const offenders = [];
  lines.forEach((line, i) => {
    const at = src.split('\n').slice(0, i).join('\n').length;
    if (at >= enginesAt && at < aliasEnd) return;      // inside the allowed block
    if (/['"]claude-[a-z0-9.-]+['"]/.test(line)) offenders.push((i + 1) + ': ' + line.trim().slice(0, 90));
  });
  ok(offenders.length === 0,
     'no call site pins its own engine behind the tier table\'s back', offenders);
}

section('The helper reads the table rather than repeating it');
{
  ok(/function engineModel\(key\)/.test(src), 'there is one accessor', true);
  const body = src.slice(src.indexOf('function engineModel(key)'), src.indexOf('function engineModel(key)') + 220);
  ok(/ENGINES\[key\]/.test(body), 'and it reads ENGINES', true);
  /* An unknown tier must resolve to a real engine, not undefined - a model of
     `undefined` reaches the provider as a malformed request. */
  ok(/ENGINES\['amv-core'\]/.test(body), 'falling back to a real tier for an unknown key', true);
}

section('The paths that fire most often go through it');
{
  const fn = (name) => {
    const at = src.indexOf('async function ' + name);
    if (at < 0) return '';
    const rest = src.slice(at + 1);
    const ends = [rest.indexOf('\nasync function '), rest.indexOf('\nfunction ')].filter(x => x >= 0);
    return ends.length ? src.slice(at, at + 1 + Math.min(...ends)) : src.slice(at);
  };
  ok(/engineModel\('amv-pulse'\)/.test(fn('_webAskModel')),
     'the browser agent\'s per-step decision reads the cheap tier from the table', true);
  ok(/engineModel\('amv-pulse'\)/.test(fn('runSmsAgent')),
     'and so does SMS', true);
}

section('The tier table still covers every engine the client can ask for');
{
  const keys = [...allowed.matchAll(/'(amv-[a-z]+)':\s*\{/g)].map(m => m[1]);
  ok(keys.length === 4, 'four tiers', keys);
  /* Every alias target must be a tier that exists, or a client sending an old
     string resolves to nothing. */
  const targets = [...allowed.matchAll(/:\s*'(amv-[a-z]+)',?/g)].map(m => m[1]);
  const unknown = [...new Set(targets)].filter(t => !keys.includes(t));
  ok(unknown.length === 0, 'and every alias points at one of them', unknown);
}

if (report('engine-single-source') > 0) process.exitCode = 1;
done();
