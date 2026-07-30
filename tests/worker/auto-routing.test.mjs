/* SMART ROUTING — "AMV Auto" is the default model and its description promises
   it picks the right model for each task. It did not: 'auto' was aliased to one
   engine, so "thanks" and a 400-line refactor ran on the same thing. That is a
   feature the interface claimed and the code did not deliver, and it is the
   product's largest cost lever - Core input is 3x Pulse, Forge is 15x.
   These assertions cover: the cheap turns really go cheap, the hard turns
   really go deep, nobody is routed above the plan they pay for, and the user is
   told which engine answered. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'routing.harness.mjs');
writeFileSync(harness, src + '\nexport { _autoRoute, ENGINES, RAW_TO_KEY, effectiveLimits, PLAN_RANK };\n');
const W = await import(harness + '?t=' + Date.now());

const user = (plan) => ({ email: 'a@x.com', plan: plan || 'free' });
const limits = (plan) => W.effectiveLimits(user(plan));
const route = (text, opts) => W._autoRoute(
  Object.assign({ messages: [{ role: 'user', content: text }] }, opts || {}),
  user((opts && opts.plan) || 'pro'), limits((opts && opts.plan) || 'pro'));

section('Trivial turns go to the cheapest engine');
[['thanks'], ['hi'], ['ok'], ['good morning'], ['what is the capital of France?'],
 ['convert 30c to f'], ['define entropy'], ['translate hola to english']].forEach(([t]) => {
  const r = route(t);
  ok(r.key === 'amv-pulse', `"${t}" -> Pulse`, r.key);
});

section('Work that needs depth goes to the deep engine');
[['refactor this function to be iterative'],
 ['```js\nfor (const x of y) {}\n```\nwhy is this slow?'],
 ['implement a rate limiter with a sliding window'],
 ['prove that the sum of two odd numbers is even'],
 ['design a system for processing 10k events a second'],
 ['do a security review of this auth flow']].forEach(([t]) => {
  const r = route(t, { plan: 'pro' });
  ok(r.key === 'amv-forge', `"${t.slice(0, 38)}..." -> Forge`, r.key);
});

section('Everything in between is the balanced engine');
['write me a short poem about the sea',
 'my landlord will not return my deposit, what are my options',
 'compare renting and buying for someone earning 60k'].forEach(t => {
  const r = route(t);
  ok(r.key === 'amv-core', `"${t.slice(0, 34)}..." -> Core`, r.key);
});

section('A short question is NOT cheap when there is more to it than the words');
{
  const media = W._autoRoute({ messages: [{ role: 'user', content: [
    { type: 'text', text: 'what is this?' }, { type: 'image', source: {} }] }] }, user('pro'), limits('pro'));
  ok(media.key === 'amv-core', 'a short question about an attached image is not a Pulse turn', media.key);

  const search = route('who won yesterday?', { tools: [{ type: 'web_search_20250305' }] });
  ok(search.key === 'amv-core', 'a turn that needs research has to synthesise sources', search.key);

  const deep = W._autoRoute({ messages: [
    { role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'and?' }, { role: 'assistant', content: '...' },
    { role: 'user', content: 'so what should I do' }] }, user('pro'), limits('pro'));
  ok(deep.key === 'amv-core', 'a turn deep in a conversation carries context the cheap engine would drop', deep.key);

  const bigSys = W._autoRoute({ messages: [{ role: 'user', content: 'hi' }], system: 'x'.repeat(7000) },
    user('pro'), limits('pro'));
  ok(bigSys.key === 'amv-forge', 'a loaded project context is real work regardless of the question length', bigSys.key);

  const long = route('please review the following.\n' + 'word '.repeat(1400));
  ok(long.key === 'amv-forge', 'a long document to work through is not a cheap turn', long.key);
}

section('Nobody is routed above the plan they pay for');
{
  const free = route('refactor this function and explain the complexity', { plan: 'free' });
  ok(free.key === 'amv-core', 'a free user asking for hard work gets Core, not the paid engine', free.key);
  ok(W.PLAN_RANK.free < W.PLAN_RANK[W.ENGINES['amv-forge'].minPlan], 'because Forge is a paid engine');
  ok(/Pro and above/.test(free.why), 'and the reason says so honestly rather than pretending', free.why);

  const pro = route('refactor this function and explain the complexity', { plan: 'pro' });
  ok(pro.key === 'amv-forge', 'a Pro user gets the engine they are paying for', pro.key);
}

section('Every route explains itself in words the user can read');
['thanks', 'refactor this', 'write me a poem'].forEach(t => {
  const r = route(t);
  ok(typeof r.why === 'string' && r.why.length > 8, `"${t}" comes with a reason`, r.why);
  ok(!/claude|anthropic|haiku|sonnet|opus/i.test(r.why), 'and it names no engine outside AMV', r.why);
});

section('The saving is real, not cosmetic');
{
  const P = W.ENGINES['amv-pulse'], C = W.ENGINES['amv-core'], F = W.ENGINES['amv-forge'];
  ok(C.inCost / P.inCost >= 3, 'Core input costs at least 3x Pulse, so routing short turns down matters',
     (C.inCost / P.inCost).toFixed(1) + 'x');
  ok(F.inCost / C.inCost >= 5, 'and Forge is several times Core, so it must be reserved for work that needs it',
     (F.inCost / C.inCost).toFixed(1) + 'x');
}

section('Auto is wired into the proxy, not just defined');
ok(/const isAuto = rawModel === 'auto'/.test(src), 'the proxy detects the Auto model');
ok(/const routed = isAuto \? _autoRoute\(/.test(src), 'and calls the router');
ok(/'X-AMV-Engine': key/.test(src), 'the engine that ran is returned to the client');
ok(/Access-Control-Expose-Headers/.test(src), 'and exposed, or the browser could not read it');
{
  // The old alias must not still silently win over the router.
  const proxy = src.slice(src.indexOf('async function aiProxy'), src.indexOf('async function aiProxy') + 2000);
  ok(/routed \? routed\.key :/.test(proxy), 'the routed choice takes precedence over the alias table', true);
}

section('The client labels the engine that actually answered');
{
  const client = readFileSync(join(ROOT, 'app.js'), 'utf8');
  ok(/X-AMV-Engine/.test(client), 'the app reads the header');
  ok(/ENGINE_LABEL/.test(client), 'and maps it to an AMV name');
  ok(/_engine=_ranEngine/.test(client) || /_base\._engine/.test(client), 'storing it on the message');
}

report();
done();
