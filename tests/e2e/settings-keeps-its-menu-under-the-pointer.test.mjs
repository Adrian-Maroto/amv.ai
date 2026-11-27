/* SETTINGS KEEPS ITS MENU UNDER THE POINTER (Nov 27, the owner: "sometimes I
   click something and it doesn't do it, and I have to click it again").

   A sync pull, the end of a session restore and the plan arriving each call
   renderView(), which drew all of Settings again. Every menu button was
   replaced, so a press that began on the old button ended on a new one and
   the browser fired no click. This presses a section, lets a background
   redraw happen while the button is held, and releases - the way it happens
   to a person on a real connection. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

for (const w of [1440, 820]) {
  section(w + 'px: a background redraw between press and release does not swallow the click');
  const app = await bootApp({ tab: 'chat', viewport: { width: w, height: 900 } });
  const { page, errors } = app;
  await page.evaluate(() => { S.settingsPane = 'account'; setTab('settings'); });
  await page.waitForTimeout(500);
  const ids = await page.evaluate(() => [...document.querySelectorAll('.sn-btn')].map(b => b.dataset.sp).filter(x => x !== 'account'));
  ok(ids.length >= 3, 'Settings has its sections', ids);
  for (const id of ids.slice(0, 4)) {
    const box = await page.locator(`.sn-btn[data-sp="${id}"]`).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const same = await page.evaluate((id) => { const b = document.querySelector(`.sn-btn[data-sp="${id}"]`); renderView(); return b === document.querySelector(`.sn-btn[data-sp="${id}"]`); }, id);
    await page.mouse.up();
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => ({ pane: S.settingsPane, on: (document.querySelector('.sn-btn.on') || {}).dataset?.sp }));
    ok(same, id + ': the button under the pointer is the same button after the redraw');
    ok(r.pane === id && r.on === id, id + ': and the press opened it, first time', r);
  }

  section(w + 'px: a redraw still brings the menu up to date when it has changed');
  {
    const r = await page.evaluate(async () => {
      const s = document.getElementById('set-search'); s.value = 'appear'; s.dispatchEvent(new Event('input'));
      await new Promise(z => setTimeout(z, 50));
      const shown = [...document.querySelectorAll('.sn-btn')].map(b => b.dataset.sp);
      const s2 = document.getElementById('set-search'); s2.value = ''; s2.dispatchEvent(new Event('input'));
      await new Promise(z => setTimeout(z, 50));
      return { shown, back: document.querySelectorAll('.sn-btn').length };
    });
    ok(r.shown.length === 1 && r.shown[0] === 'appearance', 'searching narrows the menu', r.shown);
    ok(r.back > 1, 'and clearing the search brings every section back', r.back);
  }
  ok(errors.length === 0, 'no page errors', errors.slice(0, 2));
  await app.close();
}

report();
done();
