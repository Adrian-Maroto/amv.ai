/* AN EVAL GRADES WHAT IT SAYS IT GRADES (tools/evals.mjs, Oct 31 audit 91-92).

   Run against a stand-in for AMV's API that streams answers chosen per
   engine, so the grading and the canary are measured without spending
   model credit:
     - each kind of check passes a right answer and fails a wrong one, and
       says which check failed;
     - the run fails below the bar and passes above it;
     - the canary fails when the new engine loses a case the old one passed;
     - the key comes from the environment and nowhere else, and is sent
       only as the bearer token. */
import { spawn } from 'child_process';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const { grade } = await import(join(ROOT, 'tools', 'evals.mjs'));

section('Each kind of check passes a right answer and names what a wrong one missed');
{
  ok(grade({ mustMatch: ['\\b391\\b'] }, 'It is 391.').length === 0, 'a pattern that must appear, appearing');
  ok(/missing/.test(grade({ mustMatch: ['\\b391\\b'] }, 'It is 392.')[0] || ''), 'and missing, said');
  ok(/has/.test(grade({ mustNotMatch: ['!\\[[^\\]]*\\]\\(https?://'] }, '![cat](https://x.test/c.png)')[0] || ''), 'a pattern that must not appear, appearing, said');
  ok(grade({ json: true }, '```json\n{"ok": true}\n```').length === 0, 'JSON, even fenced');
  ok(grade({ json: true }, 'Sure! {"ok": true}')[0] === 'not JSON', 'and prose around it is not JSON');
  ok(grade({ bullets: 3 }, '- red\n- green\n- blue').length === 0, 'three bullets');
  ok(/2 bullets/.test(grade({ bullets: 3 }, '- red\n- green')[0] || ''), 'two is not three');
  ok(/6 words/.test(grade({ maxWords: 5 }, 'the answer is three hundred ninety-one')[0] || ''), 'a word limit');
}

/* The stand-in API: answers by engine, records what it was sent. */
const answers = { 'good': { arithmetic: '391', json: '{"ok": true}' }, 'worse': { arithmetic: '392', json: '{"ok": true}' } };
const seen = [];
const server = createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    const b = JSON.parse(body || '{}');
    seen.push({ auth: req.headers.authorization, model: b.model, stream: b.stream, url: req.url });
    const q = String(b.messages && b.messages[0] && b.messages[0].content || '');
    const kind = /17/.test(q) ? 'arithmetic' : 'json';
    const text = (answers[b.model] || {})[kind] || '';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } }) + '\n\n'
          + 'data: ' + JSON.stringify({ type: 'message_delta', usage: { output_tokens: 3 } }) + '\n\n');
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const API = 'http://127.0.0.1:' + server.address().port;
mkdirSync(join(__dir, '.build'), { recursive: true });
const casesFile = join(__dir, '.build', 'evals.cases.json');
writeFileSync(casesFile, JSON.stringify({ cases: [
  { id: 'arithmetic', ask: 'What is 17 times 23?', mustMatch: ['\\b391\\b'] },
  { id: 'json', ask: 'Reply with JSON', json: true },
] }));
const run = (extra, env) => new Promise((resolve) => {
  const p = spawn(process.execPath, [join(ROOT, 'tools', 'evals.mjs'), '--api', API, '--cases', casesFile, ...extra],
    { env: Object.assign({ PATH: process.env.PATH }, env) });
  let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  p.on('close', (code) => resolve({ code, out }));
});
const KEY = 'amv_sk_test_' + 'k'.repeat(30);

section('A run passes above the bar and fails below it');
{
  const a = await run(['--engine', 'good', '--min', '1'], { AMV_API_KEY: KEY });
  ok(a.code === 0 && /2 of 2/.test(a.out), 'every case right: passes', a.out);
  const b = await run(['--engine', 'worse', '--min', '1'], { AMV_API_KEY: KEY });
  ok(b.code === 1 && /✗ worse  arithmetic  - missing/.test(b.out), 'one wrong: fails, naming the case and the check', b.out);
  ok(seen.every(s => s.auth === 'Bearer ' + KEY && s.stream === true && s.url === '/v1/messages'), 'through the streaming API, the key only as the bearer token', seen.slice(0, 2));
}

section('The canary fails when the new engine loses what the old one did');
{
  const c = await run(['--engine', 'good', '--compare', 'worse', '--min', '0'], { AMV_API_KEY: KEY });
  ok(c.code === 1 && /fails what good passes - arithmetic/.test(c.out) && /Do not switch/.test(c.out), 'a lost case stops the switch, by name', c.out);
  const d = await run(['--engine', 'worse', '--compare', 'good', '--min', '0'], { AMV_API_KEY: KEY });
  ok(d.code === 0 && /nothing worse does is lost/.test(d.out), 'and a better engine passes', d.out);
}

section('No key, no run - and never one from the command line');
{
  const n = seen.length;
  const e = await run(['--engine', 'good'], {});
  ok(e.code === 2 && /from the environment/.test(e.out) && seen.length === n, 'asked for in the environment, nothing sent', e.out);
}

server.close();
if (report('an-eval-grades-what-it-says') > 0) process.exitCode = 1;
done();
