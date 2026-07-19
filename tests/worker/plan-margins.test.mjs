/* PLAN MARGINS — the token allowances must keep AMV profitable at worst case,
   so the plan price is decoupled from raw compute (not "$X = $X of tokens").
   Guards against anyone bumping allowances back to loss-making levels. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, '..', '..', 'amv-backend.js'), 'utf8');

// pull the monthTokens for each paid plan out of the LIMITS table
function monthTokens(plan){
  const re = new RegExp(plan + ':\\s*\\{[^}]*monthTokens:\\s*(\\d+)');
  const m = src.match(re); return m ? parseInt(m[1], 10) : null;
}
const PRICE = { pro:15, elite:75, ultra:200 };
const BLENDED_PER_MTOK = 6.0;   // conservative blended $/million tokens

section('Every paid plan stays profitable even if fully maxed');
for (const [plan, price] of Object.entries(PRICE)) {
  const mt = monthTokens(plan);
  ok(mt !== null, `${plan} has a monthly token allowance`, mt);
  const worstCost = (mt / 1e6) * BLENDED_PER_MTOK;
  const margin = (price - worstCost) / price;
  ok(margin > 0.20, `${plan}: worst-case margin ${(margin*100).toFixed(0)}% stays above 20% (cost $${worstCost.toFixed(0)} on $${price})`, (margin*100).toFixed(0)+'%');
}

section('The 45% cost backstop is still present as anti-abuse floor');
ok(/\*\s*0\.45/.test(src), 'the 45% margin backstop remains in place');

report();
done();
