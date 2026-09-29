/* ══════════════════════════════════════════════════════════════
   CONNECTING WHATEVER SOMEBODY NAMES, FROM CHAT OR THE CREW

   Asked for: "even if it isn't in Connectors, I can tell main chat to connect
   and it does - make sure main chat can connect to anything". Before this,
   chat had no way to connect anything at all: asked to "connect my Slack", it
   could only describe the Integrations page, and asked about an account AMV
   has never heard of, it could only improvise.

   The honest version of "anything" is a resolver with a fixed order, and
   every step ends in something real or says plainly that it does not:

     1. A row in the directory (the apps people use, 13c) - its own Connect,
        the same function the row's button runs.
     2. A mailbox AMV can open by app password (the server's MAIL_PROVIDERS).
     3. The open registry of connectors - thousands of programs, each run on
        the person's own computer through the bridge (13b).
     4. None of those: what can really be done instead. The mailbox that
        receives its statements and alerts, the bank link when it is a bank,
        card or brokerage (it searches thousands of institutions), a file, and
        Notify me - which is recorded, and is what decides what AMV connects
        next.

   It never connects on its own and never says it did. It draws a card in the
   conversation; the person presses the button, and the sign-in happens at the
   service, as it does from the directory. So the tool needs no consent prompt
   of its own: nothing it does changes anything until they press.
   ══════════════════════════════════════════════════════════════ */

const _cxNorm = (s) => String(s || '').toLowerCase().normalize('NFKD')
  .replace(/[̀-ͯ]/g, '').replace(/&amp;/g, ' and ').replace(/[^a-z0-9]+/g, '');

/* The words somebody puts around a name ("my Slack account", "the Point72
   login") are not part of the name. */
