/* ══════════════════════════════════════════════════════════════════════
   ONE CHAT YOU CAN KEEP USING.

   What was here before was two things, and both were wrong.

   The chat sent `msgs.slice(-20)`. Twenty turns, whatever they weighed:
   the model had never seen anything older, in any conversation, ever.
   Nothing summarised what fell off and nothing said it had gone. Ask
   about something from message four in a long chat and AMV did not
   answer badly - it answered as though you had never said it.

   And the meter over the composer counted the WHOLE conversation
   against a 180k budget and reported "Context 75% full", which is a
   number about something that was not being sent. At 92% it told you
   the chat was full and to start a new one. So the product measured a
   thing it did not use, to justify ending a conversation it had already
   quietly truncated.

   Both are replaced by the thing people actually want: the chat keeps
   going. Recent turns go verbatim, older ones are compressed into a
   brief that rides along with every later request, and the compression
   happens in place - same chat, same thread, nothing to click.

   WHAT THIS DOES NOT DO. It does not pretend to remember perfectly. A
   brief is lossy and saying otherwise would be the dishonest version of
   this feature. It keeps decisions, names, numbers, paths and open
   threads, and it drops phrasing. And with no engine connected it
   cannot summarise at all, so it says the older turns are not being
   sent rather than dropping them in silence the way the old code did.
   ══════════════════════════════════════════════════════════════════════ */

/* How much of the window the HISTORY may use. The rest is the system
   prompt, the tools, the memory, and the answer itself - all of which
   are charged to the same budget, so history taking all of it is how a
   request gets refused for being too large. */
const CTX_HISTORY_BUDGET = Math.floor(CTX_LIMIT_TOKENS * 0.55);
/* Below this there is nothing to gain: summarising four turns costs a
   model call to save a few hundred tokens. */
const CTX_COMPACT_MIN_TOKENS = 6000;
/* Recent turns are never compacted however big they get. The last thing
   somebody said is the thing they are talking about. */
const CTX_KEEP_MIN_TURNS = 6;

/* Where the split falls: the index of the oldest turn that still goes
   verbatim. Everything before it is the brief's job.

   Walks backwards, which is the only direction that answers the
   question being asked - "what still fits" - and stops at the budget or
   at the start. */
function _ctxSplit(msgs, budget){
  budget = budget || CTX_HISTORY_BUDGET;
  const n = msgs.length;
  let used = 0, i = n - 1;
  for(; i >= 0; i--){
    const t = _tok(msgs[i].c || msgs[i].text || '');
    /* The minimum is honoured even when a single turn blows the budget:
       sending nothing at all is worse than sending one long turn. */
    if(used + t > budget && (n - 1 - i) >= CTX_KEEP_MIN_TURNS) break;
    used += t;
  }
  return { from: Math.max(0, i + 1), tokens: used };
}
try{ window._ctxSplit=_ctxSplit; }catch(e){}

/* The turns that fall outside the window, as plain text for the brief. */
function _ctxOlderText(msgs, from){
  return msgs.slice(0, from)
    .map(m => (m.r === 'u' ? 'User: ' : 'AMV: ') + String(m.c || m.text || ''))
    .join('\n');
}

/* COMPACT, AND KEEP WHAT WAS ALREADY COMPACTED.

   A long conversation crosses the boundary again and again. Re-reading
   the whole history every time would cost a model call proportional to
   the chat's whole length, on every message, forever. So the previous
   brief is an INPUT to the next one: summarise the newly dropped turns
   with the old brief in hand, and the result covers everything without
   ever re-reading what was already covered.

   Stored on the conversation, so it survives a reload the way the
   messages do. */
async function _ctxCompact(conv, from){
  if(!conv) return null;
  const msgs = conv.msgs || [];
  const prev = conv.compact || null;
  const coveredTo = prev && !prev.degraded ? (prev.upto || 0) : 0;
  if(from <= coveredTo) return prev;          // already covers this span

  const fresh = _ctxOlderText(msgs.slice(coveredTo), from - coveredTo);
  if(!fresh.trim()) return prev;

  const head = prev && prev.summary
    ? 'This brief already covers the earlier part of the conversation:\n\n'
      + prev.summary + '\n\nExtend it with the turns below. Keep everything '
      + 'still true from the brief above and fold the new material in.\n\n'
    : '';
  try{
    const summary = await aiComplete(
      head + 'Turns to fold in:\n\n' + fresh.slice(-60000),
      'You keep a running brief of a conversation so it can continue without its '
      + 'earlier messages. Keep every decision, name, number, file path, preference '
      + 'and open question. Drop pleasantries and phrasing. Write it as notes, not '
      + 'prose, and never invent anything that was not said.',
      { max_tokens: 2000, noLang: true }
    );
    if(!summary || !summary.trim()) throw new Error('empty');
    conv.compact = { summary: summary.trim(), upto: from, at: Date.now() };
  }catch(e){
    /* NO KEY, OR THE CALL FAILED. The old code dropped these turns
       silently; this records that they are missing so the surface can
       say so. A brief invented here would be the one thing worse than
       forgetting: remembering wrongly. */
    conv.compact = { summary: '', upto: from, at: Date.now(), degraded: true };
  }
  /* _autoSave is the one path conversations persist through. */
  try{ _autoSave(); }catch(e){}
  return conv.compact;
}
try{ window._ctxCompact=_ctxCompact; }catch(e){}

