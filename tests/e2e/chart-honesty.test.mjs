/* A CHART IS A CLAIM ABOUT DATA.

   The model can emit a ```chart block and AMV draws it. Every label goes
   through escaping, which is the security question and it was already right.
   The honesty question was not.

   A point whose value is not a number produced NaN coordinates, and an SVG
   element with NaN geometry does not draw at all. So a chart of five figures
   would render four bars, silently, with nothing to say one was missing. The
   reader sees a complete-looking picture of incomplete data - which is the same
   failure as an empty list that means "could not load", in a form somebody is
   more likely to act on.

   Charts are also the one place a wrong number does not look wrong. Nobody
   audits a bar. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

section('A chart of readable numbers draws all of them');
{
  const r = await page.evaluate(() => {
    const html = renderChartSVG({ type: 'bar', title: 'Revenue',
      data: [{ label: 'A', value: 10 }, { label: 'B', value: 20 }, { label: 'C', value: 30 }] });
    return { bars: (html.match(/<rect /g) || []).length, note: /could not be read/.test(html), html };
  });
  ok(r.bars === 3, 'every point becomes a bar', r.bars);
  ok(!r.note, 'and nothing is reported missing, because nothing is', r.note);
  ok(!/NaN/.test(r.html), 'with no NaN geometry anywhere', true);
}

section('A point that is not a number is said out loud, not dropped in silence');
{
  const r = await page.evaluate(() => {
    const html = renderChartSVG({ type: 'bar',
      data: [{ label: 'A', value: 10 }, { label: 'B', value: 'n/a' }, { label: 'C', value: 5 }] });
    return { bars: (html.match(/<rect /g) || []).length, html };
  });
  ok(r.bars === 2, 'the readable points are drawn', r.bars);
  ok(/1 point could not be read as a number and is not shown/.test(r.html),
     'and the one that was not is named under the chart', true);
  ok(!/NaN/.test(r.html), 'with no NaN left in the markup', true);
}

section('Several unreadable points read as several');
{
  const r = await page.evaluate(() => renderChartSVG({ type: 'bar',
    data: [{ label: 'A', value: 1 }, { label: 'B', value: null }, { label: 'C', value: 'x' }] }));
  ok(/2 points could not be read as a number and are not shown/.test(r),
     'the sentence agrees with itself in the plural', true);
}

section('A chart with nothing readable in it is not drawn at all');
{
  /* Better than an empty axis, which reads as "the answer is zero". */
  const r = await page.evaluate(() => renderChartSVG({ type: 'bar',
    data: [{ label: 'A', value: 'x' }, { label: 'B', value: undefined }] }));
  ok(r === '', 'no chart rather than an empty one', JSON.stringify(r).slice(0, 40));
}

section('Labels from the model are still escaped');
{
  /* The security property that was already right, pinned so the honesty change
     above cannot have quietly loosened it. */
  const r = await page.evaluate(() => renderChartSVG({ type: 'bar', title: '<img src=x onerror=alert(1)>',
    source: '<b>src</b>', data: [{ label: '<script>bad()</script>', value: 3 }] }));
  ok(!/<img|<script>bad|<b>src/.test(r), 'no markup from a label reaches the DOM', r.slice(0, 120));
  ok(/&lt;/.test(r), 'it is entity-escaped instead', true);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('chart-honesty') > 0) process.exitCode = 1;
done();
