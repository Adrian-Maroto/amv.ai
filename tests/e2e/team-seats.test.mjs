/* TEAMS AND SEATS - the screen side of AMV-100.

   A team that inherits one subscription is only safe if the app tells the truth
   about it in three places, and each of those was wrong before:

     - The pitch claimed "team-grade limits: higher usage and more jobs at
       once". A team shares ONE allowance. That sentence sold the opposite of
       what shipped, which is the definition of a feature that does not work.
     - The whole tab was gated on the viewer's own plan, so a free teammate
       invited onto an Elite team - the entire point of a seat - was shown an
       upgrade wall for a team they were already a member of.
     - A failed load answered "you have no team", so one dropped request put an
       owner in front of a create-a-team form for a team that already existed.

   Plus the seat state itself: when an owner downgrades, the plan quietly stops
   covering whoever joined last. Nobody can act on that unless it is on screen. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Owner', email: 'owner@x.com', ini: 'O' } });
const { page, errors } = app;

/* Drive AMVTeam's transport rather than the render functions, so what is under
   test is the same path a real request takes. */
const serve = (team, opts = {}) => page.evaluate(([t, o]) => {
  window.__teamCalls = [];
  window.AMVTeam.enabled = () => true;
  window.AMVTeam._cache = null;
  window.AMV_API._fetch = async (path, init) => {
    window.__teamCalls.push(path);
    if (o.fail) throw new Error('network down');
    if (path === '/team/get') return { json: async () => ({ ok: true, team: t }) };
    if (path === '/team/invite') return { json: async () => o.invite || { ok: true, inviteToken: 'x', inviteLink: '?invite=x' } };
    return { json: async () => ({ ok: true }) };
  };
  saveStr('amv_plan', o.plan || 'elite');
  S.tab = 'team';
  return setTab('team');
}, [team, opts]);

const view = () => page.evaluate(() => (document.getElementById('vc') || {}).textContent || '');

const TEAM = {
  id: 'team_abc', name: 'Acme', ownerEmail: 'owner@x.com',
  members: [
    { email: 'owner@x.com', role: 'owner', joinedAt: 1, seated: true },
    { email: 'bob@x.com', role: 'member', joinedAt: 2, seated: true },
  ],
  plan: 'elite',
  seats: { used: 2, limit: 10, over: 0 },
};

section('The pitch describes the product that actually shipped');
{
  await serve(null, { plan: 'free' });
  await page.waitForFunction(() => /Team workspaces/.test(document.getElementById('vc').textContent), { timeout: 15000 });
  const t = await view();
  ok(!/Higher usage and more jobs at once/i.test(t),
     'the claim that a team buys more usage is gone, because it never did');
  ok(/one bill, not one per person/i.test(t),
     'and is replaced by what a seat really is', t.slice(0, 0));
  ok(/Elite includes 10, Ultra 25/.test(t), 'with the number of seats stated up front');
}

section('A member without the plan still sees their own team');
{
  /* The case the gate got backwards. Somebody on a free plan who was invited
     onto an Elite team is a full member - the team is paying for their seat. */
  await serve(TEAM, { plan: 'free' });
  await page.waitForFunction(() => /Acme/.test(document.getElementById('vc').textContent), { timeout: 15000 });
  const t = await view();
  ok(/Acme/.test(t), 'the team they belong to is what they are shown');
  ok(!/Which plan do I need/.test(t), 'and not an upgrade wall for a team they are already in');
  ok(!/Create your team/.test(t), 'nor an invitation to create a second one');
}

section('Seats are on screen, because only the owner can fix them');
{
  const over = JSON.parse(JSON.stringify(TEAM));
  over.plan = 'pro';
  over.members.push({ email: 'carol@x.com', role: 'member', joinedAt: 3, seated: false });
  over.members.push({ email: 'dan@x.com', role: 'member', joinedAt: 4, seated: false });
  over.seats = { used: 4, limit: 2, over: 2 };
  await serve(over, { plan: 'pro' });
  await page.waitForFunction(() => /Acme/.test(document.getElementById('vc').textContent), { timeout: 15000 });
  const t = await view();
  ok(/4 of 2 seats used/.test(t), 'the count is exact, not a vague warning', t.match(/\d+ of \d+ seats? used/));
  ok(/2 people are not covered by your plan/.test(t), 'and says how many people it affects');
  ok(/using their own plan instead/.test(t), 'and what it means for them, in plain words');

  const flagged = await page.evaluate(() =>
    [...document.querySelectorAll('.vrow')].filter(r => /no seat/.test(r.textContent)).map(r => r.textContent.split(' ')[0]));
  ok(flagged.length === 2, 'the affected members are named individually', flagged);
  ok(flagged.some(x => /carol/.test(x)) && flagged.some(x => /dan/.test(x)),
     'and they are the ones who joined last, not an arbitrary two', flagged);
  ok(!/owner@x.com[^]{0,40}no seat/.test(t), 'the owner is never the one squeezed out of their own team');
}

section('A failed load is not the same answer as an empty one');
{
  await serve(null, { fail: true });
  await page.waitForFunction(() => /could not reach the server/i.test(document.getElementById('vc').textContent), { timeout: 15000 });
  const t = await view();
  ok(/could not reach the server/i.test(t), 'it says the request failed');
  ok(!/Create your team/.test(t), 'rather than offering to create a team that may already exist');
  ok(!/Which plan do I need/.test(t), 'and without inventing a plan verdict it could not check');
  const retry = await page.evaluate(() => !!document.querySelector('[data-dact="renderTeamView"]'));
  ok(retry, 'and offers a way out rather than a dead end');
}

