/* THE CAPTCHA BOX VANISHED WHEN YOU SIGNED OUT.

   The owner turned Turnstile on, and sign-up refused them for want of a token
   while no verification box was on the screen at all. The server was serving
   the site key correctly - `/v1/public-config` returned it - and the page never
   drew the widget.

   `saveStr`/`loadStr` file under the CURRENT ACCOUNT unless a key is listed in
   `_GLOBAL_KEYS`: `u:<email>|<key>`, falling back to `u:guest|<key>`. That is
   right for anything belonging to a person and wrong for anything belonging to
   the deployment.

   `_PUBLIC_CONFIG_MAP` carries three values the OPERATOR sets once, for
   everybody: a Google client id, a support address, and the Turnstile site key.
   The first two are in the global list. The third was not. So the site key was
   filed under whoever happened to be signed in when the config arrived, and
   went out of reach the moment the scope changed - signing out to create an
   account being exactly that moment, and exactly when the captcha is needed.
   `_mountTurnstile` then found no key, hid the empty box, and the server
   refused the sign-up for a token that could not be produced.

   Nothing about a site key is personal. It is public by design and identical
   for every visitor. The rule this file holds is the general one: everything
   the operator configures for the whole deployment is stored for the whole
   deployment. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const core = readFileSync(join(ROOT, 'src', 'app', '01-core.js'), 'utf8');

/* The storage keys _PUBLIC_CONFIG_MAP writes into, read from the map itself so
   adding a fourth deployment setting is covered without editing this file. */
const mapBlock = (core.match(/const _PUBLIC_CONFIG_MAP\s*=\s*\{([\s\S]*?)\n\};/) || [, ''])[1];
const stored = [...mapBlock.matchAll(/:\s*'([^']+)'/g)].map(m => m[1]);

const globalBlock = (core.match(/const _GLOBAL_KEYS = new Set\(\[([\s\S]*?)\]\)/) || [, ''])[1];
const globals = new Set([...globalBlock.matchAll(/'([^']+)'/g)].map(m => m[1]));

section('Everything the operator configures is stored for the whole deployment');
{
  ok(stored.length >= 3, 'the public config map names its storage keys', stored);
  ok(globals.size > 10, 'the global key list was found', globals.size);

  const perAccount = stored.filter(k => !globals.has(k));
  ok(perAccount.length === 0,
     'no deployment-wide setting is filed under one account', perAccount);
}

section('The captcha site key specifically, because this is what broke');
{
  ok(globals.has('amv_turnstile_site'),
     'the Turnstile site key survives signing out, which is when sign-up needs it');
}

section('And per-person things are still per-person');
{
  /* The opposite mistake would be worse: making a personal value global puts
     one person's data in front of the next person on a shared computer. These
     are things that belong to an account and must NOT be in the list. */
  for (const personal of ['amv_plan', 'amv_chats', 'amv_projects']) {
    ok(!globals.has(personal),
       personal + ' stays with the account it belongs to');
  }
}

if (report() > 0) process.exitCode = 1;
done();
