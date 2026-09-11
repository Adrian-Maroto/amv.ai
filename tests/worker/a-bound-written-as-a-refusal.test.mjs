/* THE NEVER LIST.

   The policy engine has understood `allowed_destinations` since it was written
   and nothing ever passed one, for a good reason: an ALLOWLIST of everybody
   AMV may contact is a list nobody can finish. People do not think "here are
   the eleven addresses you may write to". They think "never my employer",
   "never that bank", "never anyone at the school" - a short list of the places
   where being wrong is expensive.

   WHAT IT BINDS TO, precisely, because overstating it would be the defect.
   AMV cannot send to a third party at all - `_autoEmailResult` takes the
   address from the ACCOUNT and `AUTO_USES_ALLOWED` holds no send - so this is
   not a send filter. It governs what AMV PROPOSES: the cancellation letters it
   writes and puts in front of somebody with the address filled in and a button
   that opens their mail app.

   That is worth governing on its own, because those addresses are read out of
   MAIL. The destination of a draft is the one field in this product an
   outsider has any influence over, so "never write to my bank" has to mean the
   letter is not written - not that it is offered with a warning attached. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'never.harness.mjs');
writeFileSync(harness, src + `
export { _neverNorm, _neverList, _neverBlocks, autoUpdate, _autoAccountContext, NEVER_MAX };
export function __setRequireUser(fn){ requireUser = fn; }
export function __setConnUse(fn){ connUse = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'owner@test.com';
const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', AMV_KV: {
  async get(k){ return store.has(k) ? store.get(k) : null; },
  async put(k, v){ store.set(k, v); },
  async delete(k){ store.delete(k); },
  async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
} };
W.__setRequireUser(async () => ({ email: ME, plan: 'ultra' }));
W.__setConnUse(async () => ({ ok: true, token: 'tok' }));

const setNever = async (list) => {
  const res = await W.autoUpdate(new Request('https://x/v1/auto/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'never', never: list }),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

section('The three shapes a person would actually type');
{
  ok(W._neverNorm('someone@bank.com') === 'someone@bank.com', 'a whole address', true);
  ok(W._neverNorm('@bank.com') === '@bank.com', 'everyone at a domain', true);
  ok(W._neverNorm('bank.com') === '@bank.com',
     'and a bare domain, because nobody types the at sign when they mean "anyone there"',
     W._neverNorm('bank.com'));
  ok(W._neverNorm('  SOMEONE@Bank.COM ') === 'someone@bank.com',
     'normalised, so two spellings of one address are one entry', W._neverNorm('  SOMEONE@Bank.COM '));
  /* The fourth shape, which the first version got exactly backwards. `*` is a
     legal local-part character, so `*@bank.com` validated as a literal ADDRESS
     and was stored as a rule that could never match anything - a bound that
     silently matches nothing, which is worse than a refused one, because the
     person believes they are covered. It means what they obviously meant. */
  ok(W._neverNorm('*@bank.com') === '@bank.com',
     'and a star at a domain, which is everybody there and not a literal address',
     W._neverNorm('*@bank.com'));
}

section('Anything AMV would have to guess at is refused, not half-understood');
{
  /* A pattern AMV interprets loosely is a bound whose meaning only AMV knows,
     and the person finds that out at the worst possible moment. */
  for(const bad of ['bank', 'my bank', 'http://bank.com', '@@x', 'a@b',
                    'bank.c', '@.com', 'a b@bank.com', 'someone@bank', '@-bank.com']){
    ok(W._neverNorm(bad) === '', JSON.stringify(bad) + ' is not accepted as a rule', W._neverNorm(bad));
  }
  const r = await setNever(['bank.com', 'not a rule at all']);
  ok(r.status === 400 && r.body.code === 'bad_never',
     'and the whole save is refused rather than silently keeping the half it understood', r.body);
  ok(Array.isArray(r.body.rejected) && r.body.rejected.join(' ').includes('not a rule at all'),
     'naming what it could not read, so the person can fix that one', r.body.rejected);
}

section('A domain covers its subdomains, because a receipt comes from one');
{
  const list = ['@bank.com'];
  ok(W._neverBlocks(list, 'no-reply@bank.com') === '@bank.com', 'the domain itself', true);
  ok(W._neverBlocks(list, 'receipts@mail.bank.com') === '@bank.com',
     'and the sending subdomain a receipt actually arrives from - "never @bank.com" did not mean '
     + '"except mail.bank.com"', W._neverBlocks(list, 'receipts@mail.bank.com'));
  ok(W._neverBlocks(list, 'someone@notbank.com') === '',
     'while a domain that merely ends the same way is a different company', W._neverBlocks(list, 'someone@notbank.com'));
  ok(W._neverBlocks(list, 'someone@bank.com.evil.test') === '',
     'and a lookalike that puts the real domain in the middle does not match either',
     W._neverBlocks(list, 'someone@bank.com.evil.test'));
}

