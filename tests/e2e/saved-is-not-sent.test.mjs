/* "YOUR FEEDBACK WAS SENT TO THE TEAM" AND NOTHING LEFT THE DEVICE.

   The Help Center's Report a bug / Suggest a feature buttons called
   _submitFeedback, which writes the report into localStorage and transmits it
   only if `amv_feedback_endpoint` is set - a key that no screen anywhere in the
   product can write. There is no server route for it either: /v1/feedback is
   the thumbs up/down counter and deliberately stores no content, so it would
   refuse a bug report with a 400.

   Then, unconditionally and outside any check:

       toast('Thank you - your feedback was sent to the team.')

   Somebody reporting a bug was thanked, told the team had it, and their report
   sat in their own browser for ever.

   Saying so honestly was the first fix and left the real gap: a product taking
   money with no way to be told it is broken. /v1/support is that way now, and
   it answers `stored` and `notified` SEPARATELY, because those are different
   promises. So the cases below are no longer "sent or not" but four states,
   and the invariant this file exists for is unchanged: nothing claims a
   delivery it did not make.

   And while looking: _playDoneChime tests `amv_mute_chime === '1'`, and its own
   comment calls the sound "respectful - muteable". Nothing in the product could
   ever write that key, so the check could not be true and the chime could not
   be turned off. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

/* Open the feedback modal, type something, send, and collect what was said.

   `server` is what /v1/support answers, or null for a device with no backend
   at all - which is a real state (the local demo) and the one where claiming a
   delivery would be most obviously false. */
async function sendFeedback({ supportEmail = '', server = null }) {
  return page.evaluate(async ({ supportEmail, server }) => {
    const said = [];
    const realToast = window.toast, realFetch = window.fetch;
    window.toast = (m) => said.push(String(m));
    saveStr('amv_support_email', supportEmail);
    saveStr('amv_feedback', '[]');

    let postedTo = null, postedBody = '';
    if (server) {
      AMV_API.base = 'https://api.test'; AMV_API.token = 'tok';
      window.fetch = async (u, o) => {
        postedTo = String(u); postedBody = String((o && o.body) || '');
        return { ok: server.status < 400, status: server.status, headers: new Headers(),
                 json: async () => server.body };
      };
    } else {
      /* No backend configured: AMV_API.support refuses before any request. */
      saveStr('amv_api_base', ''); AMV_API.base = '';
    }

    openFeedback('bug');
    await new Promise(r => setTimeout(r, 200));
    document.getElementById('fb-text').value = 'The thing broke when I clicked it.';
    document.getElementById('fb-send').click();
    await new Promise(r => setTimeout(r, 400));
    let stored = [];
    try { stored = JSON.parse(loadStr('amv_feedback') || '[]'); } catch (e) {}
    window.toast = realToast; window.fetch = realFetch;
    return { said, stored: stored.length, text: (stored[0] || {}).text || '', postedTo, postedBody };
  }, { supportEmail, server });
}

section('With no backend at all, it does not say it was sent');
{
  const r = await sendFeedback({});
  ok(r.stored === 1, 'the report is kept on the device', r.stored);
  ok(/broke when I clicked/.test(r.text), 'with what was written', r.text.slice(0, 50));
  ok(!r.said.some(m => /with the team|sent to the team/i.test(m)),
     'and nobody is told the team has it', r.said);
  ok(r.said.some(m => /nobody has seen it|could not be sent/i.test(m)),
     'it says plainly that it is going no further', r.said);
}

section('With a support address, it points at the route that works');
{
  const r = await sendFeedback({ supportEmail: 'help@amv.test' });
  ok(!r.said.some(m => /with the team/i.test(m)), 'still not claimed as delivered', r.said);
  ok(r.said.some(m => /help@amv\.test/.test(m)),
     'and the address that reaches a person is named', r.said);
}

section('When the server takes it AND pages somebody, that is said');
{
  const r = await sendFeedback({ server: { status: 200, body: { ok: true, stored: true, notified: true } } });
  ok(/\/v1\/support$/.test(r.postedTo || ''), 'it really goes to the support route', r.postedTo);
  ok(/broke when I clicked/.test(r.postedBody), 'carrying the report', true);
  ok(r.said.some(m => /with the team/i.test(m)),
     'and only then is a person promised', r.said);
}

