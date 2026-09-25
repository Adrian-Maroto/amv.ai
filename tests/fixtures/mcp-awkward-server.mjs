#!/usr/bin/env node
/* A REAL MCP SERVER THAT IS AWKWARD ON PURPOSE.

   The echo server is well behaved. Real ones are not always, and the bridge
   has to be right about the ways they are not - so this one writes a reply in
   pieces cut in the middle of characters, puts several messages in one write,
   sends a line far too long to accept, and (by environment switch) fails or
   paginates discovery the ways the protocol allows.

     MCP_LIST_ERROR=1     tools/list answers with a JSON-RPC error
     MCP_PAGES=1          tools/list returns one tool per page, with nextCursor
     MCP_REPEAT_CURSOR=1  tools/list hands back the same cursor for ever
     MCP_ENDLESS_PAGES=1  tools/list hands back a NEW cursor for ever
     MCP_BAD_INIT=1       initialize answers with a result that is not an object */
const TEXT = 'Prix: 12€ · 東京タワー · naïve café · 😀🚀 · Ωμέγα';

const write = (s) => process.stdout.write(s);
const line = (msg) => JSON.stringify(msg) + '\n';
const ok = (id, result) => write(line({ jsonrpc: '2.0', id, result }));
const bad = (id, code, message) => write(line({ jsonrpc: '2.0', id, error: { code, message } }));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TOOLS = ['split_text', 'burst', 'huge', 'echo'].map(name => ({
  name, description: 'awkward: ' + name, inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
}));

/* Write `buf` in pieces cut INSIDE every multi-byte character - the case a
   per-chunk decoder gets wrong - pausing between pieces so the pipe delivers
   them as separate chunks rather than coalescing them. */
async function writeCutInsideCharacters(buf) {
  let from = 0;
  for (let i = 1; i < buf.length; i++) {
    const b = buf[i];
    if ((b & 0xC0) === 0x80) {                         // a continuation byte: cutting here splits a character
      process.stdout.write(buf.subarray(from, i));
      from = i;
      await sleep(4);
    }
  }
  process.stdout.write(buf.subarray(from));
}

/* One message at a time, in order. A reply written while another is still
   going out would land in the middle of it, which no real server does and
   which would make the huge-line case test the fixture instead of the bridge. */
let queue = Promise.resolve();
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!l) continue;
    let m; try { m = JSON.parse(l); } catch (e) { continue; }
    queue = queue.then(() => handle(m)).catch(() => {});
  }
});

async function handle(m) {
  const { id, method, params } = m || {};
  if (method === 'initialize') {
    if (process.env.MCP_BAD_INIT) return ok(id, 'not an object');
    return ok(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} },
                    serverInfo: { name: 'awkward-server', version: '1.0.0' } });
  }
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') {
    if (process.env.MCP_LIST_ERROR) return bad(id, -32603, 'discovery exploded');
    if (process.env.MCP_REPEAT_CURSOR) return ok(id, { tools: [TOOLS[0]], nextCursor: 'again' });
    if (process.env.MCP_ENDLESS_PAGES) {
      const at = Number((params && params.cursor) || 0);
      return ok(id, { tools: [], nextCursor: String(at + 1) });
    }
    if (process.env.MCP_PAGES) {
      const at = Number((params && params.cursor) || 0);
      const next = at + 1 < TOOLS.length ? String(at + 1) : undefined;
      return ok(id, next ? { tools: [TOOLS[at]], nextCursor: next } : { tools: [TOOLS[at]] });
    }
    return ok(id, { tools: TOOLS });
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    if (name === 'split_text') {
      return writeCutInsideCharacters(Buffer.from(line({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: TEXT }] } }), 'utf8'));
    }
    if (name === 'burst') {
      /* A notification, a reply to nobody, and the real reply - one write. */
      return write(line({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })
                 + line({ jsonrpc: '2.0', id: 999999, result: {} })
                 + line({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'burst ' + TEXT }] } }));
    }
    if (name === 'huge') {
      /* Five megabytes of spaces with no newline, and no reply: whoever is
         waiting has to be told by the bridge, not by the timeout.

         Then the line ENDS in a well-formed reply to the NEXT request. JSON
         allows leading whitespace, so if the bridge cut the line at its limit
         and read on from there, the tail would parse - and would answer a
         request this line has nothing to do with. The pause lets that next
         request be sent first, so the forgery has somebody to fool. */
      const block = ' '.repeat(256 * 1024);
      for (let i = 0; i < 20; i++) { write(block); await sleep(2); }
      await sleep(800);
      return write(JSON.stringify({ jsonrpc: '2.0', id: id + 1,
        result: { content: [{ type: 'text', text: 'FORGED by the tail of an oversized line' }] } }) + '\n');
    }
    if (name === 'echo') return ok(id, { content: [{ type: 'text', text: String(args.text || '') }] });
    return bad(id, -32602, 'no such tool: ' + name);
  }
  if (id != null) bad(id, -32601, 'method not found: ' + method);
}
