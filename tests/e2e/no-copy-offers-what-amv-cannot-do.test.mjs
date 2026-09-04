/* THE COMPOSER STILL OFFERED TO MAKE IMAGES.

   Image and video generation were removed from AMV end to end - routes, tools,
   tabs, per-plan quotas, secrets. The copy was not. The main chat composer, the
   most-seen string in the product, still read:

     "Ask anything - essays, 3D models, code, images, research…"

   and the language setting said outright that AMV generates "chat replies,
   images, video, and 3D models". The owner had already raised this class once,
   about the billing screen, and these two survived that pass - which is the
   argument for a check rather than another edit.

   THE DISTINCTION THIS HAS TO GET RIGHT, because getting it wrong would make
   the check useless: AMV can READ an image. Vision input is real - the composer
   accepts an upload and sends a base64 image block - so "File analysis - PDF,
   images, code" is TRUE and must keep passing. A seller attaching images to a
   marketplace listing is true too. What is false is offering to PRODUCE one.

   So this looks for the verbs. Copy that generates, creates, makes or renders
   an image or a video is a promise AMV cannot keep; copy that reads, analyses
   or accepts one is a feature it has. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

section('Nothing in the product offers to generate an image or a video');
{
  /* Read from the rendered page, not the sources: what matters is the words a
     person sees, wherever they were assembled. */
  const app = await bootApp({ tab: 'chat', user: { name: 'T', email: 't@x.com', ini: 'T' } });
  const { page } = app;
  const seen = [];
  for (const tab of ['chat', 'plans', 'settings', 'tasks', 'crew', 'market', 'build']) {
    await page.evaluate(t => { try { setTab(t); } catch (e) {} }, tab);
    await page.waitForTimeout(300);
    const txt = await page.evaluate(() => {
      const bits = [document.getElementById('app')?.innerText || ''];
      for (const el of document.querySelectorAll('#app [placeholder]'))
        bits.push(el.getAttribute('placeholder') || '');
      return bits.join('\n');
    });
    seen.push([tab, txt]);
  }
  await app.close();

  /* "generate/create/make/render ... image/video", within a short span so an
     unrelated "create" three paragraphs above an unrelated "image" is not a
     hit. Deliberately does NOT match read, analyse, upload or attach. */
  const OFFERS = /\b(generate|generates|generating|create|creates|creating|make|makes|making|render|renders|rendering|produce|produces)\b[^.!?\n]{0,40}\b(image|images|video|videos)\b/i;
  const bad = [];
  for (const [tab, txt] of seen) {
    for (const line of txt.split('\n')) {
      const m = OFFERS.exec(line);
      if (m) bad.push(tab + ': "' + line.trim().slice(0, 90) + '"');
    }
  }
  ok(bad.length === 0, 'no screen offers to generate an image or a video', bad.slice(0, 6));
}

section('Including the copy a tab sweep never renders');
{
  /* THE RENDERED SCAN ABOVE IS NOT ENOUGH, and finding that out is the reason
     this section exists. The language setting says what AMV generates, and it
     lives in a sub-pane that setTab('settings') does not draw - so putting the
     old wording back left the rendered scan perfectly green. A check that
     cannot reach the copy is not checking it.

     So the same question is asked of the sources: any user-facing string that
     offers to generate an image or a video. Comments are stripped first, or the
     notes explaining the REMOVAL would read as the thing they describe - the
     mistake this repo has made before and named. */
  const files = readdirSync(join(ROOT, 'src', 'app')).filter(f => f.endsWith('.js'));
  const OFFERS = /\b(generate|generates|generating|create|creates|creating|render|renders|rendering|produce|produces)\b[^.!?\n'"`]{0,40}\b(image|images|video|videos)\b/i;
  /* TWO MATCHES ARE CORRECT AND MUST KEEP PASSING, each for its own reason.
     Without these the check reports true copy as false, which is how a check
     stops being run. */
  const ALLOWED = [
    /* A list of things AMV explicitly CANNOT do and must hand back, inside the
       system prompt. "rendering a video file" appears there as a refusal. */
    'rendering a video file',
    /* A Crew example that produces a video PACKAGE - title, hook, script, shot
       list, tags, thumbnail brief. Every deliverable is text. Nothing renders. */
    'production-ready YouTube video',
  ];
  const bad = [];
  for (const f of files) {
    const code = readFileSync(join(ROOT, 'src', 'app', f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
    code.split('\n').forEach((line, i) => {
      const m = OFFERS.exec(line);
      if (!m) return;
      if (ALLOWED.some(a => line.includes(a))) return;
      bad.push(f + ':' + (i + 1) + ' "' + m[0].slice(0, 60) + '"');
    });
  }
  ok(bad.length === 0,
     'no string in the sources offers to generate an image or a video', bad.slice(0, 6));
}

section('And the composer does not list them among what to ask for');
{
  /* The specific one. A composer placeholder is an offer even without a verb:
     "Ask anything - ..., images, ..." reads as "ask me for images". */
  const src = readFileSync(join(ROOT, 'src', 'app', '05-ui-blocks.js'), 'utf8');
  const m = /id="mta"[^>]*placeholder="([^"]*)"/.exec(src);
  ok(!!m, 'the composer placeholder was found', m && m[1]);
  ok(!/\bimages?\b|\bvideos?\b/i.test(m ? m[1] : ''),
     'and does not name images or video among the things to ask for', m && m[1]);

  /* Its dictionary entry is keyed by the English string, so a change here that
     does not move the key leaves seventeen translations pointing at nothing. */
  const dict = readFileSync(join(ROOT, 'src', 'app', '04-i18n.js'), 'utf8');
  /* The key may be written with a literal ellipsis or escaped; both are the
     same string once parsed, so accept either rather than pinning the file's
     encoding choice. */
  const shown = m ? m[1] : '';
  const keyed = dict.includes("'" + shown + "'") ||
                dict.includes("'" + shown.replace(/…/g, '\\u2026') + "'");
  ok(keyed, 'and the translation dictionary is keyed to the string actually shown', shown);
}

section('What AMV really can do with an image still says so');
{
  /* The other half. If this check ever makes somebody delete the truthful copy
     about reading an uploaded image, it has done more harm than the bug. */
  const ui = readFileSync(join(ROOT, 'src', 'app', '05-ui-blocks.js'), 'utf8');
  ok(/File analysis[^']*images/.test(ui),
     'reading an uploaded image is still offered, because it genuinely works', true);
  ok(/type:'image'/.test(ui) || /type: 'image'/.test(ui),
     'and the code really does send an image to the model', true);
}

if (report('no-copy-offers-what-amv-cannot-do') > 0) process.exitCode = 1;
done();
