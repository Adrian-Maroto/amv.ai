/* A PHOTO FROM A PHONE IS SENT, AND ANSWERED.

   Attaching a photo failed in production. The page sent it as it was - three
   to five megabytes from a phone - and the server's one-megabyte bound on a
   request refused it before reading it. No suite saw it: the test harness
   never declared a request's length, which is the header the bound reads.
   It does now, so this runs against the same check a browser meets.

   In a real page, through the real server:
   - a 12-megapixel photo is redrawn to what the engine reads (1,568 pixels
     on the long edge) before it is sent, and a small picture is left alone;
   - a free account sends it and is answered;
   - a PDF too large for one request is refused when attached, by name, with
     what to do - not after somebody has typed their question;
   - a long conversation keeps its newest files and says which older ones are
     no longer attached, instead of being refused whole. */
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
  const chat = Array.isArray(body.tools) && body.tools.length > 0;
  if (chat) modelSaw.push(body);
  return new Response(chat && nextTurns.length ? nextTurns.shift() : text('Done.'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
});
const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9253', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
  AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = o => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { vals.set(n, cur + b.amount); return r({ allowed: true, value: vals.get(n) }); }
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur });
  } }) },
});
const L = await bootLive({ env, outbound, port: 9253 });
const { page } = L;

async function say(t) {
  await page.waitForFunction(() => S.busy === false, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const n = modelSaw.length;
  await page.evaluate((t) => { setTab('chat'); const box = document.getElementById('mta'); box.value = t; box.dispatchEvent(new Event('input', { bubbles: true })); sendMsg(); }, t);
  for (let i = 0; i < 80 && modelSaw.length === n; i++) await page.waitForTimeout(100);
  await page.waitForFunction(() => S.busy === false, null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(600); await L.settle();
}
const names = (b) => (b && b.tools || []).map(t => t.name);
const lastToolResult = () => {
  for (const b of [...modelSaw].reverse()) for (const m of [...(b.messages || [])].reverse()) {
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    const r = m.content.find(c => c && c.type === 'tool_result');
    if (r) return typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
  }
  return '';
};


section('A 12-megapixel photo is sent at the size the engine reads; a small picture is left alone');
const shot = await page.evaluate(async () => {
  const mk = async (w, h, type, q, noisy) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#2a6'); gr.addColorStop(1, '#a62'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    if (noisy) { const d = g.getImageData(0, 0, w, h); for (let i = 0; i < d.data.length; i += 4) { const n = (Math.random() * 90) | 0; d.data[i] += n; d.data[i + 1] -= n; } g.putImageData(d, 0, 0); }
    const b = await new Promise(r => c.toBlob(r, type, q));
    return new File([b], type === 'image/png' ? 'small.png' : 'IMG_0001.jpg', { type });
  };
  const big = await mk(4032, 3024, 'image/jpeg', 0.95, true);
  const att = await amvReadFile(big);
  const dims = await new Promise(res => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.src = 'data:' + att.mime + ';base64,' + att.b64; });
  const small = await mk(800, 600, 'image/png', 1, false);
  const satt = await amvReadFile(small);
  window.__photo = att;
  return { orig: big.size, sent: Math.round(att.b64.length * 3 / 4), mime: att.mime, dims, smallMime: satt.mime, smallSame: satt.b64.length === Math.ceil(small.size / 3) * 4 };
});
ok(shot.orig > 3 * 1024 * 1024, 'the photo is the size a phone takes', shot.orig);
ok(shot.dims[0] === 1568 && shot.dims[1] === 1176 && shot.mime === 'image/jpeg', 'it is redrawn to 1,568 pixels on the long edge, keeping its shape', shot);
ok(shot.sent < shot.orig / 3, 'and what is sent is a fraction of the file', shot);
ok(shot.smallMime === 'image/png' && shot.smallSame, 'a small picture is sent exactly as it was', shot);

section('A free account sends it and is answered');
{
  await page.evaluate(async () => {
    openAuth('signup'); await __amvAuthOpen();
    const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Ana'); type('#a-email', 'ana@example.com'); type('#a-pass', 'A-real-Passw0rd!');
    document.getElementById('auth-submit').click(); await __amvSignedIn();
  });
  nextTurns = [text('A green and orange gradient.')];
  const n = modelSaw.length;
  await page.evaluate(() => { setTab('chat'); S.att = window.__photo; const box = document.getElementById('mta'); box.value = 'What is in this photo?'; sendMsg(); });
  for (let i = 0; i < 150 && modelSaw.length === n; i++) await page.waitForTimeout(100);
  await page.waitForFunction(() => S.busy === false, null, { timeout: 45000 }).catch(() => {});
  const last = await page.evaluate(() => (getMsgs() || []).slice(-1)[0] || {});
  ok(modelSaw.length > n, 'the request reached the engine - the server read it, length declared', { saw: modelSaw.length - n, err: last._error });
  const img = ((modelSaw[modelSaw.length - 1] || {}).messages || []).flatMap(m => Array.isArray(m.content) ? m.content : []).find(b => b.type === 'image');
  ok(img && img.source.data.length < 3 * 1024 * 1024, 'with the picture in it', img && img.source.data.length);
  ok(/gradient/.test(last.c || '') && !last._error, 'and the answer arrived', last.c || last._error);
  const why = L.hit(/^\/v1\/messages$/).map(s => s.status);
  ok(why.length && why.every(s => s === 200), 'no part of it was refused on the way', why);
}

section('A PDF too large for one request is refused when it is attached, by name');
{
  const r = await page.evaluate(async () => {
    const body = '%PDF-1.4\n' + 'x'.repeat(7 * 1024 * 1024) + '\n%%EOF';
    const att = await amvReadFile(new File([body], 'annual-report.pdf', { type: 'application/pdf' }));
    return { kind: att.kind, reason: att.reason || '' };
  });
  ok(r.kind === 'refused' && /annual-report\.pdf/.test(r.reason) && /6 MB/.test(r.reason) && /pages you need/.test(r.reason), 'refused at once, naming the file, the limit and what to do', r);
}

section('A long conversation keeps its newest files and says which older ones are gone');
{
  const r = await page.evaluate(() => {
    const pic = (i) => ({ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: String(i).repeat(1500000) } }, { type: 'text', text: 'photo ' + i }] });
    const out = [];
    for (let i = 0; i < 8; i++) { out.push(pic(i)); out.push({ role: 'assistant', content: 'ok' }); }
    out.push(pic(8));
    const wire = _wireFilesWithin(out);
    const kept = wire.filter(m => Array.isArray(m.content) && m.content.some(b => b.type === 'image')).map(m => m.content[1].text);
    const gone = wire.filter(m => Array.isArray(m.content) && m.content.some(b => b.type === 'text' && /no longer attached/.test(b.text))).length;
    const chars = wire.reduce((n, m) => n + (Array.isArray(m.content) ? m.content.reduce((k, b) => k + ((b.source && b.source.data) || '').length, 0) : 0), 0);
    return { kept, gone, chars, budget: WIRE_FILES_CHARS };
  });
  ok(r.kept[r.kept.length - 1] === 'photo 8' && r.kept.length === 5, 'the newest five photos are kept, the latest among them', r.kept);
  ok(r.gone === 4, 'the four older ones are replaced by a line saying so', r.gone);
  ok(r.chars <= r.budget, 'and the request stays within what the server takes', r);
}

ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 3));
await L.close();
if (report('a-photo-from-a-phone-is-sent') > 0) process.exitCode = 1;
done();
