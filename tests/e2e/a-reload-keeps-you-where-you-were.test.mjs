/* A RELOAD KEEPS YOU WHERE YOU WERE.

   The owner was connecting apps on Integrations, pressed refresh, and landed
   on chat. Integrations had no address of its own, so a reload had nothing to
   go back to - and neither did Tasks, Spending, Memory or Team. Each is opened,
   the address it leaves is read, and the page is reloaded at that address to
   see where it lands. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Owner', email: 'owner@amv.dev', ini: 'O' } });
const { page, errors } = app;
/* Stored the way signing in stores it, so a reload is still signed in - which
   is the owner's case: signed in, on Integrations, pressing refresh. */
await page.evaluate(() => {
  store('amv_user', S.user);
  localStorage.setItem(acctKey(S.user.email), JSON.stringify({ email: S.user.email, name: S.user.name }));
});

for (const tab of ['integrations', 'tasks', 'spend', 'memory', 'team']) {
  section('Reloading on ' + tab + ' comes back to ' + tab);
  {
    await page.evaluate((t) => { setTab(t); }, tab);
    await page.waitForTimeout(250);
    const addr = await page.evaluate(() => location.pathname + location.hash);
    ok(/#\/[a-z]+$|^\/[a-z]+$/.test(addr), 'the address names the section', addr);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => typeof S !== 'undefined' && window._BUNDLE_READY !== false, null, { timeout: 15000 });
    await page.waitForTimeout(400);
    const landed = await page.evaluate(() => S.tab);
    ok(landed === tab, 'and a reload lands there, not on chat', { tab, landed, addr });
  }
}

section('Chat itself keeps a clean address');
{
  await page.evaluate(() => setTab('chat'));
  await page.waitForTimeout(200);
  const addr = await page.evaluate(() => location.hash);
  ok(addr === '', 'no leftover section in the address', addr);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
