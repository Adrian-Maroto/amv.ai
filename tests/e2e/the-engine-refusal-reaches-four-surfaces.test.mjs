/* CHAT HAD THIS FIXED. THE FOUR SURFACES SHARING ONE HELPER DID NOT.

   `aiComplete` and `aiCompleteLong` answered a non-2xx with

     new Error('AI error ' + status + ': ' + rawBody)

   The body is JSON and carries everything a caller needs - the sentence AMV
   wrote, the machine-readable code, the plan that lifts it - and every bit of
   it went into a string as text. Then Studio, Dev, Lab and Crew handed that
   string to the error guesser, which rewrites by keyword, and the person read:

     "AMV hit a snag. Please try again."

   A tier rendered as a fault, with the reason and the way out both present in
   memory and neither reaching the screen. Chat's own path had been fixed; this
   one is shared by everything that is not chat, and nobody had looked at it.

   Driven here through the real helper against a real 402. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

const SENTENCE = 'That engine is part of Elite. Your work is safe here.';

await page.evaluate((sentence) => {
  saveStr('amv_api_base', 'https://engine.test');
  saveStr('amv_api_token', 'tok');
  window.AMV_API.live = true;
  window.AMV_API.base = 'https://engine.test';
  window.AMV_API.token = 'tok';
  const rf = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url).includes('engine.test')) {
      return new Response(JSON.stringify({ error: sentence, code: 'plan_required', minPlan: 'elite' }),
                          { status: 402, headers: { 'Content-Type': 'application/json' } });
    }
    return rf(url, opts);
  };
}, SENTENCE);

section('The helper hands back a refusal, not a string with one inside it');
{
  const r = await page.evaluate(async () => {
    let caught = null;
    try { await aiComplete('hello', 'sys', {}); } catch (e) { caught = e; }
    if (!caught) return { threw: false };
    return { threw: true, message: caught.message, code: caught.code || '',
             minPlan: caught.minPlan || '', status: caught.status || 0,
             plain: !!caught._saidPlainly };
  });
  ok(r.threw, 'a refusal still throws', r.threw);
  ok(r.code === 'plan_required', 'carrying the code as a field', r.code);
  ok(r.minPlan === 'elite', 'and the plan that lifts it', r.minPlan);
  ok(r.status === 402, 'and the status', r.status);
  ok(r.plain, 'tagged as a sentence AMV wrote, so nothing downstream rewrites it', r.plain);
  ok(!/^AI error/.test(r.message), 'the message is not a status code and a JSON blob', r.message.slice(0, 70));
  ok(r.message.indexOf('part of Elite') >= 0, 'it is the sentence the server sent', r.message.slice(0, 70));
}

section('And the long-form call answers the same way');
{
  const r = await page.evaluate(async () => {
    let caught = null;
    try { await aiCompleteLong('hello', 'sys', { max_tokens: 100 }); } catch (e) { caught = e; }
    return caught ? { code: caught.code || '', plain: !!caught._saidPlainly, message: caught.message } : { none: true };
  });
  ok(r.code === 'plan_required', 'aiCompleteLong carries it too', r.code);
  ok(r.plain && /part of Elite/.test(r.message), 'with the same sentence', (r.message || '').slice(0, 70));
}

section('The guesser is only for errors nobody wrote');
{
  const r = await page.evaluate(() => {
    const said = new Error('AMV is at capacity for free accounts today. Paid plans are running normally.');
    said._saidPlainly = true;
    const raw = new Error('TypeError: undefined is not a function');
    return { kept: _errText(said), guessed: _errText(raw), bare: _errText(null) };
  });
  ok(/at capacity for free accounts/.test(r.kept), 'a sentence AMV wrote survives verbatim', r.kept.slice(0, 80));
  ok(!/hiccup|snag/i.test(r.kept), 'and is not replaced by a guess that says the opposite', r.kept.slice(0, 80));
  ok(/snag|hiccup/i.test(r.guessed), 'a raw one is still made readable', r.guessed);
  ok(typeof r.bare === 'string' && r.bare.length > 0, 'and nothing throws on an error that is not one', r.bare);
}

section('Studio says the reason instead of a shrug')
{
  const r = await page.evaluate(async () => {
    setTab('studio');
    await new Promise(res => setTimeout(res, 400));
    const box = document.getElementById('dsn-prompt');
    if (!box) return { missing: true };
    box.value = 'a landing page for a bakery';
    designGo();
    /* Wait for the line to SETTLE, not merely to say something. It says
       "Designing…" first, and a loop that breaks on the first non-empty text
       reads the progress message and reports it as the outcome - which is how
       this passed the "rather than a shrug" check on a run that never got as
       far as the refusal. */
    const busy = /^(Designing|Refining|Generating|Working)/i;
    for (let i = 0; i < 80; i++) {
      const s = document.getElementById('studio-status');
      const t = s ? s.textContent.trim() : '';
      if (t && !busy.test(t)) break;
      await new Promise(res => setTimeout(res, 200));
    }
    const s = document.getElementById('studio-status');
    return { found: !!s, text: s ? s.textContent.trim() : '' };
  });
  ok(!r.missing, 'the Studio prompt box is there to drive', !r.missing);
  ok(r.found, 'Studio has a status line to say it on', r.found);
  /* Asserted BEFORE the negative below, because "does not say snag" is true of
     an empty string too - which is exactly how this section passed vacuously
     the first time it ran. */
  ok(r.text.length > 0, 'and it actually says something', JSON.stringify(r.text));
  ok(/part of Elite/.test(r.text), 'namely the reason the server gave', r.text.slice(0, 90));
  ok(!/hit a snag/i.test(r.text), 'rather than a shrug', r.text.slice(0, 90));
}

section('Dev offers the plan on the card that used to offer a retry');
{
  const r = await page.evaluate(async () => {
    setTab('dev');
    await new Promise(res => setTimeout(res, 400));
    _DEV.log = [];
    const ta = document.getElementById('dev-msg');
    if (!ta) return { missing: true };
    ta.value = 'write me a login page';
    try { await _devSend(); } catch (e) {}
    for (let i = 0; i < 40 && _DEV.busy; i++) await new Promise(res => setTimeout(res, 250));
    await new Promise(res => setTimeout(res, 300));
    const snag = document.querySelector('#dev-log .ai-snag');
    const btn = snag && snag.querySelector('.ai-snag-retry');
    return { shown: !!snag, tier: !!(snag && snag.classList.contains('ai-snag-tier')),
             text: snag ? snag.textContent : '', label: btn ? btn.textContent.trim() : '' };
  });
  ok(!r.missing, 'the Dev composer is there to drive', !r.missing);
  ok(r.shown, 'a refusal produces a card', r.shown);
  ok(/part of Elite/.test(r.text), 'saying what the server said', r.text.slice(0, 90));
  ok(r.label === 'See plans', 'and offering the plan rather than a retry', r.label);
  ok(r.tier, 'styled as a door, not a fault', r.tier);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
