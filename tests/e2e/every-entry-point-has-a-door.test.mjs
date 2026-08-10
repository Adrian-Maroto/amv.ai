/* SIXTEEN FUNCTIONS EXPORTED ON WINDOW THAT NOTHING COULD REACH.

   no-dead-controls asks one direction: every data-dact names a real function,
   so no button points at nothing. Nobody was asking the other direction -
   every function offered as an entry point is reached by something - and that
   is where the expensive one was hiding.

   runCanvasAutomation was on that list. Chasing it found the whole school
   feature with no door: a connect screen called from nowhere, a Connect button
   that told people to wait for an operator who had nothing to do, and a run
   control gated on a flag that could never be set. Every part finished, none
   of it reachable, and every test passing because each tested the feature and
   none tested the way in.

   The other fifteen were worth chasing too:

     _mktReport      the marketplace's report dialog - while the policy screen
                     promised buyers their reports were reviewed by a team
     cwApprove       removed an approval locally and said "Approved - sent"
                     without calling the server at all
     _pluginOn       a permission check whose whole body was `return true`
     _savePM         wrote a made-up payment token, so the payment-method row
                     it fed could never render and would have been fiction
     _startOnboarding a second first-run flow with its own storage key,
                     invisible beside the one people actually see

   Reporting was built. The rest were removed. This keeps the count at zero:
   an exported entry point is dispatched from somewhere, or it is named below
   with the reason it is not a UI entry point at all.

   Reads the built bundle, because what ships is what a person can reach. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');

/* Deliberately on window, and deliberately not a door. Each says which it is,
   because "internal API" is the excuse this check would rot into if it were
   allowed to be a bare list of names. */
const NOT_A_DOOR = {
  runAgentic:  'the agentic tool loop - an engine other code calls into, exposed so a surface can drive it without importing across module boundaries in a single-scope bundle',
  qDecompose:  'the quality module’s task splitter, same shape: engine, not screen',
  amvOpenFile: 'the file-open bridge the desktop and editor integrations call from outside the page, so by definition nothing inside the bundle references it',
};

/* A name is exported as an entry point when the bundle does window.X = X. */
const exported = [...new Set(
  [...bundle.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=\s*\1\s*[;,\n]/g)].map(m => m[1])
)];

/* Referenced means: mentioned somewhere that is neither its own definition nor
   its own export. A data-dact string, an onclick attribute, a direct call and
   a window[name] dispatch all count, because all four are ways a person gets
   there. */
const referencedElsewhere = (n) => {
  const defs = (bundle.match(new RegExp('function\\s+' + n + '\\b', 'g')) || []).length;
  const exps = (bundle.match(new RegExp('window\\.' + n + '\\s*=', 'g')) || []).length;
  const all  = (bundle.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length;
  return all - defs - exps * 2 > 0;
};

section('The bundle really does export entry points this way');
{
  ok(exported.length > 200, 'window exports were found', exported.length);
  ok(exported.includes('schoolOpen'), 'including the one this check was written for', true);
}

section('Every exported entry point is reached by something');
{
  const orphans = exported.filter(n => !referencedElsewhere(n) && !(n in NOT_A_DOOR)).sort();
  ok(orphans.length === 0,
     'nothing is offered as a way in that nothing can open', orphans);
}

section('And the exceptions are still exceptions');
{
  /* Two ways this list rots: a name on it that no longer exists, and a name on
     it that has since been wired - at which point it is an ordinary entry
     point and the excuse is just noise sitting where the next orphan will
     hide. */
  const gone = Object.keys(NOT_A_DOOR).filter(n => !exported.includes(n));
  ok(gone.length === 0, 'every exception still names something the bundle exports', gone);

  const nowWired = Object.keys(NOT_A_DOOR).filter(n => referencedElsewhere(n));
  ok(nowWired.length === 0,
     'and nothing excused as an engine has quietly become a screen', nowWired);

  const reasons = Object.values(NOT_A_DOOR).filter(r => String(r).length > 30);
  ok(reasons.length === Object.keys(NOT_A_DOOR).length,
     'each carries a reason rather than a shrug', reasons.length);
}

section('The ones that were found unreachable are gone or wired, by name');
{
  /* Named individually so a regression says WHICH, and because each was a
     different kind of wrong: a lie, a stub, a fiction, a duplicate. */
  const REMOVED = [
    ['cwApprove',        'said "Approved - sent" and called no server'],
    ['cwEdit',           'superseded by the approval panel'],
    ['cwTry',            'a prompt launcher with no launcher'],
    ['_pluginOn',        'a permission check whose body was return true'],
    ['_savePM',          'minted a fake payment token'],
    ['removePM',         'a remove button that did not exist'],
    ['openPaymentMethod','a payment-methods screen that does not exist'],
    ['disconnectGoogle', 'a second way to do what the Connectors list does'],
    ['_startOnboarding', 'a second first-run flow nobody saw'],
    ['codeStart',        'a launcher with no launcher'],
    ['hoFromChat',       'likewise'],
    ['_aiFailCard',      'an error card rendered by nothing'],
  ];
  const survivors = REMOVED.filter(([n]) => new RegExp('function\\s+' + n + '\\b').test(bundle))
    .map(([n, why]) => n + ' (' + why + ')');
  ok(survivors.length === 0, 'none of them is still in the bundle', survivors);

  /* And the one that was worth building rather than deleting. */
  ok(/function _mktReport/.test(bundle) && referencedElsewhere('_mktReport'),
     'reporting a listing was built and wired, not removed', true);
}

section('The plan gate reads the plan the server confirmed');
{
  /* verifiedPlan existed to answer "what plan, according to the server" and
     was called by nothing, while the gate deciding which engines somebody may
     pick read a value anybody can edit in a console. */
  const gate = (bundle.match(/function _planAllowsModel\([^)]*\)\s*\{[^}]*\}/) || [''])[0];
  ok(gate.length > 0, 'the gate was found', gate.length);
  ok(/verifiedPlan\(\)/.test(gate),
     'it asks verifiedPlan rather than reading local storage directly', gate.slice(0, 160));
}

if (report('every-entry-point-has-a-door') > 0) process.exitCode = 1;
done();
