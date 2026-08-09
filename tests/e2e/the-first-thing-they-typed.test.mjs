/* THE MESSAGE THEY TYPED BEFORE THEY HAD AN ACCOUNT.

   Somebody lands on AMV, types the thing they actually came to ask, and hits
   send. They do not have an account, so they are asked to make one. That is a
   reasonable trade - but only if the question survives it.

   If it does not, the first thing that happens to every new user is that AMV
   loses their work in front of them. They have to remember what they wrote and
   type it again, at the exact moment they are deciding whether this is worth
   the trouble. Most people do not type it again.

   The code intends to handle this: `_pendingMessage` is kept across the sign-up
   and sent afterwards. Nothing tested it, and an intention held in a variable
   across a modal, an auth round trip, a full re-render and a tab change is
   exactly the kind of thing that quietly stops working - it breaks silently,
   and it breaks for people who have no way to report it because they never
   became users.

   So: type first, sign up second, and require the question to arrive at the
   model with the text they wrote. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const QUESTION = 'Plan me a week of meals for two people on a budget';

function textStream(text) {
  const ev = (t, d) => 'event: ' + t + '\ndata: ' + JSON.stringify(d) + '\n\n';
  return new Response(
    ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 20 } } })
    + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
    + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } })
    + 'data: [DONE]\n\n',
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const modelSaw = [];
const outbound = makeOutbound();
outbound.on(/model\.example/, (_u, opts) => {
  try { modelSaw.push(JSON.parse(String(opts.body || '{}'))); } catch (e) {}
  return textStream('Here is a week of meals.');
});
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const env = makeEnv({ AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
                      APP_URL: 'http://localhost:9207' });
const L = await bootLive({ env, outbound, port: 9207 });
const { page } = L;

section('A stranger can type before they have an account');
{
  const typed = await page.evaluate(async (q) => {
    setTab('chat');
    await new Promise(r => setTimeout(r, 300));
    const box = document.getElementById('mta');
    if (!box) return { ok: false, why: 'no composer on the first screen' };
    box.value = q;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, value: box.value };
  }, QUESTION);
  ok(typed.ok === true, 'the composer is there without signing in first', typed.why || 'ok');
  ok(typed.value === QUESTION, 'and takes what they wrote', typed.value);
}

section('Sending asks them to sign up rather than failing');
{
  const asked = await page.evaluate(async () => {
    sendMsg();
    await new Promise(r => setTimeout(r, 600));
    const form = document.getElementById('auth-submit');
    const msgs = (typeof getMsgs === 'function') ? getMsgs() : [];
    return { signup: !!form, sent: msgs.length };
  });
  ok(asked.signup === true, 'the sign-up appears', asked.signup);
  ok(asked.sent === 0, 'and nothing was sent to the model yet', asked.sent);
  ok(modelSaw.length === 0, 'nothing was spent on somebody with no account', modelSaw.length);
}

section('And after signing up, the question they typed is the one that gets asked');
{
  await page.evaluate(async () => {
    const type = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Newcomer'); type('#a-email', 'new@example.com'); type('#a-pass', 'A-real-Passw0rd!');
    document.getElementById('auth-submit').click();
    await new Promise(r => setTimeout(r, 1500));
  });
  /* The send happens on a timer after the app re-renders, so wait for the turn
     rather than for a fixed moment. */
  await page.waitForFunction(() => typeof S !== 'undefined' && S.busy === false
                                   && (getMsgs() || []).length > 0, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  await L.settle();

  const conv = await page.evaluate(() => (getMsgs() || []).map(m => ({ r: m.r, c: m.c })));
  const mine = conv.filter(m => m.r === 'u').map(m => m.c);
  ok(mine.length === 1, 'exactly one question was asked, not zero and not two', mine);
  ok(mine[0] === QUESTION,
     'and it is the one they typed before they had an account', mine[0]);

  const answered = conv.some(m => m.r === 'a' && /week of meals/i.test(String(m.c || '')));
  ok(answered, 'they got an answer to it', conv.slice(-1)[0]);

  /* Through the real backend, with their brand new account - not a local echo. */
  ok(modelSaw.length === 1, 'the model was asked exactly once', modelSaw.length);
  const sent = JSON.stringify(modelSaw[0] || {});
  ok(sent.includes(QUESTION), 'carrying their actual words', sent.slice(0, 120));
  ok(L.hit(/\/auth\/signup/).length === 1, 'the account was really created over the wire', L.hit(/\/auth\/signup/).length);
  ok(L.hit(/\/v1\/messages/).length === 1, 'and the question really went to the backend', L.hit(/\/v1\/messages/).length);
}

section('The composer is empty afterwards, not holding a duplicate');
{
  /* A question that sends AND stays in the box is how somebody ends up asking
     the same thing twice, paying for it twice. */
  const left = await page.evaluate(() => (document.getElementById('mta') || {}).value || '');
  ok(left === '', 'nothing is left behind to be sent again', JSON.stringify(left));
}

section('And it does not come back on the next visit');
{
  /* A pending message that is never cleared re-fires later - somebody signs in
     next week and AMV asks a question they typed once, months ago. */
  const again = await page.evaluate(async () => {
    const before = (getMsgs() || []).length;
    setTab('chat');
    await new Promise(r => setTimeout(r, 500));
    return { before, after: (getMsgs() || []).length };
  });
  ok(again.after === again.before, 'the conversation is not added to on its own', again);
  ok(modelSaw.length === 1, 'and the model is not asked a second time', modelSaw.length);
}

section('Nothing broke');
{
  ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 4));
}

await L.close();
outbound.restore();
if (report('the-first-thing-they-typed') > 0) process.exitCode = 1;
done();
