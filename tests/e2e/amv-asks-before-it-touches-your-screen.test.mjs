/* AMV ASKS BEFORE IT TOUCHES YOUR SCREEN.

   The bridge's side - that --computer is the only way on, and that a click
   is a click - is measured on a real display in amv-uses-the-screen-only-
   when-you-started-it-so. This is the chat's side, driven through the real
   composer, the real Worker and the real approval dialogs, with the model's
   choices scripted and the bridge stood in for in the page:

   - the screen tools are offered only when a bridge started with --computer
     is connected - not with no bridge, not with an ordinary one;
   - seeing the screen is asked once for the request, and asked again for the
     next one;
   - the picture reaches the engine inside the tool result, shrunk to at most
     1280 wide, and is NOT saved with the chat;
   - a click is asked one by one, with the spot marked on the picture, and
     lands on the screen at the screen's own scale;
   - a click the person denies never reaches the computer;
   - text that looks like a password is refused before anybody is asked;
   - the server counts a picture nested in a tool result against its size
     limit. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ev = (t, d) => 'event: ' + t + '\ndata: ' + JSON.stringify(d) + '\n\n';
function toolUse(name, input) {
  return ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } })
    + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_' + Math.random().toString(36).slice(2, 9), name } })
    + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input || {}) } })
    + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
    + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } })
    + ev('message_stop', { type: 'message_stop' });
}
function text(t) {
  return ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } })
    + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })
    + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
    + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } })
    + ev('message_stop', { type: 'message_stop' });
}

let nextTurns = [];
const modelSaw = [];
const outbound = makeOutbound();
outbound.on(/model\.example/, (_u, opts) => {
  let body = {}; try { body = JSON.parse(String(opts.body || '{}')); } catch (e) {}
  modelSaw.push(body);
  const chat = Array.isArray(body.tools) && body.tools.length > 0;
  return new Response(chat && nextTurns.length ? nextTurns.shift() : text('Done.'),
                      { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
});
const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9183', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
  AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = o => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { vals.set(n, cur + b.amount); return r({ allowed: true, value: vals.get(n) }); }
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur });
  } }) },
});
const L = await bootLive({ env, outbound, port: 9183 });
const { page } = L;

/* One dialog watcher for the file: answers with the current choice, and
   records what each dialog showed - including the picture and its mark. */
await page.evaluate(() => {
  window.__dialogs = []; window.__approve = true;
  setInterval(() => {
    const m = document.getElementById('modal-box');
    if (!m || !m.isConnected || m.__seen) return;
    const allow = [...m.querySelectorAll('button')].find(b => /allow|let it/i.test(b.textContent || ''));
    const deny = [...m.querySelectorAll('button')].find(b => /deny|not now/i.test(b.textContent || ''));
    if (!allow || !deny) return;
    m.__seen = true;
    const mark = m.querySelector('.modal-fig-mark');
    window.__dialogs.push({ title: (m.querySelector('h2') || {}).textContent || '',
      fig: !!m.querySelector('.modal-fig img'), left: mark ? mark.style.left : '', top: mark ? mark.style.top : '' });
    (window.__approve ? allow : deny).click();
  }, 80);
});

/* AMV's burst limiter counts every request and a tool turn is several, so a
   run of them trips it - correctly. A turn answered "too many requests" never
   reached the model; it is sent again after a pause, as a person would. */
async function say(t) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForTimeout(attempt ? 9000 : 3000);
    await page.evaluate(async (t) => {
      setTab('chat'); await new Promise(x => setTimeout(x, 200));
      const box = document.getElementById('mta'); box.value = t;
      box.dispatchEvent(new Event('input', { bubbles: true })); sendMsg();
    }, t);
    await page.waitForFunction(() => typeof S !== 'undefined' && S.busy === true, null, { timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => typeof S !== 'undefined' && S.busy === false, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(400); await L.settle();
    const limited = await page.evaluate(() => { const m = getMsgs(); const l = m[m.length - 1];
      return !!(l && l.r === 'a' && /too many requests/i.test(String(l.c || ''))); });
    if (!limited) return;
  }
}
const lastToolsSent = () => ([...modelSaw].reverse().find(b => Array.isArray(b.tools)) || { tools: [] }).tools.map(t => t.name);

/* The bridge, stood in for: a 2560x1440 screen, every call recorded. */
const standIn = (computer) => page.evaluate((c) => {
  window.__calls = [];
  Object.assign(BRIDGE, { connected: true, port: 1, token: 't', folder: 'proj', fence: 'on', computer: c });
  _bridgeCall = async (route, body) => {
    window.__calls.push({ route, body });
    if (route === 'screen/shot') {
      const cv = document.createElement('canvas'); cv.width = 2560; cv.height = 1440;
      const g = cv.getContext('2d'); g.fillStyle = '#246'; g.fillRect(0, 0, 2560, 1440);
      return { png: cv.toDataURL('image/png').split(',')[1], width: 2560, height: 1440, scale: 1 };
    }
    return { ok: true };
  };
}, computer);

