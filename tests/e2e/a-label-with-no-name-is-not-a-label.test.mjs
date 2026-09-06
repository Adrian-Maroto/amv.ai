/* EVERY REPLY CARRIED A GREY LABEL THAT SAID ONLY "Model".

   The engine label under an answer is built from `_engLabel`, which resolves
   from `ENGINE_LABEL[m._engine]` or `MODELS[m.model].label`. It falls back to
   an empty string when neither knows the id - and the span was gated on
   `m.model` existing, not on there being a NAME to put in it. So the markup
   rendered as a leading space and the bare word "Model".

   That is not an edge case. Messages persist in a thread across releases, so
   it happens to every stored reply the moment an engine is renamed or
   retired: the id on the message stops matching the catalogue in the page.

   Nothing catches it. It throws no error, it is styled correctly, and it is a
   valid element - just empty of the one thing it exists to carry. It was
   found by rendering a thread and looking at the picture. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

const labelFor = (msg) => page.evaluate(async (m) => {
  const cur = S.convs.find(c => c.id === S.cur) || S.convs[0];
  cur.msgs = [{ r: 'u', c: 'hi' }, m];
  renderChatMsgs();
  await new Promise(r => setTimeout(r, 300));
  const e = document.querySelector('#cm .msg-engine');
  return { present: !!e, text: e ? (e.textContent || '').trim() : null };
}, msg);

section('A model the catalogue does not know shows no label at all');
{
  /* The exact production shape: a reply stored before its engine was renamed. */
  const r = await labelFor({ r: 'a', c: 'ok', model: 'amv-retired-2019' });
  ok(!r.present, 'no label is drawn when there is no name for it', r);
}

section('A model it DOES know is unchanged');
{
  const known = await page.evaluate(() => Object.keys(MODELS)[0]);
  ok(!!known, 'the catalogue has models to test against', known);
  const r = await labelFor({ r: 'a', c: 'ok', model: known });
  ok(r.present, 'the label is still drawn', r);
  ok(r.text && r.text.length > 'Model'.length,
     'and carries a real engine name, not just the word Model', r.text);
  ok(!/^Model$/.test(r.text || ''),
     'which is the whole point - the fault was a label with nothing in it', r.text);
}

section('A reply with no model recorded is unchanged too');
{
  const r = await labelFor({ r: 'a', c: 'ok' });
  ok(!r.present, 'nothing is drawn, as before', r);
}

section('Nothing broke');
ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));

await app.close();
if (report('a-label-with-no-name-is-not-a-label') > 0) process.exitCode = 1;
done();
