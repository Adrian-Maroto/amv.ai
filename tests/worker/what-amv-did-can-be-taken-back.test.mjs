/* WHAT AMV DID CAN BE TAKEN BACK - OR AMV SAYS WHY NOT.

   Every write on a connected account comes back with a receipt: whether it
   was checked, and either a signed ticket that takes it back or the sentence
   saying why nothing can. Taking it back is itself read back, and it refuses to
   put AMV's "before" over somebody's later work.

   The provider below is a small model of the real ones: events that can be
   deleted, a branch that can move, a range of cells that can be edited by
   somebody else in between. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const SRC = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const harness = join(__dir, '.build', 'takeback.harness.mjs');
writeFileSync(harness, SRC + '\nexport { CONN_ACTIONS, CONN_KV, DB, connSeal, revokeUserTokens, _actContractProblems };\n');
const W = await import(harness + '?t=' + Date.now());

/* ── The provider ─────────────────────────────────────────────────────── */
const events = new Map(), refs = new Map(), cells = new Map(), issues = new Map(), slack = new Map();
let stubborn = false;                      // accepts a delete and keeps the thing
let deafSheet = false;                     // accepts cells and keeps the old ones
const sent = [];
const J = (o, status) => new Response(status === 204 ? null : JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const u = String(url), m = (init && init.method) || 'GET';
  sent.push(m + ' ' + u); 
  const body = init && init.body ? JSON.parse(init.body) : {};
  let x;
  if (m === 'POST' && /gmail\/v1\/users\/me\/messages\/send$/.test(u)) return J({ id: 'm1', labelIds: ['SENT'] });
  if (m === 'POST' && /calendar\/v3\/calendars\/primary\/events$/.test(u)) { events.set('e1', 'confirmed'); return J({ id: 'e1', htmlLink: 'https://cal/e1' }); }
  if ((x = u.match(/calendar\/v3\/calendars\/primary\/events\/([^/?]+)/))) {
    if (m === 'DELETE') { if (!stubborn) events.delete(x[1]); return J(null, 204); }
    return events.has(x[1]) ? J({ id: x[1], status: events.get(x[1]) }) : J({ error: {} }, 410);
  }
  if (/\/git\/ref\/heads\/main$/.test(u)) return J({ object: { sha: 'base0' } });
  if ((x = u.match(/\/git\/refs?\/heads\/(.+)$/))) {
    const b = decodeURIComponent(x[1]);
    if (m === 'DELETE') { refs.delete(b); return J(null, 204); }
    return refs.has(b) ? J({ object: { sha: refs.get(b) } }) : J({ message: 'Not Found' }, 404);
  }
  if (/\/git\/blobs$/.test(u)) return J({ sha: 'blob0' });
  if (/\/git\/trees$/.test(u)) return J({ sha: 'tree0' });
  if (/\/git\/commits$/.test(u)) return J({ sha: 'commit0000000aaaa' });
  if (/\/git\/refs$/.test(u)) { refs.set(body.ref.replace('refs/heads/', ''), 'commit0000000aaaa'); return J({ ref: body.ref }); }
  if (m === 'POST' && /\/issues$/.test(u)) { issues.set(5, { number: 5, title: body.title, state: 'open' }); return J({ number: 5, html_url: 'https://github.com/o/r/issues/5' }); }
  if ((x = u.match(/\/issues\/(\d+)$/))) {
    const i = issues.get(+x[1]);
    if (m === 'PATCH') i.state = body.state;
    return J(i);
  }
  if (/slack\.com\/api\/chat\.postMessage$/.test(u)) {
    if (body.channel === '#nope') return J({ ok: false, error: 'channel_not_found' });
    slack.set('C1:9.9', body.text); return J({ ok: true, ts: '9.9', channel: 'C1' });
  }
  if (/slack\.com\/api\/chat\.delete$/.test(u)) { if (!stubborn) slack.delete(body.channel + ':' + body.ts); return J({ ok: true }); }
  if ((x = u.match(/slack\.com\/api\/chat\.getPermalink\?channel=([^&]+)&message_ts=(.+)$/)))
    return J(slack.has(decodeURIComponent(x[1]) + ':' + decodeURIComponent(x[2])) ? { ok: true, permalink: 'https://x.slack.com/p' } : { ok: false, error: 'message_not_found' });
  if ((x = u.match(/v4\/spreadsheets\/([^/]+)\/values\/([^?]+)/))) {
    const k = decodeURIComponent(x[2]);
    if (m === 'PUT' && deafSheet) return J({ updatedRange: k, updatedCells: body.values.flat().length });
    if (m === 'PUT') { cells.set(k, JSON.parse(JSON.stringify(body.values))); return J({ updatedRange: k, updatedCells: body.values.flat().length }); }
    return J({ range: k, values: cells.get(k) || [] });
  }
  return J({});
};