function _cxClean(q){
  return String(q || '').replace(/\b(my|our|the|an?|account|accounts|app|login|log in|sign[- ]?in|profile|connection)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

/* Row names are written for reading - "Outlook and Hotmail", "Jira and
   Confluence", "Gmail" - so each is also matched part by part. */
function _cxDirMatch(q){
  const n = _cxNorm(q);
  if(!n || n.length < 2) return null;
  let best = null;
  const rows = (typeof _appCats === 'function') ? _appCats() : [];
  for(const c of rows) for(const a of c.apps){
    const names = [a.name].concat(String(a.name).split(/\s+(?:and|&amp;|&)\s+|\s*\/\s*|\s*,\s*/));
    for(const nm of names){
      const m = _cxNorm(nm);
      if(!m) continue;
      const score = m === n ? 3 : (m.length >= 4 && n.length >= 4 && (n.indexOf(m) === 0 || m.indexOf(n) === 0)) ? 2 : 0;
      if(!score) continue;
      /* A row that connects beats one that does not at the same strength -
         "Google" names several rows, and any of Google's is the right door. */
      if(!best || score > best.score || (score === best.score && a.how && !best.a.how)) best = { a, c, score };
    }
  }
  return best;
}

async function _cxMailMatch(q){
  const n = _cxNorm(q);
  if(!n || !(window.AMV_API && AMV_API.live)) return null;
  let list = [];
  try{ const d = await AMV_API.mailProviders(); list = (d && d.providers) || []; }catch(e){ return null; }
  for(const p of list){
    if(!p || p.custom) continue;
    /* "QQ Mail (QQ邮箱)" is matched on the part before the bracket too. */
    const names = [p.name, String(p.name || '').replace(/\s*\(.*\)\s*$/, ''), p.id];
    if(names.some(nm => { const m = _cxNorm(nm); return m && (m === n || (m.length >= 4 && n.length >= 4 && (m.indexOf(n) === 0 || n.indexOf(m) === 0))); }))
      return p;
  }
  return null;
}

/* What the registry offers under that name - only what the bridge can start,
   which is the filter the server already applies. */
const _CX_REG = {};
async function _cxRegistry(q){
  if(!(window.AMV_API && AMV_API.live) || typeof AMV_API.connectors !== 'function') return { servers:[], err:'' };
  try{
    const d = await AMV_API.connectors(q, '', 5);
    const n = _cxNorm(q);
    /* A result has to be ABOUT the thing asked for: its name or its published
       id has to contain it. The registry's own search is broad, and "we found
       something" is not an answer when the something is unrelated. */
    const servers = ((d && d.servers) || []).filter(s => {
      const hay = _cxNorm(s.name) + ' ' + _cxNorm(s.id);
      return n.length >= 3 && hay.indexOf(n) >= 0;
    }).slice(0, 3);
    servers.forEach(s => { _CX_REG[s.id] = s; });
    return { servers, err:'' };
  }catch(e){ return { servers:[], err: String((e && e.message) || 'The connector registry could not be reached.') }; }
}

/* Banks, cards and brokerages are linked through the bank connection, whose
   own search covers thousands of institutions - so a name that sounds like
   one gets that door first rather than last. */
const _CX_MONEY = /\b(bank|banco|banque|bancorp|credit|card|visa|mastercard|amex|express|brokerage|broker|invest|investing|securities|trading|trade|capital|fund|funds|wealth|savings|401k|ira|pension|retirement|mortgage|loan|finance|financial|wallet|pay|payments|fidelity|vanguard|schwab|robinhood|etrade|chase|citi|wells|hsbc|barclays|santander|revolut|monzo|n26|wise)\b/i;

function _cxSlug(q){ return String(q || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'app'; }

/* The card. Every piece of text is escaped: the name came from the model,
   which may have taken it from anything it read. */
function _cxCard(title, sub, actions, note){
  return '<div class="cx-card" data-no-i18n>'
    + '<div class="cx-head"><span class="cx-mark" aria-hidden="true">' + escH(String(title || '?').trim().charAt(0).toUpperCase()) + '</span>'
    + '<div class="cx-titles"><div class="cx-t">' + escH(title) + '</div>'
    + (sub ? '<div class="cx-sub">' + escH(sub) + '</div>' : '') + '</div></div>'
    + (actions.length ? '<div class="cx-acts">' + actions.map((a, i) =>
        '<button type="button" class="btn ' + (i === 0 ? 'bp' : 'bs') + ' cx-btn" data-dact="chatConnectGo" data-darg="' + escH(a.code) + '"'
        + (a.notify ? ' data-app-notify="' + escH(a.notify) + '" data-app-name="' + escH(a.name || title) + '"' : '')
        + '>' + escH(a.label) + '</button>').join('') + '</div>' : '')
    + (note ? '<p class="cx-note">' + escH(note) + '</p>' : '')
    + '</div>';
}

async function connectAccountTool(input){
  const asked = String((input && (input.service || input.name)) || '').trim().slice(0, 80);
  const q = _cxClean(asked) || asked;
  if(!q) return { text:'No service was named. Ask the person which account or app they want to connect.', render:null };
  const guest = !(typeof S !== 'undefined' && S && S.user && S.user.email);
  const signIn = guest ? ' They are not signed in: pressing it will ask them to create a free account first, because a connection belongs to an account.' : '';

  /* 1. The directory. */
  const hit = _cxDirMatch(q);
  if(hit && hit.a.how){
    const a = hit.a;
    return {
      text:'FOUND in AMV’s directory: ' + a.name + ' (' + String(hit.c.t).replace(/&amp;/g, '&') + '). A Connect button is now shown in the conversation. '
        + 'Nothing is connected yet: the person has to press it and finish the sign-in at ' + a.name + '. Do NOT say it is connected.' + signIn
        + (a.how.indexOf('r:') === 0 || a.how.indexOf('p:') === 0 ? ' Once connected, you can use it in this chat and they are asked before each action.' : ''),
      render:_cxCard(a.name, a.desc || 'Connects through its own sign-in.',
        [{ code:'how:' + a.how, label:'Connect ' + a.name }],
        'The sign-in happens at ' + a.name + '. AMV never sees the password.')
    };
  }

  /* 2. A mailbox. */
  const mbox = await _cxMailMatch(q);
  if(mbox){
    return {
      text:'FOUND: ' + mbox.name + ' is a mailbox AMV connects by app password. A button to set it up is shown. Nothing is connected until they finish that setup - do not say it is.' + signIn,
      render:_cxCard(mbox.name, 'Mail, read and summarised - connected with an app password from ' + mbox.name + '.',
        [{ code:'mailp:' + mbox.id, label:'Set up ' + String(mbox.name).replace(/\s*\(.*\)\s*$/, '') }],
        'The setup shows exactly where ' + String(mbox.name).replace(/\s*\(.*\)\s*$/, '') + ' gives you that password.')
    };
  }

  /* 3. The open registry, and 4. signing in on their own computer - which is
     the one door that opens for ANY service with a password, in any country -
     and what can be done besides. */
  const reg = await _cxRegistry(q);
  const money = _CX_MONEY.test(asked);
  const site = (typeof _browserUrl === 'function') ? _browserUrl(input && input.url) : '';
  const siteHost = site && site !== 'about:blank' ? new URL(site).hostname : '';
  const bridged = typeof BRIDGE !== 'undefined' && BRIDGE.connected;
  const acts = [{ code:'web:' + (site || 'about:blank'), label:'Sign in to ' + q + ' on your computer' }];
  reg.servers.forEach(s => acts.push({ code:'reg:' + s.id, label:'Add ' + s.name }));
  if(money) acts.push({ code:'how:bank', label:'Link a bank or brokerage' });
  acts.push({ code:'how:mail', label:'Connect the mailbox it emails' });
  const notified = typeof _appNotifiedSet === 'function' && _appNotifiedSet().has(_cxSlug(q));
  if(!notified) acts.push({ code:'notify:' + _cxSlug(q), notify:_cxSlug(q), name:q, label:'Notify me when ' + q + ' connects' });

  const regLine = reg.servers.length
    ? 'The open connector registry has ' + reg.servers.length + ' program(s) named for it (' + reg.servers.map(s => s.name + ' - ' + s.id).join('; ') + '). Each runs on THEIR OWN computer through the AMV bridge, which must be connected, and AMV did not write it - say both. Pressing Add shows exactly what will run and what it asks for before anything is added.'
    : (reg.err ? 'The connector registry could not be reached just now (' + reg.err + '), so that option was not checked.'
               : 'The open connector registry has nothing published under that name.');
  const webLine = 'THE FIRST BUTTON works for any service with a sign-in, in any country: "Sign in to ' + q + ' on your computer" opens '
      + (siteHost ? siteHost : 'a blank page (no address was given - pass `url` with the official website when you know it for certain)')
      + ' in a real browser window ON THEIR OWN COMPUTER, through the AMV bridge'
      + (bridged ? ' (connected)' : ' - which is NOT connected yet, so pressing it first takes them to connect their computer; say so') + '. '
      + 'THEY type their own password into the real site in that window; it never passes through chat or AMV. '
      + 'NEVER ask for their password, never repeat one, and never type one - if they paste a password into chat, tell them to change it. '
      + 'Tell them to check the address bar shows the real site before signing in. '
      + 'Once they say they are signed in, you can use the amv-browser tools (open a page, read it, click, fill a form) to do what they asked - each one asks their permission first. '
      + 'It works while that window is open and AMV is open on their computer; it ends when they close it. A scheduled Crew job on AMV’s servers cannot use it. ';
  return {
    text:'NOT DIRECTLY CONNECTABLE by name: "' + asked + '" is not in AMV’s directory and is not a mailbox AMV opens. ' + webLine + regLine + ' '
      + (money ? 'It sounds financial, so the bank link is offered too: it searches thousands of banks, cards and brokerages at the institution’s own sign-in - if it is not found there, it cannot be linked that way. ' : '')
      + 'Other real options, shown as buttons: connect the mailbox that receives its statements and alerts (AMV then reads those), and Notify me, which records the request. They can also upload an export or statement in chat. '
      + 'Tell them plainly what you know about the service, and never claim a connection exists until they have signed in and you have read a page from it.' + signIn,
    render:_cxCard(q, siteHost ? 'Sign in at ' + siteHost + ', in a browser on your computer.' : 'Sign in in a browser on your computer.', acts,
      (siteHost ? 'Check the address bar shows ' + siteHost + ' before you type your password. ' : 'Type its web address in the window that opens. ')
        + 'AMV never sees your password, and asks before every step it takes there.')
  };
}

/* The card's buttons. Each is the same action as the matching directory
   button, never a second copy of it. */
function chatConnectGo(code){
  const c = String(code || '');
  try{
    if(c.indexOf('how:') === 0){
      const how = c.slice(4), k = how.split(':')[0], v = how.indexOf(':') >= 0 ? how.slice(how.indexOf(':') + 1) : '';
      const conn = { g:'google', ms:'outlook', gh:'github', tg:'telegram', sms:'sms', canvas:'canvas' }[how];
      if(conn) return _intConnect(conn, '');
      if(k === 'mail') return _intConnect('mail', v);
      if(k === 'p') return _intConnect('prov', v);
      if(k === 'r') return _intConnect('rmcp', v);
      const use = { bank:'bank', cal:'calfeeds', predict:'predict', jobs:'jobs', everyday:'everyday', coverage:'coverage', vscode:'vscode', file:'chat' }[how];
      if(use) return _intUse(use);
      return;
    }
    if(c.indexOf('web:') === 0) return _cxWebGo(c.slice(4));
    if(c.indexOf('mailp:') === 0) return _intConnect('mail', c.slice(6));
    if(c.indexOf('reg:') === 0){
      const s = _CX_REG[c.slice(4)];
      if(!s){ toast('That connector is no longer in view - ask again and it will be looked up.', 'info', 5000); return; }
      /* cdirOpen reads the directory's own cache, so the entry is put there
         under a key of its own and opened through the one detail view. */
      try{ if(typeof _cdir !== 'undefined') _cdir['__chat:' + s.id] = { state:'done', servers:[s], cursor:'', err:'' }; }catch(e){}
      return cdirOpen(s.id);
    }
    if(c.indexOf('notify:') === 0){
      const btn = document.querySelector('.cx-card [data-app-notify="' + (window.CSS && CSS.escape ? CSS.escape(c.slice(7)) : c.slice(7)) + '"]');
      if(btn && typeof _appNotify === 'function') return _appNotify(btn);
    }
  }catch(e){ try{ toast(String((e && e.message) || 'That could not be opened.'), 'error', 6000); }catch(_e){} }
}
/* "Sign in on your computer". No computer yet: take them to the one place that
   connects it, and say why. Otherwise open the page in AMV's browser there and
   say what happens next - the next step is theirs, in that window. */
let _cxWebBusy = false;
async function _cxWebGo(url){
  if(_cxWebBusy) return;
  if(!(typeof BRIDGE !== 'undefined' && BRIDGE.connected)){
    toast('Connect this computer first - the browser opens on it, so your password never leaves it. Then press Sign in again.', 'info', 8000);
    try{ _connMachineOpen = true; }catch(e){}
    try{ setTab('integrations'); }catch(e){}
    setTimeout(() => { try{ const d = document.querySelector('details.conn-machine'); if(d){ d.open = true; d.scrollIntoView({ block:'start' }); } }catch(e){} }, 250);
    return;
  }
  _cxWebBusy = true;
  toast('Opening a browser on your computer… the first time can take a minute.', 'info', 6000);
  try{
    const u = await browserOpen(url);
    const host = u === 'about:blank' ? '' : new URL(u).hostname;
    toast((host ? host + ' is open in a browser window on your computer. Check the address, sign in there' : 'A browser window is open on your computer. Go to the site and sign in there')
      + ', then tell AMV you are in.', 'success', 10000);
  }catch(e){
    toast(String((e && e.message) || 'The browser could not be opened.'), 'error', 9000);
  }finally{ _cxWebBusy = false; }
}
try{ window.connectAccountTool = connectAccountTool; window.chatConnectGo = chatConnectGo; window._cxDirMatch = _cxDirMatch; window._cxWebGo = _cxWebGo; }catch(e){}
