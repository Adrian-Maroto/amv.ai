/* THE PASSWORD MANAGER TYPED SOMEBODY'S NAME INTO THE SEARCH BOX.

   The owner opened the Founder Dashboard and found the Settings search field
   holding a saved username. Clearing it put it straight back, every time.

   Two faults, and neither is the browser misbehaving.

   The admin-token boxes are `type="password"` and asked not to be autofilled
   with `autocomplete="off"`. Chrome and Safari deliberately IGNORE `off` on
   credential fields - a site is not allowed to switch somebody's password
   manager off - so the request had no effect anywhere it was made, including in
   `_killTokenAutofill`, a helper that exists for precisely this and set the one
   value that does nothing. The boxes therefore read as a login, and a browser
   filling a login fills the username too: into the nearest text input, which on
   that screen is the Settings search.

   Then AMV made it permanent. `set-search` renders `value="..."` from
   `S._setSearch`, so the injected text became state and was written back on
   every redraw. Clearing the box could not win against a re-render.

   `autocomplete="new-password"` is the documented way to say "a secret, but not
   one you have saved" - browsers will not offer a stored credential for it. And
   a search box declared `type="search"` is not a username candidate. This file
   holds both, because the failure needed both and either one alone leaves a
   heuristic to get lucky. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = readFileSync(join(ROOT, 'app.js'), 'utf8');

/* The real account password and the change-password fields SHOULD autofill -
   they are a login. Everything else that is type="password" is a secret being
   pasted once, and must not invite a saved credential. */
const REAL_LOGIN = ['a-pass', 'pw-new', 'pw-conf', 'pw-cur',
  /* "Sign in to backend" really is a sign-in with the account's own password,
     so a saved credential is exactly what should be offered there. */
  'be-pass'];

section('Every token box tells the browser it is not a saved login');
{
  const inputs = [...app.matchAll(/<input([^>]*type="password"[^>]*)>/g)].map(m => m[1]);
  ok(inputs.length > 0, 'there are password-type inputs to check', inputs.length);

  const bad = [];
  for (const attrs of inputs) {
    const id = (attrs.match(/id="([^"]+)"/) || [, ''])[1];
    if (REAL_LOGIN.includes(id)) continue;
    const ac = (attrs.match(/autocomplete="([^"]+)"/) || [, ''])[1];
    if (ac !== 'new-password') bad.push({ id: id || '(no id)', autocomplete: ac || '(none)' });
  }
  ok(bad.length === 0,
     'a secret-paste field asks for new-password, not the ignored "off"', bad);
}

section('And the helper written for this uses a value browsers honour');
{
  const i = app.indexOf('function _killTokenAutofill');
  const body = i > 0 ? app.slice(i, i + 700) : '';
  ok(body.length > 0, 'the helper was found');
  ok(/setAttribute\('autocomplete',\s*'new-password'\)/.test(body),
     'it sets new-password rather than off');
  ok(!/setAttribute\('autocomplete',\s*'off'\)/.test(body),
     'and does not still set the value that does nothing');
}

section('A search box is declared a search box, so it is never a username candidate');
{
  for (const id of ['set-search', 'setpick-search']) {
    const m = app.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'));
    ok(!!m, id + ' exists');
    if (m) {
      ok(/type="search"/.test(m[0]), id + ' is type="search"', m[0].slice(0, 90));
    }
  }
}

section('Nothing the browser injects can become permanent state');
{
  /* The search field renders its own value back from state. That is fine, and
     it is the reason the injected text survived being deleted - so the guard
     that matters is the one above: nothing should be injected into it. Stated
     here so the coupling is written down rather than rediscovered. */
  const m = app.match(/<input[^>]*id="set-search"[^>]*>/);
  ok(!!m && /value="/.test(m[0]),
     'set-search is state-backed, which is why an injected value persisted',
     m && m[0].slice(0, 90));
}

if (report() > 0) process.exitCode = 1;
done();
