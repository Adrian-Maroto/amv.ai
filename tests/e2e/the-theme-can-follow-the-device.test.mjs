/* THE THEME CAN FOLLOW THE DEVICE (owner, Nov 25: "fix everything AMV is
   behind"). Light, Dark and System is the baseline every leading assistant
   meets; AMV had only a dark switch. Held:
     · dark is still the default for somebody who chose nothing;
     · Appearance offers exactly Light, Dark and System, as one radio group;
     · System matches the device on choosing it AND when the device changes
       while the page is open;
     · Light and Dark are fixed: a device change does not move them;
     · the quick switch flips what is on screen and leaves System;
     · the choice survives a reload. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', viewport: { width: 1280, height: 860 } });
const { page, errors } = app;
const light = () => page.evaluate(() => document.body.classList.contains('light'));
const scheme = async (s) => { await page.emulateMedia({ colorScheme: s }); await page.waitForTimeout(150); };

section('Nothing chosen: dark');
await scheme('light');
await page.evaluate(() => { localStorage.removeItem('amv_theme'); _themeApply(); });
ok(!(await light()), 'dark by default, even on a light device');

section('Appearance offers Light, Dark and System');
await page.evaluate(() => goSettings('appearance'));
await page.waitForSelector('[data-theme-opt]', { timeout: 8000 });
const opts = await page.evaluate(() => ({ ids: [...document.querySelectorAll('[data-theme-opt]')].map(b => b.dataset.themeOpt),
  group: !!document.querySelector('[role="radiogroup"] [data-theme-opt]'),
  on: [...document.querySelectorAll('[data-theme-opt][aria-checked="true"]')].map(b => b.dataset.themeOpt) }));
ok(opts.ids.join() === 'light,dark,system' && opts.group, 'three choices in one radio group', opts);
ok(opts.on.join() === 'dark', 'Dark is the one marked', opts.on);

section('System follows the device, now and later');
await page.click('[data-theme-opt="system"]');
ok(await light(), 'on a light device, System shows light');
await scheme('dark');
ok(!(await light()), 'the device turns dark: so does the open page');
await scheme('light');
ok(await light(), 'and back');
ok(await page.evaluate(() => document.querySelector('[data-theme-opt="system"]').getAttribute('aria-checked') === 'true'), 'System stays marked');

section('Light and Dark are fixed');
await page.click('[data-theme-opt="dark"]');
await scheme('light');
ok(!(await light()), 'Dark on a light device stays dark');
await page.click('[data-theme-opt="light"]');
await scheme('dark');
ok(await light(), 'Light on a dark device stays light');

section('The quick switch flips the screen and leaves System');
await page.click('[data-theme-opt="system"]');   // device is dark now
await page.evaluate(() => _themeFlip());
ok(await light() && await page.evaluate(() => localStorage.getItem('amv_theme')) === 'light', 'from System on a dark device: Light, chosen', await page.evaluate(() => localStorage.getItem('amv_theme')));

section('The choice survives a reload');
await page.evaluate(() => _themeApply('system'));
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => typeof _themePref === 'function', null, { timeout: 20000 });
ok(await page.evaluate(() => _themePref()) === 'system' && !(await light()), 'System, on a dark device, after reloading');

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
report();
await app.close();
done();
