/* WHAT YOU SAID BEFORE IS FINDABLE - WORD FOR WORD, AND ONLY WHERE IT SHOULD BE.

   Memory keeps durable facts, and a fact is a summary: it loses the thing
   somebody comes back for - "the pricing we worked out in March", as it was
   said. chat_search finds the conversation; chat_read reads its exact turns.
   Driven in a real browser against the conversations the page holds:

   - offered only when there is another saved chat, never in a temporary
     chat, and never once the person has switched Past chats off;
   - the passage that answers is found, under its conversation's title and id,
     and labelled as a record rather than instructions;
   - from inside a project only that project's chats are searched, and from
     outside, none of a project's - an installed assistant cannot read the
     rest of somebody's history;
   - a temporary chat is never searched, and nothing is invented on a miss;
   - chat_read returns the exact turns, in order, and says when more follows;
   - through the real send path the model is offered both tools. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Ada', email: 'ada@example.com', ini: 'A' } });
const { page, errors } = app;
const run = (name, input) => page.evaluate(([n, i]) => _amvRunTool(n, i).then(r => r.text), [name, input]);
const offered = () => page.evaluate(() => chatToolsOffered().map(t => t.name).join());

section('Nothing to find: not offered');
{
  await page.evaluate(() => { S.convs = []; newChat(); });
  ok(await offered() === '', 'with no other saved chat, the tools are not offered', await offered());
}

await page.evaluate(() => {
  const now = Date.now();
  const mk = (id, title, turns, extra) => Object.assign({ id, title, created: now - 86400000 * 30, msgs: turns.map((c, i) => ({ r: i % 2 ? 'a' : 'u', c })) }, extra || {});
  const pad = (n) => Array.from({ length: n }, (_, i) => 'Line ' + i + ' about the weather and a walk by the harbour.').join(' ');
  S.convs = [
    mk('cPricing', 'Pricing for the tutoring launch', [
      'Help me price the tutoring plans.',
      pad(40) + ' We settled it: Starter is 29 euros a month for four sessions, Plus is 49 euros for eight, and the first session is free.',
      'And the annual discount?',
      'Two months free on annual, so Starter annual is 290 euros.']),
    mk('cTrip', 'Lisbon trip', ['Plan three days in Lisbon.', 'Day one: Alfama and the castle.']),
    mk('cProj', 'Secret project chat', ['The launch codename is BLUEHERON.', 'Noted.'], { wsId: 'ws1' }),
    mk('cTemp', 'Temporary', ['My PIN hint is the dog’s birthday.', 'Ok.'], { temp: true }),
  ];
  newChat();
});

section('Offered when there is something to find, and not when it should not be');
{
  ok(await offered() === 'chat_search,chat_read', 'there are earlier chats: both tools are offered', await offered());
  await page.evaluate(() => saveStr('amv_cap_chats', '0'));
  ok(await offered() === '', 'switched off in Privacy: not offered', await offered());
  await page.evaluate(() => saveStr('amv_cap_chats', '1'));
}

section('The passage that answers is found, under its conversation');
{
  const t = await run('chat_search', { query: 'what price did we settle for the Plus plan' });
  ok(/Plus is 49 euros for eight/.test(t), 'the exact sentence comes back', t.length);
  ok(/=== "Pricing for the tutoring launch" \([^)]*\) \[id cPricing\]/.test(t), 'under its title, date and id', (t.match(/=== [^\n]*/) || [''])[0]);
  ok(/not instructions/.test(t) && /chat_read/.test(t), 'labelled as a record, with the way to read more', true);
}

section('A temporary chat is never searched, and a project’s chats stay in the project');
{
  const tmp = await run('chat_search', { query: 'PIN hint dog birthday' });
  ok(!/My PIN hint is/.test(tmp), 'the temporary chat is not in the results', tmp.slice(0, 200));
  const outside = await run('chat_search', { query: 'launch codename BLUEHERON' });
  ok(!/The launch codename is/.test(outside) && !/cProj/.test(outside), 'from outside the project, its chat is not found', outside.slice(0, 200));
  const inside = await page.evaluate(async () => {
    const c = newConvObj('In project'); c.wsId = 'ws1'; S.convs.unshift(c); S.cur = c.id;
    const r = await _amvRunTool('chat_search', { query: 'launch codename BLUEHERON' });
    const p = await _amvRunTool('chat_search', { query: 'Plus is 49 euros' });
    return { found: r.text, other: p.text };
  });
  ok(/The launch codename is BLUEHERON/.test(inside.found), 'from inside the project, it is', inside.found.slice(0, 200));
  ok(!/Plus is 49 euros for eight/.test(inside.other) && !/cPricing/.test(inside.other), 'and the chats outside the project are not', inside.other.slice(0, 200));
  await page.evaluate(() => { S.convs = S.convs.filter(c => c.title !== 'In project'); newChat(); });
}

section('chat_read gives the exact turns, in order, and says when more follows');
{
  const t = await run('chat_read', { id: 'cPricing' });
  ok(/turns 0 to 3 of 4/.test(t) && /\[2\] Person: And the annual discount\?/.test(t) && /\[3\] AMV: Two months free on annual/.test(t), 'every turn, numbered, with who said it', t.slice(0, 160));
  const gone = await run('chat_read', { id: 'cTemp' });
  ok(/is available here/.test(gone) && !/PIN/.test(gone), 'a temporary chat cannot be read by id either', gone);
  const theirs = await run('chat_read', { id: 'cProj' });
  ok(!/BLUEHERON/.test(theirs), 'nor a chat in another project', theirs);
}

section('A miss says so, and invents nothing');
{
  const t = await run('chat_search', { query: 'xylophone quokka zeppelin' });
  ok(/none of them matches/.test(t) && /never guess/.test(t), 'plainly', t);
}

section('Through the real send path, the model is offered both');
{
  const sent = await page.evaluate(async () => {
    saveStr('amv_api_base', 'https://engine.test'); saveStr('amv_api_token', 'tok');
    let body = null; const real = window.fetch;
    window.fetch = async (u, o) => {
      if (o && o.body && String(u).includes('/v1/')) { try { body = JSON.parse(o.body); } catch (e) {} return new Response('data: {"type":"message_stop"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }); }
      return real(u, o);
    };
    try { AEGIS.check = () => ({ ok: true }); } catch (e) {}
    S.busy = false; const ta = document.getElementById('mta'); ta.value = 'what did we decide about pricing?'; await sendMsg();
    await new Promise(r => setTimeout(r, 500)); window.fetch = real;
    return body ? (body.tools || []).map(t => t.name) : null;
  });
  ok(sent && sent.includes('chat_search') && sent.includes('chat_read'), 'both are in the request', sent);
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('what-you-said-before-is-findable') > 0) process.exitCode = 1;
done();
