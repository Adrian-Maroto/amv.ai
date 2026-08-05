/* A BUTTON THAT POINTS AT NOTHING.

   Most of this product's controls dispatch through one delegated handler: a
   `data-dact` attribute names a function, the document click listener looks it
   up on window, and calls it. When the name is right, the button works. When it
   is not - renamed function, typo, a control built for a function that never
   landed - the click does nothing at all. No error, no console warning, no
   visual difference. The button looks exactly like a working button.

   That is this codebase's signature defect in its purest form: complete,
   careful code on one side of a boundary with nothing on the other. Ten
   instances of the family have been fixed in this pass alone - a toggle writing
   to a record no cron read, a scheduler posting to a route that never existed,
   an approval whose server did nothing.

   Computing it today finds none: all sixty actions resolve. This is so the
   sixty-first does too.

   Ternaries are handled deliberately - `data-dact="${on?'stop':'start'}"` is
   two actions, not one, and reading it as one was the first false positive this
   check produced. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const all = bundle + '\n' + html;

/* Every action name a control can dispatch.

   The first version of this excluded quotes from the attribute value, which
   meant a ternary - whose branches ARE quoted strings - matched only up to its
   first inner quote and contributed nothing. It reported every action resolving
   while never having read the ternary ones at all, and passed a sabotage test
   that renamed one. A check that silently covers less than it claims is worse
   than no check, because it is believed. Both delimiters are handled, and the
   value runs to the matching one. */
