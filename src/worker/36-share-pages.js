/* =====================================================================
   AMV-074: PUBLIC SHARE PAGES.

   Sharing already worked, but it encoded the whole conversation into a URL
   FRAGMENT. A fragment is never sent to a server, so a shared link pasted into
   Slack, iMessage or X renders with no title, no description and no preview -
   it looks like a bare URL, which reads as spam and does not get clicked. For
   a product whose growth depends on people showing each other what it did,
   that is the difference between a distribution loop and no loop at all. The
   fragment also broke past ~8000 characters, which the old code warned about
   rather than solved.

   A shared conversation is now a real page the server can render, with proper
   preview tags, and the owner can revoke it - which is what the privacy screen
   already promised.

   Deliberately NOT indexable. Search engines are told to stay away: people
   share personal conversations with a colleague, not with the open web, and
   the alternative is the well-known failure mode of private chats turning up
   in search results. Link sharing is the loop; indexing is a liability.

   The page ships with NO JavaScript at all and a locked-down policy, because
   it renders text written by a stranger's model output to anyone who opens it.
   ===================================================================== */
/* CREW GAMES - the execution layer.

   A Crew job can already think and write. What it could not do is produce
   something OTHER PEOPLE INTERACT WITH and read their answers back. Without
   that, every "Friday game night" template is a nicely worded message and
   nothing else: the loop dies at distribution because nothing can receive.

   agent makes a game -> a link -> people answer -> state is held ->
   results are computed -> the group is told.

   WHAT JOINING WITHOUT AN ACCOUNT FORCES, and none of it is optional.

   The link IS the credential. There is no password behind it, so the id
   carries full entropy and a participant token is issued per person.

   No account means NO AGE RECORD, and this product gates money on a confirmed
   birth year. So a game may never touch money, and that is enforced on the
   server rather than by whoever writes the prompt.

   Answers are untrusted input that lands on other people's screens: control
   characters stripped, length bounded, one submission per player, escaped
   where rendered.

   There is no account to rate-limit by, so joins and answers are limited by IP.

   A participant record is personal data with nobody's account behind it, so it
   carries a TTL and dies with the game.

   And nothing leaks before the reveal - not the answers, not the tally, not
   who else joined. A game that shows the running score is a game everybody
   waits to answer last. */
const GAME_ID_RE       = /^[a-z0-9]{24}$/;
const GAME_TOK_RE      = /^[a-z0-9]{24}$/;
const GAME_MAX_PROMPTS = 25;
const GAME_MAX_PLAYERS = 200;
const GAME_ANSWER_MAX  = 280;
const GAME_NICK_MAX    = 24;
const GAME_TTL_MS      = 30 * 86400000;

/* Money words are refused at CREATION rather than at render, because a game
   that reaches somebody's screen asking for a card has already done the harm
   the age gate exists to prevent - and the people in it may have no age on
   record at all. */
const GAME_FORBIDDEN = /\b(pay|payment|card|credit|iban|paypal|deposit|withdraw|payout|invoice|price|checkout|subscribe|crypto|wallet)\b/i;

const _gameId  = () => _randId(24);
const _gameTok = () => _randId(24);

/* Written by people with no account, read by everybody else in the group.
   Filtered by codepoint rather than a character class so the rule is visible
   in the source instead of hiding inside an escape. */
function _gameSafeText(v, max) {
  const raw = String(v == null ? '' : v);
  let out = '';
  for (const ch of raw) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c !== 127) out += ch;
  }
  return out.slice(0, max);
}

/* What a participant may see, at each stage. Built in ONE place so a field
   added to the record later cannot leak by default. */
function _gamePublicView(g, state) {
  const out = {
    id: g.id, title: g.title, kind: g.kind, state,
    prompts: (g.prompts || []).map(p => ({ id: p.id, text: p.text, options: p.options || null })),
    players: (g.players || []).length,
    closesAt: g.closesAt || null,
  };
  if (state === 'revealed') {
    out.results = g.results || null;
    out.answers = (g.answers || []).map(a => ({ nick: a.nick, values: a.values }));
  }
  return out;
}

