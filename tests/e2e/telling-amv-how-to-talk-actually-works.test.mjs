/* TWO WAYS TO TELL AMV HOW TO WRITE, AND ONE OF THEM DID NOTHING.

   The persistent half: instructions typed on the Personalization page, which
   must reach EVERY surface - chat, Build, Lab, Studio - not just chat.

   The per-conversation half: "keep this chat motivational", which must hold for
   that conversation and reset when a new one starts.

   The plumbing for the second half was all correct. The tone rides on the
   conversation object, reaches the system prompt through _chatToneContext, is
   picked up by _userStyle on the other surfaces, and resets on a new chat
   precisely because it is not in storage. And `_setChatTone` had NO CALLERS
   anywhere in the product, so saying the words did nothing at all.

   Present, correct, and unreachable. Which is why this file drives the words
   rather than the function: calling _setChatTone in a test would have passed
   happily for as long as the feature was broken. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Adrian', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());

section('What you type on the Personalization page reaches every surface');
{
  const r = await page.evaluate(() => {
    saveStr('amv_instructions', 'Always answer in Spanish and keep it under 50 words.');
    saveStr('amv_nickname', 'Adri');
    return { profile: _profileContext(), style: _userStyle() };
  });
  ok(/Spanish/.test(r.profile), 'chat sees the instruction', r.profile.slice(0, 60));
  ok(/Adri/.test(r.profile), 'and the name they asked to be called');
  /* _userStyle is the form Build, Lab and Studio append. If this is empty the
     instruction holds in chat and is silently dropped everywhere else, which is
     what it used to do. */
  ok(/Spanish/.test(r.style), 'and so do Build, Lab and Studio', r.style.slice(0, 60));
}

section('Saying it in the chat is what sets the tone for that chat');
{
  /* The words, not the function. */
  const r = await page.evaluate(() => {
    const cases = [
      ['keep this chat motivational', 'motivational'],
      ['Keep this conversation short and blunt.', 'short and blunt'],
      ['For this chat, answer like a lawyer', 'answer like a lawyer'],
      ['in this conversation: be extremely concise', 'be extremely concise'],
      ['make your replies in this chat funny', 'funny'],
    ];
    return cases.map(([said, want]) => ({ said, got: _detectChatTone(said), want }));
  });
  const wrong = r.filter(c => c.got !== c.want);
  ok(wrong.length === 0, 'each way of saying it is understood',
     wrong.map(c => c.said + ' -> ' + JSON.stringify(c.got)));
}

section('And an ordinary message is left alone');
{
  /* The other half of a narrow match. "be brief" is one turn's instruction and
     the model handles it; treating it as standing would make the next twenty
     replies terse for reasons nobody could see. */
  const r = await page.evaluate(() => {
    const cases = ['be brief', 'keep this chat private', 'what is the capital of France?',
                   'can you keep this short', 'write me a poem about chats'];
    return cases.map(said => ({ said, got: _detectChatTone(said) }));
  });
  const fired = r.filter(c => c.got !== '');
  ok(fired.length === 0, 'nothing without a scope is mistaken for a standing instruction',
     fired.map(c => c.said + ' -> ' + JSON.stringify(c.got)));
}

section('It holds for the conversation, and a new chat starts fresh');
{
  const r = await page.evaluate(() => {
    const out = {};
    _setChatTone('motivational and upbeat');
    out.inPrompt = /motivational/i.test(_chatToneContext());
    out.inStyle = /motivational/i.test(_userStyle());
    const was = S.cur;
    newChat();
    out.newConversation = S.cur !== was;
    out.toneAfter = _chatTone();
    out.promptAfter = _chatToneContext();
    return out;
  });
  ok(r.inPrompt, 'the tone reaches the chat system prompt');
  ok(r.inStyle, 'and the other surfaces too');
  ok(r.newConversation, 'a new chat really is a new conversation');
  ok(r.toneAfter === '', 'and it resets - the next chat is not still motivational', r.toneAfter);
  ok(!/motivational/i.test(r.promptAfter), 'with nothing left in the prompt either', r.promptAfter);
}

section('And the words are actually wired to the send path');
{
  /* THE CHECK THAT CATCHES THE BUG THIS FILE EXISTS FOR.

     Everything above calls _detectChatTone and _setChatTone directly, so it
     passes whether or not anything in the product ever calls them - which was
     the entire fault: _setChatTone was defined, exported, and had no callers,
     so saying the words did nothing. Proved by unhooking the call from the send
     path and watching every check above stay green.

     Reachability is the property, so it is asserted directly: the detector has
     to appear in the bundle somewhere that is not its own definition or its
     window export. A behaviour test cannot see this, because the behaviour is
     "somebody else invokes me". */
  const uses = await page.evaluate(() => {
    const src = (document.getElementById('amv-app-code') || {}).textContent || '';
    if (!src) return { noSource: true };
    const hits = (src.match(/_detectChatTone\s*\(/g) || []).length;
    const setHits = (src.match(/_setChatTone\s*\(/g) || []).length;
    return { hits, setHits, len: src.length };
  });

  ok(!uses.noSource, 'the shipped bundle can be read to check this', JSON.stringify(uses));
  /* One is the definition. A caller makes two. */
  ok(uses.hits >= 2, '_detectChatTone is invoked somewhere, not just defined', uses.hits);
  ok(uses.setHits >= 2, 'and so is _setChatTone', uses.setHits);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
