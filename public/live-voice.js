/* ══════════════════════════════════════════════════════════════════════
   LIVE VOICE: A CONVERSATION YOU CAN INTERRUPT.

   Fetched the first time somebody starts voice mode on a deployment with
   server speech (`_liveVoiceLoad` in 05-ui-blocks.js), so nobody else carries
   it. It runs in the page's own scope, beside the overlay, the composer and
   the API client it uses.

   The old loop was the browser's own: listen, send, read the whole answer
   aloud, listen again - in whichever browsers had speech recognition, in the
   voices they shipped, and deaf while it spoke. This one:

     HEARS on the server. The microphone runs with the browser's echo
     cancellation; a small detector (`_lvVad`, a pure function so it can be
     tested with exact sequences) decides when somebody has started and
     finished a turn, and that turn goes to /v1/audio/transcribe.
     SPEAKS AS IT WRITES. Each sentence of the answer is spoken as soon as it
     exists, the next one fetched while the current one plays - with the
     server's voice where there is one, the browser's where there is not.
     STOPS WHEN INTERRUPTED. Talking over it stops the audio and the sentences
     still waiting, and it listens. The written answer carries on, on screen.

   Spoken length is capped per answer (LV_SPEAK_MAX): speech is paid by the
   character, and a long answer is better read. When it stops early it says
   the rest is on screen, rather than going quiet mid-thought.
   ══════════════════════════════════════════════════════════════════════ */
const LV_TICK_MS = 50;
const LV_MIN_SPEECH_MS = 300;     // a cough or a click is not a turn
const LV_SILENCE_END_MS = 900;    // the pause that ends a turn
const LV_BARGE_MS = 250;          // talking over it for this long stops it
const LV_MAX_TURN_MS = 60000;     // a turn this long is ended and sent
const LV_SPEAK_MAX = 1500;        // characters spoken per answer
const LV_PREFETCH = 2;            // sentences fetched ahead of the one playing

const LV = { on: false, state: 'idle', stream: null, ctx: null, an: null, buf: null, timer: null,
             rec: null, chunks: [], mime: '', turnAt: 0, vad: null,
             queue: [], playing: null, follow: null, spokenUpto: 0, spokenChars: 0, capped: false, replyIdx: -1, replyDone: false };

/* THE DETECTOR. Given where it was and how loud this moment is, where it is
   now and whether something happened. Loud means well above the room's own
   floor, which is learned in the first few ticks of each listen. While AMV is
   speaking the bar is higher, so its own voice leaking past echo cancellation
   does not count as being interrupted. */
function _lvVad(v, rms, speaking){
  v = Object.assign({ ticks: 0, floor: 0.006, samples: [], speechMs: 0, silenceMs: 0, heard: false, bargeMs: 0 }, v || {});
  v.ticks++;
  if(v.ticks <= 8 && !speaking){
    v.samples.push(rms);
    if(v.ticks === 8){ const s = v.samples.slice().sort((a, b) => a - b); v.floor = Math.max(0.006, s[4] * 1.5); }
    return { v, event: null };
  }
  const loud = rms > Math.max(v.floor * (speaking ? 5 : 3), speaking ? 0.03 : 0.015);
  if(speaking){
    v.bargeMs = loud ? v.bargeMs + LV_TICK_MS : 0;
    return { v, event: v.bargeMs >= LV_BARGE_MS ? 'barge' : null };
  }
  if(loud){ v.speechMs += LV_TICK_MS; v.silenceMs = 0; if(v.speechMs >= LV_MIN_SPEECH_MS) v.heard = true; }
  else if(v.heard) v.silenceMs += LV_TICK_MS;
  return { v, event: v.heard && v.silenceMs >= LV_SILENCE_END_MS ? 'end' : null };
}

