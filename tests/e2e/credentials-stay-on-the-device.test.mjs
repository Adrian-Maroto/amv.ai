/* A CONNECTED FOLDER IS SOMEBODY'S PROJECT FOLDER.

   Grant one and AMV reads every text file in it, four levels deep, and hands
   the contents to the engine as task context. `.env` was skipped, but only
   because the reader skips names beginning with a dot - `prod.env`,
   `staging.env`, `credentials.json`, `secrets.yaml` and a stray `.pem` were
   read like any other file and sent. `env` is on the readable-extensions list
   explicitly, and is absent from the equivalent list for uploads, which is what
   an unconsidered line looks like.

   Nobody connecting a project folder is thinking about the keys sitting in it,
   and the file list they are shown is forty names in a small box.

   Contents that look like credentials now stay on the device. Not hidden: the
   file is still in the workspace, still listed, the model is TOLD it exists and
   was withheld so it neither invents the contents nor reports work it could not
   do, and one tap sends it anyway when the task really is "fix my env file". */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

const KEYS = 'API_KEY=sk-liveAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\nDB_PASSWORD=hunter2hunter2hunter2\n';

/* Load a set of files the way a connected folder would, then ask what the
   engine would actually be sent. */
async function context(files) {
  return page.evaluate((files) => {
    AMVWorkspace.clear();
    files.forEach(f => AMVWorkspace.files.push({
      name: f.path.split('/').pop(), path: f.path, handle: null, type: 'text/plain',
      size: f.text.length, isText: true, text: f.text, dirty: false,
      secret: _wsLooksSecret(f.path, f.text),
    }));
    return { ctx: AMVWorkspace.contextText(),
             held: AMVWorkspace.withheld().map(f => f.path),
             flags: AMVWorkspace.files.map(f => ({ p: f.path, s: f.secret })) };
  }, files);
}

section('A credentials file is named but its contents are not sent');
{
  const r = await context([
    { path: 'src/main.js', text: 'export const go = () => 1;' },
    { path: 'prod.env', text: KEYS },
  ]);
  ok(!/sk-liveAAAA/.test(r.ctx), 'the key does not leave the device', r.ctx.slice(0, 240));
  ok(!/hunter2/.test(r.ctx), 'nor does the database password', !/hunter2/.test(r.ctx));
  ok(/prod\.env/.test(r.ctx), 'the file is still named, so nothing is hidden', true);
  ok(/withheld/i.test(r.ctx), 'and marked as withheld', (r.ctx.match(/.*withheld.*/) || [''])[0]);
  ok(/export const go/.test(r.ctx), 'while the ordinary file is sent in full', true);
  ok(r.held.includes('prod.env'), 'the workspace knows which one it held', r.held);
}

section('The model is told, rather than left to guess');
{
  /* Silently dropping a file is its own failure: the model invents the
     contents, or reports a step complete that it could not do. */
  const r = await context([{ path: 'prod.env', text: KEYS }]);
  ok(/NOT sent/.test(r.ctx), 'the omission is stated', (r.ctx.match(/NOTE:.*/) || [''])[0]);
  ok(/say plainly if a step needs one/i.test(r.ctx), 'with what to do about it', true);
  ok(/Do not guess/i.test(r.ctx), 'and an instruction not to invent it', true);
}

section('It catches the files people actually have');
{
  const r = await context([
    { path: 'prod.env', text: 'X=1' },
    { path: 'config/credentials.json', text: '{"a":1}' },
    { path: 'secrets.yaml', text: 'a: 1' },
    { path: 'deploy/server.pem', text: 'x' },
    { path: 'infra/main.tfvars', text: 'x' },
    { path: 'keys/id_rsa', text: 'x' },
    { path: 'gcp-service-account.json', text: '{}' },
  ]);
  const missed = r.flags.filter(f => !f.s).map(f => f.p);
  ok(missed.length === 0, 'every one of them is recognised by name', missed);
}

section('And the ones that only look like credentials from the inside');
{
  const r = await context([
    { path: 'notes.txt', text: 'here is my key\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n' },
    { path: 'setup.md', text: 'AWS uses AKIAIOSFODNN7EXAMPLE for this\n' },
    { path: 'dump.log', text: 'token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U\n' },
    { path: 'config.txt', text: 'SERVICE_TOKEN=abcdefghijklmnopqrstuvwx\nOTHER_TOKEN=zyxwvutsrqponmlkjihgfed\n' },
  ]);
  const missed = r.flags.filter(f => !f.s).map(f => f.p);
  ok(missed.length === 0, 'a private key, an AWS id, a JWT and a pile of assignments', missed);
}

section('An article about API keys is not a credentials file');
{
  /* Held-back-by-default is only tolerable if it is rarely wrong. Matching the
     WORD "key" or "password" would hold back half a codebase. */
  const r = await context([
    { path: 'docs/security.md', text: 'Never commit your API key or password to the repository. Rotate keys quarterly. Store secrets in a vault.' },
    { path: 'src/auth.js', text: 'const token = await getToken(); // the session token\nexport function apiKeyHeader(k){ return { Authorization: "Bearer " + k }; }' },
    { path: 'README.md', text: 'Set API_KEY=your-key-here before running.' },
    { path: 'data.csv', text: 'name,email\nA,a@x.com\n' },
  ]);
  const wrong = r.flags.filter(f => f.s).map(f => f.p);
  ok(wrong.length === 0, 'none of these are held back', wrong);
  ok(/Never commit your API key/.test(r.ctx), 'and the documentation is sent as normal', true);
}

