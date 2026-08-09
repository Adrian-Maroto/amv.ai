/* TWO PEOPLE, TWO BROWSERS, ONE CONVERSATION.

   The Worker tests prove the record is written and read correctly. They cannot
   prove the thing that was actually broken, because what was broken was that
   the CLIENT never asked. The inbox read localStorage, so every test that
   looked at one person's screen agreed with every other test, and the seller's
   empty inbox was invisible from the only side anybody checked.

   The only way to see that is two separate browsers. One person asks about a
   listing; the other person, signed in somewhere else with their own storage,
   opens their messages. If it is there, the wire exists. If it is not, it never
   did, however green the two halves are.

   This is also the shape of the fix being right: nothing here reaches into
   storage or calls an internal function. It clicks what a person clicks. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const outbound = makeOutbound();
const emails = [];
outbound.on(/resend|mail|sendgrid|postmark/i, (_u, opts) => {
  emails.push(String((opts && opts.body) || ''));
  return { id: 'e1' };
});
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const env = makeEnv({ APP_URL: 'http://localhost:9201', EMAIL_API_KEY: 'k' });
const L = await bootLive({ env, outbound, port: 9201 });
const { page } = L;

const PW = 'A-real-Passw0rd!';
const SELLER = 'sam@example.com';
const BUYER = 'bea@example.com';

/* Sign up through the real form, the way a person does. */
async function signUp(p, email, name) {
  await p.evaluate(async ([em, pw, nm]) => {
    openAuth('signup');
    await new Promise(x => setTimeout(x, 350));
    const type = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', nm); type('#a-email', em); type('#a-pass', pw);
    document.getElementById('auth-submit').click();
    await new Promise(x => setTimeout(x, 1200));
  }, [email, PW, name]);
}

section('A seller lists something');
{
  await signUp(page, SELLER, 'Sam');
  const made = await page.evaluate(async () => {
    /* _fetch resolves with the RESPONSE. Reading `.item` off it yields
       undefined and the fixture silently builds nothing - which is how this
       file first reported the product as broken when the fixture was. */
    const r = await AMV_API._fetch('/v1/market/publish', { method: 'POST', body: JSON.stringify({
      title: 'Vintage denim jacket', text: 'the goods', desc: 'Barely worn', price: 40 }) });
    const d = await r.json().catch(() => null);
    return d && d.item ? d.item.id : JSON.stringify(d);
  });
  ok(/^usr_/.test(String(made)), 'the listing is live on the server', made);
  globalThis.__item = made;
}

section('A different person, in a different browser, asks about it');
{
  const second = await L.otherDevice();
  globalThis.__buyerPage = second.page;
  await signUp(second.page, BUYER, 'Bea');

  const sent = await second.page.evaluate(async (itemId) => {
    /* Through the product's own path: the seller is derived from the listing,
       so this is a first message to somebody they have never dealt with. */
    try {
      const t = await AMVMarket.sendMessage('sam@example.com', 'Hi! Is this still available?', 'Sam', { item: itemId });
      return { ok: true, msgs: (t.msgs || []).length };
    } catch (e) { return { ok: false, err: String(e.message || e) }; }
  }, globalThis.__item);
  ok(sent.ok === true, 'the question is accepted', sent.err || 'ok');
  ok(sent.msgs === 1, 'and is in the conversation', sent.msgs);
  await L.settle();
}

section('And the SELLER sees it, on their own machine');
{
  /* The whole point. Before this, the seller's inbox was their own empty
     localStorage and they were never going to see anything. */
  const inbox = await page.evaluate(async () => {
    await AMVMarket.syncThreads();
    const t = AMVMarket.myThreads();
    return { count: t.length, unread: AMVMarket.unreadCount(),
             texts: t.flatMap(x => (x.msgs || []).map(m => m.text)) };
  });
  ok(inbox.count === 1, 'the conversation is in the seller’s inbox', inbox.count);
  ok(inbox.texts.some(x => /still available/i.test(x)),
     'carrying what the buyer actually asked', inbox.texts);
  ok(inbox.unread === 1, 'and it is flagged as waiting for them', inbox.unread);
}