/* ── The account ──────────────────────────────────────────────────────── */
function mkEnv() {
  const m = new Map();
  return {
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
    },
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0 })); } }) },
    JWT_SECRET: 'j'.repeat(40), ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    CONNECT_KEY: 'test-connect-key', GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec',
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
const req = (env, path, body, tok) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '45.45.45.45', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body),
}), env, ctx);
const jsonOf = async (r) => { try { return await r.json(); } catch (e) { return {}; } };
const env = mkEnv();
async function account(email) {
  const tok = (await jsonOf(await req(env, '/auth/signup', { email, name: 'Me', password: 'A-real-Passw0rd!' }))).token;
  const sealed = await W.connSeal(env, { access: 'provider-token', exp: Date.now() + 3600e3 });
  await W.DB.put(env, W.CONN_KV, email, { c1: { provider: 'google', sealed, unattended: false,
    scopes: ['mail.send', 'calendar.write', 'drive.write', 'code.write', 'issues.write', 'slack.write'] } });
  return tok;
}
const ME = 'me@example.com', OTHER = 'other@example.com';
const tok = await account(ME);
const otherTok = await account(OTHER);
const act = async (action, args, t) => { const r = await req(env, '/v1/connect/act', { action, args }, t || tok); return { status: r.status, d: await jsonOf(r) }; };
const undo = async (token, t) => { const r = await req(env, '/v1/connect/undo', { token }, t || tok); return { status: r.status, d: await jsonOf(r) }; };

section('Every write answers "and how is this taken back?" - or does not load');
{
  const writes = Object.keys(W.CONN_ACTIONS).filter(n => W.CONN_ACTIONS[n].writes);
  ok(writes.length >= 9 && W._actContractProblems(W.CONN_ACTIONS).length === 0, 'the writes there are all answer it', [writes.length, W._actContractProblems(W.CONN_ACTIONS)]);
  const irr = writes.filter(n => W.CONN_ACTIONS[n].irreversible);
  ok(irr.includes('gmail.send') && irr.includes('docs.edit') && irr.length === 2, 'only sending mail and a find-and-replace say they cannot be', irr);
  const bad = SRC.replace('const CONN_ACTIONS = {', "const CONN_ACTIONS = {\n  'test.forgot': { need: 'mail.send', writes: true, async run(){ return { verified: true }; } },");
  const p = join(__dir, '.build', 'takeback-bad.harness.mjs');
  writeFileSync(p, bad);
  let threw = '';
  try { await import(p + '?t=' + Date.now()); } catch (e) { threw = String(e.message || e); }
  ok(/test\.forgot writes, and neither declares an undo/.test(threw), 'a write added without one stops the Worker starting, naming it', threw.slice(0, 160));
}

