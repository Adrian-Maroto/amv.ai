/* "IT HAS TO BE SEARCH BAR, THEN THE MAIN ONES AS I SAID BEFORE, AND THEN SEE
   ALL XYZ CONNECTORS BELOW THE MAIN ONES WITH LIKE 100 EACH. SO EMAIL, SEE ALL
   FOR EMAIL. THEN BANK ACCOUNT. SEE ALL FOR BANK ACCOUNT. NONE OF THE THING
   THAT IT SAYS NOW. ALSO THE SEARCH BAR IS VERY LAGGY."

   Three things, and they turned out to be one thing.

   THE ORDER. The search box was at the bottom of the page, inside the registry
   section, under the connected accounts, the bridge panel and the whole
   hand-built catalogue. It is the first control now.

   THE LAG. It was not lag. The box was rendered inside the `.cdir` node that
   `_cdirPaint` replaces whenever registry answers land, so the element being
   typed into was destroyed and rebuilt - repeatedly, for the first several
   seconds of the page, because twenty-six rows each fetched on paint. Its
   value came from a variable only written on submit, so every rebuild put back
   the last SEARCHED term and dropped the half-typed one. Moving it out of that
   node is the fix; that claim lives in
   `the-connector-directory-on-the-screen`, with the element-identity test.

   THE BANK. A bank account is one of the most consequential things AMV
   connects to, five Crew jobs and the money leak detector read from it, and
   this page had no row for it at all - it was linked from Spending and nowhere
   else, so somebody browsing "everything AMV can work inside" would not have
   found it.

   What this file holds is the SHAPE of the page: what comes first, what the
   main ones are, that every one of them has a door to more of its own kind,
   and that the bank is among them and sends people to the one place the link
   actually happens rather than to a second copy of a money flow. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'integrations', user: { name: 'A', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());
await page.waitForTimeout(600);

const bank = on => page.evaluate(v => {
  saveStr('amv_fin_linked', v ? '1' : '');
  renderIntegrationsView();
}, on);

section('The search box is the first control on the page');
{
  const r = await page.evaluate(() => {
    const vi = document.querySelector('.vi-conn');
    const find = document.getElementById('cdir-find');
    if (!vi || !find) return { missing: true };
    /* Compared by document position rather than by reading the markup, so this
       measures what a person meets going down the page. */
    const before = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return !!(find.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    };
    return {
      accounts: before('#conn-sec'),
      machine: before('details.conn-machine'),
      catalogue: before('#int-catalog'),
      /* And it is not buried inside any of them. */
      insideCdir: !!find.closest('.cdir'),
      insideCatalog: !!find.closest('#int-catalog'),
    };
  });
  ok(!r.missing, 'the page has a search box', JSON.stringify(r));
  ok(r.accounts, 'before connected accounts', String(r.accounts));
  ok(r.machine, 'before the computer panel', String(r.machine));
  ok(r.catalogue, 'before the hand-built connectors', String(r.catalogue));
  ok(!r.insideCdir && !r.insideCatalog,
     'and it belongs to the page rather than to a section that gets repainted',
     JSON.stringify(r));
}

section('Then the main ones, each with a door to more of its own kind');
{
  const r = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('#int-catalog .ss2')];
    return {
      sections: secs.length,
      titles: secs.map(s => (s.querySelector('h3') || {}).textContent.trim()),
      /* Every hand-built section ends in a door, because the point of the
         section is that the answer to "can AMV connect to X" is on the screen
         for X rather than in one lump at the bottom. */
      withDoor: secs.filter(s => s.querySelector('.int-seeall [data-dact="cdirAll"]')).length,
      queries: secs.map(s => {
        const d = s.querySelector('.int-seeall [data-dact="cdirAll"]');
        return d ? d.dataset.darg : null;
      }),
      cards: document.querySelectorAll('#int-catalog .int-card').length,
    };
  });
  ok(r.sections >= 5, 'there are hand-built sections', String(r.sections));
  ok(r.withDoor === r.sections, 'and every one of them has a See all',
     r.withDoor + ' of ' + r.sections);
  ok(r.queries.every(Boolean) && new Set(r.queries).size === r.sections,
     'each door running its own query, so no two headings send the same search',
     r.queries.join(','));
  ok(r.cards >= 10, 'with real connectors in them', String(r.cards));
  ok(r.titles.some(t => /email/i.test(t)), 'email is one of them', r.titles.join(' | '));
  ok(r.titles.some(t => /bank|money/i.test(t)), 'and so is the bank', r.titles.join(' | '));
}

section('There is no "everything else" at the bottom, only topics in one format');
{
  /* "No part should say everything else by topic, it should stay consistent."
     The registry's doors used to sit in a block of their own under the
     hand-built rows; now every topic is a section of the Email shape and ends
     in its own door, so the block has nothing left to hold. */
  const r = await page.evaluate(() => ({
    lump: /Everything else/i.test((document.querySelector('.vi-conn') || {}).textContent || ''),
    block: !!document.querySelector('.vi-conn .cdir'),
    oldDoors: document.querySelectorAll('.cdir-topic').length,
  }));
  ok(!r.lump, 'no heading says "everything else"', JSON.stringify(r));
  ok(!r.block && r.oldDoors === 0, 'and there is no separate block of registry doors', JSON.stringify(r));
}

