/* TALK TO AMV, HEAR IT ANSWER SENTENCE BY SENTENCE, AND INTERRUPT IT.

   Live voice (src/voice/live-voice.js) on a deployment with server speech.
   Driven in a real browser against the real Worker: the speech supplier and
   the model are stubs that record what they were sent; the microphone is a
   silent synthetic stream and the speaker a stand-in that records what it was
   asked to play. The turn detector is tested with exact loudness sequences,
   because a microphone in a test cannot be made to say something on cue.

     - a pause ends a turn; a cough does not; AMV's own voice leaking back
       does not count as being interrupted, and talking over it does;
     - a turn is heard on the server and sent as the message;
     - the answer is spoken sentence by sentence as it arrives;
     - talking over it stops the audio and everything still waiting, and it
       listens again;
     - a long answer stops being spoken at the cap and says the rest is on
       screen;
     - Escape ends it and lets go of the microphone. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

function textStream(text) {
  const ev = (t, d) => 'event: ' + t + '\ndata: ' + JSON.stringify(d) + '\n\n';
  return ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 20, output_tokens: 0 } } })
       + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
       + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
       + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
       + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 25 } })
       + ev('message_stop', { type: 'message_stop' });
}

let replies = [];
const spoken = [];
let heardText = 'What should I pack for Lisbon?';
const outbound = makeOutbound();
outbound.on(/speech\.example\/v1\/audio\/transcriptions/, () => ({ text: heardText, duration: 2.1, segments: [] }));
outbound.on(/speech\.example\/v1\/audio\/speech/, (_u, opts) => {
  try { spoken.push(JSON.parse(String(opts.body)).input); } catch (e) {}
  return new Response(new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
});
outbound.on(/model\.example/, (_u, opts) => {
  let body = {}; try { body = JSON.parse(String(opts.body || '{}')); } catch (e) {}
  const isChat = Array.isArray(body.tools) && body.tools.length > 0;
  const sse = (isChat && replies.length) ? textStream(replies.shift()) : textStream('Okay.');
  return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
});
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9185', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
  AMV_SPEECH_URL: 'https://speech.example/v1', AMV_SPEECH_KEY: 'sk-speech',
  AMV_SPEECH_LISTEN_MODEL: 'hear-1', AMV_SPEECH_LISTEN_USD_PER_MIN: '0.006',
  AMV_SPEECH_VOICE_MODEL: 'speak-1', AMV_SPEECH_VOICE: 'calm', AMV_SPEECH_VOICE_USD_PER_1K_CHARS: '0.015',
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body);
      const cur = vals.get(n) || 0;
      if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) })); }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
      return new Response(JSON.stringify({ allowed: true, ok: true, value: cur }));
    } }),
  },
});
const L = await bootLive({ env, outbound, port: 9185 });
const { page } = L;
const EMAIL = 'talker@example.com';

/* A silent microphone, and a speaker that records what it plays. */
await page.evaluate(() => {
  window.__played = []; window.__paused = 0; window.__trackStopped = 0;
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext(); const osc = ctx.createOscillator(); const g = ctx.createGain(); g.gain.value = 0;
    const dest = ctx.createMediaStreamDestination(); osc.connect(g); g.connect(dest); osc.start();
    const s = dest.stream; s.getTracks().forEach(t => { const st = t.stop.bind(t); t.stop = () => { window.__trackStopped++; st(); }; });
    return s;
  };
  window.Audio = class { constructor(src) { this.src = src; window.__played.push(src); }
    play() { this._t = setTimeout(() => this.onended && this.onended(), 120); return Promise.resolve(); }
    pause() { clearTimeout(this._t); window.__paused++; } };
});

section('The turn detector, with exact loudness');
{
  const r = await page.evaluate(async () => {
    await _liveVoiceLoad();
    const run = (seq, speaking) => { let v = null, at = -1; seq.forEach((x, i) => { const o = _lvVad(v, x, speaking); v = o.v; if (o.event && at < 0) at = i; }); return at; };
    const calm = Array(8).fill(0.002);
    return {
      pause: run(calm.concat(Array(10).fill(0.1), Array(18).fill(0.001))),
      shortPause: run(calm.concat(Array(10).fill(0.1), Array(17).fill(0.001))),
      cough: run(calm.concat(Array(4).fill(0.1), Array(40).fill(0.001))),
      barge: run(Array(5).fill(0.1), true),
      echo: run(Array(40).fill(0.02), true),
    };
  });
  ok(r.pause === 35, 'half a second of talking then 0.9s of quiet ends the turn, at exactly that tick', r.pause);
  ok(r.shortPause === -1, 'a slightly shorter pause does not', r.shortPause);
  ok(r.cough === -1, 'a 0.2s cough is not a turn', r.cough);
  ok(r.barge === 4, 'talking over AMV for a quarter of a second interrupts it', r.barge);
  ok(r.echo === -1, 'its own voice leaking back quietly does not', r.echo);
}

