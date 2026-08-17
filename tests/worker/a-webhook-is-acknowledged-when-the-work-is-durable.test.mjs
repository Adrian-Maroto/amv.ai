/* A 200 IS A PROMISE THAT THE WORK IS DONE.

   Stripe and PayPal both retry a webhook until they get a 2xx. That makes the
   status code the only thing standing between a failed delivery and a customer
   who paid for nothing - and it is easy to get wrong, because returning 200
   makes the error go away from the sender's point of view.

   An external audit found the PayPal handler catching a processing failure,
   releasing its exactly-once claim, and then falling through to `return
   json({received:true})` - HTTP 200. PayPal recorded the delivery as handled
   and never sent it again. The comment directly above that fall-through said
   "let PayPal's retry reprocess it": the prose described the intent and the
   code guaranteed the opposite.

   The Stripe handler, written earlier, returns 500 in the same situation and is
   correct. So this was not a missing idea - it was one of two handlers drifting
   from the standard the other set, in the half of the pair that nothing tested.

   That is why this file checks BOTH, by the same rule, rather than checking the
   one that broke. A pair of handlers that must behave identically is a place
   where the second copy silently diverges. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');

const HANDLERS = [
  ['stripeWebhook', 'Stripe'],
  ['paypalWebhook', 'PayPal'],
];

section('Both handlers exist and were actually read');
{
  for (const [fn, name] of HANDLERS) {
    const body = functionBody(src, fn);
    ok(body.length > 400, name + ' handler was found and has a real body', body.length);
  }
}

section('A processing failure is never acknowledged as success');
{
  for (const [fn, name] of HANDLERS) {
    const body = codeOnly(functionBody(src, fn));
    const iCatch = body.lastIndexOf('} catch (e) {');
    ok(iCatch > -1, name + ' has a top-level processing catch', iCatch);

    /* Everything from the catch to the end of the function. If a non-2xx is
       returned there, the sender retries. If control leaves that block without
       returning, it reaches the success return below it - which is the bug. */
    const tail = body.slice(iCatch);
    const returnsError = /return new Response\([^)]*\{\s*status:\s*(?:5\d\d|429)/.test(tail);
    ok(returnsError,
       name + ' returns a retryable status from the failure path', tail.slice(0, 160));

    /* Named directly, because this is the exact line that was wrong: the
       failure path must not fall through to the acknowledgement. */
    const iErrReturn = tail.search(/return new Response\([^)]*status:\s*5\d\d/);
    const iOkReturn = tail.search(/return json\(\{\s*received:\s*true/);
    ok(iErrReturn > -1 && (iOkReturn === -1 || iErrReturn < iOkReturn),
       name + ' does not fall through from the catch to the success response',
       { errorAt: iErrReturn, successAt: iOkReturn });
  }
}

section('The exactly-once claim is released so the retry is not read as a duplicate');
{
  /* Returning a retryable status is only half of it. These handlers claim each
     event id once so a redelivery cannot be processed twice; if the claim is
     kept after a failure, the retry arrives and is discarded as a duplicate of
     work that never happened - which is the same customer outcome by a
     different route. */
  for (const [fn, name] of HANDLERS) {
    const body = codeOnly(functionBody(src, fn));
    const iCatch = body.lastIndexOf('} catch (e) {');
    const tail = body.slice(iCatch);
    ok(/_releaseClaim\(/.test(tail),
       name + ' releases its event claim before asking for the retry', true);

    const iRelease = tail.indexOf('_releaseClaim(');
    const iReturn = tail.search(/return new Response\([^)]*status:\s*5\d\d/);
    ok(iRelease > -1 && iReturn > -1 && iRelease < iReturn,
       name + ' releases the claim before it returns, not after', { release: iRelease, ret: iReturn });
  }
}

section('A failure that repeats is visible to somebody');
{
  /* A retry loop that nobody sees is an outage with a delay on it. The point at
     which a payment may have been taken with no plan granted is the point a
     human needs to know. */
  const pp = codeOnly(functionBody(src, 'paypalWebhook'));
  const iCatch = pp.lastIndexOf('} catch (e) {');
  ok(/alertOnce\(/.test(pp.slice(iCatch)),
     'a repeated PayPal webhook failure raises an alert', true);
  ok(/audit\(env, 'webhook_error'/.test(pp), 'and every failure is recorded', true);
}

if (report('a-webhook-is-acknowledged-when-the-work-is-durable') > 0) process.exitCode = 1;
done();
