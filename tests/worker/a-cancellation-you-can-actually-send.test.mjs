/* THE DO HALF, AND THE LINE IT DOES NOT CROSS.

   The owner chose (a): AMV drafts the cancellation and stops for approval.
   (b) - unattended sending inside a rule - was refused permanently, and (c) -
   provider APIs that can read the cancellation back - is the destination. See
   docs/ROADMAP.md for the reasoning; what this suite holds is the code.

   Three things have to be true, and the third is the one that decides whether
   this is a feature or a demo:

     1. AN UNATTENDED RUN CANNOT SEND IT. Not "does not" - cannot, because
        `AUTO_USES_ALLOWED` has no `mail.send` in it, so there is no path from
        the cron to an outbound message.
     2. THE ADDRESS IS READ, NEVER INVENTED. A guessed cancellation address is
        somebody's account details posted to a stranger.
     3. A DRAFT TO A no-reply MAILBOX IS NOTHING, AND MUST SAY SO. This is the
        common case, not the edge one - most receipts come from an unattended
        mailbox. Drafting a letter into a void and calling it an action is
        worse than doing nothing, because the person stops looking for the real
        cancel button. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'cancel.harness.mjs');
writeFileSync(harness, src + `
export { _detectSubscriptions, _subFromAddr, _cancelDeliverable, _cancelDraft, _cancelVerdict,
         AUTO_USES_ALLOWED, _autoAccountContext, runDueAutomations };
export function __setConnUse(fn){ connUse = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'owner@test.com';
const msg = (from, subject, snippet) => ({
  id: 'm' + Math.random().toString(36).slice(2), from, subject,
  snippet: snippet || '', occurred_at: Date.now(), date: 'today',
});

section('An unattended run has no way to send anything at all');
{
  /* The whole of option (a) rests on this one list. If `mail.send` ever
     appears in it, every other assertion in this file is decoration. */
  ok(Array.isArray(W.AUTO_USES_ALLOWED), 'the allowed list is readable from the worker', W.AUTO_USES_ALLOWED);
  ok(!W.AUTO_USES_ALLOWED.some(u => /send|write|post|delete|pay/i.test(String(u))),
     'nothing in it is a write of any kind - a scheduled run may read and may not act',
     W.AUTO_USES_ALLOWED);
  ok(W.AUTO_USES_ALLOWED.every(u => /\.read$/.test(String(u))),
     'every entry is explicitly a read, so a new one cannot slip in unnoticed',
     W.AUTO_USES_ALLOWED);
}

section('The address comes off the receipt, verbatim');
{
  ok(W._subFromAddr('Netflix <info@netflix.com>') === 'info@netflix.com', 'out of a named From', true);
  ok(W._subFromAddr('billing@spotify.com') === 'billing@spotify.com', 'or a bare one', true);
  ok(W._subFromAddr('"Acme, Inc." <BILLING@Acme.CO.UK>') === 'billing@acme.co.uk',
     'normalised to lower case, so two spellings of one mailbox are one mailbox', true);
  ok(W._subFromAddr('Netflix') === '', 'and nothing at all when there is no address to read', true);
  ok(W._subFromAddr('') === '', 'including from an empty sender', true);
  ok(W._subFromAddr('not-an-address@localhost') === '',
     'an address with no dotted domain is not accepted rather than half-accepted', true);
}

section('A mailbox nobody reads is recognised as one');
{
  const no = a => W._cancelDeliverable(a).why;
  ok(no('no-reply@netflix.com') === 'no_reply', 'no-reply', true);
  ok(no('noreply@spotify.com') === 'no_reply', 'noreply', true);
  ok(no('do-not-reply@bank.com') === 'no_reply', 'do-not-reply', true);
  ok(no('donotreply@x.com') === 'no_reply', 'donotreply', true);
  ok(no('notifications@github.com') === 'no_reply', 'notifications', true);
  ok(no('mailer-daemon@x.com') === 'no_reply', 'mailer-daemon', true);
  ok(no('no-reply+billing@x.com') === 'no_reply',
     'and a tagged one, which is how a lot of them actually arrive', true);
  ok(no('') === 'no_address', 'no address at all is its own answer, not a no-reply', true);

  /* The other direction matters as much: calling a real mailbox unattended
     would refuse to draft the one cancellation that could have worked. */
  ok(W._cancelDeliverable('billing@acme.com').ok === true, 'billing@ is a real mailbox', true);
  ok(W._cancelDeliverable('support@acme.com').ok === true, 'and support@', true);
  ok(W._cancelDeliverable('noreplacement@acme.com').ok === true,
     'and a word that merely starts with "norep" is not a no-reply', true);
  ok(W._cancelDeliverable('help@noreply.example.com').ok === true,
     'and a sending DOMAIN called noreply is not the same as an unattended mailbox', true);
}

