/* AN OPTION YOU CAN PICK AND CANNOT GET.

   The Build surfaces let you choose which engine powers them. Three things were
   wrong with that, and all three were invisible because the control looked and
   behaved exactly like a working one.

   1. STUDIO HAD NO PICKER AT ALL. Every Studio generation and refine is sent
      with _sectionModel('design'), which reads amv_secmodel_design - and
      _sectionModelSelect had only ever been called for 'code' and 'debug'.
      Nothing in the product could write that key. The setting was wired at the
      read end and unreachable at the write end, so the design engine was pinned
      to its default forever, on the one surface of three where you could not
      change it. Studio had no "New session" either, while Dev and Lab both did,
      so designs accumulated in one project with no way to start clean.

   2. AUTO WAS CLAMPED TO THE HEAVIEST ENGINE THE PLAN ALLOWS. PLAN_TIERS lists
      engines; 'auto' is not one, so _planAllowedModel found it missing and
      "clamped" it by walking the fallback ladder from the top. On Elite that is
      Apex, the most expensive engine in the product, on every build call from
      anybody who chose "picks for you". Meanwhile the server has routed auto
      properly since AMV-065 - cheapest engine that will not visibly do a worse
      job, plan ceiling applied server-side, engine reported back - and none of
      that was reachable, because the browser resolved it away first.

   3. EVERY ENGINE WAS OFFERED ON EVERY PLAN. Choosing Apex on Free selected it,
      toasted "set to AMV Apex", stored it, and then ran Core. Present,
      chooseable and inert.

   This file drives the real page rather than reading the source, because the
   failure in all three cases was a control that reads correctly and does not
   do what it says. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Ada', email: 'ada@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.setViewportSize({ width: 1440, height: 900 });

const setPlan = (p) => page.evaluate(v => { saveStr('amv_plan', v); }, p);
const studio  = () => page.evaluate(() => { setTab('studio'); });

section('Studio can choose an engine, like Dev and Lab always could');
{
  await setPlan('elite');
  await studio();
  await page.waitForTimeout(450);

  const bar = await page.evaluate(() => ({
    picker: !!document.getElementById('studio-model'),
    fresh:  !!document.getElementById('studio-new'),
    devHas: true,
  }));
  ok(bar.picker, 'Studio home has an engine picker');
  ok(bar.fresh, 'and a way to start a new project');

  /* The part that matters: it has to reach the key Studio actually sends with. */
  const wrote = await page.evaluate(() => {
    const s = document.getElementById('studio-model');
    const pick = [...s.options].find(o => !o.disabled && o.value === 'coding');
    if (!pick) return { skipped: true };
    s.value = 'coding';
    s.dispatchEvent(new Event('change'));
    return { stored: loadStr('amv_secmodel_design'),
             resolves: _sectionModelKey('design'),
             sends: _sectionModel('design') };
  });
  ok(wrote.stored === 'coding', 'choosing an engine writes the key Studio reads', wrote.stored);
  ok(wrote.resolves === 'coding', 'and it survives the plan clamp on a plan that allows it', wrote.resolves);
  ok(wrote.sends === 'amv-forge', 'and that is the engine string sent to the server', wrote.sends);
}

section('Auto asks the server to route, it does not silently buy the dearest engine');
{
  /* Elite is the case that cost the most: the fallback ladder starts at Apex,
     so every auto call from an Elite account ran the most expensive engine
     there is. */
  const r = await page.evaluate(() => {
    saveStr('amv_secmodel_design', 'auto');
    return { resolves: _sectionModelKey('design'), sends: _sectionModel('design'),
             code: _sectionModelKey('code'), debug: _sectionModelKey('debug') };
  });
  ok(r.resolves === 'auto', 'auto stays auto on Elite, rather than becoming Apex', r.resolves);
  ok(r.sends === 'auto', 'and auto is what goes on the wire, for the server to route', r.sends);

  await setPlan('free');
  const f = await page.evaluate(() => ({
    resolves: _sectionModelKey('design'), sends: _sectionModel('design'),
  }));
  ok(f.resolves === 'auto', 'and it stays auto on Free too, where routing saves the most', f.resolves);
  ok(f.sends === 'auto', 'free sends auto as well', f.sends);

  /* An engine IS still clamped - this must not have loosened the plan gate. */
  const clamp = await page.evaluate(() => {
    saveStr('amv_secmodel_design', 'smart');
    return _sectionModelKey('design');
  });
  ok(clamp !== 'smart', 'a real engine above the plan is still clamped', clamp);
  ok(clamp === 'core', 'down to the best one Free can actually run', clamp);
}

section('An engine the plan cannot run is not offered as though it could');
{
  await setPlan('free');
  await studio();
  await page.waitForTimeout(450);

  const opts = await page.evaluate(() => {
    const s = document.getElementById('studio-model');
    return [...s.options].map(o => ({ v: o.value, dis: o.disabled, text: o.textContent }));
  });
  const by = Object.fromEntries(opts.map(o => [o.v, o]));

  ok(!by.auto.dis, 'Auto stays pickable on Free - the server routes within the plan');
  ok(!by.fast.dis && !by.core.dis, 'the engines Free includes are pickable');
  ok(by.coding.dis, 'Forge is disabled on Free rather than pickable-then-ignored');
  ok(by.smart.dis, 'and so is Apex');
  ok(/Pro/.test(by.coding.text), 'a disabled engine names the plan that unlocks it', by.coding.text);
  ok(/Elite/.test(by.smart.text), 'Apex points at Elite', by.smart.text);

  /* And the same control, on the surfaces that always had one. */
  await page.evaluate(() => { setTab('dev'); });
  await page.waitForTimeout(450);
  const dev = await page.evaluate(() => {
    const s = document.getElementById('dev-model');
    return s ? [...s.options].filter(o => o.disabled).map(o => o.value) : null;
  });
  ok(dev && dev.includes('smart'), 'Dev disables Apex on Free the same way', dev);

  await page.evaluate(() => { setTab('lab'); });
  await page.waitForTimeout(450);
  const lab = await page.evaluate(() => {
    const s = document.getElementById('lab-model');
    return s ? [...s.options].filter(o => o.disabled).map(o => o.value) : null;
  });
  ok(lab && lab.includes('smart'), 'and so does Lab', lab);
}

section('An auto-routed call still reaches the operator spend figure');
{
  /* The browser sends 'auto' and the server picks the engine, so nothing here
     knows which one answered. Without a price entry the lookup missed and the
     call was costed at zero - on the number the operator reads as spend. */
  const cost = await page.evaluate(() => {
    const before = AEGIS.usage().costUSD;
    AEGIS.recordUsage('auto', 100000, 20000);
    return { before, after: AEGIS.usage().costUSD };
  });
  ok(cost.after > cost.before, 'an auto call adds to estimated spend rather than nothing',
     cost.before.toFixed(4) + ' -> ' + cost.after.toFixed(4));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
