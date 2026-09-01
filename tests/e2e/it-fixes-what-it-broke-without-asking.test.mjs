/* THE LOOP, RUN FOR REAL: BREAK, RUN, READ, FIX, RUN AGAIN.

   A build turn used to be one question and one answer. That is the right
   shape for "write me this file" and the wrong shape for what people actually
   want from a build tool, because real work is a loop and every step of it
   depends on the result of the step before. "Make the tests pass" cannot be
   written down in advance.

   So this drives the loop end to end with almost nothing faked. A REAL bridge
   daemon runs on a REAL temporary folder with a REAL bug in it. The commands
   really execute; the test really fails; the file is really rewritten; the
   test really passes afterwards. The only stub is the model, which is the one
   thing genuinely outside AMV - and it is stubbed as a script of tool calls,
   not as an oracle, so nothing here can pass by the browser agreeing with
   itself.

   What that arrangement is able to catch, and a mocked one is not:
     · that consent is asked ONCE and the turn then runs to the end, rather
       than stopping for permission between every command;
     · that a failing command comes back as information the next round reads,
       instead of ending the turn;
     · that the changelist is measured from the disk;
     · that Undo puts the real bytes back and removes the file the turn
       created, rather than leaving an empty one behind;
     · that Stop lands on the next step rather than at the end.

   The bug the file starts with is a multiply where an add belongs, so the
   fix has to be the right one: the check script is the judge, and it is run
   by the bridge, not by this test. */
import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* A project with a real bug: sum multiplies. check.js is the judge. */
const proj = mkdtempSync(join(tmpdir(), 'amv-agent-'));
writeFileSync(join(proj, 'sum.js'), 'module.exports = (a, b) => a * b;\n');
writeFileSync(join(proj, 'check.js'),
  "const sum = require('./sum');\n"
+ "const got = sum(2, 3);\n"
+ "if (got !== 5) { console.error('expected 5, got ' + got); process.exit(1); }\n"
+ "console.log('all good');\n");

const bridge = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), proj], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: Object.assign({}, process.env, { AMV_BRIDGE_DEV: '1' }),
});
/* KILLED WHETHER OR NOT THIS FILE REACHES ITS LAST LINE.

   The tidy-up at the bottom only runs when everything above it passed. Every
   failing run of this file - and there were several while it was being
   written - left a daemon listening on a port, holding a temp folder, able to
   run shell commands, for as long as the machine stayed up. Four of them were
   still there an hour later.

   That is a bad thing for any test to leak and a much worse thing for THIS
   one, which exists precisely because a program that executes commands must
   be bounded. A suite that argues for careful lifecycles and then abandons
   its own subject is not making the argument it thinks it is - and in CI it
   would hold a runner open past the end of the job. */
let banner = '';
bridge.stdout.on('data', b => { banner += b.toString(); });
bridge.stderr.on('data', b => { banner += b.toString(); });
const killBridge = () => { try { bridge.kill('SIGKILL'); } catch (e) {} };
process.on('exit', killBridge);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { killBridge(); process.exit(1); });
}
process.on('uncaughtException', (e) => { killBridge(); throw e; });
const waitFor = async (re, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const m = banner.match(re);
    if (m) return m;
    await new Promise(r => setTimeout(r, 60));
  }
  return null;
};
const PORT = (await waitFor(/Port\s+(\d+)/, 8000) || [])[1] || '0';
const CODE = (await waitFor(/([0-9A-F]{4}(?:-[0-9A-F]{4}){5})/, 8000) || [])[1] || '';

const FIXED = 'module.exports = (a, b) => a + b;\n';

/* The model, as a SCRIPT of turns rather than an oracle. Each entry is what
   it does next; the results it reads back are whatever really happened. */
function turns() {
  return [
    { text: 'Let me run the check first.',
      tool: { name: 'run_command', input: { command: 'node check.js' } } },
    { text: 'It fails. Reading the file.',
      tool: { name: 'read_file', input: { path: 'sum.js' } } },
    { text: 'It multiplies where it should add. Fixing it.',
      tool: { name: 'write_file', input: { path: 'sum.js', content: FIXED } } },
    { text: 'Adding a note about it.',
      tool: { name: 'write_file', input: { path: 'notes/fix.md', content: '# Fixed\nsum used to multiply.\n' } } },
    { text: 'Running the check again.',
      tool: { name: 'run_command', input: { command: 'node check.js' } } },
    { text: 'The check passes now: sum(2, 3) is 5. I changed one operator and left a note.' },
  ];
}

