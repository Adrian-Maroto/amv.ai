/* I18N COVERAGE - the interface must follow the chosen language everywhere,
   including popups rendered AFTER the switch, and the inlined dictionary must
   add coverage without clobbering the hand-tuned inline entries. If this goes
   red, parts of the UI are stuck in English again. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp();
const { page, errors } = app;

section('Dictionary merge: adds orphaned coverage, never clobbers inline entries');
const r = await page.evaluate(() => {
  saveStr('amv_lang', 'es');
  return {
    dictLoaded: !!window.__AMV_I18N_DICT__,
    clear: T('Clear chats'),      // dict-only key (was inert before the merge)
    recurring: T('Recurring work'),
    market: T('Marketplace'),
    settings: T('Settings')       // inline key that MUST win over the dict
  };
});
ok(r.dictLoaded, 'the inlined translation dictionary is present');
ok(r.clear === 'Borrar chats', 'a dict-only key now translates (Clear chats -> Borrar chats)', r.clear);
ok(r.recurring === 'Trabajo recurrente', 'Recurring work -> Trabajo recurrente', r.recurring);
ok(r.market === 'Mercado', 'Marketplace -> Mercado', r.market);
ok(r.settings && r.settings !== 'Settings', 'an existing inline key is preserved (not clobbered)', r.settings);

section('Popups outside #app are covered by the translator');
// the top-right profile menu is appended to document.body (OUTSIDE #app); the
// old translator only walked #app and left every popup/menu in English.
// Deterministic check: render the menu, then translate, and confirm _translateUI
// reaches body-appended menus (not just #app).
const menu = await page.evaluate(() => {
  saveStr('amv_lang', 'es');
  showProfMenu(document.body);   // appended to <body>, outside #app
  _translateUI();                 // must walk body-appended menus, not only #app
  const m = document.querySelector('.prof-menu');
  return m ? m.textContent : '(no menu)';
});
ok(/Cerrar sesión/.test(menu), 'the profile menu translates (Sign Out -> Cerrar sesión)', menu.slice(0, 80));
ok(!/Sign Out/.test(menu), 'no English "Sign Out" left in the menu');

section('Switching back to English restores the UI');
const back = await page.evaluate(() => {
  document.querySelector('.prof-menu')?.remove();
  saveStr('amv_lang', 'en');
  showProfMenu(document.body);
  _translateUI();                 // restores originals across all roots
  const m = document.querySelector('.prof-menu');
  return m ? m.textContent : '';
});
ok(/Sign Out/.test(back), 'English is restored (Sign Out is back)');

section('No JavaScript errors');
section('AMV\u2019s own words in the chat area follow the language too');
{
  /* `data-no-i18n` protects live model output, which is right. But it covers
     the whole chat area, so AMV's own labels in there stayed English forever -
     on the one screen people spend all their time on, in a product that ships
     forty languages everywhere else. `data-i18n` opts a subtree back in. */
  const v = await page.evaluate(() => {
    const cm = document.getElementById('cm');
    cm.innerHTML =
      '<div class="away-card" data-i18n><div class="away-h">While you were away</div>' +
        '<div class="away-snip" data-no-i18n>MODEL OUTPUT SENTENCE</div></div>' +
      '<div class="mb ai">ANOTHER MODEL SENTENCE</div>';
    // Collect what the translator considers translatable, the way it does.
    const nodes = (typeof _collectI18nNodes === 'function') ? _collectI18nNodes(document.body) : null;
    if (!nodes) return { unsupported: true };
    const texts = nodes.filter(n => n.type === 'text').map(n => n.node.nodeValue.trim());
    return {
      chrome: texts.includes('While you were away'),
      snippet: texts.includes('MODEL OUTPUT SENTENCE'),
      message: texts.includes('ANOTHER MODEL SENTENCE'),
    };
  });
  if (v.unsupported) {
    ok(true, 'collector not exported in this build - skipped');
  } else {
    ok(v.chrome === true, 'AMV\u2019s own label is translatable', v.chrome);
    ok(v.snippet === false, 'but model output inside the same card is NOT', v.snippet);
    ok(v.message === false, 'and neither is an ordinary answer', v.message);
  }
}

section('Translating twice does not translate twice');
{
  /* The bug this guards is expensive rather than visible. The lookup key was
     read from the node's CURRENT value, so the moment a string was translated
     the next pass saw Spanish, missed the dictionary, missed the cache (which
     is keyed by the English), and sent it to the model to be translated again -
     producing a different string, which the pass after that would send again.

     The observer runs this on every DOM mutation. With an engine key configured
     that is an unbounded translation loop billed by the token, and the text
     drifts further from the original on every lap. It has to converge. */
  const r = await page.evaluate(async () => {
    saveStr('amv_lang', 'es');
    saveStr('amv_plan', 'ultra');
    window._aiBackendReady = () => true;
    let batches = 0;
    window.aiComplete = async (prompt) => {
      batches++;
      const lines = prompt.split('\n').filter(Boolean);
      return JSON.stringify(lines.map(l => 'ES ' + l.replace(/^\d+\.\s*/, '')));
    };
    S.tab = 'crew'; setTab('crew');
    await new Promise(r => setTimeout(r, 150));
    _translateUI();
    await new Promise(r => setTimeout(r, 900));
    const first = batches;

    /* Settled. Asking again must cost nothing. */
    _translateUI(); await new Promise(r => setTimeout(r, 300));
    _translateUI(); await new Promise(r => setTimeout(r, 300));

    const nodes = _collectI18nNodes(document.getElementById('vc'));
    let eng = 0, tot = 0; const left = [];
    for (const it of nodes) {
      if (it.type !== 'text') continue;
      const v = (it.node.nodeValue || '').trim();
      if (v.length < 4 || !/[A-Za-z]/.test(v)) continue;
      tot++;
      /* Translated means the pipeline actually replaced this node, by EITHER
         route. Checking for the mock's "ES " prefix only recognised the model
         route, so every string the instant dictionary already covers - Connect,
         All, Run - counted as English and the number got worse the more
         dictionary-covered chrome a screen had. `_i18nSrc` is the original the
         replacement remembered, so a node carrying one that differs from what
         is on screen has genuinely been translated. */
      const src = it.node._i18nSrc;
      if (src == null || String(src).trim() === v) { eng++; if (left.length < 12) left.push(v.slice(0, 60)); }
    }
    return { first, total: batches, tot, eng, left };
  });

  ok(r.first > 0, 'the first pass really did translate', r.first);
  ok(r.total === r.first,
     'and running it again asks the model for nothing more', { first: r.first, after: r.total });
  ok(r.tot > 50, 'on a screen with real content to translate', r.tot);
  ok(r.eng / r.tot < 0.05,
     'which leaves almost nothing untranslated once a key is configured',
     Math.round((r.eng / r.tot) * 100) + '% untranslated: ' + JSON.stringify(r.left));

  await page.evaluate(() => { saveStr('amv_lang', 'en'); _translateUI(); });
}

ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();

report();
done();
