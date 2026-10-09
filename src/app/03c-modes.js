/* ── HOW AMV TALKS, AND STUDY MODE ─────────────────────────────────────────

   A PERSONALITY is a standing choice, kept with the profile so it follows the
   person to every device and every surface (chat through _profileContext, the
   other surfaces through _userStyle). One sentence each, written as an
   instruction the engine can follow. A tone set for one chat ("keep this chat
   motivational") still wins, because it comes later in the prompt and was
   said more recently.

   STUDY MODE belongs to one conversation, like the temporary flag: AMV
   teaches rather than answers, so the homework is learned rather than copied.
   It says so on the screen, and one press turns it off. */
const PERSONALITIES = [
  ['', 'Default', 'Clear, direct and friendly.'],
  ['concise', 'Concise', 'The answer first, nothing extra.'],
  ['warm', 'Warm', 'Encouraging and patient.'],
  ['professional', 'Professional', 'Precise and formal, like a senior advisor.'],
  ['candid', 'Candid', 'Tells you plainly when something is wrong.'],
  ['playful', 'Playful', 'Lively and witty, never at accuracy’s cost.'],
];
const _PERSONA_TEXT = {
  concise: 'Be brief and direct. Lead with the answer; no preamble and no recap. Use a list only when it genuinely helps.',
  warm: 'Be warm, patient and encouraging, like a supportive expert friend. Acknowledge how the person feels when it matters, without flattery.',
  professional: 'Be precise and formal, like a senior advisor writing to a client: structured, measured, no slang and no emoji.',
  candid: 'Be candid. When something is wrong, risky or a bad idea, say so plainly and explain why; do not soften a conclusion to please. Stay respectful.',
  playful: 'Be lively, with light wit where it fits - but never at the expense of accuracy or clarity, and drop it for anything serious.',
};
function _personality(){ try{ const k = loadStr('amv_personality') || ''; return _PERSONA_TEXT[k] ? k : ''; }catch(e){ return ''; } }
function _personalityLine(){ const k = _personality(); return k ? 'Personality the user chose: ' + _PERSONA_TEXT[k] : ''; }

/* ── Study mode ─────────────────────────────────────────────────────────── */
const _STUDY_PROMPT = '\n\n[STUDY MODE - on for this conversation]\n'
  + 'The person is learning, not looking for an answer to copy. Work like an excellent tutor:\n'
  + '- If it is unclear what they already know or what they are working towards (an exam, homework, curiosity), ask once, briefly.\n'
  + '- Teach in small steps: explain one idea, then ask a question that makes them use it, and wait for their answer.\n'
  + '- Do not hand over the final answer to a homework- or exam-style problem straight away. Give a hint, then a stronger hint, or work a similar example. Give the full solution when they ask for it after trying, and explain every step.\n'
  + '- When they answer, say what is right, correct what is wrong precisely and kindly, and say why.\n'
  + '- Check understanding with one quick question at a time; offer a short quiz when a topic is done.\n'
  + '- Match their language and level. Keep each turn short enough to read in under a minute.\n'
  + '- Close a topic with a three-point summary and offer practice questions.';
function _isStudyChat(){ try{ const c = getCurConv(); return !!(c && c.study); }catch(e){ return false; } }
function _studyContext(){ return _isStudyChat() ? _STUDY_PROMPT : ''; }
function toggleStudyMode(id){
  let c = null;
  try{ c = id ? (S.convs || []).find(x => x && x.id === id) : getCurConv(); }catch(e){}
  if(!c){ try{ newChat(); c = getCurConv(); }catch(e){} }
  if(!c) return;
  c.study = !c.study;
  c.updated = Date.now();
  try{ _autoSave(); }catch(e){}
  try{ if(c.id === S.cur) renderChatMsgs(); }catch(e){}
  try{ toast(c.study ? T('Study mode is on for this chat.') : T('Study mode is off.'), 'success', 2500); }catch(e){}
}
function _studyBannerHTML(){
  return _isStudyChat()
    ? '<div class="temp-row"><div class="temp-banner study-banner" role="note"><b>' + escH(T('Study mode')) + '</b> · '
      + escH(T('AMV teaches step by step and checks your understanding, rather than handing over answers.'))
      + ' <button type="button" class="pj-manage" data-dact="toggleStudyMode">' + escH(T('Turn off')) + '</button></div></div>'
    : '';
}

/* ── Templates: fill in the blanks, then send ──────────────────────────────
   A saved prompt like "Write an essay on [TOPIC]" used to be pasted into the
   box with the brackets still in it. Now each [BLANK] becomes a field. */
function _promptText(p){ return String((p && (p.text != null ? p.text : p.body)) || ''); }
function _templateBlanks(text){
  const seen = new Set(), out = [];
  String(text || '').replace(/\[([A-Z][A-Z0-9 \/&'-]{0,40})\]/g, (m, name) => { if(!seen.has(name)){ seen.add(name); out.push(name); } return m; });
  return out;
}
function openTemplateForm(p){
  const text = _promptText(p), blanks = _templateBlanks(text);
  const r = $('ovr'); if(!r) return;
  const nice = n => n.charAt(0) + n.slice(1).toLowerCase();
  r.innerHTML = '<div class="ov" id="tpl-bg"><div class="ob tpl-ob" role="dialog" aria-modal="true" aria-labelledby="tpl-h">'
    + '<button class="oc" data-dact="closeOvr" aria-label="' + escH(T('Close')) + '">×</button>'
    + '<h2 id="tpl-h">' + escH(p.title || T('Template')) + '</h2>'
    + '<p class="ob-sub">' + escH(T('Fill in the blanks. Anything left empty stays in brackets for you to edit.')) + '</p>'
    + '<form id="tpl-form" class="af">'
    + blanks.map((b, i) => '<div><label class="lbl" for="tpl-' + i + '">' + escH(nice(b)) + '</label>'
        + (/CODE|TEXT|DOCUMENT/.test(b) ? '<textarea id="tpl-' + i + '" rows="4" class="pj-instr"></textarea>' : '<input type="text" id="tpl-' + i + '">') + '</div>').join('')
    + '<div class="pj-row"><button type="submit" class="btn bp">' + escH(T('Put it in the chat box')) + '</button></div></form></div></div>';
  on($('tpl-form'), 'submit', e => {
    e.preventDefault();
    let out = text;
    blanks.forEach((b, i) => { const v = String(($('tpl-' + i) || {}).value || '').trim(); if(v) out = out.split('[' + b + ']').join(v); });
    closeOvr();
    _putInComposer(out);
  });
  setTimeout(() => { try{ const f = $('tpl-0'); if(f) f.focus(); }catch(e){} }, 30);
}
function _putInComposer(text){
  setTab('chat');
  setTimeout(() => {
    const ta = $('mta'); if(!ta) return;
    ta.value = text; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 260) + 'px'; ta.focus();
  }, 100);
}
try{ Object.assign(window, { toggleStudyMode, openTemplateForm }); }catch(e){}
