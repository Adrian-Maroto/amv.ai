/* THE COMMENT SAYS THESE BOUNDS CARRY THE ARGUMENT. NOTHING MEASURED THEM.

   A connector's tools are named by whoever published that server, so there is
   no list to check them against and `_safeTools` admits them by SHAPE. Its own
   comment says why that is not a hole:

     "Nothing here executes ... What the list prevents is a modified client
      shipping a thousand definitions or a megabyte of schema at AMV's expense -
      and TOOLS_MAX, TOOL_DESC_MAX and TOOL_SCHEMA_MAX below still enforce every
      bit of that, on these exactly as on the rest."

   That is the entire safety argument for admitting third-party tool names, and
   it rests on three constants. Removing any one of them - the count bound, the
   description bound, the schema bound - and removing the name shape check
   altogether were all tried as mutations against every connector suite in the
   repository, and all four went unnoticed. The claim was true and nothing held
   it.

   This is the milestone gate for a connector marketplace, so it is measured
   rather than described: hostile inputs in, bounded output out. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'bounds.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { _safeTools, TOOLS_MAX, TOOLS_TOTAL_MAX, TOOL_DESC_MAX, TOOL_SCHEMA_MAX, AMV_CLIENT_TOOLS };
`);
const W = await import(harness + '?t=' + Date.now());

const mcp = (n, over) => Object.assign({
  name: 'mcp__server__tool' + n, description: 'does a thing',
  input_schema: { type: 'object', properties: {} } }, over || {});

section('The bounds are real numbers, not absent ones');
{
  /* The count was held at 24 and then at "64 or less" here - and 24 turned
     out to be fewer than AMV itself sends with a computer connected, so every
     connector tool after the bridge's was cut without a word. What bounds the
     cost of a request is its SIZE, so that is the bound asserted; the count is
     a backstop above anything real. */
  ok(typeof W.TOOLS_MAX === 'number' && W.TOOLS_MAX >= 64 && W.TOOLS_MAX <= 256,
     'there is a tool count backstop, above anything AMV really sends', W.TOOLS_MAX);
  ok(typeof W.TOOLS_TOTAL_MAX === 'number' && W.TOOLS_TOTAL_MAX > 0 && W.TOOLS_TOTAL_MAX <= 400000,
     'and a bound on the total size of every tool together', W.TOOLS_TOTAL_MAX);
  ok(typeof W.TOOL_DESC_MAX === 'number' && W.TOOL_DESC_MAX > 0 && W.TOOL_DESC_MAX <= 4000,
     'a description bound', W.TOOL_DESC_MAX);
  ok(typeof W.TOOL_SCHEMA_MAX === 'number' && W.TOOL_SCHEMA_MAX > 0 && W.TOOL_SCHEMA_MAX <= 16000,
     'and a schema bound', W.TOOL_SCHEMA_MAX);
}

section('A thousand connector tools do not become a thousand');
{
  const many = Array.from({ length: 1000 }, (_, i) => mcp(i));
  const out = W._safeTools(many);
  ok(out.length <= W.TOOLS_MAX,
     'the count is bounded whatever the client ships', out.length);
  ok(out.length === W.TOOLS_MAX,
     'and it is the bound that stopped it, not the input running out', out.length);
}

section('A thousand LARGE connector tools stop at the size bound');
{
  const big = Array.from({ length: 1000 }, (_, i) => mcp(i, { description: 'd'.repeat(W.TOOL_DESC_MAX),
    input_schema: { type: 'object', properties: { q: { type: 'string', description: 's'.repeat(2500) } } } }));
  const out = W._safeTools(big);
  const size = out.reduce((n, t) => n + t.description.length + JSON.stringify(t.input_schema).length, 0);
  ok(size <= W.TOOLS_TOTAL_MAX, 'what goes through fits the size bound', size);
  ok(out.length < W.TOOLS_MAX, 'and it is the size that stopped it, not the count', out.length);
}

