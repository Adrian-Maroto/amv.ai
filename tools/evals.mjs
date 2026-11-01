#!/usr/bin/env node
/* WHAT AMV MUST STILL DO, CHECKED BEFORE A CHANGE SHIPS (Oct 31 audit, items
   91-92: an eval framework, and a canary for model and prompt changes).

   Runs every case in evals/cases.json through AMV's own API - the same
   streaming route, system prompt and engines a customer gets - and grades
   each answer with checks that do not depend on wording: patterns that must
   and must not appear, valid JSON, a bullet count, a word limit.

     AMV_API_KEY=amv_sk_... node tools/evals.mjs
     AMV_API_KEY=... node tools/evals.mjs --engine amv-core --min 0.9
     AMV_API_KEY=... node tools/evals.mjs --engine amv-core --compare amv-forge

   --compare is the canary: the same cases on the engine in use and on the
   one about to replace it, and it fails if any case that passed on the first
   fails on the second. Run it before changing what an engine points at, or
   a system prompt, never after.

   It costs model credit (one short answer per case per engine), which is why
   it is a command and not a stage of the gate. The key is read from the
   environment only - a key on a command line is in the shell's history. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const API = String(opt('api', process.env.AMV_API_URL || 'https://api.amv.homes')).replace(/\/$/, '');
const ENGINE = opt('engine', 'amv-core');
const COMPARE = opt('compare', '');
const MIN = Number(opt('min', '0.9'));
const CASES = opt('cases', join(ROOT, 'evals', 'cases.json'));
const KEY = process.env.AMV_API_KEY || '';

/* Grading: each check that fails says which, so a red case is actionable. */
export function grade(c, text) {
  const why = [];
  const t = String(text || '');
  for (const p of c.mustMatch || []) if (!new RegExp(p, 'i').test(t)) why.push('missing /' + p + '/');
  for (const p of c.mustNotMatch || []) if (new RegExp(p, 'i').test(t)) why.push('has /' + p + '/');
  if (c.json) { try { JSON.parse(t.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { why.push('not JSON'); } }
  if (c.bullets != null) {
    const n = t.split('\n').filter(l => /^\s*([-*•]|\d+[.)])\s+\S/.test(l)).length;
    if (n !== c.bullets) why.push(n + ' bullets, wanted ' + c.bullets);
  }
  if (c.maxWords != null) { const n = t.trim().split(/\s+/).filter(Boolean).length; if (n > c.maxWords) why.push(n + ' words, at most ' + c.maxWords); }
  return why;
}

async function ask(engine, question) {
  const res = await fetch(API + '/v1/messages', { method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', 'User-Agent': 'amv-evals/1' },
    body: JSON.stringify({ model: engine, max_tokens: 400, stream: true, messages: [{ role: 'user', content: question }] }) });
  if (!res.ok) { let m = ''; try { m = (await res.json()).error || ''; } catch (e) {} throw new Error('HTTP ' + res.status + (m ? ': ' + m : '')); }
  let text = '', buf = '', tokens = 0;
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') text += ev.delta.text;
      if (ev.type === 'message_delta' && ev.usage) tokens = ev.usage.output_tokens || tokens;
      if (ev.type === 'error') throw new Error((ev.error && ev.error.message) || 'stream error');
    }
  }
  return { text, tokens };
}

async function run(engine, cases) {
  const out = [];
  for (const c of cases) {
    let text = '', why;
    try { ({ text } = await ask(engine, c.ask)); why = grade(c, text); }
    catch (e) { why = ['request failed: ' + e.message]; }
    out.push({ id: c.id, pass: why.length === 0, why, text });
    console.log((why.length ? '  ✗ ' : '  ✓ ') + engine + '  ' + c.id + (why.length ? '  - ' + why.join('; ') : ''));
  }
  return out;
}

async function main() {
  if (!KEY) { console.error('Set AMV_API_KEY (Settings > API keys) - from the environment, never as an argument.'); process.exit(2); }
  const cases = JSON.parse(readFileSync(CASES, 'utf8')).cases || [];
  if (!cases.length) { console.error('No cases in ' + CASES); process.exit(2); }
  console.log('AMV evals - ' + cases.length + ' cases against ' + API);
  const a = await run(ENGINE, cases);
  const rate = a.filter(r => r.pass).length / a.length;
  console.log('\n' + ENGINE + ': ' + a.filter(r => r.pass).length + ' of ' + a.length + ' (' + Math.round(rate * 100) + '%)');
  let bad = rate < MIN;
  if (bad) console.log('Below the bar of ' + Math.round(MIN * 100) + '%.');
  if (COMPARE) {
    const b = await run(COMPARE, cases);
    const lost = b.filter((r, i) => a[i].pass && !r.pass).map(r => r.id);
    console.log('\n' + COMPARE + ': ' + b.filter(r => r.pass).length + ' of ' + b.length);
    if (lost.length) { bad = true; console.log('Canary: ' + COMPARE + ' fails what ' + ENGINE + ' passes - ' + lost.join(', ') + '. Do not switch.'); }
    else console.log('Canary: nothing ' + ENGINE + ' does is lost on ' + COMPARE + '.');
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