const A = await bootApp({ tab: 'chat' });
const { page } = A;
await A.connect();
await page.evaluate(() => {
  /* The consent banner overlays the composer and swallows clicks meant for
     the Stop button. Not what this file is about; it has its own suite. */
  document.getElementById('cookie-consent-banner')?.remove();
  setTab('dev');
});
await page.waitForSelector('#dev-msg', { timeout: 8000 });

/* One stub, for the model only. Everything to the bridge goes to the real
   daemon on loopback - which is the whole point of this file. */
async function armModel(script) {
  await page.evaluate((s) => {
    window.__real = window.__real || window.fetch;
    window.__script = s;
    window.__turn = 0;
    window.__asked = [];
    window.fetch = async (u, o) => {
      const url = String(u && u.url ? u.url : u);
      if (/127\.0\.0\.1|localhost/.test(url)) return window.__real(u, o);
      if (!/\/v1\/messages/.test(url)) return window.__real(u, o);
      window.__asked.push(JSON.parse(o.body));
      const t = window.__script[Math.min(window.__turn, window.__script.length - 1)];
      window.__turn++;
      const ev = [];
      ev.push('data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 9 } } }) + '\n\n');
      ev.push('data: ' + JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + '\n\n');
      ev.push('data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t.text } }) + '\n\n');
      if (t.tool) {
        ev.push('data: ' + JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu' + window.__turn, name: t.tool.name } }) + '\n\n');
        ev.push('data: ' + JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(t.tool.input) } }) + '\n\n');
      }
      ev.push('data: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: t.tool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 20 } }) + '\n\n');
      ev.push('data: {"type":"message_stop"}\n\n');
      return new Response(ev.join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
  }, script);
}

section('The computer is connected, for real, over loopback');
{
  ok(Number(PORT) > 0 && !!CODE, 'the bridge started and printed a code', PORT);
  const r = await page.evaluate(async ([port, code]) => {
    const hi = await _bridgeHello(port);
    if (!hi) return { hello: false };
    await _bridgePair(port, code);
    return { hello: true, connected: BRIDGE.connected, folder: BRIDGE.folder };
  }, [PORT, CODE]);
  ok(r.hello === true, 'the page found it', r.hello);
  ok(r.connected === true, 'and paired with it', r.connected);
  ok(await page.evaluate(() => _agentReady()) === true,
     'so Build knows it has a machine to work on', true);
}

section('It asks once, and it asks before anything happens');
{
  await armModel(turns());
  await page.evaluate(() => { const t = document.getElementById('dev-msg'); t.value = 'make the check pass'; _devSend(); });
  await page.waitForSelector('#modal-ok', { timeout: 6000 });
  const m = await page.evaluate(() => ({
    title: document.querySelector('#modal-box h2')?.textContent || '',
    body: document.querySelector('#modal-box .ob-sub')?.textContent || '',
    ok: document.getElementById('modal-ok')?.textContent || '',
    cancel: document.getElementById('modal-cancel')?.textContent || '',
  }));
  ok(/work in/i.test(m.title), 'it asks before touching anything', m.title);
  ok(m.body.includes(await page.evaluate(() => BRIDGE.folder)),
     'naming the folder it will work in', m.body.slice(0, 60));
  ok(/running commands/i.test(m.body), 'and saying it will run commands', /running commands/i.test(m.body));
  ok(/stop it/i.test(m.body), 'and that it can be stopped', /stop it/i.test(m.body));
  ok(!!m.cancel, 'with a way to say no', m.cancel);

  /* Nothing has run yet: the file on disk is still broken. */
  ok(readFileSync(join(proj, 'sum.js'), 'utf8').includes('a * b'),
     'and nothing has been run or changed while it waits', true);
}

section('Then it works by itself until the check passes');
{
  const t0 = Date.now();
  await page.click('#modal-ok');
  await page.waitForFunction(() => !_AGENT.running && _DEV.log.some(m => m.steps && m.steps.length >= 5),
                             null, { timeout: 30000 });

  /* THE THING THIS FILE EXISTS FOR: it was asked once and it ran five steps. */
  const asked = await page.evaluate(() => document.querySelectorAll('#modal-ok').length);
  ok(asked === 0, 'it never stopped to ask again', asked);

  const st = await page.evaluate(() => {
    const m = _DEV.log.filter(x => x.steps && x.steps.length).pop();
    return { steps: m.steps.map(s => ({ n: s.name, ok: s.ok, code: s.exitCode })),
             why: m.why, text: m.text };
  });
  ok(st.steps.length === 5, 'it took five steps on its own', st.steps.length);
  ok(st.steps[0].n === 'run_command' && st.steps[0].ok === false && st.steps[0].code === 1,
     'the first run really failed, with the real exit code', st.steps[0]);
  ok(st.steps[4].n === 'run_command' && st.steps[4].ok === true && st.steps[4].code === 0,
     'and the last run really passed', st.steps[4]);
  ok(st.why === 'done', 'it finished rather than hitting a limit', st.why);

  /* Judged by the disk, not by the transcript. */
  ok(readFileSync(join(proj, 'sum.js'), 'utf8') === FIXED,
     'the file on disk is genuinely fixed', readFileSync(join(proj, 'sum.js'), 'utf8').trim());
  ok(existsSync(join(proj, 'notes', 'fix.md')),
     'and a file it created is really there, in a folder it had to make', true);
  ok(Date.now() - t0 < 40000, 'inside a sensible time', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}

section('The failing output was information, not the end of the turn');
{
  /* The round after the failure has to have been given what broke. If a
     failed command ends the turn - or comes back empty - the loop cannot
     work, and it would still look like it did from the outside. */
  const sawError = await page.evaluate(() => {
    for (const body of window.__asked) {
      for (const m of body.messages || []) {
        if (!Array.isArray(m.content)) continue;
        for (const c of m.content) {
          if (c.type === 'tool_result' && /expected 5, got 6/.test(String(c.content || ''))) return true;
        }
      }
    }
    return false;
  });
  ok(sawError === true, 'the real error text was handed back to the next round', sawError);

  const marked = await page.evaluate(() => {
    for (const body of window.__asked) {
      for (const m of body.messages || []) {
        if (!Array.isArray(m.content)) continue;
        for (const c of m.content) if (c.type === 'tool_result' && c.is_error) return true;
      }
    }
    return false;
  });
  ok(marked === true, 'and marked as a failure rather than passed off as a result', marked);
}

section('The screen shows what it did, in the words somebody would use');
{
  const ui = await page.evaluate(() => {
    const el = document.querySelector('.ags');
    return { there: !!el,
             head: el?.querySelector('.ags-h')?.textContent || '',
             sum: el?.querySelector('.ags-sum')?.textContent || '',
             steps: [...(el?.querySelectorAll('.ags-step') || [])].map(s => s.textContent.trim()),
             bad: (el?.querySelectorAll('.ags-bad') || []).length };
  });
  ok(ui.there === true, 'the run is shown as a list of steps', ui.there);
  ok(ui.steps.length === 5, 'one line per step', ui.steps.length);
  ok(/node check\.js/.test(ui.steps[0]), 'naming the command actually run', ui.steps[0]);
  ok(ui.bad === 1, 'and the one that failed is marked as failed', ui.bad);
  ok(/command/.test(ui.sum) && /written/.test(ui.sum),
     'with a summary in plain words', ui.sum);
}

section('And a changelist measured from the disk, with a real Undo');
{
  const card = await page.evaluate(() => {
    const m = _DEV.log.filter(x => x.changes).pop();
    return { rows: m.changes, id: m.chgId,
             head: document.querySelector('.dvc-n')?.textContent || '' };
  });
  const paths = card.rows.map(r => r.path).sort();
  ok(paths.join(',') === 'notes/fix.md,sum.js', 'both files it wrote are listed', paths);
  const created = card.rows.find(r => r.path === 'notes/fix.md');
  ok(created.kind === 'added', 'the new one is marked as created', created.kind);
  const edited = card.rows.find(r => r.path === 'sum.js');
  ok(edited.kind === 'edited' && edited.add === 1 && edited.del === 1,
     'and the edit is measured, one line for one line', edited);

  await page.evaluate((id) => _devToggleTurn(id), card.id);
  await page.waitForFunction((id) => _DEVCHG.turns[id].undone === true, card.id, { timeout: 15000 });

  ok(readFileSync(join(proj, 'sum.js'), 'utf8') === 'module.exports = (a, b) => a * b;\n',
     'Undo really put the old bytes back on disk', readFileSync(join(proj, 'sum.js'), 'utf8').trim());
  ok(!existsSync(join(proj, 'notes', 'fix.md')),
     'and REMOVED the file the turn created, rather than leaving an empty one', true);

  await page.evaluate((id) => _devToggleTurn(id), card.id);
  await page.waitForFunction((id) => _DEVCHG.turns[id].undone === false, card.id, { timeout: 15000 });
  ok(readFileSync(join(proj, 'sum.js'), 'utf8') === FIXED, 'and Redo puts the fix back', true);
  ok(existsSync(join(proj, 'notes', 'fix.md')), 'including the created file', true);
}

section('Saying no means nothing runs');
{
  const before = readFileSync(join(proj, 'sum.js'), 'utf8');
  await armModel(turns());
  await page.evaluate(() => { const t = document.getElementById('dev-msg'); t.value = 'break everything'; _devSend(); });
  await page.waitForSelector('#modal-cancel', { timeout: 6000 });
  await page.click('#modal-cancel');
  await page.waitForFunction(() => _DEV.log.some(m => /Left it alone/.test(m.text || '')), null, { timeout: 8000 });
  const calls = await page.evaluate(() => window.__asked.length);
  ok(calls === 0, 'the engine was never asked, so it cost nothing', calls);
  ok(readFileSync(join(proj, 'sum.js'), 'utf8') === before, 'and the folder is untouched', true);
}

section('Stop lands on the next step, not at the end');
{
  /* A long script, stopped after the first command. What matters is that it
     stops EARLY - a Stop that takes effect once the work is over is a label. */
  const many = [];
  for (let i = 0; i < 12; i++) {
    many.push({ text: 'step ' + i, tool: { name: 'run_command', input: { command: 'node -e "console.log(' + i + ')"' } } });
  }
  many.push({ text: 'finished' });
  await armModel(many);
  await page.evaluate(() => { const t = document.getElementById('dev-msg'); t.value = 'do twelve things'; _devSend(); });
  await page.waitForSelector('#modal-ok', { timeout: 6000 });
  await page.click('#modal-ok');
  await page.waitForFunction(() => _AGENT.running === true, null, { timeout: 8000 });

  const stopVisible = await page.evaluate(() => {
    const s = document.getElementById('dev-stop'), b = document.getElementById('dev-send');
    return { stop: !!s && !s.hidden && s.getBoundingClientRect().width > 0,
             send: !!b && b.getBoundingClientRect().width === 0 };
  });
  ok(stopVisible.stop === true, 'a Stop button is really on the screen while it runs', stopVisible.stop);
  ok(stopVisible.send === true, 'and it has replaced Build rather than sitting beside it', stopVisible.send);

  /* Hiding a focused element drops focus to the body, so somebody who started
     this from the keyboard would have to hunt for the one control that
     matters for the next minute. */
  const focus = await page.evaluate(() => {
    const send = document.getElementById('dev-send');
    const stop = document.getElementById('dev-stop');
    /* As it is the instant before a turn starts: visible and enabled, with
       focus left on it by the Enter that started this. `_devBusy` disables it
       once a turn is under way, and a disabled button cannot hold focus - so
       reproducing the moment means undoing that first. */
    send.hidden = false; send.disabled = false; send.focus();
    const was = document.activeElement === send;
    _agentSetRunning(true);
    return { was, now: document.activeElement === stop, id: document.activeElement.id };
  });
  ok(focus.was === true, 'focus starts on Build, where pressing Enter left it', focus.was);
  ok(focus.now === true,
     'and moves to Stop rather than being dropped on the body', focus.id || '(body)');

  await page.waitForFunction(() => {
    const m = _DEV.log.filter(x => x.steps && x.steps.length).pop();
    return m && m.steps.length >= 1;
  }, null, { timeout: 15000 });
  await page.click('#dev-stop');
  await page.waitForFunction(() => _AGENT.running === false, null, { timeout: 20000 });

  const after = await page.evaluate(() => {
    const m = _DEV.log.filter(x => x.steps && x.steps.length).pop();
    return { n: m.steps.length, why: m.why, why_text: document.querySelector('.ags-why')?.textContent || '' };
  });
  ok(after.n < 12, 'it stopped well before the twelve steps it was given', after.n);
  ok(after.why === 'stopped', 'and says it was stopped', after.why);
  ok(/unfinished/i.test(after.why_text),
     'in words that do not present an unfinished job as a finished one', after.why_text.slice(0, 70));
}

section('The next turn remembers what the last one actually did');
{
  /* A turn that worked on the machine ends with a summary and a list of
     steps. Carrying only the summary forward means the next turn cannot
     answer "why did that fail?" - the commands, their exit codes and the
     files touched were all in memory and none of it travelled. */
  await armModel([{ text: 'Nothing to do.' }]);
  await page.evaluate(() => { document.getElementById('dev-msg').value = 'why did that fail earlier?'; _devSend(); });
  await page.waitForSelector('#modal-ok', { timeout: 6000 });
  await page.click('#modal-ok');
  await page.waitForFunction(() => _AGENT.running === false && window.__asked.length > 0,
                             null, { timeout: 20000 });

  const prompt = await page.evaluate(() => {
    const first = window.__asked[0];
    const m = (first.messages || [])[0];
    return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
  });
  ok(/on the machine:/.test(prompt),
     'the steps from the earlier turn travel with the conversation', /on the machine:/.test(prompt));
  ok(/node check\.js/.test(prompt), 'naming the command it ran', /node check\.js/.test(prompt));
  ok(/exit 1/.test(prompt),
     'and the exit code, which is the part the question is about', /exit 1/.test(prompt));
  ok(/wrote sum\.js/.test(prompt), 'and what it changed', /wrote sum\.js/.test(prompt));
}

section('A file written twice in one turn is still a file that was created');
{
  /* The turn's own first write must not become the "before" for its second.
     If it does, the card calls a new file an edit and Undo leaves it behind
     holding an intermediate version - which looks like undo working. */
  await armModel([
    { text: 'Writing it.',
      tool: { name: 'write_file', input: { path: 'twice.txt', content: 'first\n' } } },
    { text: 'Thought of something better.',
      tool: { name: 'write_file', input: { path: 'twice.txt', content: 'second\n' } } },
    { text: 'Done.' },
  ]);
  await page.evaluate(() => { document.getElementById('dev-msg').value = 'write it twice'; _devSend(); });
  await page.waitForSelector('#modal-ok', { timeout: 6000 });
  await page.click('#modal-ok');
  await page.waitForFunction(() => _AGENT.running === false && _DEV.log.some(m => m.changes && m.changes.some(r => r.path === 'twice.txt')),
                             null, { timeout: 25000 });

  ok(readFileSync(join(proj, 'twice.txt'), 'utf8') === 'second\n',
     'the second write is what is on disk', true);
  const card = await page.evaluate(() => {
    const m = _DEV.log.filter(x => x.changes && x.changes.some(r => r.path === 'twice.txt')).pop();
    return { row: m.changes.find(r => r.path === 'twice.txt'), id: m.chgId };
  });
  ok(card.row.kind === 'added',
     'and it is listed as created, not as an edit of its own first draft', card.row);

  await page.evaluate((id) => _devToggleTurn(id), card.id);
  await page.waitForFunction((id) => _DEVCHG.turns[id].undone === true, card.id, { timeout: 15000 });
  ok(!existsSync(join(proj, 'twice.txt')),
     'so Undo removes it rather than leaving the intermediate version behind', true);
}

section('No JavaScript errors');
{
  ok(A.errors.length === 0, 'zero uncaught page errors', A.errors.slice(0, 3));
}

killBridge();
await A.close();
if (report('it-fixes-what-it-broke-without-asking') > 0) process.exitCode = 1;
done();
