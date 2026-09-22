/* THE LOOP CALLED WHATEVER THE MODEL NAMED.  (AMV-AUD-006)

   `aiAgentLoop` supplied a tool list with the request and then dispatched
   `runTool(c.name, ...)` on whatever name came back, with nothing checking
   membership. The chat streaming loop did the same with `_amvRunTool(t.name,
   ...)`. So a turn that offered one narrow tool could hand a different, broader
   name to a dispatcher - and the dispatchers here are not narrow. `_amvRunTool`
   reaches account actions; `_agentRunTool` writes files and runs commands on
   somebody's computer.

   THIS DOES NOT NEED AN ADVERSARIAL MODEL. Tool names are conventional and
   models generalise across them, so the ordinary case is a plausible name for
   something this surface does not have. The honest answer is to say so. What it
   must never be is a lookup in a dispatcher that knows more tools than the
   request offered.

   WHY THE LIST IS CAPTURED FROM THE REQUEST. Both loops build their tools
   CONDITIONALLY - the machine's tools only while a bridge is connected,
   connectors only while they are running - so "what exists" and "what this turn
   offered" are different sets, and only the second may be dispatched. Resolving
   identity from anything in the reply is the defect in miniature.

   The refusal is a tool RESULT, not a throw: the model is told what it may use
   and the turn carries on with a correction, rather than ending at the moment
   the work starts. */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
/* The loop asks `_aiBase()` for its endpoint and refuses when nothing is
   connected, so the engine is armed before anything is driven. The network is
   stubbed below regardless - this only gets past the connectivity gate. */
await app.connect();

/* One round of `aiAgentLoop` against a stubbed engine: the model asks for the
   names given, and every dispatch is recorded. */
const loop = (offer, asked) => page.evaluate(async ({ offer, asked }) => {
  const dispatched = [];
  let round = 0;
  window.fetchDeadline = async () => ({
    ok: true, status: 200, headers: { get: () => '' },
    body: null,
    json: async () => ({}),
  });
  /* The loop reads its answer through `_aiReadStream`, so that is the seam -
     stubbing fetch alone would leave the parser reading an empty body. */
  window._aiReadStream = async () => {
    round++;
    if (round > 1) return { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: {} };
    return {
      content: asked.map((n, i) => ({ type: 'tool_use', id: 'c' + i, name: n, input: { x: 1 } })),
      stop_reason: 'tool_use', usage: {},
    };
  };
  const out = await aiAgentLoop({
    prompt: 'go',
    tools: offer.map(n => ({ name: n, description: 'd', input_schema: { type: 'object' } })),
    runTool: async (name) => { dispatched.push(name); return { ok: true, text: 'ran ' + name }; },
    maxRounds: 3,
  });
  return { dispatched, steps: out.steps.map(s => ({ name: s.name, ok: s.ok, refused: !!s.refused, detail: s.detail })) };
}, { offer, asked });

section('A name that was not offered never reaches the dispatcher');
{
  const r = await loop(['read_file'], ['run_command']);
  ok(r.dispatched.length === 0,
     'the dispatcher was not called at all - this is the whole finding', JSON.stringify(r.dispatched));
  ok(r.steps.length === 1 && r.steps[0].refused === true,
     'the attempt is recorded as refused rather than hidden', JSON.stringify(r.steps));
  ok(r.steps[0].ok === false, 'and marked failed, so the log shows what happened', JSON.stringify(r.steps[0]));
  ok(/no tool called "run_command"/i.test(r.steps[0].detail),
     'the model is told plainly', r.steps[0].detail);
  ok(/read_file/.test(r.steps[0].detail),
     'and told what it MAY use, so the turn can correct itself', r.steps[0].detail);
}

section('A name that WAS offered still runs');
{
  /* The other side. A guard that refuses everything is not a guard, it is the
     feature switched off. */
  const r = await loop(['read_file'], ['read_file']);
  ok(r.dispatched.length === 1 && r.dispatched[0] === 'read_file',
     'the offered tool is dispatched exactly once', JSON.stringify(r.dispatched));
  ok(r.steps[0].refused === false && r.steps[0].ok === true, 'and reported as run', JSON.stringify(r.steps[0]));
}