function _lvRms(){
  if(!LV.an) return 0;
  LV.an.getFloatTimeDomainData(LV.buf);
  let s = 0; for(let i = 0; i < LV.buf.length; i++) s += LV.buf[i] * LV.buf[i];
  return Math.sqrt(s / LV.buf.length);
}
function _lvMime(){
  for(const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'])
    try{ if(window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m; }catch(e){}
  return '';
}
function _lvTick(){
  if(!LV.on) return;
  const speaking = LV.state === 'speaking';
  if(LV.state !== 'listening' && !speaking) return;
  const r = _lvVad(LV.vad, _lvRms(), speaking);
  LV.vad = r.v;
  if(r.event === 'end') _lvEndTurn();
  else if(r.event === 'barge') _lvBargeIn();
  else if(LV.state === 'listening' && LV.vad.heard && Date.now() - LV.turnAt > LV_MAX_TURN_MS) _lvEndTurn();
}

async function _liveVoiceStart(){
  if(LV.on) return true;
  if(!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder)){
    toast(T('This browser cannot record from the microphone. Try a current Chrome, Safari, Edge or Firefox.'), 'error', 7000);
    return false;
  }
  try{
    LV.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  }catch(e){
    toast(T('AMV needs the microphone for voice. Allow it in the browser, then try again.'), 'error', 8000);
    return false;
  }
  LV.on = true; _voiceMode = true;
  const btn = $('voicemode-btn'); if(btn) btn.classList.add('on');
  _showVoiceOverlay();
  try{
    LV.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = LV.ctx.createMediaStreamSource(LV.stream);
    LV.an = LV.ctx.createAnalyser(); LV.an.fftSize = 1024;
    LV.buf = new Float32Array(LV.an.fftSize);
    src.connect(LV.an);
  }catch(e){ LV.an = null; }
  LV.mime = _lvMime();
  LV.timer = setInterval(_lvTick, LV_TICK_MS);
  document.addEventListener('keydown', _lvKey);
  _lvListen();
  return true;
}
function _lvKey(e){ if(e.key === 'Escape' && LV.on) _liveVoiceStop(); }

function _lvListen(){
  if(!LV.on) return;
  LV.state = 'listening'; LV.vad = null; LV.chunks = []; LV.turnAt = Date.now();
  _voiceSetState('listening', '');
  try{
    LV.rec = new MediaRecorder(LV.stream, LV.mime ? { mimeType: LV.mime } : undefined);
    LV.rec.ondataavailable = (e) => { if(e.data && e.data.size) LV.chunks.push(e.data); };
    LV.rec.start(250);
  }catch(e){ LV.rec = null; }
}

/* A TURN ENDED: what was said goes to the server, and what comes back is sent
   as the message, through the same send as typing. */
function _lvEndTurn(){
  if(LV.state !== 'listening') return;
  LV.state = 'hearing';
  _voiceSetState('thinking', '');
  const heldMs = Date.now() - LV.turnAt;
  const seconds = Math.max(0.5, heldMs / 1000);
  const rec = LV.rec; LV.rec = null;
  const done = async () => {
    const blob = new Blob(LV.chunks, { type: (LV.mime || 'audio/webm').split(';')[0] });
    LV.chunks = [];
    if(!LV.on) return;
    /* Nothing was recorded (the turn ended before the first slice): listen
       again quietly, rather than sending nothing to be refused. */
    /* Firefox hands over one last slice on stop even for a turn ended at
       once - the container's headers and no sound - so a blob with a size is
       not proof anything was said. Sent, it is billed as half a second, and
       silence can come back transcribed as words AMV would then answer.
       Under 300ms nobody has said anything. */
    if(!blob.size || heldMs < 300){ _lvListen(); return; }
    let d;
    try{ d = await AMV_API.transcribeAudio(blob, seconds, ''); }
    catch(e){
      toast(String((e && e.message) || T('AMV could not hear that.')), 'error', 7000);
      /* Out of allowance or not allowed: listening again would only fail again. */
      if(e && (e.status === 402 || e.status === 429 || e.status === 401)) { _liveVoiceStop(); return; }
      _lvListen(); return;
    }
    const text = String((d && d.text) || '').trim();
    if(!text || !LV.on){ _lvListen(); return; }
    _voiceSetState('thinking', text);
    const ta = $('mta'); if(ta) ta.value = text;
    LV.replyIdx = getMsgs().length + 1; LV.spokenUpto = 0; LV.spokenChars = 0; LV.capped = false; LV.replyDone = false;
    try{ await sendMsg(); }catch(e){}
    _lvFollow();
  };
  if(rec && rec.state !== 'inactive'){ rec.onstop = done; try{ rec.stop(); }catch(e){ done(); } }
  else done();
}

/* THE ANSWER, SENTENCE BY SENTENCE, AS IT IS WRITTEN. */
const _LV_SENTENCE = /[^.!?。！？\n]+[.!?。！？]+["')\]]*\s+|[^\n]+\n+/g;
function _lvFollow(){
  clearInterval(LV.follow);
  LV.follow = setInterval(() => {
    if(!LV.on){ clearInterval(LV.follow); return; }
    const msgs = getMsgs();
    const m = msgs[msgs.length - 1];
    if(!m || m.r !== 'a' || msgs.length < LV.replyIdx) return;
    const full = AMVSpeech._clean(typeof m.c === 'string' ? m.c : '');
    const finished = !m.streaming;
    const rest = full.slice(LV.spokenUpto);
    let taken = 0, mt;
    _LV_SENTENCE.lastIndex = 0;
    while((mt = _LV_SENTENCE.exec(rest))){ taken = mt.index + mt[0].length; _lvSay(mt[0]); if(LV.capped) break; }
    LV.spokenUpto += taken;
    if(finished){
      const tail = full.slice(LV.spokenUpto).trim();
      if(tail && !LV.capped) _lvSay(tail);
      LV.spokenUpto = full.length;
      LV.replyDone = true;
      clearInterval(LV.follow);
      if(m._error && !LV.queue.length && !LV.playing) _lvListen();
      else _lvPump();
    }
  }, 250);
}
function _lvSay(text){
  text = String(text || '').trim();
  if(!text || LV.capped) return;
  if(LV.spokenChars + text.length > LV_SPEAK_MAX){
    LV.capped = true;
    text = T('The rest is on screen.');
  } else LV.spokenChars += text.length;
  const item = { text, audio: null, ctrl: null };
  LV.queue.push(item);
  _lvPrefetch();
  _lvPump();
}
function _lvPrefetch(){
  if(!_SPEECH.speak) return;
  let n = 0;
  for(const it of LV.queue){
    if(n++ >= LV_PREFETCH) break;
    if(it.audio) continue;
    it.ctrl = new AbortController();
    it.audio = AMV_API.speakText(it.text, it.ctrl.signal).then(r => r.blob()).catch(e => ({ error: e }));
  }
}
async function _lvPump(){
  if(!LV.on || LV.playing || !LV.queue.length){ _lvMaybeListen(); return; }
  const it = LV.queue.shift();
  LV.state = 'speaking'; LV.vad = null;
  _voiceSetState('speaking', '');
  LV.playing = it;
  const next = () => { if(LV.playing === it) LV.playing = null; _lvPrefetch(); _lvPump(); };
  if(_SPEECH.speak){
    _lvPrefetch();
    const b = await it.audio;
    if(LV.playing !== it) return;
    if(!b || b.error || !(b instanceof Blob)){
      const e = b && b.error;
      if(e && (e.status === 402 || e.status === 429)){ toast(String(e.message || ''), 'error', 7000); _liveVoiceStop(); return; }
      next(); return;
    }
    const url = URL.createObjectURL(b);
    const a = new Audio(url);
    it.el = a;
    const end = () => { try{ URL.revokeObjectURL(url); }catch(e){} next(); };
    a.onended = end; a.onerror = end;
    try{ await a.play(); }catch(e){ end(); }
  } else {
    AMVSpeech.speak(it.text, { onend: next, onerror: next });
  }
}
function _lvMaybeListen(){
  if(LV.on && !LV.playing && !LV.queue.length && LV.replyDone && LV.state !== 'listening' && LV.state !== 'hearing') _lvListen();
}

/* TALKED OVER: everything waiting to be said is dropped - the audio playing,
   the sentences fetched ahead, and the rest of this answer - and it listens.
   The written answer is untouched. */
function _lvBargeIn(){
  if(!LV.on) return;
  clearInterval(LV.follow);
  const all = (LV.playing ? [LV.playing] : []).concat(LV.queue);
  for(const it of all){
    try{ it.ctrl && it.ctrl.abort(); }catch(e){}
    try{ if(it.el){ it.el.pause(); it.el.onended = null; } }catch(e){}
  }
  try{ AMVSpeech.stop(); }catch(e){}
  LV.queue = []; LV.playing = null; LV.replyDone = true; LV.capped = true;
  _lvListen();
}

function _liveVoiceStop(){
  LV.on = false; _voiceMode = false; LV.state = 'idle';
  clearInterval(LV.timer); clearInterval(LV.follow);
  document.removeEventListener('keydown', _lvKey);
  for(const it of (LV.playing ? [LV.playing] : []).concat(LV.queue)){
    try{ it.ctrl && it.ctrl.abort(); }catch(e){}
    try{ it.el && it.el.pause(); }catch(e){}
  }
  LV.queue = []; LV.playing = null;
  try{ AMVSpeech.stop(); }catch(e){}
  try{ LV.rec && LV.rec.state !== 'inactive' && LV.rec.stop(); }catch(e){}
  LV.rec = null; LV.chunks = [];
  try{ LV.stream && LV.stream.getTracks().forEach(t => t.stop()); }catch(e){}
  LV.stream = null;
  try{ LV.ctx && LV.ctx.close(); }catch(e){}
  LV.ctx = null; LV.an = null;
  const btn = $('voicemode-btn'); if(btn) btn.classList.remove('on');
  _hideVoiceOverlay();
}

try{
  window._liveVoiceStart = _liveVoiceStart; window._liveVoiceStop = _liveVoiceStop;
  window._liveVoiceOn = () => LV.on;
  window._lvVad = _lvVad;
  /* For the suite: the turn and the interruption, driven directly, and the
     state to read back - the detector itself is tested through _lvVad. */
  window._lvDrive = { endTurn: _lvEndTurn, bargeIn: _lvBargeIn, state: () => LV.state, queued: () => LV.queue.length };
}catch(e){}
