/* TOKEN ALLOWANCES vs THE TOKENIZER — plan limits are counted in tokens, but a
   token is not a fixed amount of work. The current-generation engine tokenizes
   the same English text into roughly 30% more tokens than the one these numbers
   were calibrated against, so a model upgrade would silently have cut every
   user's real allowance by about a quarter for identical work. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const client = readFileSync(join(ROOT, 'app.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'alw.harness.mjs');
writeFileSync(harness, src + '\nexport { PLAN_LIMITS, TOKENIZER_SCALE, ENGINES, effectiveLimits };\n');
const W = await import(harness + '?t=' + Date.now());

/* What the caps were before the engine line moved. */
const BEFORE = { free: [40000, 250000], pro: [250000, 1800000], elite: [900000, 7000000], ultra: [2200000, 18000000] };

section('The allowance is denominated in work, not in a unit that moved');
Object.entries(BEFORE).forEach(([plan, [day, month]]) => {
  const now = W.PLAN_LIMITS[plan];
  const dayRatio = now.dayTokens / day, monthRatio = now.monthTokens / month;
  ok(Math.abs(dayRatio - W.TOKENIZER_SCALE) < 0.02,
     `${plan} daily allowance scaled with the tokenizer`, dayRatio.toFixed(3));
  ok(Math.abs(monthRatio - W.TOKENIZER_SCALE) < 0.02,
     `${plan} monthly allowance scaled with the tokenizer`, monthRatio.toFixed(3));
});

section('So the same real work still fits');
{
  // ~1000 words of English. Under the old tokenizer that is ~1300 tokens; under
  // the new one ~1690. The question is whether the same conversation still fits.
  const OLD_TOKENS_PER_TURN = 1300, NEW_TOKENS_PER_TURN = 1300 * W.TOKENIZER_SCALE;
  const turnsBefore = Math.floor(BEFORE.pro[0] / OLD_TOKENS_PER_TURN);
  const turnsNow = Math.floor(W.PLAN_LIMITS.pro.dayTokens / NEW_TOKENS_PER_TURN);
  ok(turnsNow >= turnsBefore, 'a Pro user gets at least as many real turns per day as before',
     turnsBefore + ' -> ' + turnsNow);
}

section('The reasoning is a named constant, not a magic number');
{
  ok(typeof W.TOKENIZER_SCALE === 'number' && W.TOKENIZER_SCALE > 1,
     'the ratio is declared', W.TOKENIZER_SCALE);
  ok(/re-measure with count_tokens rather than guessing/.test(src),
     'with a note to re-measure rather than guess if the engine line moves again');
}

section('A custom plan is not left behind');
{
  const limits = W.effectiveLimits({ plan: 'custom', customCfg: { price: 30 } });
  ok(limits.monthTokens > 300000, 'the custom default scaled too', limits.monthTokens);
  ok(limits.dayTokens > 50000, 'daily as well', limits.dayTokens);
}

section('The browser guard matches the server, so nobody is stopped by a phantom limit');
{
  const m = client.match(/free:\s*\{ dailyTokenCap:(\d+)/);
  ok(!!m, 'the client declares a free daily cap', m && m[1]);
  ok(+m[1] === W.PLAN_LIMITS.free.dayTokens,
     'and it is the same number the server enforces', [+m[1], W.PLAN_LIMITS.free.dayTokens]);
  const p = client.match(/pro:\s*\{ dailyTokenCap:(\d+)/);
  ok(+p[1] === W.PLAN_LIMITS.pro.dayTokens, 'same for Pro', [+p[1], W.PLAN_LIMITS.pro.dayTokens]);
}

section('Margin is still guaranteed by the dollar backstop, not by these caps');
{
  ok(/priceForBackstop \* 0\.45/.test(src), 'the cost ceiling is unchanged');
  ok(/anti-abuse guard/.test(src), 'and the token caps are documented as the secondary guard they are');
}

report();
done();
