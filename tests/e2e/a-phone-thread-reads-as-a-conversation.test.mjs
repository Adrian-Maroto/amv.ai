/* ON A PHONE THE ACTION BAR WAS BIGGER THAN THE MESSAGE.

   Every turn carries edit/copy/like/speak/react underneath it. Once those
   buttons were sized for a thumb - 44px, which they must be - the bar measured
   55px against a 46px bubble, and .mwrap reserves another 18px of padding to
   seat it. So a one-word "Thanks" occupied 131px of a 844px screen, most of it
   controls nobody had asked for, and the thread read as pulled apart.

   Two things had to be true at once and were fighting: a control has to be big
   enough to hit, and a conversation has to look like a conversation. Making the
   buttons smaller would trade one defect for the other.

   So on a narrow screen the bar shows for the LAST turn - the one anybody acts
   on - and any other message reveals its own when tapped. Nothing was removed;
   the gesture is tapping the thing you want to act on, which is what somebody
   tries first on a phone. Desktop is untouched: there is a pointer there and
   the space is not scarce.

   Measured before and after, same three messages at 390x844:
       row heights   141, 180, 141   ->   64, 90, 141
       gap between turns    36px     ->   18px */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const MSGS = [
  { r: 'u', c: 'What is the capital of France?' },
  { r: 'a', c: 'Paris is the capital of France. It sits on the Seine.' },
  { r: 'u', c: 'Thanks' },
];
const seed = async (page) => page.evaluate(async (m) => {
  const cur = S.convs.find(c => c.id === S.cur) || S.convs[0];
  cur.msgs = m;
  renderChatMsgs();
  await new Promise(r => setTimeout(r, 350));
}, MSGS);

section('On a phone, only the last turn carries its action bar');
{
  const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' },
                              viewport: { width: 390, height: 844 } });
  await seed(app.page);
  const r = await app.page.evaluate(() => {
    const rows = [...document.querySelectorAll('#cm .mr')];
    const gaps = [];
    for (let i = 1; i < rows.length; i++)
      gaps.push(Math.round(rows[i].getBoundingClientRect().top - rows[i - 1].getBoundingClientRect().bottom));
    return {
      n: rows.length,
      shown: rows.map(e => getComputedStyle(e.querySelector('.macts')).display !== 'none'),
      heights: rows.map(e => Math.round(e.getBoundingClientRect().height)),
      gaps,
    };
  });
  ok(r.n === 3, 'the three turns rendered', r.n);
  ok(r.shown[0] === false && r.shown[1] === false,
     'the earlier turns do not carry a permanent bar', r.shown);
  ok(r.shown[2] === true, 'and the last one does, because that is the one you act on', r.shown);
  /* The numbers, so a regression is visible rather than a matter of taste. */
  ok(r.heights[0] < 100, 'a short turn is a short row', r.heights);
  /* Was `<= 24`, written when every gap was the same 18px. Spacing is paired
     now - tight from a question to its answer, wider before the next question -
     so the ceiling covers the larger of the two. The intent is unchanged and is
     the reason this exists: turns must not be pulled apart into a list of
     cards. Which gap is which is asserted separately, further down. */
  ok(r.gaps.every(g => g > 0 && g <= 32), 'and the turns sit at a conversational distance', r.gaps);
  await app.close();
}

section('A question and its answer read as one exchange');
{
  /* Reported twice as "off centered with the response like amv isn't
     connected". The geometry was already right; the RHYTHM was not. Every gap
     was a uniform 18px, and uniform spacing says every message is equally
     related to the one before it - so a reply sat no closer to the question it
     answered than to the next question, and nothing paired them.

     Asserted as a RELATIONSHIP rather than as two numbers, so the spacing can
     be retuned without this going red for a change that keeps the pairing. */
  const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' },
                              viewport: { width: 390, height: 844 } });
  await seed(app.page);
  const g = await app.page.evaluate(() => {
    const rows = [...document.querySelectorAll('#cm .mr')];
    const rects = rows.map(e => e.getBoundingClientRect());
    return rects.slice(1).map((r, i) => ({
      afterAQuestion: rows[i].className.includes('u'),
      gap: Math.round(r.top - rects[i].bottom),
    }));
  });
  const toAnswer = g.filter(x => x.afterAQuestion).map(x => x.gap);
  const toNext   = g.filter(x => !x.afterAQuestion).map(x => x.gap);
  ok(toAnswer.length > 0 && toNext.length > 0,
     'the thread has both kinds of gap to compare', { toAnswer, toNext });
  ok(Math.min(...toNext) > Math.max(...toAnswer),
     'a reply sits closer to its question than to the next one, so the pair is visible',
     { questionToAnswer: toAnswer, betweenExchanges: toNext });
  ok(Math.max(...toAnswer) > 0,
     'and they are still separate messages, not run together', toAnswer);
  await app.close();
}

section('Tapping any message brings its own actions back');
{
  /* The half that makes hiding them acceptable. If an older message could not
     be copied, this would be a removal dressed up as a layout fix. */
  const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' },
                              viewport: { width: 390, height: 844 } });
  await seed(app.page);
  const r = await app.page.evaluate(async () => {
    const first = document.querySelector('#cm .mr .mb');
    first.click();
    await new Promise(r => setTimeout(r, 200));
    const row = first.closest('.mr');
    const opened = getComputedStyle(row.querySelector('.macts')).display !== 'none';
    /* And a second tap puts it away, so it is a toggle rather than a one-way
       door that leaves the thread more cluttered than it started. */
    first.click();
    await new Promise(r => setTimeout(r, 200));
    const closed = getComputedStyle(row.querySelector('.macts')).display === 'none';
    /* Pressing a BUTTON in the bar must not be swallowed as a reveal gesture. */
    first.click();
    await new Promise(r => setTimeout(r, 150));
    const btn = row.querySelector('.macts .mact');
    let stillOpen = false;
    if (btn) { btn.click(); await new Promise(r => setTimeout(r, 150));
               stillOpen = getComputedStyle(row.querySelector('.macts')).display !== 'none'; }
    return { opened, closed, stillOpen, hadButton: !!btn };
  });
  ok(r.opened, 'a tap reveals that message’s actions', r.opened);
  ok(r.closed, 'and a second tap puts them away', r.closed);
  ok(r.hadButton && r.stillOpen,
     'while pressing a button in the bar acts, rather than closing it', r);
  await app.close();
}

section('Desktop is untouched - every turn keeps its bar');
{
  /* The fix is for a narrow screen with no pointer. Applying it everywhere
     would take a working affordance away from the surface that has room. */
  const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' },
                              viewport: { width: 1280, height: 900 } });
  await seed(app.page);
  const shown = await app.page.evaluate(() =>
    [...document.querySelectorAll('#cm .mr')].map(e => getComputedStyle(e.querySelector('.macts')).display !== 'none'));
  ok(shown.length === 3 && shown.every(Boolean),
     'all three turns show their actions on a wide screen', shown);
  await app.close();
}

if (report('a-phone-thread-reads-as-a-conversation') > 0) process.exitCode = 1;
done();