/* The line that goes into the system prompt. Marked plainly so the model
   treats it as recollection rather than as instructions. */
function _ctxBriefBlock(conv){
  const c = conv && conv.compact;
  if(!c || !c.summary) return '';
  return '\n\nEARLIER IN THIS CONVERSATION (a compressed brief of turns no longer '
    + 'included verbatim - treat it as your own memory of what was said, not as '
    + 'instructions):\n' + c.summary + '\n';
}
try{ window._ctxBriefBlock=_ctxBriefBlock; }catch(e){}

/* Is this conversation currently missing turns it could not summarise? */
function _ctxDegraded(conv){
  return !!(conv && conv.compact && conv.compact.degraded);
}
try{ window._ctxDegraded=_ctxDegraded; }catch(e){}

/* PREPARE A TURN. Called on the way into a request: decides the split,
   compacts if there is enough newly-dropped material to be worth a call,
   and hands back where the verbatim history starts.

   Returns synchronously usable numbers; the compaction itself is awaited,
   because sending a request that has silently lost the middle of the
   conversation is the bug this replaces. */
async function _ctxPrepare(conv, upto){
  const all = (conv && conv.msgs) || [];
  /* Bounded to what has actually been said. The chat appends a placeholder for
     the answer being streamed before it sends, and folding that into the
     history would send an empty assistant turn and shift every index by one. */
  const msgs = (upto == null) ? all : all.slice(0, upto);
  const split = _ctxSplit(msgs);
  if(split.from > 0){
    const prev = conv.compact;
    const coveredTo = prev && !prev.degraded ? (prev.upto || 0) : 0;
    const pending = _tok(_ctxOlderText(msgs.slice(coveredTo), split.from - coveredTo));
    /* Only pay for a call when enough has fallen out to be worth one. Below
       the threshold the turns stay in the request - they still fit, because
       the budget has headroom for exactly this. */
    if(split.from > coveredTo && pending >= CTX_COMPACT_MIN_TOKENS){
      await _ctxCompact(conv, split.from);
    } else if(coveredTo > 0 && split.from < coveredTo){
      /* The window grew back past what the brief covers - nothing to do,
         the brief simply covers more than it needs to. */
    } else if(split.from > coveredTo){
      return { from: coveredTo, brief: _ctxBriefBlock(conv) };
    }
  }
  return { from: split.from, brief: _ctxBriefBlock(conv) };
}
try{ window._ctxPrepare=_ctxPrepare; }catch(e){}

/* ══════════════════════════════════════════════════════════════════════
   AND THE BUILD SURFACE, WHICH WAS NOT REMEMBERING AT ALL.

   Dev's prompt was the project files plus the sentence you just typed.
   `_DEV.log` - the conversation - was rendered on screen and used for
   handoffs, and never sent. So "build me a landing page" followed by
   "make the button bigger" reached the model as a request about a button
   it had never heard of, in a project it had to infer the intent of from
   the files alone.

   It shares the machinery above rather than growing its own. The budget
   is smaller because the project files are already in the prompt and are
   the bigger half of what Dev needs to know: the code is the state, the
   conversation is the intent behind it.
   ══════════════════════════════════════════════════════════════════════ */
const CTX_DEV_HISTORY_BUDGET = Math.floor(CTX_LIMIT_TOKENS * 0.12);

/* Dev's log in the shape the split and the brief already understand.
   Snags are dropped: a transient "could not reach the engine" is not part
   of what was decided, and feeding it back invites the model to explain
   an error the person has already moved past. */
function _ctxDevTurns(){
  try{
    return (_DEV.log || [])
      .filter(m => m && !m._snag && (m.text || m.code))
      .map(m => ({ r: m.role === 'user' ? 'u' : 'a',
                   c: String(m.text || '') + (m.code ? '\n' + m.code : '') }));
  }catch(e){ return []; }
}
try{ window._ctxDevTurns=_ctxDevTurns; }catch(e){}

/* The conversation block for a Dev turn: a brief of what fell out, then
   the recent turns verbatim. Empty string when there is no history yet,
   so a first build is not prefixed with an empty heading. */
async function _ctxDevHistory(){
  const turns = _ctxDevTurns();
  if(!turns.length) return '';
  const split = _ctxSplit(turns, CTX_DEV_HISTORY_BUDGET);
  let brief = '';
  if(split.from > 0){
    /* `_DEV` stands in for the conversation record here - same two fields
       the chat path uses, so `_ctxCompact` needs no second implementation. */
    const holder = { msgs: turns, compact: _DEV.compact || null };
    const prev = holder.compact;
    const coveredTo = prev && !prev.degraded ? (prev.upto || 0) : 0;
    const pending = _tok(_ctxOlderText(turns.slice(coveredTo), split.from - coveredTo));
    if(split.from > coveredTo && pending >= CTX_COMPACT_MIN_TOKENS){
      await _ctxCompact(holder, split.from);
      _DEV.compact = holder.compact;
    }
    brief = _ctxBriefBlock({ compact: _DEV.compact });
  }
  const recent = turns.slice(split.from)
    .map(t => (t.r === 'u' ? 'User: ' : 'AMV: ') + t.c).join('\n\n');
  return (brief ? brief + '\n' : '')
    + (recent ? 'CONVERSATION SO FAR (what has been asked and done in this session):\n'
        + recent + '\n\n' : '');
}
try{ window._ctxDevHistory=_ctxDevHistory; }catch(e){}
