/* HANDED-OVER WORK OPENS AS ITSELF, AND COMES BACK WITH THE OTHER PERSON'S
   WORK IN IT (owner, Nov 24).

   Two people in one browser, against a stand-in of the server's shared copy
   (the real handlers are held in handed-over-work-is-shared-by-two):
     · "Pull in your work" attaches the chat as a card - the notes box stays
       empty, nothing is pasted;
     · sending carries the real messages, and links Alice's chat to the copy;
     · Bob opens it as a real chat with those messages; what he adds saves back;
     · Alice opens her own chat and finds Bob's message in it;
     · both saving at once loses neither message;
     · a design goes across as a design. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: 'https://backend.example.workers.dev', viewport: { width: 1280, height: 900 },
                            user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;
await page.waitForTimeout(500);

await page.evaluate(() => {
  try { Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true }); } catch (e) {}
  try { Object.defineProperty(AMV_API, 'hasSession', { configurable: true, get: () => true }); } catch (e) {}
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const srv = window.__srv = { items: {}, n: 0, saves: 0 };
  AMV_API.listHandoff = async () => ({ ok: true, incoming: [], sent: [] });
  AMV_API.createHandoff = async (h) => {
    const id = 'h' + String(++srv.n).padStart(10, '0');
    if (h.item) srv.items[id] = { id, kind: h.item.kind, title: h.item.title, v: 1, by: S.user.email, from: S.user.email, to: h.to, data: clone(h.item.data) };
    srv.last = clone(h);
    return { ok: true, id };
  };
  AMV_API.handoffItem = async (id) => { const it = srv.items[id]; if (!it) throw new Error('not found'); return clone(it); };
  AMV_API.handoffItemSave = async (id, base, data) => {
    const it = srv.items[id]; srv.saves++;
    if (it.v !== base) return { stale: true, item: clone(it) };
    it.v++; it.data = clone(data); it.by = S.user.email; return { ok: true, v: it.v };
  };
});

section('Pulling in a chat attaches it as itself');
const pulled = await page.evaluate(async () => {
  const c = newConvObj('Launch email');
  c.msgs = [{ r: 'u', c: 'Draft the launch email' }, { r: 'a', c: 'Here is a first draft of the launch email.' }];
  S.convs.unshift(c); window.__aliceConv = c.id;
  setTab('handoff'); await new Promise(r => setTimeout(r, 200));
  _hoPullConv(c.id);
  const card = document.querySelector('#ho-work .ho-work');
  return { card: card ? card.textContent.replace(/\s+/g, ' ').trim() : '', notes: document.getElementById('ho-ctx').value };
});
ok(/Chat/.test(pulled.card) && /Launch email/.test(pulled.card), 'the form shows the chat as a card', pulled.card);
ok(pulled.notes === '', 'and pastes nothing into the notes', pulled.notes);

section('Sending carries the real messages and links the chat');
const sent = await page.evaluate(async () => {
  document.getElementById('ho-title').value = 'Finish the launch email';
  document.getElementById('ho-to').value = 'bob@x.com';
  await hoSend();
  const c = S.convs.find(x => x.id === window.__aliceConv);
  return { item: window.__srv.last.item, ho: c.ho, n: Object.keys(window.__srv.items).length };
});
ok(sent.item && sent.item.kind === 'chat' && sent.item.data.msgs.length === 2 && sent.item.data.msgs.every(m => m.id), 'the server got the chat, every message with an id', sent.item);
ok(sent.ho && sent.ho.id && sent.ho.v === 1 && sent.ho.role === 'from', 'Alice’s chat is linked to the shared copy', sent.ho);
const HID = sent.ho.id;

section('Bob opens it as a real chat, and his work saves back');
const bob = await page.evaluate(async (hid) => {
  window.__aliceConvs = S.convs; S.convs = [];            /* Bob's device: none of Alice's chats */
  S.user = Object.assign({}, S.user, { email: 'bob@x.com', name: 'Bob' });
  await _hoOpenItem(hid);
  await new Promise(r => setTimeout(r, 200));
  const c = S.convs.find(x => x.ho && x.ho.id === hid);
  const opened = { tab: S.tab, cur: S.cur === (c && c.id), msgs: c ? c.msgs.length : 0, role: c && c.ho.role };
  c.msgs.push({ r: 'u', c: 'Make it shorter, please' });
  renderHist();
  await new Promise(r => setTimeout(r, 2200));
  return { opened, server: window.__srv.items[hid] };
}, HID);
ok(bob.opened.tab === 'chat' && bob.opened.cur && bob.opened.msgs === 2 && bob.opened.role === 'to', 'it opens on the chat screen with Alice’s two messages', bob.opened);
ok(bob.server.v === 2 && bob.server.data.msgs.length === 3 && /shorter/.test(bob.server.data.msgs[2].c), 'Bob’s message saved back as version 2', bob.server.data.msgs.map(m => m.c));

