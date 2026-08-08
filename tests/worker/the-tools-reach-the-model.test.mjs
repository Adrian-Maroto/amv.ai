/* AMV'S OWN TOOLS WERE BEING THROWN AWAY BY AMV'S OWN BACKEND.

   The proxy forwards only tools it recognises, which is right: a modified
   client must not be able to send a thousand tool definitions, or one with a
   megabyte of schema, on every turn at AMV's expense.

   It recognised them by `t.type`. Only the model provider's server-side tools
   have a type - web search has one. Every tool AMV wrote is a CUSTOM tool:
   { name, description, input_schema }, no type at all. So the filter dropped
   every one of them, on every turn, since the day they were written.

   Nothing could see it from either end. The client assembled the tools and
   believed it had sent them. The system prompt told the model "you have real
   tools: generate_image, run_code, build_app" - and then handed it none, so it
   could not have called one if it wanted to. Someone asking for an image got a
   sentence about generating an image. Every line of _amvRunTool - real image
   generation, real code execution, real deploys - was unreachable in
   production, and passed review, because nothing tested this function.

   The lesson is the one these cases enforce: the allowlist and the tools have
   to be checked against each other, or they drift the moment either changes.
   Adding a thirteenth tool client-side and forgetting this file would put it
   straight back into the silence the other twelve came out of. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'safetools.harness.mjs');
writeFileSync(harness, src + '\nexport { _safeTools, AMV_CLIENT_TOOLS, TOOLS_MAX, TOOL_DESC_MAX, TOOL_SCHEMA_MAX };\n');
const W = await import(harness + '?t=' + Date.now());

const tool = (name, extra) => Object.assign({
  name, description: 'does a thing', input_schema: { type: 'object', properties: {} } }, extra || {});
const websearch = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 };
const names = list => W._safeTools(list).map(t => t.name);

section('A custom tool with no type is forwarded, which is the whole bug');
{
  const out = W._safeTools([tool('generate_image')]);
  ok(out.length === 1, 'it survives the filter', out.length);
  ok(out[0].name === 'generate_image', 'by name', out[0].name);
  ok(!!out[0].input_schema, 'with its schema, or the model cannot call it', !!out[0].input_schema);
  ok(typeof out[0].description === 'string' && out[0].description.length > 0,
     'and its description, which is how the model knows when to use it', out[0].description);
}

section('Every tool the app ships is one the backend will forward');
{
  /* Read from the built bundle rather than from a list retyped here - a list
     retyped here would agree with itself for ever. */
  const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const block = app.slice(app.indexOf('const AMV_TOOLS'), app.indexOf('function _toolsFor'));
  /* Every tool name in the block, not the ones matching a list of prefixes.

     The prefix filter was a quiet bug in this check: tools added later under a
     new prefix were invisible to the forward direction (so a backend that
     dropped them would have passed) and looked like orphans to the reverse one.
     A whitelist of prefixes has to be maintained in step with the thing it is
     supposed to be watching, which is the failure mode this file exists for. */
  const clientNames = [...new Set([...block.matchAll(/\bname\s*:\s*'([a-z][a-z0-9_]*)'/g)].map(m => m[1]))];

  ok(clientNames.length >= 10, 'the app really defines a set of tools', clientNames.length);
  const dropped = clientNames.filter(n => !W.AMV_CLIENT_TOOLS.has(n));
  ok(dropped.length === 0,
     'and the backend forwards every one of them - a tool it does not know is a tool that silently does nothing',
     dropped);

  /* And the other direction, so the allowlist cannot quietly accumulate names
     for tools that no longer exist. */
  const orphans = [...W.AMV_CLIENT_TOOLS].filter(n => !clientNames.includes(n));
  ok(orphans.length === 0, 'and the allowlist has no names the app has stopped shipping', orphans);
}

section('A tool AMV did not write is still refused');
{
  ok(names([tool('exfiltrate_everything')]).length === 0,
     'an invented name does not get through', names([tool('exfiltrate_everything')]));
  ok(names([tool('generate_image'), tool('rm_rf'), tool('run_code')]).join(',') === 'generate_image,run_code',
     'and it is dropped from the middle of a real list without taking the rest with it',
     names([tool('generate_image'), tool('rm_rf'), tool('run_code')]));
}

section('Web search still works exactly as it did');
{
  const out = W._safeTools([websearch]);
  ok(out.length === 1 && out[0].type === 'web_search_20250305', 'it is forwarded', out[0]);
  ok(W._safeTools([{ ...websearch, max_uses: 10000 }])[0].max_uses === 60,
     'and a client asking for ten thousand searches gets sixty', W._safeTools([{ ...websearch, max_uses: 10000 }])[0].max_uses);
  ok(W._safeTools([{ ...websearch, max_uses: 0 }])[0].max_uses === 1, 'and zero becomes one', true);
  ok(W._safeTools([{ ...websearch, max_uses: 'lots' }])[0].max_uses === 5, 'and nonsense becomes the default', true);
  ok(W._safeTools([{ type: 'code_execution_20250101', name: 'x' }]).length === 0,
     'while a server-side tool AMV has not vetted is still refused', true);
}

section('Both kinds travel together, because a real turn sends both');
{
  const out = names([websearch, tool('generate_image'), tool('crew_add')]);
  ok(out.length === 3, 'search and AMV\'s own tools survive the same call', out);
}

section('The bounds the filter exists for are real');
{
  /* The attack the allowlist was written to stop: a modified client running up
     the bill on every turn. Allowing by name must not have quietly removed it. */
  const many = Array.from({ length: 200 }, () => tool('crew_add'));
  ok(W._safeTools(many).length <= W.TOOLS_MAX,
     'two hundred tools do not become two hundred tools', W._safeTools(many).length);

  const huge = W._safeTools([tool('crew_add', { description: 'x'.repeat(50000) })]);
  ok(huge[0].description.length <= W.TOOL_DESC_MAX,
     'a description cannot become a second prompt', huge[0].description.length);

  const bigSchema = { type: 'object', properties: {} };
  for (let i = 0; i < 5000; i++) bigSchema.properties['f' + i] = { type: 'string', description: 'y'.repeat(50) };
  ok(W._safeTools([tool('crew_add', { input_schema: bigSchema })]).length === 0,
     'and a schema too big to be a schema is dropped rather than forwarded', true);
}

section('Nothing here crashes on rubbish');
{
  /* This runs on every single chat turn. A throw is an outage. */
  ok(W._safeTools([null, undefined, 0, '', [], 'generate_image']).length === 0,
     'junk in the list is skipped', true);
  ok(W._safeTools([]).length === 0, 'an empty list is empty', true);
  const circular = tool('crew_add'); circular.input_schema.self = circular.input_schema;
  ok(W._safeTools([circular]).length === 0, 'and a schema that cannot be serialised is dropped, not thrown on', true);
  ok(W._safeTools([tool('crew_add', { input_schema: null })])[0].input_schema.type === 'object',
     'a missing schema becomes an empty one rather than breaking the call', true);
}

if (report('the-tools-reach-the-model') > 0) process.exitCode = 1;
done();
