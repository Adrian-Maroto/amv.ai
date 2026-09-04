/* A HOMEWORK LIST WITH A WHOLE CLASS MISSING, AND NO REASON TO DOUBT IT.

   `schoolWork` fetches each course's assignments in a separate request, and any
   one of them can fail on its own - a course whose token scope changed, one
   Canvas is slow to answer for, one that 500s. The server refuses to drop
   those in silence: it returns `partial`, names them in `missedCourses`, and
   writes a `notice` saying which classes are missing from the list. The
   comment beside it is explicit that a list with a class quietly absent is the
   worst way for this to be wrong.

   The screen read `work` and nothing else. All three fields were dropped, so a
   student saw a list that looked complete. And in the case where EVERY course
   failed - an expired connection, Canvas down - the list came back empty and
   the screen answered "Nothing is due", flatly, to somebody with homework. */
import { ok, section, report, done } from '../lib/assert.mjs';
import { bootApp } from '../lib/harness.mjs';

const A = (name, course) => ({ id: name, name, course, courseId: 'c1', docs: [], dueAt: null });

const app = await bootApp({ tab: 'chat' });
try {
  await app.connect();
  await app.stubFetch(async (u) => {
    if (u.includes('/v1/school/work')) {
      window.__reads = (window.__reads || 0) + 1;
      return { ok: true, json: async () => window.__work };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  });

  const render = async (payload) => app.page.evaluate(async (p) => {
    window.__work = p;
    document.getElementById('ovr').innerHTML = '<div id="sch-body"></div>';
    await _schoolRender();
    const b = document.getElementById('sch-body');
    return { text: b.innerText, html: b.innerHTML };
  }, payload);

  section('A complete list is shown with nothing added to it');
  {
    const r = await render({ connected: true, work: [A('Essay', 'English')], count: 1, partial: false, missedCourses: [] });
    ok(/Essay/.test(r.text), 'the assignment is listed');
    ok(!/sch-partial/.test(r.html), 'and no warning is invented when nothing is missing', r.html.slice(0, 120));
  }

  section('A list missing one class names the class');
  {
    const r = await render({
      connected: true, work: [A('Essay', 'English')], count: 1,
      partial: true, missedCourses: ['Chemistry'],
      notice: 'AMV could not read Chemistry, so anything due in it is not in this list.',
    });
    ok(/Essay/.test(r.text), 'what could be read is still shown - the screen is not thrown away');
    ok(/sch-partial/.test(r.html), 'and the warning is rendered', r.html.slice(0, 200));
    ok(/Chemistry/.test(r.text), 'naming the class that is missing', r.text.slice(0, 300));
    ok(/not complete/i.test(r.text), 'and saying plainly that the list is not complete', r.text.slice(0, 300));
    ok(/sch-retry/.test(r.html), 'with a way to try again', r.html.slice(0, 300));
  }

  section('Every class failing is not "Nothing is due"');
  /* The one that matters most. An expired connection or a Canvas outage empties
     `work`, and the old screen answered a student with homework by telling them
     they had none. */
  {
    const r = await render({
      connected: true, work: [], count: 0,
      partial: true, missedCourses: ['English', 'Chemistry', 'History'],
      notice: 'AMV could not read English, Chemistry, History, so anything due in them is not in this list.',
    });
    ok(!/Nothing is due/i.test(r.text), 'it does not claim there is no homework', r.text.slice(0, 300));
    ok(/English/.test(r.text) && /History/.test(r.text), 'it names every class it could not read', r.text.slice(0, 300));
    ok(/sch-retry/.test(r.html), 'and offers the retry', r.html.slice(0, 200));
  }

  section('A genuinely empty list still says so');
  {
    const r = await render({ connected: true, work: [], count: 0, partial: false, missedCourses: [] });
    ok(/Nothing is due/i.test(r.text), 'because nothing failed - that answer is true here', r.text.slice(0, 200));
    ok(!/sch-partial/.test(r.html), 'and it is not dressed up as a failure', r.html.slice(0, 120));
  }

  section('The retry really re-reads');
  {
    const n = await app.page.evaluate(async () => {
      window.__work = { connected: true, work: [], count: 0, partial: true, missedCourses: ['Art'] };
      window.__reads = 0;
      await schoolReload();
      return window.__reads;
    });
    ok(n === 1, 'pressing it goes back to the server rather than repainting the same answer', n);
  }

  section('The warning is legible in both themes');
  {
    const seen = await app.page.evaluate(async () => {
      const out = {};
      for (const light of [false, true]) {
        document.body.classList.toggle('light', light);
        window.__work = { connected: true, work: [], count: 0, partial: true, missedCourses: ['Art'] };
        document.getElementById('ovr').innerHTML = '<div id="sch-body"></div>';
        await _schoolRender();
        const el = document.querySelector('.sch-partial b');
        /* Report the absence rather than throwing on it. A suite that crashes
           here says "TypeError" where it should say "the warning was not
           rendered", and LESSONS 348 is about exactly that. */
        if(!el){ out[light ? 'light' : 'dark'] = null; continue; }
        const cs = getComputedStyle(el);
        const bg = (function walk(n) {
          while (n && n !== document.documentElement) {
            const c = getComputedStyle(n).backgroundColor;
            const m = c.match(/[\d.]+/g);
            if (m && (m.length < 4 || +m[3] === 1)) return c;
            n = n.parentElement;
          }
          return getComputedStyle(document.body).backgroundColor;
        })(el);
        out[light ? 'light' : 'dark'] = { fg: cs.color, bg };
      }
      document.body.classList.remove('light');
      return out;
    });
    const lum = (c) => {
      const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {
        v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (const k of ['dark', 'light']) {
      if (!seen[k]) { ok(false, 'the warning was rendered at all in ' + k, seen[k]); continue; }
      const r = ratio(seen[k].fg, seen[k].bg);
      ok(r >= 4.5, 'the heading is readable in ' + k + ' (' + r.toFixed(2) + ':1)', seen[k]);
    }
  }

  ok(app.errors.length === 0, 'and no page error was thrown throughout', app.errors);
} finally {
  await app.close();
}

report();
done();