section('Detection carries the address, so nothing has to look one up later');
{
  const rows = W._detectSubscriptions([
    msg('Netflix <info@netflix.com>', 'Your membership renews', 'We charged you $15.99 monthly'),
  ]);
  ok(rows.length === 1, 'the charge was found', rows);
  ok(rows[0].from === 'info@netflix.com', 'with the address it came from', rows[0]);
  ok(rows[0].deliverable === true, 'and the fact that somebody reads it', rows[0]);
}

section('A merchant that writes from both is remembered by the one you can reply to');
{
  const rows = W._detectSubscriptions([
    msg('Acme <no-reply@acme.com>', 'Your subscription renews', 'recurring'),
    msg('Acme <billing@acme.com>', 'Your subscription renews - receipt', 'We charged you $9.00 monthly'),
  ]);
  ok(rows.length === 1, 'still one subscription, not two', rows);
  ok(rows[0].from === 'billing@acme.com' && rows[0].deliverable === true,
     'and it kept the address a person actually reads', rows[0]);

  /* The other order, because otherwise the answer depends on which receipt
     happened to arrive last. */
  const back = W._detectSubscriptions([
    msg('Acme <billing@acme.com>', 'Your subscription renews', 'We charged you $9.00 monthly'),
    msg('Acme <no-reply@acme.com>', 'Your subscription renews - reminder', 'recurring'),
  ]);
  ok(back[0].from === 'billing@acme.com',
     'in either order - a later no-reply does not overwrite a usable address', back[0]);

  /* And a merchant that only ever writes from unattended mailboxes stays
     unattended, however many receipts it sends. Without this, "keep looking
     for a better address" quietly becomes "the second one is better". */
  const never = W._detectSubscriptions([
    msg('Acme <no-reply@acme.com>', 'Your subscription renews', 'We charged you $9.00 monthly'),
    msg('Acme <noreply@acme.com>', 'Your subscription renews - reminder', 'recurring'),
  ]);
  ok(never.length === 1, 'one row still', never);
  ok(never[0].deliverable === false,
     'and still nowhere to write, rather than the second no-reply counting as an upgrade', never[0]);
}

section('The letter says the one thing it is for, and asks for proof');
{
  const d = W._cancelDraft({ merchant: 'Netflix', amount: 15.99, currency: 'USD',
                             cadence: 'monthly', from: 'billing@netflix.com',
                             evidence: 'Your membership renews' }, ME);
  ok(/^Cancel my subscription - Netflix$/.test(d.subject), 'the subject says what it is', d.subject);
  ok(/USD 15\.99/.test(d.body), 'the amount is the one that was read, to the penny', d.body);
  ok(/monthly/.test(d.body), 'and so is how often', d.body);
  ok(/confirm in writing/i.test(d.body),
     'it asks for written confirmation - without it "I cancelled" is a belief, not a fact', d.body);
  ok(/date the last billing period ends/i.test(d.body),
     'and for the date charges actually stop', d.body);
  ok(d.body.includes(ME), 'and it is signed by the account it is sent from', d.body);
  ok(d.to === 'billing@netflix.com', 'addressed to the receipt, not to a lookup', d.to);
}

section('What was not read is not claimed');
{
  const d = W._cancelDraft({ merchant: 'Acme', amount: null, currency: null,
                             cadence: null, from: 'billing@acme.com' }, ME);
  ok(!/null|undefined|NaN/.test(d.body),
     'no unread figure leaks into the letter as a word', d.body);
  ok(/the recurring charge/.test(d.body),
     'it describes the charge in the terms it can stand behind', d.body);
  ok(!/\d+\.\d\d/.test(d.body), 'and states no amount at all rather than a plausible one', d.body);

  const c = W._cancelDraft({ merchant: 'Acme', amount: 9, currency: 'GBP',
                             cadence: null, from: 'billing@acme.com' }, ME);
  ok(/GBP 9\.00/.test(c.body) && !/monthly|yearly|weekly/.test(c.body),
     'an amount with no cadence is stated without inventing one', c.body);
}

section('A draft nobody will read says so BEFORE anyone presses send');
{
  const v = W._cancelVerdict({ merchant: 'Netflix', from: 'no-reply@netflix.com' });
  ok(v.can === false, 'it does not offer to send it', v);
  ok(v.code === 'no_reply', 'and says why in a code the screen can branch on', v);
  ok(/would do nothing/i.test(v.say),
     'in words: sending this there achieves nothing', v.say);
  ok(/own account page/i.test(v.say),
     'and it says what to do instead, which is the only useful half', v.say);
  ok(/Netflix/.test(v.say), 'naming the provider, so the instruction is followable', v.say);
}

