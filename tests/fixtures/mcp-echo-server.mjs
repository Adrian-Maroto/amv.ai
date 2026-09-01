#!/usr/bin/env node
/* A REAL MCP SERVER, SMALL ENOUGH TO READ.

   The MCP suites need a server that genuinely speaks the protocol over stdio
   - newline-delimited JSON-RPC on stdin and stdout - rather than a stub that
   agrees with whatever the test expects. This is that: a handshake, two
   tools, and the failure shapes a real server produces.

   It logs to stderr on purpose. Real MCP servers do, and a client that
   mistakes stderr chatter for protocol output breaks on the first one. */
import { readFileSync, writeFileSync } from 'fs';

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const bad = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

const TOOLS = [
  { name: 'shout',
    description: 'Return the given text in capitals. Exists so a test can prove a tool call really reached this process and came back.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'count_lines',
    description: 'Count the lines in a file, by path, so a tool can be seen touching the real filesystem.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
];

console.error('[echo-server] up, pid ' + process.pid);
/* Its stderr goes to the BRIDGE, not to whoever started the bridge, so a test
   cannot read the pid from a log. A file it names can be read by anyone. */
if (process.env.MCP_PID_FILE) {
  try { writeFileSync(process.env.MCP_PID_FILE, String(process.pid)); } catch (e) {}
}

let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch (e) { continue; }
    handle(m);
  }
});

function handle(m) {
  const { id, method, params } = m || {};
  if (method === 'initialize') {
    console.error('[echo-server] handshake from ' + ((params && params.clientInfo && params.clientInfo.name) || '?'));
    return ok(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} },
                    serverInfo: { name: 'echo-server', version: '1.0.0' } });
  }
  if (method === 'notifications/initialized') return;          // a notification has no reply
  if (method === 'tools/list') return ok(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    if (name === 'shout') {
      return ok(id, { content: [{ type: 'text', text: String(args.text || '').toUpperCase() }] });
    }
    if (name === 'count_lines') {
      try {
        const n = readFileSync(String(args.path), 'utf8').split('\n').length;
        return ok(id, { content: [{ type: 'text', text: String(n) }] });
      } catch (e) {
        /* The protocol's own way of saying a tool failed: a RESULT with
           isError, not a JSON-RPC error. A client that conflates the two
           turns "that file is missing" into "the server is broken". */
        return ok(id, { isError: true, content: [{ type: 'text', text: 'cannot read ' + args.path }] });
      }
    }
    return bad(id, -32602, 'no such tool: ' + name);
  }
  if (id != null) bad(id, -32601, 'method not found: ' + method);
}
