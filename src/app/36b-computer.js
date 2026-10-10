/* ══════════════════════════════════════════════════════════════════════
   USING THE SCREEN, ONE APPROVED ACTION AT A TIME.

   The bridge can look at the screen and use the mouse and keyboard when the
   person started it with --computer (see the bridge's own THE SCREEN, THE
   MOUSE AND THE KEYBOARD). This is the chat side: five tools, offered only
   when that is really on, and a person in the loop for every one.

   · Seeing the screen is asked once per request, because a screenshot is the
     whole screen - whatever else is open goes to the engine with it.
   · Every click, keystroke and scroll is asked one by one. A click is shown
     as a mark on the latest picture of the screen, because "click at
     612,340" is not something anybody can consent to.
   · Text that looks like a password, card number or code is refused before
     anybody is asked. The person types those themselves.
   · Screenshots never go into the saved chat: they live in this tab only,
     and only the latest few travel to the engine.
   ══════════════════════════════════════════════════════════════════════ */

/* The widest picture sent to the engine. A 4K screenshot costs several times
   what a 1280-wide one does and reads no better. */
const CU_MAX_W = 1280;
/* How many screenshots, newest first, are sent with each request. */
const CU_KEEP_SHOTS = 3;

const COMPUTER_TOOLS = [
  { name: 'computer_screenshot',
    description: 'See the user\'s screen as it is right now, on the computer their AMV bridge runs on. Returns a picture. '
      + 'Coordinates for the other computer_ tools are pixels in the LATEST picture. Take one before acting, and again after '
      + 'anything that changes the screen, rather than assuming what happened.',
    input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'computer_click',
    description: 'Click on the user\'s screen at x,y - pixels in the latest screenshot. The user approves each click. '
      + 'button defaults to left; double:true for a double click.',
    input_schema: { type: 'object', properties: {
      x: { type: 'integer' }, y: { type: 'integer' },
      button: { type: 'string', enum: ['left', 'right', 'middle'] }, double: { type: 'boolean' },
    }, required: ['x', 'y'] } },
  { name: 'computer_type',
    description: 'Type text into whatever has the keyboard focus on the user\'s screen - click the field first. The user '
      + 'approves it. Never type a password, card number or one-time code: ask the user to type those themselves.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'computer_key',
    description: 'Press a key or a combination on the user\'s keyboard, like "enter", "tab", "escape", "ctrl+c", "cmd+t" '
      + 'or "alt+f4". One key besides ctrl, alt, shift and cmd. The user approves it.',
    input_schema: { type: 'object', properties: { keys: { type: 'string' } }, required: ['keys'] } },
  { name: 'computer_scroll',
    description: 'Scroll the user\'s screen at x,y (pixels in the latest screenshot), up, down, left or right, by 1 to 15 steps.',
    input_schema: { type: 'object', properties: {
      x: { type: 'integer' }, y: { type: 'integer' },
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'integer' },
    }, required: ['x', 'y', 'direction'] } },
];
try{ window.COMPUTER_TOOLS = COMPUTER_TOOLS; }catch(e){}

/* What this tab knows about the screen. `k` turns the picture the engine saw
   back into the picture the bridge took: the engine sees a smaller copy. */
const _CU = { k: 1, w: 0, h: 0, src: '', seeFor: -1, shots: new Map() };
try{ window._CU = _CU; }catch(e){}

function isComputerTool(name){ return /^computer_(screenshot|click|type|key|scroll)$/.test(String(name || '')); }
function computerReady(){
  try{ return !!(BRIDGE.connected && BRIDGE.computer && BRIDGE.computer.on === true); }catch(e){ return false; }
}
/* Only where they can work: a computer that says yes, and an engine that can
   read a picture. A partner engine is sent pictures as a note that it cannot
   read them, so offering it a screen would be offering it a blindfold. */
function computerToolsOffered(){
  if(!computerReady()) return [];
  try{ if(MODELS[S.model] && MODELS[S.model].partner) return []; }catch(e){}
  return COMPUTER_TOOLS;
}
try{ window.isComputerTool = isComputerTool; window.computerReady = computerReady;
     window.computerToolsOffered = computerToolsOffered; }catch(e){}

/* The request the person is on - the count of things they have said. A
   permission to see the screen lasts until they say something new. */
function _cuTurn(){ try{ return (getMsgs() || []).filter(m => m && m.r === 'u').length; }catch(e){ return 0; } }

/* A picture from the bridge, scaled to what the engine needs, as a JPEG. */
function _cuShrink(pngB64){
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const s = Math.min(1, CU_MAX_W / Math.max(1, w));
      const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(img, 0, 0, cw, ch);
      resolve({ src: c.toDataURL('image/jpeg', 0.8), w: cw, h: ch, k: w / cw });
    };
    img.onerror = () => resolve(null);
    img.src = 'data:image/png;base64,' + pngB64;
  });
}

/* The engine's coordinates, checked against the picture it was given. */
function _cuPoint(input){
  const x = Number(input && input.x), y = Number(input && input.y);
  if(!_CU.src) return { error: 'Take a screenshot first, so there is a picture to point at.' };
  if(!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= _CU.w || y >= _CU.h)
    return { error: 'That point is outside the latest screenshot (' + _CU.w + 'x' + _CU.h + ').' };
  return { x, y, bx: Math.round(x * _CU.k), by: Math.round(y * _CU.k) };
}

/* WHAT THE PERSON IS ASKED. Seeing once per request; everything else, each
   time, with the place marked when there is a place. */
