/* data-dact IS RESOLVED BY NAME AT CLICK TIME, WHICH NOTHING CHECKS.

   The one delegated click handler ends with `else if(window[fn]) window[fn](arg)`.
   So a button carrying data-dact="openWorkspace" works only while a global of
   exactly that name exists. Rename the function, drop its `window.x = x`
   export, or convert `function x(){}` to `const x = () => {}` at the top level
   of the bundle - which does NOT create a window property - and the button
   stops doing anything. No error, no console line, no failing test: the guard
   is `if(window[fn])`, so a missing name is silently the same as a click that
   was not meant to do anything.

   That is the defect shape this product keeps producing - correct at both
   ends, not joined in the middle - and on this path it is entirely mechanical
   to check, so it should never have to be found by hand again.

   WHY THIS IS A RUNTIME CHECK. The obvious static version - grep the ids out
   of the markup, grep the handlers out of the source - has a blind spot big
   enough to make it useless: ids and handler names are routinely passed as
   ARGUMENTS (_sectionModelSelect('code','dev-model'), capToggle('cap-memory',
   ...)), so a static scan reports fifteen live controls as dead. Asking the
   booted page whether window[name] is callable has no such blind spot. */
import { readFileSync } from 'fs';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

/* Read the names out of the SHIPPED artifact, not the sources, because that is
   what a browser is handed - and a build that dropped a button would otherwise
   pass by having nothing to check. */
const shipped = readFileSync('index.html', 'utf8') + '\n' + readFileSync('app.js', 'utf8');
const names = [...new Set([...shipped.matchAll(/data-dact=["']([a-zA-Z0-9_$-]+)["']/g)].map(m => m[1]))].sort();

const app = await bootApp({ tab: 'chat', user: { name: 'T', email: 't@x.com', ini: 'T' } });
const { page, errors } = app;

section('There is something to check');
{
  ok(names.length > 40, 'the shipped page carries a real number of delegated buttons', names.length);
  /* If the dispatcher stops resolving by name this test is measuring nothing,
     so prove the mechanism is still the one described above. */
  const live = await page.evaluate(() => {
    let fired = '';
    window.__amvProbeAction = (a) => { fired = 'ran:' + a; };
    const b = document.createElement('button');
    b.setAttribute('data-dact', '__amvProbeAction');
    b.setAttribute('data-darg', 'x');
    document.body.appendChild(b);
    b.click();
    b.remove();
    delete window.__amvProbeAction;
    return fired;
  });
  ok(live === 'ran:x', 'and a data-dact button really is dispatched through window[name]', live);
}

section('Every delegated button names something that exists');
{
  const dead = await page.evaluate(ns => ns.filter(n => typeof window[n] !== 'function'), names);
  ok(dead.length === 0,
     'no button on the shipped page would silently do nothing when pressed', dead);
}

section('And a name that does not exist would be caught');
{
  /* The negative control. Without it a bug that made the check always pass -
     an empty name list, a filter that never matches - would read as green. */
  const caught = await page.evaluate(() =>
    ['__amvDefinitelyNotAFunction'].filter(n => typeof window[n] !== 'function'));
  ok(caught.length === 1, 'a made-up handler name is reported, so the check can fail', caught);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('every-delegated-button-resolves') > 0) process.exitCode = 1;
done();