section('When the server takes it but pages NOBODY, it says less');
{
  /* The distinction the route exists to make. It is genuinely stored and an
     operator will find it; what cannot be promised is that anybody was told
     tonight. Collapsing these two into one cheerful sentence is the original
     defect wearing a server. */
  const r = await sendFeedback({ supportEmail: 'help@amv.test',
    server: { status: 200, body: { ok: true, stored: true, notified: false } } });
  ok(r.said.some(m => /received/i.test(m)), 'it confirms receipt', r.said);
  ok(!r.said.some(m => /with the team/i.test(m)),
     'without claiming a person has it', r.said);
  ok(r.said.some(m => /help@amv\.test/.test(m)),
     'and offers the address for anything urgent', r.said);
}

section('A server that refuses it is not a delivery');
{
  /* 429 on purpose. A support report is a create that lands in somebody else's
     inbox, so it must not be auto-retried - three deliveries of the same bug
     report, three pages, and the rate limit that exists because reaching a
     human is worth abusing spent on one person clicking once. This case is
     what caught that /v1/support was missing from the noRetry list. */
  const r = await sendFeedback({ supportEmail: 'help@amv.test',
    server: { status: 429, body: { error: 'too many support messages' } } });
  ok(!r.said.some(m => /with the team|received/i.test(m)),
     'a refusal does not count as sent', r.said);
  ok(r.said.some(m => /could not be sent/i.test(m)), 'it says so', r.said);
  ok(r.said.some(m => /help@amv\.test/.test(m)),
     'and names the way that still works', r.said);
  ok(r.stored === 1, 'while the report is still kept', r.stored);
}

section('The completion chime can be switched off');
{
  const r = await page.evaluate(async () => {
    S.settingsPane = 'appearance'; setTab('settings');
    await new Promise(r => setTimeout(r, 500));
    const sw = document.getElementById('chime-sw');
    if (!sw) return { missing: true };
    const startedOn = sw.checked;
    sw.checked = false; sw.dispatchEvent(new Event('change'));
    const muted = loadStr('amv_mute_chime');
    sw.checked = true; sw.dispatchEvent(new Event('change'));
    const unmuted = loadStr('amv_mute_chime');
    return { startedOn, muted, unmuted };
  });
  ok(!r.missing, 'there is a control for it', r);
  ok(r.startedOn === true, 'it is on by default, as it was', r.startedOn);
  ok(r.muted === '1', 'turning it off writes the key the player reads', r.muted);
  ok(r.unmuted === '0', 'and turning it back on clears it', r.unmuted);
}

section('And the player honours it');
{
  const r = await page.evaluate(() => {
    const src = String(_playDoneChime);
    return { reads: /amv_mute_chime/.test(src) };
  });
  ok(r.reads, 'the same key gates the sound', r.reads);
}

section('The chime preference survives signing in');
{
  /* Theme, accent and reduced motion are device-wide. A sound preference set
     while signed out and lost on sign-in would be the same setting twice. */
  const g = await page.evaluate(() => _GLOBAL_KEYS.has('amv_mute_chime'));
  ok(g, 'it is stored per device, like the other environment preferences', g);
}

section('No preference is read from a key nothing writes');
{
  /* The property behind both of these. `amv_font_size` in the data export and
     `amv_mute_chime` here were each read forever from a key no code ever set -
     one exported null, the other made a mute switch that could not mute. */
  const dir = join(ROOT, 'src', 'app');
  const files = readdirSync(dir).filter(f => f.endsWith('.js'));
  /* Comments stripped first. The comment recording that a dead read was
     REMOVED quotes the call it removed, so a raw scan finds the phantom in the
     note explaining the phantom - the same way the shortcut sweep flagged its
     own documentation. */
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
                                .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p);
  const read = new Map(), written = new Set();
  for (const f of files) {
    const s = stripComments(readFileSync(join(dir, f), 'utf8'));
    for (const m of s.matchAll(/\bloadStr\(\s*'(amv_(?:mute|cap|plugin|reduce|font|voice)[a-z_0-9]*)'/g)) {
      if (!read.has(m[1])) read.set(m[1], f);
    }
    for (const m of s.matchAll(/\bsaveStr\(\s*'(amv_[a-z_0-9]*)'/g)) written.add(m[1]);
  }
  const dead = [...read.keys()].filter(k => !written.has(k)).sort();
  ok(dead.length === 0,
     'every preference the client reads is one it can also set', dead);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('saved-is-not-sent') > 0) process.exitCode = 1;
done();
