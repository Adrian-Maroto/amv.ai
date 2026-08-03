/* A NEW TOOL MUST NOT ARRIVE UNGATED.

   A model-requested tool that executes code or publishes to the internet needs
   the user's explicit permission, because the request can come from content the
   model READ rather than from anything the person asked for. That gate exists
   and is correctly wired.

   What it is not, is self-maintaining. `_TOOL_CONSENT` is a hand-written list of
   three names. The next side-effecting tool somebody adds - and the whole point
   of the tool layer is that more get added - runs ungated by default, and
   nothing in the codebase notices. The gate stays correct while the list rots.

   So this asserts the RULE rather than the list: a tool whose implementation
   runs code, publishes, or writes to the user's machine must be in the consent
   map. It reads the built bundle, which is what actually ships. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');

/* The declared tools, and the consent map, as they ship. */
const toolNames = [...bundle.matchAll(/\n\s*name:'([a-z_]+)',\n\s*description:'/g)].map(m => m[1]);
const consentAt = bundle.indexOf('const _TOOL_CONSENT');
const consentSrc = bundle.slice(consentAt, bundle.indexOf('\n', consentAt));
const consented = new Set([...consentSrc.matchAll(/([a-z_]+)\s*:\s*true/g)].map(m => m[1]));

/* The body of each tool's branch inside the dispatcher, so what it DOES can be
   inspected rather than assumed from its name. */
function toolBody(name){
  const at = bundle.indexOf("if(name==='" + name + "'){");
  if(at < 0) return '';
  // Up to the next tool branch, or the dispatcher's catch.
  const rest = bundle.slice(at + 10);
  const ends = [...rest.matchAll(/\n    if\(name===|\n  \}catch\(e\)\{/g)].map(m => m.index);
  return ends.length ? bundle.slice(at, at + 10 + Math.min(...ends)) : bundle.slice(at, at + 4000);
}

section('The tools that ship are the ones this checks');
{
  ok(toolNames.length >= 5, 'the tool list was found and parsed', toolNames);
  ok(consented.size >= 3, 'and so was the consent map', [...consented]);
}

section('Anything that executes or publishes is gated');
{
  /* What counts as needing permission, expressed as what the code does:
     running code on the person's device, or putting something on the internet
     under their name. */
  const DANGEROUS = /runCode\(|autoDebug\(|_deployApi\(/;
  const ungated = toolNames.filter(n => DANGEROUS.test(toolBody(n)) && !consented.has(n));
  ok(ungated.length === 0,
     'no tool runs code or publishes without asking first', ungated);
}

section('And every tool has been classified either way');
{
  /* The rule above only catches a tool that calls one of three known-dangerous
     things. A new tool that reaches a third party some other way - sending
     mail, moving money, posting somewhere - would sail past it, because the
     rule describes today's hazards rather than requiring a decision.

     So this is the stronger, exhaustive form used elsewhere in this suite:
     every declared tool is either in the consent map or named here as safe,
     with the reason. Adding a tool means adding a line, which means somebody
     thought about whether it needs permission. */
  const SAFE_WITHOUT_ASKING = {
    generate_image: 'produces a picture shown to the person who asked; nothing leaves AMV',
    generate_video: 'the same, metered by the plan allowance',
    build_app:      'writes a page into the conversation, and publishing it is a separate gated tool',
  };
  const unclassified = toolNames
    .filter(n => !consented.has(n) && !(n in SAFE_WITHOUT_ASKING))
    .sort();
  ok(unclassified.length === 0,
     'no tool is added without deciding whether it needs permission', unclassified);

  /* And the safe list cannot quietly cover something that has since become
     dangerous. */
  const nowDangerous = Object.keys(SAFE_WITHOUT_ASKING)
    .filter(n => /runCode\(|autoDebug\(|_deployApi\(/.test(toolBody(n)));
  ok(nowDangerous.length === 0,
     'and nothing excused as safe has since started executing or publishing', nowDangerous);
}

section('And the three known ones have not quietly left the map');
{
  ['deploy_site', 'run_code', 'fix_code'].forEach(n => {
    ok(consented.has(n), n + ' still requires permission', n);
  });
}

section('The gate is on the model-driven path, not inside the runner');
{
  /* A user pressing "Run" in Lab IS the intent, so the gate must not sit inside
     _amvRunTool where it would prompt for their own button press - and must sit
     on the dispatch path where the model is the one asking. */
  const runnerAt = bundle.indexOf('async function _amvRunTool');
  const runner = bundle.slice(runnerAt, runnerAt + 600);
  ok(!/_confirmModelTool\(/.test(runner),
     'the runner itself does not prompt, so explicit user actions stay direct', true);

  const dispatchAt = bundle.indexOf('if(_toolNeedsConsent(');
  ok(dispatchAt > 0, 'and the model-driven dispatch does ask', dispatchAt > 0);
  const dispatch = bundle.slice(dispatchAt, dispatchAt + 700);
  ok(/_confirmModelTool\(t\.name, input\)/.test(dispatch), 'with the tool and its input', true);
  /* A denial has to STOP it, not merely be recorded. */
  ok(/if\(!allowed\)/.test(dispatch) && /DENIED/.test(dispatch),
     'and a denial stops the tool rather than only being logged', true);
}

section('The consent prompt says where the request may have come from');
{
  const at = bundle.indexOf('async function _confirmModelTool');
  const body = bundle.slice(at, at + 1400);
  ok(/triggered by content it read/i.test(body),
     'because a tool call can be injected by a page, not asked for by the person', true);
  ok(/Allow once/.test(body), 'and permission is for one call, not forever', true);
}

if (report('tool-consent-coverage') > 0) process.exitCode = 1;
done();
