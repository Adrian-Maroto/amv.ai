/* AI INPUT VALIDATION + METERING COMPLETENESS (AMV-019, AMV-020).

   AMV-019  message validation only counted text, so binary/base64 image data,
            nested tool_result content and unknown block types slipped past the
            size bound (unmetered payload / cost).
   AMV-020  the client-supplied system prompt was forwarded to the model but not
            included in the token reservation, so it was effectively free. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'input-validation.harness.mjs');
writeFileSync(harness, src + '\nexport { validateMessagesPayload, _estimateReserveInput, MAX_TOTAL_CHARS };\n');
const W = await import(harness + '?t=' + Date.now());

/* ── AMV-019: bound binary/blocks, reject unknown types ────────────────── */
section('AMV-019: content-block validation bounds binary and rejects unknowns');
ok(W.validateMessagesPayload({ messages: [{ role: 'user', content: 'hi' }] }) === null, 'a normal text message is valid');
ok(W.validateMessagesPayload({ messages: [{ role: 'user', content: [{ type: 'image', source: { data: 'AAAA' } }] }] }) === null, 'a small image block is valid');
// unknown block type is rejected
ok(!!W.validateMessagesPayload({ messages: [{ role: 'user', content: [{ type: 'exec', cmd: 'rm -rf /' }] }] }), 'an unknown content block type is rejected');
// a huge base64 image payload is counted toward the size bound and rejected
const bigData = 'A'.repeat(W.MAX_TOTAL_CHARS + 10);
ok(!!W.validateMessagesPayload({ messages: [{ role: 'user', content: [{ type: 'image', source: { data: bigData } }] }] }), 'an oversized base64 image payload is rejected (counted, not free)');
// too many blocks in one message is rejected
const manyBlocks = Array.from({ length: 100 }, () => ({ type: 'text', text: 'x' }));
ok(!!W.validateMessagesPayload({ messages: [{ role: 'user', content: manyBlocks }] }), 'too many content blocks in a message is rejected');

/* ── AMV-020: the system prompt is included in the reservation estimate ── */
section('AMV-020: the system prompt is metered');
const base = { messages: [{ role: 'user', content: 'hello' }] };
const withSys = { messages: [{ role: 'user', content: 'hello' }], system: 'S'.repeat(4000) };
const eBase = W._estimateReserveInput(base);
const eSys = W._estimateReserveInput(withSys);
ok(eSys > eBase, 'a request with a large system prompt reserves MORE than without', { eBase, eSys });
ok(eSys - eBase >= 900, 'the ~4000-char system prompt adds ~1000 tokens to the reservation', eSys - eBase);

if (report() > 0) process.exitCode = 1;
done();