section('Alice opens her chat and finds Bob’s work in it');
const alice = await page.evaluate(async () => {
  window.__bobConvs = S.convs; S.convs = window.__aliceConvs;
  S.user = Object.assign({}, S.user, { email: 'alice@x.com', name: 'Alice' });
  loadConv(window.__aliceConv);
  await new Promise(r => setTimeout(r, 500));
  const c = S.convs.find(x => x.id === window.__aliceConv);
  return { msgs: c.msgs.map(m => m.c), v: c.ho.v, shown: (document.getElementById('msgs') || document.body).innerText.includes('Make it shorter') };
});
ok(alice.msgs.length === 3 && /shorter/.test(alice.msgs[2]) && alice.v === 2, 'her chat now has her work and his', alice.msgs);
ok(alice.shown, 'and it is on her screen', alice.shown);

section('Both saving at once loses neither');
const both = await page.evaluate(async (hid) => {
  const srv = window.__srv;
  /* Bob saves straight to the server first... */
  const it = srv.items[hid];
  it.data.msgs.push({ id: 'mbob2', r: 'u', c: 'Bob: also add the price' }); it.v++;
  /* ...while Alice, still on the version before, writes too. */
  const c = S.convs.find(x => x.id === window.__aliceConv);
  c.msgs.push({ r: 'u', c: 'Alice: send it Friday' });
  renderHist();
  await new Promise(r => setTimeout(r, 2500));
  return { server: srv.items[hid].data.msgs.map(m => m.c), local: c.msgs.map(m => m.c), v: srv.items[hid].v };
}, HID);
ok(both.server.some(c => /add the price/.test(c)) && both.server.some(c => /Friday/.test(c)), 'the shared copy has both new messages', both.server);
ok(both.local.some(c => /add the price/.test(c)) && both.local.some(c => /Friday/.test(c)), 'and so does Alice’s chat', both.local);

section('A design goes across as a design');
const design = await page.evaluate(async () => {
  const rec = { id: 'sess_test1', kind: 'studio', title: 'Bakery landing page', updated: Date.now(),
    state: { prompt: 'A bakery site', artifacts: [{ id: 'a1', html: '<h1>Fresh bread</h1>', brief: 'Warm, simple' }], activeId: 'a1' } };
  _SESSIONS.push(rec);
  setTab('handoff'); await new Promise(r => setTimeout(r, 200));
  _hoPullSession(rec.id);
  document.getElementById('ho-title').value = 'Finish the bakery page';
  document.getElementById('ho-to').value = 'bob@x.com';
  await hoSend();
  const hid = rec.ho && rec.ho.id;
  const idx = _SESSIONS.indexOf(rec); _SESSIONS.splice(idx, 1);   /* Bob's device */
  S.user = Object.assign({}, S.user, { email: 'bob@x.com' });
  await _hoOpenItem(hid);
  await new Promise(r => setTimeout(r, 400));
  const got = _SESSIONS.find(x => x.ho && x.ho.id === hid && x !== rec);
  return { kind: got && got.kind, html: got && got.state.artifacts[0].html, tab: S.tab, sent: window.__srv.last.item.kind };
});
ok(design.sent === 'studio' && design.kind === 'studio' && /Fresh bread/.test(design.html), 'it arrives as a design, with its markup', design);
ok(design.tab === 'studio' || design.tab === 'build', 'and opens in the design tool', design.tab);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors);

report();
await app.close();
done();