/* POST /v1/game/create - the agent, or its owner, makes a game. */
async function gameCreate(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const blocked = await guardAction(env, `gamenew:${user.email}`, 6, 60, 'games');
  if (blocked) return blocked;

  const body = await request.json().catch(() => ({}));
  const title = _gameSafeText(body.title || 'Game', 120);
  const kind = _gameSafeText(body.kind || 'poll', 40);
  const raw = Array.isArray(body.prompts) ? body.prompts.slice(0, GAME_MAX_PROMPTS) : [];
  const prompts = raw.map((p, i) => ({
    id: 'q' + i,
    text: _gameSafeText(p && p.text, 300),
    options: Array.isArray(p && p.options)
      ? p.options.slice(0, 10).map(o => _gameSafeText(o, 80)).filter(Boolean)
      : null,
  })).filter(p => p.text);
  if (!prompts.length) return json({ error: 'a game needs at least one question' }, 400);

  /* THE AGE GATE REACHES IN HERE, because the people who will answer arrive by
     link and may have no age on record at all. */
  const scan = title + ' ' + prompts.map(p => p.text + ' ' + (p.options || []).join(' ')).join(' ');
  if (GAME_FORBIDDEN.test(scan)) {
    audit(env, 'game_money_refused', { email: user.email });
    return json({
      error: 'A game cannot ask for money or payment details. People join these by link without an account, '
           + 'so AMV has no way to know how old they are.',
      code: 'game_no_money',
    }, 400);
  }

  const id = _gameId();
  const closesAt = Number.isFinite(+body.closesAt) ? Math.min(+body.closesAt, Date.now() + GAME_TTL_MS) : null;
  const rec = {
    id, title, kind, prompts, owner: String(user.email).toLowerCase(),
    state: 'open', at: Date.now(), closesAt,
    players: [], answers: [], results: null,
  };
  /* Through the lock, like every other writer of this kind. A fresh id cannot
     race anything today, but "this one is safe to write raw" is the sentence
     that ends with two writers and one of them lost. */
  await _withKind(env, 'game', id, (fresh) => { Object.assign(fresh, rec); }, rec);
  await _withKind(env, 'gameown', rec.owner, (r) => {
    r.ids = [id].concat((r.ids || []).filter(x => x !== id)).slice(0, 200);
  }, { ids: [] });
  audit(env, 'game_created', { email: user.email, id, kind, prompts: prompts.length });
  return json({ ok: true, id, joinPath: '/g/' + id, game: _gamePublicView(rec, 'open') });
}

/* POST /v1/game/join  { id, nick } - PUBLIC. No account required. */
async function gameJoin(request, env) {
  const ip = await _ipHash(env, request);
  const blocked = await guardAction(env, `gamejoin:${ip}`, 20, 200, 'joining games');
  if (blocked) return blocked;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!GAME_ID_RE.test(id)) return json({ error: 'no such game' }, 404);
  const g = await DB.get(env, 'game', id);
  if (!g) return json({ error: 'no such game' }, 404);
  if (g.state !== 'open') return json({ error: 'This game has already closed.', code: 'game_closed' }, 409);

  const nick = _gameSafeText(body.nick, GAME_NICK_MAX).trim();
  if (!nick) return json({ error: 'pick a name to play under' }, 400);

  const tok = _gameTok();
  let full = false, taken = false;
  await _withKind(env, 'game', id, (fresh) => {
    if (!fresh) return;
    const players = fresh.players || (fresh.players = []);
    if (players.length >= GAME_MAX_PLAYERS) { full = true; return; }
    if (players.some(p => String(p.nick).toLowerCase() === nick.toLowerCase())) { taken = true; return; }
    players.push({ tok, nick, at: Date.now() });
  }, null);
  if (full) return json({ error: 'This game is full.', code: 'game_full' }, 409);
  if (taken) return json({ error: 'Somebody is already playing under that name. Pick another.', code: 'nick_taken' }, 409);

  const fresh = await DB.get(env, 'game', id) || g;
  /* The token is the only thing this person will ever have. Returned once,
     listed nowhere. */
  return json({ ok: true, token: tok, nick, game: _gamePublicView(fresh, fresh.state) });
}

