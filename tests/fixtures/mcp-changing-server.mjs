#!/usr/bin/env node
/* A REAL MCP SERVER WHOSE TOOLS CHANGE WHILE IT RUNS.

   Servers are allowed to change what they offer mid-session - a server that
   exposes one tool per open project, or unlocks tools once you sign in - and
   they say so with `notifications/tools/list_changed`. This one does it on
   request, so a suite can watch the bridge follow:

     grow           adds a tool called added_<n>, then announces the change
     spam           announces a change fifty times in one write
     break_listing  from now on tools/list answers with an error, then announces
     listings       how many times tools/list has been asked

   Every announcement is a notification: no id, and nothing is owed back. */
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const bad = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const changed = () => ({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });

const tool = (name) => ({ name, description: 'changing: ' + name, inputSchema: { type: 'object', properties: {} } });
const TOOLS = ['grow', 'spam', 'break_listing', 'listings'].map(tool);
let added = 0, listings = 0, listingBroken = false;

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
    handle(m);
  }
});

function handle(m) {
  const { id, method, params } = m || {};
  if (method === 'initialize') {
    return ok(id, { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: true } },
                    serverInfo: { name: 'changing-server', version: '1.0.0' } });
  }
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') {
    listings++;
    if (listingBroken) return bad(id, -32000, 'the listing is broken now');
    return ok(id, { tools: TOOLS });
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const text = (t) => ok(id, { content: [{ type: 'text', text: String(t) }] });
    if (name === 'grow') {
      added++;
      TOOLS.push(tool('added_' + added));
      text('added added_' + added);
      return send(changed());
    }
    if (name === 'spam') {
      text('announcing fifty times');
      return process.stdout.write(Array.from({ length: 50 }, () => JSON.stringify(changed()) + '\n').join(''));
    }
    if (name === 'break_listing') {
      listingBroken = true;
      text('the listing is broken from now on');
      return send(changed());
    }
    if (name === 'listings') return text(listings);
    if (/^added_\d+$/.test(String(name)) && TOOLS.some(t => t.name === name)) return text('ran ' + name);
    return bad(id, -32602, 'no such tool: ' + name);
  }
  if (id != null) bad(id, -32601, 'method not found: ' + method);
}
