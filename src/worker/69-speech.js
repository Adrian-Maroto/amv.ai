/* ══════════════════════════════════════════════════════════════════════
   SPEECH: LISTENING TO AUDIO, AND SPEAKING ANSWERS ALOUD, ON THE SERVER.

   The browser's own speech recognition and voices work in some browsers, in
   some languages, at whatever quality that browser ships - and cannot read an
   audio file at all. This is the server half of real voice: a speech supplier
   that hears a recording and returns what was said with timestamps, and turns
   text into audio that streams back as it is made.

   ONE SUPPLIER, ANY SUPPLIER. Most speech providers offer the same two calls
   in the widely shared protocol (`/audio/transcriptions`, `/audio/speech`), so
   this is configured by settings and tied to nobody:

     AMV_SPEECH_URL                      the endpoint's base, e.g. https://<host>/v1
     AMV_SPEECH_KEY                      its key - read here and nowhere else
     AMV_SPEECH_LISTEN_MODEL             the model that hears audio
     AMV_SPEECH_LISTEN_USD_PER_MIN       what one minute of hearing costs
     AMV_SPEECH_VOICE_MODEL              the model that speaks
     AMV_SPEECH_VOICE                    which of its voices AMV uses
     AMV_SPEECH_VOICE_USD_PER_1K_CHARS   what 1,000 characters of speech cost

   NOTHING IS ON WITHOUT ITS PRICE. A half that has no price is off, exactly as
   a partner engine without one is never offered: a capability AMV cannot count
   is one it gives away. With a price, every minute heard and every character
   spoken goes through `_spendGate` and `_recordSpend` - the account's ceiling,
   a family's limit, the day's ceiling and the owner's cost figures - like any
   answer does. Plans and prices are unchanged; speech spends the same allowance.

   NEVER LOGGED. Neither the audio nor the words are written anywhere: the audit
   lines say who, how long and how much, never what.
   ══════════════════════════════════════════════════════════════════════ */
const SPEECH_LISTEN_MAX_BYTES = 25 * 1024 * 1024;
const SPEECH_LISTEN_MAX_S = 30 * 60;
/* No real recording carries more than this many bytes a second (uncompressed
   stereo at 48kHz is 192KB/s), so the size gives a floor on its length that a
   too-small duration from the page cannot get under. */
const SPEECH_MAX_BYTES_PER_S = 196608;
const SPEECH_SPEAK_MAX_CHARS = 4000;
const SPEECH_SEGMENTS_MAX = 2000;
const SPEECH_DEADLINE_MS = 120000;

