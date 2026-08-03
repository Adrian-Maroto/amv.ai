/* A PERMISSION THAT NOTHING READS MUST SAY SO.

   "Family & linked accounts" lets somebody request access to another person's
   account and tick what the link may do: see their calendar, read their email,
   SEND email as them, MAKE PURCHASES on their account. The other person gets a
   code in their own inbox and approves it. Either side can revoke.

   All of that is real. What is not real is the permission itself: no route in
   the worker has ever consulted a link's scopes before doing anything. There is
   no act-as-another-account path in the product at all. The record is a ledger
   with nothing behind it.

   That is the safe direction of wrong - nobody gains access they should not -
   but somebody who ticks "make purchases on their account", waits for a code,
   and approves it walks away believing they can spend that person's money. And
   somebody revoking believes they are cutting off access that never existed.

   Implementing it is not a small change and it is not one to bolt on quietly:
   one account acting as another is the most dangerous capability this product
   could have, and the money and email scopes are the worst of it. So the
   honest move today is to say what the feature does, and this check makes sure
   the saying does not drift from the doing.

   It is written to RETIRE ITSELF. The moment a route genuinely enforces link
   scopes, the disclosure is no longer required and this stops demanding it. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');
const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');

/* Does anything actually CONSULT a link's scopes to permit an action? Listing
   them back to their owner is not enforcement, so the two read-out sites are
   excluded by looking for a decision rather than a projection. */
const ENFORCED = /(scopes\s*\.\s*includes\(\s*['"](?:spend|email_send|calendar_edit|tasks_edit|email_view|calendar_view)|_linkAllows\(|requireLinkScope\()/.test(worker);

section('Whether the permission is enforced yet');
{
  /* Stated as a fact rather than asserted either way - this is the switch that
     decides what the rest of the file requires. */
  ok(true, ENFORCED ? 'link scopes are enforced server-side' : 'link scopes are recorded but not yet enforced', ENFORCED);
}

if(!ENFORCED){
  section('So the screen says exactly that');
  {
    ok(/does not yet act on anyone/i.test(bundle),
       'the links screen says AMV does not yet act on another account', true);
    ok(/AMV <b>records<\/b> these permissions/i.test(bundle),
       'and that what it does today is RECORD the permission', true);
    /* The specific things somebody would otherwise believe they had bought. */
    ok(/spend their money on your behalf|nothing here lets AMV read their email/i.test(bundle),
       'naming the capabilities it does not have, not just hedging in general', true);
  }

  section('And nothing on that screen claims cross-account actions happen');
  {
    /* The bullet list used to promise "Every cross-account action is written to
       a log both of you can read", which only makes sense if cross-account
       actions occur. */
    ok(!/Every cross-account action is written to a log/i.test(bundle),
       'no claim that cross-account actions are being logged', true);
  }

  section('The parts that ARE real are still real');
  {
    /* The disclosure must not turn into "none of this works" - the invitation,
       the emailed code, the approval and the revoke all genuinely happen, and
       saying otherwise would be the opposite error. */
    ok(/\/v1\/link\/invite/.test(worker) && /\/v1\/link\/revoke/.test(worker),
       'invite and revoke are real routes', true);
    ok(/the invitation, the code sent to their inbox, the approval and the revoke are all real/i.test(bundle),
       'and the screen says which parts do work', true);
  }
}

if(ENFORCED){
  section('Enforcement is real, so the caveat should be gone');
  {
    ok(!/does not yet act on anyone/i.test(bundle),
       'the not-yet-enforced notice was removed once it stopped being true', true);
  }
}

if (report('link-scopes-honest') > 0) process.exitCode = 1;
done();
