/* "PLEASE COMPLETE THE VERIFICATION" - OF A BOX THAT IS NOT THERE.

   The owner turned on Turnstile and could not sign up. The form asked them to
   complete a verification, and no verification was on the screen.

   `_mountTurnstile` attached an `onload` and no `onerror`. When the script does
   not arrive - a school or workplace filter, an extension, a firewall, a
   network that answers with something that is not the script - nothing happened
   at all. The box stayed empty, no token was produced, and the server correctly
   refused the sign-up for want of one. The message named the one thing the
   person could not do, and gave them nothing to act on.

   AMV must not wave them through: the server requires a real token whenever the
   operator configured one, and a client that skipped it would be the captcha
   not existing. What it owes them is the truth - that the check could not load,
   what usually causes that, and who can turn it off. That is the difference
   between a locked door and a locked door with a sign.

   Both silent failures are covered: the script erroring, and the script
   arriving without defining `turnstile`, which is what a filter serving its own
   page looks like. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'src', 'app', '03-sessions.js'), 'utf8');
const i = src.indexOf('function _mountTurnstile');
const body = i > 0 ? src.slice(i, i + 3000) : '';

section('The captcha mount handles the ways it can fail to appear');
{
  ok(body.length > 0, '_mountTurnstile was found');
  ok(/\.onerror\s*=/.test(body),
     'the script tag has an onerror, so a blocked load is noticed');
  ok(/setTimeout\([^)]*dataset\.rendered/.test(body.replace(/\s+/g, ' '))
     || /if\(!box\.dataset\.rendered\)/.test(body),
     'and a timeout catches a script that loads but never draws');
}

section('What it says is useful to the person reading it');
{
  ok(/could not load/i.test(body),
     'it states the check did not load, rather than asking again');
  ok(/filter|extension|firewall/i.test(body),
     'names the usual cause, so they can act on it');
  ok(/turn the check off|different network/i.test(body),
     'and the two ways out - their network, or the operator');
}

section('It does not let anybody past');
{
  /* The whole point of the captcha is that the SERVER decides. A client that
     forged a token, or set a flag that skipped the check, would be a captcha
     that is not one - and this file would be the place somebody was tempted
     to do it, because it is where the failure is handled. */
  ok(!/captchaToken\s*[:=]\s*['"]/.test(body),
     'no token is invented when the widget is missing');
  ok(!/skipCaptcha|bypassCaptcha|captchaOptional/i.test(body),
     'and no flag is set that would skip the server check');
}

if (report() > 0) process.exitCode = 1;
done();
