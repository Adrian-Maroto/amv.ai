/* MOTION THAT SAYS WHAT IT ANIMATES.

   `transition: all` tells the browser to watch every animatable property and
   animate whichever one changes. A rule written to fade a border colour will
   therefore also animate width, height, padding and margin the moment anything
   else moves them - which is where unexplained sliding and jumping comes from,
   and it is unpredictable by construction because the rule never says what it
   meant. It costs more too: the browser cannot prepare properties it has not
   been told about.

   There were 67 of them. Each is now the explicit list it actually meant.
   Layout properties are deliberately not on that list, and that was checked
   rather than assumed - no :hover rule in the stylesheet animates width,
   height, padding or margin, so nothing was relying on the blanket.

   This is the guard. It reads the SHIPPED stylesheet, because the rule matters
   in the artifact rather than in the source. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(ROOT, 'styles.css'), 'utf8');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

section('Nothing animates "all"');
{
  /* Comments in this file quote the pattern, so they are stripped first -
     otherwise the explanation counts as an instance (LESSONS #255). */
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const inCss = code.match(/transition:\s*all\b/g) || [];
  ok(inCss.length === 0,
     'no rule in styles.css transitions every property', inCss.length);

  /* And the built page, which is what a visitor downloads - it catches an
     inline style written in a JS template, which is where the last three hid.
     Comments stripped here too: the CSS comment explaining this rule is
     injected verbatim into the page, so the explanation was counting as an
     instance and failing on correct code. That is LESSONS #255 for the third
     time, and it is always the same shape - prose quoting the thing it forbids. */
  const shipped = html.replace(/\/\*[\s\S]*?\*\//g, '');
  const inBuilt = (shipped.match(/transition:\s*all\b/g) || []);
  ok(inBuilt.length === 0,
     'nor anything in the page that ships', inBuilt.length);
}

section('And the transitions that remain name real properties');
{
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = code.match(/transition:[^;}]+/g) || [];
  ok(decls.length > 50, 'there are transitions to check', decls.length);

  /* WHAT THIS DELIBERATELY DOES NOT ASSERT.

     Two stricter rules were tried here and both failed on correct code. First
     "no transition names a layout property" - but a collapsing sidebar animates
     its own width, and that IS the animation. Then "a transition naming a
     layout property must name only layout properties" - and the usage bar
     animates width over .5s while its colour shifts over .3s as usage rises,
     which is careful authorship, not a mistake. The distinct durations are the
     tell.

     The finding was `transition: all`, and that is measurable and now zero. A
     check that keeps going red on correct code is how a suite stops being read,
     so the count below is a tripwire on the size of the deliberate set rather
     than a judgement about any one rule. */
  const layout = decls.filter(d => /\b(width|height|padding|margin)\b/.test(d));
  ok(layout.length < 20,
     'deliberate size animations stay a small, reviewable set', layout.length);
}

if (report('motion-is-declared-not-guessed') > 0) process.exitCode = 1;
done();
