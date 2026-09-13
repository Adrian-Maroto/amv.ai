/* CREW GAMES - the host's half.

   The Worker can make a game, hand out a link, collect answers from people with
   no account, and score it once. This is the part the OWNER touches: make one,
   see who has answered, close it, reveal it.

   Deliberately small. The player's screen is served whole by the Worker at
   /g/<id>, because somebody arriving from a group chat has no account to load
   the app with - so nothing here renders a game, only the list of games this
   person is running.

   No streaks, no "come back now", no nudge for a game somebody abandoned. The
   reason to open this is that four friends answered while you were out, which
   is a fact worth showing rather than a feeling worth manufacturing. */

const AMVGames = {
  /* Each path is written out in full rather than built from a prefix. A
     concatenated path is invisible to the check that every served route is
     actually asked for, and a route nobody calls is dead code that still has an
     attack surface. */
  async _post(path, body){
    if(!(window.AMV_API && AMV_API.live)) throw new Error('AMV is not connected.');
    const r = await AMV_API._fetch(path, { method:'POST', body: JSON.stringify(body||{}) });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || d.error){ const e=new Error(d.error||'That did not work.'); if(d.code) e.code=d.code; throw e; }
    return d;
  },
  /* `prompts` is [{text, options?}]. The server refuses anything that asks for
     money, because the people answering may have no age on record at all. */
  create(title, prompts, kind){ return this._post('/v1/game/create', { title, prompts, kind: kind||'poll' }); },
  mine(){ return this._post('/v1/game/mine', {}); },
  close(id){ return this._post('/v1/game/close', { id }); },
  reveal(id){ return this._post('/v1/game/reveal', { id }); },
};
try{ window.AMVGames = AMVGames; }catch(e){}

/* The link somebody actually pastes into a group chat. Built from the API base
   because the game page is served by the Worker, not by the static host. */
function gameLink(id){
  try{
    const base = String((window.AMV_API && AMV_API.base) || '').replace(/\/$/, '');
    return (base || location.origin) + '/g/' + id;
  }catch(e){ return '/g/' + id; }
}
try{ window.gameLink = gameLink; }catch(e){}

function _gameStateLabel(g){
  if(g.state === 'revealed') return 'Revealed';
  if(g.state === 'closed') return 'Closed, not revealed';
  return 'Open';
}

/* WHO HAS ANSWERED, WHICH IS THE ONLY REASON TO OPEN THIS SCREEN.

   Not what they said - that stays hidden until the reveal, for everyone
   including the host, because a game whose owner can read the answers early is
   a game nobody answers honestly. */
function _gamesHTML(games){
  if(!games || !games.length){
    return '<p class="ob-sub">No games yet. A Crew job can make one, or you can from a chat.</p>';
  }
  return games.map(g => {
    const waiting = (g.players||[]).filter(n => (g.answeredBy||[]).indexOf(n) < 0);
    const done = (g.answeredBy||[]).length, total = (g.players||[]).length;
    const results = (g.state === 'revealed' && g.results && g.results.tally)
      ? Object.keys(g.results.tally).map(k => {
          const t = g.results.tally[k];
          const top = t.top ? (escH(t.top.value) + ' (' + t.top.votes + ')') : 'no answers';
          return '<div class="gm-r"><span>' + escH(t.text) + '</span><b>' + (t.tied ? 'tied: ' : '') + top + '</b></div>';
        }).join('')
      : '';
    return '<div class="gm-card">'
      + '<div class="gm-h"><b>' + escH(g.title) + '</b><span class="gm-s">' + escH(_gameStateLabel(g)) + '</span></div>'
      + '<div class="gm-p">' + done + ' of ' + total + ' answered'
        + (waiting.length && g.state==='open' ? ' - waiting on ' + escH(waiting.slice(0,4).join(', ')) : '')
      + '</div>'
      + results
      + '<div class="gm-acts">'
        + '<button class="btn bs" data-dact="gameCopyLink" data-darg="' + escH(g.id) + '">Copy link</button>'
        + (g.state === 'open' ? '<button class="btn bs" data-dact="gameClose" data-darg="' + escH(g.id) + '">Close</button>' : '')
        + (g.state !== 'revealed' ? '<button class="btn bp" data-dact="gameReveal" data-darg="' + escH(g.id) + '">Reveal</button>' : '')
      + '</div></div>';
  }).join('');
}

async function renderGames(){
  const el = $('crew-games');
  if(!el) return;
  el.innerHTML = '<p class="ob-sub">Loading…</p>';
  try{
    const d = await AMVGames.mine();
    el.innerHTML = _gamesHTML(d.games);
  }catch(e){
    /* An empty panel and a silent failure look identical, and one of them is a
       bug. Say which. */
    el.innerHTML = '<p class="ob-sub">' + escH(e.message || 'Could not load your games.') + '</p>';
  }
}
try{ window.renderGames = renderGames; }catch(e){}

async function gameCopyLink(id){
  const url = gameLink(id);
  try{ await navigator.clipboard.writeText(url); toast('Link copied - paste it into the group chat','ok'); }
  catch(e){ toast(url, 'info'); }
}
async function gameClose(id){
  try{ await AMVGames.close(id); toast('Closed. Reveal when you are ready.','ok'); renderGames(); }
  catch(e){ toast(e.message || 'Could not close it','warn'); }
}
async function gameReveal(id){
  try{ await AMVGames.reveal(id); toast('Revealed - everyone can see the results now','ok'); renderGames(); }
  catch(e){ toast(e.message || 'Could not reveal it','warn'); }
}
try{ window.gameCopyLink=gameCopyLink; window.gameClose=gameClose; window.gameReveal=gameReveal; }catch(e){}

/* Made from a Crew result, which is the point of the whole layer: a job thinks
   of the questions, this turns them into something the group can actually
   play. */
async function gameFromPrompts(title, lines, kind){
  const prompts = (lines||[]).slice(0, 25)
    .map(l => ({ text: String(l||'').slice(0, 300) }))
    .filter(p => p.text);
  if(!prompts.length) throw new Error('A game needs at least one question.');
  const d = await AMVGames.create(title || 'Game', prompts, kind);
  return { id: d.id, url: gameLink(d.id) };
}
try{ window.gameFromPrompts = gameFromPrompts; }catch(e){}
