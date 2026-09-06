/* THE MOST COMMON SHAPE IN AN ANSWER LOST THE THING THAT MADE IT ONE.

   `md()` converted lists in three steps, in this order: bullets to `<li>`,
   wrap the run in `<ul>`, then numbered items to `<li>`. The wrap had already
   run, so an ordered list came out as bare `<li>` elements with no parent:

       md('1. one\n2. two')  ->  '<li>one</li><li>two</li>'

   A browser renders a parentless `<li>` as a plain block - no marker, no
   indent - so "1. Lead with what it does / 2. Put the ceiling second /
   3. Say what happens" arrived as three flat sentences that read as
   unrelated. Steps, rankings, procedures: every answer where the ORDER is
   the meaning.

   Underneath it was a second bug. `md` only ever emitted `<ul>`, so even
   correctly wrapped a numbered list would have shown bullets. `.mb ul,.mb ol`
   has been styled since the beginning - the stylesheet was ready and nothing
   ever produced the tag.

   Found by rendering a realistic answer and looking at the screenshot, which
   is the only way this shows up: no error, no warning, valid-looking text. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
const render = (src) => page.evaluate((s) => md(s), src);

section('A numbered list is an ordered list');
{
  const out = await render('1. First thing\n2. Second thing\n3. Third thing');
  ok(/^<ol>/.test(out), 'it opens an <ol>', out.slice(0, 60));
  ok(/<\/ol>$/.test(out), 'and closes it', out.slice(-30));
  ok((out.match(/<li>/g) || []).length === 3, 'with one item per line', out);
  /* The defect exactly: items with no list around them at all. */
  ok(!/^<li>/.test(out), 'and never a bare <li> with no parent - the fault this fixes', out.slice(0, 40));
}

section('Bullets are untouched');
{
  const out = await render('- alpha\n- beta');
  ok(out === '<ul><li>alpha</li><li>beta</li></ul>',
     'a bulleted list still renders exactly as it did', out);
}

section('The awkward shapes');
{
  ok(/^<ol><li>only one<\/li><\/ol>$/.test(await render('1. only one')),
     'a single numbered item is still a list', await render('1. only one'));

  const mixed = await render('Do this:\n\n1. one\n2. two\n\nAlso:\n\n- a\n- b');
  ok(/<ol>.*<\/ol>/.test(mixed) && /<ul>.*<\/ul>/.test(mixed),
     'a numbered run and a bulleted run in one answer stay separate and keep their own kind', mixed);
  ok(mixed.indexOf('<ol>') < mixed.indexOf('<ul>'),
     'in the order they were written', mixed);

  ok(/<ol><li><strong>bold<\/strong> item<\/li>/.test(await render('1. **bold** item\n2. plain')),
     'inline formatting inside an item survives', await render('1. **bold** item\n2. plain'));

  /* The negative that matters: not every "digit dot" is a list. */
  const prose = await render('The year 1999. It was fine.');
  ok(!/<[ou]l>|<li>/.test(prose),
     'a sentence containing a number and a full stop is NOT turned into a list', prose);
}

section('And it survives into the actual thread');
{
  await page.evaluate(async () => {
    const cur = S.convs.find(c => c.id === S.cur) || S.convs[0];
    cur.msgs = [{ r: 'u', c: 'steps please' },
                { r: 'a', c: 'Here:\n\n1. First\n2. Second\n3. Third' }];
    renderChatMsgs();
    await new Promise(r => setTimeout(r, 350));
  });
  const seen = await page.evaluate(() => {
    const ol = document.querySelector('#cm .mb ol');
    if (!ol) return { found: false };
    const li = ol.querySelector('li');
    return { found: true, items: ol.children.length,
             listStyle: getComputedStyle(ol).listStyleType,
             indented: parseFloat(getComputedStyle(ol).paddingLeft) > 8,
             marker: getComputedStyle(li, '::marker').content };
  });
  ok(seen.found, 'the thread really contains an <ol>, not loose text', seen);
  ok(seen.items === 3, 'with all three steps in it', seen.items);
  ok(seen.listStyle === 'decimal',
     'numbered rather than bulleted - the second half of the bug', seen.listStyle);
  ok(seen.indented, 'and indented, so it reads as a list', seen.indented);
}

section('Nothing broke');
ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));

await app.close();
if (report('a-numbered-list-keeps-its-numbers') > 0) process.exitCode = 1;
done();
