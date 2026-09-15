/* THE COMMENT SAID IT DOES NOT CLOSE BY ACCIDENT. ESCAPE CLOSED IT.

   _apiShowOnce is the one moment an API key exists outside the server's
   memory: it is created, shown, and the server keeps only a hash. The comment
   sitting above it says "Modal, explicit, and it does not close by accident."

   The global Escape handler closes anything with children in #ovr, which is
   right for every dialog that can be reopened and wrong for this one. Measured
   before the fix: pressing Escape removed the only copy of the key.

   The fix is opt-in by marker - [data-keep-open] - rather than by naming this
   sheet inside the key handler, so the next show-once secret is covered by
   adding an attribute instead of by somebody remembering that line exists.

   Both directions are asserted, and the second is the one that keeps the first
   honest: this sheet must refuse Escape, and every other dialog must still
   take it. A fix that made the whole product ignore Escape would pass the
   first half on its own. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({});
const { page, errors } = app;

const esc = () => page.evaluate(async () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
});

section('The one-time key survives a stray Escape');
{
  const r = await page.evaluate(async () => {
    document.getElementById('ovr').innerHTML = '';
    _apiShowOnce('amv_sk_THE_ONLY_COPY_12345');
    await new Promise(r => setTimeout(r, 250));
    return {
      shown: !!document.getElementById('ak-val'),
      value: (document.getElementById('ak-val') || {}).value || '',
      marked: !!document.querySelector('#ovr [data-keep-open]'),
    };
  });
  ok(r.shown === true, 'the key sheet opens', r);
  ok(r.value === 'amv_sk_THE_ONLY_COPY_12345', 'and it really holds the key', r);
  ok(r.marked === true, 'and it is marked as one that does not close by accident', r);

  await esc();
  const after = await page.evaluate(() => ({
    still: !!document.getElementById('ak-val'),
    value: (document.getElementById('ak-val') || {}).value || '',
  }));
  ok(after.still === true, 'Escape does not take the only copy away', after);
  ok(after.value === 'amv_sk_THE_ONLY_COPY_12345', 'and the key is still readable', after);
}

section('It still closes the way it says it does');
{
  const r = await page.evaluate(async () => {
    document.getElementById('ak-done').click();
    await new Promise(r => setTimeout(r, 300));
    return { gone: !document.getElementById('ak-val'),
             overlayEmpty: (document.getElementById('ovr').innerHTML || '').length === 0 };
  });
  ok(r.gone === true, '"I have copied it" closes it', r);
  ok(r.overlayEmpty === true, 'and the key is not left sitting in the overlay', r);
}

section('Every other dialog still takes Escape');
{
  /* Without this the fix could be "nothing closes on Escape any more", which
     would pass the section above and break the product. */
  for (const [name, openIt] of [['auth', 'openAuth("signup")'],
                                ['payment', 'openPaymentSheet("pro")'],
                                ['vscode', '_devConnectVSCode()']]) {
    const r = await page.evaluate(async (src) => {
      document.getElementById('ovr').innerHTML = '';
      // eslint-disable-next-line no-eval
      eval(src);
      await new Promise(r => setTimeout(r, 250));
      const wasOpen = document.getElementById('ovr').children.length > 0;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      return { wasOpen, closed: document.getElementById('ovr').children.length === 0 };
    }, openIt);
    ok(r.wasOpen === true, 'the ' + name + ' dialog opened, so this case measured something', r);
    ok(r.closed === true, 'and Escape still closes ' + name, r);
  }
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
