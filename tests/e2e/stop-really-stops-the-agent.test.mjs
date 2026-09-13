/* THE LOOP THAT RUNS TOOLS ON SOMEBODY'S MACHINE, NEVER ONCE RUN BY A TEST.

   `aiAgentLoop` is the turn-taking behind Crew: it asks the model what to do,
   runs the tools, and comes back for more, up to two dozen times, while the
   person who started it is asleep. Four things stand between that and a
   runaway - a stop flag checked before every round, the same flag checked
   before every single tool call, a hard ceiling on rounds, and a wall-clock
   deadline.

   All four could be deleted without breaking a single suite in this
   repository. Not because the coverage is thin - three suites name
   `aiAgentLoop` - but because none of them RUNS it:

     · `a-timer-cannot-act-on-your-behalf` greps the source for the string, to
       prove the cron runner does not reach it. A real check, of a different
       thing.
     · `a-connector-acts-on-your-real-accounts` REPLACES `window.aiAgentLoop`
       with a stub, deliberately, because its subject is consent rather than
       turn-taking.
     · `every-entry-point-has-a-door` names it in a registry description.

   So the function was mentioned three times and executed zero. That is the
   most expensive shape a gap can take, because every signal a reader has -
   grep, coverage of the file, the names of the suites - says it is covered.

   Here the loop is the real thing and only the MODEL is stubbed: `fetchDeadline`
   and `_aiReadStream` are replaced so the turn returns a canned tool call
   without a network or a key. Everything from the stop check inward is shipped
   code. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp();
const page = app.page;

/* One place that installs a fake model, so each case says only what it is
   about. `script` decides what the model "returns" on each round. */
async function drive(opts) {
  return page.evaluate(async (o) => {
    /* The loop refuses to start unless the backend is configured - a real
       guard (`_aiBackendReady`) that has nothing to do with what is being
       measured here. Marked live for the duration so the turn-taking can be
       reached at all; no network is used either way. */
    /* SET WHAT THEY DERIVE FROM, not the derived values.

       `_aiBackendReady` reads `AMV_API.live && AMV_API.hasSession`, and both
       are GETTERS - `live` is `!!this.base` (localStorage), `hasSession` is
       `!!this.token || !!this._restoring`. Assigning to either throws "has only
       a getter". Two further traps sit here: `AMV_API` is a top-level `const`,
       so replacing `window.AMV_API` changes nothing the bundle reads, and the
       object is shared, so whatever is set has to be put back. */
    const api = window.AMV_API;
    const prevBase = localStorage.getItem('amv_api_base');
    const prevRestoring = api._restoring;
    localStorage.setItem('amv_api_base', 'https://stub.invalid');
    api._restoring = true;
    const realFetch = window.fetchDeadline, realRead = window._aiReadStream;
    const toolCalls = [];
    let round = 0;
    window.fetchDeadline = async () => ({ ok: true, headers: { get: () => '' } });
    window._aiReadStream = async () => {
      round++;
      /* Always another tool to run, unless the case says otherwise, so the
         loop only ends because something STOPPED it. */
      if (o.finishAfter && round > o.finishAfter) {
        return { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: {} };
      }
      const calls = [];
      for (let i = 0; i < (o.toolsPerRound || 1); i++) {
        calls.push({ type: 'tool_use', name: 'noop', input: { i }, id: 'c' + round + '_' + i });
      }
      return { content: [{ type: 'text', text: 'working' }, ...calls], stop_reason: 'tool_use', usage: {} };
    };

    let stopAfterTools = o.stopAfterTools;
    let stopAfterRounds = o.stopAfterRounds;
    const stopped = () => {
      if (stopAfterTools != null && toolCalls.length >= stopAfterTools) return true;
      /* `>=`, not `>`. With `>` a request to stop after ZERO rounds never
         fires, because `round` is still 0 when the first check runs - so the
         case meant to prove a stopped job never reaches the model was quietly
         asking for something else. */
      if (stopAfterRounds != null && round >= stopAfterRounds) return true;
      return false;
    };

    let out;
    try {
      out = await window.aiAgentLoop({
        prompt: 'do the thing',
        tools: [{ name: 'noop', description: 'does nothing', input_schema: { type: 'object' } }],
        runTool: async (name, input) => { toolCalls.push(name); return { text: 'ok' }; },
        stopped,
        maxRounds: o.maxRounds,
        wallMs: o.wallMs,
      });
    } finally {
      window.fetchDeadline = realFetch; window._aiReadStream = realRead;
      api._restoring = prevRestoring;
      if (prevBase === null) localStorage.removeItem('amv_api_base');
      else localStorage.setItem('amv_api_base', prevBase);
    }
    return { why: out.why, rounds: out.rounds, tools: toolCalls.length, modelCalls: round };
  }, opts);
}