/* POST /v1/game/answer  { id, token, values } - PUBLIC, one per player. */
async function gameAnswer(request, env) {
  const ip = await _ipHash(env, request);
  const blocked = await guardAction(env, `gameans:${ip}`, 30, 300, 'answers');
  if (blocked) return blocked;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  const token = String(body.token || '');
  if (!GAME_ID_RE.test(id) || !GAME_TOK_RE.test(token)) return json({ error: 'no such game' }, 404);
  const g = await DB.get(env, 'game', id);
  if (!g) return json({ error: 'no such game' }, 404);

  const me = (g.players || []).find(p => p.tok === token);
  /* A wrong token is answered exactly like a wrong id: somebody probing must
     not learn that the game exists. */
  if (!me) return json({ error: 'no such game' }, 404);
  if (g.state !== 'open') return json({ error: 'Answers are closed for this game.', code: 'game_closed' }, 409);

  const values = {};
  for (const p of (g.prompts || [])) {
    const v = body.values && body.values[p.id];
    if (v == null) continue;
    values[p.id] = _gameSafeText(v, GAME_ANSWER_MAX);
  }
  if (!Object.keys(values).length) return json({ error: 'nothing answered' }, 400);

  /* ONE SUBMISSION PER PLAYER, decided INSIDE the lock. Two taps on a phone
     with a slow connection is the ordinary way to send this twice, and a second
     answer counted twice is a rigged game. */
  let already = false;
  await _withKind(env, 'game', id, (fresh) => {
    if (!fresh) return;
    fresh.answers = fresh.answers || [];
    if (fresh.state !== 'open') { already = true; return; }
    if (fresh.answers.some(a => a.tok === token)) { already = true; return; }
    fresh.answers.push({ tok: token, nick: me.nick, values, at: Date.now() });
  }, null);

  const after = await DB.get(env, 'game', id) || g;
  /* Idempotent on purpose: a duplicate is answered as success, because the
     player did what they meant to do and blaming them for a dropped connection
     helps nobody. `recorded` says which it was. */
  return json({
    ok: true, recorded: !already,
    answered: (after.answers || []).length,
    players: (after.players || []).length,
  });
}

/* POST /v1/game/state  { id, token } - PUBLIC. What this player may see. */
async function gameState(request, env) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!GAME_ID_RE.test(id)) return json({ error: 'no such game' }, 404);
  const g = await DB.get(env, 'game', id);
  if (!g) return json({ error: 'no such game' }, 404);
  const token = String(body.token || '');
  const me = GAME_TOK_RE.test(token) ? (g.players || []).find(p => p.tok === token) : null;
  const view = _gamePublicView(g, g.state);
  /* Their own answer comes back so a returning phone can show it. Everybody
     else's stays hidden until the reveal. */
  if (me) {
    const mine = (g.answers || []).find(a => a.tok === token);
    view.you = { nick: me.nick, answered: !!mine, values: mine ? mine.values : null };
  }
  return json({ ok: true, game: view });
}

/* POST /v1/game/close  { id } - the owner stops the clock. */
async function gameClose(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!GAME_ID_RE.test(id)) return json({ error: 'no such game' }, 404);
  const g = await DB.get(env, 'game', id);
  /* Not theirs reads as not there, so a stranger with a valid id learns
     nothing about whose it is. */
  if (!g || g.owner !== String(user.email).toLowerCase()) return json({ error: 'no such game' }, 404);
  await _withKind(env, 'game', id, (fresh) => {
    if (fresh && fresh.state === 'open') fresh.state = 'closed';
  }, null);
  return json({ ok: true, state: 'closed' });
}

/* POST /v1/game/reveal  { id } - counted once, by the owner.

   Scored INSIDE the lock and refused once revealed, because a tally that can
   be recomputed is a tally somebody can move: answer, reveal, answer again,
   reveal again. The results are written with the state in one pass so there is
   no moment where a game is revealed with nothing to show. */
async function gameReveal(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!GAME_ID_RE.test(id)) return json({ error: 'no such game' }, 404);
  const g = await DB.get(env, 'game', id);
  if (!g || g.owner !== String(user.email).toLowerCase()) return json({ error: 'no such game' }, 404);

  let already = false;
  await _withKind(env, 'game', id, (fresh) => {
    if (!fresh) return;
    if (fresh.state === 'revealed') { already = true; return; }
    const tally = {};
    for (const p of (fresh.prompts || [])) {
      const counts = {};
      for (const a of (fresh.answers || [])) {
        const v = a.values && a.values[p.id];
        if (v == null || v === '') continue;
        counts[v] = (counts[v] || 0) + 1;
      }
      /* Sorted by votes, then by value, so a tie is resolved the same way on
         every run rather than by whatever order the object happened to hold. */
      const ranked = Object.keys(counts)
        .map(k => ({ value: k, votes: counts[k] }))
        .sort((x, y) => y.votes - x.votes || (x.value < y.value ? -1 : 1));
      tally[p.id] = {
        text: p.text,
        ranked,
        top: ranked.length ? ranked[0] : null,
        tied: ranked.length > 1 && ranked[0].votes === ranked[1].votes,
      };
    }
    fresh.results = {
      tally,
      answered: (fresh.answers || []).length,
      players: (fresh.players || []).length,
      at: Date.now(),
    };
    fresh.state = 'revealed';
  }, null);

  const after = await DB.get(env, 'game', id) || g;
  if (already) return json({ ok: true, already: true, game: _gamePublicView(after, after.state) });
  audit(env, 'game_revealed', { email: user.email, id, answered: (after.answers || []).length });
  return json({ ok: true, game: _gamePublicView(after, after.state) });
}