section('Adding an event comes back with a way to take it back, and taking it back is checked');
{
  const r = await act('calendar.create', { title: 'Lunch', start: '2026-11-01T12:00:00Z', end: '2026-11-01T13:00:00Z' });
  ok(r.status === 200 && r.d.receipt && r.d.receipt.status === 'done', 'done, as checked', r.d.receipt);
  ok(r.d.receipt.undo && typeof r.d.receipt.undo.token === 'string' && r.d.receipt.undo.label === 'Delete the event' && r.d.receipt.undo.until > Date.now(),
     'with a ticket that says what taking it back does', r.d.receipt.undo && r.d.receipt.undo.label);
  const forOther = await undo(r.d.receipt.undo.token, otherTok);
  ok(forOther.status === 410 && events.has('e1'), 'somebody else holding the ticket cannot use it, and nothing is deleted', [forOther.status, forOther.d]);
  const forged = await undo(r.d.receipt.undo.token.slice(0, -3) + 'AAA');
  ok(forged.status === 410 && events.has('e1'), 'nor can a ticket that was altered', forged.status);
  sent.length = 0;
  const u = await undo(r.d.receipt.undo.token);
  ok(u.status === 200 && u.d.undone === true && u.d.verified === true && !events.has('e1'), 'the owner takes it back, and it is gone', [u.status, u.d]);
  ok(sent.some(s => s.startsWith('DELETE ')) && sent.some(s => s.startsWith('GET ')), 'by deleting it and then looking', sent);
}

section('A take-back the provider accepted and did not do is not "undone"');
{
  const r = await act('calendar.create', { title: 'Dinner', start: '2026-11-02T19:00:00Z' });
  stubborn = true;
  const u = await undo(r.d.receipt.undo.token);
  stubborn = false;
  ok(u.status === 502 && u.d.error === 'not_confirmed' && u.d.ok !== true, 'it says the event is still there', [u.status, u.d]);
}

section('Sent mail says it cannot be called back, and offers nothing that pretends to');
{
  const r = await act('gmail.send', { to: 'friend@example.com', subject: 'Hi', body: 'Hello' });
  ok(r.status === 200 && r.d.receipt.undo === null && /cannot be called back/.test(r.d.receipt.irreversible || ''), 'no ticket, and the reason', r.d.receipt);
}

section('A branch AMV pushed is deleted only while it is still only AMV\'s');
{
  const push = { repo: 'o/r', base: 'main', branch: 'amv-a', message: 'm', files: [{ path: 'a.txt', content: 'x' }] };
  let r = await act('github.push', push);
  ok(r.status === 200 && r.d.receipt.undo && !('_sha' in r.d.result), 'pushed, with a ticket, and the full commit id stays on the server', r.d.result);
  refs.set('amv-a', 'someone-elses-commit');
  sent.length = 0;
  let u = await undo(r.d.receipt.undo.token);
  ok(u.status === 409 && u.d.error === 'changed_since' && refs.get('amv-a') === 'someone-elses-commit', 'somebody pushed to it since: it stays, and AMV says why', [u.status, u.d]);
  ok(!sent.some(s => s.startsWith('DELETE ')), 'and nothing was deleted', sent);
  r = await act('github.push', { ...push, branch: 'amv-b' });
  u = await undo(r.d.receipt.undo.token);
  ok(u.status === 200 && u.d.verified === true && !refs.has('amv-b'), 'untouched since: deleted, and checked gone', [u.status, u.d]);
}

section('An issue AMV opened is closed - the label says close, because that is what happens');
{
  const r = await act('github.issue.create', { repo: 'o/r', title: 'A bug', body: '' });
  ok(r.d.receipt.undo && r.d.receipt.undo.label === 'Close the issue', 'the label says close', r.d.receipt.undo);
  const u = await undo(r.d.receipt.undo.token);
  ok(u.status === 200 && u.d.verified === true && issues.get(5).state === 'closed', 'closed, and read back closed', [u.status, u.d, issues.get(5)]);
}

section('A Slack message is posted, found again, and can be deleted - or Slack\'s refusal is said in Slack\'s words');
{
  let r = await act('slack.post', { channel: '#team', text: 'Release notes' });
  ok(r.status === 200 && r.d.receipt.status === 'done' && r.d.result.link && r.d.receipt.undo && r.d.receipt.undo.label === 'Delete the message',
     'posted, with its link read back, and a way to delete it', [r.status, r.d.result, r.d.receipt && r.d.receipt.undo && r.d.receipt.undo.label]);
  let u = await undo(r.d.receipt.undo.token);
  ok(u.status === 200 && u.d.verified === true && !slack.has('C1:9.9'), 'deleted, and Slack no longer has it', [u.status, u.d]);
  r = await act('slack.post', { channel: '#team', text: 'Again' });
  stubborn = true; u = await undo(r.d.receipt.undo.token); stubborn = false;
  ok(u.status === 502 && u.d.error === 'not_confirmed', 'a delete Slack accepted and did not do is not "undone"', [u.status, u.d]);
  r = await act('slack.post', { channel: '#nope', text: 'Hello' });
  ok(r.status === 502 && /channel_not_found/.test(r.d.message || '') && /Nothing was posted/.test(r.d.message || ''), 'a refusal names Slack\'s reason and says nothing went out', r.d);
  r = await act('slack.post', { text: 'Hello' });
  ok(r.status === 400 && /which Slack channel/.test(r.d.message || ''), 'and no channel is never a guessed one', r.d);
}

