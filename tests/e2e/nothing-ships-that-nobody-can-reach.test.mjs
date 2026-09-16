/* 13.4KB AND SEVEN BUTTONS THAT NO CODE PATH COULD SHOW.

   `index.html` carried a whole landing page - hero, pricing grid, feature
   flow, trust badges, footer - and every boot branch hid it. The signed-in
   one, the "account is gone" one, and the first-ever-visit one, whose own
   comment says a new visitor goes "straight into the app, gated at first
   send". Three branches, three `land.classList.add('hidden')`, and nothing
   anywhere that took it off again.

   The weight was the smaller half. Nothing MEASURED it either: the tap-target
   suite, the keyboard suite and the sweeps all walk `#app` and `#ovr`, so
   those seven controls sat outside every check the rest of the product is held
   to. Dead code that is also unmeasured is the worst kind to leave - it reads
   as a fallback somebody could switch back on, and switching it on would ship
   seven controls nothing has ever looked at.

   This file is the rule rather than the instance: what a visitor downloads has
   to be something a visitor can get to. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

section('The shell holds no screen the app cannot open');
{
  ok(!/id="land"/.test(html), 'the landing page is gone from the shell', /id="land"/.test(html));
  ok(!/id="lnav"/.test(html), 'and so is its nav', true);
  /* The two shells a visitor can actually be in. If a third appears, it needs
     a reason and something that opens it. */
  const shells = (html.match(/<div id="(app|ovr|land|splash)"/g) || []).sort();
  ok(!shells.includes('<div id="land"'), 'no landing shell is left behind', shells);
}

section('And the source does not still reach for it');
{
  /* A reference to an element that no longer exists is either a silent no-op
     or a TypeError. `goApp` held the one that was NOT optional-chained, so
     leaving the markup out while leaving that line in would have thrown on
     every boot. */
  const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
  ok(!/getElementById\('land'\)\.classList/.test(app),
     'nothing dereferences the landing element without a guard', true);
  ok(!/function setupLanding/.test(app), 'and its wiring went with it', true);
}

section('A first-ever visitor still lands in the app');
{
  /* The branch whose comment promises exactly this. It is the one that would
     break if removing the markup had been done carelessly, because it is the
     only one that runs for somebody with no account at all. */
  const app = await bootApp({ tab: 'chat', user: null });
  const r = await app.page.evaluate(() => ({
    land: !!document.getElementById('land'),
    appOn: document.getElementById('app').classList.contains('on'),
    tab: S.tab,
    hasView: !!(document.getElementById('vc') || {}).innerText,
  }));
  ok(r.land === false, 'there is no landing element to hide', r);
  ok(r.appOn === true, 'the app is showing', r);
  ok(r.tab === 'chat', 'on chat, which is where that branch sends them', r);
  ok(r.hasView === true, 'with something actually rendered', r);
  ok(app.errors.length === 0, 'and nothing threw on the way in', app.errors.slice(0, 3));
  await app.close();
}

section('The plans grid it used to fill is still rendered in-app');
{
  /* Removing a screen must not remove the thing it showed. The same cards come
     from planCards(true) on the Plans tab, which is the copy people see. */
  const app = await bootApp({ tab: 'chat' });
  const r = await app.page.evaluate(async () => {
    setTab('plans');
    await new Promise(x => setTimeout(x, 400));
    const vc = document.getElementById('vc');
    return { cards: vc.querySelectorAll('.plnc').length,
             buttons: vc.querySelectorAll('.plnbtn').length };
  });
  ok(r.cards >= 4, 'the plan cards are there', r);
  ok(r.buttons >= 4, 'each with something to press', r);
  await app.close();
}

report();
done();
