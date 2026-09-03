/* "LOAD STATS" DID NOTHING, ON A DEPLOYMENT THAT WAS CORRECTLY CONFIGURED.

   The owner pressed it and the button appeared dead. It was not dead: it read
   `loadStr('amv_api_base')`, found nothing, and returned early with "connect
   your backend first".

   That key is the PER-DEVICE OVERRIDE - what somebody types in Settings to
   point one browser at a staging Worker. It is empty on every normal visit,
   because a configured deployment carries its address in a meta tag the build
   writes. So the check asked the one place the answer is never kept.

   Twenty-four call sites had it, and each failed as a dead control rather than
   an error: the founder dashboard's stats, the go-live readiness panel - the
   very screen the owner was sent to in order to check their configuration - the
   admin surfaces, family, finance, compliance, the embed widget (which fell
   back to its own origin, so it called amv.homes instead of the Worker), and
   the API docs, which printed `https://your-worker.workers.dev` to somebody who
   has a real one.

   `apiBase()` resolves it the way AMV_API.base does: override first, then the
   address the build shipped. This file holds the line - nothing outside core
   reads the raw key again. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src', 'app');
const files = readdirSync(SRC).filter(f => f.endsWith('.js')).sort();

section('Only the resolver reads the per-device override');
{
  const offenders = [];
  for (const f of files) {
    const text = readFileSync(join(SRC, f), 'utf8');
    /* Strip comments so the paragraph above - which quotes the key in order to
       explain it - cannot be mistaken for a use of it. */
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const uses = (code.match(/loadStr\('amv_api_base'\)/g) || []).length;
    if (!uses) continue;
    /* 01-core owns the resolution: the AMV_API.base getter and apiBase(). */
    if (f.startsWith('01-core')) {
      ok(uses === 2, 'core resolves the address in exactly two places', { file: f, uses });
      continue;
    }
    offenders.push({ file: f, uses });
  }
  ok(offenders.length === 0,
     'no other module reads the override directly - they call apiBase()', offenders);
}

section('And the resolver falls back to the address the build shipped');
{
  const core = readFileSync(join(SRC, '01-core.js'), 'utf8');
  const i = core.indexOf('function apiBase(');
  const body = i > 0 ? core.slice(i, i + 400) : '';
  ok(body.length > 0, 'apiBase exists');
  ok(/loadStr\('amv_api_base'\)\s*\|\|\s*_defaultApiBase\(\)/.test(body),
     'override first, then the meta tag the build writes');
  ok(/window\.apiBase\s*=\s*apiBase/.test(core),
     'and it is reachable from every module in the bundle');
}

section('The controls that went dead now ask the resolver');
{
  /* BY FUNCTION NAME, NOT BY POSITION.

     The first version of this searched the minified bundle for a message and
     read the 2500 characters after it. "Checking your deployment" appears
     twice - the go-live panel renders it and so does the admin surface - so
     indexOf found the other one and reported a fix that was in place as
     missing. Anchoring a check on where something happens to sit in a minified
     file is the defect this project keeps rediscovering; a function has a name,
     so use it. */
  const read = (f) => readFileSync(join(SRC, f), 'utf8');
  const bodyOf = (text, needle) => {
    const i = text.indexOf(needle);
    return i < 0 ? '' : text.slice(i, i + 1600);
  };
  const CONTROLS = [
    ['12-handoff.js', 'async function _loadReadiness', 'the go-live status panel'],
    ['12-handoff.js', 'const loadStats=async()=>', "the founder dashboard's Load stats"],
    ['08-admin-fraud.js', 'async function _admFetchStats', 'the admin stats surface'],
  ];
  for (const [file, needle, label] of CONTROLS) {
    const body = bodyOf(read(file), needle);
    ok(body.length > 0, label + ' was found by name', needle);
    if (body.length) {
      ok(/apiBase\(\)/.test(body), label + ' resolves the address', label);
      ok(!/loadStr\('amv_api_base'\)/.test(body),
         label + ' does not read the per-device override', label);
    }
  }
}

if (report() > 0) process.exitCode = 1;
done();
