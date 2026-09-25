/* TWO CONNECTOR TOOLS NEVER SHARE A NAME.  (AMV-AUD-020)

   A connector's tool names are written by whoever wrote the server, and the
   name the model sees has to fit `mcp__<server>__<tool>` with a bounded
   alphabet. Squeezing an arbitrary name into that is lossy: `a.b` and `a b`
   both became `a_b`, two names sharing their first sixty characters became
   one, and a server `a__b` with a tool `c` was spelled exactly like a server
   `a` with a tool `b__c`.

   The old lookup then recovered identity by splitting the name back apart and
   running the FIRST tool whose spelling matched. So one of two colliding
   tools was unreachable, and a call meant for it ran the other - which may do
   something quite different to somebody's real account than what they were
   asked to approve.

   Identity is now held in a registry: every offered tool gets an alias that
   is unique when handed out, bound to its exact server id and exact tool name
   for the life of the tab. These are driven against the real functions, with
   only the bridge call underneath replaced so the routed name can be read. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* The Worker's own shape check, copied rather than imported: the aliases have
   to survive the far end of the wire, and this is what the far end says. */
const SERVER_SHAPE = /^mcp__[a-z0-9_-]{1,40}__[A-Za-z0-9_-]{1,60}$/;

const LONG = 'x'.repeat(64);

const r = await page.evaluate(async (LONG) => {
  const tool = (name) => ({ name, description: 'does ' + name, inputSchema: { type: 'object', properties: {} } });
  MCP.live = {
    one:  { tools: [tool('a.b'), tool('a b'), tool('read__file'), tool(LONG + 'A'), tool(LONG + 'B'),
                    tool('搜索'), tool('検索'), tool('same'), tool('same')], info: null, error: '' },
    'a__b': { tools: [tool('c')], info: null, error: '' },
    a:      { tools: [tool('b__c')], info: null, error: '' },
  };
  const offered = mcpTools();

  /* What reached the bridge, per call. */
  const routed = [];
  const realCall = window.mcpCall;
  window.mcpCall = async (id, method, params) => {
    routed.push({ id, method, name: params && params.name });
    return { content: [{ type: 'text', text: 'ran ' + id + '/' + (params && params.name) }] };
  };
  const callAll = [];
  for (const t of offered) {
    const before = routed.length;
    const res = await runMcpTool(t.name, {});
    callAll.push({ alias: t.name, res, hit: routed[before] || null, who: mcpToolIdentity(t.name) });
  }

  /* The consent dialog, with the modal captured rather than shown. */
  const realModal = window._showModalAsync;
  const asked = [];
  window._showModalAsync = async (o) => { asked.push(o.title); return false; };
  const aliasOf = (id, name) => (offered.find(t => { const w = mcpToolIdentity(t.name); return w && w.id === id && w.tool === name; }) || {}).name;
  await _confirmModelTool(aliasOf('a__b', 'c'), {});
  await _confirmModelTool(aliasOf('a', 'b__c'), {});
  window._showModalAsync = realModal;

  /* A restart that lists the tools in the other order must not swap them. */
  const beforeRestart = { ab: aliasOf('one', 'a.b'), aSpace: aliasOf('one', 'a b') };
  MCP.live.one.tools = MCP.live.one.tools.slice().reverse();
  const afterList = mcpTools();
  const afterRestart = {
    ab: (afterList.find(t => (mcpToolIdentity(t.name) || {}).tool === 'a.b') || {}).name,
    aSpace: (afterList.find(t => (mcpToolIdentity(t.name) || {}).tool === 'a b') || {}).name,
  };

  /* A stopped server's alias fails; it does not land on anything else. */
  const stoppedAlias = aliasOf('a__b', 'c');
  delete MCP.live['a__b'];
  const n0 = routed.length;
  const stopped = await runMcpTool(stoppedAlias, {});
  const stoppedRouted = routed.slice(n0);

  window.mcpCall = realCall;
  return { offered: offered.map(t => t.name), callAll, asked, beforeRestart, afterRestart,
           stopped, stoppedRouted };
}, LONG);

section('Every advertised name is unique and survives the server’s shape check');
{
  ok(r.offered.length === 10,
     'ten distinct tools are offered - the duplicate "same" once, everything else once each', r.offered);
  ok(new Set(r.offered).size === r.offered.length, 'no two share a name', r.offered);
  const bad = r.offered.filter(n => !SERVER_SHAPE.test(n));
  ok(bad.length === 0, 'and every one fits mcp__<server>__<tool> as the Worker admits it', bad);
}

section('Every advertised name runs exactly the tool it was handed out for');
{
  const wrong = r.callAll.filter(c => !c.hit || !c.who || c.hit.id !== c.who.id || c.hit.name !== c.who.tool);
  ok(wrong.length === 0, 'the bridge is asked for the same server and tool the name was issued to',
     wrong.map(w => ({ alias: w.alias, who: w.who, hit: w.hit })));
  const reached = new Set(r.callAll.map(c => c.hit && (c.hit.id + '/' + c.hit.name)));
  for (const want of ['one/a.b', 'one/a b', 'one/read__file', 'one/' + LONG + 'A', 'one/' + LONG + 'B',
                      'one/搜索', 'one/検索', 'a__b/c', 'a/b__c']) {
    ok(reached.has(want), 'reachable: ' + want.slice(0, 40), [...reached].map(s => s && s.slice(0, 40)));
  }
  ok(r.callAll.every(c => c.res && c.res.ok === true), 'and none of them came back "not running"',
     r.callAll.filter(c => !c.res.ok).map(c => c.alias));
}

section('The consent dialog names the tool that will actually run');
{
  ok(/"a__b" connector to run "c"/.test(r.asked[0] || ''),
     'server a__b, tool c - not server a, tool b__c', r.asked[0]);
  ok(/"a" connector to run "b__c"/.test(r.asked[1] || ''),
     'server a, tool b__c - not server a__b, tool c', r.asked[1]);
}

section('A name, once given, keeps meaning the same tool');
{
  ok(r.beforeRestart.ab && r.beforeRestart.ab === r.afterRestart.ab
     && r.beforeRestart.aSpace === r.afterRestart.aSpace,
     'a server relisting its tools in another order does not swap two colliding names',
     { before: r.beforeRestart, after: r.afterRestart });
  ok(r.stopped.ok === false && r.stoppedRouted.length === 0,
     'a stopped server’s name fails honestly and reaches no other tool',
     { stopped: r.stopped, routed: r.stoppedRouted });
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
