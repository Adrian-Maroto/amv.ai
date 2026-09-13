/* THE LOOP THAT MAKES A CREW JOB MORE THAN A MESSAGE.

   A Crew job could already think and write. What it could not do was produce
   something OTHER PEOPLE INTERACT WITH and read their answers back - so every
   "Friday game night" idea died at distribution, because nothing could
   receive. This is that layer: make a game, hand out a link, collect answers,
   hold state, compute the result once, tell the group.

   People join WITHOUT AN ACCOUNT, which the owner approved and which decides
   most of what is asserted here. The link is the only credential, so nothing
   may leak to somebody holding a wrong one. There is no age on record for a
   stranger, so a game may never ask for money. Their answers land on other
   people's screens, so they are bounded and stripped. And nothing at all may
   be visible before the reveal, or the last person to answer wins. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'game.harness.mjs');
writeFileSync(harness, src + '\nexport { gameCreate, gameJoin, gameAnswer, gameState, gameClose, gameReveal, gameMine, authSignup, issueTokens };\n');
const W = await import(harness + '?t=' + Date.now());

const PW = 'A-real-Passw0rd!';
const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }; },
  },
};
const req = (path, body, token, ip) => new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': ip || '5.5.5.5' },
                         token ? { Authorization: 'Bearer ' + token } : {}),
  body: JSON.stringify(body || {}),
});
const jj = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
const host = (await W.issueTokens(env, 'host@x.com', 'Host')).token;

let GID = '';
section('A host makes a game and gets a link');
{
  const r = await jj(await W.gameCreate(req('/v1/game/create', {
    title: 'Friday night', kind: 'most_likely',
    prompts: [{ text: 'Most likely to miss the train' }, { text: 'Best fit tonight' }],
  }, host), env));
  ok(r.status === 200 && r.body.ok === true, 'the game is created', r.body);
  ok(/^[a-z0-9]{24}$/.test(r.body.id || ''), 'with a full-entropy id, because the link is the credential', r.body.id);
  ok(r.body.joinPath === '/g/' + r.body.id, 'and a path to hand out', r.body.joinPath);
  GID = r.body.id;
}

section('A game may never ask for money, because strangers have no age on record');
{
  const r = await jj(await W.gameCreate(req('/v1/game/create', {
    title: 'Pay up', prompts: [{ text: 'Enter your card number to play' }],
  }, host), env));
  ok(r.status === 400, 'it is refused at creation, not at render', r.status);
  ok(r.body.code === 'game_no_money', 'with a code the caller can act on', r.body.code);
  ok(/how old they are/i.test(r.body.error || ''), 'and says why in one sentence', r.body.error);
}

let TOK_A = '', TOK_B = '';
section('Two strangers join by link, with no account between them');
{
  const a = await jj(await W.gameJoin(req('/v1/game/join', { id: GID, nick: 'Sam' }, null, '9.1.1.1'), env));
  ok(a.status === 200 && a.body.token, 'the first joins with no token of any kind', a.status);
  ok(/^[a-z0-9]{24}$/.test(a.body.token), 'and is given a participant token', a.body.token);
  TOK_A = a.body.token;

  const b = await jj(await W.gameJoin(req('/v1/game/join', { id: GID, nick: 'Alex' }, null, '9.1.1.2'), env));
  ok(b.status === 200 && b.body.token, 'and so does the second', b.status);
  TOK_B = b.body.token;
  ok(b.body.token !== TOK_A, 'with a different token', true);

  const dup = await jj(await W.gameJoin(req('/v1/game/join', { id: GID, nick: 'sam' }, null, '9.1.1.3'), env));
  ok(dup.status === 409 && dup.body.code === 'nick_taken', 'the same name twice is refused kindly', dup.body);
}

section('Nothing is visible before the reveal');
{
  await W.gameAnswer(req('/v1/game/answer', { id: GID, token: TOK_A, values: { q0: 'Alex', q1: 'Sam' } }, null, '9.1.1.1'), env);
  const s = await jj(await W.gameState(req('/v1/game/state', { id: GID, token: TOK_B }, null, '9.1.1.2'), env));
  ok(s.status === 200, 'a player can read the game', s.status);
  ok(!s.body.game.answers, 'but not anybody else’s answers', s.body.game.answers);
  ok(!s.body.game.results, 'nor a running tally', s.body.game.results);
  ok(s.body.game.you && s.body.game.you.answered === false, 'only their own state', s.body.game.you);
  /* A game that shows the score while it is open is a game everybody waits to
     answer last. */
  const stranger = await jj(await W.gameState(req('/v1/game/state', { id: GID, token: 'z'.repeat(24) }, null, '9.9.9.9'), env));
  ok(!stranger.body.game.you, 'and a wrong token is told nothing about itself', stranger.body.game);
}

