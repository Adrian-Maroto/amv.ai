/* WEB-SEARCH COST METERING (AMV-021).

   Interactive web-search requests are a separately-billed provider dimension.
   meterStream priced tokens but ignored server_tool_use.web_search_requests, so
   searches were consumed without hitting the spend ledger. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'websearch-metering.harness.mjs');
writeFileSync(harness, src + '\nexport { meterStream, WEB_SEARCH_COST_USD };\n');
const W = await import(harness + '?t=' + Date.now());

const mkStream = (searches) => {
  const sse =
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100}}}\n\n' +
    `event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":50,"server_tool_use":{"web_search_requests":${searches}}}}\n\n` +
    'event: message_stop\ndata: {"type":"message_stop"}\n\n';
  return new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } });
};
const runCost = async (searches) => {
  const store = new Map();
  const env = { AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  } };
  const eng = { inCost: 3, outCost: 15, maxOut: 4000 };
  await W.meterStream(mkStream(searches), eng, {
    dName: 'd', mName: 'm', gName: 'g', costName: 'cost:test',
    user: { email: 'u@x.com', plan: 'pro' }, env,
    limits: { dayTokens: 1e12, monthTokens: 1e12 }, reqMessages: [], reserved: 0,
  });
  return parseFloat(store.get('ctr:cost:test') || '0');
};

section('AMV-021: web-search requests are priced into the spend ledger');
const cost0 = await runCost(0);
const cost3 = await runCost(3);
ok(cost0 > 0, 'a token-only call still records a cost', cost0);
ok(cost3 > cost0, 'adding web searches increases the recorded cost', { cost0, cost3 });
const delta = +(cost3 - cost0).toFixed(4);
ok(Math.abs(delta - 3 * W.WEB_SEARCH_COST_USD) < 1e-6, '3 searches add exactly 3 x the per-search price', { delta, expected: 3 * W.WEB_SEARCH_COST_USD });

if (report() > 0) process.exitCode = 1;
done();