section('A turn is heard on the server, sent, and answered aloud sentence by sentence');
{
  await page.evaluate(async ([em, pw]) => {
    openAuth('signup'); await __amvAuthOpen();
    const type = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Talk Er'); type('#a-email', em); type('#a-pass', pw);
    document.getElementById('auth-submit').click(); await __amvSignedIn();
  }, [EMAIL, 'A-real-Passw0rd!']);
  await env.AMV_KV.put('ent:' + EMAIL, JSON.stringify({ plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  await page.evaluate(() => { try { AMVUsage.status = () => ({ remaining: 9999, resetsAt: Date.now() + 3600e3 }); } catch (e) {} setTab('chat'); });
  ok(await page.evaluate(() => _SPEECH.listen && _SPEECH.speak), 'the page knows the server can hear and speak');
  await page.evaluate(() => toggleVoiceMode());
  await page.waitForFunction(() => window._lvDrive && _lvDrive.state() === 'listening', null, { timeout: 8000 });
  ok(await page.evaluate(() => _liveVoiceOn() && !!document.querySelector('#voice-ov.on')), 'voice mode is on, listening');

  replies = ['Pack light layers. Bring good shoes. Lisbon is hilly.'];
  await page.waitForTimeout(400);
  await page.evaluate(() => _lvDrive.endTurn());
  await page.waitForFunction(() => window.__played.length >= 3 && _lvDrive.state() === 'listening', null, { timeout: 15000 }).catch(() => {});
  const msgs = await page.evaluate(() => getMsgs().map(m => [m.r, typeof m.c === 'string' ? m.c : '']));
  ok(msgs.some(([r, c]) => r === 'u' && c === 'What should I pack for Lisbon?'), 'what was heard was sent as the message', msgs.slice(-2));
  ok(L.hit(/\/v1\/audio\/transcribe/).length === 1, 'heard once, on the server', L.hit(/\/v1\/audio\/transcribe/).length);
  ok(JSON.stringify(spoken) === JSON.stringify(['Pack light layers.', 'Bring good shoes.', 'Lisbon is hilly.']), 'each sentence spoken on its own, in order', spoken);
  ok(await page.evaluate(() => window.__played.length === 3 && _lvDrive.state() === 'listening'), 'all three played, then it listens again', await page.evaluate(() => [window.__played.length, _lvDrive.state()]));
}

section('Talking over it stops the audio and everything waiting, and it listens');
{
  spoken.length = 0;
  await page.evaluate(() => { window.__played = []; window.__paused = 0; });
  replies = [Array.from({ length: 8 }, (_, i) => 'This is sentence number ' + (i + 1) + ' of a long answer.').join(' ')];
  heardText = 'Tell me everything about Lisbon.';
  await page.waitForTimeout(3000);   // a turn has audio in it, and the chat burst limiter is right to want a gap
  await page.evaluate(() => _lvDrive.endTurn());
  await page.waitForFunction(() => window.__played.length >= 1, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => _lvDrive.bargeIn());
  const at = await page.evaluate(() => ({ state: _lvDrive.state(), queued: _lvDrive.queued(), paused: window.__paused, played: window.__played.length }));
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => window.__played.length);
  ok(at.state === 'listening' && at.queued === 0 && at.paused >= 1, 'the audio stops, nothing is left waiting, and it listens', at);
  ok(after === at.played, 'and nothing more is played after the interruption', { at: at.played, after });
  ok(spoken.length <= 4, 'only the sentence playing and the few fetched ahead were ever asked for - not all eight', spoken.length);
  const shown = await page.evaluate(() => { const m = getMsgs(); return String(m[m.length - 1].c || ''); });
  ok(/sentence number 8/.test(shown), 'the written answer is all still there', shown.slice(-60));
}

section('A long answer stops being spoken at the cap, and says the rest is on screen');
{
  spoken.length = 0;
  await page.evaluate(() => { window.__played = []; });
  replies = [Array.from({ length: 30 }, (_, i) => 'Here is a fairly long sentence about the city, number ' + (i + 1) + ', with some detail in it.').join(' ')];
  heardText = 'Give me the long version.';
  await page.waitForTimeout(3000);
  await page.evaluate(() => _lvDrive.endTurn());
  await page.waitForFunction(() => _lvDrive.state() === 'listening' && window.__played.length > 3, null, { timeout: 30000 }).catch(() => {});
  const chars = spoken.filter(s => s !== 'The rest is on screen.').join('').length;
  ok(chars <= 1500 && spoken.length > 5, 'no more than 1,500 characters are spoken', { chars, n: spoken.length });
  ok(spoken[spoken.length - 1] === 'The rest is on screen.', 'and the last thing said is that the rest is on screen', spoken.slice(-1));
}

section('A turn with nothing recorded is not sent anywhere');
{
  const before = L.hit(/\/v1\/audio\/transcribe/).length;
  const r = await page.evaluate(async () => { _lvDrive.endTurn(); await new Promise(x => setTimeout(x, 400)); return _lvDrive.state(); });
  ok(L.hit(/\/v1\/audio\/transcribe/).length === before && r === 'listening', 'it just listens again', { sent: L.hit(/\/v1\/audio\/transcribe/).length - before, state: r });
}

section('Escape ends it and lets go of the microphone');
{
  await page.keyboard.press('Escape');
  const r = await page.evaluate(() => ({ on: _liveVoiceOn(), stopped: window.__trackStopped, overlay: !!document.querySelector('#voice-ov.on') }));
  ok(!r.on && r.stopped >= 1 && !r.overlay, 'voice is off, the microphone track is stopped, the overlay is gone', r);
}

section('Without server hearing, voice mode does not pretend to be live');
{
  const r = await page.evaluate(async () => { _SPEECH.listen = false; toggleVoiceMode(); await new Promise(x => setTimeout(x, 300)); const on = _liveVoiceOn(); _SPEECH.listen = true; return on; });
  ok(r === false, 'the live conversation is not started', r);
}

ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 3));
await L.close();
if (report('talk-to-amv-and-interrupt-it') > 0) process.exitCode = 1;
done();
