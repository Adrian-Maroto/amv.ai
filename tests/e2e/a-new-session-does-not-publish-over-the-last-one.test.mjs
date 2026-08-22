/* PUBLISHING TWICE SHOULD NOT COST YOU THE FIRST PAGE.

   Deploying remembers a slug so that re-deploying UPDATES the same live URL
   rather than minting another site - an account is capped at 25 of them. The
   slug was never cleared when a session was reset, and "New session" is
   somebody saying this is a different thing now.

   So: build an app, publish it, press +, build a completely different app,
   publish it - and the second silently replaced the first at its own address.
   Anyone holding that link got the wrong page and nothing said so. Destructive,
   silent, and to a public artifact.

   Both halves are checked here, because the fix has an obvious way to go too
   far: clearing the slug always would mean re-publishing WITHIN a session
   created a second site every time, which is the quota bug this file also
   covers, arriving from the other direction.

   Found while merging the Build surfaces, by reading the two deploy paths side
   by side to see whether they had drifted. They had, though not in the way that
   was being looked for. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

const story = await page.evaluate(async () => {
  S.user = { name: 'T', email: 't@amv.dev', ini: 'T' };
  saveStr('amv_plan', 'ultra');
  AMV_API.base = 'https://api.test'; AMV_API.token = 't';

  /* Every slug the client sends, and a DIFFERENT name back for each new site -
     a stub that answers with one name makes "updated in place" and "made a new
     one" produce identical output. */
  const sent = [];
  window.fetch = async (u, o) => {
    const url = String(u);
    if (url.includes('/deploy')) {
      let body = {}; try { body = JSON.parse(o.body); } catch (e) {}
      sent.push(body.slug === undefined ? '(none)' : body.slug);
      const assigned = body.slug || ('site-' + sent.filter(x => x === '(none)').length);
      return { ok: true, status: 200, json: async () => ({ url: 'https://amv.site/' + assigned, slug: assigned }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  _DEV.log = [{ role: 'sys', text: 'x' }];
  _devSetFile('index.html', '<h1>APP ONE</h1>', 'html');
  setTab('dev');
  await new Promise(s => setTimeout(s, 400));
  await _devDeploy();
  await new Promise(s => setTimeout(s, 250));
  const firstPage = _DEV.deploySlug;

  /* Re-publishing the SAME session must land on the same address. */
  _devSetFile('index.html', '<h1>APP ONE, revised</h1>', 'html');
  await _devDeploy();
  await new Promise(s => setTimeout(s, 250));
  const republishSent = sent[sent.length - 1];

  /* Now a new session, exactly as the + button does it. */
  try { _sessNew('dev'); } catch (e) {}
  _resetToolState('dev');
  const slugAfterReset = _DEV.deploySlug;

  _DEV.log = [{ role: 'sys', text: 'y' }];
  _devSetFile('index.html', '<h1>APP TWO - a different thing</h1>', 'html');
  renderCodeView();
  await new Promise(s => setTimeout(s, 250));
  await _devDeploy();
  await new Promise(s => setTimeout(s, 250));

  return { sent, firstPage, republishSent, slugAfterReset,
           secondPage: _DEV.deploySlug };
});

section('Re-publishing the same work updates the page it already made');
{
  ok(story.firstPage && story.firstPage !== '(none)',
     'the first publish gets an address', story.firstPage);
  ok(story.republishSent === story.firstPage,
     'and publishing again from the same session reuses it',
     `${story.republishSent} vs ${story.firstPage}`);
}

section('Starting a new session does not publish over the last one');
{
  ok(story.slugAfterReset === '' || !story.slugAfterReset,
     'a new session forgets which page the last one published', story.slugAfterReset);
  ok(story.secondPage !== story.firstPage,
     'so a different app gets a different address, rather than replacing it',
     `first ${story.firstPage}, second ${story.secondPage}`);
  ok(!story.sent.slice(2).includes(story.firstPage),
     'and nothing after the reset was sent to the first page’s address',
     story.sent.join(' -> '));
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3));
await app.close();
if (report('a-new-session-does-not-publish-over-the-last-one') > 0) process.exitCode = 1;
done();