/* POST /v1/game/mine - the owner's games, for the host view. */
async function gameMine(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const idx = (await DB.get(env, 'gameown', String(user.email).toLowerCase())) || { ids: [] };
  const out = [];
  for (const id of (idx.ids || []).slice(0, 50)) {
    const g = await DB.get(env, 'game', id);
    if (!g) continue;
    /* The host may see WHO has answered - it is their game and the whole point
       of the screen is chasing the two people who have not - but not WHAT
       anybody said until the reveal. */
    out.push({
      id: g.id, title: g.title, kind: g.kind, state: g.state, at: g.at,
      players: (g.players || []).map(p => p.nick),
      answeredBy: (g.answers || []).map(a => a.nick),
      results: g.state === 'revealed' ? g.results : null,
    });
  }
  return json({ ok: true, games: out });
}

/* GET /g/<id> - the page a stranger opens.

   Self-contained on purpose: somebody arriving from a group chat on a phone
   should not download the whole app to answer two questions, and they have no
   account to load it with.

   The share page next door bans scripts outright (`default-src 'none'`), which
   is right for a page that only renders text. This one has to join and submit,
   so it gets a per-response NONCE instead - one inline script, pinned to this
   response, with `connect-src 'self'` for the two calls it makes. That is a
   narrower grant than 'unsafe-inline' and it cannot be reused on another
   response.

   Everything interpolated is escaped. The title and questions were written by
   the game's owner, and every answer shown after the reveal was written by
   somebody with no account at all. */