async function computerConsent(name, input){
  input = input || {};
  if(name === 'computer_screenshot'){
    if(_CU.seeFor === _cuTurn()) return true;
    const ok = await _showModalAsync({
      title: T('Let AMV see your screen?'),
      body: T('AMV will take pictures of your whole screen while it works on this request, and send them to its engine to read. '
            + 'Close or hide anything private first. It asks again when you send something new.'),
      okText: T('Let it see'), cancelText: T('Not now'),
    });
    if(ok === true) _CU.seeFor = _cuTurn();
    return ok === true;
  }
  let title = '', body = '', figure = null;
  if(name === 'computer_click' || name === 'computer_scroll'){
    const p = _cuPoint(input);
    if(p.error) return true;                      // nothing will happen; the run says why
    figure = { src: _CU.src, x: p.x / _CU.w, y: p.y / _CU.h };
    if(name === 'computer_click'){
      const how = (input.double ? 'double-' : '') + (input.button === 'right' ? 'right-' : input.button === 'middle' ? 'middle-' : '') + 'click';
      title = T('Let AMV ' + how + ' here?');
      body = T('The mark shows where, on the latest picture of your screen.');
    } else {
      title = T('Let AMV scroll ' + String(input.direction || 'down') + ' here?');
      body = T('The mark shows where, on the latest picture of your screen.');
    }
  } else if(name === 'computer_type'){
    title = T('Let AMV type this?');
    body = T('Into whatever is selected on your screen right now:') + '\n\n' + String(input.text || '').slice(0, 600);
  } else if(name === 'computer_key'){
    title = T('Let AMV press') + ' ' + String(input.keys || '').slice(0, 40) + '?';
    body = T('On your keyboard, in whatever window is in front.');
  }
  const ok = await _showModalAsync({ title, body, figure, okText: T('Allow once'), cancelText: T('Deny') });
  return ok === true;
}
try{ window.computerConsent = computerConsent; }catch(e){}

/* The text it will not type, said before anybody is asked to approve it. */
function computerRefusal(name, input){
  if(name !== 'computer_type') return '';
  let kinds = [];
  try{ kinds = (typeof findSecrets === 'function') ? findSecrets(String((input && input.text) || '')) : []; }catch(e){ kinds = []; }
  if(!kinds.length) return '';
  return 'AMV will not type ' + kinds[0] + ' for the user. Ask them to type it themselves, then carry on.';
}
try{ window.computerRefusal = computerRefusal; }catch(e){}

/* RUN ONE. Returns { text, image? } - the image only for a screenshot. */
async function runComputerTool(name, input){
  input = input || {};
  try{
    if(name === 'computer_screenshot'){
      const r = await _bridgeCall('screen/shot', {}, 30000);
      const s = await _cuShrink(r.png || '');
      if(!s) return { text: 'The screenshot could not be read.' };
      Object.assign(_CU, { k: s.k, w: s.w, h: s.h, src: s.src });
      return { text: 'The user\'s screen, ' + s.w + 'x' + s.h + '. Coordinates are pixels in this picture.',
               image: { media_type: 'image/jpeg', data: s.src.split(',')[1] } };
    }
    let body;
    if(name === 'computer_click' || name === 'computer_scroll'){
      const p = _cuPoint(input);
      if(p.error) return { text: p.error };
      body = name === 'computer_scroll'
        ? { kind: 'scroll', x: p.bx, y: p.by, direction: input.direction, amount: input.amount == null ? 3 : input.amount }
        : { kind: input.double ? 'double_click' : input.button === 'right' ? 'right_click' : input.button === 'middle' ? 'middle_click' : 'click',
            x: p.bx, y: p.by };
    } else if(name === 'computer_type') body = { kind: 'type', text: String(input.text || '') };
    else if(name === 'computer_key') body = { kind: 'key', keys: String(input.keys || '') };
    else return { text: 'There is no screen action called ' + name + '.' };
    await _bridgeCall('screen/act', body, 30000);
    const said = { click: 'Clicked', double_click: 'Double-clicked', right_click: 'Right-clicked', middle_click: 'Middle-clicked',
                   scroll: 'Scrolled ' + body.direction, type: 'Typed the text', key: 'Pressed ' + body.keys }[body.kind];
    return { text: said + (input.x != null ? ' at ' + input.x + ',' + input.y : '') + '. Take a screenshot to see what changed.' };
  }catch(e){
    return { text: 'That did not work: ' + String((e && e.message) || e) };
  }
}
try{ window.runComputerTool = runComputerTool; }catch(e){}

/* WHAT GOES ON THE WIRE. A saved tool result carries `_shot` and no picture;
   the picture is in this tab's memory, keyed by the call it answered. The
   newest few are attached, the rest say they were taken, and `_shot` never
   reaches the server. */
function computerWireResults(results){
  if(!Array.isArray(results)) return results;
  return results.map(r => {
    if(!r || !r._shot) return r;
    const out = { type: r.type, tool_use_id: r.tool_use_id };
    const keep = [..._CU.shots.keys()].slice(-CU_KEEP_SHOTS);
    const img = keep.includes(r.tool_use_id) ? _CU.shots.get(r.tool_use_id) : null;
    out.content = img
      ? [{ type: 'text', text: String(r.content || '') }, { type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } }]
      : String(r.content || '') + ' (This earlier picture is no longer attached.)';
    return out;
  });
}
try{ window.computerWireResults = computerWireResults; }catch(e){}
