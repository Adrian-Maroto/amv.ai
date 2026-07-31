/* PROMPT CACHING - the system prompt was cached and the conversation was not.
   Caching is a prefix match rendered tools -> system -> messages, so the
   breakpoint on the system prompt already covered the tools in front of it.
   What it never covered is the part that grows: by turn fifteen the history
   dwarfs the system prompt, and every one of those tokens was re-charged at
   full price on every turn. That is the largest avoidable cost in a chat
   product. These assertions cover the breakpoint being placed, being placed
   only where it will actually cache, and surviving the lookback limit. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'caching.harness.mjs');
writeFileSync(harness, src + '\nexport { _withCacheBreakpoints, ENGINES, CACHE_LOOKBACK, _estimateInputTokens, _systemWithIdentity, AMV_IDENTITY_PREAMBLE };\n');
const W = await import(harness + '?t=' + Date.now());

const CORE = W.ENGINES['amv-core'];
const big = n => 'word '.repeat(n);                       // ~1 token per word
const turn = (role, text) => ({ role, content: text });
const marks = msgs => msgs.reduce((n, m) => n + (Array.isArray(m.content)
  ? m.content.filter(b => b && b.cache_control).length : 0), 0);
const lastBlock = msgs => { const c = msgs[msgs.length - 1].content; return Array.isArray(c) ? c[c.length - 1] : null; };

section('A real conversation gets a breakpoint at its newest turn');
{
  const convo = [turn('user', big(600)), turn('assistant', big(600)), turn('user', 'and now what?')];
  const out = W._withCacheBreakpoints(convo, CORE);
  ok(marks(out) >= 1, 'a cache breakpoint is placed', marks(out));
  ok(!!(lastBlock(out) && lastBlock(out).cache_control),
     'on the LAST block of the newest turn, so the next turn reads the whole history from cache');
  ok(lastBlock(out).type === 'text' && lastBlock(out).text === 'and now what?',
     'a plain string turn is converted to a block without changing its text', lastBlock(out).text);
}

section('The caller’s messages are never mutated');
{
  const convo = [turn('user', big(600)), turn('assistant', big(600)), turn('user', 'hello')];
  const before = JSON.stringify(convo);
  W._withCacheBreakpoints(convo, CORE);
  ok(JSON.stringify(convo) === before,
     'metering and the fallback estimate read the original array - it must be untouched');
}

section('Below the model’s minimum, no marker is placed');
{
  const tiny = [turn('user', 'hi'), turn('assistant', 'hello'), turn('user', 'thanks')];
  const out = W._withCacheBreakpoints(tiny, CORE);
  ok(marks(out) === 0, 'a short exchange gets no breakpoint - it would not cache and a write costs 1.25x', marks(out));
  ok(out === tiny, 'and the array is returned untouched');
}

section('The minimum is per-model, not a single guess');
{
  const mins = Object.entries(W.ENGINES).map(([k, e]) => [k, e.cacheMin]);
  ok(mins.every(([, v]) => typeof v === 'number' && v > 0), 'every engine declares its own minimum', mins);
  ok(new Set(mins.map(([, v]) => v)).size > 1, 'and they genuinely differ between models', mins);

  // ~2000 tokens: over Sonnet's minimum, under Haiku's.
  const mid = [turn('user', big(1000)), turn('assistant', big(900)), turn('user', 'go on')];
  const onCore = W._withCacheBreakpoints(mid, W.ENGINES['amv-core']);
  const onPulse = W._withCacheBreakpoints(mid, W.ENGINES['amv-pulse']);
  ok(marks(onCore) >= 1, 'a 2k-token history is cached on the engine whose minimum is 1024');
  ok(marks(onPulse) === 0, 'and NOT on the engine whose minimum is 4096, where the marker would be ignored');
}

section('A block-heavy turn still chains to the previous one');
/* A breakpoint only searches back 20 blocks. One turn full of tool calls can
   exceed that by itself, which silently breaks the chain and turns every
   following turn into a full-price miss. */
{
  const wide = Array.from({ length: 24 }, (_, i) => ({ type: 'text', text: big(60) + i }));
  const convo = [turn('user', big(400)), { role: 'assistant', content: wide }, turn('user', 'continue')];
  const out = W._withCacheBreakpoints(convo, CORE);
  ok(marks(out) >= 2, 'a wide turn gets a second breakpoint inside the lookback window', marks(out));
  ok(W.CACHE_LOOKBACK === 20, 'and the window matches the documented limit', W.CACHE_LOOKBACK);
}

