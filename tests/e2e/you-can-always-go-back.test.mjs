/* YOU CAN ALWAYS GO BACK TO WHERE YOU JUST WERE.

   "Add back arrows, such as Teams. Make sure I can always return to where I
   just was without reclicking Settings. Applies to AMV as a whole."

   AMV remembered one step - the screen before Settings - and wrote each new
   screen over the address, so the browser's and the phone's Back left the
   site. Now every screen change is remembered, Settings sections included;
   the top bar's arrow appears whenever there is somewhere to go back to; and
   the browser's Back walks the same path. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('cookie-consent-banner')?.remove());
const where = () => page.evaluate(() => ({ tab: S.tab, pane: S.tab === 'settings' ? (S.settingsPane || null) : null }));
const arrow = () => page.evaluate(() => { const b = document.getElementById('nav-back'); return !!b && !b.hidden && b.offsetParent !== null; });

section('On arrival there is nowhere to go back to');
ok(!(await arrow()), 'no Back arrow on the first screen', await arrow());

section('Chat, then Settings, a section, then Team from inside it');
await page.evaluate(() => { _setPlan('ultra'); S.settingsPane = 'account'; setTab('settings'); });
await page.waitForSelector('.sn-btn[data-sp="billing"]');
await page.click('.sn-btn[data-sp="billing"]');
await page.evaluate(() => setTab('team'));
ok((await where()).tab === 'team', 'on Team', await where());
ok(await arrow(), 'with a Back arrow in the top bar', true);

section('Back walks the same path: Team, the section, the Settings page, chat');
await page.click('#nav-back');
await page.waitForTimeout(200);
let w = await where();
ok(w.tab === 'settings' && w.pane === 'billing', 'Back from Team lands on the Settings section it came from - this was the complaint', w);
await page.click('#nav-back');
await page.waitForTimeout(200);
w = await where();
ok(w.tab === 'settings' && w.pane === 'account', 'then the section before it', w);
await page.click('#nav-back');
await page.waitForTimeout(200);
w = await where();
ok(w.tab === 'chat', 'then chat', w);
ok(!(await arrow()), 'and the arrow goes when there is nowhere left to go', await arrow());

section('The browser Back does the same');
await page.evaluate(() => setTab('market'));
await page.evaluate(() => setTab('team'));
await page.goBack();
await page.waitForTimeout(250);
ok((await where()).tab === 'market', 'browser Back from Team returns to the Marketplace', await where());
await page.goBack();
await page.waitForTimeout(250);
ok((await where()).tab === 'chat', 'and again to chat, not off the site', await where());

section('Closing Settings returns to the screen before it, however many sections were opened');
await page.evaluate(() => setTab('market'));
await page.evaluate(() => { S.settingsPane = 'account'; setTab('settings'); });
await page.waitForSelector('.sn-btn[data-sp="privacy"]');
await page.click('.sn-btn[data-sp="privacy"]');
await page.click('.sn-btn[data-sp="appearance"]');
await page.click('#set-close');
await page.waitForTimeout(200);
ok((await where()).tab === 'market', 'the X goes back to the Marketplace in one step', await where());

section('Signing out forgets the path');
await page.evaluate(() => { setTab('team'); _wipeAccountState(); });
ok(await page.evaluate(() => _NAV.stack.length === 0), 'the next person cannot step back into these screens', await page.evaluate(() => _NAV.stack.length));

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