section('One answer per player, however many times the phone sends it');
{
  const again = await jj(await W.gameAnswer(req('/v1/game/answer', { id: GID, token: TOK_A, values: { q0: 'Sam' } }, null, '9.1.1.1'), env));
  ok(again.status === 200, 'a duplicate is not an error - they did what they meant to', again.status);
  ok(again.body.recorded === false, 'but it is not recorded twice', again.body.recorded);
  ok(again.body.answered === 1, 'so the count stays at one', again.body.answered);
}

section('A wrong token is told the game does not exist');
{
  const r = await jj(await W.gameAnswer(req('/v1/game/answer', { id: GID, token: 'q'.repeat(24), values: { q0: 'x' } }, null, '9.9.9.9'), env));
  ok(r.status === 404, 'refused as not found rather than as forbidden', r.status);
  ok(!/forbidden|not allowed/i.test(r.body.error || ''),
     'so probing cannot learn that the game is real', r.body.error);
}

section('The result is computed once and cannot be moved afterwards');
{
  await W.gameAnswer(req('/v1/game/answer', { id: GID, token: TOK_B, values: { q0: 'Alex', q1: 'Alex' } }, null, '9.1.1.2'), env);
  const rev = await jj(await W.gameReveal(req('/v1/game/reveal', { id: GID }, host), env));
  ok(rev.status === 200 && rev.body.game.state === 'revealed', 'the host reveals it', rev.body.game && rev.body.game.state);
  const top = rev.body.game.results.tally.q0.top;
  ok(top && top.value === 'Alex' && top.votes === 2, 'and the tally is the real count', top);
  ok(rev.body.game.answers.length === 2, 'every answer is now visible', rev.body.game.answers.length);

  const closed = await jj(await W.gameAnswer(req('/v1/game/answer', { id: GID, token: TOK_A, values: { q0: 'Sam' } }, null, '9.1.1.1'), env));
  ok(closed.status === 409, 'answering after the reveal is refused', closed.status);

  const twice = await jj(await W.gameReveal(req('/v1/game/reveal', { id: GID }, host), env));
  ok(twice.body.already === true, 'and revealing twice does not recompute the result', twice.body.already);
  ok(twice.body.game.results.tally.q0.top.votes === 2, 'the tally is the one from the first reveal', twice.body.game.results.tally.q0.top);
}

section('Somebody else’s game is not theirs to close');
{
  const other = (await W.issueTokens(env, 'other@x.com', 'Other')).token;
  const r = await jj(await W.gameClose(req('/v1/game/close', { id: GID }, other), env));
  ok(r.status === 404, 'a stranger with a valid id is told there is no such game', r.status);
}

section('The host sees who answered, not what they said');
{
  const mk = await jj(await W.gameCreate(req('/v1/game/create', {
    title: 'Second', prompts: [{ text: 'Pick one' }],
  }, host), env));
  const id2 = mk.body.id;
  const p = await jj(await W.gameJoin(req('/v1/game/join', { id: id2, nick: 'Robin' }, null, '9.2.2.2'), env));
  await W.gameAnswer(req('/v1/game/answer', { id: id2, token: p.body.token, values: { q0: 'a secret' } }, null, '9.2.2.2'), env);

  const mine = await jj(await W.gameMine(req('/v1/game/mine', {}, host), env));
  const row = (mine.body.games || []).find(x => x.id === id2);
  ok(!!row, 'the game is listed for its owner', !!row);
  ok(row.answeredBy.includes('Robin'), 'the host can see WHO answered, to chase the rest', row.answeredBy);
  ok(row.results === null, 'but not what anybody said before the reveal', row.results);
  ok(JSON.stringify(row).indexOf('a secret') < 0, 'the answer itself is nowhere in the host view', true);
}

section('An answer is bounded, and control characters are stripped');
{
  const mk = await jj(await W.gameCreate(req('/v1/game/create', { title: 'Bounds', prompts: [{ text: 'Say something' }] }, host), env));
  const id3 = mk.body.id;
  const p = await jj(await W.gameJoin(req('/v1/game/join', { id: id3, nick: 'Long' }, null, '9.3.3.3'), env));
  const nasty = 'x'.repeat(5000) + String.fromCharCode(0) + String.fromCharCode(27) + '[31m';
  await W.gameAnswer(req('/v1/game/answer', { id: id3, token: p.body.token, values: { q0: nasty } }, null, '9.3.3.3'), env);
  await W.gameReveal(req('/v1/game/reveal', { id: id3 }, host), env);
  const s = await jj(await W.gameState(req('/v1/game/state', { id: id3, token: p.body.token }, null, '9.3.3.3'), env));
  const said = s.body.game.answers[0].values.q0;
  ok(said.length <= 280, 'a five thousand character answer is cut to the bound', said.length);
  ok(said.indexOf(String.fromCharCode(0)) < 0 && said.indexOf(String.fromCharCode(27)) < 0,
     'and control characters never reach another player’s screen', true);
}

if (report('a-game-strangers-can-join-by-link') > 0) process.exitCode = 1;
done();