async function gamePage(request, env, id) {
  const gone = (msg) => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">' +
    '<title>Not available - AMV.AI</title>' +
    '<div style="font:15px/1.6 system-ui;padding:60px 24px;max-width:600px;margin:auto;text-align:center">' +
    '<h1 style="font-size:20px">' + _shareEsc(msg) + '</h1>' +
    '<p style="color:#666">This game may have finished, or the link may be wrong.</p></div>',
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' } });

  if (!GAME_ID_RE.test(String(id || ''))) return gone('That link is not valid');
  const g = await DB.get(env, 'game', id);
  if (!g) return gone('This game is no longer available');

  const nonce = _randId(16);
  const title = _shareEsc(g.title || 'Game');
  const qs = (g.prompts || []).map(p =>
    '<div class="q" data-q="' + _shareEsc(p.id) + '">' +
      '<div class="qt">' + _shareEsc(p.text) + '</div>' +
      (Array.isArray(p.options) && p.options.length
        ? '<div class="opts">' + p.options.map(o =>
            '<button type="button" class="opt" data-v="' + _shareEsc(o) + '">' + _shareEsc(o) + '</button>').join('') + '</div>'
        : '<input class="ans" maxlength="280" placeholder="Your answer">') +
    '</div>').join('');

  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + ' - AMV.AI</title>' +
    '<meta name="robots" content="noindex,nofollow">' +
    '<style>' +
    ':root{color-scheme:light dark}' +
    'body{margin:0;font:16px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0f1014;color:#f2f3f5}' +
    '.wrap{max-width:560px;margin:0 auto;padding:28px 18px 64px}' +
    'h1{font-size:22px;margin:0 0 4px}.sub{color:#9aa0aa;font-size:14px;margin:0 0 22px}' +
    '.q{background:#181a20;border:1px solid #252833;border-radius:14px;padding:14px;margin:0 0 12px}' +
    '.qt{font-weight:600;margin-bottom:10px}' +
    '.ans,.nick{width:100%;box-sizing:border-box;background:#0f1014;border:1px solid #2d313d;border-radius:10px;padding:12px;color:#f2f3f5;font:inherit}' +
    '.opts{display:flex;flex-wrap:wrap;gap:8px}' +
    '.opt{background:#0f1014;border:1px solid #2d313d;border-radius:999px;padding:9px 14px;color:#f2f3f5;font:inherit;cursor:pointer}' +
    '.opt[aria-pressed="true"]{background:#2b6fff;border-color:#2b6fff}' +
    '.go{width:100%;margin-top:8px;background:#2b6fff;border:0;border-radius:12px;padding:14px;color:#fff;font:600 16px inherit;cursor:pointer}' +
    '.go[disabled]{opacity:.5;cursor:default}' +
    '.msg{margin-top:14px;color:#9aa0aa;font-size:14px;min-height:20px}' +
    '.res{background:#181a20;border:1px solid #252833;border-radius:14px;padding:14px;margin:0 0 12px}' +
    '.row{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid #23262f}' +
    '.row:last-child{border-bottom:0}.win{color:#7dd88f;font-weight:600}' +
    '.foot{margin-top:28px;color:#6b7280;font-size:12px;text-align:center}' +
    '</style></head><body><div class="wrap">' +
    '<h1>' + title + '</h1>' +
    '<p class="sub" id="sub">Join to play. No account needed.</p>' +
    '<div id="joinbox"><input class="nick" id="nick" maxlength="24" placeholder="Your name" autocomplete="off">' +
    '<button class="go" id="joinbtn">Join</button></div>' +
    '<div id="playbox" hidden>' + qs + '<button class="go" id="send">Send answers</button></div>' +
    '<div id="resbox" hidden></div>' +
    '<div class="msg" id="msg" role="status"></div>' +
    '<div class="foot">Answers are visible to everyone in this game once it is revealed.</div>' +
    '</div><script nonce="' + nonce + '">' +
    '(function(){' +
    'var ID=' + JSON.stringify(id) + ',K="amvg:"+ID,tok="";' +
    'try{tok=localStorage.getItem(K)||""}catch(e){}' +
    'var $=function(i){return document.getElementById(i)};' +
    'function say(t){$("msg").textContent=t||""}' +
    'function post(n,b){return fetch("/v1/game/"+n,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return{}})})}' +
    'function vals(){var o={};document.querySelectorAll(".q").forEach(function(q){var k=q.getAttribute("data-q");var s=q.querySelector(\'.opt[aria-pressed="true"]\');var i=q.querySelector(".ans");var v=s?s.getAttribute("data-v"):(i?i.value:"");if(v)o[k]=v});return o}' +
    'document.querySelectorAll(".opts").forEach(function(g){g.addEventListener("click",function(e){var b=e.target.closest(".opt");if(!b)return;g.querySelectorAll(".opt").forEach(function(x){x.setAttribute("aria-pressed","false")});b.setAttribute("aria-pressed","true")})});' +
    'function showResults(g){var h="";Object.keys(g.results&&g.results.tally||{}).forEach(function(k){var t=g.results.tally[k];h+=\'<div class="res"><div class="qt">\'+esc(t.text)+\'</div>\';(t.ranked||[]).forEach(function(r,i){h+=\'<div class="row"><span class="\'+(i===0&&!t.tied?"win":"")+\'">\'+esc(r.value)+\'</span><span>\'+r.votes+\'</span></div>\'});h+="</div>"});$("resbox").innerHTML=h;$("resbox").hidden=false;$("playbox").hidden=true;$("joinbox").hidden=true;$("sub").textContent=(g.results?g.results.answered:0)+" answered";}' +
    'function esc(s){var d=document.createElement("div");d.textContent=String(s==null?"":s);return d.innerHTML}' +
    'function refresh(){return post("state",{id:ID,token:tok}).then(function(d){var g=d&&d.game;if(!g)return;if(g.state==="revealed"){showResults(g);return}' +
    'if(tok){$("joinbox").hidden=true;$("playbox").hidden=false;' +
    'if(g.you&&g.you.answered){$("send").disabled=true;$("send").textContent="Answer sent";say("Waiting for the others. "+g.players+" playing.")}else{say(g.players+" playing.")}}' +
    'if(g.state==="closed"&&!(g.you&&g.you.answered)){$("send").disabled=true;say("Answers are closed.")}})}' +
    '$("joinbtn").addEventListener("click",function(){var n=$("nick").value.trim();if(!n){say("Pick a name first.");return}' +
    '$("joinbtn").disabled=true;post("join",{id:ID,nick:n}).then(function(d){$("joinbtn").disabled=false;' +
    'if(!d||!d.token){say(d&&d.error||"Could not join.");return}tok=d.token;try{localStorage.setItem(K,tok)}catch(e){}refresh()})});' +
    '$("send").addEventListener("click",function(){var v=vals();if(!Object.keys(v).length){say("Answer at least one.");return}' +
    '$("send").disabled=true;post("answer",{id:ID,token:tok,values:v}).then(function(d){' +
    'if(d&&d.ok){$("send").textContent="Answer sent";say("Waiting for the others.")}else{$("send").disabled=false;say(d&&d.error||"Could not send.")}})});' +
    'refresh();setInterval(refresh,5000);' +
    '})();</script></body></html>';

  return new Response(html, { status: 200, headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    /* One inline script, pinned to this response by nonce, talking only to this
       origin. Narrower than 'unsafe-inline' and not reusable elsewhere. */
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  } });
}


