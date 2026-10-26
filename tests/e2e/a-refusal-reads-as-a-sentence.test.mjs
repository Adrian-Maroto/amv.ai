/* A REFUSAL READS AS A SENTENCE, NEVER AS ITS CODE.

   The server refuses two ways: a sentence in `error`, or a code in `error`
   with the sentence in `message` ({error:'credentials_in_detail', message:
   'AMV does not store passwords...'}). The page read `error`, so every
   refusal of the second kind reached the person as "credentials_in_detail",
   "reconnect", "bad_folder". _refusalText picks the sentence, and the page's
   API wrappers go through it:
   - a code with a message gives the message;
   - a code the server never explains gives a plain sentence, or the
     caller's own words - never the code;
   - a sentence in `error` is kept as it is;
   - and a real wrapper (the family screen's) throws the sentence. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page, errors } = app;

section('The sentence is chosen, never the code');
{
  const r = await page.evaluate(() => ({
    withMessage: _refusalText({ error: 'credentials_in_detail', message: 'AMV does not store passwords.' }, 'fallback'),
    known: _refusalText({ error: 'reconnect' }),
    unknown: _refusalText({ error: 'some_new_code' }, 'That could not be saved.'),
    unknownBare: _refusalText({ error: 'some_new_code' }),
    sentence: _refusalText({ error: 'Your plan runs 5 background jobs.' }, 'fallback'),
    nothing: _refusalText({}, 'Could not load this.'),
  }));
  ok(r.withMessage === 'AMV does not store passwords.', 'a code with a message gives the message', r.withMessage);
  ok(/Reconnect it in Integrations/.test(r.known), 'a code the server never explains gives a plain sentence', r.known);
  ok(r.unknown === 'That could not be saved.', 'an unknown code gives the caller’s own words', r.unknown);
  ok(!/_/.test(r.unknownBare) && /did not work/i.test(r.unknownBare), 'and with no words of its own, a plain sentence - never the code', r.unknownBare);
  ok(r.sentence === 'Your plan runs 5 background jobs.', 'a sentence in error is kept as it is', r.sentence);
  ok(r.nothing === 'Could not load this.', 'an empty answer gives the caller’s words', r.nothing);
}

section('A real wrapper throws the sentence');
{
  const msg = await page.evaluate(async () => {
    AMV_API.base = 'https://refusal-test.workers.dev'; AMV_API.token = 'tok';
    const real = window.fetch;
    window.fetch = async () => new Response(JSON.stringify({ error: 'not_connected', message: 'Your family is not set up yet. Invite someone first.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    try { await AMV_API.familyGet(); return 'did not throw'; } catch (e) { return e.message; } finally { window.fetch = real; }
  });
  ok(msg === 'Your family is not set up yet. Invite someone first.', 'the person reads what the server said, not "not_connected"', msg);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
