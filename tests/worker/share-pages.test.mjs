/* PUBLIC SHARE PAGES - sharing worked, but it encoded the conversation into a
   URL FRAGMENT. A fragment is never sent to a server, so a shared link pasted
   into Slack or X renders with no title and no preview: a bare URL that reads
   as spam and does not get clicked. For a product whose growth depends on
   people showing each other what it did, that is the difference between a
   distribution loop and no loop. It also broke past ~8000 characters. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'share.harness.mjs');
writeFileSync(harness, src + '\nexport { shareCreate, shareList, shareRevoke, sharePage, signToken, DB, shareVisibility };\n');
const W = await import(harness + '?t=' + Date.now());

function makeEnv() {
  const kv = new Map();
  return { _kv: kv, JWT_SECRET: 'test-secret-abcdefghijklmnop', APP_URL: 'https://amv.test',
    AMV_KV: { get: async k => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })) }) } };
}
const create = (env, token, body) => W.shareCreate(new Request('https://w/v1/share/create',
  { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }), env);
const tokenFor = (env, email) => W.signToken({ email }, env.JWT_SECRET, 3600, env, 'access');
const post = (env, token, body) => new Request('https://w/v1/share/visibility',
  { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
const qRobots = (res) => res.headers.get('X-Robots-Tag') === 'noindex, nofollow';
const CONVO = { title: 'How to price a SaaS', msgs: [
  { r: 'u', c: 'How should I price my SaaS product?' },
  { r: 'a', c: 'Start from the value delivered rather than your costs.' }] };

section('A shared link is a real page a preview crawler can read');
{
  const env = makeEnv();
  const token = await W.signToken({ email: 'alice@x.com' }, env.JWT_SECRET, 3600, env, 'access');
  const d = await (await create(env, token, CONVO)).json();
  ok(d.ok === true, 'the conversation is shared', d.ok);
  ok(/^https:\/\/amv\.test\/c\/[a-z0-9]+$/.test(d.url), 'with a clean hosted URL', d.url);

  const page = await W.sharePage(new Request(d.url), env, d.id);
  const html = await page.text();
  ok(page.status === 200, 'the page loads with no login', page.status);
  ok(html.includes('<meta property="og:title" content="How to price a SaaS">'),
     'carrying a real title, so a pasted link renders as a card');
  ok(/og:description" content="How should I price my SaaS product\?"/.test(html),
     'and the opening question as the description, which is what makes it worth clicking');
  ok(html.includes('og:url" content="https://amv.test/c/' + d.id),
     'with its own canonical URL');
  ok(/twitter:card/.test(html), 'and the equivalent tags for X');
  ok(/value delivered rather than your costs/.test(html), 'the answer is actually on the page');
}

section('It is deliberately not indexable');
{
  const env = makeEnv();
  const token = await W.signToken({ email: 'alice@x.com' }, env.JWT_SECRET, 3600, env, 'access');
  const d = await (await create(env, token, CONVO)).json();
  const page = await W.sharePage(new Request(d.url), env, d.id);
  const html = await page.text();
  ok(/noindex/.test(html), 'the page tells search engines to stay away');
  ok(/noindex/.test(page.headers.get('X-Robots-Tag') || ''), 'in a header too, which crawlers honour');
}

section('A public page that renders model output ships no JavaScript');
{
  const env = makeEnv();
  const token = await W.signToken({ email: 'alice@x.com' }, env.JWT_SECRET, 3600, env, 'access');
  const d = await (await create(env, token, {
    title: 'Nasty <script>alert(1)</script>',
    msgs: [{ r: 'u', c: '<img src=x onerror=alert(1)>' },
           { r: 'a', c: 'Sure: </div><script>fetch("//evil")</script>' }] })).json();
  const page = await W.sharePage(new Request(d.url), env, d.id);
  const html = await page.text();
  const body = html.slice(html.indexOf('<body'));
  ok(!/<script/i.test(body), 'no script tag survives into the body', body.match(/<script[^>]*>/i));
  /* `onerror=` does appear - inside an escaped attribute value, where the
     angle brackets and quotes are already neutralised so no tag can form. The
     property that matters is that no user-supplied text ever becomes markup. */
  ok(!/<img/i.test(html), 'no injected tag is ever formed', html.match(/<img[^>]*>/i));
  ok(!/content="[^"]*"[^>]*"/.test(html.split('<body')[0].replace(/content="[^"]*"/g, 'content="ok"')),
     'no attribute value can break out of its quotes');
  ok(/&lt;script&gt;/.test(html), 'the attempt is shown as text, escaped');
  const csp = page.headers.get('Content-Security-Policy') || '';
  ok(/default-src 'none'/.test(csp), 'and the policy blocks everything by default', csp);
  ok(!/script-src/.test(csp) || /script-src 'none'/.test(csp), 'with no script source permitted at all', csp);
  ok(/frame-ancestors 'none'/.test(csp), 'and it cannot be framed');
}

