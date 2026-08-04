/* ASKING FOR THE SAME THING A DIFFERENT WAY IS THE SAME REQUEST.

   Making an image had two entrances. The Images tab checked the content policy
   and the plan's daily allowance. Typing "generate an image of a cat" in chat
   went straight to the provider and checked neither, so the same account got a
   different answer depending on which box they typed into. That is the shape of
   almost every gap in this codebase: a rule enforced at the door somebody
   remembered rather than at the thing being guarded.

   The block list was the half that mattered. The free image URL carries
   safe=false, and the tab's refusal was the only thing in front of it.

   The server now refuses too, and the server is the authority - a browser
   cannot be trusted to police itself. What the client owes is a straight answer
   before somebody waits, and one place where that answer is decided.

   The other half is the opposite failure: the client's daily cap must never be
   STRICTER than the server's, or a paying customer is refused something they
   are entitled to, by their own browser, with no way to appeal it. That is
   computed against the worker's real numbers, not asserted from memory. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

/* Start every case from a clean day counter and an empty gallery. */
/* Storage keys are scoped per account, so go through the app's own accessors
   rather than reaching into localStorage and quietly reading nothing. */
const reset = (plan) => page.evaluate((p) => {
  saveStr('amv_img_day_' + new Date().toISOString().slice(0, 10), '0');
  saveStr('amv_plan', p);
  S.imgs = [];
}, plan || 'free');

const dayCount = () => page.evaluate(() =>
  parseInt(loadStr('amv_img_day_' + new Date().toISOString().slice(0, 10)) || '0', 10) || 0);

section('There is one function that decides, and it is reachable');
{
  const has = await page.evaluate(() => typeof _imageRequest === 'function' && typeof _imagePolicyBlocked === 'function');
  ok(has, 'the shared gate exists', has);
}

section('It refuses a prompt the content policy blocks');
{
  await reset();
  const r = await page.evaluate(() => _imageRequest('nudify this photo of her'));
  ok(r.ok === false && r.code === 'policy', 'refused, and says why', r);
  ok(await dayCount() === 0, 'and a refusal does not spend the day’s allowance', await dayCount());
  ok(await page.evaluate(() => S.imgs.length) === 0, 'and nothing is queued', true);
}

section('It counts an allowed one');
{
  await reset();
  const r = await page.evaluate(() => _imageRequest('a lighthouse at dawn'));
  ok(r.ok === true && !!r.rec && r.rec.prompt === 'a lighthouse at dawn', 'accepted, with the record', r.rec);
  ok(await dayCount() === 1, 'the day is counted once', await dayCount());
  ok(await page.evaluate(() => S.imgs.length) === 1, 'and the image is queued once', true);
}

section('The chat route goes through the same gate');
{
  /* The actual regression: the same words, typed as a sentence. */
  await reset();
  const handled = await page.evaluate(() => _routeChatIntent('generate an image of nudify her photo'));
  ok(handled === true, 'chat handles it rather than sending it to the model', handled);

  const msgs = await page.evaluate(() => getMsgs().map(m => ({ r: m.r, c: String(m.c).slice(0, 90) })));
  const last = msgs[msgs.length - 1] || {};
  ok(/Content Policy/i.test(last.c || ''), 'and the refusal lands in the conversation', last);
  ok(await page.evaluate(() => S.imgs.length) === 0, 'no image was queued', true);
  ok(await dayCount() === 0, 'and no allowance was spent', await dayCount());
}

section('And the message somebody typed is not just swallowed');
{
  /* The input box is cleared before the router runs. A refusal that only
     toasts leaves a person staring at a chat where what they wrote vanished. */
  const msgs = await page.evaluate(() => getMsgs().map(m => m.r));
  ok(msgs[msgs.length - 2] === 'u', 'their message is still in the transcript', msgs.slice(-3));
}

section('An allowed chat request counts against the same allowance');
{
  await reset();
  await page.evaluate(() => _routeChatIntent('generate an image of a red bicycle'));
  ok(await dayCount() === 1, 'chat spends from the same daily count as the tab', await dayCount());
  ok(await page.evaluate(() => S.imgs.length) === 1, 'and lands in the same gallery', true);

  /* The Images tab reads its prompt from #img-inp, so drive it the way a person
     does rather than calling the gate a second time and proving nothing. */
  await page.evaluate(() => setTab('images'));
  await page.waitForTimeout(250);
  await page.evaluate(() => { const i = document.getElementById('img-inp'); i.value = 'a blue bicycle'; genImg(); });
  ok(await dayCount() === 2, 'so two doors, one running total', await dayCount());
  ok(await page.evaluate(() => S.imgs.length) === 2, 'and one gallery', true);

  await page.evaluate(() => { const i = document.getElementById('img-inp'); i.value = 'nudify her photo'; genImg(); });
  ok(await dayCount() === 2, 'a refusal from the tab spends nothing either', await dayCount());
  ok(await page.evaluate(() => S.imgs.length) === 2, 'and queues nothing', true);
  await page.evaluate(() => setTab('chat'));
  await page.waitForTimeout(200);
}