section('A normal narrow conversation is not over-marked');
{
  const convo = Array.from({ length: 8 }, (_, i) => turn(i % 2 ? 'assistant' : 'user', big(200)));
  const out = W._withCacheBreakpoints(convo, CORE);
  ok(marks(out) <= 3, 'well inside the 4-breakpoint request limit, leaving room for the system prompt', marks(out));
  ok(marks(out) >= 1, 'while still caching the conversation');
}

section('Content blocks that already exist are preserved');
{
  const convo = [
    turn('user', big(1400)),          // comfortably over the 1024 minimum
    { role: 'assistant', content: [{ type: 'text', text: 'here you go' }] },
    { role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: 'what is this?' }] }
  ];
  const out = W._withCacheBreakpoints(convo, CORE);
  const blocks = out[2].content;
  ok(blocks.length === 2, 'no blocks are added or dropped', blocks.length);
  ok(blocks[0].type === 'image' && blocks[0].source.data === 'AAAA', 'the image is untouched');
  ok(!blocks[0].cache_control, 'only the last block carries the marker');
  ok(!!blocks[1].cache_control, 'which is the text block at the end');
}

section('It is wired into the real request, and the system prompt still cached');
{
  ok(/messages: _withCacheBreakpoints\(body\.messages \|\| \[\], eng\)/.test(src),
     'the proxy sends the marked-up messages, not the raw ones');
  ok(/cache_control: \{ type: 'ephemeral' \}/.test(src), 'the system prompt keeps its own breakpoint');
  const proxy = src.slice(src.indexOf('async function aiProxy'));
  const sysAt = proxy.indexOf('upstreamBody.system');
  const msgAt = proxy.indexOf('_withCacheBreakpoints');
  ok(msgAt > 0 && sysAt > 0, 'both breakpoints exist in the same request');
  ok(!/anthropic-beta': 'prompt-caching/.test(src),
     'the obsolete caching beta header is gone - caching is generally available');
}

section('The accounting already prices cache tiers correctly');
{
  ok(/cache_read_input_tokens/.test(src), 'cache reads are read from usage');
  ok(/cache_creation_input_tokens/.test(src), 'so are cache writes');
  ok(/\* eng\.inCost \* 0\.10/.test(src), 'reads are billed at a tenth of input price');
  ok(/\* eng\.inCost \* 1\.25/.test(src), 'writes at 1.25x - so the saving reported to the owner is real');
}

section('A cache marker the CLIENT sent is thrown away');
{
  /* A write costs 1.25x. Markers placed from the browser on content that will
     never be read back are somebody else's bill going up, and more than four in
     one request is a hard upstream error. Caching is a server decision. */
  const hostile = [
    { role: 'user', content: [
      { type: 'text', text: big(700), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: big(700), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: big(700), cache_control: { type: 'ephemeral' } },
    ] },
    { role: 'assistant', content: [{ type: 'text', text: big(700), cache_control: { type: 'ephemeral' } }] },
    { role: 'user', content: [{ type: 'text', text: 'go', cache_control: { type: 'ephemeral' } }] },
  ];
  const out = W._withCacheBreakpoints(hostile, CORE);
  ok(marks(out) <= 3, 'at most the breakpoints AMV chose survive, never the five that were sent', marks(out));
  ok(!(out[0].content[0].cache_control), 'a marker on an old block is gone');
  ok(!!(lastBlock(out) && lastBlock(out).cache_control), 'and the one AMV wanted is still there');
  ok(out[0].content[0].text === hostile[0].content[0].text, 'the text itself is untouched - only the marker is removed');
}

section('The identity framing is the server\u2019s, and it always goes first');
{
  const withClient = W._systemWithIdentity('You are a helpful assistant. Be brief.');
  ok(withClient.startsWith(W.AMV_IDENTITY_PREAMBLE),
     'a client system prompt is appended AFTER it, never in front of it');
  ok(withClient.includes('Be brief.'), 'and the client prompt still applies');

  for (const empty of ['', null, undefined, '   ']) {
    ok(W._systemWithIdentity(empty) === W.AMV_IDENTITY_PREAMBLE,
       'sending no system prompt is not a way to drop the framing', JSON.stringify(empty));
  }
  ok(!/anthropic|openai|claude|chatgpt|gemini/i.test(W.AMV_IDENTITY_PREAMBLE),
     'and the rule itself names no company - it would be the one place they appear');
}

report();
done();