function _speechBase(env){
  const u = String((env && env.AMV_SPEECH_URL) || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(u) ? u : '';
}
function _speechPrice(env, name){
  const n = parseFloat(String((env && env[name]) || ''));
  return Number.isFinite(n) && n > 0 && n < 100 ? n : 0;
}
function _speechModelOk(v){ return /^[\w./:-]{1,120}$/.test(String(v || '')); }
function _speechListenOn(env){
  return !!(_speechBase(env) && env.AMV_SPEECH_KEY && _speechModelOk(env.AMV_SPEECH_LISTEN_MODEL)
            && _speechPrice(env, 'AMV_SPEECH_LISTEN_USD_PER_MIN'));
}
function _speechSpeakOn(env){
  return !!(_speechBase(env) && env.AMV_SPEECH_KEY && _speechModelOk(env.AMV_SPEECH_VOICE_MODEL)
            && /^[\w-]{1,40}$/.test(String(env.AMV_SPEECH_VOICE || ''))
            && _speechPrice(env, 'AMV_SPEECH_VOICE_USD_PER_1K_CHARS'));
}

/* The gate's refusal, kept as it is: it already says which limit and when it
   resets, in words the page shows. */
async function _speechGate(env, user, what, usd, book){
  return _spendGate(env, user, what, usd, book, { fallbackCeilingUSD: FREE_AUTO_CEILING_USD });
}

/* HEAR A RECORDING. The body is the audio itself; the page says how long it
   is (`?seconds=`), which is checked against its size, reserved, and settled
   at what the supplier says it really was. Query parameters rather than
   headers of AMV's own, so the cross-origin header list stays as it is. */
async function speechTranscribe(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  if(!_speechListenOn(env))
    return json({ error:'Listening to audio is not switched on for this deployment yet.', code:'needs_service' }, 503);
  const limited = await guardAction(env, 'speech-listen:' + user.email, 20, 400, 'recordings');
  if(limited) return limited;
  const type = String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if(!/^(audio|video)\/[\w.+-]{1,40}$/.test(type))
    return json({ error:'That is not an audio recording AMV can read.', code:'bad_audio' }, 415);
  const q = new URL(request.url).searchParams;
  const declared = parseFloat(String(q.get('seconds') || ''));
  if(!(declared > 0)) return json({ error:'AMV needs to know how long the recording is.', code:'needs_duration' }, 400);
  if(declared > SPEECH_LISTEN_MAX_S)
    return json({ error:'That recording is longer than 30 minutes. Split it into shorter parts.', code:'too_long' }, 413);
  const buf = await request.arrayBuffer();
  if(!buf.byteLength) return json({ error:'The recording is empty.', code:'bad_audio' }, 400);
  if(buf.byteLength > SPEECH_LISTEN_MAX_BYTES)
    return json({ error:'That recording is larger than 25 MB. Split it into shorter parts.', code:'too_large' }, 413);
  const reserveS = Math.min(SPEECH_LISTEN_MAX_S, Math.max(declared, buf.byteLength / SPEECH_MAX_BYTES_PER_S));
  const perMin = _speechPrice(env, 'AMV_SPEECH_LISTEN_USD_PER_MIN');
  const book = {};
  const refused = await _speechGate(env, user, 'speech', (reserveS / 60) * perMin, book);
  if(refused) return refused;

  const lang = String(q.get('lang') || '').trim().toLowerCase();
  const form = new FormData();
  const ext = (type.split('/')[1] || 'webm').replace(/[^\w]/g, '').slice(0, 8) || 'webm';
  form.append('file', new Blob([buf], { type }), 'audio.' + ext);
  form.append('model', String(env.AMV_SPEECH_LISTEN_MODEL));
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  if(/^[a-z]{2}$/.test(lang)) form.append('language', lang);
  let r, d = null;
  try{
    r = await fetch(_speechBase(env) + '/audio/transcriptions', { method:'POST',
      headers: { Authorization: 'Bearer ' + env.AMV_SPEECH_KEY }, body: form, signal: AbortSignal.timeout(SPEECH_DEADLINE_MS) });
    d = await r.json().catch(() => null);
  }catch(e){ r = null; }
  if(!r || !r.ok || !d || typeof d.text !== 'string'){
    await _releaseSpendGate(env, book);
    audit(env, 'speech_listen_failed', { by: user.email, status: r ? r.status : 0, seconds: Math.round(reserveS) });
    return json({ error:'AMV could not hear that recording just now. Nothing was charged. Try again in a moment.', code:'speech_unavailable' }, 502);
  }
  const heard = Number(d.duration);
  const seconds = Number.isFinite(heard) && heard > 0 ? heard : reserveS;
  const usd = (seconds / 60) * perMin;
  await _recordSpend(env, user.billingSubject || user.email, usd, 'speech', book.period, book);
  audit(env, 'speech_listened', { by: user.email, seconds: Math.round(seconds), usd: Math.round(usd * 1e6) / 1e6 });
  const segments = (Array.isArray(d.segments) ? d.segments : []).slice(0, SPEECH_SEGMENTS_MAX)
    .map(s => ({ start: Math.max(0, +s.start || 0), end: Math.max(0, +s.end || 0), text: String((s && s.text) || '').trim() }))
    .filter(s => s.text);
  return json({ ok:true, text: d.text.trim(), language: /^[a-z-]{2,12}$/i.test(String(d.language || '')) ? String(d.language) : '',
                seconds: Math.round(seconds * 10) / 10, segments });
}

/* SPEAK AN ANSWER. Priced by the character, so the whole cost is known before
   the call: reserved and recorded up front, handed back if the supplier fails
   before any audio comes. The audio streams through as it is made. */
async function speechSpeak(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  if(!_speechSpeakOn(env))
    return json({ error:'Speaking answers aloud is not switched on for this deployment yet.', code:'needs_service' }, 503);
  const limited = await guardAction(env, 'speech-speak:' + user.email, 60, 3000, 'spoken answers');
  if(limited) return limited;
  const body = await request.json().catch(() => ({}));
  const text = String((body && body.text) || '').trim();
  if(!text) return json({ error:'Nothing to say.', code:'empty' }, 400);
  if(text.length > SPEECH_SPEAK_MAX_CHARS)
    return json({ error:'That is too long to speak in one go.', code:'too_long' }, 413);
  const usd = (text.length / 1000) * _speechPrice(env, 'AMV_SPEECH_VOICE_USD_PER_1K_CHARS');
  const book = {};
  const refused = await _speechGate(env, user, 'speech', usd, book);
  if(refused) return refused;
  let r;
  try{
    r = await fetch(_speechBase(env) + '/audio/speech', { method:'POST',
      headers: { Authorization: 'Bearer ' + env.AMV_SPEECH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: String(env.AMV_SPEECH_VOICE_MODEL), voice: String(env.AMV_SPEECH_VOICE), input: text, response_format: 'mp3' }),
      signal: AbortSignal.timeout(SPEECH_DEADLINE_MS) });
  }catch(e){ r = null; }
  if(!r || !r.ok || !r.body){
    await _releaseSpendGate(env, book);
    audit(env, 'speech_speak_failed', { by: user.email, status: r ? r.status : 0, chars: text.length });
    return json({ error:'AMV could not speak that just now. Nothing was charged.', code:'speech_unavailable' }, 502);
  }
  await _recordSpend(env, user.billingSubject || user.email, usd, 'speech', book.period, book);
  return new Response(r.body, { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
}
