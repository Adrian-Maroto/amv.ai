/* "CONNECT MY POINT72 ACCOUNT" HAS TO DO SOMETHING REAL.

   Asked for: even if it is not in Connectors, telling main chat (or the Crew)
   to connect something makes it connect - "make sure main chat can connect to
   anything". Chat had no way to connect anything at all: it could describe the
   Integrations page and nothing more.

   connect_account resolves a name in a fixed order and every step ends in
   something real: the directory row's own Connect, a mailbox's app-password
   setup, a connector from the open registry (run on the person's computer), or
   - when there is nothing to connect to - the real alternatives, and Notify me,
   which is recorded. It draws a card; the person presses; nothing is connected
   by the tool itself, and the model is told so.

   Driven end to end: a real message in the real composer, the model's tool
   call streamed back through the real Worker, the card in the conversation,
   and each button pressed. The model's side is scripted; what AMV does with
   the call is not. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

/* An SSE stream in the shape the model really returns, so the client's own
   parser does the work rather than a shortcut written for this file. */
function toolUseStream(name, input, text) {
  const ev = (t, d) => 'event: ' + t + '\ndata: ' + JSON.stringify(d) + '\n\n';
  let s = ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } });
  let i = 0;
  if (text) {
    s += ev('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
    s += ev('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text } });
    s += ev('content_block_stop', { type: 'content_block_stop', index: i });
    i++;
  }
  s += ev('content_block_start', { type: 'content_block_start', index: i,
          content_block: { type: 'tool_use', id: 'tu_' + Math.random().toString(36).slice(2, 8), name } });
  s += ev('content_block_delta', { type: 'content_block_delta', index: i,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
  s += ev('content_block_stop', { type: 'content_block_stop', index: i });
  s += ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } });
  s += ev('message_stop', { type: 'message_stop' });
  return s;
}
/* The turn AFTER a tool ran: the model just talks. */
function textStream(text) {
  const ev = (t, d) => 'event: ' + t + '\ndata: ' + JSON.stringify(d) + '\n\n';
  return ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 20, output_tokens: 0 } } })
       + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
       + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
       + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
       + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 25 } })
       + ev('message_stop', { type: 'message_stop' });
}

/* What the stubbed model does on its next turn, and every request body it was
   sent - so a case can assert on what AMV really offered it. */
let nextTurns = [];
const modelSaw = [];
const outbound = makeOutbound();
outbound.on(/model\.example/, (_u, opts) => {
  let body = {};
  try { body = JSON.parse(String(opts.body || '{}')); } catch (e) {}
  modelSaw.push(body);
  /* Only a CHAT turn gets a scripted response. AMV makes other model calls
     around a conversation - naming it, for one - and a blind queue handed those
     the scripted tool call instead: the crew_add stream went to a title
     request, the turn that was supposed to create a job created nothing, and
     the leftover stream fired on a later message and created one nobody asked
     for. A chat turn is the one carrying the tool definitions. */
  const isChatTurn = Array.isArray(body.tools) && body.tools.length > 0;
  const sse = (isChatTurn && nextTurns.length) ? nextTurns.shift() : textStream('Done.');
  return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
});
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9187',
  CONNECT_KEY: 'k'.repeat(48),
  SLACK_CLIENT_ID: 'test-slack-id', SLACK_CLIENT_SECRET: 'test-slack-secret',
  AMV_MODEL_KEY: 'k',
  MODEL_API_URL: 'https://model.example',
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body);
      const cur = vals.get(n) || 0;
      if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) })); }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
      if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
      return new Response(JSON.stringify({ allowed: true, value: cur }));
    } }),
  },
});

const L = await bootLive({ env, outbound, port: 9187 });
const { page } = L;

const EMAIL = 'connectall@example.com';
const PW = 'A-real-Passw0rd!';
const KV = env.AMV_KV;
const jobs = async () => {
  const v = await KV.get('auto:' + EMAIL);
  try { return (JSON.parse(v || '{}').items) || []; } catch (e) { return []; }
};
const standingOnServer = async () => {
  const v = await KV.get('auto:' + EMAIL);
  try { return JSON.parse(v || '{}').standing || ''; } catch (e) { return ''; }
};

/* Send a real message through the real composer, answering the approval
   dialog the way this case says. */