section('The bank account is on the page, and says what it really is');
{
  await bank(false);
  const r = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.int-card')]
      .find(c => /Bank account/i.test((c.querySelector('.int-name') || {}).textContent || ''));
    if (!card) return { missing: true };
    const t = card.textContent.replace(/\s+/g, ' ');
    const btn = card.querySelector('[data-int-use]');
    return {
      desc: t,
      autonomous: !!card.querySelector('.ax-auto'),
      connected: /Connected/.test(t),
      action: btn ? btn.dataset.intUse : null,
      label: btn ? btn.textContent.trim() : null,
      /* It must NOT offer to disconnect from here: this page cannot carry out
         a bank disconnect, and a button that cannot do what it says is worse
         than no button. */
      disconnect: !!card.querySelector('[data-int-disc]'),
      /* Nor a Connect that would need a second copy of the hosted link flow. */
      connect: !!card.querySelector('[data-int-conn]'),
    };
  });
  ok(!r.missing, 'there is a Bank account row', JSON.stringify(r));
  ok(/never sees your password/i.test(r.desc),
     'saying the one thing everybody asks about this feature', r.desc.slice(0, 120));
  ok(/read-only/i.test(r.desc) && /cannot move money/i.test(r.desc),
     'and that it reads and cannot move money', r.desc.slice(0, 200));
  ok(r.autonomous, 'marked autonomous, because the schedule really does read it', String(r.autonomous));
  ok(!r.connected, 'not claiming to be connected when nothing is linked', String(r.connected));
  ok(r.action === 'bank' && /Spending/i.test(r.label),
     'and the button names where the linking happens', r.label);
  ok(!r.disconnect && !r.connect,
     'with no Connect or Disconnect this page could not actually carry out',
     JSON.stringify(r));
}

section('Linking is done in one place, not copied onto this page');
{
  /* THE LINK IS A HOSTED SIGN-IN with a pre-opened window, a user activation
     that must not be spent on an await, and a returning "I have finished
     linking" step on a replaced node. A second implementation of that here
     would be two copies of a money flow, and whichever one somebody forgets to
     fix is the one that breaks. So the button navigates. */
  const r = await page.evaluate(async () => {
    let said = '';
    window.toast = (m) => { said = m; };
    const before = S.tab;
    const card = [...document.querySelectorAll('.int-card')]
      .find(c => /Bank account/i.test((c.querySelector('.int-name') || {}).textContent || ''));
    card.querySelector('[data-int-use]').click();
    await new Promise(r => setTimeout(r, 400));
    return { before, after: S.tab, said };
  });
  ok(r.before === 'integrations' && r.after === 'spend',
     'pressing it goes to Spending', JSON.stringify(r));
  ok(/never sees your password/i.test(r.said),
     'and says what is about to happen rather than the upload sentence every other row gets',
     r.said);
  ok(!/Upload your file/i.test(r.said),
     'which would have been the fall-through, and is baffling for a bank account', r.said);
}

section('Once a bank is linked the row says so, and offers Manage');
{
  await page.evaluate(() => setTab('integrations'));
  await page.waitForTimeout(400);
  await bank(true);
  const r = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.int-card')]
      .find(c => /Bank account/i.test((c.querySelector('.int-name') || {}).textContent || ''));
    const btn = card.querySelector('[data-int-use]');
    return { connected: /Connected/.test(card.textContent),
             label: btn ? btn.textContent.trim() : null,
             disconnect: !!card.querySelector('[data-int-disc]') };
  });
  ok(r.connected, 'the row reports it', String(r.connected));
  ok(/Manage/i.test(r.label), 'and offers to manage it rather than to set it up again', r.label);
  ok(!r.disconnect, 'still with no Disconnect this page cannot carry out', String(r.disconnect));
}

section('Nothing below the search bar loads on arrival');
{
  /* The whole reason the rows went. Asserted here as well as in the topic-page
     suite because this is the file about the page's shape, and "the page is
     instant" is part of that shape rather than a detail of the directory. */
  await page.evaluate(() => { setTab('chat'); });
  await page.waitForTimeout(200);
  const r = await page.evaluate(async () => {
    let asked = 0;
    const real = AMV_API.connectors;
    AMV_API.connectors = async (...a) => { asked++; return real ? real(...a) : { servers: [] }; };
    setTab('integrations');
    await new Promise(r => setTimeout(r, 2000));
    AMV_API.connectors = real;
    return { asked, skeletons: document.querySelectorAll('.cdir-skel').length };
  });
  ok(r.asked === 0, 'the page asks the registry nothing at all', String(r.asked));
  ok(r.skeletons === 0, 'so there is nothing waiting to fill in', String(r.skeletons));
}

ok(errors.length === 0, 'and nothing threw along the way', JSON.stringify(errors.slice(0, 3)));
await app.close();
report();
done();
