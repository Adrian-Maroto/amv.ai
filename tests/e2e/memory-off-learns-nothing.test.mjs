/* MEMORY OFF LEARNS NOTHING, AND WHAT IS LEARNED STAYS WHERE IT WAS LEARNED
   (Build 16 audit AG-08, AG-09, AG-10, Nov 20).

   After every third message AMV asks a model what it learned about the person.
   The audit drove that extraction and found three ways it broke its word:
   - with Memory switched off it still asked, and kept the answer;
   - a secret the model proposed was kept, though every door a person uses
     refuses one;
   - a fact learned in one project landed in whichever project was open when
     the model answered.
   Here the real extraction runs on the page with the model replaced, so the
   test decides when it answers. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page, errors } = app;

await page.evaluate(() => {
  window.__asks = 0; window.__answer = null; window.__hold = null;
  window.aiComplete = async () => {
    window.__asks++;
    if (window.__hold) return new Promise(r => { window.__release = () => r(window.__answer); });
    return window.__answer;
  };
  window._aiBackendReady = () => true;
  window.__msgs = [{ r: 'u', c: 'I run a bakery.' }, { r: 'a', c: 'Nice.' }, { r: 'u', c: 'I like short answers.' }, { r: 'a', c: 'Noted.' }, { r: 'u', c: 'Help me plan.' }];
  S.memory = [];
});

section('Memory off: nothing is asked and nothing is kept');
{
  const r = await page.evaluate(async () => {
    saveStr('amv_cap_memory', '0');
    window.__answer = JSON.stringify(['Runs a bakery']);
    await _maybeExtractMemory(window.__msgs);
    const chat = await _sectionTool('memory_add', { text: 'I live in Porto' });
    return { asks: window.__asks, kept: S.memory.length, chat: chat.text };
  });
  ok(r.asks === 0, 'no model is asked what it learned', r);
  ok(r.kept === 0, 'and nothing is remembered', r);
  ok(/Memory is off/.test(r.chat), 'asking chat to remember is told Memory is off', r.chat);
}

section('Switched off while the model is answering: the answer is dropped');
{
  const r = await page.evaluate(async () => {
    saveStr('amv_cap_memory', '1'); window.__asks = 0; window.__hold = true;
    window.__answer = JSON.stringify(['Runs a bakery']);
    const p = _maybeExtractMemory(window.__msgs);
    await new Promise(r => setTimeout(r, 30));
    saveStr('amv_cap_memory', '0');
    window.__release(); await p;
    window.__hold = null; saveStr('amv_cap_memory', '1');
    return { asks: window.__asks, kept: S.memory.length };
  });
  ok(r.asks === 1 && r.kept === 0, 'the model was asked, and its answer was not kept', r);
}

section('A secret the model proposes is never kept');
{
  const r = await page.evaluate(async () => {
    window.__answer = JSON.stringify(['My password is hunter2-test', 'Card 4242 4242 4242 4242', 'Runs a bakery']);
    await _maybeExtractMemory(window.__msgs);
    return S.memory.map(m => m.text);
  });
  ok(r.length === 1 && r[0] === 'Runs a bakery', 'the password and the card are refused; the bakery is remembered', r);
}

section('Forgotten while the model is answering: it is not learned back');
{
  const r = await page.evaluate(async () => {
    window.__hold = true;
    window.__answer = JSON.stringify(['Likes short answers']);
    const p = _maybeExtractMemory(window.__msgs);
    await new Promise(r => setTimeout(r, 30));
    _memForget(S.memory.map(m => m.id));
    window.__release(); await p; window.__hold = null;
    return S.memory.map(m => m.text);
  });
  ok(r.length === 0, 'a forget during the request is not undone by its answer', r);
}

section('Learned in one project, kept in that project');
{
  const r = await page.evaluate(async () => {
    S.workspaces = [{ id: 'wsA', name: 'Client A', memory: [] }, { id: 'wsB', name: 'Client B', memory: [] }];
    S.memory = [];
    S.convs.push({ id: 'c-wsA', wsId: 'wsA', msgs: [] }, { id: 'c-wsB', wsId: 'wsB', msgs: [] });
    S.cur = 'c-wsA';
    window.__hold = true;
    window.__answer = JSON.stringify(['Client A ships on Fridays', 'My API key is sk-test-123']);
    const p = _maybeExtractMemory(window.__msgs);
    await new Promise(r => setTimeout(r, 30));
    S.cur = 'c-wsB';                   // the person moved to the other project
    window.__release(); await p; window.__hold = null;
    const a = S.workspaces.find(w => w.id === 'wsA').memory.map(m => m.text);
    const b = S.workspaces.find(w => w.id === 'wsB').memory.map(m => m.text);
    return { a, b, general: S.memory.length };
  });
  ok(r.a.length === 1 && r.a[0] === 'Client A ships on Fridays', 'the fact is in project A, where it was learned', r);
  ok(r.b.length === 0 && r.general === 0, 'not in project B, which was open when the answer came, nor in general memory', r);
  ok(!r.a.some(t => /sk-test/.test(t)), 'and project memory refuses a key too', r.a);
}

section('A project deleted meanwhile keeps nothing');
{
  const r = await page.evaluate(async () => {
    S.workspaces = [{ id: 'wsC', name: 'Client C', memory: [] }];
    S.convs.push({ id: 'c-wsC', wsId: 'wsC', msgs: [] });
    S.cur = 'c-wsC';
    window.__hold = true; window.__answer = JSON.stringify(['Client C pays in euros']);
    const p = _maybeExtractMemory(window.__msgs);
    await new Promise(r => setTimeout(r, 30));
    S.workspaces = [];
    S.cur = null;
    window.__release(); await p; window.__hold = null;
    return { general: S.memory.map(m => m.text) };
  });
  ok(r.general.length === 0, 'its fact does not fall into general memory', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
