/* THE BOX THAT ASKED FOR PASSWORDS WAS ALREADY THERE.

   The ask was for a box on every Crew job where somebody "puts account details
   passwords etc so AMV can act". That box already existed - every job with an
   `asks` prompt writes what you type into the job's detail, and that detail is
   POSTed to the server, stored in KV against the job, and handed to the model
   on every run for as long as the job is on.

   So the dangerous half was built and the safe half was not. Nothing stopped
   anybody pasting a bank password into it, and if they had, it would have been
   persisted server-side and re-transmitted every morning in plain text.

   The right version of what was asked for is not a nicer box: it is connecting
   the account, or doing everything up to the credential and handing that step
   back. So this refuses, and this file checks the refusal is real on both
   sides - because a client-side check is a suggestion.

   It also checks the refusal is NARROW. "Reset my password on the supplier
   site" is an instruction and has to go through; a guard that blocks ordinary
   requests gets switched off, and then it guards nothing. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFile } from 'node:fs/promises';

const app = await bootApp({ tab: 'chat', user: { name: 'Adrian', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());

const CREDENTIALS = [
  ['my Point72 login password: Sk8rboi!99',            'a password'],
  ['the pin is 4471',                                   'a PIN or passcode'],
  ['card 4111 1111 1111 1111, expires 12/28',           'a card number'],
  ['cvv: 342',                                          'a card security code'],
  ['api_key = sk-ant-abcdefghijklmnop12345',            'an API key or token'],
  ['sort code: 20-00-00 and account number: 12345678',  'bank account details'],
  ['-----BEGIN RSA PRIVATE KEY-----',                   'a private key'],
  ['SSN: 123-45-6789',                                  'a national ID number'],
  ['Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6','an authorization header'],
  ['my one-time code is 884213',                        'a one-time code'],
];

const ORDINARY = [
  'Reset my password on the supplier site if it has expired',
  'Check my Tesco account for offers each morning',
  'My order number is 1234567890123456 - chase it if it has not shipped',
  'Log into the portal and tell me what is overdue',
  'Ask them for the routing number if they need one',
  'Every morning, summarise my unread email',
  'Watch for a security code arriving and tell me it came',
  'Find me a pin board of ideas for the kitchen',
];

section('Every kind of credential is recognised');
{
  const r = await page.evaluate((cases) => cases.map(([t, want]) => ({ t, want, got: findSecrets(t) })), CREDENTIALS);
  const missed = r.filter(x => !x.got.includes(x.want));
  ok(missed.length === 0, 'all ten kinds are caught',
     missed.map(x => JSON.stringify(x.t) + ' -> ' + JSON.stringify(x.got)).join(' | '));
}

section('And an ordinary instruction is left alone');
{
  /* The half that decides whether this guard survives contact with users. */
  const r = await page.evaluate((cases) => cases.map(t => ({ t, got: findSecrets(t) })), ORDINARY);
  const wrong = r.filter(x => x.got.length);
  ok(wrong.length === 0, 'nothing normal is refused',
     wrong.map(x => JSON.stringify(x.t) + ' -> ' + JSON.stringify(x.got)).join(' | '));
}

section('Nothing credential-shaped is ever sent to the server');
{
  /* _scheduleTask is the one place every standing instruction passes through.
     Driving it is the point: a check that exists but is not on the path is the
     failure this whole file is about. */
  const r = await page.evaluate(async () => {
    /* Connected on purpose. With no backend _autoApi refuses before it
       fetches, so this would pass whether the guard existed or not. */
    AMV_API.base = 'https://stub.amv.dev';
    saveStr('amv_api_token', 'test-token');
    saveStr('amv_api_token_origin', 'https://stub.amv.dev');
    let posted = null;
    const realFetch = window.fetch;
    window.fetch = function(u, o){ posted = { u: String(u), body: o && o.body }; return realFetch.apply(this, arguments); };
    let out;
    try{
      out = await _scheduleTask({ detail: 'Every morning log into my bank. password: hunter2xyz', repeat: 'daily' });
    } finally { window.fetch = realFetch; }
    return { out, posted, modal: !!document.querySelector('#ovr .ov') };
  });
  ok(r.out === null, 'the job is not created', JSON.stringify(r.out));
  ok(r.posted === null, 'and no request left the browser at all', JSON.stringify(r.posted));
  ok(r.modal, 'the person is told why, in a dialog rather than a toast that vanishes');
}

