/* THE AMBIENT WASH IS VALID CSS.  (AMV-AUD-028)

   `body::before` carried a background whose last layer was two loose colour
   stops and a stray parenthesis - `..., #0a0a0a 55%, #06070a 100%)` - outside
   any gradient. A browser drops an invalid declaration WHOLE, silently, so the
   rule had no background at all and nothing said so. A later layer hides the
   element (`display:none!important`), which is why nobody saw it; the rule is
   fixed rather than left, because the next person to show the wash again would
   get nothing and no error.

   Checked the only way that means anything: by what the browser kept. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

section('The browser keeps the declaration');
{
  /* Computed, not parsed. The value uses var(), and a declaration with var()
     in it is not validated when the stylesheet is read - it is checked when
     the value is computed, and an invalid one computes to the initial value,
     `none`. The first version of this read the parsed rule, which is empty for
     any shorthand containing var(), valid or not, and so proved nothing. */
  const bg = await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage);
  ok(/radial-gradient/.test(bg) && /linear-gradient/.test(bg),
     'body::before computes to its four gradient layers, not to none - this was the finding', bg.slice(0, 120));
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