/* One approval watcher for the whole file, installed once and never expiring,
   reading a flag the current case sets. Arming a fresh watcher per turn coupled
   the assertions to how long a turn took: a dialog that opened after the
   watcher's timeout was never answered, the turn hung waiting on it, and the
   case reported "they were never asked" about a dialog sitting on the screen. */
async function armConsent() {
  await page.evaluate(() => {
    if (window.__consentArmed) return;
    window.__consentArmed = true;
    window.__consent = { seen: 0, title: '', body: '' };
    window.__approve = true;
    setInterval(() => {
      const m = document.getElementById('modal-box');
      if (!m || !m.isConnected) return;
      const btns = [...m.querySelectorAll('button')];
      const allow = btns.find(b => /allow/i.test(b.textContent || ''));
      const deny = btns.find(b => /deny|cancel/i.test(b.textContent || ''));
      if (!allow && !deny) return;
      window.__consent.seen++;
      window.__consent.title = (m.querySelector('h2,h3,.mdl-t') || {}).textContent || '';
      window.__consent.body = (m.textContent || '').replace(/\s+/g, ' ').trim();
      const pick = window.__approve ? allow : (deny || allow);
      if (pick) pick.click();
    }, 100);
  });
}
await armConsent();

async function say(text, { approve = true } = {}) {
  /* A gap between messages, because AMV has a burst limiter and is right to.
     Sending these back to back tripped it, and the turn was answered with
     "too many requests in a few seconds" instead of reaching the model - which
     read exactly like a broken tool and was the protection working. */
  await page.waitForTimeout(3000);
  await page.evaluate((yes) => {
    window.__approve = yes;
    window.__consent = { seen: 0, title: '', body: '' };
  }, approve);

  await page.evaluate(async (t) => {
    setTab('chat');
    await new Promise(x => setTimeout(x, 300));
    const box = document.getElementById('mta');
    box.value = t;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    sendMsg();
  }, text);
  /* Wait for the turn to actually FINISH rather than for a fixed number of
     milliseconds. A tool turn is two model round trips with a dialog in the
     middle, and a fixed wait read the approval count before the dialog had
     even appeared - reporting "they were never asked" for a turn that asked
     them a fraction of a second later. */
  /* Wait for the turn to START before waiting for it to finish.

     `S` is a top-level const in a classic script - a script-scoped binding, NOT
     a property of window - so a predicate written as `window.S && ...` waits
     out its whole timeout. And waiting only for busy===false returns instantly,
     because the previous turn has already finished: the first tool case read
     the approval count before the dialog existed and reported that nobody was
     ever asked, for a turn that asked a moment later. */
  await page.waitForFunction(() => typeof S !== 'undefined' && S.busy === true,
                             null, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => typeof S !== 'undefined' && S.busy === false,
                             null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  await L.settle();

  /* AMV's burst limiter counts every request, and a tool turn is two of them -
     so a run of tool messages trips it even with a pause between each. When it
     does the turn is answered with "too many requests" and never reaches the
     model, which looks exactly like a tool that does not work. Back off and
     send it again, once, the way a person would. */
  const limited = await page.evaluate(() => {
    const m = getMsgs();
    const last = m[m.length - 1];
    return !!(last && last.r === 'a' && /too many requests|request limit/i.test(String(last.c || '')));
  });
  if (limited) {
    await page.waitForTimeout(9000);
    await page.evaluate(async (t) => {
      const box = document.getElementById('mta');
      box.value = t;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      sendMsg();
    }, text);
    await page.waitForFunction(() => typeof S !== 'undefined' && S.busy === true,
                               null, { timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => typeof S !== 'undefined' && S.busy === false,
                               null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(500);
    await L.settle();
  }
  return page.evaluate(() => window.__consent);
}


/* The open registry, answered the way it really answers - one entry named for
   what the person asked about, one that is not. */
outbound.on(/registry\.modelcontextprotocol\.io/, () => new Response(JSON.stringify({ servers: [
  { server: { name: 'io.github.acme/acme-widgets-mcp', title: 'Acme Widgets', description: 'Orders and stock in Acme Widgets.', version: '1.2.0',
      packages: [{ registryType: 'npm', identifier: '@acme/widgets-mcp', version: '1.2.0', transport: { type: 'stdio' },
        environmentVariables: [{ name: 'ACME_TOKEN', isRequired: true, isSecret: true, description: 'Your Acme API token.' }] }] } },
  { server: { name: 'io.github.someone/unrelated', title: 'Unrelated', description: 'Something else.', version: '0.1.0',
      packages: [{ registryType: 'npm', identifier: 'unrelated-mcp', transport: { type: 'stdio' } }] } },
], metadata: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

const lastCard = () => page.evaluate(() => {
  const m = getMsgs(); const last = [...m].reverse().find(x => x.r === 'a' && x._rendered);
  const html = (last && last._rendered) || '';
  const box = document.createElement('div'); box.innerHTML = html;
  return { html, buttons: [...box.querySelectorAll('.cx-btn')].map(b => ({ code: b.dataset.darg, label: b.textContent.trim() })),
           title: (box.querySelector('.cx-t') || {}).textContent || '' };
});
const toolResultSent = () => {
  for (let i = modelSaw.length - 1; i >= 0; i--) {
    const msgs = modelSaw[i].messages || [];
    for (let j = msgs.length - 1; j >= 0; j--) {
      const c = msgs[j].content;
      if (Array.isArray(c)) { const t = c.find(x => x && x.type === 'tool_result'); if (t) return String(t.content || ''); }
    }
  }
  return '';
};
const press = async (code) => {
  await page.evaluate(() => { const o = document.getElementById('ovr'); if (o) { o.innerHTML = ''; o.classList.remove('on'); } });
  await page.evaluate((c) => {
    const b = [...document.querySelectorAll('.chat-tool-out .cx-btn')].reverse().find(x => x.dataset.darg === c);
    if (b) b.click(); else window.__noBtn = c;
  }, code);
  await page.waitForTimeout(1200);
  return page.evaluate(() => ({ ovr: ((document.getElementById('ovr') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
                                prov: (document.getElementById('ml-prov') || {}).value || '', missing: window.__noBtn || '' }));
};

section('Signed in');
{
  await page.evaluate(async ([em, pw]) => {
    openAuth('signup');
    await __amvAuthOpen();
    const type = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Connect All'); type('#a-email', em); type('#a-pass', pw);
    document.getElementById('auth-submit').click();
    await __amvSignedIn();
  }, [EMAIL, PW]);
  /* On a paid plan, as a person using chat all day would be: seven turns with
     tools in a few minutes is more than the free plan's per-minute limit, and
     that limit answering is the protection working, not this feature failing. */
  await KV.put('ent:' + EMAIL, JSON.stringify({ plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  await page.evaluate(async () => { try { await syncEntitlement(); } catch (e) {} await new Promise(x => setTimeout(x, 500)); });
  ok(await page.evaluate(() => !!(S.user && S.user.email)), 'a real account, made through the Worker');
}

section('Chat is offered a way to connect things, and so is the Crew');
{
  nextTurns = [textStream('Hello.')];
  await say('hello');
  const offered = modelSaw.filter(b => Array.isArray(b.tools)).pop();
  const tool = offered && offered.tools.find(t => t.name === 'connect_account');
  ok(!!tool, 'the request chat really sent carries connect_account - the server did not drop it', offered && offered.tools.map(t => t.name));
  ok(tool && /never say an account is connected/i.test(tool.description || ''), 'and it tells the model a card is not a connection', (tool || {}).description);
  ok(await page.evaluate(() => _toolsFor('crew').some(t => t.name === 'connect_account')), 'the Crew surface has it too');
}

section('An app AMV connects: Slack\'s own sign-in, from a sentence');
{
  nextTurns = [toolUseStream('connect_account', { service: 'my Slack' }), textStream('Press the button to finish.')];
  const consent = await say('connect my slack');
  const card = await lastCard();
  ok(card.buttons.some(b => b.code === 'how:p:slack' && /Connect Slack/.test(b.label)), 'a Connect Slack button is in the conversation', card.buttons);
  ok(consent.seen === 0, 'with no permission prompt - drawing a button changes nothing', consent.seen);
  ok(/FOUND/.test(toolResultSent()) && /Do NOT say it is connected/.test(toolResultSent()), 'and the model is told nothing is connected until they finish', toolResultSent().slice(0, 160));
  const r = await press('how:p:slack');
  ok(/Slack/.test(r.ovr) && !r.missing, 'pressing it opens Slack\'s sign-in - the directory row\'s own flow', r.ovr.slice(0, 160) || r.missing);
}

section('A mailbox: QQ Mail opens its own app-password setup');
{
  nextTurns = [toolUseStream('connect_account', { service: 'QQ Mail' }), textStream('Set it up with the button.')];
  await say('connect my qq mail');
  const card = await lastCard();
  const btn = card.buttons.find(b => /qq/i.test(b.code));
  ok(!!btn, 'a QQ Mail setup button is shown', card.buttons);
  const r = btn ? await press(btn.code) : { prov: '', ovr: '' };
  ok(r.prov === 'qq' && /QQ/.test(r.ovr), 'and it opens the mailbox setup on QQ Mail, with QQ\'s own instructions', { prov: r.prov, ovr: r.ovr.slice(0, 120) });
}

section('Not in AMV, but in the open registry: shown with what it runs and asks for');
{
  nextTurns = [toolUseStream('connect_account', { service: 'Acme Widgets' }), textStream('It can be added.')];
  await say('connect my acme widgets account');
  const card = await lastCard();
  const add = card.buttons.find(b => /^reg:/.test(b.code));
  ok(add && /Acme Widgets/.test(add.label), 'the registry connector named for it is offered', card.buttons);
  ok(!card.buttons.some(b => /unrelated/i.test(b.code)), 'and not an unrelated one the registry also returned', card.buttons);
  ok(/THEIR OWN computer/.test(toolResultSent()) && /AMV did not write it/.test(toolResultSent()), 'the model is told it runs on their computer and AMV did not write it', toolResultSent().slice(0, 200));
  const r = add ? await press(add.code) : { ovr: '' };
  ok(/Add this connector/.test(r.ovr) && /ACME_TOKEN/.test(r.ovr) && /@acme\/widgets-mcp/.test(r.ovr),
     'pressing it opens the one detail view: the command, the credential it asks for, and Add', r.ovr.slice(0, 200));
}

section('Nothing to connect to - Point72 - says so, and offers what is real');
{
  nextTurns = [toolUseStream('connect_account', { service: 'my Point72 account' }), textStream('Here is what can be done.')];
  const consent = await say('link my point 72 account');
  const card = await lastCard();
  const sent = toolResultSent();
  ok(/NOT DIRECTLY CONNECTABLE/.test(sent) && /never claim a connection exists/.test(sent), 'the model is told plainly it is not connectable, and not to pretend', sent.slice(0, 160));
  ok(card.buttons.some(b => b.code === 'how:mail') && card.buttons.some(b => /^notify:/.test(b.code)),
     'the mailbox that receives its statements, and Notify me', card.buttons.map(b => b.label));
  ok(consent.seen === 0, 'still no prompt', consent.seen);
  const notify = card.buttons.find(b => /^notify:/.test(b.code));
  await press(notify.code);
  await page.waitForTimeout(800);
  await L.settle();
  const keys = (await KV.list({ prefix: 'waitlist:' })).keys.map(k => k.name);
  ok(keys.some(k => /app-point72/.test(k) && k.endsWith(EMAIL)), 'Notify me is recorded on the server, for this account', keys);
}

section('Something financial gets the bank link - which searches the institutions');
{
  nextTurns = [toolUseStream('connect_account', { service: 'my Fidelity brokerage' }), textStream('Link it with the button.')];
  await say('connect my fidelity brokerage');
  const card = await lastCard();
  ok(card.buttons.some(b => b.code === 'how:bank'), 'a bank-or-brokerage link is offered', card.buttons.map(b => b.label));
  ok(/searches thousands of banks, cards and brokerages/.test(toolResultSent()), 'and the model is told what that link really does, and what it means if it is not found', toolResultSent().slice(0, 240));
}

section('On a phone the card fits and every button can be pressed');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.chat-tool-out .cx-card')];
    const last = cards[cards.length - 1];
    const btns = last ? [...last.querySelectorAll('.cx-btn')] : [];
    return { n: cards.length, over: last ? last.scrollWidth > last.clientWidth + 1 : true,
             small: btns.filter(b => b.getBoundingClientRect().height < 32).length, btns: btns.length,
             pageOver: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  ok(r.n >= 4 && r.btns >= 2, 'the cards are in the conversation', r);
  ok(!r.over && !r.pageOver, 'nothing overflows sideways', r);
  ok(r.small === 0, 'every button at least 32px tall', r);
}

ok(L.errors.length === 0, 'no page errors', L.errors.slice(0, 3));
await L.close();
outbound.restore();
if (report('tell-chat-to-connect-anything') > 0) process.exitCode = 1;
done();
