/* ACCESS TO SOMEONE ELSE'S ACCOUNT STAYS REMOVED.

   This file used to hold AMV to a disclosure: "Family & linked accounts" let
   somebody ask for another person's account - see their calendar, read their
   email, SEND as them, MAKE PURCHASES on it - and nothing on the server ever
   enforced those permissions, so the screen had to say it only RECORDED them.

   The owner removed the feature as the security risk it is: one account
   reaching into another is the account-takeover feature, however carefully it
   is gated. Family stays - a parent pays for a child's AMV and sets what it may
   spend, and never sees what the child writes.

   So the checks here are now the other way round, and they read source rather
   than a screen because the danger is a quiet return: a scope list in the
   bundle, a route that accepts one, a server that starts acting on one. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');
const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
/* Code only - a comment explaining the removal names what was removed. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const code = strip(bundle), wcode = strip(worker);

section('The page offers no way into another account');
{
  const offered = ['Read their email', 'Send email as them', 'Make purchases on their account',
                   'See their calendar', 'Request access'].filter(t => code.includes(t));
  ok(offered.length === 0, 'none of the old permission labels is in the page', offered);
  ok(!/AMVFamily\s*=/.test(code), 'the browser-side account-link module is gone', true);
  ok(!/\/v1\/link\/(list|revoke)/.test(code), 'and the page never asks to list or revoke such a link', true);
}

section('The server refuses it');
{
  ok(/link_removed/.test(wcode), 'an invitation for anything but a family is refused by name', true);
  ok(!/case '\/v1\/link\/(list|revoke)'/.test(wcode), 'and the routes that served the old screen are gone', true);
  /* Nothing may start consulting a link to permit an action. If this ever
     fails, somebody has built account-to-account access again, and that is a
     decision for the owner, not a side effect. */
  const enforced = /(scopes\s*\.\s*includes\(\s*['"](?:spend|email_send|calendar_edit|tasks_edit|email_view|calendar_view)|_linkAllows\(|requireLinkScope\()/.test(wcode);
  ok(!enforced, 'and no route acts on another account through a link', enforced);
}

if (report('link-scopes-honest') > 0) process.exitCode = 1;
done();
