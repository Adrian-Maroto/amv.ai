/* THE TOOLS ARE ASSEMBLED IN THE BROWSER AND ALLOWED BY NAME ON THE SERVER,
   AND NOTHING JOINED THE TWO LISTS.

   `_safeTools` refuses to forward arbitrary client-supplied tool definitions
   upstream, which is right: a modified client could otherwise ship a thousand
   tools on every turn at AMV's expense. It allows AMV's own tools by NAME,
   from a list kept in the Worker.

   That list has now silently dropped a whole feature twice.

   The first time, it allowed by `t.type`, and none of AMV's own tools have a
   type - so every one of them was dropped on every turn since the day they
   were written. The system prompt promised the model real tools and the model
   was handed none, so a person asking for an app got a sentence about
   building one.

   The second time, the list was correct in shape and short by four names. The
   bridge shipped complete - a daemon, a pairing screen, four tools, a runner -
   and `run_command` was not in the Set, so the definitions stopped at the last
   hop before the model. Somebody with a connected computer asking AMV to run
   their tests got advice about running tests.

   Both are invisible from either end. The client assembles the tools and
   believes it sent them; the server never sees a name it recognises as wrong,
   only one it does not recognise at all, and drops it without a word. So this
   compares the two lists directly, the way nobody did on either occasion. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'safetools.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { AMV_CLIENT_TOOLS, _safeTools, TOOLS_MAX, TOOL_SCHEMA_MAX };\n');
const W = await import(harness + '?t=' + Date.now());

/* Comments stripped, so a tool named only in a note about its removal is not
   counted as one the client still sends. */
const client = codeOnly(readFileSync(join(ROOT, 'app.js'), 'utf8'));

/* Every `*_TOOLS` array the client builds, read by matching its brackets
   rather than by knowing its name - so a fifth group added later is picked up
   here without anybody remembering to add it. */
function toolGroups(src){
  const out = {};
  const re = /const\s+([A-Z][A-Z_]*TOOLS)\s*=\s*\[/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex - 1, depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (!depth) break; }
    }
    out[m[1]] = [...src.slice(re.lastIndex, i).matchAll(/name\s*:\s*'([^']+)'/g)].map(x => x[1]);
  }
  return out;
}

const groups = toolGroups(client);
const sent = new Set();
for (const list of Object.values(groups)) for (const n of list) sent.add(n);

section('Both lists were really read, so this has a subject');
{
  ok(Object.keys(groups).length >= 2,
     'the app builds more than one group of tools', Object.keys(groups).join(', '));
  ok(sent.size >= 18, 'and a real set of tool names comes out of them', sent.size);
  ok(W.AMV_CLIENT_TOOLS instanceof Set && W.AMV_CLIENT_TOOLS.size >= 18,
     'and the server keeps a real allowlist', W.AMV_CLIENT_TOOLS && W.AMV_CLIENT_TOOLS.size);
}

section('Every tool the app sends is one the server will forward');
{
  const dropped = [...sent].filter(n => !W.AMV_CLIENT_TOOLS.has(n));
  ok(dropped.length === 0,
     'no tool is assembled in the browser and silently dropped before the model', dropped);
}

section('And the allowlist really is what does the dropping');
{
  /* The check above compares two lists; this one proves the list is the thing
     the code consults. A name nobody ships must not survive `_safeTools`, or
     the allowlist is decorative and the comparison above means nothing. */
  const made_up = W._safeTools([{ name: 'exfiltrate_everything',
                                  description: 'x', input_schema: { type: 'object' } }]);
  ok(made_up.length === 0, 'a tool AMV does not know is dropped', made_up.length);

  const real = W._safeTools([{ name: 'run_command',
                               description: 'x', input_schema: { type: 'object' } }]);
  ok(real.length === 1 && real[0].name === 'run_command',
     'and one it does know goes through', real.length);
}

section('What goes through is bounded, not trusted');
{
  /* The definitions still come from the client. A permitted name must not be
     a way to post a megabyte of schema or two hundred copies of itself. */
  const fat = W._safeTools([{ name: 'run_command', description: 'x',
                              input_schema: { type: 'object', pad: 'x'.repeat(W.TOOL_SCHEMA_MAX + 100) } }]);
  ok(fat.length === 0, 'an oversized schema is dropped even under a good name', fat.length);

  const many = W._safeTools(Array.from({ length: W.TOOLS_MAX + 40 },
    () => ({ name: 'read_file', description: 'x', input_schema: { type: 'object' } })));
  ok(many.length <= W.TOOLS_MAX,
     'and a flood is cut to the ceiling', many.length + ' of ' + (W.TOOLS_MAX + 40));

  const longDesc = W._safeTools([{ name: 'read_file', description: 'y'.repeat(9000),
                                   input_schema: { type: 'object' } }]);
  ok(longDesc.length === 1 && longDesc[0].description.length <= 1200,
     'and a description cannot become a second system prompt', longDesc[0] && longDesc[0].description.length);
}

section('And what the server allows that nothing sends');
{
  /* Reported, not failed: a name kept after its client half was removed costs
     nothing but confusion, and this is where it becomes visible. Removing
     image and video generation left exactly this kind of residue behind. */
  const orphan = [...W.AMV_CLIENT_TOOLS].filter(n => !sent.has(n));
  ok(true, 'allowed names the app never sends: ' + (orphan.length ? orphan.join(', ') : 'none'),
     orphan.length);
}

if (report('a-tool-the-model-never-receives') > 0) process.exitCode = 1;
done();
