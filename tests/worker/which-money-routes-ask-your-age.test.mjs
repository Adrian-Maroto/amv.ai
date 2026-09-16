/* WHICH MONEY ROUTES ASK YOUR AGE - ALL OF THEM NOW, AND THIS SAYS WHICH.

   This file used to record a gap. Three routes asked - the agent spending on
   your behalf, buying a listing, taking money out - and three did not:
   subscription checkout through Stripe, the same through PayPal, and listing
   something for sale. So a $3 marketplace purchase asked, and a recurring
   subscription, the largest and longest binding contract in the product, did
   not.

   THE REASON IT WAS LEFT OPEN, AND WHY THAT REASON IS SPENT. `_moneyAgeGate`
   answers `age_required` when no birth year is on file, which is true of every
   account that existed before the gate did. Adding it to checkout would have
   refused all of them at renewal and upgrade - so the fix was never the gate
   on its own, it was the gate plus somewhere to answer the question. The
   marketplace's buy has had that shape all along: ask, then retry. Checkout,
   PayPal and publish now do the same, so an existing customer is ASKED once
   rather than walled out of paying.

   Publishing is gated for a different reason than the rest and the file says
   so: a listing creates a payout relationship - AMV will owe that person money
   - and that is a contract a minor cannot form either.

   The set is asserted rather than described, so adding or removing a route
   from it is a decision somebody makes on purpose. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const client = readFileSync(join(ROOT, 'app.js'), 'utf8');

/* The body of a named worker function, up to the next top-level declaration. */
function bodyOf(name) {
  const i = worker.indexOf('async function ' + name + '(');
  if (i < 0) return null;
  const rest = worker.slice(i + 10);
  const j = rest.search(/\n(?:async )?function [A-Za-z_]/);
  return j < 0 ? rest : rest.slice(0, j);
}

section('Every route that moves money asks');
{
  for (const fn of ['browserRun', 'marketBuy', 'marketWithdraw',
                    'stripeCheckout', 'paypalSubscribe', 'marketPublish']) {
    const b = bodyOf(fn);
    ok(b !== null, fn + ' exists to be checked', fn);
    ok((b || '').indexOf('_moneyAgeGate') >= 0,
       fn + ' asks the age gate', fn);
  }
}

section('And a missing answer is a question, not a wall');
{
  /* THE HALF THAT MAKES THE GATE SAFE TO ADD.

     `age_required` means nobody ever asked. Answering it with a flat refusal
     would take every account that predates the gate and stop it renewing, with
     no way to fix that from the screen it happens on. 428 is the status that
     says "answer this first", and the client is what asks. A gate with no
     asker is a wall, so both halves are checked here - the route returning 428
     and the caller retrying after it has an answer. */
  for (const fn of ['stripeCheckout', 'paypalSubscribe', 'marketPublish', 'marketBuy']) {
    const b = bodyOf(fn) || '';
    ok(/age_required'\s*\?\s*428/.test(b.replace(/\s+/g, ' ')),
       fn + ' answers 428 when the question has simply never been asked', fn);
  }
  /* The client side of the same claim: it re-sends after getting an answer,
     rather than surfacing the refusal. */
  ok(/_withAge/.test(client), 'the client has one place that asks and retries', true);
  ok(/_askBirthYear/.test(client), 'and something to ask with', true);
  const retries = (client.match(/_askBirthYear\(\)/g) || []).length;
  ok(retries >= 2, 'used by more than one money path', retries);
}

section('Deny by default, which is what makes the gated ones worth having');
{
  const g = worker.slice(worker.indexOf('async function _moneyAgeGate('), worker.indexOf('async function _moneyAgeGate(') + 900);
  ok(/if\(!y\) return/.test(g.replace(/\s/g, '')) || /if\s*\(\s*!y\s*\)\s*return/.test(g),
     'an age nobody recorded is refused, never assumed adult', g.slice(0, 160));
  ok(/age_required/.test(g), 'and "never asked" is told apart from "too young"', true);
  ok(/age_blocked/.test(g), 'which is the refusal', true);
}

section('The client gate names six money capabilities and is asked about one');
{
  const named = ['spend', 'purchase', 'payout', 'withdraw', 'marketplace_sell', 'bank']
    .filter(c => client.indexOf("'" + c + "'") >= 0);
  ok(named.length === 6, 'all six are still named in the capability list', named);
  const asked = ['spend', 'purchase', 'payout', 'withdraw', 'marketplace_sell', 'bank']
    .filter(c => client.indexOf("gate('" + c + "')") >= 0);
  ok(asked.length === 1 && asked[0] === 'spend',
     'and only spend is ever passed to gate() - if this fails, another one was '
     + 'wired up and this file should say so', asked);
}

report();
done();
