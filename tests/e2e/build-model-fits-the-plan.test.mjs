/* THE BUILD SURFACES DEFAULTED TO AN ENGINE MOST ACCOUNTS CANNOT RUN.

   Dev, Lab and Studio each let you pick which engine does the work, and each
   defaulted to Apex. Apex requires Elite - the worker enforces minPlan on every
   request and returns 402 plan_required, which is correct of it.

   So a free account opened Dev, saw "Apex . heaviest" on the chip at the top of
   the screen, typed a request, and got a plan error. Three whole surfaces dead
   on the tier that has the most people on it, with the cause printed in the
   corner in a colour nobody reads as an error.

   Chat never had this: _routeModel picks the best engine the plan allows. The
   build sections bypassed it by keeping their own defaults - and there were
   two such defaults, _BUILD_MODEL for the panel pickers and _SECTION_DEFAULTS
   for the chip and for what the agentic runner is actually handed. Fixing one
   would have moved the failure rather than ended it.

   The picker still offers every tier. Choosing one above the plan runs the best
   one below it instead of failing, which is what the router has always done. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFile } from 'node:fs/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');

/* What the SERVER will accept, read from the worker so the two cannot drift. */
const RANK = { free: 0, pro: 1, elite: 2, ultra: 3, custom: 3, team: 2 };
const engineMinPlan = {};
for (const m of worker.matchAll(/'(amv-[a-z]+)':\s*\{[^}]*minPlan:\s*'([a-z]+)'/g)) engineMinPlan[m[1]] = m[2];

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

section('The worker’s own plan floors were read');
{
  ok(Object.keys(engineMinPlan).length >= 4, 'every engine has a minimum plan', engineMinPlan);
  ok(engineMinPlan['amv-apex'] === 'elite', 'and Apex is an Elite engine', engineMinPlan['amv-apex']);
}

section('No plan is handed an engine the server will refuse');
{
  /* The whole property, over every plan and every build surface. */
  const SURFACES = ['dev', 'lab', 'studio'];
  const bad = [];
  for (const plan of ['free', 'pro', 'elite', 'ultra']) {
    const got = await page.evaluate(({ p, surfaces }) => {
      saveStr('amv_plan', p);
      const out = {};
      surfaces.forEach(s => {
        out[s] = { build: _buildModelStr(s), section: _sectionModel(s === 'dev' ? 'code' : s) };
      });
      return out;
    }, { p: plan, surfaces: SURFACES });

    for (const s of SURFACES) {
      for (const [which, engine] of Object.entries(got[s])) {
        const floor = engineMinPlan[engine];
        if (floor && RANK[plan] < RANK[floor]) bad.push(`${plan}/${s}/${which} -> ${engine} (needs ${floor})`);
      }
    }
  }
  ok(bad.length === 0, 'every default runs on the plan that gets it', bad);
}

section('A free account gets the best engine it can actually run');
{
  /* Not merely "something legal" - clamping to the cheapest would quietly
     downgrade everybody's work. */
  const r = await page.evaluate(() => {
    saveStr('amv_plan', 'free');
    return { dev: _buildModelStr('dev'), chip: _sectionModel('code') };
  });
  ok(r.dev === 'amv-core', 'the panel picker resolves to Core', r.dev);
  /* THE CHIP SAYS 'auto', AND THAT IS THE POINT NOW.

     This asserted the chip resolves to a concrete engine, because it was
     written when the Build sections defaulted to `smart` - Apex, the dearest
     engine in the product - for everybody who never opened the picker. That
     was the single largest lever on model spend here and it is gone: the
     defaults are `auto`, and `_planAllowedModel` returns it untouched rather
     than clamping it onto a named engine.

     So the chip naming Core would now be the bug. `auto` is what will run, the
     server routes it for real, and the section below checks the chip still
     names a concrete engine the moment somebody chooses one. */
  ok(r.chip === 'auto', 'and the chip says auto, because that is what is set', r.chip);
}

section('An Elite account still gets Apex');
{
  const r = await page.evaluate(() => {
    saveStr('amv_plan', 'elite');
    return { dev: _buildModelStr('dev'), chip: _sectionModel('code') };
  });
  ok(r.dev === 'amv-apex', 'nothing was clamped that did not need to be', r.dev);
  ok(r.chip === 'auto', 'and the chip is still on auto, which Elite also defaults to', r.chip);
}

section('Auto is safe from every plan, which is what makes it a safe default');
{
  /* The missing half. Making `auto` the default across the Build sections is
     only correct if the server never refuses it, and nothing here checked
     that - the claim lived in this file and its enforcement lived in the
     worker, which is how a default becomes a 402 for every free account.

     Read from the worker rather than restated: `auto` is routed rather than
     aliased, the router caps to `amv-core` for anybody whose rank is below the
     engine's floor, and the plan check downstream runs on the ROUTED key. So
     a free account sending `auto` cannot be handed an engine it may not have. */
  const worker = await readFile(new URL('../../amv-backend.js', import.meta.url), 'utf8');
  ok(/rawModel === 'auto' \|\| rawModel === 'amv-auto'/.test(worker),
     'the worker recognises auto rather than treating it as an unknown engine');
  const router = worker.slice(worker.indexOf('function _autoRoute('),
                              worker.indexOf('function _autoRoute(') + 1600);
  /* Anchored on the comparison and the value it returns, not on the sentence
     above them. The first version of this matched the comment that explains the
     cap - so deleting the comment would have failed the check, and gutting the
     cap while leaving the comment would have passed it. Which is the whole
     failure this repo keeps a meta-check for, and it caught me. */
  ok(/rank\s*<\s*PLAN_RANK\[ENGINES\[k\]\.minPlan\]/.test(router)
     && /return 'amv-core'/.test(router),
     'and the router caps its own choice to the plan before returning it');
  ok(/const key = routed \? routed\.key/.test(worker),
     'and the plan check downstream runs on the routed engine, not the word auto');
}

section('Choosing a tier above the plan runs, rather than failing');
{
  /* The picker is not filtered - somebody on Pro can select Apex, and the point
     is that it works on the best engine they have instead of erroring. */
  const r = await page.evaluate(() => {
    saveStr('amv_plan', 'pro');
    _setSectionModel('code', 'smart');            // Apex, above Pro
    return { resolved: _sectionModel('code'), stored: loadStr('amv_secmodel_code') };
  });
  ok(r.stored === 'smart', 'the choice is remembered', r.stored);
  ok(r.resolved === 'amv-forge', 'and runs on the best engine Pro has', r.resolved);
}

section('The chip names what will actually run');
{
  /* The chip saying Apex while the request went out as something else would be
     the same lie in the other direction. */
  const r = await page.evaluate(() => {
    saveStr('amv_plan', 'free');
    _setSectionModel('code', 'smart');
    const html = _sectionModelSelect('code', 'probe-sel');
    const selected = (html.match(/<option value="([a-z]+)" selected>/) || [])[1];
    return { selected, resolved: _sectionModel('code') };
  });
  ok(r.selected === 'core', 'the control shows the engine that will run', r.selected);
  ok(r.resolved === 'amv-core', 'which is the one the request carries', r.resolved);
}

section('A custom plan is left alone');
{
  /* Its allowance is negotiated per account and the client cannot compute it,
     so the server decides - same rule as the image caps. */
  const r = await page.evaluate(() => {
    saveStr('amv_plan', 'custom');
    _setSectionModel('code', 'smart');
    return _sectionModel('code');
  });
  ok(r === 'amv-apex', 'nothing is clamped away from a custom account', r);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('build-model-fits-the-plan') > 0) process.exitCode = 1;
done();
