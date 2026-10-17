/* A PRICE WRITTEN OUT IN SIX PLACES IS SIX PRICES.

   Every plan price existed as literal text in the pricing cards - the big
   number, the local-currency figure, and the button beside it - again in the
   Help Center answer to "how do plans and limits work", again in the Teams
   copy, and again on the admin screen. None of them were derived from PLANS,
   which is what checkout actually uses.

   Change PLANS.pro.price and the card would have shown the new price in one
   div and the old one on the button directly beneath it, with the Help Center
   quoting a third figure to the person who came there to ask what it costs.
   Two different prices on the same card, one of them on the Buy button.

   And the server keeps its own copy for a different job: PLAN_PRICE_USD is the
   profit backstop that caps what an account may spend, with PLAN_PRICE_TIERS
   ranking a custom plan against the same three numbers. Those cannot drift from
   what is charged either - a backstop computed against a price nobody pays is
   not a backstop.

   So: one price per plan, everywhere, checked here rather than remembered. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');

const app = await bootApp({ tab: 'plans', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

const client = await page.evaluate(() =>
  Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, v.price])));

section('The client has one price table and it is populated');
{
  ok(client.pro > 0 && client.elite > 0 && client.ultra > 0,
     'the paid tiers all carry a price', client);
}

section('The server’s spend backstop agrees with what is charged');
{
  /* Read out of the worker so the two files cannot quietly disagree. */
  const m = worker.match(/const PLAN_PRICE_USD = \{([^}]*)\}/);
  ok(!!m, 'the worker price table was found', !!m);
  const server = {};
  for (const pair of (m ? m[1] : '').matchAll(/([a-z]+)\s*:\s*(\d+)/g)) server[pair[1]] = +pair[2];
  const off = Object.keys(server).filter(k => server[k] !== client[k])
    .map(k => `${k}: client $${client[k]} vs worker $${server[k]}`);
  ok(off.length === 0, 'every plan costs the same on both sides', off);
}

section('And so do the tiers a custom plan is ranked against');
{
  const m = worker.match(/const PLAN_PRICE_TIERS = (\[[\s\S]*?\]\];)/);
  ok(!!m, 'the tier table was found', !!m);
  const tiers = [...(m ? m[1] : '').matchAll(/\[\s*(\d+)\s*,\s*\d+\s*\]/g)].map(x => +x[1]).sort((a, b) => a - b);
  const paid = [client.pro, client.elite, client.ultra].sort((a, b) => a - b);
  ok(JSON.stringify(tiers) === JSON.stringify(paid),
     'a custom plan is ranked against the real prices', { tiers, paid });
}

section('Nothing in the shipped copy states a price of its own');
{
  /* The literal strings that used to sit beside the Buy buttons. Any of them
     reappearing means somebody wrote a price out again. */
  const literals = [
    /Start Pro - \$\d/, /Go Elite - \$\d/, /Go Ultra - \$\d/,
    /Pro \(\$\d+\/mo\)/, /Elite \(\$\d+\/mo\)/, /Ultra \(\$\d+\/mo\)/,
    /data-usd="\d+" data-per="mo"/,
    /Pro Plan - \$\d+\/month/, /Elite Plan - \$\d+\/month/,
  ];
  const found = literals.filter(re => re.test(bundle)).map(re => String(re));
  ok(found.length === 0, 'no plan price is written out as text', found);
}

section('The card, the button and the local price are the same number');
{
  /* The thing a customer actually looks at, read off the rendered page. */
  const r = await page.evaluate(() => {
    /* Scoped to the app view. The landing page carries its own copy of these
       cards and is still in the DOM behind it, so an unscoped query reads
       whichever one happens to come first - which is not the one on screen. */
    /* The card names its plan in data-plan; its heading also carries the
       "Start here" tag, so the heading is not read as the name. The button
       says what pressing it does ("Get Pro") rather than repeating the price,
       which now appears once per card - in the headline. */
    const cards = [...document.querySelectorAll('#vc .pl2-card')].map(c => {
      const plan = c.dataset.plan || '';
      const tier = (PLANS[plan] && PLANS[plan].name) || plan;
      const big = (c.querySelector('.pl2-amt') || {}).textContent || '';
      const btn = (c.querySelector('.pl2-cta') || {}).textContent || '';
      const loc = c.querySelector('.px-local');
      return { tier, big: big.replace(/[^\d]/g, ''), btn: btn.trim(),
               usd: loc ? loc.getAttribute('data-usd') : '' };
    });
    return { cards, plans: Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, String(v.price)])) };
  });
  const paid = r.cards.filter(c => /^(Pro|Elite|Ultra)$/.test(c.tier));
  ok(paid.length === 3, 'the three paid cards are on screen', r.cards.map(c => c.tier));
  const wrong = [];
  paid.forEach(c => {
    const want = r.plans[c.tier.toLowerCase()];
    if (c.big !== want) wrong.push(`${c.tier} headline $${c.big} != $${want}`);
    if (!new RegExp(c.tier).test(c.btn) && !/current plan/i.test(c.btn)) wrong.push(`${c.tier} button "${c.btn}" does not name the plan`);
    if (c.usd !== want) wrong.push(`${c.tier} local-currency $${c.usd} != $${want}`);
  });
  ok(wrong.length === 0, 'headline and local price match PLANS, and each button names its plan', wrong);
}

section('Change the price and every one of them follows');
{
  /* The property, not today's numbers. If any of the three were still literal
     text, this is where it shows up. */
  const r = await page.evaluate(() => {
    const was = PLANS.pro.price;
    PLANS.pro.price = 4242;
    setTab('plans');
    const html = document.getElementById('vc').innerHTML;
    const card = document.querySelector('#vc .pl2-card[data-plan="pro"]');
    const out = card ? {
      big: (card.querySelector('.pl2-amt') || {}).textContent.replace(/[^\d]/g, ''),
      usd: (card.querySelector('.px-local') || {}).getAttribute('data-usd'),
    } : null;
    const stale = /\$15\b/.test(html);
    PLANS.pro.price = was;
    setTab('plans');
    return { out, stale };
  });
  ok(r.out && r.out.big === '4242', 'the headline follows', r.out && r.out.big);
  ok(r.out && r.out.usd === '4242', 'the local-currency figure follows', r.out && r.out.usd);
  ok(!r.stale, 'and the old price is nowhere on the page', r.stale);
}

section('The Help Center quotes the same figure');
{
  const r = await page.evaluate(async () => {
    await _faqsLoad();
    const faq = window._FAQS.find(f => /how do plans and limits work/i.test(f.q));
    return { a: (faq || {}).a || '', pro: PLANS.pro.price, elite: PLANS.elite.price, ultra: PLANS.ultra.price };
  });
  ok(r.a.includes('$' + r.pro + '/mo'), 'Pro is quoted at the real price', r.a.slice(0, 120));
  ok(r.a.includes('$' + r.elite + '/mo'), 'so is Elite', r.elite);
  ok(r.a.includes('$' + r.ultra + '/mo'), 'and so is Ultra', r.ultra);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('one-price-everywhere') > 0) process.exitCode = 1;
done();