section('Only the owner can revoke, and revoking really breaks the link');
{
  const env = makeEnv();
  const alice = await W.signToken({ email: 'alice@x.com' }, env.JWT_SECRET, 3600, env, 'access');
  const mallory = await W.signToken({ email: 'mallory@x.com' }, env.JWT_SECRET, 3600, env, 'access');
  const d = await (await create(env, alice, CONVO)).json();

  const attack = await W.shareRevoke(new Request('https://w/v1/share/revoke',
    { method: 'POST', headers: { Authorization: 'Bearer ' + mallory }, body: JSON.stringify({ id: d.id }) }), env);
  ok(attack.status === 200, 'a stranger revoking gets a bland response', attack.status);
  const still = await W.sharePage(new Request(d.url), env, d.id);
  ok(still.status === 200, 'but the link still works - they cannot revoke what is not theirs', still.status);

  await W.shareRevoke(new Request('https://w/v1/share/revoke',
    { method: 'POST', headers: { Authorization: 'Bearer ' + alice }, body: JSON.stringify({ id: d.id }) }), env);
  const gone = await W.sharePage(new Request(d.url), env, d.id);
  ok(gone.status === 404, 'the owner revoking really stops it', gone.status);
  ok(/no longer shared/.test(await gone.text()), 'with an explanation rather than a bare error');
}

