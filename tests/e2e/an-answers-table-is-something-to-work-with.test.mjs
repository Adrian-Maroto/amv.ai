/* AN ANSWER'S TABLE IS SOMETHING TO WORK WITH, AND OPTIONS COME AS CARDS.

   A markdown table in an answer was a static grid. Now its headers sort -
   money as money, not as text - Copy puts it on the clipboard as cells a
   spreadsheet reads, and Open as table hands it to the spreadsheet editor.
   On a phone a wide one scrolls sideways instead of crushing its columns.

   And a ```cards block draws options as cards: title, facts, body, link -
   escaped, with only http(s) links. Driven through the real chat renderer. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Ana', email: 'ana@example.com', ini: 'A' }, viewport: { width: 390, height: 844 }, hasTouch: true });
const { page, errors, context } = app;
try { await (context || page.context()).grantPermissions(['clipboard-read', 'clipboard-write']); } catch (e) {}

const ANSWER = `Here are the three options.

| Plan | Price | Seats | Notes |
|---|---|---|---|
| Starter | $9 | 1 | Basic |
| Team | $1,200 | 25 | Most popular with large teams and agencies |
| Growth | $800 | 10 | |

\`\`\`cards
{"title":"Where to stay","items":[
 {"title":"Hotel Sol","subtitle":"Old town","badge":"Top pick","facts":[{"label":"Night","value":"€120"}],"body":"Quiet, near the market.","url":"https://example.com/sol"},
 {"title":"<img src=x onerror=alert(1)>","facts":[{"label":"Night","value":"€80"}],"url":"javascript:alert(1)"}
]}
\`\`\``;

await page.evaluate((a) => {
  localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
  document.getElementById('cookie-consent-banner')?.remove();
  newChat(); setMsgs([{ r: 'u', c: 'Compare plans and hotels' }, { r: 'a', c: a }]); renderChatMsgs();
}, ANSWER);
const col = (i) => page.evaluate((i) => [...document.querySelectorAll('#cm .mtbl-t tr')].slice(1).map(tr => tr.children[i].textContent.trim()), i);

section('Headers sort, and money sorts as money');
{
  ok(await page.evaluate(() => document.querySelectorAll('#cm .mtbl .mtbl-b').length === 2), 'the table has Open as table and Copy');
  await page.click('#cm .mtbl-t th:nth-child(2)');
  ok((await col(1)).join(',') === '$9,$800,$1,200', 'Price ascending: $9, $800, $1,200 - not alphabetical', await col(1));
  await page.click('#cm .mtbl-t th:nth-child(2)');
  ok((await col(1)).join(',') === '$1,200,$800,$9', 'a second press reverses it', await col(1));
  ok(await page.evaluate(() => document.querySelector('#cm .mtbl-t th:nth-child(2)').getAttribute('aria-sort')) === 'descending', 'and the header says how it is sorted');
  await page.click('#cm .mtbl-t th:nth-child(4)');
  ok((await col(3))[2] === '', 'an empty cell goes last', await col(3));
  await page.focus('#cm .mtbl-t th:nth-child(1)');
  await page.keyboard.press('Enter');
  ok((await col(0)).join(',') === 'Growth,Starter,Team', 'a keyboard can sort too', await col(0));
}

section('Copy gives cells a spreadsheet reads');
{
  await page.click('#cm .mtbl [data-tbl="copy"]');
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok(/^Plan\tPrice\tSeats\tNotes\n/.test(clip) && /Team\t\$1,200\t25\t/.test(clip), 'tab-separated rows, header first', clip.slice(0, 80));
}

section('On a phone, a wide table scrolls instead of crushing');
{
  const r = await page.evaluate(() => { const s = document.querySelector('#cm .mtbl-scroll'); return { scroll: s.scrollWidth > s.clientWidth, page: document.documentElement.scrollWidth <= innerWidth }; });
  ok(r.page, 'the page itself never scrolls sideways', r);
}

section('Cards: drawn, escaped, and only real links');
{
  const c = await page.evaluate(() => [...document.querySelectorAll('#cm .gui-card')].map(x => ({ t: x.querySelector('.gui-card-t').textContent, a: (x.querySelector('.gui-card-a') || {}).href || '', html: x.innerHTML })));
  ok(c.length === 2 && c[0].t === 'Hotel Sol' && c[0].a === 'https://example.com/sol', 'the first card, with its link', c[0]);
  ok(c[1].t === '<img src=x onerror=alert(1)>' && !/<img/i.test(c[1].html.replace(/&lt;img/g, '')) && c[1].a === '', 'markup in a title is text, and a javascript: link is dropped', c[1]);
  ok(await page.evaluate(() => /Top pick/.test(document.querySelector('#cm .gui-card-badge').textContent) && /€120/.test(document.querySelector('#cm .gui-card-f').textContent)), 'with its badge and facts');
}

section('Open as table opens the spreadsheet editor with these rows');
{
  await page.click('#cm .mtbl [data-tbl="sheet"]');
  await page.waitForSelector('#sh-scroll .sh-cell', { timeout: 8000 });
  const heads = await page.evaluate(() => [...document.querySelectorAll('#sh-scroll thead .sh-cell')].map(e => e.textContent));
  ok(heads.join('|') === 'Plan|Price|Seats|Notes', 'the editor has the table’s columns', heads);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('an-answers-table-is-something-to-work-with') > 0) process.exitCode = 1;
done();
