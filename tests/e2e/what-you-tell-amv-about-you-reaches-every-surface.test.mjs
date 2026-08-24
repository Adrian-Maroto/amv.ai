/* THE PERSONALIZATION PAGE REACHED CHAT AND NOWHERE ELSE.

   Settings carries "Instructions for AMV", and the help text under it says AMV
   keeps them in mind "across every chat and agent". It did not. _profileContext()
   was added to exactly one system prompt - chat's. Build, Lab and Studio never
   saw it, so "always answer in Spanish" or "keep it short" held in one place and
   was silently dropped in three others.

   Worse than dropped: the Build context meter COUNTED it. _ctxUsageChat added
   _tok(_profileContext()) to the tokens it reports, so the interface showed the
   instructions riding along in every request while the request went without
   them. A number describing something that was not happening.

   And the second half the owner asked for: "keep this chat motivational" holds
   for that conversation and RESETS on a new one. That is a field on the
   conversation, not a setting - which is what makes it reset for free, and why
   it is stored there rather than in localStorage. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = await bootApp({ tab: 'chat', user: { name: 'Ada', email: 'ada@amv.dev', ini: 'A' } });
const { page, errors } = app;

section('What you type on the Personalization page comes back out');
{
  const r = await page.evaluate(() => {
    saveStr('amv_instructions', 'Always answer in Spanish and keep it under three sentences.');
    return {
      style: typeof _userStyle === 'function' ? _userStyle() : 'MISSING',
      profile: typeof _profileContext === 'function' ? _profileContext() : 'MISSING',
    };
  });
  ok(r.style !== 'MISSING', '_userStyle exists for the surfaces that are not chat');
  ok(/Always answer in Spanish/.test(r.style),
     'and it carries the instruction the user actually typed', r.style.slice(0, 80));
  ok(/Always answer in Spanish/.test(r.profile),
     'chat carries it too, by its own route', r.profile.slice(0, 80));
}

section('A tone set for one chat holds, and a new chat starts clean');
{
  const r = await page.evaluate(() => {
    const set = _setChatTone('Keep every reply motivational and encouraging.');
    const held = _chatToneContext();
    /* A new conversation is a new object, so the field is simply not there -
       which is the point: resetting is not a thing anyone has to remember to do. */
    S.convs.unshift(newConvObj());
    S.cur = S.convs[0].id;
    return { set, held, afterNew: _chatToneContext() };
  });
  ok(r.set === true, 'the tone can be set on the open conversation');
  ok(/motivational/i.test(r.held), 'and it is in what AMV is told for that chat', r.held.trim().slice(0, 70));
  ok(r.afterNew === '', 'a new chat starts with no tone carried over', JSON.stringify(r.afterNew));
}

section('The standing instruction survives a new chat, because it is not per-chat');
{
  const still = await page.evaluate(() => _userStyle());
  ok(/Always answer in Spanish/.test(still),
     'personalization is the persistent half and does not reset', still.slice(0, 80));
}

section('Every surface that calls a model carries it');
{
  /* Source-level, because the failure was a system prompt built without it -
     something no amount of driving the page can see. Each of these is a `const
     sys=` handed to aiComplete on a different surface. */
  const design = readFileSync(join(ROOT, 'src/app/11-design-code.js'), 'utf8');
  const engine = readFileSync(join(ROOT, 'src/app/14-engine.js'), 'utf8');
  const chat = readFileSync(join(ROOT, 'src/app/05-ui-blocks.js'), 'utf8');

  const studioPrompts = (design.match(/const sys='You are AMV Design[\s\S]*?;/g) || []);
  const forgePrompts = (design.match(/const sys='You are AMV Forge[\s\S]*?;/g) || []);
  const labPrompts = (engine.match(/const sys='You are AMV Apex[\s\S]*?;/g) || []);

  ok(studioPrompts.length >= 2, 'Studio prompts found to check', studioPrompts.length);
  ok(studioPrompts.every(p => p.includes('_userStyle()')), 'Studio sends it');
  ok(forgePrompts.length >= 2, 'Build prompts found to check', forgePrompts.length);
  ok(forgePrompts.every(p => p.includes('_userStyle()')), 'Build sends it');
  ok(labPrompts.length >= 1, 'Lab prompt found to check', labPrompts.length);
  ok(labPrompts.every(p => p.includes('_userStyle()')), 'Lab sends it');
  ok(/_profileContext\(\)\+_chatToneContext\(\)/.test(chat),
     'and chat sends both the standing instruction and this chat’s tone');
}

section('The context meter is not counting something that never ships');
{
  /* It counted _profileContext() before that context was actually being sent
     from this surface. Now that it is, the number is true - so this asserts the
     pairing rather than the presence. */
  const design = readFileSync(join(ROOT, 'src/app/11-design-code.js'), 'utf8');
  const counts = /_tok\(_profileContext\(\)\)/.test(design);
  const sends = /_userStyle\(\)/.test(design);
  ok(!counts || sends,
     'if Build counts the profile in its context meter, Build also sends it');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