section('No address at all is a different answer from an unread one');
{
  const v = W._cancelVerdict({ merchant: 'Acme', from: '' });
  ok(v.can === false && v.code === 'no_address', 'told apart', v);
  ok(/could not read a return address/i.test(v.say),
     'and described as what it is - AMV could not read one, not "they do not reply"', v.say);
}

section('And a sendable one is honest about what sending actually achieves');
{
  const v = W._cancelVerdict({ merchant: 'Acme', from: 'billing@acme.com' });
  ok(v.can === true, 'it can go', v);
  ok(/the address the receipt came from/i.test(v.say),
     'saying where the address came from, because that is the bit only the person can check', v.say);
  ok(/not one AMV looked up/i.test(v.say),
     'and explicitly that AMV did not find it somewhere', v.say);
  ok(/request/i.test(v.say), 'it is called a request, not a cancellation', v.say);
  ok(/cannot see whether they act on it/i.test(v.say),
     'and AMV says plainly that it cannot see the outcome', v.say);
}

section('Nothing AMV says to the PERSON claims the subscription is cancelled');
{
  /* The sentence that must not exist, and the distinction that took a failing
     assertion to get right. The LETTER is addressed to the merchant, and
     "please confirm in writing that it is cancelled" is the correct thing to
     ask them for - it is a request, and asking for proof is the whole point.
     The VERDICTS are addressed to the person, and there the same words would
     be a claim about a fact AMV cannot see. Same string, opposite meaning,
     decided entirely by who is reading it. */
  const toPerson = [
    W._cancelVerdict({ merchant: 'A', from: 'billing@a.com' }).say,
    W._cancelVerdict({ merchant: 'A', from: 'no-reply@a.com' }).say,
    W._cancelVerdict({ merchant: 'A', from: '' }).say,
  ];
  const claimed = toPerson.filter(s => /\b(is|has been|was|now|been) cancell?ed\b/i.test(String(s)));
  ok(claimed.length === 0,
     'not one of the three verdicts tells the person it is cancelled', claimed);
  ok(toPerson.length === 3 && toPerson.every(s => typeof s === 'string' && s.length > 40),
     'and all three were real sentences that were actually examined', toPerson.map(s => s.length));
}

section('The letter ASKS for a cancellation; it never reports one');
{
  const body = W._cancelDraft({ merchant: 'A', from: 'billing@a.com', amount: 1,
                                currency: 'USD', cadence: 'monthly' }, ME).body;
  ok(/^Please cancel my subscription/m.test(body),
     'it opens by asking, in the imperative, so there is nothing to interpret', body);
  ok(!/\bI (?:have |already )?cancell?ed\b/i.test(body),
     'and never states the cancellation as something that has happened', body);
  ok(/Please confirm in writing that it is cancelled/.test(body),
     'the one "is cancelled" it contains is a request for proof, addressed to them', body);
}

/* ── AND ALL OF IT HAS TO REACH THE PERSON ────────────────────────────────
   The functions above can be perfect and change nothing. A previous milestone
   shipped exactly that: a mutation to the wiring passed every test because the
   suite drove the pieces and never the path. So this drives the real run - a
   fake mailbox, the real `_autoAccountContext` - and reads what actually gets
   built for the model. */
const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', AMV_KV: {
  async get(k){ return store.has(k) ? store.get(k) : null; },
  async put(k, v){ store.set(k, v); },
  async delete(k){ store.delete(k); },
  async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
} };
W.__setConnUse(async () => ({ ok: true, token: 'tok' }));