section('Running out of seats is answered where it happened');
{
  await serve(TEAM, { plan: 'elite',
    invite: { error: 'Your plan includes 10 seats. Upgrade to add more people, or remove someone first.',
              code: 'seat_limit', seats: { used: 10, limit: 10 } } });
  await page.waitForFunction(() => !!document.getElementById('team-invite-btn'), { timeout: 15000 });
  await page.evaluate(() => { document.getElementById('team-invite-email').value = 'eleventh@x.com'; });
  await page.click('#team-invite-btn');
  await page.waitForFunction(() => /seat/i.test(document.getElementById('team-invite-result').textContent), { timeout: 15000 });
  const res = await page.evaluate(() => document.getElementById('team-invite-result').textContent);
  ok(/Upgrade to add more people/.test(res), 'the reason stays on screen instead of a toast that vanishes', res);
  const cta = await page.evaluate(() =>
    !!document.querySelector('#team-invite-result [data-stab="plans"]'));
  ok(cta, 'next to the one control that resolves it');
  const btn = await page.evaluate(() => document.getElementById('team-invite-btn').disabled);
  ok(btn === false, 'and the form is usable again rather than stuck mid-submit');
}

section('It fits on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  const over = JSON.parse(JSON.stringify(TEAM));
  over.members.push({ email: 'a-very-long-address-for-testing@somecompany.example', role: 'member', joinedAt: 3, seated: false });
  over.seats = { used: 3, limit: 2, over: 1 };
  await serve(over, { plan: 'elite' });
  await page.waitForFunction(() => /Acme/.test(document.getElementById('vc').textContent), { timeout: 15000 });
  const bad = await overflowingElement(page);
  ok(!bad, 'nothing on the team screen pushes the page sideways at 390px', bad);
  await page.setViewportSize({ width: 320, height: 700 });
  const bad2 = await overflowingElement(page);
  ok(!bad2, 'and it still holds on the narrowest phone in use', bad2);
}

section('A member has their own way off the team');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { S.user.email = 'bob@x.com'; });
  await serve(TEAM, { plan: 'free' });
  await page.waitForFunction(() => /Acme/.test(document.getElementById('vc').textContent), { timeout: 15000 });
  const t = await view();
  ok(/Leave team/.test(t), 'a member is shown the exit, not only the owner');
  ok(/back to your own plan and your own allowance/.test(t),
     'and told exactly what changes, since their usage was pooled until now');

  const bad = await overflowingElement(page);
  ok(!bad, 'and it still fits on a phone', bad);

  await page.evaluate(() => { S.user.email = 'owner@x.com'; });
  await serve(TEAM, { plan: 'elite' });
  await page.waitForFunction(() => /Acme/.test(document.getElementById('vc').textContent), { timeout: 15000 });
  ok(!/Leave team/.test(await view()),
     'the owner is not offered it, because their subscription IS the team');
  await page.setViewportSize({ width: 1280, height: 900 });
}

section('The entry points exist, because a screen nobody can reach is not shipped');
{
  await page.setViewportSize({ width: 1280, height: 900 });
  /* Team appears for the plans that include it, and for anyone in a team on any
     plan. It is static markup that gets unhidden rather than a node built at
     runtime - see the Admin case immediately below for why that matters. */
  const teamNav = async (plan, cached) => page.evaluate(([p2, c]) => {
    saveStr('amv_plan', p2);
    window.AMVTeam._cache = c ? { id: 't' } : null;
    _revealTeamNav();
    const b = document.getElementById('nav-team');
    return !!b && !b.hidden;
  }, [plan, cached]);

  ok((await teamNav('free', false)) === false, 'a free solo account is not shown a tab it cannot use');
  ok((await teamNav('elite', false)) === true, 'Elite, which includes teams, is');
  ok((await teamNav('ultra', false)) === true, 'and so is Ultra');
  ok((await teamNav('free', true)) === true,
     'and so is a free member of somebody else\u2019s team, whose seat is paid for');

  /* A custom plan is a price, not a tier, so the rank lookup returned undefined
     and refused every one of them - including the enterprise plans the copy on
     that same screen promises teams to. */
  const customNav = (price) => page.evaluate(p2 => {
    saveStr('amv_plan', 'custom');
    store('amv_custom_cfg', { price: p2 });
    window.AMVTeam._cache = null;
    _revealTeamNav();
    return !document.getElementById('nav-team').hidden;
  }, price);
  ok((await customNav(300)) === true, 'an enterprise custom plan gets the team it was sold');
  ok((await customNav(90)) === true, 'and so does one priced at the Elite tier');
  ok((await customNav(20)) === false, 'while one priced below it does not');

  const reaches = await page.evaluate(() => {
    saveStr('amv_plan', 'elite'); _revealTeamNav();
    document.getElementById('nav-team').click();
    return S.tab;
  });
  ok(reaches === 'team', 'and clicking it actually opens the team screen', reaches);

  /* The Admin tab had exactly one entry point and it was anchored to a selector
     the sidebar had stopped matching, so the owner could not reach the operator
     view from the app at all. */
  const adminNav = await page.evaluate(() => {
    window.isAdmin = () => true;
    _revealAdminNav();
    const b = document.getElementById('nav-admin');
    if (!b) return { there: false };
    b.click();
    return { there: true, tab: S.tab };
  });
  ok(adminNav.there, 'the operator view has a way in', adminNav);
  ok(adminNav.tab === 'admin', 'and it goes where it says', adminNav.tab);

  const gone = await page.evaluate(() => {
    window.isAdmin = () => false;
    _revealAdminNav();
    return !document.getElementById('nav-admin');
  });
  ok(gone, 'and it is absent from the DOM entirely for everybody else');
}

ok(errors.length === 0, 'no console errors along the way', errors.slice(0, 3));

await app.close();
if (report('team-seats') > 0) process.exitCode = 1;
done();
