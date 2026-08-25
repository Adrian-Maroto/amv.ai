/* PICKING SPANISH LEFT THE MARKETPLACE IN ENGLISH.

   AMV translates in two layers: an instant dictionary of 174 terms, and an
   AI-cache for everything else that needs a key. The honest degradation without
   a key is that long prose stays English - that is documented and fine.

   What was NOT fine: eight standalone labels that ARE in the dictionary and
   still came out English. The marketplace category chips ("All", "Sales",
   "Finance", "Marketing", "Business", "Education") and the listing cards' own
   "Free", "Preview" and kind badges. They are written straight from listing data
   with no T() around them.

   The reason the fix is not just "wrap it in T()" is that the label and the
   FILTER VALUE were the same string. `activeCat` is compared against `i.cat`,
   the raw English category on the listing, so translating in place would have
   left a Spanish speaker with chips that filter nothing. data-mk-cat keeps the
   raw value; only the visible text moves.

   The measure here is position-independent on purpose. Comparing before and
   after by DOM position gave nonsense - it paired "Chat" with "Transferir",
   because the view re-renders and elements shift. What is checked instead is a
   property: a text node whose ENTIRE content is a dictionary term must not be
   in English. A term inside a longer sentence is the no-key path and is not
   counted, which is the distinction between a bug and the documented behaviour. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Ada', email: 'ada@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => document.getElementById('ck')?.remove());

const TABS = ['chat', 'crew', 'market', 'plans', 'settings', 'help', 'usage', 'team'];

section('Every label that CAN be translated, is');
{
  const r = await page.evaluate(async (tabs) => {
    const dict = {};
    Object.keys(I18N).forEach(k => { const e = I18N[k]; if (e && e.es && e.es !== k) dict[k.toLowerCase()] = e.es; });

    saveStr('amv_lang', 'es');
    try { _i18nRoots().forEach(r2 => _restoreI18nDOM(r2)); } catch (e) {}
    try { setTab(S.tab); } catch (e) {}
    try { _translateUI(); } catch (e) {}
    await new Promise(s => setTimeout(s, 1000));

    const stuck = [];
    let translated = 0;
    const spanish = new Set(Object.values(dict));
    for (const tab of tabs) {
      try { setTab(tab); } catch (e) { continue; }
      /* Navigating AFTER the switch is the case that matters: this content is
         rendered fresh and has to be caught by the observer, not by the initial
         pass. */
      await new Promise(s => setTimeout(s, 850));
      [document.getElementById('vc'), document.getElementById('sb')].filter(Boolean).forEach(root =>
        root.querySelectorAll('*').forEach(e => {
          if (e.closest('[data-no-i18n]')) return;
          const b = e.getBoundingClientRect();
          if (b.width < 2 || b.height < 2) return;
          [...e.childNodes].forEach(n => {
            if (n.nodeType !== 3) return;
            const s = n.textContent.trim();
            if (!s) return;
            if (dict[s.toLowerCase()]) stuck.push(tab + ': "' + s + '" should be "' + dict[s.toLowerCase()] + '"');
            else if (spanish.has(s)) translated++;
          });
        }));
    }
    return { stuck: [...new Set(stuck)], translated, terms: Object.keys(dict).length };
  }, TABS);

  ok(r.terms > 100, 'the dictionary has enough terms for this to mean something', r.terms);
  ok(r.translated > 60, 'and the switch really did translate the interface', r.translated);
  ok(r.stuck.length === 0,
     'no standalone label anywhere is left in English after switching', r.stuck.slice(0, 6));
}

section('And the filter still filters, in either language');
{
  /* The half that a careless fix breaks. Translating the chip in place would
     leave it looking right and matching nothing. */
  const r = await page.evaluate(async () => {
    setTab('market');
    await new Promise(s => setTimeout(s, 1000));
    const chips = () => [...document.querySelectorAll('[data-mk-cat]')]
      .map(b => ({ value: b.dataset.mkCat, label: b.textContent.trim() }));
    const list = chips();
    const named = list.find(c => c.value !== 'All' && c.label !== c.value);
    if (!named) return { noTranslatedChip: true, list };
    const cardsBefore = document.querySelectorAll('#mk-grid > *').length;
    document.querySelector('[data-mk-cat="' + named.value + '"]').click();
    await new Promise(s => setTimeout(s, 450));
    return { named, cardsBefore, cardsAfter: document.querySelectorAll('#mk-grid > *').length,
             values: list.map(c => c.value) };
  });

  ok(!r.noTranslatedChip, 'at least one chip is showing a translated label',
     r.noTranslatedChip ? JSON.stringify(r.list) : r.named.value + ' -> ' + r.named.label);
  ok(r.values.every(v => /^[\x20-\x7E]+$/.test(v)),
     'the filter VALUES stay the raw English the listings are tagged with', r.values);
  ok(r.cardsAfter > 0 && r.cardsAfter <= r.cardsBefore,
     'and clicking a translated chip still narrows the catalogue rather than emptying it',
     r.cardsBefore + ' -> ' + r.cardsAfter);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
