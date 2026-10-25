/* HISTORY IS SIZED TO THE ENGINE THAT READS IT (audit #16).

   A chat's history had one budget whatever read it: 55% of 180,000 tokens,
   with no account of the instructions or the tools that share the same
   window, and counted at four characters a token. So a project with large
   instructions on a smaller engine sent more than the engine could read and
   was refused; and a chat in Chinese, Japanese or Korean - about a token a
   character - sent four times the history it was meant to, all of it out of
   the person's allowance.

   One assembler now works out the room: the engine's context, less the
   longest answer it may write, the instructions, the tools and the margin
   the server keeps - and history takes no more than the standing budget even
   when the room is larger, because every token of it is also allowance. Run
   in the real page against its own functions. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page } = app;
await page.evaluate(() => { window.aiComplete = async () => 'BRIEF: decisions kept.'; });

section('An AMV engine: a million tokens of room, the standing budget for history');
{
  const r = await page.evaluate(() => { const x = _ctxRoom({ mdl: MODELS.core, system: 'x'.repeat(40000), tools: AMV_TOOLS }); return Object.assign(x, { std: CTX_HISTORY_BUDGET }); });
  ok(r.ctx === 1000000 && r.room > 900000, 'the room is the engine’s, less what else is sent', r);
  ok(r.budget === r.std, 'and history still takes no more than the standing budget - it is allowance too', r);
}

section('A smaller engine with large project instructions: less history, not a refusal');
{
  const r = await page.evaluate(() => {
    const small = { label: 'Partner', model: 'amv-vega', ctx: 128000, tokens: 16000, partner: true };
    const system = 'Project notes. '.repeat(16000);   // 240,000 characters, about 60,000 tokens
    const room = _ctxRoom({ mdl: small, system, tools: AMV_TOOLS });
    const msgs = Array.from({ length: 120 }, (_, i) => ({ r: i % 2 ? 'a' : 'u', c: ('Turn ' + i + ' of the plan. ').repeat(200) }));
    const split = _ctxSplit(msgs, room.budget);
    const sentTok = msgs.slice(split.from).reduce((n, m) => n + _tokScript(m.c), 0);
    return { room, split, sentTok, total: _tokScript(system) + room.tools + sentTok + small.tokens };
  });
  ok(r.room.budget > 20000 && r.room.budget < 45000, 'the history budget is what is left of 128,000', r.room);
  ok(r.split.from > 0 && r.sentTok <= r.room.budget + 2000, 'older turns move to the brief', { from: r.split.from, sent: r.sentTok });
  ok(r.total <= 128000 - 8000, 'and the whole request fits inside what the engine reads, with the server’s margin', r.total);
}

section('A chat in Chinese is counted the way the engine counts it');
{
  const r = await page.evaluate(() => {
    const zh = '北部地区的季度数据上升了百分之四而南部门店保持稳定'.repeat(80);  // 2,000 characters a turn
    const msgs = Array.from({ length: 60 }, (_, i) => ({ r: i % 2 ? 'a' : 'u', c: zh }));
    const split = _ctxSplit(msgs);
    const sent = msgs.slice(split.from).reduce((n, m) => n + _tokScript(m.c), 0);
    return { from: split.from, sent, std: CTX_HISTORY_BUDGET, total: 60 * 2000, old: Math.ceil(60 * 2000 / 4) };
  });
  ok(r.from > 0 && r.sent <= r.std, '120,000 tokens of history no longer goes whole: what is sent fits the budget', r);
  ok(r.old < r.std, 'which the old count, at four characters a token, would have sent whole', r.old);
}

section('The request is assembled from what is actually in it');
{
  const r = await page.evaluate(async () => {
    const small = { label: 'Partner', model: 'amv-vega', ctx: 128000, tokens: 16000, partner: true };
    const conv = { id: 'cx', msgs: Array.from({ length: 120 }, (_, i) => ({ r: i % 2 ? 'a' : 'u', c: ('Turn ' + i + ' of the plan. ').repeat(200) })) };
    const plain = await _ctxPrepare(JSON.parse(JSON.stringify(conv)), 120);
    const sized = await _ctxPrepare(JSON.parse(JSON.stringify(conv)), 120, { mdl: small, system: 'Project notes. '.repeat(16000), tools: AMV_TOOLS });
    return { plain: plain.from, sized: sized.from, brief: !!sized.brief };
  });
  ok(r.sized > r.plain, 'given the engine and the instructions, fewer turns go verbatim than with the standing budget', r);
  ok(r.brief, 'and what moved out is carried by the brief', r);
}

section('The page learns each engine’s context from the server');
{
  const r = await page.evaluate(async () => {
    const was = AMV_API.engines;
    AMV_API.engines = async () => ({ ok: true, engines: [{ key: 'amv-core', minPlan: 'free', context: 900000, maxOut: 16000 },
      { key: 'amv-vega', label: 'AMV Vega', minPlan: 'pro', partner: true, context: 128000, maxOut: 8000 }] });
    const liveWas = Object.getOwnPropertyDescriptor(AMV_API, 'live');
    Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true });
    try { await _loadPartnerEngines(); } finally { AMV_API.engines = was; if (liveWas) Object.defineProperty(AMV_API, 'live', liveWas); else delete AMV_API.live; }
    return { core: MODELS.core.ctx, vega: MODELS['amv-vega'] && MODELS['amv-vega'].ctx, vegaOut: MODELS['amv-vega'] && MODELS['amv-vega'].tokens };
  });
  ok(r.core === 900000, 'an AMV engine takes the figure the server gives', r);
  ok(r.vega === 128000 && r.vegaOut === 8000, 'and a partner engine its context and its own answer ceiling', r);
}

ok(app.errors.length === 0, 'no JavaScript errors', app.errors.slice(0, 3));
await app.close();
if (report('history-is-sized-to-the-engine-that-reads-it') > 0) process.exitCode = 1;
done();
