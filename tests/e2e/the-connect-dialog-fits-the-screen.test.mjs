/* THE CONNECT DIALOG FITS THE SCREEN.

   Google offers nine permissions. The dialog that listed them had no scrolling
   and no inner padding, so on a phone "Continue to Google" sat below the
   bottom edge - there was no way to press it - and one option read
   "drive.write", a scope string nobody should ever be shown. Measured on the
   smallest common phone and on a laptop, in both themes. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const GOOGLE = { id: 'google', name: 'Google',
  scopes: ['mail.read','mail.send','calendar.read','calendar.write','drive.read','school.read','drive.write','youtube.read','tasks.write'] };

for (const [label, viewport, touch] of [['a small phone', { width: 360, height: 640 }, true], ['a laptop', { width: 1280, height: 720 }, false]]) {
  const app = await bootApp({ tab: 'integrations', viewport, hasTouch: touch });
  const { page, errors } = app;
  section('On ' + label);
  {
    await page.evaluate((p) => { window.__pick = _connScopePick(p); }, GOOGLE);
    await page.waitForTimeout(350);
    const m = await page.evaluate(() => {
      const d = document.querySelector('#conn-bg [role="dialog"]'), b = d.querySelector('.cpk-body');
      const go = document.getElementById('conn-go').getBoundingClientRect(), r = d.getBoundingClientRect();
      const before = b.scrollTop; b.scrollTop = b.scrollHeight; const after = b.scrollTop;
      const labels = [...d.querySelectorAll('.cpk-lbl')].map(x => x.textContent);
      return { vh: innerHeight, vw: innerWidth, top: r.top, bottom: r.bottom, left: r.left, right: r.right,
        goTop: go.top, goBottom: go.bottom, scrolled: after > before, labels, n: d.querySelectorAll('[data-scope]').length };
    });
    ok(m.top >= 0 && m.bottom <= m.vh + 0.5 && m.left >= 0 && m.right <= m.vw + 0.5, 'the dialog is inside the screen', m);
    ok(m.goTop >= 0 && m.goBottom <= m.vh + 0.5, '"Continue to Google" is on screen without scrolling the page', { goTop: m.goTop, goBottom: m.goBottom, vh: m.vh });
    ok(m.scrolled, 'and the list of permissions scrolls inside the dialog', m.scrolled);
    ok(m.n === 9 && m.labels.every(l => !/^[a-z]+\.[a-z]+$/i.test(l) && /^[A-Z]/.test(l)), 'every permission is a sentence, none a scope string', m.labels);

    const picked = await page.evaluate(async () => {
      const boxes = [...document.querySelectorAll('[data-scope]')];
      boxes.forEach(b => { if (b.checked) b.click(); });
      const disabled = document.getElementById('conn-go').disabled;
      const count0 = document.getElementById('conn-count').textContent;
      boxes[2].click(); boxes[4].click();
      const count2 = document.getElementById('conn-count').textContent;
      document.getElementById('conn-go').click();
      return { disabled, count0, count2, result: await window.__pick };
    });
    ok(picked.disabled && /^0 of 9/.test(picked.count0), 'with nothing chosen, Continue cannot be pressed', picked);
    ok(/^2 of 9/.test(picked.count2) && JSON.stringify(picked.result) === '["calendar.read","drive.read"]', 'and it returns exactly what was ticked', picked);
  }
  ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
  await app.close();
}

report();
done();
