/* A RECORDING ATTACHED IN CHAT BECOMES A TRANSCRIPT, WITH WHEN EACH PART WAS SAID.

   Audio used to be refused outright ("AMV can't listen to audio files"). With
   server speech switched on, the file is sent - byte for byte - through the
   real Worker to the speech supplier, and comes back attached as text, every
   line stamped with its time. Driven in a real browser through the real file
   reader, the real API client and the real Worker; only the supplier is a
   stub, and every call it receives is recorded.

   And where it cannot work, it says which reason applies: this deployment has
   no server speech, or nobody is signed in - never "read" as text, never
   guessed at. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const heard = [];
const outbound = makeOutbound();
outbound.on(/speech\.example\/v1\/audio\/transcriptions/, async (_u, opts) => {
  const f = {};
  if (opts.body instanceof FormData) for (const [k, v] of opts.body.entries()) f[k] = typeof v === 'string' ? v : { size: v.size, type: v.type, head: [...new Uint8Array(await v.arrayBuffer()).slice(0, 4)] };
  heard.push(f);
  return { text: 'The quarterly numbers are up nine percent in Lisbon.', language: 'english', duration: 42.4,
           segments: [{ start: 0, end: 3.2, text: 'The quarterly numbers' }, { start: 3.2, end: 6.1, text: 'are up nine percent in Lisbon.' }] };
});
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9183',
  AMV_SPEECH_URL: 'https://speech.example/v1', AMV_SPEECH_KEY: 'sk-speech',
  AMV_SPEECH_LISTEN_MODEL: 'hear-1', AMV_SPEECH_LISTEN_USD_PER_MIN: '0.006',
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body);
      const cur = vals.get(n) || 0;
      if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) })); }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      return new Response(JSON.stringify({ allowed: true, ok: true, value: cur }));
    } }),
  },
});

const L = await bootLive({ env, outbound, port: 9183 });
const { page } = L;
const EMAIL = 'listener@example.com';

/* An MP3 by its signature (a frame header), long enough to be a recording. */
const attach = (name = 'board-meeting.mp3') => page.evaluate(async (nm) => {
  const b = new Uint8Array(40000); b[0] = 0xFF; b[1] = 0xFB; b[2] = 0x90; b[3] = 0x64;
  return amvReadFile(new File([b], nm, { type: 'audio/mpeg' }));
}, name);

section('Signed out, the reason given is signing in');
{
  await page.waitForFunction(() => typeof _SPEECH !== 'undefined' && _SPEECH.listen === true, null, { timeout: 8000 }).catch(() => {});
  ok(await page.evaluate(() => _SPEECH.listen === true && _SPEECH.speak === false), 'the page learned this deployment can listen, and cannot yet speak');
  const r = await attach();
  ok(r.kind === 'refused' && r.code === 'listen_signin' && /Sign in to have AMV listen/.test(r.reason), 'signed out: it asks them to sign in', r.reason);
  ok(heard.length === 0, 'and nothing was sent', heard.length);
}

section('Signed in, the recording comes back as a transcript with times');
{
  await page.evaluate(async ([em, pw]) => {
    openAuth('signup');
    await __amvAuthOpen();
    const type = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Lis Tener'); type('#a-email', em); type('#a-pass', pw);
    document.getElementById('auth-submit').click();
    await __amvSignedIn();
  }, [EMAIL, 'A-real-Passw0rd!']);
  await env.AMV_KV.put('ent:' + EMAIL, JSON.stringify({ plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  const r = await attach();
  ok(r.kind === 'text' && r.format === 'transcript', 'attached as text', r.kind + ' ' + (r.reason || ''));
  ok(/\[0:00\] The quarterly numbers\n\[0:03\] are up nine percent in Lisbon\./.test(r.data || ''), 'each line stamped with when it was said', (r.data || '').slice(0, 220));
  ok(r.summary === '0:42' && /"board-meeting\.mp3" \(0:42, english\)/.test(r.data || ''), 'named, with its length and language', r.summary);
  const chip = await page.evaluate((att) => { S.att = att; showAttChip(); const t = (document.getElementById('ac') || {}).textContent || ''; S.att = null; return t; }, r);
  ok(/board-meeting\.mp3/.test(chip) && /\(Transcript · 0:42 · /.test(chip) && !/undefined/.test(chip), 'and the attachment chip reads "Transcript · 0:42"', chip);
  const f = heard[0] || {};
  ok(f.file && f.file.size === 40000 && f.file.type === 'audio/mpeg' && f.file.head.join() === '255,251,144,100', 'the supplier got the recording byte for byte', f.file);
  ok(f.model === 'hear-1' && !('language' in f), 'with the model, and no language guessed from the screen', f);
  ok(L.hit(/\/v1\/audio\/transcribe/).length === 1, 'through the Worker, once - a paid call is never retried', L.hit(/\/v1\/audio\/transcribe/).length);
  const spent = [...vals.entries()].filter(([k]) => k.startsWith('cost:' + EMAIL)).reduce((a, [, v]) => a + v, 0);
  ok(Math.abs(spent - (42.4 / 60) * 0.006) < 1e-9, 'and charged for the 42 seconds it really was', spent);
}

section('Without server speech, it says this AMV cannot listen yet');
{
  const r = await page.evaluate(async () => {
    _SPEECH.listen = false;
    const b = new Uint8Array(4000); b[0] = 0x49; b[1] = 0x44; b[2] = 0x33;
    const out = await amvReadFile(new File([b], 'voice-note.mp3', { type: 'audio/mpeg' }));
    _SPEECH.listen = true;
    return out;
  });
  ok(r.kind === 'refused' && /not set up to listen to recordings yet/.test(r.reason) && /Paste a transcript/.test(r.reason), 'refused, with the reason and what to do instead', r.reason);
}

ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 3));
await L.close();
if (report('a-recording-becomes-a-transcript') > 0) process.exitCode = 1;
done();