section('A sheet goes back to what it said - unless somebody has written in it since');
{
  const R = 'Budget!A1:B2';
  cells.set(R, [['Rent', '=B1*2'], ['Food', '']]);
  let r = await act('sheets.write', { fileId: 'sheet1234567890', range: R, values: [['Rent', 1200], ['Food', 300]] });
  ok(r.status === 200 && r.d.receipt.status === 'done' && r.d.receipt.undo && !('_prior' in r.d.result) && !('_wrote' in r.d.result),
     'written and checked, with a ticket; the earlier cells travel in the ticket, not the answer', r.d.result);
  let u = await undo(r.d.receipt.undo.token);
  ok(u.status === 200 && u.d.verified === true, 'taken back and checked', [u.status, u.d]);
  ok(JSON.stringify(cells.get(R)) === JSON.stringify([['Rent', '=B1*2'], ['Food', '']]), 'the formula is a formula again, and the empty cell is empty', cells.get(R));

  r = await act('sheets.write', { fileId: 'sheet1234567890', range: R, values: [['Rent', 1300], ['Food', 310]] });
  cells.set(R, [['Rent', 1300], ['Food', 999]]);
  u = await undo(r.d.receipt.undo.token);
  ok(u.status === 409 && u.d.error === 'changed_since' && cells.get(R)[1][1] === 999, 'somebody changed a cell since: their number stays', [u.status, cells.get(R)]);

  deafSheet = true;
  r = await act('sheets.write', { fileId: 'sheet1234567890', range: 'Other!A1:A1', values: [['x']] });
  deafSheet = false;
  ok(r.status === 502 && r.d.error === 'not_confirmed' && r.d.result && !('_prior' in r.d.result) && !('_wrote' in r.d.result),
     'a write that did not take says so - and its answer still carries none of the cells kept for the undo', r.d);

  const big = Array.from({ length: 30 }, (_, i) => Array.from({ length: 20 }, (_, j) => i * j));
  r = await act('sheets.write', { fileId: 'sheet1234567890', range: 'Big!A1:T30', values: big });
  ok(r.status === 200 && r.d.receipt.undo === null && /Version history/.test(r.d.receipt.irreversible || ''),
     'too many cells to carry: no ticket, and it says where the way back is', r.d.receipt);
}

section('Signing out everywhere ends the tickets too');
{
  /* Once already, so this account's sessions are a generation on: a ticket
     made now must carry that generation, or it would never work at all. */
  await W.revokeUserTokens(env, ME);
  const fresh = (await jsonOf(await req(env, '/auth/login', { email: ME, password: 'A-real-Passw0rd!' }))).token;
  const made = await act('calendar.create', { title: 'Soon', start: '2026-11-03T08:00:00Z' }, fresh);
  const back = await undo(made.d.receipt.undo.token, fresh);
  ok(back.status === 200 && back.d.verified === true, 'after signing out everywhere once, a new ticket still works', [back.status, back.d]);
  const r = await act('calendar.create', { title: 'Later', start: '2026-11-03T09:00:00Z' }, fresh);
  await W.revokeUserTokens(env, ME);
  const u = await undo(r.d.receipt.undo.token);
  ok(u.status !== 200 && events.has('e1'), 'a ticket from before is refused, and nothing is deleted', u.status);
}

if (report('what-amv-did-can-be-taken-back') > 0) process.exitCode = 1;
done();