section('Everything AMV sends, plus a whole connector, all reaches the model');
{
  /* What chat really sends with a computer connected, and a connector the size
     of a real one behind it. None of it may be cut. */
  const own = [...W.AMV_CLIENT_TOOLS].map(name => ({ name, description: 'x'.repeat(300),
    input_schema: { type: 'object', properties: { a: { type: 'string' } } } }));
  const conn = Array.from({ length: 40 }, (_, i) => mcp(i, { description: 'y'.repeat(400) }));
  const out = W._safeTools(own.concat(conn));
  ok(out.length === own.length + conn.length, 'every one of them', { sent: own.length + conn.length, kept: out.length });
}

section('A description is a description, not a second prompt');
{
  /* The place this matters: a connector's description is written by whoever
     published that server and goes into the model's context verbatim. A bound
     does not make it safe to read - per-call consent does that - but an
     unbounded one is a megabyte of somebody else's text at AMV's expense on
     every single turn. */
  const out = W._safeTools([mcp(1, { description: 'x'.repeat(50000) })]);
  ok(out.length === 1, 'the tool is still admitted', out.length);
  ok(out[0].description.length === W.TOOL_DESC_MAX,
     'with its description cut to the bound rather than passed through',
     out[0].description.length);
}

section('A schema is a schema, not a payload');
{
  const huge = { type: 'object', properties: {} };
  for(let i = 0; i < 2000; i++) huge.properties['f' + i] = { type: 'string', description: 'y'.repeat(40) };
  const out = W._safeTools([mcp(1, { input_schema: huge }), mcp(2)]);
  ok(!out.some(t => t.name === 'mcp__server__tool1'),
     'a tool whose schema is over the bound is dropped, not trimmed - a half a '
     + 'schema is not a schema', out.map(t => t.name));
  ok(out.some(t => t.name === 'mcp__server__tool2'),
     'and the one behind it still gets through, so one bad tool is not a broken connector',
     out.map(t => t.name));
}

section('The name shape is what admits a connector tool, and it is checked');
{
  const bad = [
    { name: 'not_a_tool_amv_knows', description: 'x' },
    { name: 'mcp__', description: 'x' },
    { name: 'mcp__server__', description: 'x' },
    { name: 'mcp__server', description: 'x' },
    { name: 'mcp__ser ver__tool', description: 'x' },
    { name: 'mcp__server__tool with spaces', description: 'x' },
    { name: 'mcp__' + 'a'.repeat(60) + '__tool', description: 'x' },
    { name: 'mcp__server__' + 'b'.repeat(90), description: 'x' },
    { name: '../../etc/passwd', description: 'x' },
    { name: 'mcp__server__tool\nmcp__other__tool', description: 'x' },
  ];
  const out = W._safeTools(bad);
  ok(out.length === 0,
     'nothing that is neither a tool AMV ships nor a well-formed connector name gets through',
     out.map(t => t.name));
  ok(W._safeTools([mcp(1)]).length === 1,
     'while a well-formed one does, so this is a filter and not a wall', true);
}

section('An unknown server-side tool type is refused outright');
{
  /* A `type` AMV does not know is a tool the PROVIDER would execute, not one
     the browser would. There is no consent screen on that path because there
     is no call to consent to - so the only safe answer is not to forward it. */
  const out = W._safeTools([{ type: 'code_execution_20250101', name: 'x' }, mcp(1)]);
  ok(!out.some(t => t.type), 'it does not reach the model', out);
  ok(out.length === 1, 'and the ordinary tool beside it is unaffected', out.length);
}

section('And AMV’s own tools are still admitted by name, not by shape');
{
  /* The name list buys the wiring check: a tool the client ships and the server
     has never heard of is a feature silently doing nothing. That is how the
     whole tool system was dead once and the bridge was dead again. */
  const known = [...W.AMV_CLIENT_TOOLS][0];
  ok(W._safeTools([{ name: known, description: 'd' }]).length === 1,
     'a tool on the list gets through', known);
  ok(W._safeTools([{ name: known + '_not_real', description: 'd' }]).length === 0,
     'and one that is not on it does not, however plausible the name', true);
}

if (report('the-bounds-that-make-a-connector-safe-to-admit') > 0) process.exitCode = 1;
done();