section('Signed in');
{
  await page.evaluate(async () => {
    openAuth('signup'); await __amvAuthOpen();
    const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Screen'); type('#a-email', 'screen@example.com'); type('#a-pass', 'A-real-Passw0rd!');
    document.getElementById('auth-submit').click(); await __amvSignedIn();
  });
  await env.AMV_KV.put('ent:screen@example.com', JSON.stringify({ plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  await page.evaluate(async () => { try { await syncEntitlement(); } catch (e) {} });
  ok(true, 'an account on a paid plan');
}

section('The screen tools are offered only when a bridge started with --computer is connected');
{
  nextTurns = [text('Hi.')];
  await say('hello');
  ok(!lastToolsSent().some(n => /^computer_/.test(n)), 'no bridge: no screen tools', lastToolsSent().filter(n => /^computer_/.test(n)));
  await standIn({ on: false, os: 'linux', why: 'off' });
  nextTurns = [text('Hi.')];
  await say('hello again');
  const t2 = lastToolsSent();
  ok(t2.includes('run_command') && !t2.some(n => /^computer_/.test(n)), 'an ordinary bridge: its folder tools, no screen tools', t2.filter(n => /^(run_|computer_)/.test(n)));
  await standIn({ on: true, os: 'linux', why: '' });
  nextTurns = [text('Hi.')];
  await say('and now');
  const t3 = lastToolsSent();
  ok(['computer_screenshot', 'computer_click', 'computer_type', 'computer_key', 'computer_scroll'].every(n => t3.includes(n)),
     'a bridge started with --computer: all five', t3.filter(n => /^computer_/.test(n)));
}

section('Seeing is asked once for the request; the picture reaches the engine and is not saved');
{
  await page.evaluate(() => { window.__dialogs = []; window.__calls = []; window.__approve = true; });
  modelSaw.length = 0;
  nextTurns = [toolUse('computer_screenshot'), toolUse('computer_screenshot'), toolUse('computer_click', { x: 640, y: 360 }), text('Clicked it.')];
  await say('click the middle of my screen');
  const d = await page.evaluate(() => window.__dialogs);
  const sees = d.filter(x => /see your screen/i.test(x.title));
  ok(sees.length === 1, 'asked once to see the screen, though it looked twice', d.map(x => x.title));
  const shotReq = modelSaw.find(b => (b.messages || []).some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'tool_result' && Array.isArray(c.content))));
  const tr = shotReq && shotReq.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).find(c => c.type === 'tool_result' && Array.isArray(c.content));
  const img = tr && tr.content.find(c => c.type === 'image');
  ok(img && img.source.media_type === 'image/jpeg' && img.source.data.length > 100, 'the engine received the picture inside the tool result');
  ok(tr && !('_shot' in tr), 'and nothing internal rode along with it');
  const w = await page.evaluate(() => _CU.w);
  ok(w === 1280, 'shrunk to 1280 wide from a 2560-wide screen', w);
  const saved = await page.evaluate(() => JSON.stringify(getMsgs()));
  ok(!/"data":"[A-Za-z0-9+/]{200,}/.test(saved) && !/base64,[A-Za-z0-9+/]{200,}/.test(saved), 'the saved chat holds no picture', saved.length);

  const click = d.find(x => /click here/i.test(x.title));
  ok(click && click.fig, 'the click was asked on its own, with the picture shown', d.map(x => x.title));
  ok(click && parseFloat(click.left) === 50 && parseFloat(click.top) === 50, 'and the mark where it will land', click);
  const act = await page.evaluate(() => window.__calls.filter(c => c.route === 'screen/act'));
  ok(act.length === 1 && act[0].body.kind === 'click' && act[0].body.x === 1280 && act[0].body.y === 720,
     'it landed at the screen’s own scale: 640,360 in the picture is 1280,720 on the screen', act);
}

section('The next request asks again');
{
  await page.evaluate(() => { window.__dialogs = []; });
  nextTurns = [toolUse('computer_screenshot'), text('Looked.')];
  await say('look again');
  const d = await page.evaluate(() => window.__dialogs.map(x => x.title));
  ok(d.filter(t => /see your screen/i.test(t)).length === 1, 'asked to see the screen again for a new request', d);
}

section('A denied click never reaches the computer');
{
  await page.evaluate(() => { window.__dialogs = []; window.__calls = []; });
  /* The screenshot is already allowed for this request by the time the click
     is asked, so the watcher can deny from the start: the only dialog is the click's. */
  nextTurns = [toolUse('computer_click', { x: 10, y: 10 }), text('OK.')];
  await page.evaluate(() => { window.__approve = false; });
  await say('click the corner');
  const r = await page.evaluate(() => ({ d: window.__dialogs.map(x => x.title), acts: window.__calls.filter(c => c.route === 'screen/act').length }));
  ok(r.d.some(t => /click here/i.test(t)), 'the click was asked', r.d);
  ok(r.acts === 0, 'denied, and nothing was sent to the computer', r.acts);
  await page.evaluate(() => { window.__approve = true; });
}

section('A password is refused before anybody is asked');
{
  await page.evaluate(() => { window.__dialogs = []; window.__calls = []; });
  modelSaw.length = 0;
  nextTurns = [toolUse('computer_type', { text: 'my password is Hunter2!xQ9' }), text('OK.')];
  await say('log me in');
  const r = await page.evaluate(() => ({ d: window.__dialogs.length, acts: window.__calls.filter(c => c.route === 'screen/act').length }));
  ok(r.d === 0, 'no dialog was shown for it', r.d);
  ok(r.acts === 0, 'and nothing was typed', r.acts);
  const said = JSON.stringify(modelSaw);
  ok(/will not type a password/i.test(said), 'the engine was told why, so it can ask the person instead');
}

section('The server counts a picture nested in a tool result');
{
  const big = 'A'.repeat(700000);
  const r = await page.evaluate(async (data) => {
    const res = await fetch(AMV_API.base + '/v1/messages', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, _aiHeaders()),
      body: JSON.stringify({ model: 'amv-core', max_tokens: 100, stream: true, messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'computer_screenshot', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }] }] },
      ] }) });
    return { status: res.status, body: await res.text() };
  }, big);
  ok(r.status === 400 && /too large/i.test(r.body), 'a 700KB picture inside a tool result is refused as too large', r);
}

if (report('amv-asks-before-it-touches-your-screen') > 0) process.exitCode = 1;
done();
