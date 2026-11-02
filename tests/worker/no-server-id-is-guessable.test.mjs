/* NO SERVER IDENTIFIER IS GUESSABLE (Nov 1 audit AGENT-001, SEC-002).

   Math.random is a fast generator, not an unpredictable one: from a few of
   its outputs the rest can be worked out. The Worker used it for agent ids,
   job ids, support tickets, ledger lines and more - names somebody could
   predict, and in places use to reach a record that is not theirs. Every
   identifier the Worker makes now comes from the platform's cryptographic
   generator (_randId, crypto.randomUUID, crypto.getRandomValues), and this
   suite keeps it that way: Math.random may not appear in Worker code at all,
   comments aside. The cost of the rule is nothing - there is no place in a
   server where a predictable number is what is wanted. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dir, '..', '..', 'src', 'worker');

section('Math.random appears nowhere in the Worker');
{
  const hits = [];
  for (const f of readdirSync(SRC).filter(n => n.endsWith('.js')).sort()) {
    const code = codeOnly(readFileSync(join(SRC, f), 'utf8'));
    if (/Math\.random\s*\(/.test(code)) hits.push(f);
  }
  ok(hits.length === 0, 'no Worker file calls Math.random (outside comments)', hits);
}

section('The identifiers that used to use it come from the cryptographic generator');
{
  const all = readdirSync(SRC).filter(n => n.endsWith('.js')).map(f => readFileSync(join(SRC, f), 'utf8')).join('\n');
  const agentId = (all.match(/function _agentId\(\)\s*\{[^}]*\}/) || [''])[0];
  ok(/_randId\(/.test(agentId), 'an agent id is drawn from _randId', agentId);
  const rid = (all.match(/function _randId\(len\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  ok(/crypto\.getRandomValues/.test(rid) && !/Math\.random/.test(rid), 'and _randId itself reads the cryptographic generator', rid.slice(0, 120));
}

if (report('no-server-id-is-guessable') > 0) process.exitCode = 1;
done();