/* A SCHEDULED JOB THAT MAKES SOMETHING PLAYABLE.

   Every other job kind ends by writing text somebody reads. This one ends by
   creating a real game and handing back the link, which is the difference
   between "Crew wrote you some questions" and "Crew set up Friday night".

   Called from the run loop after the model has produced its lines, so the
   questions are this week's rather than a fixed list. If game creation fails
   the run is NOT failed: the questions are still worth having, and a job that
   reports failure because a link could not be minted has thrown away the work
   it did. The result says which happened.

   The age gate reaches in here exactly as it does on the route, because people
   answer these by link with no account and no birth year on record. A job whose
   questions drift towards money produces no game and says so. */
/* Turn a game job's questions into a real game and hand the link back with the
   text, so it travels wherever the result travels - the in-app card, the email,
   the digest - rather than living somewhere they have to go and find.

   A no-op for every other kind, and called as a single folded expression at the
   call site with NO comment above it. That is deliberate: `a-timer-cannot-act-
   on-your-behalf` finds the delivery guard by searching 8000 characters forward
   from `const level = ...`, and `codeOnly` blanks comments to whitespace of the
   SAME LENGTH rather than removing them - so a comment sitting in that window
   spends the budget exactly as code would. Five lines of explanation there cost
   390 characters and pushed a safety check out of range.

   A failure here does NOT fail the run. The questions are still worth having,
   and a job that reports failure because a link could not be minted has thrown
   away the work it did. */
async function _autoAppendGame(env, email, item, out) {
  if (item.kind !== 'game' || !out) return out;
  try {
    const made = await _autoMakeGame(env, email, item, out);
    if (made && made.url) {
      return out + '\n\nYour game is ready - send this to the group:\n' + made.url
                 + '\n\nNobody sees the answers until you reveal them, in Crew.';
    }
    if (made && made.refused) return out + '\n\n' + made.refused;
    return out;
  } catch (e) {
    audit(env, 'game_from_automation_failed', { email, error: String((e && e.message) || e) });
    return out + '\n\n(The questions are above - AMV could not create the game link this time.)';
  }
}

async function _autoMakeGame(env, email, item, text) {
  const lines = String(text || '')
    .split('\n')
    .map(l => l.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(l => l.length > 3 && l.length <= 300 && /\?|most likely|would you|who/i.test(l))
    .slice(0, 10);
  if (!lines.length) return null;

  const title = String(item.detail || 'Crew game').slice(0, 120);
  const scan = title + ' ' + lines.join(' ');
  if (GAME_FORBIDDEN.test(scan)) {
    audit(env, 'game_money_refused', { email, via: 'automation' });
    return { refused: 'A game cannot ask about money - these are answered by people with no account, so AMV cannot know how old they are.' };
  }

  const id = _gameId();
  const rec = {
    id, title, kind: 'crew',
    prompts: lines.map((t, i) => ({ id: 'q' + i, text: _gameSafeText(t, 300), options: null })),
    owner: String(email).toLowerCase(),
    state: 'open', at: Date.now(), closesAt: null,
    players: [], answers: [], results: null,
  };
  await _withKind(env, 'game', id, (fresh) => { Object.assign(fresh, rec); }, rec);
  await _withKind(env, 'gameown', rec.owner, (r) => {
    r.ids = [id].concat((r.ids || []).filter(x => x !== id)).slice(0, 200);
  }, { ids: [] });
  audit(env, 'game_created', { email, id, kind: 'crew', prompts: rec.prompts.length, via: 'automation' });

  /* No request to read an address from. The game page is served by this
     server, which the site reaches under API_MOUNT - the same address the page
     itself is built to use - so APP_URL alone (the static host) would 404. */
  const base = String(env.APP_URL || '').replace(/\/$/, '');
  return { id, url: (base ? base + API_MOUNT : '') + '/g/' + id, count: rec.prompts.length };
}