section('The owner can list what they have shared');
{
  const env = makeEnv();
  const token = await W.signToken({ email: 'alice@x.com' }, env.JWT_SECRET, 3600, env, 'access');
  await create(env, token, CONVO);
  await create(env, token, { title: 'Second one', msgs: [{ r: 'u', c: 'hello' }] });
  const l = await (await W.shareList(new Request('https://w/v1/share/list',
    { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: '{}' }), env)).json();
  ok(l.items.length === 2, 'both are listed', l.items.length);
  ok(l.items.every(i => /^https:\/\/amv\.test\/c\//.test(i.url)), 'each with the link to hand out');
  ok(l.items[0].title === 'Second one', 'newest first');
}

section('Nothing is shared without a signed-in owner, and nothing empty');
{
  const env = makeEnv();
  const anon = await W.shareCreate(new Request('https://w/v1/share/create',
    { method: 'POST', body: JSON.stringify(CONVO) }), env);
  ok(anon.status === 401, 'sharing requires an account', anon.status);

  const token = await W.signToken({ email: 'alice@x.com' }, env.JWT_SECRET, 3600, env, 'access');
  const empty = await (await create(env, token, { title: 'x', msgs: [] })).json();
  ok(!!empty.error, 'an empty conversation is refused', empty.error);
}

section('An unknown or malformed id says so without leaking anything');
{
  const env = makeEnv();
  for (const bad of ['nope123', '../secret', 'a']) {
    const r = await W.sharePage(new Request('https://w/c/' + bad), env, bad);
    ok(r.status === 404, `"${bad}" is a clean 404`, r.status);
  }
}

section('The route is public and sits ahead of the auth gating');
{
  ok(/path\.startsWith\('\/c\/'\)/.test(src), 'a share URL is routed before anything asks for a token');
  ok(/case '\/v1\/share\/create'/.test(src) && /case '\/v1\/share\/revoke'/.test(src),
     'create and revoke are routed');
  ok(/guardAction\(env, `share:/.test(src), 'and creating one is rate limited');
}

section('The app uses the hosted link when it can, and says what it is');
{
  const client = readFileSync(join(ROOT, 'app.js'), 'utf8');
  ok(/_createHostedShare/.test(client), 'the app asks for a hosted link');
  /* The hosted result is now an object (it carries the share id, so visibility
     can be changed), which is why this reads `hosted && hosted.url`. */
  ok(/const link=\(hosted && hosted\.url\)\|\|_buildShareLink\(c\)/.test(client),
     'and falls back to the self-contained link with no backend, rather than failing');
  ok(/_setShareListed/.test(client), 'and the search-visibility choice is carried to the server, not decided locally');
  ok(/revoke it any time in Settings/.test(client), 'the hosted case explains revocation');
  ok(/nothing is stored on a server/.test(client), 'and the fallback still tells the truth about itself');
  ok(/openSharedChatsManager/.test(client), 'the privacy screen promise is now backed by something');
}

section('Search engines are kept out unless the person sharing says otherwise');
{
  /* A shared page that gets indexed is a real acquisition channel. It is also
     permanent in a way a link is not: revoking a link does not remove a snippet
     someone already saw in a search result, and most people sharing with one
     person do not expect a search result. So the reach is opt-in. */
  const env = makeEnv();
  const token = await tokenFor(env, 'alice@x.com');

  const quiet = await (await create(env, token, { title: 'Private thing', msgs: [{ r:'u', c:'hello' }] })).json();
  ok(quiet.listed === false, 'the default is not listed', quiet.listed);
  const qPage = await (await W.sharePage(new Request('https://w/c/' + quiet.id), env, quiet.id)).text();
  ok(/noindex/.test(qPage), 'and the page tells crawlers to stay out');

  const loud = await (await create(env, token, { title: 'Public thing', msgs: [{ r:'u', c:'hello' }], listed: true })).json();
  ok(loud.listed === true, 'an explicit opt-in is honoured', loud.listed);
  const lRes = await W.sharePage(new Request('https://w/c/' + loud.id), env, loud.id);
  const lPage = await lRes.text();
  ok(!/noindex/.test(lPage), 'and that page carries no noindex tag');
  ok(!lRes.headers.get('X-Robots-Tag'), 'nor the header, which would override the tag anyway', lRes.headers.get('X-Robots-Tag'));
  ok(qRobots(await W.sharePage(new Request('https://w/c/' + quiet.id), env, quiet.id)), 'while the quiet one still sends the header');
}

section('Anything shared before the choice existed keeps the promise it was made under');
{
  const env = makeEnv();
  const token = await tokenFor(env, 'alice@x.com');
  const d = await (await create(env, token, { title: 'Old', msgs: [{ r:'u', c:'hi' }] })).json();
  // A record written by an older build has no `listed` field at all.
  const rec = await W.DB.get(env, 'share', d.id);
  delete rec.listed;
  await W.DB.put(env, 'share', d.id, rec);
  const page = await (await W.sharePage(new Request('https://w/c/' + d.id), env, d.id)).text();
  ok(/noindex/.test(page), 'a missing choice is not consent - it stays out of search');
}

section('The decision is reversible, and only by its owner');
{
  const env = makeEnv();
  const mine = await tokenFor(env, 'alice@x.com');
  const theirs = await tokenFor(env, 'mallory@x.com');
  const d = await (await create(env, mine, { title: 'Mine', msgs: [{ r:'u', c:'hi' }] })).json();

  const on = await (await W.shareVisibility(post(env, mine, { id: d.id, listed: true }), env)).json();
  ok(on.listed === true, 'the owner can put it into search');
  ok(!/noindex/.test(await (await W.sharePage(new Request('https://w/c/'+d.id), env, d.id)).text()), 'and the page changes');

  const off = await (await W.shareVisibility(post(env, mine, { id: d.id, listed: false }), env)).json();
  ok(off.listed === false, 'and take it back out - a choice that cannot be undone is not a choice');
  ok(/noindex/.test(await (await W.sharePage(new Request('https://w/c/'+d.id), env, d.id)).text()), 'the page changes back');

  const bad = await W.shareVisibility(post(env, theirs, { id: d.id, listed: true }), env);
  ok(bad.status === 404, 'nobody else can publish someone else\u2019s conversation to the open web', bad.status);
  ok(/noindex/.test(await (await W.sharePage(new Request('https://w/c/'+d.id), env, d.id)).text()), 'and the attempt changed nothing');
}

report();
done();
