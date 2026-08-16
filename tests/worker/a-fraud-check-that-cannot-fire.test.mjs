/* A CHECK THAT READS A FIELD NOBODY WRITES IS NOT A CHECK.

   The payout risk score has a wash-trading signal: fifty sales to fifty people
   is a business, fifty sales to two people is one person moving money through
   AMV. It read `wallet.tx`.

   Sales are not written there. `_pushWalletTx` records them in a separate
   `wallet_tx` record, and the wallet itself has no `.tx` at all. So the list
   was always empty, the threshold was never met, and the most specific
   fraud signal in the payout path had never fired once - while reading, in
   review, exactly like a working control.

   That is worse than having no check. An empty result is indistinguishable
   from a clean result, so the score came back low and the payout went out, and
   the presence of the code was a reason not to look harder.

   This file exists because the defect was invisible from the code that
   contained it. The check reads a field; whether anything fills that field is
   a fact about a DIFFERENT function. So the assertions below tie the reader to
   the writer, and then run the thing on data shaped the way the writer
   actually produces it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'risk.harness.mjs');
writeFileSync(harness, src + '\nexport { _payoutRisk, _pushWalletTx, DB };\n');
const W = await import(harness + '?t=' + Date.now());

function mkEnv() {
  const m = new Map();
  return { AMV_KV: {
    _map: m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list() { return { keys: [] }; },
  } };
}

section('The reader and the writer name the same record');
{
  const risk = codeOnly(functionBody(src, '_payoutRisk'));
  const push = codeOnly(functionBody(src, '_pushWalletTx'));

  ok(/wallet_tx/.test(push), 'sales are written to wallet_tx', true);
  ok(/wallet_tx/.test(risk), 'and the concentration check reads wallet_tx', true);
  ok(!/wallet\s*&&\s*wallet\.tx/.test(risk),
     'and no longer reads a wallet.tx that nothing populates', true);

  /* The general form, so the next field invented in one place and read in
     another is caught: nothing in the risk score may read a wallet property
     that the wallet writer never sets. */
  ok(!/\bwallet\.tx\b/.test(codeOnly(src)),
     'wallet.tx appears nowhere in the Worker at all', true);
}

section('It fires on concentrated sales, using the shape the writer produces');
{
  /* Built with _pushWalletTx rather than by hand, so the test cannot pass on a
     record shape the product never creates - which is the exact way the
     original defect hid. */
  const env = mkEnv();
  const seller = 'seller@x.z';
  for (let i = 0; i < 4; i++) {
    await W._pushWalletTx(env, seller, {
      type: 'sale', ref: 'r' + i, item: 'it' + i, buyer: 'same@buyer.z', amount: 20, at: Date.now(),
    });
  }
  const wallet = { balance: 80, payouts: [] };
  const risk = await W._payoutRisk(env, seller, 40, wallet);
  ok(risk.score >= 45, 'four sales from one buyer scores as concentration', risk.score);
  ok(risk.reasons.some((r) => /only 1 buyer/.test(r)), 'and says so in words', risk.reasons);
}

section('And stays quiet when the sales are genuinely spread');
{
  const env = mkEnv();
  const seller = 'honest@x.z';
  for (let i = 0; i < 6; i++) {
    await W._pushWalletTx(env, seller, {
      type: 'sale', ref: 'r' + i, item: 'it' + i, buyer: 'buyer' + i + '@x.z', amount: 20, at: Date.now(),
    });
  }
  const risk = await W._payoutRisk(env, seller, 40, { balance: 120, payouts: [] });
  ok(!risk.reasons.some((r) => /only \d+ buyer/.test(r)),
     'six sales to six buyers is not flagged as concentration', risk.reasons);
}

section('A withdrawal is not a sale');
{
  /* Counting withdrawals as sales would let somebody dilute the buyer count
     with their own cash-outs, which is the obvious way to defeat this. */
  const env = mkEnv();
  const seller = 'mixed@x.z';
  for (let i = 0; i < 4; i++) {
    await W._pushWalletTx(env, seller, {
      type: 'sale', ref: 's' + i, item: 'it' + i, buyer: 'one@buyer.z', amount: 20, at: Date.now(),
    });
  }
  for (let i = 0; i < 5; i++) {
    await W._pushWalletTx(env, seller, {
      type: 'withdrawal', ref: 'w' + i, item: 'w' + i, amount: 10, at: Date.now(),
    });
  }
  const risk = await W._payoutRisk(env, seller, 40, { balance: 30, payouts: [] });
  ok(risk.reasons.some((r) => /only 1 buyer/.test(r)),
     'withdrawals do not dilute the buyer count', risk.reasons);
}

section('An unreadable history is not a clean history');
{
  /* The failure that produced this whole finding was an empty result read as a
     good result. If the store cannot be read, the score must not come back
     clean - a payout should not leave on the strength of a failed lookup. */
  const env = mkEnv();
  env.AMV_KV.get = async () => { throw new Error('storage down'); };
  const risk = await W._payoutRisk(env, 'x@y.z', 40, { balance: 100, payouts: [] });
  ok(risk.reasons.some((r) => /a person should look at it/.test(r)),
     'a failed read escalates to human review rather than scoring clean', risk.reasons);
  ok(risk.score > 0, 'and does not come back as a zero-risk payout', risk.score);
}

if (report('a-fraud-check-that-cannot-fire') > 0) process.exitCode = 1;
done();