const INBOX = [
  { id: 'a1', occurred_at: Date.now() - 3600e3, from: 'Netflix <no-reply@netflix.com>',
    subject: 'Your membership renews', snippet: 'We charged you $15.99 monthly' },
  { id: 'a2', occurred_at: Date.now() - 7200e3, from: 'Acme <billing@acme.com>',
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
  return new Response(JSON.stringify({
    id: m.id, internalDate: String(m.occurred_at), snippet: m.snippet, labelIds: ['INBOX'],
    payload: { headers: [{ name: 'From', value: m.from }, { name: 'Subject', value: m.subject },
                         { name: 'Date', value: new Date(m.occurred_at).toUTCString() }] },
  }), { status: 200 });
};

const ctx = await W._autoAccountContext(env, { id: 'j1', uses: ['mail.read'] }, ME);
const text = String((ctx && (ctx.text || ctx.context || ctx.parts && ctx.parts.join('\n'))) || JSON.stringify(ctx));

section('The run that reads the mail carries the verdicts with it');
{
  ok(/Netflix/.test(text) && /Acme/.test(text), 'both charges were found by the real run', text.length);
  ok(/WHETHER EACH ONE CAN BE CANCELLED BY EMAIL/.test(text),
     'and the run states, for each, whether emailing can do anything', text.length);
  ok(/would do nothing/i.test(text),
     'the no-reply one is called out as achieving nothing', true);
  ok(/own account page/i.test(text),
     'with the thing to do instead', true);
}

section('The letter is offered only where it could actually be delivered');
{
  const draftBlock = (/THIS IS THE EXACT TEXT AMV WOULD SEND[\s\S]*/.exec(text) || [''])[0];
  ok(/billing@acme\.com/.test(draftBlock),
     'the repliable one gets a real drafted letter', draftBlock.slice(0, 200));
  ok(!/To no-reply@netflix\.com/.test(draftBlock),
     'and the unattended one gets none - offering a letter that cannot be delivered is offering an action that does not exist',
     draftBlock.slice(0, 400));
  ok(/Please cancel my subscription/.test(draftBlock),
     'the letter in the run is the real one, not a description of one', draftBlock.slice(0, 200));
}

section('And the run says, in the prompt itself, that nothing has been sent');
{
  ok(/has NOT been sent/.test(text), 'the draft is marked as unsent', true);
  ok(/NOTHING ON THIS ROUTE CANCELS ANYTHING BY ITSELF/.test(text),
     'and the whole route is described as unable to act', true);
  ok(/Never tell them a subscription is cancelled/.test(text),
     'with the one sentence the model must never produce named explicitly', true);
}

section('And the letters come out of the run as data, not only as prose');
{
  /* The screen hands these to the person's own mail client. A letter that
     exists only inside the model's paragraph is a letter somebody has to
     retype out of a summary, which is the difference between a feature and a
     mention of one. */
  const ds = (ctx && ctx.drafts) || [];
  ok(ds.length === 1,
     'exactly one - the no-reply merchant produced no letter, because there is nowhere to send it', ds);
  ok(ds[0] && ds[0].to === 'billing@acme.com', 'addressed to the mailbox somebody reads', ds[0]);
  ok(ds[0] && ds[0].merchant === 'Acme', 'named, so the row can say which subscription it is', ds[0]);
  ok(ds[0] && /^Cancel my subscription/.test(String(ds[0].subject || '')), 'with a subject', ds[0] && ds[0].subject);
  ok(ds[0] && /Please cancel my subscription/.test(String(ds[0].body || '')), 'and the whole letter', ds[0] && ds[0].body);
  ok(!ds.some(d => /no-reply/i.test(String(d.to || ''))),
     'and nothing addressed to an unattended mailbox got in', ds.map(d => d.to));
}

section('And the run WRITES them onto the result, which is the seam that matters');
{
  /* The two halves can both be perfect and meet at nothing. The context
     builder returning drafts and the screen rendering drafts are separate
     facts from the result entry carrying them between the two - and that seam
     is exactly where a mutation survived, twice, in earlier milestones. So
     this drives the real cron and reads the record it left behind. */
  store.clear();
  /* The cron gates a run on what the ACCOUNT has connected, separately from
     whether a token can be fetched - so `connUse` answering is not enough and
     the run stops at "needs access" without it. Seeded rather than stubbed,
     because the gate is a real part of the path being tested. */
  await env.AMV_KV.put('goauth:' + ME, JSON.stringify({ refresh_token: 'r', access_token: 'a' }));
  await env.AMV_KV.put('mailcfg:' + ME, JSON.stringify({ secret: 'x' }));
  await env.AMV_KV.put('auto:' + ME, JSON.stringify({
    items: [{ id: 'j9', detail: 'inbox digest', repeat: 'daily', interval: 86400000,
              next: Date.now() - 60000, kind: 'task', approval: 'auto', notify: 'app',
              active: true, runs: 0, uses: ['mail.read'] }],
    results: [] }));
  await W.runDueAutomations(env);
  const rec = JSON.parse(store.get('auto:' + ME) || '{}');
  const res = (rec.results || [])[0] || {};
  ok(res.id, 'the run produced a result', JSON.stringify(res).slice(0, 400));
  ok(Array.isArray(res.drafts) && res.drafts.length === 1,
     'and the letter travelled with it, which is the only way the screen can hand it over', res.drafts);
  ok(res.drafts && res.drafts[0] && res.drafts[0].to === 'billing@acme.com',
     'still addressed to the mailbox somebody reads', res.drafts && res.drafts[0]);
  ok(res.drafts && res.drafts[0] && /Please cancel my subscription/.test(String(res.drafts[0].body || '')),
     'with the whole letter, not a summary of one', res.drafts && res.drafts[0] && res.drafts[0].body);
}

globalThis.fetch = realFetch;

if (report('a-cancellation-you-can-actually-send') > 0) process.exitCode = 1;
done();
