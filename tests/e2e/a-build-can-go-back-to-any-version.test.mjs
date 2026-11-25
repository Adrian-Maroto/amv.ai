/* A BUILD CAN GO BACK TO ANY VERSION, AND THE PREVIEW CAN BE STARTED AGAIN
   (owner, Nov 25: "fix everything AMV is behind"). The leading app builders
   give every change a version with Restore, and a Refresh above the preview;
   AMV had Undo per turn and no way to jump back further, and no Refresh.
   Held:
     · every applied turn but the newest offers Restore this version;
     · restoring puts the whole project back to how it stood after that turn,
       and is itself a turn, with its own Undo that brings the later work back;
     · restoring to where the project already is changes nothing and says so;
     · Refresh starts a fresh page from the files and keeps the chosen size. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', viewport: { width: 1280, height: 860 } });
const { page, errors } = app;
await page.waitForTimeout(400);

await page.evaluate(() => {
  document.querySelectorAll('.cc-banner').forEach(b => b.remove());
  setTab('dev'); renderCodeView();
  _DEV.log = [{ role: 'user', text: 'a page' }];
  const turn = (html, say) => { const b = _devSnapshot(); _devSetFile('index.html', html, 'html'); const a = _devSnapshot();
    _DEV.log.push({ role: 'ai', text: say, changes: _devChangeSet(b, a), chgId: _devRecordTurn(b, a) }); };
  turn('<!doctype html><h1>one</h1>', 'first');
  turn('<!doctype html><h1>two</h1>', 'second');
  turn('<!doctype html><h1>three</h1>', 'third');
  _devRenderLog(); _devPaintPreview();
});
const file = () => page.evaluate(() => _DEV.project['index.html'].content);
const cards = () => page.evaluate(() => [...document.querySelectorAll('#dev-log .dvc')].map(c => ({ restore: !!c.querySelector('[data-dvc-restore]'), undo: (c.querySelector('[data-dvc-undo]') || {}).textContent || '' })));

section('Every turn but the newest can be restored');
const c1 = await cards();
ok(c1.length === 3 && c1[0].restore && c1[1].restore && !c1[2].restore, 'Restore on the first two, not the newest', c1);

section('Restore puts the whole project back, as a turn of its own');
await page.click('#dev-log .dvc >> nth=0 >> [data-dvc-restore]');
await page.waitForTimeout(300);
ok(/one/.test(await file()), 'the project is as it was after the first turn', await file());
const c2 = await cards();
ok(c2.length === 4 && !c2[3].restore && /Undo/.test(c2[3].undo), 'the restore is a new turn, newest, with its own Undo', c2);
ok(await page.evaluate(() => /Restored the project/.test(_DEV.log[_DEV.log.length - 1].text)), 'and says what it did');
await page.click('#dev-log .dvc >> nth=3 >> [data-dvc-undo]');
await page.waitForTimeout(300);
ok(/three/.test(await file()), 'its Undo brings the later work back', await file());

section('Restoring to where the project already is changes nothing');
const before = await page.evaluate(() => _DEV.log.length);
await page.click('#dev-log .dvc >> nth=2 >> [data-dvc-restore]');
await page.waitForTimeout(300);
const after = await page.evaluate(() => ({ n: _DEV.log.length, toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ') }));
ok(after.n === before && /already at this version/.test(after.toast), 'no new turn, and it says so', after);

section('Refresh starts the page again and keeps the size');
await page.click('#dev-tab-prev').catch(() => {});
await page.click('#dev-vp [data-vp="phone"]');
await page.waitForTimeout(200);
const r = await page.evaluate(() => { window.__oldFrame = document.querySelector('#dev-prev-body .dev-prev-frame'); return !!window.__oldFrame; });
ok(r, 'a page is running');
await page.click('#dev-refresh');
await page.waitForTimeout(500);
const rr = await page.evaluate(() => { const f = document.querySelector('#dev-prev-body .dev-prev-frame');
  return { fresh: !!f && f !== window.__oldFrame, w: f ? Math.round(f.getBoundingClientRect().width) : 0 }; });
ok(rr.fresh, 'a fresh page, not the old one', rr);
ok(rr.w === 390, 'still at phone size', rr);

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
report();
await app.close();
done();
