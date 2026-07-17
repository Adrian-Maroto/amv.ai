/* Error reporting: a bug your users hit must actually reach YOU.
   Also guards the PRIVACY promise — we must never ship message contents. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page } = app;
await app.connect();

section('Client captures and SENDS errors');

const sent = await page.evaluate(async () => {
  const posts = [];
  window.fetch = async (url, opts) => {
    posts.push({ url: String(url), body: JSON.parse(opts.body || '{}') });
    return { ok: true, json: async () => ({ ok: true, accepted: 1 }) };
  };
  // a handled error (the kind that used to vanish into localStorage)
  _logErr('someFeature', new Error('kaboom in someFeature'));
  await _errFlush();
  return posts;
});

ok(sent.length === 1, 'an error was POSTed to the server', sent.length);
ok(/\/errors$/.test(sent[0]?.url || ''), 'it goes to the /errors endpoint', sent[0]?.url);
const ev = sent[0]?.body?.events?.[0] || {};
ok(ev.msg?.includes('kaboom'), 'the error message is included', ev.msg);
ok(!!ev.stack, 'a stack trace is included');
ok(ev.tab === 'chat', 'it records which tab the user was on', ev.tab);

section('PRIVACY: never ship the user"s content');

const priv = await page.evaluate(async () => {
  const posts = [];
  window.fetch = async (url, opts) => {
    posts.push(JSON.parse(opts.body || '{}'));
    return { ok: true, json: async () => ({ ok: true }) };
  };
  // Put sensitive content in the app, then throw
  const m = getMsgs();
  m.push({ r: 'u', c: 'MY_SECRET_PROMPT_ABOUT_DIVORCE', _t: Date.now() });
  S.user = { name: 'Xavi', email: 'xavi@private.com', ini: 'X' };
  _logErr('render', new Error('render failed'));
  await _errFlush();
  return JSON.stringify(posts);
});

ok(!priv.includes('MY_SECRET_PROMPT'), 'message CONTENT is never sent');
ok(!priv.includes('xavi@private.com'), 'the raw email is never sent (hashed server-side)');

section('Noise is filtered (we must not spam ourselves)');

const noise = await page.evaluate(async () => {
  const posts = [];
  window.fetch = async (url, opts) => { posts.push(JSON.parse(opts.body).events.length); return { ok: true, json: async () => ({}) }; };
  _errQueue('error', 'x', new Error('ResizeObserver loop limit exceeded'));
  _errQueue('error', 'x', new Error('Script error.'));
  _errQueue('error', 'x', new Error('Failed to fetch'));
  await _errFlush();
  return posts;
});
ok(noise.length === 0, 'browser noise (ResizeObserver, Script error, network) is dropped', noise);

section('Reporting never breaks the app');

const safe = await page.evaluate(async () => {
  window.fetch = async () => { throw new Error('network down'); };
  let threw = false;
  try { _logErr('x', new Error('y')); await _errFlush(); }
  catch (e) { threw = true; }
  return threw;
});
ok(safe === false, 'a failing report does not throw into the app');

const offline = await page.evaluate(async () => {
  AMV_API.base = '';                      // engine not connected
  let threw = false;
  try { _logErr('x', new Error('y')); await _errFlush(); } catch (e) { threw = true; }
  return threw;
});
ok(offline === false, 'with no backend, errors are dropped silently — not thrown');

await app.close();
report();
done();