section('One placeholder assignment is a README, not a secret');
{
  const r = await context([{ path: 'example.txt', text: 'API_KEY=replace-me-with-your-key\nSome prose after it.\n' }]);
  ok(r.held.length === 0, 'a single assignment does not trip it', r.held);
}

section('Sending one is the person’s decision, and it works');
{
  const r = await page.evaluate((keys) => {
    AMVWorkspace.clear();
    AMVWorkspace.files.push({ name: 'prod.env', path: 'prod.env', type: 'text/plain',
      size: keys.length, isText: true, text: keys, secret: 'name' });
    const before = AMVWorkspace.contextText();
    AMVWorkspace.allowSecret('prod.env', true);
    const after = AMVWorkspace.contextText();
    AMVWorkspace.allowSecret('prod.env', false);
    return { before, after, backAgain: AMVWorkspace.contextText(), held: AMVWorkspace.withheld().length };
  }, KEYS);
  ok(!/sk-liveAAAA/.test(r.before), 'held back until asked', true);
  ok(/sk-liveAAAA/.test(r.after), 'sent once the person says so', true);
  ok(!/sk-liveAAAA/.test(r.backAgain), 'and held again when they change their mind', true);
  ok(r.held === 1, 'the count follows', r.held);
}

section('An upload is treated exactly like a folder file');
{
  /* The two readers had different extension lists, which is how this started. */
  const r = await page.evaluate(async () => {
    AMVWorkspace.clear();
    const f = new File(['SECRET_KEY=abcdefghijklmnopqrstuvwxyz012345\nTOKEN=zzzzzzzzzzzzzzzzzzzzzzzzz\n'],
                       'staging.env', { type: 'text/plain' });
    await AMVWorkspace.addUploads([f]);
    return { secret: AMVWorkspace.files[0].secret, ctx: AMVWorkspace.contextText() };
  });
  ok(!!r.secret, 'an uploaded env file is flagged too', r.secret);
  ok(!/abcdefghijklmnop/.test(r.ctx), 'and its contents stay here', true);
}

section('The workspace panel shows what is being held');
{
  const r = await page.evaluate(async () => {
    if (typeof openCowork === 'function') openCowork();
    else if (typeof _openCowork === 'function') _openCowork();
    await new Promise(r => setTimeout(r, 400));
    const f = new File(['A_KEY=abcdefghijklmnopqrstuvwxyz01\nB_KEY=abcdefghijklmnopqrstuvwxyz02\n'],
                       'prod.env', { type: 'text/plain' });
    await AMVWorkspace.addUploads([f]);
    const input = document.getElementById('cw-files');
    if (input) input.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 300));
    const list = document.getElementById('cw-ws-list');
    const note = document.getElementById('cw-ws-note');
    return { list: (list && list.textContent) || '', note: (note && note.textContent) || '',
             btn: !!document.querySelector('[data-ws-allow]') };
  });
  ok(/prod\.env/.test(r.list), 'the file is listed', r.list.slice(0, 120));
  ok(/Held back/.test(r.list), 'marked as held back', r.list.slice(0, 160));
  ok(r.btn, 'with a control to send it anyway', r.btn);
  ok(/credentials/i.test(r.note + r.list), 'and the reason given', (r.note || r.list).slice(0, 160));
}

section('Dev is the same folder through a different door');
{
  /* A Dev project is sent to the engine on every build. Pulling every
     workspace file into it would post exactly what the workspace holds back,
     so the guard has to be on what leaves rather than on one route to it. */
  const r = await page.evaluate((keys) => {
    AMVWorkspace.clear();
    AMVWorkspace.files.push({ name: 'main.js', path: 'main.js', type: 'text/plain',
      size: 10, isText: true, text: 'const a = 1;', secret: '' });
    AMVWorkspace.files.push({ name: 'prod.env', path: 'prod.env', type: 'text/plain',
      size: keys.length, isText: true, text: keys, secret: 'name' });
    return { sends: AMVWorkspace.files.map(f => ({ p: f.path, ok: AMVWorkspace.sends(f) })) };
  }, KEYS);
  const env = r.sends.find(x => x.p === 'prod.env');
  const js = r.sends.find(x => x.p === 'main.js');
  ok(env && env.ok === false, 'the credentials file is not sendable', env);
  ok(js && js.ok === true, 'while the source file is', js);
}

section('A file that BECOMES credentials is caught on write');
{
  /* The flag has to follow the contents, not the state the folder opened in. */
  const r = await page.evaluate(async () => {
    AMVWorkspace.clear();
    await AMVWorkspace.writeFile('notes.txt', 'nothing here yet');
    const before = AMVWorkspace.files[0].secret;
    await AMVWorkspace.writeFile('notes.txt',
      'AAA_TOKEN=abcdefghijklmnopqrstuvwx\nBBB_TOKEN=zyxwvutsrqponmlkjihgfed\n');
    return { before, after: AMVWorkspace.files[0].secret,
             ctx: AMVWorkspace.contextText() };
  });
  ok(!r.before, 'harmless when it was harmless', r.before);
  ok(!!r.after, 'and flagged once it is not', r.after);
  ok(!/abcdefghijklmnop/.test(r.ctx), 'with the new contents held back', true);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('credentials-stay-on-the-device') > 0) process.exitCode = 1;
done();
