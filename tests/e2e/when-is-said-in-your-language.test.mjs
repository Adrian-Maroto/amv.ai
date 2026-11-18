/* WHEN SOMETHING HAPPENED IS SAID IN THE SCREEN'S OWN LANGUAGE.

   Four screens (Build's recents, the approval preview, marketplace messages,
   Connected accounts) each wrote their own "2h ago" in English whatever the
   language. They now share amvAgo, which asks the browser. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

section('Every one of them, in Spanish');
{
  const r = await page.evaluate(() => {
    const was = document.documentElement.lang; document.documentElement.lang = 'es';
    try{
      const t = Date.now() - 2 * 36e5;
      return { conn: _connAgo(t), build: _agoLabel(t), apv: _apvAgo(t), msg: _timeAgo(t),
               soon: _apvAgo(Date.now() + 5 * 6e4), yday: amvAgo(Date.now() - 864e5), old: amvAgo(Date.now() - 20 * 864e5) };
    } finally { document.documentElement.lang = was; }
  });
  const all = [r.conn, r.build, r.apv, r.msg, r.soon, r.yday];
  ok(all.every(s => s && !/\b(ago|in|yesterday|hours?|min)\b/.test(s)), 'no English left in any of them', r);
  ok(/hace 2 horas/.test(r.build) && /hace 2 horas/.test(r.conn), 'two hours ago is "hace 2 horas"', r);
  ok(/dentro de 5 min/.test(r.soon), 'a time still to come is said as one', r.soon);
  ok(r.yday === 'ayer', 'a day ago is "ayer"', r.yday);
  ok(!/hace/.test(r.old) && /\d/.test(r.old), 'and three weeks ago is a date, not a count of days', r.old);
}

section('And in English, still English');
{
  const r = await page.evaluate(() => ({ a: amvAgo(Date.now() - 5 * 6e4), b: amvAgo(Date.now() - 1000), z: amvAgo(0) }));
  ok(/5 minutes ago/.test(r.a) && r.b === 'now' && r.z === '', 'five minutes ago, now, and nothing for no time', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
