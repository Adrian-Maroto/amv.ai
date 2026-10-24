/* AMV SPEAKS OUT LOUD - THE SOUND REALLY PLAYS.

   Voice mode plays each spoken sentence the server returns as
   `new Audio(URL.createObjectURL(blob))`. The page's policy had no media-src,
   so it fell back to default-src 'self', which does not include blob: - and
   every browser refused the sound ("media-src blob", measured in Chromium and
   reported by WebKit). The player's onerror moved on to the next sentence, so
   voice mode went quietly silent and nothing said why. The voice suite stubs
   the audio element, which is how it never noticed.

   This plays a real sound file, made in the page, the way voice mode does. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

section('A sound the page made is allowed to play');
{
  const r = await page.evaluate(async () => {
    // 0.2s of silence: an 8kHz, 8-bit, mono WAV.
    const n = 1600, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    const refused = [];
    document.addEventListener('securitypolicyviolation', e => refused.push(e.violatedDirective + ' ' + e.blockedURI));
    const a = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
    let res;
    try { await a.play(); res = 'played'; } catch (e) { res = e.name + ': ' + e.message; }
    await new Promise(x => setTimeout(x, 300));
    return { res, refused };
  });
  ok(r.refused.length === 0, 'the page\'s own policy does not refuse it', r.refused);
  ok(r.res === 'played', 'and it plays', r.res);
}

ok(errors.length === 0, 'no page errors', errors);
await app.close();
report();
done();