function actions(src){
  const found = new Set();
  const add = (raw) => {
    if(/^[A-Za-z_$][\w$]*$/.test(raw)){ found.add(raw); return; }
    /* A template expression: every string literal inside it is a value the
       attribute can actually evaluate to. */
    for(const lit of raw.matchAll(/['"]([A-Za-z_$][\w$]*)['"]/g)) found.add(lit[1]);
  };
  for(const m of src.matchAll(/data-dact="([^"]*)"/g)) add(m[1]);
  for(const m of src.matchAll(/data-dact='([^']*)'/g)) add(m[1]);
  /* The escaped form, for markup built inside a JS string literal. */
  for(const m of src.matchAll(/data-dact=\\"([^\\]*)\\"/g)) add(m[1]);
  return found;
}

/* Everything reachable by name at runtime. The bundle is one plain script, so
   a top-level function declaration is a property of window. */
const defined = new Set([
  ...[...bundle.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]),
  ...[...bundle.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]),
]);

const acts = actions(all);

section('The controls and the functions were both found');
{
  ok(acts.size > 40, 'delegated actions were parsed', acts.size);
  ok(defined.size > 500, 'and the functions they could name', defined.size);
}

section('Every control points at something that exists');
{
  const dead = [...acts].filter(a => !defined.has(a)).sort();
  ok(dead.length === 0,
     'no button dispatches an action nothing implements', dead);
}

section('The dispatcher still resolves by name');
{
  /* If the delegation stopped looking names up on window, the check above would
     be measuring the wrong thing entirely. */
  /* Anchored on the DISPATCHER, not on the first mention of the attribute -
     the a11y labeller reads dataset.dact too, several hundred lines earlier,
     and anchoring there measured the wrong code entirely. */
  const at = bundle.indexOf("const fn=da.dataset.dact");
  ok(at > 0, 'the delegated click handler is present', at > 0);
  const near = bundle.slice(at, at + 260);
  ok(/window\[fn\]\s*\)\s*window\[fn\]\(/.test(near),
     'and calls the named function off window, which is what makes a wrong name silent', true);
  /* Two names are handled before the lookup and are not window properties, so
     they must never be reported dead by the check above. */
  ok(/fn==='askAmv'/.test(near) && /fn==='toastInfo'/.test(near),
     'with the two specially-cased actions still handled ahead of it', true);
}

section('Every other dispatch attribute resolves too');
{
  /* data-dact is one of five. The others name a settings pane, a tab, or an
     auth screen, and a wrong value in any of them is just as silent. */
  const gs   = new Set([...all.matchAll(/data-gs="([A-Za-z_-]+)"/g)].map(m => m[1]));
  const stab = new Set([...all.matchAll(/data-stab="([A-Za-z_-]+)"/g)].map(m => m[1]));
  ok(gs.size > 0 && stab.size > 0, 'the pane and tab controls were parsed', { gs: gs.size, stab: stab.size });

  /* A settings pane exists if the pane router handles it or the command palette
     registers it. */
  const panes = new Set([
    ...[...bundle.matchAll(/sp===['"]([A-Za-z_-]+)['"]/g)].map(m => m[1]),
    ...[...bundle.matchAll(/setNav\('set-[\w-]+',\s*'[^']*',\s*'([A-Za-z_-]+)'/g)].map(m => m[1]),
  ]);
  const deadPanes = [...gs].filter(p => !panes.has(p)).sort();
  ok(deadPanes.length === 0, 'no button opens a settings pane that does not exist', deadPanes);

  /* A tab exists if setTab knows how to render it. */
  const tabs = new Set([
    ...[...bundle.matchAll(/S\.tab===['"]([a-z-]+)['"]/g)].map(m => m[1]),
    ...[...bundle.matchAll(/t===['"]([a-z-]+)['"]/g)].map(m => m[1]),
    ...[...bundle.matchAll(/case\s*['"]([a-z-]+)['"]\s*:/g)].map(m => m[1]),
  ]);
  const deadTabs = [...stab].filter(t => !tabs.has(t)).sort();
  ok(deadTabs.length === 0, 'and no button opens a tab that does not exist', deadTabs);
}

section('And an inline onclick names a function that exists');
{
  /* The plan cards do not use delegation - they carry inline handlers - which
     is how the Ultra tier shipped a $200 buy button with no handler at all
     while looking identical to the three that worked. A misspelled name here is
     the same silence, one layer down. */
  const calls = new Set();
  for(const m of all.matchAll(/onclick="([A-Za-z_$][\w$.]*)\s*\(/g)) calls.add(m[1]);
  for(const m of all.matchAll(/onclick=\\"([A-Za-z_$][\w$.]*)\s*\(/g)) calls.add(m[1]);
  ok(calls.size > 3, 'the inline handlers were parsed', [...calls].slice(0, 12));
  const dead = [...calls]
    .filter(n => n.indexOf('.') < 0)        // window.foo() / S.x() resolve elsewhere
    .filter(n => !defined.has(n))
    .sort();
  ok(dead.length === 0, 'each one calls something that is defined', dead);

  /* AND THE RECEIVER HAS TO BE REACHABLE FROM GLOBAL SCOPE.

     Skipping every dotted call let a real dead control through: the overnight
     queue's delete button was `onclick="queue.splice(i,1);...renderQ()"`, and
     `queue` and `renderQ` are LOCAL to the function that wrote the markup. An
     inline handler attribute is compiled in the GLOBAL scope, so every click
     threw ReferenceError and the row never went away.

     So the object being called on is checked too - it has to be something the
     bundle actually declares at the top level, or a browser global. */
  const GLOBALS = new Set(['window', 'document', 'location', 'navigator', 'console',
                           'localStorage', 'sessionStorage', 'history', 'event', 'this',
                           'JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Date']);
  const receivers = new Set();
  for(const m of all.matchAll(/onclick=\\?"([A-Za-z_$][\w$]*)\./g)) receivers.add(m[1]);
  const unreachable = [...receivers]
    .filter(n => !GLOBALS.has(n))
    .filter(n => !defined.has(n))
    .sort();
  ok(unreachable.length === 0,
     'and the object it calls on is reachable from global scope', unreachable);
}

section('Every plan on the pricing page can actually be bought');
{
  /* The specific failure: `ultra` had no branch in the button builder and fell
     through to a plain <button> with nothing bound. Expressed as the rule
     rather than the instance - every tier the cards offer reaches checkout. */
  const at = bundle.indexOf('function planCards');
  const cards = bundle.slice(at, bundle.indexOf('\n}', bundle.indexOf('].join(\'\')', at)));
  /* Read off the PLAN argument, which is the third one and always sits
     immediately before isLand. The label used to be a plain string and was
     matched as one; it is now built from PLANS so the price cannot drift from
     checkout, and a matcher anchored on the label stopped seeing three of the
     four tiers - silently, which is the failure mode this whole file exists to
     catch. The plan argument is what the assertion is actually about. */
  const offered = [...cards.matchAll(/,'([a-z]+)',isLand\)/g)].map(m => m[1]);
  ok(offered.length >= 4, 'the tiers on the cards were found', offered);

  const builder = bundle.slice(at, at + 1600);
  const paid = offered.filter(p => p !== 'free');
  const unreachable = paid.filter(p => {
    /* Either named explicitly, or covered by the default that routes to
       checkout. The default is what makes the next tier safe. */
    const named = new RegExp("plan==='" + p + "'").test(builder);
    const byDefault = /return '<button class="plnbtn '[\s\S]{0,120}openCheckout\(\\'"?\+plan/.test(builder)
                   || /openCheckout\(\\''\+plan\+'\\'\)/.test(builder);
    return !named && !byDefault;
  });
  ok(unreachable.length === 0, 'no paid tier has a button that does nothing', unreachable);

  ok(!/return '<button class="plnbtn pbs">'/.test(builder),
     'and there is no handler-less fallback left to fall into', true);
}

section('A control inside a stopPropagation modal is not dispatched this way');
{
  /* LESSONS #5: a modal that stops propagation kills delegation for everything
     inside it, so those controls are bound directly instead. The picker modal
     is the known one - asserted so a future edit that switches it to data-dact
     does not produce buttons that are dead for a completely different reason. */
  const at = bundle.indexOf('hopick-modal');
  if(at > 0){
    const modal = bundle.slice(at, at + 1200);
    ok(!/data-dact=/.test(modal),
       'the handoff picker binds its rows directly, not through delegation', true);
  } else {
    ok(true, 'the handoff picker markup was not found to check', 'skipped');
  }
}

if (report('no-dead-controls') > 0) process.exitCode = 1;
done();
