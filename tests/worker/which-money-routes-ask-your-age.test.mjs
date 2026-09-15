/* WHICH MONEY ROUTES ASK YOUR AGE - WRITTEN DOWN, BECAUSE THE ANSWER IS
   CURRENTLY "SOME OF THEM" AND NOTHING SAID SO.

   This file changes no behaviour. It records the set, so that the gap below is
   visible and any change to it is deliberate rather than accidental.

   The compliance module states the reason for the gate plainly: a minor cannot
   form a binding contract, "which is exactly why a teenager's purchases come
   straight back as chargebacks", so age gates "the features that create that
   exposure". age-gate.test.mjs enforces that on three routes.

   GATED (and covered by age-gate.test.mjs):
     browserRun        - the agent spending on your behalf
     marketBuy         - buying a listing
     marketWithdraw    - taking money out

   NOT GATED, and this is the open question:
     stripeCheckout    - starting a paid subscription
     paypalSubscribe   - the same, through PayPal
     marketPublish     - listing something for sale, which creates a payout
                         relationship

   So a $3 marketplace purchase asks, and a recurring subscription - the largest
   and longest binding contract in the product, and the one whose chargebacks
   the comment is about - does not.

   WHY THIS FILE RECORDS THE GAP INSTEAD OF CLOSING IT. _moneyAgeGate returns
   `age_required` when no birth year is on file, and it is deliberately distinct
   from a refusal because "an existing customer who has simply never been asked
   needs a prompt, not a wall". Adding the gate to checkout would therefore
   refuse every existing account that has never been asked - at renewal and at
   upgrade. That is a decision about revenue and about existing customers, and
   it belongs to the owner, not to a test.

   The client has the same shape: AMVCompliance.gate() names six money
   capabilities - spend, purchase, payout, withdraw, marketplace_sell, bank -
   and only 'spend' is ever passed to it. The other five are asked about
   nowhere. That is checked here too, so the list and its callers cannot drift
   further apart in silence. */
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

section('The routes that do ask');
{
  for (const fn of ['browserRun', 'marketBuy', 'marketWithdraw']) {
    const b = bodyOf(fn);
    ok(b !== null, fn + ' exists to be checked', fn);
    ok((b || '').indexOf('_moneyAgeGate') >= 0,
       fn + ' asks the age gate', fn);
  }
}

section('The routes that do not - recorded, not endorsed');
{
  /* If one of these gains the gate, this fails and the list gets updated on
     purpose. That is the point: the gap should not be able to close or widen
     without somebody noticing. */
  for (const fn of ['stripeCheckout', 'paypalSubscribe', 'marketPublish']) {
    const b = bodyOf(fn);
    ok(b !== null, fn + ' exists to be checked', fn);
    ok((b || '').indexOf('_moneyAgeGate') < 0,
       fn + ' still does not ask - if this fails, the gate was added and this '
       + 'list should say so', fn);
  }
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
