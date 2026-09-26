/* THE DICTIONARY MERGES LANGUAGE BY LANGUAGE.

   The page's translations come from three places - a hand-written object
   literal and two generated dictionaries - and the build merges them into one
   pack per language (build.mjs, splitI18n / mergeI18n). In the page they were
   merged WHOLE-ENTRY: a key written twice in the literal kept only the second
   entry, and a generated dictionary only filled keys the literal lacked
   entirely. 72 translations across 9 labels never reached the screen that way
   - Bengali "Agents" and "Build" among them.

   Today every language a first-only line carries is also in a generated source,
   so a regression back to "the later line wins" would not show in the shipped
   packs yet. That is exactly the kind of guard that erodes unseen, so it is
   checked here on data built to expose it. */
import { splitI18n, mergeI18n } from '../../build.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const region = `/* BUILD:I18N-DATA:START */
const I18N = {
  'Settings':{es:'Ajustes-first',fr:'Réglages'},
  'Only here':{es:'Solo aquí'},
  'Settings':{bn:'সেটিংস',es:'Ajustes-second'},
};
(function(){ var __D = {'Settings':{de:'Einstellungen-folded',es:'NO'}, 'Folded only':{es:'Plegado'}};
  for (var k in __D){ if(!I18N[k]) I18N[k]=__D[k]; else { for (var c in __D[k]) if(!I18N[k][c]) I18N[k][c]=__D[k][c]; } } })();
(function(){ const D = {'Settings':{ja:'設定-gen',es:'NO'}, 'Generated only':{es:'Generado'}};
  try{ window.__AMV_I18N_DICT__ = D; }catch(e){} })();
`;

section('Every source contributes every language it has');
{
  const d = mergeI18n(region);
  ok(d['Settings'].fr === 'Réglages', 'a language only the FIRST of two duplicate lines has survives', d['Settings']);
  ok(d['Settings'].bn === 'সেটিংস', 'and one only the second has', d['Settings']);
  ok(d['Settings'].es === 'Ajustes-second', 'where both lines have it, the later line wins, as the literal always meant', d['Settings'].es);
  ok(d['Settings'].de === 'Einstellungen-folded' && d['Settings'].ja === '設定-gen',
     'a generated dictionary fills languages the hand-written entry lacks, even when the key exists', d['Settings']);
  ok(d['Folded only'].es === 'Plegado' && d['Generated only'].es === 'Generado' && d['Only here'].es === 'Solo aquí',
     'and keys from any one source arrive', Object.keys(d));
}

section('Hand-written beats generated');
{
  const d = mergeI18n(region);
  ok(d['Settings'].es !== 'NO', 'a generated value never overrides a hand-written one', d['Settings'].es);
}

section('The page ships without the data, and the packs come out per language');
{
  const full = 'const before = 1;\n' + region + '/* BUILD:I18N-DATA:END */\nconst after = 2;\n';
  const { shipped, packs } = (() => { try { return splitI18n(full); } catch (e) { return { error: e.message }; } })();
  ok(typeof shipped === 'string' && !/Ajustes|Solo aquí/.test(shipped), 'no translation is left in what ships', (shipped || '').slice(0, 120));
  ok(packs && packs.es && packs.es['Settings'] === 'Ajustes-second' && packs.fr && packs.fr['Settings'] === 'Réglages',
     'and each language gets its own pack', packs && Object.keys(packs));
  ok(/const I18N = \{\};/.test(shipped || '') && /const before = 1;/.test(shipped || '') && /const after = 2;/.test(shipped || ''),
     'an empty I18N takes its place and the code around it is untouched', (shipped || '').slice(0, 200));
}

section('Missing markers stop the build rather than shipping nothing');
{
  let threw = '';
  try { splitI18n('const I18N = {};'); } catch (e) { threw = e.message; }
  ok(/markers not found/.test(threw), 'a bundle without the data region is refused', threw);
}

report();
done();
