
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

/* ══════════════════════════════════════════════════════════════════════════
   THE CONNECTOR DIRECTORY, AND WHY IT IS NOT A LIST IN THIS FILE.

   Asked for: far more things AMV can connect to, from everywhere, with ten of
   each category on the screen and a full directory of a thousand behind it.

   A thousand entries written out here would be a thousand guesses. The only
   thing that makes a directory entry worth anything is that pressing Connect
   starts something real, and a hand-typed `npx -y @somebody/server-thing` that
   does not exist is worse than no entry: it fails at the one moment somebody
   was trusting the product. Shipping a list like that would also freeze it -
   every entry correct on the day it was written and rotting from then on.

   So the long tail is READ, not written. The official MCP registry publishes
   every server anybody has registered, with its real package name, its real
   version and the environment variables it actually needs, and it is the same
   list the rest of the ecosystem uses. AMV asks it, filters it to the ones its
   own bridge can actually run, and hands back a command that works. An entry
   AMV cannot start is not shown, because the promise of this screen is that
   what is on it connects.

   THROUGH THE WORKER RATHER THAN FROM THE PAGE, for three reasons and all of
   them matter: the page's connect-src does not include the registry and is not
   going to be widened for a catalogue; the answer is identical for everybody,
   so caching it once here costs one request instead of one per visitor; and a
   registry that is slow or down becomes one honest message rather than a
   browser error somebody has to interpret.

   Public, like /v1/everyday and /v1/market/list, and for the same reason: a
