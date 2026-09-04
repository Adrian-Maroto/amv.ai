/* SET YOUR TEXT TO "VERY LARGE" AND NOTHING HAPPENED.

   Measured: with the root font at 24px and then 32px - Chrome's Large and Very
   Large, and the equivalent on a phone - the average size of text across
   thirty-one sampled elements stayed at 11.79px. Exactly the same page. Every
   step of the type scale was a hard `px`, so the one setting somebody with low
   vision changes ONCE, for everything, reached nothing.

   AMV has its own Small/Default/Large/Largest control and it works. That is
   not a substitute: a person should not have to discover a per-app setting, or
   know AMV has one, to get the size they already asked their browser for.

   The scale is in rem now. Every value is the same number of pixels at the
   default root of 16px, so nothing moves for anybody who has not changed the
   setting - which is what the first section here checks, because a fix that
   silently resizes the whole product for everyone is a different change from
   the one intended. */
import { ok, section, report, done } from '../lib/assert.mjs';
import { bootApp } from '../lib/harness.mjs';

const TABS = ['chat', 'build', 'crew', 'tasks', 'plans', 'settings', 'market', 'teams'];

/* The steps as they must render at the default root, in px. */
const EXPECTED = {
  '--t-3xs': 9, '--t-2xs': 10, '--t-xs': 11, '--t-sm': 12, '--t-base': 13.5,
  '--t-md': 14, '--t-prose': 15, '--t-lg': 16, '--t-xl': 20, '--t-2xl': 26, '--t-3xl': 34,
};

const app = await bootApp({ tab: 'chat', user: { name: 'Ada', email: 'a@x.com', ini: 'A' },
                            viewport: { width: 390, height: 844 } });
try {
  section('At the default setting, every step is the pixel size it always was');
  /* The whole risk of this change. A rem conversion that is off by a rounding
     step resizes the entire product for every user who never asked. */
  {
    const got = await app.page.evaluate((EXPECTED) => {
      const out = {};
      const probe = document.createElement('div');
      document.body.appendChild(probe);
      for (const k of Object.keys(EXPECTED)) {
        probe.style.fontSize = 'var(' + k + ')';
        out[k] = parseFloat(getComputedStyle(probe).fontSize);
      }
      probe.remove();
      return out;
    }, EXPECTED);
    for (const [k, want] of Object.entries(EXPECTED)) {
      ok(Math.abs(got[k] - want) < 0.02, k + ' is still ' + want + 'px', got[k]);
    }
  }

  section('And the browser setting now reaches the text');
  {
    const sizes = await app.page.evaluate(async () => {
      const sample = () => {
        const out = [];
        for (const el of document.querySelectorAll('#app *')) {
          const t = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
          if (t.length < 3) continue;
          const b = el.getBoundingClientRect(); if (b.width < 4 || b.height < 4) continue;
          out.push(parseFloat(getComputedStyle(el).fontSize));
          if (out.length > 60) break;
        }
        return out.reduce((a, b) => a + b, 0) / (out.length || 1);
      };
      const at = {};
      for (const px of [16, 24, 32]) {
        document.documentElement.style.fontSize = px + 'px';
        await new Promise(r => setTimeout(r, 120));
        at[px] = +sample().toFixed(2);
      }
      document.documentElement.style.fontSize = '';
      return at;
    });
    ok(sizes[24] > sizes[16] * 1.4, 'Large really is larger (' + sizes[16] + ' -> ' + sizes[24] + ')', sizes);
    ok(sizes[32] > sizes[16] * 1.9, 'and Very Large is nearly double (' + sizes[32] + ')', sizes);
  }

  section('Nothing scrolls sideways at any of those sizes');
  /* Text that grows and a layout that does not is how a resize setting becomes
     a broken page - which is the reason most products give for not honouring
     it. Measured on a phone-width viewport, where there is least room. */
  {
    const bad = await app.page.evaluate(async (TABS) => {
      const out = [];
      for (const px of [24, 32]) {
        document.documentElement.style.fontSize = px + 'px';
        for (const tab of TABS) {
          try { setTab(tab); } catch (e) { continue; }
          await new Promise(r => setTimeout(r, 200));
          const de = document.documentElement;
          const over = Math.round(de.scrollWidth - de.clientWidth);
          if (over > 2) out.push(px + 'px/' + tab + ' overflows by ' + over);
        }
      }
      document.documentElement.style.fontSize = '';
      return out;
    }, TABS);
    ok(bad.length === 0, 'no screen overflows at Large or Very Large', bad.slice(0, 5));
  }

  section('The in-app control still multiplies on top of it');
  /* Both settings are real and they compose: somebody on Large in the browser
     who also picks Largest in AMV gets both. */
  {
    const r = await app.page.evaluate(async () => {
      const probe = document.createElement('div');
      document.body.appendChild(probe);
      probe.style.fontSize = 'var(--t-md)';
      const read = () => parseFloat(getComputedStyle(probe).fontSize);
      const plain = read();
      document.documentElement.classList.add('fs-scaled');
      document.documentElement.style.setProperty('--fs-scale', '1.25');
      await new Promise(r => setTimeout(r, 60));
      const scaled = read();
      document.documentElement.style.fontSize = '32px';
      await new Promise(r => setTimeout(r, 60));
      const both = read();
      document.documentElement.style.fontSize = '';
      document.documentElement.style.removeProperty('--fs-scale');
      document.documentElement.classList.remove('fs-scaled');
      probe.remove();
      return { plain, scaled, both };
    });
    ok(Math.abs(r.scaled - r.plain * 1.25) < 0.3, 'the app setting alone scales', r);
    ok(Math.abs(r.both - r.plain * 1.25 * 2) < 0.6, 'and the two multiply rather than one replacing the other', r);
  }

  ok(app.errors.length === 0, 'and no page error was thrown throughout', app.errors);
} finally {
  await app.close();
}

report();
done();