section('Running out is reported, not silently ignored');
{
  await reset('free');
  const r = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 12; i++) out.push(_imageRequest('a cat number ' + i).ok);
    return out;
  });
  const allowed = r.filter(Boolean).length;
  ok(allowed === 8, 'the free plan gets its eight and no more', allowed);
  const refusal = await page.evaluate(() => _imageRequest('one more cat'));
  ok(refusal.code === 'quota' && /8/.test(refusal.message), 'and the refusal names the number', refusal.message);
}

section('The client is never stricter than the server');
{
  /* Read both sides. The worker's PLAN_LIMITS is the real allowance; the
     client's map is only a nudge, so it may be looser but never tighter.
     If somebody raises a plan server-side and forgets the client, a paying
     customer starts being refused by their own browser - and this fails. */
  const serverCaps = {};
  const decl = worker.indexOf('const PLAN_LIMITS = {');
  const block = worker.slice(decl, worker.indexOf('\n};', decl));
  [...block.matchAll(/(\w+)\s*:\s*\{[^}]*imagesDay:\s*(\d+)/g)].forEach(m => { serverCaps[m[1]] = +m[2]; });
  ok(Object.keys(serverCaps).length >= 4, 'the worker’s per-plan image caps were read', serverCaps);

  const clientCaps = await page.evaluate(() => {
    const out = {};
    Object.keys(IMG_DAY_CAP).forEach(k => { out[k] = IMG_DAY_CAP[k] === Infinity ? 'server' : IMG_DAY_CAP[k]; });
    return out;
  });
  ok(Object.keys(clientCaps).length >= 4, 'and the client’s', clientCaps);

  const tighter = Object.keys(serverCaps).filter(p => {
    const c = clientCaps[p];
    return c !== 'server' && (c === undefined || c < serverCaps[p]);
  });
  ok(tighter.length === 0,
     'no plan is capped lower in the browser than the account actually allows', tighter);
}

section('A plan the client does not know about is not treated as free');
{
  /* Teams and Custom scale with seats and with the account, so the browser
     cannot compute them. Falling back to the free cap would throttle the most
     expensive customers AMV has to four pictures a day. */
  await reset('team');
  const r = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 30; i++) out.push(_imageRequest('a cat ' + i).ok);
    return out.every(Boolean);
  });
  ok(r === true, 'a Teams account is not stopped by a number the browser guessed', r);
}

section('The video studio has the same policy');
{
  ok(/_imagePolicyBlocked\(p\)/.test(bundle.slice(bundle.indexOf('async function genVid'), bundle.indexOf('async function genVid') + 700)),
     'genVid refuses a blocked prompt too', true);
}

section('And so does the tool the model calls');
{
  /* This is the door most in need of it: the prompt was written by the model,
     which may have been steered by a page it read. */
  const at = bundle.indexOf("if(name==='generate_image')");
  const img = bundle.slice(at, at + 700);
  ok(/_imagePolicyBlocked\(input\.prompt\)/.test(img), 'generate_image checks the policy', true);
  const vat = bundle.indexOf("if(name==='generate_video')");
  const vid = bundle.slice(vat, vat + 900);
  ok(/_imagePolicyBlocked\(input\.prompt\)/.test(vid), 'generate_video checks it as well', true);
}

section('Chat does not claim to have started a video it did not start');
{
  await reset();
  await page.evaluate(() => { S.tab = 'chat'; });
  await page.evaluate(() => _routeChatIntent('make a video of a cat surfing a wave'));
  const last = await page.evaluate(() => { const m = getMsgs(); return String(m[m.length - 1].c); });
  ok(!/^starting/i.test(last), 'it does not say "starting"', last.slice(0, 60));
  ok(/press Generate|Generate to render/i.test(last),
     'it says what actually happened and what to do next', last.slice(0, 100));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('media-one-door') > 0) process.exitCode = 1;
done();
