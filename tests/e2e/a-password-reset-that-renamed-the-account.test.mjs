/* RESET YOUR PASSWORD, LOSE YOUR NAME.

   `/auth/login` answers `{token, refreshToken, email, name}` - `issueTokens`
   builds it, and the name is at the TOP LEVEL. The auto sign-in at the end of
   the password-reset flow read `d.user.name`. There is no `user` object on
   that response, so the fallback ran every single time and Ada Lovelace came
   back as "ada", the local part of her email.

   It sticks: `_completeIntroLogin` writes `S.user` to storage, so the sidebar
   name and initial change permanently on that device. A rename nobody asked
   for, at the end of a flow about something else.

   The comment directly above the bug describes the PREVIOUS version of the
   same mistake - `const r = await _fetch(...); if(r.token)`, on a Response
   that has no `.token`. The fix for that one introduced this one two lines
   later, which is why this file asserts on the response shape itself and not
   only on the outcome. */
import { ok, section, report, done } from '../lib/assert.mjs';
import { bootApp } from '../lib/harness.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

section('The server puts the name at the top level, and sends no user object');
/* Read from the worker, so the client and the assertion cannot both drift to
   the same wrong idea of the shape. */
{
  const be = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  const fn = be.slice(be.indexOf('async function issueTokens'),
                      be.indexOf('async function issueTokens') + 900);
  ok(/return \{ token: access, refreshToken: refresh, email, name/.test(fn),
     'issueTokens returns name alongside the token', (fn.match(/return \{[^}]*\}/) || [''])[0]);
  ok(!/user\s*:/.test(fn), 'and no nested user object', (fn.match(/return \{[^}]*\}/) || [''])[0]);
}

const app = await bootApp({ tab: 'chat', user: null });
try {
  await app.connect();
  await app.stubFetch(async (u, o) => {
    if (u.includes('/auth/reset') || u.includes('/auth/forgot')) return { ok: true, json: async () => ({ ok: true }) };
    if (u.includes('/auth/login')) {
      return { ok: true, json: async () => window.__login };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  });

  section('The name the server sent is the name that is kept');
  {
    const r = await app.page.evaluate(async () => {
      window.__login = { token: 't', refreshToken: 'r', email: 'ada@lovelace.dev', name: 'Ada Lovelace' };
      const d = await AMV_API.login('ada@lovelace.dev', { password: 'x', provider: 'email' });
      /* The exact expression the reset flow uses. */
      let known = '';
      const nm = d.name || known || 'ada@lovelace.dev'.split('@')[0];
      return { nm, hadUser: !!d.user };
    });
    ok(r.hadUser === false, 'there is no user object to read from', r.hadUser);
    ok(r.nm === 'Ada Lovelace', 'so the top-level name is what is used', r.nm);
    ok(r.nm !== 'ada', 'not the email prefix', r.nm);
  }

  section('A reset really does leave the account named as it was');
  /* End to end through the function that persists it, because the harm is
     that the rename is written down. */
  {
    const r = await app.page.evaluate(async () => {
      window.__login = { token: 't', refreshToken: 'r', email: 'ada@lovelace.dev', name: 'Ada Lovelace' };
      const d = await AMV_API.login('ada@lovelace.dev', { password: 'x', provider: 'email' });
      let known = '';
      const nm = d.name || known || 'ada@lovelace.dev'.split('@')[0];
      _completeIntroLogin({ name: nm, email: 'ada@lovelace.dev',
                            ini: String(nm)[0].toUpperCase(), provider: 'email' });
      const stored = load('amv_user') || {};
      return { name: stored.name, ini: stored.ini };
    });
    ok(r.name === 'Ada Lovelace', 'the stored account keeps the real name', r.name);
    ok(r.ini === 'A', 'and the initial matches it', r.ini);
  }

  section('With no name from the server, the browser record beats the email');
  /* An older account whose token predates the name being returned. The email
     prefix is the last resort, not the second one. */
  {
    const r = await app.page.evaluate(async () => {
      localStorage.setItem(acctKey('ada@lovelace.dev'), JSON.stringify({ name: 'Ada Lovelace', ini: 'AL' }));
      window.__login = { token: 't', refreshToken: 'r', email: 'ada@lovelace.dev' };
      const d = await AMV_API.login('ada@lovelace.dev', { password: 'x', provider: 'email' });
      let known = '';
      try { const raw = localStorage.getItem(acctKey('ada@lovelace.dev'));
            if (raw) known = (JSON.parse(raw).name || ''); } catch (e) {}
      return d.name || known || 'ada@lovelace.dev'.split('@')[0];
    });
    ok(r === 'Ada Lovelace', 'the name this browser already showed', r);
  }

  section('And with neither, the email prefix is still there as a floor');
  {
    const r = await app.page.evaluate(async () => {
      localStorage.removeItem(acctKey('nobody@example.com'));
      window.__login = { token: 't', refreshToken: 'r', email: 'nobody@example.com' };
      const d = await AMV_API.login('nobody@example.com', { password: 'x', provider: 'email' });
      let known = '';
      try { const raw = localStorage.getItem(acctKey('nobody@example.com'));
            if (raw) known = (JSON.parse(raw).name || ''); } catch (e) {}
      return d.name || known || 'nobody@example.com'.split('@')[0];
    });
    ok(r === 'nobody', 'somebody with no name anywhere still gets one', r);
  }

  section('The reset flow itself no longer reaches for a user object');
  {
    const src = readFileSync(join(ROOT, 'src', 'app', '03-sessions.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ok(!/d\.user\s*&&\s*d\.user\.name/.test(src),
       'the read of a field the server does not send is gone',
       (src.match(/.{0,40}d\.user.{0,30}/) || [''])[0]);
    ok(/const nm = d\.name \|\| known \|\|/.test(src),
       'and the order is server, then this browser, then the email');
  }

  ok(app.errors.length === 0, 'and no page error was thrown throughout', app.errors);
} finally {
  await app.close();
}

report();
done();