section('Stop is honoured between rounds');
{
  /* WHAT ACTUALLY ISOLATES THIS GUARD, which is not the obvious thing.

     The first version asserted `why === 'stopped'` after a mid-job stop, and
     passed even with the between-rounds check deleted. The reason is four
     lines further down: when the TOOL loop is cut it sets `why = 'stopped'`
     too. So both guards produce the same verdict, and a test of the verdict
     proves whichever ran - the same trap as the 404-before-403 refusal in
     `linkRevoke`.

     The observable that separates them is whether the MODEL was asked again.
     The between-rounds check is the only thing that stops another turn being
     bought, and a turn costs money and time whether or not its tools run. */
  const r = await drive({ stopAfterRounds: 1, maxRounds: 10 });
  ok(r.why === 'stopped', 'the loop reports that it was stopped, not that it finished', r.why);
  ok(r.modelCalls === 1, 'and no further turn is bought after the stop', r.modelCalls);
}

section('A job stopped before it starts never reaches the model at all');
{
  /* The cheapest case and the one a person triggers by pressing stop twice, or
     by a job being cancelled while queued. Nothing should be spent. */
  const r = await drive({ stopAfterRounds: 0, maxRounds: 10 });
  ok(r.why === 'stopped', 'it reports stopped', r.why);
  ok(r.modelCalls === 0, 'without asking the model once', r.modelCalls);
  ok(r.rounds === 0, 'and without counting a round', r.rounds);
  ok(r.tools === 0, 'and without running a tool', r.tools);
}

section('Stop is honoured BETWEEN TOOL CALLS, not only between rounds');
{
  /* The separate promise, and the one that matters most. A single round can
     carry several tool calls - deleting a directory, pushing a branch, sending
     mail - and a stop that is only read between ROUNDS lets every remaining
     call in the current round run after the person said no. The code checks it
     in both places; only one of those checks had a reason to exist in a test. */
  const r = await drive({ toolsPerRound: 5, stopAfterTools: 1, maxRounds: 10 });
  ok(r.tools === 1, 'the tools after the stop do not run', r.tools);
}

section('The round ceiling really ends it');
{
  /* "A hard ceiling so we can't loop forever", says the source. A model that
     keeps asking for one more tool is not a hypothetical - it is the ordinary
     failure of a task that cannot be finished, and without this the bill is
     bounded only by the wall clock. */
  /* Bounded on purpose: with the ceiling removed this loop would spin until
     the default wall clock, so the case carries its own deadline and a model
     that eventually finishes. Both are far outside the three rounds being
     asserted, so they change nothing when the ceiling works - they only stop a
     broken ceiling from hanging the suite instead of failing it. */
  const r = await drive({ maxRounds: 3, wallMs: 5000, finishAfter: 2000 });
  ok(r.why === 'rounds', 'it ends because the ceiling was reached', r.why);
  ok(r.rounds === 3, 'after exactly that many rounds', r.rounds);
  ok(r.tools === 3, 'having run one tool per round and no more', r.tools);
}

section('The wall clock really ends it');
{
  /* The other bound, and the one that catches a loop whose rounds are slow
     rather than many. */
  const r = await drive({ maxRounds: 50, wallMs: 1 });
  ok(r.why === 'time', 'a loop past its deadline ends on time, not on rounds', r.why);
  /* The guarantee is that the CLOCK ended it rather than the round ceiling -
     not that it ended on any particular round.

     An earlier version asserted "at most a turn or two" and got twenty, which
     looked like the deadline failing and was not: every round here is stubbed,
     so a turn costs microseconds and twenty of them fit inside the one
     millisecond budget. Date.now() has millisecond resolution, so a fast loop
     legitimately gets several turns inside any deadline expressed in it.
     Pinning a count would have been pinning the machine's speed - the kind of
     assertion that passes on a laptop and fails in CI for no reason anyone can
     act on. What matters is that it stopped WELL SHORT of the fifty it was
     allowed, on the clock. */
  ok(r.rounds < 50, 'stopping well short of the fifty rounds it was allowed', r.rounds);
}

section('And none of this stops an ordinary job finishing');
{
  /* The other direction. A guard that ends every job is not a guard, and each
     of the three above would pass on a loop that refused to do anything. */
  const r = await drive({ finishAfter: 2, maxRounds: 10 });
  ok(r.why === 'done', 'a job that finishes reports done', r.why);
  ok(r.tools === 2, 'having actually run its tools', r.tools);
}

await app.close();
if (report('stop-really-stops-the-agent') > 0) process.exitCode = 1;
done();