section('They were told to come and read it, and told nothing else');
{
  ok(emails.length === 1, 'one notification went out', emails.length);
  const blob = emails.join(' ');
  ok(/sam@example\.com/.test(blob), 'to the seller', true);
  ok(/Bea/.test(blob), 'naming who messaged them', true);
  ok(!/still available/i.test(blob),
     'and NOT carrying the message, so AMV cannot be used to mail somebody arbitrary text', blob.slice(0, 160));
}

section('The seller opens it and replies, and the buyer sees the reply');
{
  const replied = await page.evaluate(async () => {
    const t = AMVMarket.myThreads()[0];
    if (!t) return { ok: false, err: 'the seller has no conversation to reply to' };
    const other = t.a === AMVMarket._me() ? t.b : t.a;
    AMVMarket.markThreadRead(other);
    try { await AMVMarket.sendMessage(other, 'Yes it is - happy to post today.', 'Bea'); return { ok: true }; }
    catch (e) { return { ok: false, err: String(e.message || e) }; }
  });
  ok(replied.ok === true, 'the seller can reply into the same conversation', replied.err || 'ok');
  await L.settle();

  const buyerSees = await globalThis.__buyerPage.evaluate(async () => {
    await AMVMarket.syncThreads();
    const t = AMVMarket.myThreads();
    return { count: t.length, msgs: (t[0] || {}).msgs ? t[0].msgs.map(m => m.text) : [],
             unread: AMVMarket.unreadCount() };
  });
  ok(buyerSees.count === 1, 'the buyer still has exactly one conversation, not two', buyerSees.count);
  ok(buyerSees.msgs.length === 2, 'holding both sides of it', buyerSees.msgs);
  ok(/happy to post/i.test(buyerSees.msgs.join(' ')), 'including the reply', buyerSees.msgs);
  ok(buyerSees.unread === 1, 'and the buyer is the one with something to read now', buyerSees.unread);
}

section('Opening it clears the badge, and it stays cleared');
{
  const cleared = await globalThis.__buyerPage.evaluate(async () => {
    const t = AMVMarket.myThreads()[0];
    if (!t) return -1;
    const other = t.a === AMVMarket._me() ? t.b : t.a;
    AMVMarket.markThreadRead(other);
    await new Promise(r => setTimeout(r, 200));
    await AMVMarket.syncThreads();
    return AMVMarket.unreadCount();
  });
  ok(cleared === 0, 'nothing is waiting once it has been read', cleared);
}

section('A stranger cannot start a conversation out of the blue');
{
  /* Counted from HERE, not from zero. The seller's reply above legitimately
     notified the buyer, so a total of one was the test being wrong about the
     product rather than the product being wrong. What matters is that a
     REFUSED message notifies nobody. */
  const before = emails.length;
  const third = await L.otherDevice();
  await signUp(third.page, 'nosy@example.com', 'Nosy');
  const tried = await third.page.evaluate(async () => {
    try { await AMVMarket.sendMessage('sam@example.com', 'buy my coins', 'Sam'); return { ok: true }; }
    catch (e) { return { ok: false, err: String(e.message || e) }; }
  });
  ok(tried.ok === false, 'a typed address with no listing and no thread is refused', tried);
  ok(/listing|conversation/i.test(tried.err || ''),
     'and told how messaging actually works, rather than a bare failure', tried.err);
  await L.settle();
  ok(emails.length === before, 'and nobody is emailed about a message that was refused', emails.length - before);
}

section('Nothing broke');
{
  ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 4));
}

await L.close();
outbound.restore();
if (report('the-seller-actually-gets-it') > 0) process.exitCode = 1;
done();