section('The dialog says what to do instead, and does not repeat the secret');
{
  const t = await page.evaluate(() => {
    const el = document.querySelector('#ovr .ov');
    const txt = el ? el.textContent : '';
    document.getElementById('ovr').innerHTML = '';
    return txt;
  });
  ok(/a password/.test(t), 'it names the kind that was found', t.slice(0, 80));
  ok(!/hunter2xyz/.test(t), 'and never shows the credential back');
  ok(/Nothing was saved/i.test(t), 'it says plainly that nothing was stored');
  ok(/connect the account/i.test(t), 'and points at connecting the account instead');
}

section('A normal instruction still schedules');
{
  const r = await page.evaluate(async () => {
    /* _autoApi refuses before it fetches when no backend is configured, so a
       fetch spy alone would report "never reached the server" for both the
       refused job and the ordinary one - and pass while the guard blocked
       everything. Give it a backend and a token so the request is really made. */
    AMV_API.base = 'https://stub.amv.dev';
    saveStr('amv_api_token', 'test-token');
    saveStr('amv_api_token_origin', 'https://stub.amv.dev');
    let reached = false;
    const realFetch = window.fetch;
    window.fetch = function(u){ if(String(u).includes('/auto/create')) reached = true; return Promise.reject(new Error('stopped here on purpose')); };
    try{ await _scheduleTask({ detail: 'Every morning, summarise my unread email', repeat: 'daily' }); }
    catch(_){}
    finally{ window.fetch = realFetch; }
    return reached;
  });
  ok(r, 'an ordinary job still reaches the server');
}

section('Turning a job on does not write a credential to the device first');
{
  /* The order matters. _cwToggleReal used to save the answer into localStorage
     and then call _scheduleTask, so refusing at the network was a refusal that
     had already made a second copy. */
  const r = await page.evaluate(async () => {
    saveStr('amv_plan', 'pro');
    const jobs = _cwJobs();
    const j = jobs.find(x => x.id === 'weather_day');
    /* Answer the ask with a credential, without a human. */
    const real = window.showTextPromptAsync;
    window.showTextPromptAsync = async () => 'Leeds LS6. my council login password: Sk8rboi!99';
    let created = null;
    const realSched = window._scheduleTask;
    window._scheduleTask = async (t) => { created = t; return { id: 'x' }; };
    try{ await _cwToggleReal(jobs, Object.assign({}, j, { on: false })); }
    catch(_e){}
    finally{ window.showTextPromptAsync = real; window._scheduleTask = realSched; }
    const saved = JSON.stringify(_cwJobs());
    document.getElementById('ovr').innerHTML = '';
    return { created, leaked: /Sk8rboi/.test(saved) };
  });
  ok(r.created === null, 'the job is never scheduled', JSON.stringify(r.created));
  ok(!r.leaked, 'and the credential is not saved to this device either');
}

section('The server refuses it too, because a client check is a suggestion');
{
  const worker = await readFile(new URL('../../amv-backend.js', import.meta.url), 'utf8');
  ok(/function _detailSecrets\(/.test(worker), 'the worker has its own detector');
  const create = worker.slice(worker.indexOf('async function autoCreate('), worker.indexOf('async function autoCreate(') + 3000);
  ok(/_detailSecrets\(detail\)/.test(create) && /credentials_in_detail/.test(create),
     'and /auto/create refuses before anything is written');
  /* Edit writes to the same field. A guard only on create is not a guard. */
  const edit = worker.slice(worker.indexOf("body.action === 'edit'"), worker.indexOf("body.action === 'edit'") + 1500);
  ok(/_detailSecrets\(detail\)/.test(edit) && /credentials_in_detail/.test(edit),
     'and so does the edit path, which writes to the same field');
  /* A rejection that quotes the secret back has stored it in a log. */
  ok(!/kinds:_sec[\s\S]{0,80}detail\b(?!s)/.test(create) || !/message:.*\+\s*detail/.test(create),
     'the refusal never echoes the text it refused');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
