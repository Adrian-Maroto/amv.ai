/* THE FAMILY PLAN SAYS WHAT IT COVERS - AND ONLY THAT (owner, Nov 25: $30 a
   month, up to six people, Pro for each, one shared allowance of twice Pro's).

   Every sentence about paying for somebody else is the server's answer, not
   the page's guess - the pane once told every family member "they pay for
   your AMV" while nothing in billing did. Held:
     · Plans lists Family at $30; where its price is not set it says "coming
       soon" and pressing it says so instead of opening a refused checkout;
       where it is set, pressing it opens Family's checkout page;
     · that page describes it from the server's numbers: six people, Pro for
       everyone, one shared allowance of twice Pro's, the five-hour window per
       person;
     · a payer on Family is told the plan covers everyone; a parent without it
       is told plainly it does not, and offered the plan;
     · a member is told "their Family plan pays for your AMV" only when the
       server says it covers them;
     · an invitation promises cover only when the inviter has the plan. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', viewport: { width: 1280, height: 900 }, user: { name: 'Ana', email: 'ana@example.com', ini: 'A' } });
const { page, errors } = app;
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelectorAll('.cc-banner').forEach(b => b.remove()));

section('Plans: Family at $30, not sold where its price is not set');
await page.evaluate(() => { _FAMILY_OPEN = false; setTab('plans'); });
await page.waitForSelector('#pl2-family');
const r1 = await page.evaluate(() => (document.getElementById('pl2-family').innerText || '').replace(/\s+/g, ' '));
ok(/Family/.test(r1) && /\$30/.test(r1) && /Coming soon/.test(r1), 'Family, $30, coming soon', r1);
await page.click('#pl2-family');
await page.waitForTimeout(300);
const t1 = await page.evaluate(() => ({ tab: S.tab, toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ') }));
ok(t1.tab === 'plans' && /not open for purchase yet/.test(t1.toast), 'pressing it says so, and opens no checkout', t1);

section('Where it is sold: its own checkout page, from the server’s numbers');
await page.evaluate(() => { _FAMILY_OPEN = true; setTab('chat'); setTab('plans'); });
await page.waitForSelector('#pl2-family');
ok(/six people/.test(await page.evaluate(() => document.getElementById('pl2-family').innerText)), 'the row describes it');
await page.click('#pl2-family');
await page.waitForTimeout(600);
const up = await page.evaluate(() => ({ tab: S.tab, text: (document.getElementById('vc').innerText || '').replace(/\s+/g, ' ') }));
ok(up.tab === 'upgrade' && /Family/.test(up.text) && /\$\s*30/.test(up.text), 'pressing it opens Family’s checkout page', up.tab);
ok(/up to five people/i.test(up.text) && /Everything in Pro/.test(up.text) && /twice Pro/.test(up.text), 'six people, Pro for each, twice Pro’s shared allowance', up.text.slice(0, 300));
const per = await page.evaluate(() => _msg5hLabel('family') === _msg5hLabel('pro'));
ok(per, 'the five-hour window shown is Pro’s, per person');

section('The Family pane says what the server says');
const pane = async (state, pending) => page.evaluate(async ([st, pend]) => {
  _FAM_STATE = st; _FAM_PENDING = pend || { invitations: [] };
  S.settingsPane = 'family'; setTab('settings'); renderSetPane();
  for (let i = 0; i < 40 && !document.querySelector('[data-fam-pane]'); i++) await new Promise(r => setTimeout(r, 50));
  _FAM_STATE = st; _FAM_PENDING = pend || { invitations: [] };
  _renderFamilyPane(document.querySelector('[data-fam-pane]'));
  return (document.querySelector('[data-fam-pane]').innerText || '').replace(/\s+/g, ' ');
}, [state, pending]);
const payer = await pane({ ok: true, payer: true, parentOf: { id: 'f', members: [{ email: 'kid@example.com', role: 'child', limits: {} }], max: 5, covered: true }, childOf: null });
ok(/Your Family plan covers everyone here/.test(payer), 'a payer on Family: the plan covers everyone', payer.slice(0, 200));
const parent = await pane({ ok: true, payer: false, parentOf: { id: 'f', members: [{ email: 'kid@example.com', role: 'child', limits: {} }], max: 5, covered: false }, childOf: null });
ok(!/covers everyone/.test(parent) && /their own plan/.test(parent) && /Family plan covers up to six people for \$30/.test(parent), 'a parent without it: not covered, and offered the plan', parent.slice(0, 300));
const kidCovered = await pane({ ok: true, parentOf: null, childOf: { parent: 'mum@example.com', limits: { monthlyUSD: 5 }, covered: true, canSee: [], cannotSee: [] } });
ok(/Their Family plan pays for your AMV/.test(kidCovered), 'a covered member is told the plan pays for them', kidCovered.slice(0, 200));
const kidNot = await pane({ ok: true, parentOf: null, childOf: { parent: 'mum@example.com', limits: { monthlyUSD: 5 }, covered: false, canSee: [], cannotSee: [] } });
ok(!/pays for your AMV/.test(kidNot) && /They set limits on your account/.test(kidNot), 'a member who is not covered is never told it is paid for', kidNot.slice(0, 200));
const inv = await pane({ ok: true, parentOf: null, childOf: null }, { invitations: [{ id: 'i1', from: 'a@example.com', pays: true }, { id: 'i2', from: 'b@example.com', pays: false }] });
ok(/a@example.com wants to add you to their family. Their Family plan would pay for your AMV/.test(inv), 'an invitation from a payer says the plan would pay', inv.slice(0, 300));
ok(/b@example.com wants to add you to their family. They would set what your AMV may spend/.test(inv) && !/b@example.com wants to add you to their family. Their Family/.test(inv), 'one from somebody without the plan does not');

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
report();
await app.close();
done();
