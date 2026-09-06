/* NOBODY IS WATCHING WHEN A SCHEDULED JOB RUNS.

   Every side-effecting tool in AMV is gated by a person: `_toolNeedsConsent`
   stops the model taking an action in chat until somebody says yes, and
   Build asks once for a whole turn before it touches a machine. A cron tick
   has nobody to ask. So the question that matters for background work is not
   "is the consent dialog good" - it is whether a tool ever reaches the model
   on a path where no dialog can exist.

   Today it does not. `_autoExecute` builds its request by hand and attaches
   exactly one tool, `web_search`, and only for a paid research job. No
   deploy, no command, no connector, no memory write, no approval action. The
   job produces TEXT, and what happens to that text is decided by the
   approval ceiling at the point of delivery.

   That is the right design and nothing was holding it. Adding a tool to that
   request is a small, reasonable-looking edit - "let the morning briefing
   file the report itself" - and it would route around the entire consent
   model in one line, silently, because there is no dialog on that path to
   notice its absence.

   So this pins it. It reads the source rather than driving a run, because
   the property is about what is ATTACHED to the request, and a run with no
   model key attached proves nothing about the shape of a body it never sent.

   If this fails because somebody deliberately gave background work a tool,
   the fix is not to widen the list here. It is to decide what asks
   permission when there is nobody to ask - and to write that down. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const code = codeOnly(src);

/* The runner's body, from `async function _autoExecute` to the call that
   sends it. Sliced rather than regexed out whole, because a body assembled
   across forty lines is not something one pattern should be trusted to
   bound. */
const start = code.indexOf('async function _autoExecute');
const end = code.indexOf('const r = await _modelFetch(env, body);', start);

section('The unattended runner exists where this file thinks it does');
{
  ok(start > -1, '_autoExecute is found', start > -1);
  ok(end > start, 'and it ends at the fetch that sends its body', end > start);
}

const runner = code.slice(start, end);

section('Exactly one tool reaches a job that nobody is watching');
{
  /* Every `tools` assignment in that span, whatever shape it takes. */
  const assigns = runner.match(/\.tools\s*=\s*[^;]+;/g) || [];
  ok(assigns.length === 1,
     'the runner attaches tools in exactly one place', assigns.length);
  ok(/web_search/.test(assigns[0] || ''),
     'and the tool it attaches is the web search', (assigns[0] || '').slice(0, 90));
  ok(!/mcp__|deploy_site|run_command|write_file|crew_|memory_|approval_act/.test(assigns[0] || ''),
     'not a tool that can act on anything', (assigns[0] || '').slice(0, 90));
}

section('And no acting tool is named anywhere in the runner');
{
  /* The assignment above could be one line of several routes into the same
     body. This is the wider net: a name that can DO something has no business
     appearing in a function that runs with nobody present. */
  const ACTING = ['deploy_site', 'run_command', 'write_file', 'list_dir', 'read_file',
                  'crew_add', 'crew_update', 'crew_remove', 'crew_ceiling', 'crew_standing',
                  'memory_add', 'memory_forget', 'approval_act', 'mcp__'];
  const found = ACTING.filter(n => runner.includes(n));
  ok(found.length === 0,
     'no side-effecting tool name appears in the unattended runner', found);
}

section('The runner reaches the model directly, not through the agent loop');
{
  /* `aiAgentLoop` is the turn-taking that runs tools. If background work ever
     goes through it, tools arrive by a different door than the one checked
     above, and every assertion in this file goes quiet while being wrong. */
  ok(!/aiAgentLoop|_amvRunTool|runMcpTool|runBridgeTool/.test(runner),
     'it does not call the tool-running loop', true);
}

section('What a job produces is still gated at delivery');
{
  /* The other half. Even with no tools, a job that emails its result is
     acting - and the ceiling is what decides. Checked here so "no tools" is
     never read as the whole story. */
  ok(/function _autoEffective/.test(code),
     'the effective approval level is computed', true);
  /* The window is MEASURED, not guessed. From the line that computes `level`,
     the suggest branch is 401 characters away and the require branch 4,797 -
     the run itself sits between them. The first version of this used 4,000
     and reported the require branch missing, which is a false alarm about a
     safety check being absent: exactly the kind of finding that gets a suite
     deleted rather than believed. */
  const anchor = code.indexOf('const level = _autoEffective(item, rec);');
  const deliver = code.slice(anchor, anchor + 8000);
  ok(/level === 'require'/.test(deliver),
     'and delivery branches on the EFFECTIVE level, not the job\'s own setting', true);
  ok(/level === 'suggest'/.test(deliver),
     'with a level that spends nothing at all', true);
  /* Read from `level`, never from the job's own field, or the ceiling is a
     suggestion. Asserted because this is the exact substitution a ceiling has
     to survive. */
  ok(!/item\.approval === '(require|auto)'/.test(deliver),
     'and never from item.approval, which is what a ceiling exists to override', true);
}

if (report('a-timer-cannot-act-on-your-behalf') > 0) process.exitCode = 1;
done();