section('One bad name in a batch does not stop the good ones');
{
  /* A model often asks for several at once. Refusing the batch because one
     name was wrong would turn a correctable mistake into a lost turn. */
  const r = await loop(['read_file', 'list_dir'], ['read_file', 'delete_everything', 'list_dir']);
  ok(r.dispatched.join(',') === 'read_file,list_dir',
     'the two real ones ran, in order', JSON.stringify(r.dispatched));
  ok(r.dispatched.indexOf('delete_everything') < 0,
     'and the invented one did not', JSON.stringify(r.dispatched));
  ok(r.steps.filter(s => s.refused).length === 1, 'exactly one refusal is recorded', JSON.stringify(r.steps.map(s => s.refused)));
}

section('With no tools offered at all, nothing is dispatchable');
{
  /* The case a conditional tool list creates: the bridge disconnects between
     turns, so the machine's tools are no longer offered - and a name the model
     remembers from the last turn must not still work. */
  const r = await loop([], ['run_command']);
  ok(r.dispatched.length === 0, 'nothing runs', JSON.stringify(r.dispatched));
  ok(/Available: none/.test(r.steps[0].detail),
     'and the model is told there is nothing, rather than nothing happening silently', r.steps[0].detail);
}

section('The chat loop guards the same way, ahead of consent');
{
  /* THE SECOND DISPATCH SITE, AND THIS CHECK IS WEAKER THAN THE ONES ABOVE.

     Everything before this drove the real loop and watched what reached the
     dispatcher. The chat streaming turn cannot be reached that way without a
     stub for the whole SSE path, its tool-block assembly and its rendering -
     a large amount of fiction for one claim, and fiction is where a suite
     starts passing against itself.

     So this reads the source, and a test that reads source can only say a line
     is PRESENT. What it CAN say usefully is ORDER, which is the part most
     likely to be got wrong by a later edit: the membership check has to come
     before the consent prompt, because asking somebody to approve a tool that
     does not exist in this turn is a dialog about nothing, and a "yes" to it
     would be consent pointing at a dispatcher lookup rather than at a known
     action. TRUST-AUDIT records that the behaviour here is unmeasured. */
  const src = codeOnly(readFileSync(join(ROOT, 'src', 'app', '05-ui-blocks.js'), 'utf8'));
  const iOffered = src.indexOf('_offeredTools = new Set(tools.map');
  const iGuard   = src.indexOf('!_offeredTools.has(String(t.name');
  const iConsent = src.indexOf('_toolNeedsConsent(t.name)');
  const iDispatch = src.indexOf('_amvRunTool(t.name');
  ok(iOffered > 0, 'the offered set is built from the tools array that is sent', String(iOffered));
  ok(iGuard > iOffered, 'and the guard reads it', String(iGuard));
  ok(iConsent > iGuard, 'the membership check comes BEFORE the consent prompt', iGuard + ' < ' + iConsent);
  ok(iDispatch > iGuard, 'and before the dispatch', iGuard + ' < ' + iDispatch);
  /* ONE CONSTRUCTION, WHICH IS WHAT CAN ACTUALLY BE CHECKED.

     The claim wanted here is "never rebuilt from the reply", and the first
     attempt at it was a regex for `new Set(... t.name ...)` - which matches the
     LEGITIMATE line, because the map parameter over `tools` is also called `t`.
     A pattern that cannot tell the right construction from the wrong one is not
     a check, and it failed honestly rather than quietly passing.

     What is checkable is that the set is assembled exactly once. A second
     assignment is how a later edit would re-derive it - from the reply, from a
     union with "what exists", from anything - and one definition is the
     property that makes re-derivation visible in a diff. */
  const builds = (src.match(/_offeredTools\s*=/g) || []).length;
  ok(builds === 1, 'and it is assembled exactly once, so it cannot be re-derived later', String(builds));
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
