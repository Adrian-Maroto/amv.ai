/* VOICE LISTENS AND SPEAKS IN THE PERSON'S LANGUAGE.

   All three recognisers were set to 'en-US', so somebody speaking Spanish was
   transcribed as English-shaped nonsense, and every answer was read aloud by
   an English voice whatever language it was written in. The browser's speech
   engines are replaced here by recorders, so what is asserted is exactly what
   AMV asks them for: which language to listen in, and which voice reads. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

await page.evaluate(() => {
  window.__rec = [];
  class FakeSR { constructor(){ window.__rec.push(this); } start(){} stop(){} abort(){} }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  window.__said = [];
  const voices = [
    { name: 'Google US English', lang: 'en-US' }, { name: 'Daniel', lang: 'en-GB' },
    { name: 'Google español', lang: 'es-ES' }, { name: 'Paulina', lang: 'es-MX' },
    { name: 'Kyoko', lang: 'ja-JP' }, { name: 'Lekha', lang: 'hi_IN' },
  ];
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => voices, speak: (u) => window.__said.push({ lang: u.lang, voice: u.voice ? u.voice.name : null }),
    cancel(){}, onvoiceschanged: null } });
  /* A plain utterance, because a real one accepts only the browser's own voice objects. */
  window.SpeechSynthesisUtterance = class { constructor(t){ this.text = t; } };
  window.__setLangs = (l) => Object.defineProperty(navigator, 'languages', { configurable: true, get: () => l });
});

/* What each of the three microphones asks for, under one setting. */
const listenAs = (amvLang, deviceLangs) => page.evaluate(([l, d]) => {
  saveStr('amv_lang', l); window.__setLangs(d);
  window.__rec.length = 0;
  _amvBeginRec();                                  /* the chat microphone */
  _voiceMode = true; _voiceModeListen(); _voiceMode = false;   /* hands-free voice mode */
  _amvStartVoice(null);                            /* the other composer's microphone */
  return window.__rec.map(r => r.lang);
}, [amvLang, deviceLangs]);

section('The microphones listen in the language AMV is set to');
{
  const es = await listenAs('es', ['en-US']);
  ok(es.length === 3 && es.every(l => l === 'es-ES'), 'set to Español: all three listen for Spanish, not American English', es);
  const mx = await listenAs('es', ['es-MX', 'en-US']);
  ok(mx.every(l => l === 'es-MX'), 'and in the device’s own Spanish when it has one', mx);
  const hi = await listenAs('auto', ['hi-IN', 'en-GB']);
  ok(hi.every(l => l === 'hi-IN'), 'on Auto, the device’s language', hi);
  const ja = await listenAs('ja', ['en-US']);
  ok(ja.every(l => l === 'ja-JP'), 'Japanese listens for Japanese', ja);
  const en = await listenAs('en', ['en-GB']);
  ok(en.every(l => l === 'en-GB'), 'and English on a British device stays British', en);
}

section('Answers are read by a voice of their own language');
{
  const speak = (amvLang, devices, text) => page.evaluate(([l, d, t]) => {
    saveStr('amv_lang', l); window.__setLangs(d); window.__said.length = 0;
    AMVSpeech._voiceFor = {};
    AMVSpeech.speak(t);
    return window.__said[0] || null;
  }, [amvLang, devices, text]);

  const es = await speak('es', ['en-US'], 'Hola, ¿cómo estás? Aquí tienes el resumen.');
  ok(es && es.voice === 'Google español' && es.lang === 'es-ES', 'a Spanish answer is read by a Spanish voice', es);
  const mx = await speak('es', ['es-MX'], 'Hola de nuevo.');
  ok(mx && mx.voice === 'Paulina', 'by the device’s own Spanish voice where there is one', mx);
  const ja = await speak('es', ['en-US'], 'こんにちは、今日はいい天気ですね。');
  ok(ja && ja.voice === 'Kyoko', 'an answer written in Japanese is read in Japanese, whatever the app is set to', ja);
  const hi = await speak('hi', ['en-US'], 'नमस्ते, आप कैसे हैं?');
  ok(hi && hi.voice === 'Lekha', 'a voice whose language is written with an underscore still matches', hi);
  const ko = await speak('ko', ['en-US'], '안녕하세요');
  ok(ko && ko.voice === null && ko.lang === 'ko-KR', 'with no Korean voice installed, no English voice is forced on it - the browser is asked for Korean', ko);
  const en = await speak('en', ['en-US'], 'Here is your summary.');
  ok(en && en.voice === 'Google US English', 'English is still read in English', en);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('voice-speaks-your-language') > 0) process.exitCode = 1;
done();
