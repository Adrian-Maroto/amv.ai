/* I18N COVERAGE — the interface must follow the chosen language everywhere,
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
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
