/* A PAGE FROM CHROME LANDS IN A NEW CHAT - AND IS NOT SENT.

   The page half of AMV for Chrome. The extension's script posts what the
   person chose to this window; it becomes a new chat with it in the box and
   nothing is sent. Accepted only from this window, only in a tab the
   extension opened (?amvext=1, then taken out of the address), and only with
   its marker. And the API keys pane packs the extension with this app's own
   address in it, or says why it cannot. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Pat', email: 'pat@example.com', ini: 'P' } });
const { page, errors } = app;

const post = (data, withMarker) => page.evaluate(async ({ data, withMarker }) => {
  window.__sent = 0;
  const realSend = window.sendMsg; window.sendMsg = (...a) => { window.__sent++; };
  const box = document.getElementById('mta'); if (box) box.value = '';
  history.replaceState(null, '', withMarker ? '/?amvext=1' : '/');
  window.postMessage(data, location.origin);
  await new Promise(r => setTimeout(r, 400));
  window.sendMsg = realSend;
  return { box: (document.getElementById('mta') || {}).value || '', sent: window.__sent, search: location.search };
}, { data, withMarker });

section('What was chosen in Chrome is in a new chat’s box, and nothing is sent');
{
  const r = await post({ amvExtShare: 1, title: 'Lease', url: 'https://landlord.example/lease', text: 'the clause about notice periods' }, true);
  ok(/the clause about notice periods/.test(r.box) && /landlord\.example\/lease/.test(r.box), 'the selection and where it came from are in the box', r.box);
  ok(r.sent === 0, 'and it was not sent', r.sent);
  ok(r.search === '', 'the marker is taken out of the address', r.search);
}

section('Anything else is ignored');
{
  const noMark = await post({ amvExtShare: 1, text: 'from a tab Chrome did not open' }, false);
  ok(noMark.box === '', 'not in a tab the extension opened: ignored', noMark.box);
  const noFlag = await post({ text: 'no marker on the message' }, true);
  ok(noFlag.box === '', 'a message without the extension’s marker: ignored', noFlag.box);
  const framed = await page.evaluate(async () => {
    history.replaceState(null, '', '/?amvext=1');
    const box = document.getElementById('mta'); box.value = '';
    /* The page's policy will not run a script inside a frame, so the message
       is delivered as one would arrive from it: same origin, the FRAME as its
       source - which is what any script framed on this page would be. */
    const f = document.createElement('iframe'); document.body.appendChild(f);
    window.dispatchEvent(new MessageEvent('message', { data: { amvExtShare: 1, text: 'from a frame' }, origin: location.origin, source: f.contentWindow }));
    await new Promise(r => setTimeout(r, 400));
    f.remove();
    /* Read afresh: a new chat redraws the composer, and the old element would
       read empty whatever happened. */
    return (document.getElementById('mta') || {}).value || '';
  });
  ok(framed === '', 'and so is the same message from a frame on the page', framed);
}

section('The extension is packed with this app’s address, or refused with the reason');
{
  const r = await page.evaluate(async () => {
    await _apiKeysLoad();
    const files = await window._chromeFiles('https://amv.example');
    const m = JSON.parse(files.find(f => f.name === 'amv-chrome/manifest.json').data);
    const bg = files.find(f => f.name === 'amv-chrome/background.js').data;
    const icon = files.find(f => f.name === 'amv-chrome/icon.png').data;
    document.querySelectorAll('#toast-wrap .toast').forEach(t => t.remove());
    const okHere = await window._chromeDownload();
    return { names: files.map(f => f.name), matches: m.content_scripts[0].matches, bgOrigin: /const AMV = "https:\/\/amv\.example"/.test(bg),
             placeholder: /__AMV_ORIGIN__/.test(bg + JSON.stringify(m)), png: icon[0] === 0x89 && icon[1] === 0x50,
             okHere, toast: [...document.querySelectorAll('#toast-wrap .toast')].map(t => t.textContent).join(' ') };
  });
  ok(r.names.join() === 'amv-chrome/manifest.json,amv-chrome/background.js,amv-chrome/share.js,amv-chrome/icon.png', 'a folder with the four files', r.names);
  ok(r.matches.join() === 'https://amv.example/*' && r.bgOrigin && !r.placeholder, 'its script may run on that address and nowhere else, and nothing is left unfilled', r);
  ok(r.png, 'with AMV’s icon', r.png);
  ok(r.okHere === false && /own https address/.test(r.toast), 'a copy not at an https address refuses, and says why', r.toast);
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('a-page-from-chrome-lands-in-a-new-chat') > 0) process.exitCode = 1;
done();
