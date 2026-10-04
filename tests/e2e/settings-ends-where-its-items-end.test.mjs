/* SETTINGS ENDS WHERE ITS ITEMS END.

   Asked for: "fix settings, make sure it actually looks good - there is a huge
   blank space below Platform, looks off - delete Apps and Extensions".

   On a desktop the section list was a framed column the full height of the
   window, so below its last item (Platform, for the owner) stood a tall empty
   panel with its own divider. The pane heading also sat 50px above its own
   subtitle, because the pane spaces every child 22px apart. And the account
   menu still offered "Apps & Extensions". */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'settings', user: { name: 'Adrian Maroto', email: 'kubikam@icloud.com', ini: 'A' } });
const { page, errors } = app;
await page.setViewportSize({ width: 1280, height: 900 });
await page.evaluate(() => setTab('settings'));
await page.waitForTimeout(600);

section('On a desktop the list is as tall as its items, not the window');
{
  const r = await page.evaluate(() => {
    const nav = document.querySelector('.settings-nav'), btns = [...nav.querySelectorAll('.sn-btn')];
    const last = btns[btns.length - 1].getBoundingClientRect(), n = nav.getBoundingClientRect();
    const shell = document.querySelector('.settings-shell').getBoundingClientRect();
    return { lastLabel: btns[btns.length - 1].textContent.trim(), below: Math.round(n.bottom - last.bottom),
             navH: Math.round(n.height), shellH: Math.round(shell.height), borderRight: getComputedStyle(nav).borderRightStyle,
             radius: parseFloat(getComputedStyle(nav).borderTopLeftRadius) };
  });
  ok(r.lastLabel === 'Platform', 'the owner sees the operator sections, Platform last', r.lastLabel);
  ok(r.below < 40, 'the list ends just under its last item - no tall empty panel below Platform', r);
  ok(r.navH < r.shellH - 100 && r.radius > 0, 'and it is a panel the size of its contents, not a full-height column', r);
}

section('The heading sits on its own subtitle');
{
  const r = await page.evaluate(() => {
    const t = document.querySelector('.settings-content .set-title').getBoundingClientRect();
    const s = document.querySelector('.settings-content .set-title + .set-sub').getBoundingClientRect();
    return { gap: Math.round(s.top - t.bottom) };
  });
  ok(r.gap >= 0 && r.gap <= 12, 'heading and subtitle read as one block', r.gap);
}

section('The account menu no longer offers Apps & Extensions');
{
  const r = await page.evaluate(() => {
    document.getElementById('nav-av').click();
    const t = (document.querySelector('.prof-menu, #prof-menu') || document.body).textContent;
    return { apps: /Apps\s*&\s*Extensions/.test(t), item: !!document.getElementById('pm-apps'), settings: !!document.getElementById('pm-settings') };
  });
  ok(!r.apps && !r.item, 'no Apps & Extensions item', r);
  ok(r.settings, 'and Settings is still there', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
if (report('settings-ends-where-its-items-end') > 0) process.exitCode = 1;
done();