section('An address entry is exactly that address');
{
  const list = ['boss@work.com'];
  ok(W._neverBlocks(list, 'boss@work.com') === 'boss@work.com', 'it blocks', true);
  ok(W._neverBlocks(list, 'BOSS@WORK.COM') === 'boss@work.com', 'in any case', true);
  ok(W._neverBlocks(list, 'someone-else@work.com') === '',
     'and does not quietly become the whole company - if they meant that they would have said the domain',
     W._neverBlocks(list, 'someone-else@work.com'));
}

section('Saving one keeps it, and switching it off empties it');
{
  const r = await setNever(['bank.com', 'boss@work.com', 'BANK.com']);
  ok(r.status === 200, 'a good list saves', r.body);
  ok(r.body.never.length === 2,
     'with the duplicate spelling folded into one entry', r.body.never);
  const off = await setNever([]);
  ok(off.status === 200 && off.body.never.length === 0, 'and it can be cleared', off.body);
}

section('The audit records that a list was set, and NOT what is on it');
{
  /* This list is somebody naming the people and institutions that matter most
     to them - an employer, a bank, an ex. An audit log is the last place that
     belongs. */
  const audits = [];
  const realLog = console.log;
  console.log = (...a) => { audits.push(a.join(' ')); };
  await setNever(['ex@personal.example', 'mybank.com']);
  console.log = realLog;
  const line = audits.filter(l => /auto_never_set/.test(l)).join('\n');
  ok(line.length > 0, 'the change is audited at all', line.slice(0, 80));
  ok(/count/.test(line), 'by count', line.slice(0, 120));
  ok(!/personal\.example|mybank/.test(line),
     'and never by name - the entries are the private part', line.slice(0, 200));
}

section('A refused destination gets no letter, and the person is told why');
{
  /* THE ASSERTION THAT MAKES THIS A BOUND RATHER THAN DECORATION. Not "the
     letter is marked", not "a warning is shown" - not written at all. */
  const INBOX = [
    { id: 'a1', from: 'MyBank <receipts@mail.mybank.com>',
      subject: 'Your subscription renews', snippet: 'We charged you GBP 12.00 monthly' },
    { id: 'a2', from: 'Acme <billing@acme.com>',
      subject: 'Your subscription renews', snippet: 'We charged you GBP 9.00 monthly' },
  ];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if(!/googleapis\.com$/.test(u.hostname))
      return new Response(JSON.stringify({ content: [{ text: 'x' }], usage: {} }), { status: 200 });
    if(u.pathname.endsWith('/messages'))
      return new Response(JSON.stringify({ messages: INBOX.map(m => ({ id: m.id })) }), { status: 200 });
    const m = INBOX.find(x => x.id === decodeURIComponent(u.pathname.split('/').pop()));
    if(!m) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ id: m.id, internalDate: String(Date.now() - 3600e3),
      snippet: m.snippet, labelIds: ['INBOX'],
      payload: { headers: [{ name: 'From', value: m.from }, { name: 'Subject', value: m.subject },
                           { name: 'Date', value: new Date().toUTCString() }] } }), { status: 200 });
  };
  const job = { id: 'j1', detail: 'Summarise my inbox', uses: ['mail.read'] };
  const ctx = await W._autoAccountContext(env, job, ME, ['@mybank.com']);
  globalThis.fetch = realFetch;

  const drafts = ctx.drafts || [];
  ok(drafts.length === 1, 'one letter written, not two', drafts.map(d => d.to));
  ok(drafts[0] && drafts[0].to === 'billing@acme.com',
     'and it is the one that was not refused', drafts[0] && drafts[0].to);
  ok(!drafts.some(d => /mybank/i.test(String(d.to))),
     'nothing addressed to the refused domain was written at all', drafts.map(d => d.to));
  ok(!/To receipts@mail\.mybank\.com/.test(ctx.text),
     'and no letter to it reached the model either', ctx.text.length);
  ok(/never to write to @mybank\.com/i.test(ctx.text),
     'the run says the refusal is why, rather than going quiet about a subscription it found',
     (/[^\n]*never to write[^\n]*/i.exec(ctx.text) || [''])[0]);
  ok(/MyBank/i.test(ctx.text),
     'and still reports the charge itself - refusing to write is not refusing to tell them', true);
}

if (report('a-bound-written-as-a-refusal') > 0) process.exitCode = 1;
done();
